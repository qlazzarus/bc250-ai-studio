import { isLegacyComposition, type AssetMetadata, type StoredSnapshotV3 } from "./../api";
import { fromSnapshot } from "../prompt/composeSnapshot";

/** Reads a stored string, so a damaged row renders as blank rather than `[object Object]`. */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * UCP07: the v3 record, shown as what it *records* rather than as prose about a draft.
 *
 * Everything printed here is read from the stored row through `fromSnapshot`, so a record
 * this client cannot interpret is reported as unreadable instead of being rendered with
 * blanks. Two facts are stated explicitly because they are easy to misread:
 *
 * - the prompts below come from `applied`, i.e. they are what was executed. The row's
 *   `final prompt` (shown above this block) may differ if the user edited the field after
 *   applying — that is not a contradiction, it is two different facts;
 * - `snapshot_trim` is a *loss* list. If it is non-empty the record is incomplete, and this
 *   block says so rather than presenting the trimmed scene as the original.
 */
function SnapshotDetails({ data }: { data: StoredSnapshotV3 }) {
  const read = fromSnapshot(data);
  if (!read.ok) return <p>{read.message}</p>;
  const { restored } = read;
  const chips = restored.edit.selections;
  const excluded = chips.filter((item) => item.source === "excluded");
  const pinned = chips.filter((item) => item.pinned);
  const manual = chips.filter((item) => item.source === "manual");
  return <>
    <p>스키마 v3 · 컴파일러 {text(data.compiler_version)} · {restored.edit.targetFamily} · 프로필 v{restored.edit.profileVersion}</p>
    <p>선택: 수동 {manual.length} · 고정 {pinned.length} · 제외 {excluded.length} · 전체 {chips.length}
      {excluded.length > 0 && ` (제외: ${excluded.map((item) => item.id).join(", ")})`}</p>
    <p>장면: 개체 {restored.scene.entities.length} · 관계 {restored.scene.relations.length} · 미매핑 {restored.scene.unmappedDetails.length} · 모호성 {restored.scene.ambiguities.length}</p>
    {restored.scene.entities.length > 0 && <p>개체별 속성: {restored.scene.entities
      .map((entity) => `${entity.entityId}(${entity.kind}) ${entity.attributesKo.join("·") || "속성 없음"}`)
      .join(" / ")}</p>}
    {restored.applied === null
      ? <p>적용 이력: 없음. 이 기록에는 실제로 실행된 후보가 남아 있지 않으며, 최종 프롬프트에서 역산하지 않습니다.</p>
      : <p>적용: 후보 {restored.applied.candidateId} · {restored.applied.providerModel} · {restored.applied.appliedAt}</p>}
    {restored.trimmed && <p>저장 시 축소됨: {restored.snapshotTrim.join(", ")}. 축소된 필드는 원래 값이 남아 있지 않습니다.</p>}
  </>;
}

function Metadata({ data, archived, close, reuse, changeArchive, destroy }: { data: AssetMetadata; archived: boolean; close(): void; reuse(item: AssetMetadata): void; changeArchive(restore: boolean): Promise<void>; destroy(): Promise<void> }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
        <aside className="modal preview-modal" role="dialog" aria-modal="true" aria-label="생성 이미지 상세" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={close} aria-label="닫기">×</button>
        <p className="eyebrow">GENERATE METADATA</p>
        <h2>{data.model_id}</h2>
        <dl>
            <dt>Seed</dt>
            <dd>{data.seed}</dd>
            <dt>Size</dt>
            <dd>{data.width} × {data.height}</dd>
            <dt>Steps / CFG</dt>
            <dd>{data.steps} / {data.cfg_scale}</dd>
            <dt>Sampler</dt>
            <dd>{data.sampling_method ?? "기록 없음 · 모델 기본값"}</dd>
            <dt>Scheduler</dt>
            <dd>{data.scheduler ?? "CLI 기본값 (생략)"}</dd>
            <dt>Engine</dt>
            <dd>{data.simulated ? "Fake" : "Vulkan"}</dd>
            <dt>Prompt</dt>
            <dd>{data.prompt}</dd>
            {data.negative_prompt && (
                <>
                    <dt>Negative</dt>
                    <dd>{data.negative_prompt}</dd>
                </>
            )}
        </dl>
        {data.prompt_composition && <details><summary>프롬프트 구성 이력</summary>
          {isLegacyComposition(data.prompt_composition) ? <>
          <p>사전 선택: {data.prompt_composition.selections.map((item) => item.label_ko).join(", ") || "없음"}</p>
          {data.prompt_composition.selections.some((item) => item.mapping_status !== "mapped") && <p>
            미변환: {data.prompt_composition.selections.filter((item) => item.mapping_status !== "mapped")
              .map((item) => item.label_ko).join(", ")}
          </p>}
          <p>추가 설명: {data.prompt_composition.free_text_ko || "없음"}</p>
          <p>생성 초안: {data.prompt_composition.draft_prompt || "없음"}</p>
          {data.prompt_composition.unresolved.length > 0 && <p>
            미변환 기록 (최종 입력 포함 여부와 별개): {data.prompt_composition.unresolved.map((item) => item.text).join(", ")}
          </p>}
          <p>{data.prompt === data.prompt_composition.draft_prompt ? "저장된 초안과 최종 문자열이 같습니다." : data.prompt_composition.remainder?.length ? "저장된 초안과 최종 문자열이 다릅니다. 차이는 아래에 기록된 포함 번역이며, 초안 자체는 번역을 흡수하지 않습니다." : "저장된 초안과 최종 문자열이 다릅니다. 구성은 적용 이력이며 실제 생성 기준은 위 Prompt입니다."} 문자열 비교는 의미 일치를 보장하지 않습니다.</p>
          {data.prompt_composition.remainder?.length ? <>
            <p>포함한 번역 (최종 문자열 끝에 줄바꿈으로 붙음): {data.prompt_composition.remainder
              .map((item) => `${item.source_ko} → ${item.suggested_en}`).join(" / ")}</p>
            <p>번역 출처: {[...new Set(data.prompt_composition.remainder.map((item) => item.proposal_model))].join(", ")}
              {" · "}번역 제안 {[...new Set(data.prompt_composition.remainder.map((item) => item.proposal_id))].join(", ")}
              {" · "}수락 {data.prompt_composition.remainder.map((item) => item.accepted_at).join(", ")}</p>
            <p>자유 입력 반영 방식·적용 당시 경고: 별도 기록 없음. 추가 설명은 번역되지 않은 원문이며, 포함한 번역은 위 목록이 기록입니다. 번역은 제안이며 원문과 다를 수 있습니다.</p>
          </> : <p>자유 입력 반영 방식·적용 당시 문자열·당시 경고·출처: 별도 기록 없음. 추가 설명은 번역되지 않은 원문입니다.</p>}
          <p>사전 버전: {[...new Set(data.prompt_composition.selections.map((item) => item.dictionary_version))].join(", ") || "선택 없음"}</p>
          <p>컴파일러 {data.prompt_composition.compiler_version} · {data.prompt_composition.target_family} · 스키마 v{data.prompt_composition.schema_version}</p>
          </> : <SnapshotDetails data={data.prompt_composition} />}
        </details>}
        <div className="metadata-actions">
            <button className="quiet" onClick={() => void changeArchive(archived)}>
                {archived ? "갤러리로 복원" : "보관"}
            </button>
            {archived && (
                <button className="danger" onClick={() => void destroy()}>
                    영구 삭제
                </button>
            )}
        </div>
        <button className="generate" onClick={() => reuse(data)}>
            이 설정으로 다시 생성
        </button>
    </aside>
</div>
 );
}

export default Metadata;