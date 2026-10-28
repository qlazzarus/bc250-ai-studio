import { FormEvent, useCallback, useEffect, useState } from "react";
import { type Asset, type PixelAsset, type PixelProject, StudioApi } from "./api";

const sizes: Record<PixelAsset["kind"], number> = {
  unit: 64, building: 128, terrain: 32, decoration: 32, item: 32, ui: 32, effect: 32,
};

const kinds = Object.keys(sizes) as PixelAsset["kind"][];

export function PixelStudio({ api, reportError, onArt, disconnect }: { api: StudioApi; reportError(message: string): void; onArt(): void; disconnect(): void }) {
  const [projects, setProjects] = useState<PixelProject[]>([]);
  const [sources, setSources] = useState<Asset[]>([]);
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});
  const [projectId, setProjectId] = useState("");
  const [assets, setAssets] = useState<PixelAsset[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [versionUrls, setVersionUrls] = useState<Record<string, string>>({});
  const [projectName, setProjectName] = useState("");
  const [artBible, setArtBible] = useState('{\n  "style": "retro pixel art",\n  "palette": [],\n  "prompt_prefix": ""\n}');
  const [assetName, setAssetName] = useState("");
  const [kind, setKind] = useState<PixelAsset["kind"]>("unit");
  const [sourceId, setSourceId] = useState("");
  const [paletteColors, setPaletteColors] = useState(16);
  const [busy, setBusy] = useState(false);

  const selectedAsset = assets.find((asset) => asset.asset_id === assetId);
  const selectedProject = projects.find((project) => project.project_id === projectId);

  const refresh = useCallback(async () => {
    try {
      const [nextProjects, nextSources] = await Promise.all([api.projects(), api.sourceAssets()]);
      setProjects(nextProjects); setSources(nextSources);
      setProjectId((current) => current || nextProjects[0]?.project_id || "");
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Pixel Studio 로드 실패"); }
  }, [api, reportError]);

  const refreshAssets = useCallback(async () => {
    if (!projectId) { setAssets([]); return; }
    try {
      const nextAssets = await api.projectAssets(projectId, showArchived);
      setAssets(nextAssets);
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Pixel Asset 로드 실패"); }
  }, [api, projectId, reportError, showArchived]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshAssets(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshAssets]);
  useEffect(() => () => Object.values(versionUrls).forEach(URL.revokeObjectURL), [versionUrls]);
  useEffect(() => {
    const missing = sources.filter((source) => !sourceUrls[source.asset_id]).slice(0, 36);
    if (!missing.length) return;
    void Promise.all(missing.map(async (source) => [source.asset_id, await api.image(source.asset_id)] as const))
      .then((pairs) => setSourceUrls((current) => ({ ...current, ...Object.fromEntries(pairs) })))
      .catch((reason: unknown) => reportError(reason instanceof Error ? reason.message : "원본 썸네일 로드 실패"));
  }, [api, reportError, sourceUrls, sources]);
  useEffect(() => {
    if (!selectedProject) return;
    const timer = window.setTimeout(
      () => setArtBible(JSON.stringify(selectedProject.art_bible, null, 2)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [selectedProject]);
  useEffect(() => {
    if (!selectedAsset) return;
    const missing = selectedAsset.versions.filter((version) => !versionUrls[version.version_id]);
    if (!missing.length) return;
    void Promise.all(missing.map(async (version) => [version.version_id, await api.pixelImage(version.version_id)] as const))
      .then((pairs) => setVersionUrls((current) => ({ ...current, ...Object.fromEntries(pairs) })))
      .catch((reason: unknown) => reportError(reason instanceof Error ? reason.message : "픽셀 버전 이미지 로드 실패"));
  }, [api, reportError, selectedAsset, versionUrls]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    try {
      const parsed = JSON.parse(artBible) as Record<string, unknown>;
      setBusy(true);
      const project = await api.createProject({ name: projectName, art_bible: parsed });
      setProjectName(""); setProjectId(project.project_id);
      await refresh();
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Art Bible은 JSON 객체여야 합니다."); }
    finally { setBusy(false); }
  }

  async function createAsset(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !sourceId) return;
    try {
      setBusy(true);
      const asset = await api.createPixelAsset(projectId, { name: assetName, kind, source_asset_id: sourceId });
      setAssetName(""); setAssetId(asset.asset_id);
      await refreshAssets();
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Pixel Asset 생성 실패"); }
    finally { setBusy(false); }
  }

  async function saveArtBible() {
    if (!projectId) return;
    try {
      setBusy(true);
      const parsed = JSON.parse(artBible) as Record<string, unknown>;
      await api.updateProject(projectId, { art_bible: parsed });
      await refresh();
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Art Bible은 JSON 객체여야 합니다."); }
    finally { setBusy(false); }
  }

  async function processSelected() {
    if (!selectedAsset) return;
    const size = sizes[selectedAsset.kind];
    try {
      setBusy(true);
      await api.processPixelAsset(selectedAsset.asset_id, { width: size, height: size, palette_colors: paletteColors, remove_solid_background: true, trim: true, center: true });
      await refreshAssets();
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Pillow 처리 실패"); }
    finally { setBusy(false); }
  }

  async function approve(versionId: string) {
    if (!selectedAsset) return;
    try { setBusy(true); await api.approvePixelAsset(selectedAsset.asset_id, versionId); await refreshAssets(); }
    catch (reason) { reportError(reason instanceof Error ? reason.message : "승인 실패"); }
    finally { setBusy(false); }
  }

  async function changeArchive(restore: boolean) {
    if (!selectedAsset) return;
    try {
      setBusy(true);
      if (restore) await api.restorePixelAsset(selectedAsset.asset_id);
      else await api.archivePixelAsset(selectedAsset.asset_id);
      setAssetId(""); await refreshAssets();
    } catch (reason) { reportError(reason instanceof Error ? reason.message : "Pixel Asset 보관 상태 변경 실패"); }
    finally { setBusy(false); }
  }

  async function destroySelected() {
    if (!selectedAsset || !window.confirm("보관된 Pixel Asset과 모든 처리 버전을 삭제합니다. 계속할까요?")) return;
    try { setBusy(true); await api.destroyPixelAsset(selectedAsset.asset_id); setAssetId(""); await refreshAssets(); }
    catch (reason) { reportError(reason instanceof Error ? reason.message : "Pixel Asset 삭제 실패"); }
    finally { setBusy(false); }
  }

  return <main className="shell pixel-shell">
    <header><div><p className="eyebrow">BC-250 · PIXEL PIPELINE</p><h1>Pixel Studio</h1></div><div className="header-actions"><button className="quiet" onClick={onArt}>Art Studio</button><button className="quiet" onClick={disconnect}>연결 해제</button></div></header>
    <div className="pixel-layout">
      <section className="panel"><div className="section-title"><h2>프로젝트 / Art Bible</h2><span>{projects.length} projects</span></div>
        <label>프로젝트<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">프로젝트 선택</option>{projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
        {selectedProject && <><p className="selected-project">선택됨: {selectedProject.name}</p><label>Art Bible (JSON)<textarea rows={8} value={artBible} onChange={(event) => setArtBible(event.target.value)} /></label><button type="button" className="quiet" disabled={busy} onClick={() => void saveArtBible()}>Art Bible 저장</button></>}
        <form className="new-project" onSubmit={createProject}><label>새 프로젝트 이름<input required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Chicken Farm" /></label>{!selectedProject && <label>Art Bible (JSON)<textarea rows={8} value={artBible} onChange={(event) => setArtBible(event.target.value)} /></label>}<button className="quiet" disabled={busy}>프로젝트 생성</button></form>
      </section>
      <section className="panel"><div className="section-title"><h2>원본 → Pixel Asset</h2><span>기존 Studio 이미지 재사용</span></div>
        <form onSubmit={createAsset}><label>이름<input required value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="farmer-chicken" /></label><label>종류<select value={kind} onChange={(event) => setKind(event.target.value as PixelAsset["kind"])}>{kinds.map((value) => <option key={value}>{value}</option>)}</select></label><div className="source-heading"><p className="source-label">원본 이미지 선택</p>{sourceId && <button type="button" className="quiet" onClick={() => setSourceId("")}>선택 해제</button>}</div><div className="source-picker">{sources.map((source) => <button type="button" key={source.asset_id} className={source.asset_id === sourceId ? "source-card selected" : "source-card"} onClick={() => setSourceId(source.asset_id)}>{sourceUrls[source.asset_id] ? <img src={sourceUrls[source.asset_id]} alt={`원본 ${source.asset_id.slice(0, 8)}`} /> : <span>불러오는 중…</span>}<small>{source.namespace} · {source.asset_id.slice(0, 8)}</small><small>{new Date(source.created_at).toLocaleString("ko-KR")}</small></button>)}</div><button className="generate" disabled={busy || !projectId || !sourceId}>Pixel Asset 등록</button></form>
      </section>
    </div>
    <section className="panel pixel-assets"><div className="section-title"><h2>{showArchived ? "Pixel 보관함" : "Pixel Assets"}</h2><div className="section-actions">{assetId && <button className="quiet" onClick={() => setAssetId("")}>선택 해제</button>}<button className="quiet" onClick={() => { setAssetId(""); setShowArchived((value) => !value); }}>{showArchived ? "Assets" : "보관함"}</button><button className="quiet" onClick={() => void refreshAssets()}>새로고침</button></div></div>
      {assets.length ? <div className="pixel-list">{assets.map((asset) => <button key={asset.asset_id} className={asset.asset_id === assetId ? "pixel-card selected" : "pixel-card"} onClick={() => setAssetId(asset.asset_id)}><strong>{asset.name}</strong><small>{asset.kind} · {asset.status} · {asset.versions.length} versions</small></button>)}</div> : <p className="empty">{showArchived ? "보관된 Pixel Asset이 없습니다." : "프로젝트를 선택하고 원본 이미지를 Pixel Asset으로 등록하세요."}</p>}
    </section>
    {selectedAsset && <section className="panel pixel-detail"><div className="section-title"><div><h2>{selectedAsset.name}</h2><span>{selectedAsset.kind} · {sizes[selectedAsset.kind]}×{sizes[selectedAsset.kind]}</span></div><label className="palette">Palette<input type="number" min="2" max="256" value={paletteColors} onChange={(event) => setPaletteColors(Number(event.target.value))} /></label></div><div className="metadata-actions"><button className="quiet" disabled={busy} onClick={() => void changeArchive(Boolean(selectedAsset.archived_at))}>{selectedAsset.archived_at ? "Assets로 복원" : "보관"}</button>{selectedAsset.archived_at && <button className="danger" disabled={busy} onClick={() => void destroySelected()}>영구 삭제</button>}</div>{!selectedAsset.archived_at && <button className="generate" disabled={busy} onClick={() => void processSelected()}>투명화 · Trim · Pixelize 처리</button>}<div className="pixel-versions">{selectedAsset.versions.map((version) => <article key={version.version_id} className={version.version_id === selectedAsset.approved_version_id ? "pixel-version approved" : "pixel-version"}>{versionUrls[version.version_id] ? <img src={versionUrls[version.version_id]} alt={`${selectedAsset.name} version`} /> : <span>불러오는 중…</span>}<small>{version.operation} · {version.version_id.slice(0, 8)}</small>{!selectedAsset.archived_at && <button className="quiet" disabled={busy || version.version_id === selectedAsset.approved_version_id} onClick={() => void approve(version.version_id)}>{version.version_id === selectedAsset.approved_version_id ? "승인됨" : "승인"}</button>}</article>)}</div></section>}
  </main>;
}
