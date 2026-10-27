/**
 * Typed-ish API client for the public/consumer endpoints.
 * Generated types come from the backend OpenAPI file in F4; until then these
 * interfaces mirror `src/dubber_center/schemas/models.py`.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type HealthState = "healthy" | "degraded" | "down" | "unknown";
export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface LanguageSet {
  source: string[];
  target: string[];
}

export interface Model {
  id: string;
  name: string;
  description: string | null;
  type: "api" | "local" | "hybrid";
  status: "active" | "beta" | "disabled";
  version: number;
  languages: LanguageSet;
  price_per_minute: number;
  max_video_minutes: number;
  max_concurrent: number;
  features: string[];
  health_state: HealthState;
  health_since: string | null;
  health_checked_at: string | null;
  success_rate_24h: number | null;
  avg_duration_sec: number | null;
  uptime_30d: number | null;
}

export interface ModelList {
  data: Model[];
  total: number;
  languages: LanguageSet;
}

export interface JobOutput {
  video_url?: string | null;
  audio_url?: string | null;
  subtitles_url?: string | null;
  timing_json_url?: string | null;
}

export interface Job {
  job_id: string;
  status: JobStatus;
  progress: number;
  stage: string | null;
  model: string;
  model_name: string | null;
  source_lang: string;
  target_lang: string;
  minutes: number | null;
  estimate_cost: number | null;
  cost: number | null;
  output: JobOutput | null;
  error: string | null;
  error_code: string | null;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  events?: { status: string; message: string | null; created_at: string }[];
  options?: Record<string, unknown>;
  attempts?: number;
}

export interface JobList {
  data: Job[];
  total: number;
  page: number;
  size: number;
}

export interface DubRequest {
  model: string;
  video_url?: string;
  file_id?: string;
  source_lang: string;
  target_lang: string;
  minutes?: number;
  webhook_url?: string;
  options?: {
    subtitles?: boolean;
    keep_background_audio?: boolean;
    multi_speaker?: boolean;
  };
}

export interface DubResponse {
  job_id: string;
  status: JobStatus;
  model: string;
  estimated_cost: number;
  minutes: number | null;
}

export interface FileTicket {
  file_id: string;
  storage_key: string;
  upload_url: string;
  upload_method: string;
  content_type: string | null;
}

export interface UsageBucket {
  key: string;
  minutes: number;
  cost: number;
  jobs: number;
}

export interface Usage {
  from_date: string;
  to_date: string;
  total_minutes: number;
  total_cost: number;
  total_jobs: number;
  by_day: UsageBucket[];
  by_model: UsageBucket[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Plain-language text for the error codes users can actually hit. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const map: Record<string, string> = {
      model_unavailable: "This model is unavailable right now. Try another model or wait a moment.",
      model_disabled: "This model is disabled.",
      language_not_supported: "This model does not support that language pair. Pick another model.",
      video_too_long: "The video is longer than this model allows. Choose a shorter video.",
      insufficient_credits: "You are out of credits. Add credits to start a new job.",
      invalid_file_type: "That file type is not supported. Use mp4, mov, mkv or webm.",
      file_too_large: "That file is larger than the upload limit.",
      unauthorized: "Please sign in again.",
      forbidden: "You do not have access to this action.",
      not_found: "That item could not be found.",
      rate_limited: "Too many requests. Wait a moment and try again.",
    };
    return map[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  token?: string | null;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, token, headers, ...rest } = options;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    let code = "unknown";
    let message = `Request failed (${response.status}).`;
    let details: Record<string, unknown> | undefined;
    try {
      const parsed = (await response.json()) as ApiErrorBody;
      if (parsed.error) {
        code = parsed.error.code;
        message = parsed.error.message;
        details = parsed.error.details;
      }
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(message, code, response.status, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  // --- public ---------------------------------------------------------
  models: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return request<ModelList>(`/v1/models${query}`);
  },
  model: (id: string) => request<Model>(`/v1/models/${id}`),
  modelStatus: (id: string) => request<ModelStatus>(`/v1/models/${id}/status`),
  status: () => request<PublicStatus>("/v1/status"),

  // --- jobs -----------------------------------------------------------
  createJob: (payload: DubRequest, token?: string | null) =>
    request<DubResponse>("/v1/dub", { method: "POST", body: payload, token }),
  jobs: (params?: Record<string, string>, token?: string | null) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return request<JobList>(`/v1/jobs${query}`, { token });
  },
  job: (id: string, token?: string | null) => request<Job>(`/v1/jobs/${id}`, { token }),
  cancelJob: (id: string, token?: string | null) =>
    request<{ job_id: string; status: JobStatus }>(`/v1/jobs/${id}/cancel`, {
      method: "POST",
      token,
    }),

  // --- files ----------------------------------------------------------
  createFile: (payload: { filename: string; content_type: string; size?: number }, token?: string | null) =>
    request<FileTicket>("/v1/files", { method: "POST", body: payload, token }),

  // --- usage ----------------------------------------------------------
  usage: (params?: Record<string, string>, token?: string | null) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return request<Usage>(`/v1/usage${query}`, { token });
  },

  // --- auth -----------------------------------------------------------
  me: (token?: string | null) => request<Me>("/v1/auth/me", { token }),
  login: (email: string, password: string) =>
    request<Me>("/v1/auth/login", { method: "POST", body: { email, password } }),
  signup: (email: string, password: string, name?: string) =>
    request<Me>("/v1/auth/signup", { method: "POST", body: { email, password, name } }),
  logout: () => request<{ message: string }>("/v1/auth/logout", { method: "POST" }),
};

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "support" | "admin" | "owner";
  plan: string;
  credits: number;
  status: string;
}

export interface UptimeDay {
  date: string;
  state: HealthState;
  uptime: number | null;
}

export interface Incident {
  started_at: string;
  ended_at: string | null;
  state: HealthState;
  summary: string;
}

export interface ModelStatus {
  model: string;
  name: string;
  configured_status: string;
  health_state: HealthState;
  health_since: string | null;
  checked_at: string | null;
  uptime_30d: number | null;
  daily: UptimeDay[];
  incidents: Incident[];
}

export interface PublicStatus {
  all_ok: boolean;
  incidents: {
    model: string;
    state: HealthState;
    started_at: string | null;
    ended_at: string | null;
    summary: string;
  }[];
  models: {
    id: string;
    name: string;
    configured_status: string;
    health_state: HealthState;
    health_since: string | null;
    checked_at: string | null;
    summary: string;
    uptime_30d: number | null;
  }[];
}
