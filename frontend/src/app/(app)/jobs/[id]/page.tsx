"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Circle,
  Download,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CopyButton } from "@/components/common/copy-button";
import { ErrorState, InlineSpinner, Skeleton } from "@/components/common/states";
import { StatusBadge, StatusDot } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { api, ApiError, friendlyError, type Job } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { duration, exactTime, minutes as fmtMinutes, money, relativeTime, shortId } from "@/lib/format";
import { useDocumentVisible } from "@/hooks";
import { cn } from "@/lib/utils";

const FINAL = new Set(["done", "failed", "canceled"]);

/** Stages from the model's progress messages; fall back to percentage only. */
function stageList(job: Job): { label: string; status: "done" | "active" | "pending" }[] {
  const events = job.events ?? [];
  const reached = new Set(events.map((event) => event.status));
  const stages = ["queued", "running", "done"];

  const labels: Record<string, string> = {
    queued: "Queued",
    running: job.stage ?? "Processing",
    done: "Finished",
  };

  return stages.map((stage, index) => {
    let status: "done" | "active" | "pending" = "pending";
    if (job.status === "done") status = "done";
    else if (reached.has(stage) && stage !== job.status) status = "done";
    else if (stage === job.status) status = "active";
    // failed/canceled stops the chain at the current stage
    if ((job.status === "failed" || job.status === "canceled") && index > 0 && stage === "done") {
      status = "pending";
    }
    return { label: labels[stage] ?? stage, status };
  });
}

export default function JobPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();

  const pollCount = useRef(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const jobQuery = useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => api.job(jobId),
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job || FINAL.has(job.status)) return false;
      if (!visible) return false;
      pollCount.current += 1;
      // 2s at first, slowing to 10s once the job has been running a while.
      return pollCount.current > 20 ? 10_000 : 2_000;
    },
  });

  const job = jobQuery.data;

  // Reset the backoff whenever a different job is opened.
  useEffect(() => {
    pollCount.current = 0;
  }, [jobId]);

  const cancel = useCallback(async () => {
    setCancelBusy(true);
    try {
      await api.cancelJob(jobId);
      toast.success("Cancellation requested");
      setCancelOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
    } catch (error) {
      toast.error("Could not cancel", friendlyError(error));
    } finally {
      setCancelBusy(false);
    }
  }, [jobId, queryClient, toast]);

  const retry = useCallback(() => {
    // We do not re-send the video automatically: a retry must use the same file,
    // and the studio is where the source can be reattached. Prefill what we know.
    if (job) {
      try {
        window.localStorage.setItem(
          "dc-last-dub",
          JSON.stringify({
            model: job.model,
            source: job.source_lang,
            target: job.target_lang,
          }),
        );
      } catch {
        /* storage blocked */
      }
    }
    router.push(`/dub?model=${job?.model ?? ""}`);
  }, [job, router]);

  if (jobQuery.isLoading) return <JobSkeleton />;

  if (jobQuery.error) {
    return (
      <ErrorState
        title="Could not load this job"
        description={friendlyError(jobQuery.error)}
        onRetry={() => void jobQuery.refetch()}
      />
    );
  }

  if (!job) return null;

  const running = job.status === "queued" || job.status === "running";
  const percent = Math.round(job.progress * 100);
  const downloads = [
    { label: "Video", url: job.output?.video_url },
    { label: "Audio", url: job.output?.audio_url },
    { label: "Subtitles (.srt)", url: job.output?.subtitles_url },
    { label: "Timing JSON", url: job.output?.timing_json_url },
  ].filter((item) => !!item.url);

  return (
    <div>
      <Link
        href="/jobs"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        <ArrowLeft size={14} /> Activity
      </Link>

      {/* --- header -------------------------------------------------- */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="mono text-xl">{shortId(job.job_id, 10)}</h1>
            <CopyButton value={job.job_id} label="Copy id" />
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
            {job.model_name ?? job.model}
            {" · "}
            {job.source_lang.toUpperCase()} → {job.target_lang.toUpperCase()}
            {" · "}
            <span title={exactTime(job.created_at)}>{relativeTime(job.created_at)}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {running ? (
            <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
              Cancel job
            </button>
          ) : null}
          {job.status === "failed" || job.status === "canceled" ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => void retry()}>
                <RefreshCw size={14} /> Retry
              </button>
              <Link href={`/dub?model=${job.model}`} className="btn btn-primary">
                Try another model
              </Link>
            </>
          ) : null}
        </div>
      </header>

      {/* --- progress ------------------------------------------------ */}
      {running ? (
        <section className="card card-pad mb-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="font-medium">
              {job.stage ?? (job.status === "queued" ? "Waiting to start" : "Processing")}
            </span>
            <span className="mono" style={{ color: "var(--text-muted)" }}>
              {percent}%
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full"
            style={{ background: "var(--surface-2)" }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(percent, 2)}%`, background: "var(--accent)" }}
            />
          </div>
          <ol className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            {stageList(job).map((stage) => (
              <li key={stage.label} className="flex items-center gap-1.5 text-xs">
                {stage.status === "done" ? (
                  <Check size={12} style={{ color: "var(--success)" }} aria-hidden />
                ) : stage.status === "active" ? (
                  <Loader2 size={12} className="animate-spin" style={{ color: "var(--accent)" }} aria-hidden />
                ) : (
                  <Circle size={9} style={{ color: "var(--text-faint)" }} aria-hidden />
                )}
                <span
                  style={{
                    color:
                      stage.status === "pending" ? "var(--text-faint)" : "var(--text)",
                    fontWeight: stage.status === "active" ? 500 : 400,
                  }}
                >
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* --- done ---------------------------------------------------- */}
      {job.status === "done" ? (
        <section className="mb-5">
          <div className="grid gap-4 md:grid-cols-2">
            <VideoPanel
              title="Original"
              note="The uploaded source video is not kept for playback after processing."
            />
            <VideoPanel title="Dubbed" src={job.output?.video_url ?? null} accent />
          </div>

          {downloads.length ? (
            <div className="card card-pad mt-4">
              <h2 className="mb-3 text-[13px] font-medium">Downloads</h2>
              <div className="flex flex-wrap gap-2">
                {downloads.map((item) => (
                  <a
                    key={item.label}
                    href={item.url ?? "#"}
                    className="btn btn-secondary"
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={14} /> {item.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* --- failed -------------------------------------------------- */}
      {job.status === "failed" ? (
        <section
          className="card card-pad mb-5"
          style={{ borderColor: "var(--danger)", background: "var(--danger-soft)" }}
        >
          <div className="flex items-start gap-2.5">
            <X size={16} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-medium" style={{ color: "var(--danger)" }}>
                This job could not finish
              </p>
              <p className="mt-1 text-[13px]">{job.error ?? "The model stopped without a reason."}</p>
              <details className="mt-2.5">
                <summary className="cursor-pointer text-xs" style={{ color: "var(--text-muted)" }}>
                  Technical details
                </summary>
                <p className="mono mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  error_code: {job.error_code ?? "unknown"} · attempts: {job.attempts ?? 0}
                </p>
              </details>
            </div>
          </div>
        </section>
      ) : null}

      {job.status === "canceled" ? (
        <section className="card card-pad mb-5">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            This job was canceled. Nothing was charged for it.
          </p>
        </section>
      ) : null}

      {/* --- details + timeline -------------------------------------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-3 text-[13px] font-medium">Details</h2>
          <dl className="space-y-2 text-[13px]">
            <Row label="Status" value={<StatusBadge status={job.status} />} />
            <Row label="Model" value={<span className="mono">{job.model}</span>} />
            <Row label="Languages" value={`${job.source_lang.toUpperCase()} → ${job.target_lang.toUpperCase()}`} />
            <Row label="Video length" value={job.minutes === null ? "—" : fmtMinutes(job.minutes)} />
            <Row label="Estimated cost" value={money(job.estimate_cost)} />
            <Row label="Final cost" value={money(job.cost)} />
            <Row label="Created" value={exactTime(job.created_at)} />
            {job.started_at ? <Row label="Started" value={exactTime(job.started_at)} /> : null}
            {job.finished_at ? <Row label="Finished" value={exactTime(job.finished_at)} /> : null}
          </dl>
        </section>

        <section className="card card-pad">
          <h2 className="mb-3 text-[13px] font-medium">Timeline</h2>
          <ol className="space-y-2.5">
            {(job.events ?? []).map((event, index) => (
              <li key={`${event.created_at}-${index}`} className="flex gap-2.5 text-[13px]">
                <span className="mono w-14 shrink-0 text-xs" style={{ color: "var(--text-faint)" }}>
                  {new Date(event.created_at).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{event.status}</span>
                  {event.message ? (
                    <span style={{ color: "var(--text-muted)" }}> — {event.message}</span>
                  ) : null}
                </span>
              </li>
            ))}
            {!(job.events ?? []).length ? (
              <li className="text-xs" style={{ color: "var(--text-muted)" }}>
                No events yet.
              </li>
            ) : null}
          </ol>
          {running ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
              <InlineSpinner label="Updating live" />
            </p>
          ) : null}
        </section>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this job?"
        description={`Job ${shortId(job.job_id, 10)} on ${job.model} will stop. Running work is discarded and you are not charged.`}
        confirmLabel="Cancel job"
        danger
        busy={cancelBusy}
        onCancel={() => setCancelOpen(false)}
        onConfirm={() => void cancel()}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function VideoPanel({
  title,
  src,
  note,
  accent,
}: {
  title: string;
  src?: string | null;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div
        className="flex items-center justify-between border-b px-3 py-2 text-xs"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      >
        <span className="font-medium">{title}</span>
        {accent ? <span className="badge badge-accent">Dubbed</span> : null}
      </div>
      {src ? (
        <video
          controls
          preload="metadata"
          src={src}
          className="aspect-video w-full bg-black"
          aria-label={`${title} video`}
        />
      ) : (
        <div
          className="flex aspect-video items-center justify-center px-6 text-center text-xs"
          style={{ background: "var(--surface-2)", color: "var(--text-faint)" }}
        >
          {note ?? "Not available"}
        </div>
      )}
    </div>
  );
}

function JobSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}