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

export type AssetMetadata = {
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

  status() { return this.request<SystemStatus>("/system/status"); }
  models() { return this.request<StudioModel[]>("/models"); }
  jobs(limit = 20, offset = 0) { return this.request<Job[]>(`/jobs?limit=${limit}&offset=${offset}`); }
  job(id: string) { return this.request<Job>(`/jobs/${id}`); }
  assets(archived = false, limit = 24, offset = 0) {
    return this.request<Asset[]>(`/assets?namespace=nsfw&limit=${limit}&offset=${offset}&archived=${archived}`);
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
