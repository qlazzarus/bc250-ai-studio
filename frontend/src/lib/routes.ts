/**
 * UIX06A: the URL is the only thing that decides which screen is showing.
 *
 * Every function here is pure and returns strings or plain objects, so the mapping between a
 * path and a screen can be tested without a browser, a router or a server. `App` reads a route
 * once per render and writes one back on an explicit user move; nothing else stores "the
 * current screen", because a second copy of that answer is exactly how a URL and the screen
 * drift apart.
 *
 * `/llm` and `/api` are reserved for the other services behind Caddy. They are not Art Studio
 * routes, and `parseArtRoute` never claims them.
 */

export type ArtScreen = "overview" | "compose" | "generate" | "jobs" | "gallery";

export type ArtRoute = {
  screen: ArtScreen;
  /** The job a `/art/jobs/:jobId` permalink names. */
  jobId: string | null;
  /** The image a `/art/gallery/:imageId` permalink names. */
  imageId: string | null;
  /** `/art/gallery/:imageId/metadata` — the same image, with the generation dialog open. */
  metadata: boolean;
  /** 0-based. Always >= 0; a bad value reads as the first page. */
  page: number;
  /** The gallery's archived view. A shareable filter, so it lives in the URL. */
  archived: boolean;
  /** False for a path this app does not serve: the caller renders the not-found screen. */
  known: boolean;
  /** True for `/pixel`, which is a different studio rather than an Art screen. */
  pixel: boolean;
};

const RESERVED = ["/api", "/llm"];

/** `/` is the old address and still works; it is replaced with `/art`. */
export const ART_HOME = "/art";

export const artPath = {
  overview: () => ART_HOME,
  compose: () => `${ART_HOME}/compose`,
  generate: () => `${ART_HOME}/generate`,
  jobs: (page = 0) => withPage(`${ART_HOME}/jobs`, page),
  job: (jobId: string) => `${ART_HOME}/jobs/${encodeURIComponent(jobId)}`,
  gallery: (options: { page?: number; archived?: boolean } = {}) => {
    const path = withPage(`${ART_HOME}/gallery`, options.page ?? 0);
    return options.archived ? `${path}${path.includes("?") ? "&" : "?"}archived=1` : path;
  },
  image: (imageId: string) => `${ART_HOME}/gallery/${encodeURIComponent(imageId)}`,
  imageMetadata: (imageId: string) => `${ART_HOME}/gallery/${encodeURIComponent(imageId)}/metadata`,
  pixel: () => "/pixel",
};

/** Page 0 is the default, so it is left out of the URL rather than written as `?page=0`. */
function withPage(path: string, page: number): string {
  return page > 0 ? `${path}?page=${page}` : path;
}

/**
 * A page number from the query string.
 *
 * Anything that is not a non-negative integer is the first page: a hand-edited `?page=abc`, a
 * negative number and a fractional one all describe no page this list has, and picking a
 * neighbouring page for the user would be a silent wrong answer.
 */
export function pageFromSearch(search: string): number {
  const value = new URLSearchParams(search).get("page");
  if (value === null || !/^\d+$/.test(value)) return 0;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 0;
}

export function archivedFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get("archived");
  return value === "1" || value === "true";
}


const EMPTY: ArtRoute = {
  screen: "overview", jobId: null, imageId: null, metadata: false,
  page: 0, archived: false, known: true, pixel: false,
};

/**
 * Reads a pathname (and its query) into a screen.
 *
 * The matching is exact on purpose. `/art/gallery/x/y/z` is not a gallery route with extra
 * segments — it is a URL this app does not serve, and saying so is better than showing the
 * gallery and letting the address bar disagree with the screen.
 */
export function parseArtRoute(pathname: string, search = ""): ArtRoute {
  const page = pageFromSearch(search);
  const archived = archivedFromSearch(search);
  const path = normalize(pathname);

  if (path === "/pixel") return { ...EMPTY, pixel: true, page, archived };
  if (path === "/") return { ...EMPTY, page, archived };
  if (RESERVED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    // Served by another app behind the same origin; not ours to route.
    return { ...EMPTY, known: false };
  }
  if (!path.startsWith(ART_HOME)) return { ...EMPTY, known: false };

  const rest = path.slice(ART_HOME.length);
  if (rest === "") return { ...EMPTY, page, archived };
  if (rest === "/compose") return { ...EMPTY, screen: "compose", page, archived };
  if (rest === "/generate") return { ...EMPTY, screen: "generate", page, archived };
  if (rest === "/jobs") return { ...EMPTY, screen: "jobs", page, archived };
  if (rest === "/gallery") return { ...EMPTY, screen: "gallery", page, archived };

  const jobs = /^\/jobs\/([^/]+)$/.exec(rest);
  if (jobs) return { ...EMPTY, screen: "jobs", jobId: decode(jobs[1]), page, archived };
  const image = /^\/gallery\/([^/]+)$/.exec(rest);
  if (image) return { ...EMPTY, screen: "gallery", imageId: decode(image[1]), page, archived };
  const meta = /^\/gallery\/([^/]+)\/metadata$/.exec(rest);
  if (meta) {
    return { ...EMPTY, screen: "gallery", imageId: decode(meta[1]), metadata: true, page, archived };
  }
  return { ...EMPTY, known: false, page, archived };
}

/** A trailing slash is the same address; anything else is left for the matcher to reject. */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.replace(/\/+$/, "");
  return pathname;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape names nothing; keep the raw text so the lookup fails as not-found
    // rather than throwing during render.
    return segment;
  }
}

/**
 * Where a close action goes when there is no in-app entry to pop.
 *
 * A dialog opened from the gallery closes back to the gallery; one opened from a pasted link
 * has no entry of ours to return to, so it closes to the gallery too. The caller decides
 * whether to pop history — that choice is about *how the dialog was opened*, not about the URL.
 */
export function galleryFallback(options: { archived?: boolean } = {}): string {
  return artPath.gallery({ archived: options.archived ?? false });
}
