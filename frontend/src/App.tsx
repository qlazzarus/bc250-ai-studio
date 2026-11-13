import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Asset, type AssetMetadata, type Job, type StudioModel, type SystemStatus, StudioApi } from "./api";
import { PixelStudio } from "./PixelStudio";
import Settings from "./types/Settings";
import { API_KEY, ASSETS_PER_PAGE, JOBS_PER_PAGE } from "./constants";
import ImageViewer from "./components/ImageViewer";
import Pagination from "./components/Pagination";
import JobCard from "./components/JobCard";
import Metadata from "./components/MetadataModal";
import date from "./lib/date";
import editable from "./lib/editable";
import fixedValue from "./lib/fixedValue";
import optionStatus from "./lib/optionStatus";

const initialSettings: Settings = {
  modelId: "", prompt: "", negativePrompt: "", preset: "balanced", resolution: "512x512",
  steps: 4, cfgScale: 1, samplingMethod: null, scheduler: null, seed: "-1", batchCount: 1,
};

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

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!api) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) return;
    signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10000);
    try {
      const [nextStatus, nextModels, nextJobs, nextAssets] = await Promise.all([
        api.status(controller.signal), api.models(controller.signal), api.jobs(JOBS_PER_PAGE, jobPage * JOBS_PER_PAGE, controller.signal),
        api.assets(showArchived, ASSETS_PER_PAGE, assetPage * ASSETS_PER_PAGE, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setStatus(nextStatus); setModels(nextModels); setJobs(nextJobs); setAssets(nextAssets);
      const first = nextModels.find((model) => model.execution_enabled);
      setSettings((old) => old.modelId ? old : { ...old, modelId: first?.model_id || "" });
    } catch (reason) {
      if (!signal?.aborted) setError(timedOut ? "API 응답 시간이 초과되었습니다. 다시 시도합니다." : reason instanceof Error ? reason.message : "API 연결에 실패했습니다.");
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
    }
  }, [api, assetPage, jobPage, showArchived]);

  useEffect(() => { 
    if (!api) return;

    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        await refresh(controller.signal);
      } finally {
        if (!stopped) {
          timer = window.setTimeout(() => void poll(), 4000);
        }
      }
    }

    void poll();

    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    }
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
    if (!model || !model.execution_enabled) return;
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
      negativePrompt: 
        !requiredCfg || requiredCfg?.includes(preset.cfg_scale) 
        ? old.negativePrompt 
        : "" 
      }));
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
      <span>정책: {status?.policy || "…"}</span>
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


export default App;
