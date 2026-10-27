"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, X } from "lucide-react";

import { AdminTable, ErrorCode, Pagination } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader, QueryState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys, type AdminJobRow } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { exactTime, money, relativeTime, shortId } from "@/lib/format";
import { useDebounce } from "@/hooks";

const SIZE = 25;

const STATUSES = ["", "queued", "running", "done", "failed", "canceled"];

function AdminJobs() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState(search.get("q") ?? "");
  const debouncedQ = useDebounce(q, 250);
  const [page, setPage] = useState(1);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminJobRow | null>(null);

  const params: Record<string, string> = { page: String(page), size: String(SIZE) };
  for (const key of ["status", "model", "user", "from", "to"]) {
    const value = search.get(key);
    if (value) params[key] = value;
  }
  if (search.get("canary") === "1") params.include_canary = "true";
  if (debouncedQ) params.q = debouncedQ;

  const jobsQuery = useQuery({
    queryKey: adminKeys.jobs(params),
    queryFn: () => adminApi.jobs(params),
  });

  const detailQuery = useQuery({
    queryKey: adminKeys.job(openJob ?? ""),
    queryFn: () => adminApi.job(openJob!),
    enabled: !!openJob,
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    setPage(1);
    router.replace(`/admin/jobs?${next.toString()}`);
  };

  const retry = async (job: AdminJobRow) => {
    try {
      const created = await adminApi.retryJob(job.job_id);
      toast.success("Job queued again", shortId(created.job_id, 8));
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error("Could not retry", friendlyError(error));
    }
  };

  const rows = jobsQuery.data?.data ?? [];
  const detail = detailQuery.data as Record<string, unknown> | undefined;

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Every job across all users. Canary jobs are hidden unless you include them."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="job-search">
          Search by job id
        </label>
        <input
          id="job-search"
          className="input w-48"
          placeholder="Job id…"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <label className="sr-only" htmlFor="job-status">
          Status
        </label>
        <select
          id="job-status"
          className="input w-auto"
          value={search.get("status") ?? ""}
          onChange={(event) => setFilter("status", event.target.value)}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status || "All statuses"}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="job-model">
          Model
        </label>
        <input
          id="job-model"
          className="input w-32"
          placeholder="model id"
          defaultValue={search.get("model") ?? ""}
          onBlur={(event) => setFilter("model", event.target.value)}
        />
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={search.get("canary") === "1"}
            onChange={(event) => setFilter("canary", event.target.checked ? "1" : "")}
          />
          Show canary jobs
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void jobsQuery.refetch()}>
          Refresh
        </button>
      </div>

      <QueryState
        isLoading={jobsQuery.isLoading}
        error={jobsQuery.error}
        isEmpty={!rows.length}
        empty="No jobs match these filters."
        onRetry={() => void jobsQuery.refetch()}
      />

      {rows.length ? (
        <>
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Model</th>
                  <th scope="col">User</th>
                  <th scope="col">Languages</th>
                  <th scope="col" className="text-right">
                    Cost
                  </th>
                  <th scope="col">Error</th>
                  <th scope="col">Created</th>
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => (
                  <tr key={job.job_id} className="cursor-pointer" onClick={() => setOpenJob(job.job_id)}>
                    <td>
                      <span className="mono text-xs">{shortId(job.job_id, 8)}</span>
                      {job.is_canary ? (
                        <span className="badge badge-info ml-1.5 text-[10px]">Canary</span>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="mono text-xs">{job.model}</td>
                    <td className="mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {shortId(job.user_id, 6)}
                    </td>
                    <td className="text-xs">
                      {job.source_lang.toUpperCase()} → {job.target_lang.toUpperCase()}
                    </td>
                    <td className="text-right">{money(job.cost)}</td>
                    <td>
                      <ErrorCode code={job.error_code} />
                    </td>
                    <td className="whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                      {relativeTime(job.created_at)}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {job.status === "failed" || job.status === "canceled" ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retry(job)}>
                            <RefreshCw size={12} /> Retry
                          </button>
                        ) : null}
                        {job.status === "queued" || job.status === "running" ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: "var(--danger)" }}
                            onClick={() => setCancelTarget(job)}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
          <Pagination page={page} size={SIZE} total={jobsQuery.data?.total ?? 0} onChange={setPage} />
        </>
      ) : null}

      {/* --- quick view drawer ---------------------------------------- */}
      {openJob ? (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Job quick view">
          <button
            type="button"
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.35)" }}
            aria-label="Close"
            onClick={() => setOpenJob(null)}
          />
          <aside
            className="relative flex h-full w-full max-w-[460px] flex-col overflow-y-auto border-l p-5"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="mono text-[15px]">{shortId(openJob, 10)}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {exactTime(String(detail?.created_at ?? ""))}
                </p>
              </div>
              <button type="button" onClick={() => setOpenJob(null)} className="rounded p-1" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {detailQuery.isLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-6 w-32" />
                <div className="skeleton h-40 w-full" />
              </div>
            ) : detail ? (
              <div className="space-y-4">
                <dl className="space-y-1.5 text-[13px]">
                  {[
                    ["Status", String(detail.status)],
                    ["Model", String(detail.model)],
                    ["Progress", `${Math.round(Number(detail.progress ?? 0) * 100)}%`],
                    ["Cost", money(Number(detail.cost ?? 0) || null)],
                    ["Error code", String(detail.error_code ?? "—")],
                    ["Attempts", String(detail.attempts ?? 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
                      <dd className="mono text-xs">{value}</dd>
                    </div>
                  ))}
                </dl>

                {detail.error ? (
                  <p className="text-xs" style={{ color: "var(--danger)" }}>
                    {String(detail.error)}
                  </p>
                ) : null}

                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Events</p>
                  <ul className="space-y-1.5 text-xs">
                    {((detail.events as { status: string; message: string | null; created_at: string }[]) ?? []).map(
                      (event, index) => (
                        <li key={index} className="flex gap-2">
                          <span className="mono w-14 shrink-0" style={{ color: "var(--text-faint)" }}>
                            {new Date(event.created_at).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span>
                            {event.status}
                            {event.message ? (
                              <span style={{ color: "var(--text-muted)" }}> — {event.message}</span>
                            ) : null}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>

                <div className="flex gap-2 pt-2">
                  <Link href={`/admin/jobs/${openJob}`} className="btn btn-secondary btn-sm">
                    Open full page <ExternalLink size={12} />
                  </Link>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this job?"
        description={`Job ${shortId(cancelTarget?.job_id ?? "", 8)} will stop. Running work is discarded.`}
        confirmLabel="Cancel job"
        danger
        onCancel={() => setCancelTarget(null)}
        onConfirm={async () => {
          if (!cancelTarget) return;
          try {
            await adminApi.cancelJob(cancelTarget.job_id);
            toast.success("Cancellation requested");
            setCancelTarget(null);
            await queryClient.invalidateQueries({ queryKey: ["admin"] });
          } catch (error) {
            toast.error("Could not cancel", friendlyError(error));
          }
        }}
      />
    </div>
  );
}

export default function AdminJobsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <AdminJobs />
    </Suspense>
  );
}