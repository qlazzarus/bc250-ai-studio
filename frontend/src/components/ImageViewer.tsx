import { useCallback, useEffect, useRef, useState } from "react";
import { type Asset, StudioApi } from "./../api";
import { ASSETS_PER_PAGE } from "../constants";

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

export default ImageViewer;