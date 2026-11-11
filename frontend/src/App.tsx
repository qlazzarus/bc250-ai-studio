import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Asset, type AssetMetadata, type GenerationOption, type Job, type StudioModel, type SystemStatus, StudioApi } from "./api";
import { PixelStudio } from "./PixelStudio";

const API_KEY = import.meta.env.VITE_STUDIO_API_KEY || sessionStorage.getItem("bc250.studio.token") || "";
const JOBS_PER_PAGE = 12;
const ASSETS_PER_PAGE = 12;

type Settings = {
  modelId: string; prompt: string; negativePrompt: string; preset: string;
  resolution: string; steps: number; cfgScale: number; samplingMethod: string | null;
  scheduler: string | null; seed: string; batchCount: number;
};

const initialSettings: Settings = {
  modelId: "", prompt: "", negativePrompt: "", preset: "balanced", resolution: "512x512",
  steps: 4, cfgScale: 1, samplingMethod: null, scheduler: null, seed: "-1", batchCount: 1,
};

function editable(option: GenerationOption | undefined) {
  if (!option || option.mode === "fixed" || option.mode === "unsupported") return false;
  return option.allowed_values.length > 1 || option.minimum !== null || option.maximum !== null;
}

function fixedValue(option: GenerationOption | undefined, fallback: string) {
  return option?.default === null || option?.default === undefined ? fallback : String(option.default);
}

function optionStatus(option: GenerationOption | undefined) {
  if (!option) return "서버 capability 정보 없음";
  if (option.mode === "experimental") return "실험적 · BC-250 실기 미검증";
  if (option.mode === "verified") return "검증된 현재 범위";
  if (option.mode === "unsupported") return "이 모델에서 지원하지 않음";
  return "모델 고정값";
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
}

function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobPage, setJobPage] = useState(0);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [assetPage, setAssetPage] = useState(0);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [missingAssetIds, setMissingAssetIds] = useState<Record<string, true>>({});
  const assetUrlsRef = useRef<Record<string, string>>({});
  const [metadata, setMetadata] = useState<AssetMetadata | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [studio, setStudio] = useState<"art" | "pixel">("art");

  const api = useMemo(() => new StudioApi("/api/v1", API_KEY), []);
  const activeModel = models.find((model) => model.model_id === settings.modelId);
  const generationOptions = activeModel?.generation_options;
  const cfgOption = generationOptions?.cfg_scale;
  const negativeOption = generationOptions?.negative_prompt;
  const samplingOption = generationOptions?.sampling_method;
  const schedulerOption = generationOptions?.scheduler;
  const cfgEditable = editable(cfgOption) || (!cfgOption && Boolean(activeModel?.supported_parameters.includes("cfg_scale")));
  const requiredCfg = negativeOption?.requires.cfg_scale;
  const negativeEnabled = Boolean(
    negativeOption
      ? negativeOption.mode !== "unsupported" && (!requiredCfg || requiredCfg.includes(settings.cfgScale))
      : activeModel?.supported_parameters.includes("negative_prompt"),
  );
  const reportError = useCallback((message: string) => setError(message), []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [nextStatus, nextModels, nextJobs, nextAssets] = await Promise.all([
        api.status(), api.models(), api.jobs(JOBS_PER_PAGE, jobPage * JOBS_PER_PAGE),
        api.assets(showArchived, ASSETS_PER_PAGE, assetPage * ASSETS_PER_PAGE),
      ]);
      setStatus(nextStatus); setModels(nextModels); setJobs(nextJobs); setAssets(nextAssets);
      const first = nextModels.find((model) => model.execution_enabled);
      setSettings((old) => old.modelId ? old : { ...old, modelId: first?.model_id || "" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "API 연결에 실패했습니다.");
    }
  }, [api, assetPage, jobPage, showArchived]);

  useEffect(() => {
    if (!api) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 4000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [api, refresh]);
  // Object URLs must survive list refreshes. The old effect revoked every URL
  // whenever a new thumbnail arrived, which made gallery images intermittently
  // disappear or fail to open.
  useEffect(() => { assetUrlsRef.current = assetUrls; }, [assetUrls]);
  useEffect(() => () => Object.values(assetUrlsRef.current).forEach(URL.revokeObjectURL), []);

  useEffect(() => {
    if (!api) return;
    const missing = assets.filter((asset) => !assetUrls[asset.asset_id] && !missingAssetIds[asset.asset_id]);
    if (!missing.length) return;
    let active = true;
    void Promise.allSettled(missing.map(async (asset) => [asset.asset_id, await api.image(asset.asset_id)] as const)).then((results) => {
      if (!active) return;
      const loaded = results.filter((result): result is PromiseFulfilledResult<readonly [string, string]> => result.status === "fulfilled").map((result) => result.value);
      const unavailable = results.flatMap((result, index) => result.status === "rejected" ? [missing[index].asset_id] : []);
      if (loaded.length) setAssetUrls((old) => ({ ...old, ...Object.fromEntries(loaded) }));
      if (unavailable.length) setMissingAssetIds((old) => ({ ...old, ...Object.fromEntries(unavailable.map((id) => [id, true])) }));
    });
    return () => { active = false; };
  }, [api, assets, assetUrls, missingAssetIds]);

  function chooseModel(modelId: string) {
    const model = models.find((item) => item.model_id === modelId);
    if (!model) return;
    const preset = model.presets.balanced || Object.values(model.presets)[0];
    setSettings((old) => ({ ...old, modelId, prompt: old.prompt, negativePrompt: "",
      preset: model.presets.balanced ? "balanced" : Object.keys(model.presets)[0],
      resolution: `${preset.width}x${preset.height}`, steps: preset.steps,
      cfgScale: Number(model.generation_options?.cfg_scale.default ?? preset.cfg_scale),
      samplingMethod: model.generation_options?.sampling_method.default === null
        ? null : String(model.generation_options?.sampling_method.default),
      scheduler: model.generation_options?.scheduler.default === null
        ? null : String(model.generation_options?.scheduler.default),
    }));
  }

  function choosePreset(presetName: string) {
    if (!activeModel) return;
    const preset = activeModel.presets[presetName];
    setSettings((old) => ({ ...old, preset: presetName, resolution: `${preset.width}x${preset.height}`,
      steps: preset.steps, cfgScale: preset.cfg_scale,
      negativePrompt: requiredCfg?.includes(preset.cfg_scale) ? old.negativePrompt : "" }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!api || !activeModel) return;
    const [width, height] = settings.resolution.split("x").map(Number);
    const seed = Number(settings.seed);
    if (!settings.prompt.trim() || !Number.isInteger(seed) || seed < -1) {
      setError("프롬프트와 올바른 seed 값을 입력하세요."); return;
    }
    setSubmitting(true); setError("");
    try {
      const body: Record<string, unknown> = {
        job_type: settings.batchCount > 1 ? "image.batch" : "image.generate", source: "nsfw",
        model_id: activeModel.model_id, prompt: settings.prompt,
        width, height, steps: settings.steps, seed,
        batch_count: settings.batchCount, preset: settings.preset,
      };
      if (cfgEditable) body.cfg_scale = settings.cfgScale;
      if (negativeEnabled && settings.negativePrompt) body.negative_prompt = settings.negativePrompt;
      if (editable(samplingOption) && settings.samplingMethod) body.sampling_method = settings.samplingMethod;
      if (editable(schedulerOption) && settings.scheduler) body.scheduler = settings.scheduler;
      await api.createJob(body);
      setJobPage(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "작업 접수 실패");
    } finally { setSubmitting(false); }
  }

  async function inspect(asset: Asset) {
    if (!api) return;
    try {
      setSelectedAsset(asset);
      setMetadata(await api.metadata(asset.asset_id));
    } catch (reason) {
      setSelectedAsset(null);
      setError(reason instanceof Error ? reason.message : "메타데이터 조회 실패");
    }
  }

  function reuse(item: AssetMetadata) {
    setSettings({ modelId: item.model_id, prompt: item.prompt, negativePrompt: item.negative_prompt,
      preset: item.preset, resolution: `${item.width}x${item.height}`, steps: item.steps,
      cfgScale: item.cfg_scale, samplingMethod: item.sampling_method ?? null,
      scheduler: item.scheduler ?? null, seed: String(item.seed), batchCount: 1 });
    setMetadata(null); setSelectedAsset(null);
  }

  async function changeArchive(restore: boolean) {
    if (!api || !selectedAsset) return;
    try {
      if (restore) await api.restore(selectedAsset.asset_id);
      else await api.archive(selectedAsset.asset_id);
      setMetadata(null); setSelectedAsset(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "보관 상태 변경 실패");
    }
  }

  async function destroySelected() {
    if (!api || !selectedAsset || !window.confirm("보관함에서 이 이미지와 메타데이터를 삭제합니다. 계속할까요?")) return;
    try {
      await api.destroy(selectedAsset.asset_id);
      setMetadata(null); setSelectedAsset(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이미지 삭제 실패");
    }
  }

  const changeAssetPage = (page: number) => {
    Object.values(assetUrlsRef.current).forEach(URL.revokeObjectURL);
    setAssetUrls({}); setMissingAssetIds({}); setAssetPage(page);
  };
  const toggleArchived = () => {
    Object.values(assetUrlsRef.current).forEach(URL.revokeObjectURL);
    setAssetUrls({}); setMissingAssetIds({}); setAssetPage(0); setShowArchived((value) => !value);
  };

  if (studio === "pixel") return <><PixelStudio api={api} reportError={reportError} onArt={() => setStudio("art")} />{error && <div className="floating-error"><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}</>;

  return <main className="shell">
    <header><div><p className="eyebrow">BC-250 · LOCAL AI</p><h1>Art Studio</h1></div><div className="header-actions"><button className="quiet" onClick={() => setStudio("pixel")}>Pixel Studio</button></div></header>
    <section className="statusbar"><span className={status?.recovery_required ? "dot error" : "dot"} />
      <span>{status?.simulated ? "Fake Engine" : "Vulkan Engine"}</span><span>정책: {status?.policy || "…"}</span>
      {status?.policy === "manual" && <span className="notice">작업 접수 후 관리자의 실행 허가가 필요합니다.</span>}
      {status?.error?.message && <span className="notice error-text">{status.error.message}</span>}
    </section>
    {error && <div className="errorbox"><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}
    <div className="workspace">
      <section className="panel composer"><div className="section-title"><h2>새 이미지</h2><span>{activeModel?.verification_status || "모델 선택"}</span></div>
        <form onSubmit={submit}>
          <label>모델<select value={settings.modelId} onChange={(event) => chooseModel(event.target.value)}>
            <option value="">모델 선택</option>{models.map((model) => <option key={model.model_id} value={model.model_id} disabled={!model.execution_enabled}>{model.display_name}{model.execution_enabled ? "" : " · 사용 불가"}</option>)}
          </select></label>
          <label>프롬프트<textarea value={settings.prompt} onChange={(event) => setSettings({ ...settings, prompt: event.target.value })} placeholder="장면, 피사체, 조명, 스타일을 설명하세요." rows={5} /></label>
          <label className={negativeEnabled ? "" : "disabled"}>Negative prompt<textarea disabled={!negativeEnabled} value={settings.negativePrompt} onChange={(event) => setSettings({ ...settings, negativePrompt: event.target.value })} placeholder={negativeEnabled ? "제외할 요소를 입력하세요." : "이 모델의 현재 CFG에서는 negative prompt를 사용할 수 없습니다."} rows={2} /></label>
          {negativeOption && <p className="option-note">Negative prompt: {optionStatus(negativeOption)}{requiredCfg && ` · CFG ${requiredCfg.join(" / ")}에서만 사용 가능`}{negativeOption.note && ` · ${negativeOption.note}`}</p>}
          <div className="chips">{activeModel && Object.keys(activeModel.presets).map((name) => <button type="button" className={settings.preset === name ? "selected" : ""} key={name} onClick={() => choosePreset(name)}>{name}{activeModel.presets[name].validation_status === "experimental" ? " · experimental" : ""}</button>)}</div>
          <div className="grid2"><label>해상도<select value={settings.resolution} onChange={(event) => setSettings({ ...settings, resolution: event.target.value })}>{activeModel?.supported_resolutions.map(([width, height]) => <option key={`${width}x${height}`}>{width}x{height}</option>)}</select></label><label>수량<input type="number" min="1" max="16" value={settings.batchCount} onChange={(event) => setSettings({ ...settings, batchCount: Number(event.target.value) })} /></label></div>
          <div className="grid3"><label>Steps<input type="number" min="1" max="100" value={settings.steps} onChange={(event) => setSettings({ ...settings, steps: Number(event.target.value) })} /></label><label>CFG{cfgEditable && cfgOption?.allowed_values.length ? <select value={settings.cfgScale} onChange={(event) => { const cfgScale = Number(event.target.value); setSettings((old) => ({ ...old, cfgScale, negativePrompt: requiredCfg?.includes(cfgScale) ? old.negativePrompt : "" })); }}>{cfgOption.allowed_values.map((value) => <option key={String(value)} value={String(value)}>{value}</option>)}</select> : <input disabled={!cfgEditable} type="number" min={cfgOption?.minimum ?? 0} max={cfgOption?.maximum ?? 30} step="0.1" value={settings.cfgScale} onChange={(event) => { const cfgScale = Number(event.target.value); setSettings((old) => ({ ...old, cfgScale, negativePrompt: requiredCfg?.includes(cfgScale) ? old.negativePrompt : "" })); }} />}</label><label>Seed<input value={settings.seed} onChange={(event) => setSettings({ ...settings, seed: event.target.value })} /></label></div>
          {cfgOption && <p className="option-note">CFG: {optionStatus(cfgOption)}{cfgOption.note && ` · ${cfgOption.note}`}</p>}
          {generationOptions && <div className="fixed-options"><span>Sampler: {fixedValue(samplingOption, "CLI 기본값")} · {optionStatus(samplingOption)}</span><span>Scheduler: {fixedValue(schedulerOption, "CLI 기본값 (생략)")} · {optionStatus(schedulerOption)}</span></div>}
          <button className="generate" disabled={submitting || !activeModel?.execution_enabled}>{submitting ? "접수 중…" : settings.batchCount > 1 ? `${settings.batchCount}개 생성` : "이미지 생성"}</button>
        </form>
      </section>
      <section className="panel jobs"><div className="section-title"><h2>작업 큐</h2><button className="quiet" onClick={() => void refresh()}>새로고침</button></div>{api && jobs.length ? <>{jobs.map((job) => <JobCard key={job.job_id} job={job} api={api} refresh={refresh} />)}<Pagination page={jobPage} hasNext={jobs.length === JOBS_PER_PAGE} onPage={setJobPage} /></> : <p className="empty">최근 작업이 없습니다.</p>}</section>
    </div>
    <section className="panel gallery"><div className="section-title"><h2>{showArchived ? "NSFW 보관함" : "NSFW 갤러리"}</h2><span>{assets.length} assets</span><button className="quiet" onClick={toggleArchived}>{showArchived ? "갤러리" : "보관함"}</button></div>{assets.length ? <><div className="asset-grid">{assets.map((asset) => <div className="asset" key={asset.asset_id}><button className="asset-image" onClick={() => setViewedId(asset.asset_id)} aria-label="이미지 보기">{assetUrls[asset.asset_id] ? <img src={assetUrls[asset.asset_id]} alt="생성 결과" /> : missingAssetIds[asset.asset_id] ? <span>이미지를 찾을 수 없음</span> : <span>불러오는 중…</span>}</button><div className="asset-footer"><small>{asset.asset_id.slice(0, 8)} · {date(asset.created_at)}</small><button className="quiet" onClick={() => void inspect(asset)}>정보</button></div></div>)}</div><Pagination page={assetPage} hasNext={assets.length === ASSETS_PER_PAGE} onPage={changeAssetPage} /></> : <p className="empty">{showArchived ? "보관된 이미지가 없습니다." : "아직 저장된 NSFW 결과가 없습니다."}</p>}</section>
    {viewedId && <ImageViewer api={api} initialAssets={assets} initialPage={assetPage} initialId={viewedId} archived={showArchived} close={() => setViewedId(null)} />}
    {metadata && selectedAsset && <Metadata data={metadata} archived={Boolean(selectedAsset.archived_at)} close={() => { setMetadata(null); setSelectedAsset(null); }} reuse={reuse} changeArchive={changeArchive} destroy={destroySelected} />}
  </main>;
}

function Pagination({ page, hasNext, onPage }: { page: number; hasNext: boolean; onPage(page: number): void }) {
  return <nav className="pagination" aria-label="페이지 탐색">
    <button className="quiet" disabled={page === 0} onClick={() => onPage(page - 1)}>이전</button>
    <span>{page + 1} 페이지</span>
    <button className="quiet" disabled={!hasNext} onClick={() => onPage(page + 1)}>다음</button>
  </nav>;
}

function JobCard({ job, api, refresh }: { job: Job; api: StudioApi; refresh(): Promise<void> }) {
  const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(job.status);
  const action = async (kind: "cancel" | "retry") => {
    try {
      if (kind === "cancel") await api.cancel(job.job_id);
      else await api.retry(job.job_id);
    } finally {
      await refresh();
    }
  };
  return <article className="job"><div><span className={`badge ${job.status}`}>{job.status}</span><strong>{job.model_id}</strong><p>{job.prompt}</p><small>{job.items.map((item) => `${item.index + 1}: ${item.status}`).join(" · ")} · {date(job.created_at)}</small></div><div className="job-actions">{!terminal && <button onClick={() => void action("cancel")}>취소</button>}{["failed", "cancelled", "interrupted"].includes(job.status) && <button onClick={() => void action("retry")}>재시도</button>}</div></article>;
}

function ImageViewer({ api, initialAssets, initialPage, initialId, archived, close }: { api: StudioApi; initialAssets: Asset[]; initialPage: number; initialId: string; archived: boolean; close(): void }) {
  const [assets, setAssets] = useState(initialAssets);
  const [page, setPage] = useState(initialPage);
  const [viewedId, setViewedId] = useState(initialId);
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [imageErrorId, setImageErrorId] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState("");
  const [loadingPage, setLoadingPage] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const touchStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  const index = assets.findIndex((asset) => asset.asset_id === viewedId);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void api.image(viewedId).then((loaded) => {
      if (!active) { URL.revokeObjectURL(loaded); return; }
      url = loaded;
      setImageErrorId(null);
      setImage({ id: viewedId, url: loaded });
    }).catch(() => { if (active) setImageErrorId(viewedId); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [api, viewedId]);

  const navigate = useCallback(async (direction: -1 | 1) => {
    if (loadingRef.current || index < 0) return;
    const target = index + direction;
    setNavigationError("");
    if (target >= 0 && target < assets.length) {
      setViewedId(assets[target].asset_id);
      return;
    }
    const targetPage = page + direction;
    if (targetPage < 0 || (direction === 1 && (assets.length < ASSETS_PER_PAGE || atEnd))) return;
    loadingRef.current = true;
    setLoadingPage(true);
    try {
      const nextAssets = await api.assets(archived, ASSETS_PER_PAGE, targetPage * ASSETS_PER_PAGE);
      if (!mountedRef.current) return;
      if (!nextAssets.length) {
        if (direction === 1) setAtEnd(true);
        return;
      }
      setAssets(nextAssets);
      setPage(targetPage);
      setAtEnd(false);
      setViewedId(nextAssets[direction === 1 ? 0 : nextAssets.length - 1].asset_id);
    } catch {
      if (mountedRef.current) setNavigationError("이미지 목록을 불러오지 못했습니다. 다시 시도하세요.");
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoadingPage(false);
    }
  }, [api, archived, assets, atEnd, index, page]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft") { event.preventDefault(); void navigate(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); void navigate(1); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [close, navigate]);
  return <div className="modal-backdrop image-backdrop" onMouseDown={close}><div className="image-viewer" role="dialog" aria-modal="true" aria-label="이미지 보기" onMouseDown={(event) => event.stopPropagation()}
    onTouchStart={(event) => {
      if (event.touches.length !== 1 || (event.target as Element).closest("button")) { touchStart.current = null; return; }
      const touch = event.touches[0];
      touchStart.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
    }}
    onTouchMove={(event) => { if (event.touches.length !== 1) touchStart.current = null; }}
    onTouchCancel={() => { touchStart.current = null; }}
    onTouchEnd={(event) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || event.touches.length) return;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.id);
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.25) void navigate(dx < 0 ? 1 : -1);
    }}>
    <button className="close viewer-close" onClick={close} aria-label="닫기">×</button>
    <button className="viewer-arrow previous" onClick={() => void navigate(-1)} disabled={loadingPage || (page === 0 && index <= 0)} aria-label="이전 이미지">‹</button>
    {image?.id === viewedId && imageErrorId !== viewedId ? <img src={image.url} alt="생성 이미지" /> : <p>{imageErrorId === viewedId ? "이미지를 불러오지 못했습니다." : "불러오는 중…"}</p>}
    <button className="viewer-arrow next" onClick={() => void navigate(1)} disabled={loadingPage || (index === assets.length - 1 && (assets.length < ASSETS_PER_PAGE || atEnd))} aria-label="다음 이미지">›</button>
    <span className="viewer-count" aria-live="polite">{navigationError || (loadingPage ? "목록을 불러오는 중…" : `${page + 1} 페이지 · ${index + 1} / ${assets.length}`)}</span>
  </div></div>;
}

function Metadata({ data, archived, close, reuse, changeArchive, destroy }: { data: AssetMetadata; archived: boolean; close(): void; reuse(item: AssetMetadata): void; changeArchive(restore: boolean): Promise<void>; destroy(): Promise<void> }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><aside className="modal preview-modal" role="dialog" aria-modal="true" aria-label="생성 이미지 상세" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={close} aria-label="닫기">×</button><p className="eyebrow">GENERATE METADATA</p><h2>{data.model_id}</h2><dl><dt>Seed</dt><dd>{data.seed}</dd><dt>Size</dt><dd>{data.width} × {data.height}</dd><dt>Steps / CFG</dt><dd>{data.steps} / {data.cfg_scale}</dd><dt>Sampler</dt><dd>{data.sampling_method ?? "기록 없음 · 모델 기본값"}</dd><dt>Scheduler</dt><dd>{data.scheduler ?? "CLI 기본값 (생략)"}</dd><dt>Engine</dt><dd>{data.simulated ? "Fake" : "Vulkan"}</dd><dt>Prompt</dt><dd>{data.prompt}</dd>{data.negative_prompt && <><dt>Negative</dt><dd>{data.negative_prompt}</dd></>}</dl><div className="metadata-actions"><button className="quiet" onClick={() => void changeArchive(archived)}>{archived ? "갤러리로 복원" : "보관"}</button>{archived && <button className="danger" onClick={() => void destroy()}>영구 삭제</button>}</div><button className="generate" onClick={() => reuse(data)}>이 설정으로 다시 생성</button></aside></div>;
}

export default App;
