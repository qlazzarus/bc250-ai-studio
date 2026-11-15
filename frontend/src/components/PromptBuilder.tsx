import { useMemo, useState } from "react";
import { compileScene, DRAFT_LIMIT } from "../prompt/compiler";
import { type PromptBuilderState, isDraftStale, withGeneratedDraft, withAppliedDraft, draftComposition, applicationStatus } from "../prompt/builderState";
import { DICTIONARY, DICTIONARY_VERSION, familyCoverage, searchDictionary } from "../prompt/dictionary";
import { changeSceneFamily, removeEntry, selectEntry, type SceneSpecification } from "../prompt/scene";

import { characterCount, validateComposition, validateText } from "../prompt/validation";

const labels: Record<string, string> = {
  subject: "대상", appearance: "외형", clothing: "의상", expression: "표정", action: "동작", pose: "포즈",
  location: "장소", setting: "배경", composition: "구도", camera: "카메라", lighting: "조명", style: "스타일", mood: "분위기",
};
// Existing IDs keep their original category value; the picker groups them under
// the display-only names from the seed expansion plan.
const displayGroup: Record<string, string> = { action: "pose", location: "setting", composition: "camera" };
const groupOrder = ["subject", "appearance", "clothing", "expression", "pose", "setting", "camera", "lighting", "style", "mood"];

type Props = {
  family: string;
  compositionSupported: boolean;
  value: string;
  onChange: (value: string) => void;
  state: PromptBuilderState;
  setState: (update: (state: PromptBuilderState) => PromptBuilderState) => void;
};

export default function PromptBuilder({ family, compositionSupported, value, onChange, state, setState }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [notice, setNotice] = useState("");
  const selected = new Set(state.scene.selections.map((item) => item.id));
  const categories = groupOrder.filter((group) => DICTIONARY.some((item) => item.active && (displayGroup[item.category] ?? item.category) === group));
  const options = useMemo(() => searchDictionary(DICTIONARY, query)
    .filter((item) => !category || (displayGroup[item.category] ?? item.category) === category), [query, category]);
  const coverage = useMemo(() => (family ? familyCoverage(DICTIONARY, family) : null), [family]);
  const dirty = isDraftStale(state);
  const status = applicationStatus(state, value);
  const candidate = draftComposition(state);
  const separateOnly = state.result?.draft === "" && state.freeTextMode === "separate" && state.scene.freeTextKo.length > 0;
  const draftIssues = state.result ? validateText(separateOnly ? value : state.result.draft, separateOnly ? "prompt" : "draft_prompt", 8000, true) : [];
  const compositionIssues = candidate ? validateComposition(candidate, family) : [];
  const issues = compositionSupported ? [...draftIssues, ...compositionIssues] : draftIssues;
  const freeIssues = validateText(state.scene.freeTextKo, "free_text_ko", 4000);
  const blocked = issues.length > 0;

  function setScene(update: (scene: SceneSpecification) => SceneSpecification) {
    setState((current) => {
      const scene = current.scene.targetFamily === family ? current.scene : changeSceneFamily(current.scene, family, DICTIONARY, DICTIONARY_VERSION);
      const next = { ...current, scene: update(scene) };
      return family ? withGeneratedDraft(next, compileScene(next.scene)) : next;
    });
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
    setScene((scene) => ({ ...scene, selections: [] }));
    setNotice("선택을 비웠습니다. 미리보기를 확인하세요.");
  }

  function warningText(code: string, ids: string[], detail?: string) {
    const names = ids.map((id) => state.scene.selections.find((item) => item.id === id)?.labelKo ?? id).join(" / ");
    if (code === "conflict") return `함께 선택한 항목을 확인하세요: ${names}`;
    if (code === "unsupported_family") return "이 모델 계열의 사전 변환은 아직 제공되지 않습니다.";
    if (code === "duplicate") return `중복된 항목: ${ids.join(", ")}`;
    if (code === "duplicate_phrase") return `같은 표현이 겹쳐 한 번만 사용했습니다: ${names}`;
    if (code === "over_limit") return detail?.includes("selection")
      ? `선택 항목이 서버 한도를 넘었습니다 (${detail}).`
      : `초안이 서버 저장 한도(${DRAFT_LIMIT}자)를 넘었습니다 (${detail}). 일부를 줄이세요.`;
    if (code === "token_budget") return `프롬프트가 SD 1.5 텍스트 창을 넘을 수 있습니다 (${detail}). 뒤쪽 항목이 반영되지 않을 수 있습니다.`;
    return "";
  }

  return <div className="prompt-builder">
    <button type="button" className="quiet" aria-expanded={open} aria-controls="prompt-builder-panel" onClick={() => setOpen(!open)}>
      {open ? "사전 구성 닫기" : "사전으로 프롬프트 구성"}
    </button>
    <p className="prompt-hint">초안을 적용하면 서버 지원 여부에 따라 선택 사항과 초안이 생성 결과에 함께 저장됩니다. 새로고침 전 입력은 저장되지 않습니다.</p>
    {state.applied && <div role="status" className="prompt-hint">
      <p>{status.historicalApplicationUnknown ? "과거 구성 복원: 적용 당시 문자열과 반영 방식은 별도 기록되지 않았습니다." : status.promptModified ? "적용 후 최종 프롬프트를 직접 수정했습니다. 구성 이력은 마지막 적용 상태로 저장되며 의미 일치를 보장하지 않습니다." : "마지막 적용 문자열과 최종 프롬프트가 같습니다. 문자열 동일성만 확인합니다."}</p>
      {status.selectionChanged && <p>선택 또는 설명을 편집 중입니다. 다시 적용하기 전에는 마지막 적용 구성이 저장됩니다.</p>}
    </div>}
    <div id="prompt-builder-panel" hidden={!open}>
      {coverage && coverage.mapped < coverage.total && <p className="prompt-warning">
        현재 모델 계열에서 사전 표현 {coverage.mapped}/{coverage.total}개를 변환할 수 있습니다. 나머지는 선택해도 미변환으로 표시됩니다.
      </p>}
      <label>사전 검색<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 인물, 조명, 전신" /></label>
      <div className="prompt-categories" role="group" aria-label="사전 분류">
        {["", ...categories].map((item) => <button type="button" key={item || "all"} aria-pressed={category === item} onClick={() => setCategory(item)}>{item ? labels[item] ?? item : "전체"}{item && ` ${state.scene.selections.filter((entry) => (displayGroup[entry.category] ?? entry.category) === item).length}`}</button>)}
      </div>
      <p className="prompt-hint">{category ? labels[category] : "전체"} 분류에서 검색 · {options.length}개 결과. 다른 분류의 선택도 유지됩니다.</p>
      <fieldset className="prompt-choices" aria-describedby="selection-errors" aria-invalid={compositionSupported && compositionIssues.some((issue) => issue.field === "selections")}><legend>사전 항목 선택</legend>
        {options.length ? options.map((item) => {
          const mapping = family ? item.mappings[family as keyof typeof item.mappings] : undefined;
          const status = mapping && mapping.status !== "mapped" ? " · 이 모델은 미변환" : "";
          return <label className="prompt-choice" key={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => { const checked = event.target.checked; setScene((scene) => checked ? selectEntry(scene, item, DICTIONARY_VERSION) : removeEntry(scene, item.id)); }} />
            <span>{item.labelKo} <small>· {labels[displayGroup[item.category] ?? item.category] ?? item.category}{status}</small></span>
          </label>;
        }) : <p className="prompt-hint">검색 결과가 없습니다.</p>}
      </fieldset>
      <div id="selection-errors">{compositionSupported && compositionIssues.filter((issue) => issue.field === "selections").map((issue, index) => <p className="prompt-warning" key={index}>{issue.message}</p>)}</div>
      <p className="prompt-hint">선택 {selected.size}개{category || query ? " · 필터 밖의 선택도 유지됩니다." : ""}</p>
      {state.scene.selections.length > 0 && <section className="prompt-groups" aria-label="선택한 장면 구성">
        <div className="prompt-group-heading"><strong>선택한 장면 구성</strong><button type="button" className="quiet" onClick={clearScene}>선택 비우기</button></div>
        {[...groupOrder, ...new Set(state.scene.selections.map((item) => displayGroup[item.category] ?? item.category).filter((group) => !groupOrder.includes(group)))].map((group) => {
          const items = state.scene.selections.filter((item) => (displayGroup[item.category] ?? item.category) === group);
          return items.length > 0 && <div className="prompt-group" key={group}><strong>{labels[group] ?? group}</strong><div className="prompt-selected">{items.map((item) => <span className="prompt-chip" key={item.id} data-unmapped={item.mapping.status !== "mapped" || undefined}>
            <span>{item.labelKo} <small>→ {item.mapping.status === "mapped" ? item.mapping.text : "미변환"}</small></span>
            <button type="button" onClick={() => setScene((scene) => removeEntry(scene, item.id))} aria-label={`${item.labelKo} 선택 해제`}>×</button>
          </span>)}</div></div>;
        })}
        <p className="prompt-hint">선택 시 저장한 {state.scene.targetFamily} 계열 표현입니다. 중복 표현이나 미지원 계열은 미리보기 결과를 확인하세요.</p>
      </section>}
      <label>추가 설명 (원문)<textarea aria-invalid={compositionSupported && freeIssues.length > 0} aria-describedby="free-text-help" rows={3} value={state.scene.freeTextKo} onChange={(event) => setScene((scene) => ({ ...scene, freeTextKo: event.target.value }))} placeholder="원하는 장면을 입력하세요. 자동으로 번역되지는 않습니다." /></label>
      <div id="free-text-help" className="prompt-hint">
        <p>{characterCount(state.scene.freeTextKo)}/4000자 · 원문은 그대로 보존하며 자동 번역하지 않습니다.</p>
        {freeIssues.map((issue, index) => <p className="prompt-warning" key={index}>{issue.message}{!compositionSupported && " 구성 이력 미저장: 직접 생성은 계속 가능합니다."}</p>)}
      </div>
      <label>{state.provenance === "saved" ? "재생성 시 추가 설명 반영 방식 (과거 방식은 기록 없음)" : "추가 설명 반영 방식"}<select value={state.freeTextMode} onChange={(event) => setState((current) => { const next = { ...current, freeTextMode: event.target.value as "separate" | "verbatim" }; return family && next.scene.targetFamily === family ? withGeneratedDraft(next, compileScene(next.scene)) : next; })}>
        <option value="separate">별도 보관 · 최종 프롬프트는 직접 편집</option>
        <option value="verbatim">원문 그대로 초안과 최종 프롬프트에 반영</option>
      </select></label>
      <p className="prompt-hint">방식은 이 화면에서만 관리됩니다. 저장 이력에는 원문과 실제 적용 초안을 남기며, 방식 자체는 별도로 기록하지 않습니다.</p>
      <button type="button" className="quiet" onClick={generate}>{state.provenance === "saved" ? "현재 컴파일러로 초안 다시 만들기" : "초안 만들기"}</button>
      {state.result && <section className="prompt-result" aria-label="프롬프트 초안">
        {state.provenance === "saved" && <p className="prompt-hint">저장된 초안과 미변환 목록입니다. 당시 경고·출처는 기록 없음입니다. 다시 만들기는 저장된 선택 표현에 현재 컴파일 규칙을 적용합니다.</p>}
        {!dirty && state.provenance === "current" && <p className="prompt-hint">현재 선택 기준 최신 미리보기입니다. 최종 프롬프트는 적용할 때만 바뀝니다.</p>}
        {dirty && <p className="prompt-warning">선택 또는 설명이 바뀌었습니다. 초안을 다시 만들어 주세요. 현재 최종 프롬프트는 유지됩니다.</p>}
        <label>프롬프트 미리보기<textarea aria-invalid={blocked} aria-describedby="draft-errors" readOnly value={state.result.draft} rows={3} placeholder="표현을 만들 수 없습니다." /></label>
        <p className="prompt-hint">{characterCount(state.result.draft)}자 · 컴파일러 {state.result.compilerVersion}</p>
        {state.result.unresolved.length > 0 && <div className="prompt-warning"><strong>변환되지 않은 항목</strong><ul>{state.result.unresolved.map((item, index) => <li key={`${item.id ?? "text"}-${index}`}>{item.text}</li>)}</ul><span>미변환은 번역되지 않았다는 뜻입니다. 원문 반영 방식에서는 추가 설명이 그대로 포함됩니다. 선택 항목의 미제공 표현은 직접 입력하세요.</span></div>}
        {state.result.warnings.filter((item) => item.code !== "empty").map((item, index) => <p className="prompt-warning" key={`${item.code}-${index}`}>{warningText(item.code, item.ids, item.detail)}</p>)}
        {state.result.warnings.some((item) => item.code === "empty") && <p className="prompt-warning">사전 항목을 선택하거나 설명을 입력하세요.</p>}
        <div id="draft-errors" role="status">{issues.map((issue, index) => <p className="prompt-warning" key={index}>{issue.field}: {issue.message}</p>)}</div>
        <button type="button" className="quiet" disabled={(!state.result.draft && !separateOnly) || dirty || blocked || state.result.targetFamily !== family} onClick={applyDraft}>{separateOnly ? "설명만 이력에 적용 (최종 입력 유지)" : "초안을 최종 프롬프트에 적용"}</button>
      </section>}
      <p className="prompt-hint" role="status">{notice}</p>
    </div>
  </div>;
}
