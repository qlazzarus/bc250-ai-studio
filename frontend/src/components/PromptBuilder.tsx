import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compileScene, DRAFT_LIMIT } from "../prompt/compiler";
import { type PromptBuilderState, isDraftStale, withGeneratedDraft, withAppliedDraft, draftComposition } from "../prompt/builderState";
import { DICTIONARY, DICTIONARY_VERSION, familyCoverage } from "../prompt/dictionary";
import { changeSceneFamily, removeEntry, selectEntry, type SceneSpecification } from "../prompt/scene";
import { explainWarning, suggestSelections } from "../prompt/proposals";
import {
  DISPLAY_GROUP as displayGroup, activeGroups, filterOptions, chipGroups, nextFocusAfterRemoval,
  selectionCounts, recoveryActions, previewControls, inclusionNotice, appliedStatus,
  advisoryWarnings, unresolvedSelections,
} from "../prompt/presentation";

import { characterCount, validateComposition, validateText } from "../prompt/validation";

const labels: Record<string, string> = {
  subject: "대상", appearance: "외형", clothing: "의상", expression: "표정", action: "동작", pose: "포즈",
  location: "장소", setting: "배경", composition: "구도", camera: "카메라", lighting: "조명", style: "스타일", mood: "분위기",
};

type Props = {
  family: string;
  compositionSupported: boolean;
  value: string;
  onChange: (value: string) => void;
  state: PromptBuilderState;
  setState: (update: (state: PromptBuilderState) => PromptBuilderState) => void;
};

/**
 * Background guidance stays collapsed by default: at 1440px these paragraphs cost
 * 112px and at 360px 162px of the composer, and the U11 measurement showed that
 * cost pushed the apply control further away. State and contract text (inclusion,
 * warnings, errors, counts) is never placed here.
 */
function HelpNote({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="prompt-help"><summary>{summary}</summary><p className="prompt-hint">{children}</p></details>;
}

export default function PromptBuilder({ family, compositionSupported, value, onChange, state, setState }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState("");
  /** Hints stay hidden until the user asks; nothing is proposed while typing. */
  const [hintsOpen, setHintsOpen] = useState(false);
  /** Set before the render that removes a chip; consumed after that render. */
  const pendingFocusRef = useRef<{ target: string | null } | null>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selected = new Set(state.scene.selections.map((item) => item.id));
  const categories = activeGroups(DICTIONARY);
  const counts = selectionCounts(state.scene.selections);
  const options = useMemo(() => filterOptions(DICTIONARY, query, category), [query, category]);
  const coverage = useMemo(() => (family ? familyCoverage(DICTIONARY, family) : null), [family]);
  const dirty = isDraftStale(state);
  const candidate = draftComposition(state);
  const separateOnly = state.result?.draft === "" && state.freeTextMode === "separate" && state.scene.freeTextKo.length > 0;
  const draftIssues = state.result ? validateText(separateOnly ? value : state.result.draft, separateOnly ? "prompt" : "draft_prompt", 8000, true) : [];
  const compositionIssues = candidate ? validateComposition(candidate, family) : [];
  const issues = compositionSupported ? [...draftIssues, ...compositionIssues] : draftIssues;
  const freeIssues = validateText(state.scene.freeTextKo, "free_text_ko", 4000);
  const blocked = issues.length > 0;
  const selectedKey = state.scene.selections.map((item) => item.id).join("\u0000");
  const controls = previewControls(state, family, { blocked, separateOnly, prompt: value, dirty });
  const inclusion = inclusionNotice(state, state.result);
  const status = appliedStatus(state, value);
  const groups = chipGroups(state.scene.selections);
  /** Flat DOM order of the remove buttons, used only for focus restoration. */
  const chipOrder = groups.flatMap((group) => group.items.map((item) => item.id));
  const unresolved = unresolvedSelections(state.result);
  const advisories = advisoryWarnings(state.result);
  // Recomputed from the immutable free text only when the user opens the panel.
  const hints = useMemo(() => (hintsOpen && family
    ? suggestSelections({ freeTextKo: state.scene.freeTextKo, family, dictionary: DICTIONARY, selectedIds: selectedKey.split("\u0000") })
    : []), [hintsOpen, family, state.scene.freeTextKo, selectedKey]);

  // Removing a chip unmounts the button that had focus. Restore it to the next
  // rendered chip, then the previous one, and finally the search input.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const target = pending.target !== null ? removeRefs.current.get(pending.target) : undefined;
    if (target) { target.focus(); return; }
    if (!pending.target && chipOrder.length === 0) searchRef.current?.focus();
  });

  function setScene(update: (scene: SceneSpecification) => SceneSpecification) {
    setState((current) => {
      const scene = current.scene.targetFamily === family ? current.scene : changeSceneFamily(current.scene, family, DICTIONARY, DICTIONARY_VERSION);
      const next = { ...current, scene: update(scene) };
      return family ? withGeneratedDraft(next, compileScene(next.scene)) : next;
    });
  }

  /** Decides the focus target before the removal so the render can restore it. */
  function removeChip(id: string) {
    pendingFocusRef.current = { target: nextFocusAfterRemoval(chipOrder, id) };
    setScene((scene) => removeEntry(scene, id));
  }

  function generate() {
    if (!family) { setNotice("먼저 모델을 선택하세요."); return; }
    const scene = state.scene.targetFamily === family ? state.scene : changeSceneFamily(state.scene, family, DICTIONARY, DICTIONARY_VERSION);
    setState((current) => withGeneratedDraft({ ...current, scene }, compileScene(scene)));
    setNotice("초안을 만들었습니다. 확인한 뒤 최종 프롬프트에 적용하세요.");
  }

  function applyDraft() {
    if (!state.result || (!state.result.draft && !separateOnly) || dirty || blocked || state.result.targetFamily !== family) return;
    if (separateOnly) {
      setState((current) => withAppliedDraft(current, value));
      setNotice("추가 설명을 구성 이력에 적용했습니다. 최종 프롬프트는 유지됩니다.");
      return;
    }
    if (value && value !== state.result.draft && !window.confirm("현재 프롬프트를 초안으로 바꿉니다. 직접 수정한 내용도 덮어씁니다. 계속할까요?")) return;
    setState((current) => withAppliedDraft(current));
    onChange(state.result.draft);
    setNotice("초안을 최종 프롬프트에 적용했습니다. 필요하면 직접 수정하세요.");
  }

  function clearScene() {
    if (state.scene.selections.length && !window.confirm("선택한 사전 항목을 모두 해제합니다. 추가 설명과 최종 프롬프트는 유지됩니다. 계속할까요?")) return;
    pendingFocusRef.current = { target: null };
    setScene((scene) => ({ ...scene, selections: [] }));
    setNotice("선택을 비웠습니다. 미리보기를 확인하세요.");
  }

  /** Only ever removes duplicates the explanation explicitly marked as redundant. */
  function removeRedundant(ids: string[]) {
    if (!ids.length) return;
    const remaining = chipOrder.filter((id) => !ids.includes(id));
    pendingFocusRef.current = { target: remaining[0] ?? null };
    setScene((scene) => ids.reduce((next, id) => removeEntry(next, id), scene));
    setNotice("중복 항목을 해제했습니다. 미리보기를 확인하세요.");
  }

  function acceptHint(id: string) {
    const entry = DICTIONARY.find((item) => item.id === id && item.active);
    if (!entry) return;
    setScene((scene) => selectEntry(scene, entry, DICTIONARY_VERSION));
    setNotice(`"${entry.labelKo}"을(를) 선택에 추가했습니다. 원문은 그대로 유지됩니다.`);
  }

  /**
   * GAP03 decision: the picker opens on the whole dictionary. The narrowing step is
   * offered only where it is needed (empty scene) and only as one click, so a
   * subject-first start never hides the other groups or adds an entry screen.
   */
  function startWithSubject() {
    setCategory("subject");
    setQuery("");
    searchRef.current?.focus();
  }

  return <div className="prompt-builder">
    <button type="button" className="quiet" aria-expanded={open} aria-controls="prompt-builder-panel" onClick={() => setOpen(!open)}>
      {open ? "사전 구성 닫기" : "사전으로 프롬프트 구성"}
    </button>
    <HelpNote summary="저장 범위 안내">초안을 적용하면 서버 지원 여부에 따라 선택 사항과 초안이 생성 결과에 함께 저장됩니다. 새로고침 전 입력은 저장되지 않습니다.</HelpNote>
    {state.applied && <div role="status" className="prompt-status">
      <strong>{status === "unknown" ? "과거 복원 · 적용 정보 기록 없음"
        : status === "modified" ? "적용 후 수정됨"
        : status === "selectionChanged" ? "적용 후 선택 변경됨"
        : "적용됨"}</strong>
      <details className="prompt-status__detail">
        <summary>자세히</summary>
        <p>{status === "unknown" ? "과거 구성 복원: 적용 당시 문자열과 반영 방식은 별도 기록되지 않았습니다."
          : status === "modified" ? "적용 후 최종 프롬프트를 직접 수정했습니다. 구성 이력은 마지막 적용 상태로 저장되며 의미 일치를 보장하지 않습니다."
          : status === "selectionChanged" ? "선택 또는 설명을 편집 중입니다. 다시 적용하기 전에는 마지막 적용 구성이 저장됩니다."
          : "마지막 적용 문자열과 최종 프롬프트가 같습니다. 문자열 일치만 확인하며 의미 일치를 보장하지 않습니다."}</p>
        <p>구성 이력은 마지막 적용 시점의 선택으로 저장됩니다. 적용 후에는 최종 프롬프트를 직접 수정할 수 있습니다.</p>
      </details>
    </div>}
    <div id="prompt-builder-panel" hidden={!open}>
      {coverage && coverage.mapped < coverage.total && <p className="prompt-notice" data-tone="info">
        현재 모델 계열에서 사전 표현 {coverage.mapped}/{coverage.total}개를 변환할 수 있습니다. 나머지는 선택해도 미변환으로 표시됩니다.
      </p>}
      <div className="prompt-stage">
      <section className="prompt-explore" aria-label="사전 항목 탐색">
      <h3 className="prompt-section-heading">항목 탐색</h3>
      <label>사전 검색<input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 인물, 조명, 전신" /></label>
      <div className="prompt-categories" role="group" aria-label="사전 분류">
        {["", ...categories].map((item) => <button type="button" key={item || "all"} aria-pressed={category === item} onClick={() => setCategory(item)}>{item ? labels[item] ?? item : "전체"}<span className="prompt-category-count">{item ? `선택 ${counts[item] ?? 0}` : `선택 ${selected.size}`}</span></button>)}
      </div>
      <HelpNote summary={`${category ? labels[category] : "전체"} 분류 · ${options.length}개 결과`}>검색은 선택한 분류 안에서만 적용됩니다. 다른 분류의 선택도 유지됩니다.</HelpNote>
      <fieldset className="prompt-choices" aria-describedby="selection-errors" aria-invalid={compositionSupported && compositionIssues.some((issue) => issue.field === "selections")}><legend>사전 항목 선택</legend>
        {options.length ? options.map((item) => {
          const mapping = family ? item.mappings[family as keyof typeof item.mappings] : undefined;
          const status = mapping && mapping.status !== "mapped" ? " · 이 모델은 미변환" : "";
          return <label className="prompt-choice" key={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => { const checked = event.target.checked; setScene((scene) => checked ? selectEntry(scene, item, DICTIONARY_VERSION) : removeEntry(scene, item.id)); }} />
            <span>{item.labelKo} <small>· {labels[displayGroup[item.category] ?? item.category] ?? item.category}{status}</small></span>
          </label>;
        }) : <div className="prompt-empty">
          <p className="prompt-hint">검색 결과가 없습니다.</p>
          <div className="prompt-empty__actions">{recoveryActions(query, category).map((action) => <button
            type="button" className="quiet" key={action.kind}
            onClick={() => { setCategory(action.nextCategory); setQuery(action.nextQuery); }}>{action.label}</button>)}</div>
        </div>}
      </fieldset>
      <div id="selection-errors">{compositionSupported && compositionIssues.filter((issue) => issue.field === "selections").map((issue, index) => <p className="prompt-error" key={index}>{issue.message}</p>)}</div>
      <p className="prompt-hint">선택 {selected.size}개{category || query ? " · 필터 밖의 선택도 유지됩니다." : ""}</p>
      </section>
      <section className="prompt-scene" aria-label="선택한 장면과 미리보기">
      <h3 className="prompt-section-heading">장면과 미리보기</h3>
      {state.scene.selections.length === 0
        ? <div className="prompt-empty"><p className="prompt-hint">선택한 항목이 없습니다. 위의 항목 탐색에서 대상부터 골라 보세요. 사전을 쓰지 않고 원문만으로 구성할 수도 있습니다.</p>
          <div className="prompt-empty__actions"><button type="button" className="quiet" onClick={startWithSubject}>대상부터 고르기</button></div>
        </div>
        : <section className="prompt-groups" aria-label="선택한 장면 구성">
        <div className="prompt-group-heading"><strong>선택한 항목</strong><button type="button" className="quiet" onClick={clearScene}>선택 비우기</button></div>
        {groups.map((group) => <div className="prompt-group" key={group.group}><strong>{labels[group.group] ?? group.group}</strong><div className="prompt-selected">{group.items.map((item) => {
          const mapped = item.mapping.status === "mapped";
          const text = item.mapping.status === "mapped" ? item.mapping.text : null;
          return <div className="prompt-chip" key={item.id} data-unmapped={!mapped || undefined}>
            <span className="prompt-chip__label">{item.labelKo}</span>
            {text !== null ? <details className="prompt-chip__detail">
              <summary aria-label={`${item.labelKo} 표현 보기`}>표현</summary>
              <span>{text}</span>
            </details> : <span className="prompt-chip__unmapped">미변환</span>}
            <button type="button" aria-label={`${item.labelKo} 선택 해제`}
              ref={(node) => { if (node) removeRefs.current.set(item.id, node); else removeRefs.current.delete(item.id); }}
              onClick={() => removeChip(item.id)}>×</button>
          </div>;
        })}</div></div>)}
        <HelpNote summary="칩 표현 안내">선택할 때 저장한 {state.scene.targetFamily} 계열 표현입니다. 칩의 “표현”을 열면 영어 대응을 볼 수 있습니다.</HelpNote>
      </section>}
      <label>추가 설명 (원문)<textarea aria-invalid={compositionSupported && freeIssues.length > 0} aria-describedby="free-text-help" rows={3} value={state.scene.freeTextKo} onChange={(event) => setScene((scene) => ({ ...scene, freeTextKo: event.target.value }))} placeholder="원하는 장면을 입력하세요. 자동으로 번역되지는 않습니다." /></label>
      <div id="free-text-help">
        <HelpNote summary={`${characterCount(state.scene.freeTextKo)}/4000자`}>원문은 그대로 보존하며 자동 번역하지 않습니다.</HelpNote>
        {/* When composition support is on, `validateComposition` already reports the
            same limit in `#draft-errors`; showing it twice would make one problem
            look like two. Without composition support this is the only report. */}
        {!compositionSupported && freeIssues.map((issue, index) => <p className="prompt-error" key={index}>{issue.message} 구성 이력 미저장: 직접 생성은 계속 가능합니다.</p>)}
      </div>
      <div className="prompt-proposals">
        <button type="button" className="quiet" aria-expanded={hintsOpen} aria-controls="prompt-proposals"
          disabled={!family || !state.scene.freeTextKo.trim()}
          onClick={() => setHintsOpen(!hintsOpen)}>
          {hintsOpen ? "제안 닫기" : "원문에서 사전 항목 찾기"}
        </button>
        <HelpNote summary="제안 동작 안내">입력한 원문에서 사전 항목을 찾아 제안합니다. 원문은 바뀌지 않고, 추가는 직접 눌러야 반영됩니다.</HelpNote>
        {hintsOpen && <div id="prompt-proposals" className="prompt-proposal-list" role="group" aria-label="사전 항목 제안">
          {hints.length === 0
            ? <p className="prompt-hint">원문에서 사전 항목을 찾지 못했습니다. 직접 선택하거나 원문을 그대로 사용하세요.</p>
            : hints.map((hint) => <div className="prompt-proposal" key={hint.id}>
              <div>
                <strong>{hint.labelKo}</strong>
                <small> · {labels[displayGroup[hint.category] ?? hint.category] ?? hint.category} · 일치 “{hint.matchedPhrase}”</small>
                {!hint.available && <small className="prompt-proposal__warn"> · 이 모델은 미변환</small>}
              </div>
              <span className="prompt-proposal__score" title="규칙 일치 점수이며 모델 확률이 아닙니다."
                aria-label={`일치 표현 ${hint.matchedPhrase}, 규칙 점수 ${Math.round(hint.confidence * 100)}점`}>일치</span>
              <button type="button" className="quiet" onClick={() => acceptHint(hint.id)}>선택에 추가</button>
            </div>)}
        </div>}
      </div>
      <label>{state.provenance === "saved" ? "재생성 시 추가 설명 반영 방식 (과거 방식은 기록 없음)" : "추가 설명 반영 방식"}<select value={state.freeTextMode} onChange={(event) => setState((current) => { const next = { ...current, freeTextMode: event.target.value as "separate" | "verbatim" }; return family && next.scene.targetFamily === family ? withGeneratedDraft(next, compileScene(next.scene)) : next; })}>
        <option value="separate">별도 보관 · 최종 프롬프트는 직접 편집</option>
        <option value="verbatim">원문 그대로 초안과 최종 프롬프트에 반영</option>
      </select></label>
      <HelpNote summary="반영 방식 저장 안내">방식은 이 화면에서만 관리됩니다. 저장 이력에는 원문과 실제 적용 초안을 남기며, 방식 자체는 별도로 기록하지 않습니다.</HelpNote>
      {controls.showGenerate && <button type="button" className="quiet" onClick={generate}>{controls.generateLabel}</button>}
      {state.result && <section className="prompt-result" aria-label="프롬프트 초안">
        {state.provenance === "saved" && <HelpNote summary="저장된 초안 안내">저장된 초안과 미변환 목록입니다. 당시 경고·출처는 기록 없음입니다. 다시 만들기는 저장된 선택 표현에 현재 컴파일 규칙을 적용합니다.</HelpNote>}
        {controls.autoPreview && !dirty && <HelpNote summary="최신 미리보기">현재 선택 기준 최신 미리보기입니다. 최종 프롬프트는 적용할 때만 바뀝니다.</HelpNote>}
        {dirty && <p className="prompt-notice" data-tone="caution">선택 또는 설명이 바뀌었습니다. 초안을 다시 만들어 주세요. 현재 최종 프롬프트는 유지됩니다.</p>}
        {inclusion && <p className="prompt-inclusion" data-included={inclusion.included || undefined} data-unknown={inclusion.unknown || undefined}>{inclusion.text}</p>}
        <label>프롬프트 미리보기<textarea aria-invalid={blocked} aria-describedby="draft-errors" readOnly value={state.result.draft} rows={3} placeholder="표현을 만들 수 없습니다." /></label>
        <details className="prompt-meta">
          <summary>미리보기 상세</summary>
          <p className="prompt-hint">{characterCount(state.result.draft)}자 · 컴파일러 {state.result.compilerVersion}</p>
        </details>
        {unresolved.length > 0 && <div className="prompt-notice" data-tone="caution">
          <strong>이 모델로 번역되지 않은 선택 항목</strong>
          <ul>{unresolved.map((item, index) => <li key={`${item.id ?? "selection"}-${index}`}>{item.text}</li>)}</ul>
          <span>선택한 항목의 {state.scene.targetFamily || "대상 모델"} 표현이 사전에 없어 초안에서 빠졌습니다. 다른 항목을 고르거나 최종 프롬프트에 직접 입력하세요.</span>
        </div>}
        {advisories.map((item, index) => {
          const explanation = explainWarning(item, (id) => state.scene.selections.find((entry) => entry.id === id)?.labelKo ?? id, DRAFT_LIMIT);
          return <div className="prompt-notice prompt-notice--action" data-tone="caution" key={`${item.code}-${index}`}>
            <span>{explanation.message}</span>
            {explanation.removeIds.length > 0 && <button type="button" className="quiet"
              onClick={() => removeRedundant(explanation.removeIds)}>중복 해제</button>}
          </div>;
        })}
        {state.result.warnings.some((item) => item.code === "empty") && <p className="prompt-hint">사전 항목을 선택하거나 설명을 입력하면 미리보기가 만들어집니다.</p>}
        <div id="draft-errors" role="status">{issues.map((issue, index) => <p className="prompt-error" key={index}>{issue.field}: {issue.message}</p>)}</div>
        <button type="button" className="quiet" disabled={!controls.canApply} onClick={applyDraft}>{controls.applyLabel}</button>
      </section>}
      </section>
      </div>
      <p className="prompt-hint" role="status">{notice}</p>
    </div>
  </div>;
}
