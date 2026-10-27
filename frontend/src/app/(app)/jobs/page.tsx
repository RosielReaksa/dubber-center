"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status";
import { api, type Job } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useDocumentVisible } from "@/hooks";
import { duration, money, relativeTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function ActivityTable() {
  const router = useRouter();
  const search = useSearchParams();

  const status = search.get("status") ?? "";
  const model = search.get("model") ?? "";
  const page = Math.max(1, Number(search.get("page") ?? 1));
  const [pending, setPending] = useState(false);
  const visible = useDocumentVisible();

  const params = useMemo(() => {
    const next: Record<string, string> = { page: String(page), size: String(PAGE_SIZE) };
    if (status) next.status = status;
    if (model) next.model = model;
    return next;
  }, [status, model, page]);

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs(params),
    queryFn: () => api.jobs(params),
    refetchInterval: (query) => {
      // Poll while anything is still moving; pause when the tab is hidden.
      const rows = query.state.data?.data ?? [];
      const active = rows.some((job) => job.status === "queued" || job.status === "running");
      return active && visible ? 5000 : false;
    },
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.replace(`/jobs?${next.toString()}`, { scroll: false });
  };

  const jobs = jobsQuery.data?.data ?? [];
  const total = jobsQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const models = useMemo(() => {
    const seen = new Map<string, string>();
    for (const job of jobs) seen.set(job.model, job.model_name ?? job.model);
    return [...seen.entries()];
  }, [jobs]);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Every job you have started, newest first."
        actions={
          <Link href="/dub" className="btn btn-primary">
            New job
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="status-filter">
          Status
        </label>
        <select
          id="status-filter"
          className="input w-auto"
          value={status}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
        </select>

        {models.length ? (
          <>
            <label className="sr-only" htmlFor="model-filter">
              Model
            </label>
            <select
              id="model-filter"
              className="input w-auto"
              value={model}
              onChange={(event) => setParam("model", event.target.value)}
            >
              <option value="">All models</option>
              {models.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {status || model ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => router.replace("/jobs")}
          >
            Clear filters
          </button>
        ) : null}

        <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
          {pending ? "Loading…" : `${total} ${total === 1 ? "job" : "jobs"}`}
        </span>
      </div>

      <div className="card overflow-hidden">
        {jobsQuery.isLoading ? <Skeleton className="h-40" /> : null}
        {jobsQuery.error ? <ErrorState description="Could not load activity." onRetry={() => void jobsQuery.refetch()} /> : null}
        {!jobsQuery.isLoading && !jobsQuery.error && !jobs.length ? (
          <EmptyState title={status || model ? "No jobs match these filters" : "No jobs yet"} description={status || model ? "Try clearing the filters to see everything." : "Start your first dub to see it here."} action={<Link href="/dub" className="btn btn-primary">Dub a video</Link>} />
        ) : null}

        {jobs.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Model</th>
                  <th scope="col">Languages</th>
                  <th scope="col">Length</th>
                  <th scope="col" className="text-right">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <JobRow key={job.job_id} job={job} onOpen={() => router.push(`/jobs/${job.job_id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setParam("page", String(page - 1))}
          >
            Previous
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= pages}
            onClick={() => setParam("page", String(page + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function JobRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  return (
    <tr
      className="cursor-pointer"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`Job ${shortId(job.job_id)}, ${job.status}`}
    >
      <td>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          {job.status === "running" ? (
            <span className="mono text-xs" style={{ color: "var(--text-muted)" }}>
              {Math.round(job.progress * 100)}%
            </span>
          ) : null}
        </div>
      </td>
      <td>
        <span title={new Date(job.created_at).toLocaleString()}>
          {relativeTime(job.created_at)}
        </span>
        <span className="mono ml-2 text-xs" style={{ color: "var(--text-faint)" }}>
          {shortId(job.job_id, 6)}
        </span>
      </td>
      <td>
        <span className="mono text-xs">{job.model}</span>
      </td>
      <td>
        {job.source_lang.toUpperCase()} → {job.target_lang.toUpperCase()}
      </td>
      <td>{job.minutes === null ? "—" : duration((job.minutes ?? 0) * 60)}</td>
      <td className="text-right">{job.cost === null ? "—" : money(job.cost)}</td>
    </tr>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <ActivityTable />
    </Suspense>
  );
}