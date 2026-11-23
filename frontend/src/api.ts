export type Preset = { width: number; height: number; steps: number; cfg_scale: number; validation_status?: string };

export type GenerationOption = {
  mode: "fixed" | "experimental" | "verified" | "unsupported";
  default: number | string | null;
  allowed_values: Array<number | string>;
  minimum: number | null;
  maximum: number | null;
  note: string | null;
  requires: Record<string, Array<number | string>>;
};

export type GenerationOptions = {
  cfg_scale: GenerationOption;
  negative_prompt: GenerationOption;
  sampling_method: GenerationOption;
  scheduler: GenerationOption;
};

export type StudioModel = {
  model_id: string;
  display_name: string;
  family: string;
  supported_resolutions: [number, number][];
  supported_parameters: string[];
  presets: Record<string, Preset>;
  availability_status: "available" | "unavailable";
  verification_status: string;
  execution_enabled: boolean;
  generation_options?: GenerationOptions;
};

export type Item = {
  index: number;
  seed: number;
  status: string;
  asset_id?: string;
  error_message?: string;
};

export type Job = {
  job_id: string;
  job_type: "image.generate" | "image.batch";
  status: string;
  model_id: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  sampling_method?: string | null;
  scheduler?: string | null;
  seed: number;
  batch_count: number;
  preset: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  output_asset_ids: string[];
  items: Item[];
};

export type Asset = {
  asset_id: string;
  job_id: string;
  namespace: "rp" | "nsfw" | "pixel";
  created_at: string;
  archived_at: string | null;
  file_url: string;
};

export type PromptCompositionRemainder = {
  source_ko: string;
  suggested_en: string;
  proposal_id: string;
  proposal_model: string;
  /** ISO-8601 UTC, second precision: `YYYY-MM-DDTHH:MM:SSZ`. */
  accepted_at: string;
};

/**
 * The v1/v2 composition record (dictionary-builder shape).
 *
 * UCP07 note: `schema_version` is narrowed to `1 | 2` because v3 is a *different* record,
 * not a wider one. A v3 row stores the compose panel's scene, chip sources and apply
 * history, which this shape has no fields for; describing both with one type would let a
 * reader call `.selections.map(item => item.label_ko)` on rows that have no `label_ko`.
 * `AssetMetadata["prompt_composition"]` is the union, and `isLegacyComposition` narrows it.
 */
export type PromptComposition = {
  /** 1 for a recorded v1 snapshot, 2 once a translation is included (TRANS01 §2.4). */
  schema_version: 1 | 2;
  compiler_version: string;
  target_family: string;
  selections: { id: string; category: string; label_ko: string; dictionary_version: string; mapping_status: "mapped" | "unavailable"; rendered: string | null }[];
  free_text_ko: string;
  draft_prompt: string;
  unresolved: { kind: "selection" | "free_text"; id?: string | null; text: string }[];
  /**
   * TRANS01: accepted translations of phrases the dictionary cannot express.
   *
   * Absent on a v1 snapshot and must stay absent there — the server's `extra="forbid"`
   * per version rejects the key under `schema_version: 1`, so re-writing an old
   * snapshot as v2 would change a recorded fact. Only present when `schema_version` is
   * 2, and never merged into `draft_prompt`.
   */
  remainder?: PromptCompositionRemainder[];
};

/**
 * A stored v3 snapshot as a *reader* sees it: enough structure to route on, nothing more.
 *
 * It is not `SnapshotV3` from `composeSnapshot.ts` because that type describes what the
 * composer *writes*, and a stored row may be older, trimmed or damaged. `fromSnapshot`
 * validates the real content; this type only lets a caller ask "is this v3?" without
 * `as` casts.
 */
export type StoredSnapshotV3 = { schema_version: 3 } & Record<string, unknown>;

export type StoredComposition = PromptComposition | StoredSnapshotV3;

/** Narrows a stored record to the v1/v2 shape. The only sanctioned way to read one. */
export function isLegacyComposition(
  value: StoredComposition | null | undefined,
): value is PromptComposition {
  return value !== null && value !== undefined && value.schema_version !== 3;
}

export type AssetMetadata = {
  prompt_composition?: StoredComposition | null;
  asset_id: string;
  model_id: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  seed: number;
  batch_index: number;
  simulated: boolean;
  preset: string;
  sampling_method?: string | null;
  scheduler?: string | null;
};

export type SystemStatus = {
  engine: string;
  simulated: boolean;
  policy: "manual" | "chat_priority" | "image_priority";
  recovery_required: boolean;
  error: { message?: string };
};

export type PixelProject = {
  project_id: string;
  name: string;
  art_bible: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PixelVersion = {
  version_id: string;
  asset_id: string;
  operation: string;
  details: Record<string, unknown>;
  created_at: string;
  file_url: string;
};

export type PixelAsset = {
  asset_id: string;
  project_id: string;
  kind: "unit" | "building" | "terrain" | "decoration" | "item" | "ui" | "effect";
  name: string;
  source_asset_id: string;
  status: "draft" | "approved";
  approved_version_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  versions: PixelVersion[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class StudioApi {
  constructor(private baseUrl: string, private token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.detail || response.statusText);
    }
    return response.json() as Promise<T>;
  }

  capabilities(signal?: AbortSignal) {
    return this.request<{
      prompt_composition?: { schema_versions?: number[] };
      /** Absent when this server cannot serve an LLM proposal (LLM-I03/I04). */
      prompt_proposals?: {
        schema_versions?: number[];
        max_response_bytes?: number;
        timeout_ms?: number;
        dictionary_version?: string;
      };
      /**
       * UCP03/UCP05: the integrated compose path, advertised as its own key so a client
       * that only sees `prompt_proposals` concludes compose is unavailable (§5). Absent
       * means "this deployment cannot compose", which is a normal answer.
       */
      prompt_compose?: {
        schema_versions?: number[];
        dictionary_version?: string;
        /** Per-family output profile versions; the key a stale client is refused on. */
        output_profile_versions?: Record<string, number>;
        max_request_bytes?: number;
        max_response_bytes?: number;
        timeout_ms?: number;
        max_candidates?: number;
        max_brief_chars?: number;
        max_selections?: number;
      };
      request_limits?: { max_body_bytes?: number };
    }>("/system/capabilities", { signal });
  }
  /**
   * UCP05: one integrated composition.
   *
   * The reply is a *union*, not an outcome: `200` carries `ready`/`needs_clarification`,
   * and a provider problem is a `200` with `status: "unavailable"`, so `response.ok` is
   * not the success signal. The body is returned unparsed on purpose — the shape is
   * validated in `composeRequest.ts`, where a malformed reply becomes a typed failure.
   * HTTP errors still throw, because those are facts about the request (§5).
   */
  compose(body: unknown, signal?: AbortSignal) {
    return this.request<unknown>("/prompt/compose", {
      method: "POST", body: JSON.stringify(body), signal,
    });
  }
  /**
   * One explicit proposal attempt (LLM-I03 contract). The reply is 200 even when the
   * server cannot answer, so callers must read `status`, not `response.ok`.
   * `signal` aborts the call; the server then also drops its own work.
   */
  proposals(body: unknown, signal?: AbortSignal) {
    return this.request<unknown>("/prompt/proposals", {
      method: "POST", body: JSON.stringify(body), signal,
    });
  }
  status(signal?: AbortSignal) { return this.request<SystemStatus>("/system/status", { signal }); }
  models(signal?: AbortSignal) { return this.request<StudioModel[]>("/models", { signal }); }
  jobs(limit = 20, offset = 0, signal?: AbortSignal) { return this.request<Job[]>(`/jobs?limit=${limit}&offset=${offset}`, { signal }); }
  job(id: string) { return this.request<Job>(`/jobs/${id}`); }
  assets(archived = false, limit = 24, offset = 0, signal?: AbortSignal) {
    return this.request<Asset[]>(`/assets?namespace=nsfw&limit=${limit}&offset=${offset}&archived=${archived}`, { signal });
  }
  sourceAssets() { return this.request<Asset[]>("/assets?limit=100&archived=false"); }
  metadata(id: string) { return this.request<AssetMetadata>(`/assets/${id}/metadata`); }
  assetUrl(id: string) { return `${this.baseUrl}/assets/${id}/file`; }

  createJob(body: Record<string, unknown>) {
    return this.request<{ job_id: string; status: string }>("/jobs", {
      method: "POST", body: JSON.stringify(body),
    });
  }

  cancel(id: string) { return this.request<Job>(`/jobs/${id}/cancel`, { method: "POST" }); }
  retry(id: string) { return this.request<{ job_id: string }>(`/jobs/${id}/retry`, { method: "POST" }); }
  archive(id: string) { return this.request<Asset>(`/assets/${id}/archive`, { method: "POST" }); }
  restore(id: string) { return this.request<Asset>(`/assets/${id}/restore`, { method: "POST" }); }

  async destroy(id: string) {
    const response = await fetch(`${this.baseUrl}/assets/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.detail || response.statusText);
    }
  }

  async image(id: string) {
    const response = await fetch(this.assetUrl(id), { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new ApiError(response.status, "이미지 파일을 불러오지 못했습니다.");
    return URL.createObjectURL(await response.blob());
  }

  projects() { return this.request<PixelProject[]>("/projects"); }
  createProject(body: { name: string; art_bible: Record<string, unknown> }) {
    return this.request<PixelProject>("/projects", { method: "POST", body: JSON.stringify(body) });
  }
  updateProject(projectId: string, body: { name?: string; art_bible?: Record<string, unknown> }) {
    return this.request<PixelProject>(`/projects/${projectId}`, { method: "PUT", body: JSON.stringify(body) });
  }
  projectAssets(projectId: string, archived = false) { return this.request<PixelAsset[]>(`/projects/${projectId}/assets?archived=${archived}`); }
  createPixelAsset(projectId: string, body: { name: string; kind: PixelAsset["kind"]; source_asset_id: string }) {
    return this.request<PixelAsset>(`/projects/${projectId}/assets`, { method: "POST", body: JSON.stringify(body) });
  }
  processPixelAsset(id: string, body: { width: number; height: number; palette_colors: number; remove_solid_background: boolean; trim: boolean; center: boolean }) {
    return this.request<PixelVersion>(`/assets/${id}/process`, { method: "POST", body: JSON.stringify(body) });
  }
  approvePixelAsset(id: string, versionId: string) {
    return this.request<PixelAsset>(`/assets/${id}/approve?version_id=${encodeURIComponent(versionId)}`, { method: "POST" });
  }
  archivePixelAsset(id: string) { return this.request<PixelAsset>(`/pixel/assets/${id}/archive`, { method: "POST" }); }
  restorePixelAsset(id: string) { return this.request<PixelAsset>(`/pixel/assets/${id}/restore`, { method: "POST" }); }
  async destroyPixelAsset(id: string) {
    const response = await fetch(`${this.baseUrl}/pixel/assets/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.detail || response.statusText);
    }
  }
  async pixelImage(versionId: string) {
    const response = await fetch(`${this.baseUrl}/pixel/versions/${versionId}/file`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new ApiError(response.status, "픽셀 버전 파일을 불러오지 못했습니다.");
    return URL.createObjectURL(await response.blob());
  }
}
