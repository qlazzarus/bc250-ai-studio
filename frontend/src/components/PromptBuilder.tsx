import { useMemo, useState } from "react";
import { compileScene } from "../prompt/compiler";
import type { PromptBuilderState } from "../prompt/builderState";
import { DICTIONARY, DICTIONARY_VERSION, searchDictionary } from "../prompt/dictionary";
import { changeSceneFamily, removeEntry, selectEntry, type SceneSpecification } from "../prompt/scene";

const labels: Record<string, string> = {
  subject: "대상", appearance: "외형", clothing: "의상", expression: "표정", action: "동작", pose: "포즈",
  location: "장소", setting: "배경", composition: "구도", camera: "카메라", lighting: "조명", style: "스타일", mood: "분위기",
};

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
  const categories = [...new Set(DICTIONARY.filter((item) => item.active).map((item) => item.category))];
  const options = useMemo(() => searchDictionary(DICTIONARY, query).filter((item) => !category || item.category === category), [query, category]);
  const dirty = state.result !== null && JSON.stringify(state.scene) !== state.generatedFrom;

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

  return <div className="prompt-builder">
    <button type="button" className="quiet" aria-expanded={open} aria-controls="prompt-builder-panel" onClick={() => setOpen(!open)}>
      {open ? "사전 구성 닫기" : "사전으로 프롬프트 구성"}
    </button>
    <p className="prompt-hint">초안을 적용하면 서버 지원 여부에 따라 선택 사항과 초안이 생성 결과에 함께 저장됩니다. 새로고침 전 입력은 저장되지 않습니다.</p>
    <div id="prompt-builder-panel" hidden={!open}>
      <label>사전 검색<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 인물, 조명, 전신" /></label>
      <label>분류<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">전체</option>{categories.map((item) => <option key={item} value={item}>{labels[item] ?? item}</option>)}</select></label>
      <fieldset className="prompt-choices"><legend>사전 항목 선택</legend>
        {options.length ? options.map((item) => <label className="prompt-choice" key={item.id}>
          <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => { const checked = event.target.checked; setScene((scene) => checked ? selectEntry(scene, item, DICTIONARY_VERSION) : removeEntry(scene, item.id)); }} />
          <span>{item.labelKo} <small>· {labels[item.category] ?? item.category}</small></span>
        </label>) : <p className="prompt-hint">검색 결과가 없습니다.</p>}
      </fieldset>
      <p className="prompt-hint">선택 {selected.size}개{category || query ? " · 필터 밖의 선택도 유지됩니다." : ""}</p>
      <label>추가 설명 (한국어 원문)<textarea rows={3} value={state.scene.freeTextKo} onChange={(event) => setScene((scene) => ({ ...scene, freeTextKo: event.target.value }))} placeholder="원하는 장면을 입력하세요. 자동으로 번역되지는 않습니다." /></label>
      <button type="button" className="quiet" onClick={generate}>초안 만들기</button>
      {state.result && <section className="prompt-result" aria-label="프롬프트 초안">
        {dirty && <p className="prompt-warning">선택 또는 설명이 바뀌었습니다. 초안을 다시 만들어 주세요. 현재 최종 프롬프트는 유지됩니다.</p>}
        <label>생성된 초안<textarea readOnly value={state.result.draft} rows={3} placeholder="표현을 만들 수 없습니다." /></label>
        {state.result.unresolved.length > 0 && <div className="prompt-warning"><strong>변환되지 않은 항목</strong><ul>{state.result.unresolved.map((item, index) => <li key={`${item.id ?? "text"}-${index}`}>{item.text}</li>)}</ul><span>자동으로 최종 프롬프트에 포함되지 않습니다. 필요한 내용은 직접 입력하세요.</span></div>}
        {state.result.warnings.filter((warning) => warning.code !== "empty").map((warning, index) => <p className="prompt-warning" key={`${warning.code}-${index}`}>{warning.code === "conflict" ? `함께 선택한 항목을 확인하세요: ${warning.ids.map((id) => state.scene.selections.find((item) => item.id === id)?.labelKo ?? id).join(" / ")}` : warning.code === "unsupported_family" ? "이 모델 계열의 사전 변환은 아직 제공되지 않습니다." : `중복된 항목: ${warning.ids.join(", ")}`}</p>)}
        {state.result.warnings.some((warning) => warning.code === "empty") && <p className="prompt-warning">사전 항목을 선택하거나 설명을 입력하세요.</p>}
        <button type="button" className="quiet" disabled={!state.result.draft || dirty || state.result.targetFamily !== family} onClick={applyDraft}>초안을 최종 프롬프트에 적용</button>
      </section>}
      <p className="prompt-hint" role="status">{notice}</p>
    </div>
  </div>;
}
