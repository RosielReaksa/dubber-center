"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

/** Typed admin client. All routes are under /v1/admin and role-checked server-side. */

export interface PageEnvelope<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
}

async function call<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  return request<T>(path, options);
}

export function apiUrl(path: string): string {
  return path;
}

export interface AdminOverview {
  window: { from: string; to: string; days: number };
  jobs_today: number;
  jobs_done: number;
  success_rate: number | null;
  active_jobs: number;
  queue_length: number;
  revenue: number;
  cost: number;
  margin: number;
  models_down: number;
  open_alerts: number;
  users: number;
  models: { id: string; name: string; health_state: string; health_since: string | null }[];
  recent_failures: {
    job_id: string;
    model: string;
    error: string | null;
    error_code: string | null;
    created_at: string;
  }[];
  needs_attention: {
    type: string;
    model: string | null;
    severity: string;
    message: string;
    link: string;
  }[];
}

export interface AdminModelRow {
  id: string;
  name: string;
  type: string;
  status: string;
  health_state: string;
  health_since: string | null;
  health_checked_at: string | null;
  price_per_minute: number;
  max_concurrent: number;
  queue_paused: boolean;
  success_rate_24h: number | null;
  jobs_24h: number;
}

export interface AdminJobRow {
  job_id: string;
  user_id: string;
  model: string;
  status: string;
  progress: number;
  source_lang: string;
  target_lang: string;
  cost: number | null;
  error: string | null;
  error_code: string | null;
  is_canary: boolean;
  attempts: number;
  created_at: string;
  finished_at: string | null;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  role: string;
  status: string;
  credits: number;
  created_at: string;
  last_seen_at: string | null;
  jobs: number;
}

export interface AdminKey {
  id: string;
  prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AdminAlert {
  id: number;
  type: string;
  severity: string;
  subject_type: string;
  subject_id: string | null;
  message: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export interface AdminWorker {
  worker_id: string;
  host: string;
  platform: string;
  model: string;
  job_id: string;
  at: string;
  online: boolean;
  age_sec: number;
}

export interface AdminQueueModel {
  model: string;
  name: string;
  health_state: string;
  queue_paused: boolean;
  waiting: number;
  running: number;
  max_concurrent: number;
  longest_wait_minutes: number | null;
}

export interface Timeseries {
  metric: string;
  group_by: string;
  points: { key: string; value: number }[];
}

export const adminApi = {
  overview: (days = 1) => call<AdminOverview>(`/v1/admin/overview?days=${days}`),
  timeseries: (metric: string, groupBy = "day", days = 30) =>
    call<Timeseries>(`/v1/admin/stats/timeseries?metric=${metric}&group_by=${groupBy}&days=${days}`),

  models: (params: Record<string, string>) =>
    call<PageEnvelope<AdminModelRow>>(`/v1/admin/models?${new URLSearchParams(params)}`),
  model: (id: string) => call<Record<string, unknown>>(`/v1/admin/models/${id}`),
  validateManifest: (yaml: string) =>
    call<{ valid: boolean; errors: string[]; preview?: Record<string, unknown> }>(
      "/v1/admin/models/validate-manifest",
      { method: "POST", body: { yaml } },
    ),
  saveModel: (yaml: string, id?: string) =>
    call<Record<string, unknown>>(id ? `/v1/admin/models/${id}` : "/v1/admin/models", {
      method: id ? "PUT" : "POST",
      body: { yaml },
    }),
  enableModel: (id: string) =>
    call<{ status: string }>(`/v1/admin/models/${id}/enable`, { method: "POST" }),
  disableModel: (id: string, dryRun: boolean) =>
    call<Record<string, unknown>>(
      `/v1/admin/models/${id}/disable?${dryRun ? "dry_run=true" : "confirm=true"}`,
      { method: "POST" },
    ),
  pauseQueue: (id: string) =>
    call<{ queue_paused: boolean }>(`/v1/admin/models/${id}/pause-queue`, { method: "POST" }),
  resumeQueue: (id: string) =>
    call<{ queue_paused: boolean }>(`/v1/admin/models/${id}/resume-queue`, { method: "POST" }),
  checkNow: (id: string) =>
    call<Record<string, unknown>>(`/v1/admin/models/${id}/check-now`, { method: "POST" }),
  testModel: (id: string) =>
    call<{ job_id: string; status: string }>(`/v1/admin/models/${id}/test`, {
      method: "POST",
      body: {},
    }),
  healthHistory: (id: string) =>
    call<{
      checks: {
        type: string;
        ok: boolean;
        latency_ms: number | null;
        error_code: string | null;
        detail: Record<string, unknown> | null;
        checked_at: string;
      }[];
      state_changes: { old_state: string; new_state: string; reason: string | null; created_at: string }[];
    }>(`/v1/admin/models/${id}/health-history`),

  jobs: (params: Record<string, string>) =>
    call<PageEnvelope<AdminJobRow>>(`/v1/admin/jobs?${new URLSearchParams(params)}`),
  job: (id: string) => call<Record<string, unknown>>(`/v1/admin/jobs/${id}`),
  jobLogs: (id: string) =>
    call<{ events: { status: string; message: string | null; detail: unknown; created_at: string }[] }>(
      `/v1/admin/jobs/${id}/logs`,
    ),
  retryJob: (id: string) =>
    call<{ job_id: string }>(`/v1/admin/jobs/${id}/retry`, { method: "POST" }),
  cancelJob: (id: string) =>
    call<{ cancel_requested: boolean }>(`/v1/admin/jobs/${id}/cancel`, { method: "POST" }),
  patchJob: (id: string, adminNotes: string) =>
    call<Record<string, unknown>>(`/v1/admin/jobs/${id}`, {
      method: "PATCH",
      body: { admin_notes: adminNotes },
    }),

  users: (params: Record<string, string>) =>
    call<PageEnvelope<AdminUserRow>>(`/v1/admin/users?${new URLSearchParams(params)}`),
  user: (id: string) => call<Record<string, unknown>>(`/v1/admin/users/${id}`),
  createUser: (body: Record<string, unknown>) =>
    call<Record<string, unknown>>("/v1/admin/users", { method: "POST", body }),
  patchUser: (id: string, body: Record<string, unknown>) =>
    call<AdminUserRow>(`/v1/admin/users/${id}`, { method: "PATCH", body }),
  addCredits: (id: string, amount: number, reason: string) =>
    call<{ balance: number }>(`/v1/admin/users/${id}/credits`, {
      method: "POST",
      body: { amount, reason },
    }),
  createKey: (id: string, name: string) =>
    call<{ key: string; prefix: string }>(`/v1/admin/users/${id}/keys`, {
      method: "POST",
      body: { name },
    }),
  revokeKey: (keyId: string, confirm: boolean) =>
    call<Record<string, unknown>>(
      `/v1/admin/keys/${keyId}?${confirm ? "confirm=true" : "dry_run=true"}`,
      { method: "DELETE" },
    ),

  usage: (params: Record<string, string>) =>
    call<{
      from_date: string;
      to_date: string;
      total_minutes: number;
      total_cost: number;
      total_jobs: number;
      by_day: { key: string; minutes: number; cost: number; jobs: number }[];
      by_model: { key: string; minutes: number; cost: number; jobs: number }[];
      by_user?: { user_id: string; minutes: number; cost: number; jobs: number }[];
    }>(`/v1/admin/usage?${new URLSearchParams(params)}`),

  queue: () => call<{ data: AdminQueueModel[] }>("/v1/admin/queue"),
  workers: () => call<{ data: AdminWorker[] }>("/v1/admin/workers"),
  sweepStuck: (dryRun: boolean) =>
    call<{ stuck: { job_id: string; model: string; age_minutes: number }[]; count: number; dry_run: boolean }>(
      `/v1/admin/jobs/sweep-stuck${dryRun ? "" : "?confirm=true"}`,
      { method: "POST", body: { dry_run: dryRun } },
    ),

  alerts: (params: Record<string, string>) =>
    call<PageEnvelope<AdminAlert>>(`/v1/admin/alerts?${new URLSearchParams(params)}`),
  resolveAlert: (id: number) =>
    call<{ status: string }>(`/v1/admin/alerts/${id}/resolve`, { method: "POST" }),

  settings: () =>
    call<{ data: { key: string; value: unknown; default: unknown }[] }>("/v1/admin/settings"),
  saveSettings: (values: Record<string, unknown>) =>
    call<{ updated: string[] }>("/v1/admin/settings", { method: "PUT", body: { values } }),

  audit: (params: Record<string, string>) =>
    call<
      PageEnvelope<{
        id: number;
        actor_user_id: string | null;
        action: string;
        target_type: string;
        target_id: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        ip: string | null;
        created_at: string;
      }>
    >(`/v1/admin/audit-log?${new URLSearchParams(params)}`),
};

export const adminKeys = {
  overview: (days: number) => queryKeys.admin("overview", days),
  timeseries: (metric: string, days: number) => queryKeys.admin("timeseries", metric, days),
  models: (params: Record<string, string>) => queryKeys.admin("models", params),
  model: (id: string) => queryKeys.admin("model", id),
  healthHistory: (id: string) => queryKeys.admin("health-history", id),
  jobs: (params: Record<string, string>) => queryKeys.admin("jobs", params),
  job: (id: string) => queryKeys.admin("job", id),
  users: (params: Record<string, string>) => queryKeys.admin("users", params),
  user: (id: string) => queryKeys.admin("user", id),
  usage: (params: Record<string, string>) => queryKeys.admin("usage", params),
  queue: () => queryKeys.admin("queue"),
  workers: () => queryKeys.admin("workers"),
  alerts: (params: Record<string, string>) => queryKeys.admin("alerts", params),
  settings: () => queryKeys.admin("settings"),
  audit: (params: Record<string, string>) => queryKeys.admin("audit", params),
};

export { useQuery };