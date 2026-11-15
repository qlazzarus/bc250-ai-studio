import { useMemo, useState } from "react";
import { compileScene, DRAFT_LIMIT } from "../prompt/compiler";
import { type PromptBuilderState, isDraftStale } from "../prompt/builderState";
import { DICTIONARY, DICTIONARY_VERSION, familyCoverage, searchDictionary } from "../prompt/dictionary";
import { changeSceneFamily, removeEntry, selectEntry, type SceneSpecification } from "../prompt/scene";

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
  value: string;
  onChange: (value: string) => void;
  state: PromptBuilderState;
  setState: (update: (state: PromptBuilderState) => PromptBuilderState) => void;
};

export default function PromptBuilder({ family, value, onChange, state, setState }: Props) {
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

  function setScene(update: (scene: SceneSpecification) => SceneSpecification) {
    setState((current) => {
      const scene = current.scene.targetFamily === family ? current.scene : changeSceneFamily(current.scene, family, DICTIONARY, DICTIONARY_VERSION);
      return { ...current, scene: update(scene) };
    });
  }

  function generate() {
    if (!family) { setNotice("먼저 모델을 선택하세요."); return; }
    const scene = state.scene.targetFamily === family ? state.scene : changeSceneFamily(state.scene, family, DICTIONARY, DICTIONARY_VERSION);
    setState((current) => ({ ...current, scene, result: compileScene(scene), generatedFrom: JSON.stringify(scene) }));
    setNotice("초안을 만들었습니다. 확인한 뒤 최종 프롬프트에 적용하세요.");
  }

  function applyDraft() {
    if (!state.result?.draft || dirty || state.result.targetFamily !== family) return;
    if (value && value !== state.result.draft && !window.confirm("현재 프롬프트를 초안으로 바꿉니다. 직접 수정한 내용도 덮어씁니다. 계속할까요?")) return;
    const result = state.result;
    const scene = state.scene;
    setState((current) => ({ ...current, applied: {
      schema_version: 1, compiler_version: result.compilerVersion, target_family: scene.targetFamily,
      selections: scene.selections.map((item) => ({ id: item.id, category: item.category, label_ko: item.labelKo,
        dictionary_version: item.dictionaryVersion, mapping_status: item.mapping.status,
        rendered: item.mapping.status === "mapped" ? item.mapping.text : null })),
      free_text_ko: scene.freeTextKo, draft_prompt: result.draft, unresolved: result.unresolved,
    } }));
    onChange(state.result.draft);
    setNotice("초안을 최종 프롬프트에 적용했습니다. 필요하면 직접 수정하세요.");
  }

  function clearScene() {
    if (state.scene.selections.length && !window.confirm("선택한 사전 항목을 모두 해제합니다. 추가 설명과 최종 프롬프트는 유지됩니다. 계속할까요?")) return;
    setState((current) => ({ ...current, scene: { ...current.scene, selections: [] } }));
    setNotice("선택을 비웠습니다. 초안을 다시 만들어 주세요.");
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
    <div id="prompt-builder-panel" hidden={!open}>
      {coverage && coverage.mapped < coverage.total && <p className="prompt-warning">
        현재 모델 계열에서 사전 표현 {coverage.mapped}/{coverage.total}개를 변환할 수 있습니다. 나머지는 선택해도 미변환으로 표시됩니다.
      </p>}
      <label>사전 검색<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 인물, 조명, 전신" /></label>
      <label>분류<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">전체</option>{categories.map((item) => <option key={item} value={item}>{labels[item] ?? item}</option>)}</select></label>
      <fieldset className="prompt-choices"><legend>사전 항목 선택</legend>
        {options.length ? options.map((item) => {
          const mapping = family ? item.mappings[family as keyof typeof item.mappings] : undefined;
          const status = mapping && mapping.status !== "mapped" ? " · 이 모델은 미변환" : "";
          return <label className="prompt-choice" key={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => { const checked = event.target.checked; setScene((scene) => checked ? selectEntry(scene, item, DICTIONARY_VERSION) : removeEntry(scene, item.id)); }} />
            <span>{item.labelKo} <small>· {labels[displayGroup[item.category] ?? item.category] ?? item.category}{status}</small></span>
          </label>;
        }) : <p className="prompt-hint">검색 결과가 없습니다.</p>}
      </fieldset>
      <p className="prompt-hint">선택 {selected.size}개{category || query ? " · 필터 밖의 선택도 유지됩니다." : ""}</p>
      {state.scene.selections.length > 0 && <div className="prompt-selected" aria-label="선택한 사전 항목">
        {state.scene.selections.map((item) => <span className="prompt-chip" key={item.id} data-unmapped={item.mapping.status !== "mapped" || undefined}>
          {item.labelKo}
          <button type="button" onClick={() => setScene((scene) => removeEntry(scene, item.id))} aria-label={`${item.labelKo} 선택 해제`}>×</button>
        </span>)}
        <button type="button" className="quiet" onClick={clearScene}>선택 비우기</button>
      </div>}
      <label>추가 설명 (한국어 원문)<textarea rows={3} value={state.scene.freeTextKo} onChange={(event) => setScene((scene) => ({ ...scene, freeTextKo: event.target.value }))} placeholder="원하는 장면을 입력하세요. 자동으로 번역되지는 않습니다." /></label>
      <button type="button" className="quiet" onClick={generate}>초안 만들기</button>
      {state.result && <section className="prompt-result" aria-label="프롬프트 초안">
        {dirty && <p className="prompt-warning">선택 또는 설명이 바뀌었습니다. 초안을 다시 만들어 주세요. 현재 최종 프롬프트는 유지됩니다.</p>}
        <label>생성된 초안<textarea readOnly value={state.result.draft} rows={3} placeholder="표현을 만들 수 없습니다." /></label>
        <p className="prompt-hint">{state.result.draft.length}자 · 컴파일러 {state.result.compilerVersion}</p>
        {state.result.unresolved.length > 0 && <div className="prompt-warning"><strong>변환되지 않은 항목</strong><ul>{state.result.unresolved.map((item, index) => <li key={`${item.id ?? "text"}-${index}`}>{item.text}</li>)}</ul><span>자동으로 최종 프롬프트에 포함되지 않습니다. 필요한 내용은 직접 입력하세요.</span></div>}
        {state.result.warnings.filter((item) => item.code !== "empty").map((item, index) => <p className="prompt-warning" key={`${item.code}-${index}`}>{warningText(item.code, item.ids, item.detail)}</p>)}
        {state.result.warnings.some((item) => item.code === "empty") && <p className="prompt-warning">사전 항목을 선택하거나 설명을 입력하세요.</p>}
        <button type="button" className="quiet" disabled={!state.result.draft || dirty || state.result.targetFamily !== family} onClick={applyDraft}>초안을 최종 프롬프트에 적용</button>
      </section>}
      <p className="prompt-hint" role="status">{notice}</p>
    </div>
  </div>;
}
