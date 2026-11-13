import { type AssetMetadata } from "./../api";

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