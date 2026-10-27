"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, X } from "lucide-react";

import { AdminSection, AdminTable, ErrorCode } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CopyButton } from "@/components/common/copy-button";
import { PageHeader, Skeleton } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { adminApi } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { exactTime, money, relativeTime } from "@/lib/format";

export default function AdminJobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const toast = useToast();
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["admin", "job-detail", jobId],
    queryFn: () => adminApi.job(jobId),
  });

  const logsQuery = useQuery({
    queryKey: ["admin", "job-logs", jobId],
    queryFn: () => adminApi.jobLogs(jobId),
  });

  const [notes, setNotes] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const job = jobQuery.data as Record<string, unknown> | undefined;

  if (jobQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) {
    return <p style={{ color: "var(--danger)" }}>{friendlyError(jobQuery.error)}</p>;
  }

  const output = (job.output ?? {}) as Record<string, string | null>;
  const events = (job.events as { status: string; message: string | null; created_at: string }[]) ?? [];
  const running = job.status === "queued" || job.status === "running";

  const saveNotes = async () => {
    if (notes === null) return;
    setSavingNotes(true);
    try {
      await adminApi.patchJob(jobId, notes);
      toast.success("Notes saved");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error("Could not save notes", friendlyError(error));
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div>
      <Link href="/admin/jobs" className="mb-3 inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
        <ArrowLeft size={14} /> Jobs
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="mono text-xl">{String(job.job_id)}</span>
            <CopyButton value={String(job.job_id)} label="Copy" />
            <StatusBadge status={String(job.status)} />
          </span>
        }
        description={`${String(job.model)} · ${String(job.source_lang).toUpperCase()} → ${String(
          job.target_lang,
        ).toUpperCase()} · created ${exactTime(String(job.created_at))}`}
        actions={
          <>
            {String(job.status) === "failed" || String(job.status) === "canceled" ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    const created = await adminApi.retryJob(jobId);
                    toast.success("Retry queued", created.job_id);
                  } catch (error) {
                    toast.error("Could not retry", friendlyError(error));
                  }
                }}
              >
                <RefreshCw size={14} /> Retry
              </button>
            ) : null}
            {running ? (
              <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
                <X size={14} /> Cancel
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSection title="Summary">
          <div className="card card-pad">
            <dl className="space-y-2 text-[13px]">
              {[
                ["User", String(job.user_id)],
                ["Progress", `${Math.round(Number(job.progress ?? 0) * 100)}%`],
                ["Stage", String(job.stage ?? "—")],
                ["Attempts", String(job.attempts ?? 0)],
                ["Estimated cost", money(Number(job.estimate_cost ?? 0) || null)],
                ["Final cost", money(Number(job.cost ?? 0) || null)],
                ["Minutes", job.minutes === null || job.minutes === undefined ? "—" : String(job.minutes)],
                ["Started", job.started_at ? exactTime(String(job.started_at)) : "—"],
                ["Finished", job.finished_at ? exactTime(String(job.finished_at)) : "—"],
                ["Webhook", String(job.webhook_url ?? "—")],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
                  <dd className="mono max-w-[60%] truncate text-right text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </AdminSection>

        <AdminSection title="Error and details">
          <div className="card card-pad">
            {job.error ? (
              <>
                <p className="text-[13px]" style={{ color: "var(--danger)" }}>
                  {String(job.error)}
                </p>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  error_code: <ErrorCode code={String(job.error_code ?? "")} /> · kind:{" "}
                  {String(job.error_kind ?? "—")}
                </p>
              </>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                No error recorded.
              </p>
            )}
            {Object.keys(output).length ? (
              <div className="mt-4">
                <p className="mb-1.5 text-[13px] font-medium">Files</p>
                <ul className="space-y-1 text-xs">
                  {Object.entries(output).map(([key, url]) =>
                    url ? (
                      <li key={key}>
                        <a href={url} className="underline" style={{ color: "var(--accent)" }} target="_blank" rel="noreferrer">
                          {key}
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        </AdminSection>

        <AdminSection title="Timeline">
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => (
                  <tr key={index}>
                    <td className="whitespace-nowrap text-xs" title={exactTime(event.created_at)}>
                      {relativeTime(event.created_at)}
                    </td>
                    <td className="text-xs">{event.status}</td>
                    <td className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {event.message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
        </AdminSection>

        <AdminSection title="Logs">
          <div className="card p-3">
            <pre className="mono max-h-[280px] overflow-auto text-[11px] leading-relaxed">
              {(logsQuery.data?.events ?? [])
                .map(
                  (event) =>
                    `${event.created_at}  ${event.status.padEnd(12)}  ${event.message ?? ""}${
                      event.detail ? "  " + JSON.stringify(event.detail) : ""
                    }`,
                )
                .join("\n") || "No log lines."}
            </pre>
          </div>
        </AdminSection>
      </div>

      <section className="mt-4">
        <AdminSection title="Admin notes" description="Visible to staff only. Saved to the audit log.">
          <div className="card card-pad">
            <textarea
              className="input min-h-[96px] w-full py-2"
              value={notes ?? String(job.admin_notes ?? "")}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What did you find?"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={notes === null || savingNotes}
                onClick={() => void saveNotes()}
              >
                {savingNotes ? "Saving…" : "Save notes"}
              </button>
            </div>
          </div>
        </AdminSection>
      </section>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this job?"
        description="The worker stops at the next poll. The user is not charged."
        confirmLabel="Cancel job"
        danger
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          try {
            await adminApi.cancelJob(jobId);
            toast.success("Cancellation requested");
            setCancelOpen(false);
            await jobQuery.refetch();
          } catch (error) {
            toast.error("Could not cancel", friendlyError(error));
          }
        }}
      />
    </div>
  );
}