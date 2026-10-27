"use client";

import { AlertTriangle, Check, Minus, X } from "lucide-react";

import { exactTime, percent, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HealthState, UptimeDay } from "@/lib/api/client";

/** frontend plan 5.11 — status is always text + icon, never color alone. */

export const HEALTH_META: Record<
  HealthState,
  { label: string; tooltip: string; color: string; soft: string; icon: React.ReactNode }
> = {
  healthy: {
    label: "Healthy",
    tooltip: "Working normally.",
    color: "var(--success)",
    soft: "var(--success-soft)",
    icon: <Check size={11} strokeWidth={3} />,
  },
  degraded: {
    label: "Degraded",
    tooltip: "Working but slower or less reliable than usual.",
    color: "var(--warning)",
    soft: "var(--warning-soft)",
    icon: <AlertTriangle size={11} strokeWidth={2.5} />,
  },
  down: {
    label: "Unavailable",
    tooltip: "Not accepting new jobs right now.",
    color: "var(--danger)",
    soft: "var(--danger-soft)",
    icon: <X size={11} strokeWidth={3} />,
  },
  unknown: {
    label: "No data",
    tooltip: "Not enough data yet.",
    color: "var(--text-faint)",
    soft: "var(--surface-2)",
    icon: <Minus size={11} strokeWidth={3} />,
  },
};

export function StatusDot({
  state,
  size = "sm",
  showLabel = true,
  since,
  checkedAt,
  beta,
  disabled,
  className,
}: {
  state: HealthState;
  size?: "sm" | "md";
  showLabel?: boolean;
  since?: string | null;
  checkedAt?: string | null;
  beta?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const effective: HealthState = disabled ? "unknown" : state;
  const meta = HEALTH_META[effective];

  const tooltipParts = [disabled ? "This model is disabled." : meta.tooltip];
  if (since) tooltipParts.push(`Since ${exactTime(since)}.`);
  if (checkedAt) tooltipParts.push(`Checked ${relativeTime(checkedAt)}.`);

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={tooltipParts.join(" ")}
    >
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: size === "md" ? 16 : 14,
          height: size === "md" ? 16 : 14,
          background: meta.soft,
          color: meta.color,
        }}
      >
        {meta.icon}
      </span>
      {showLabel ? (
        <span
          className={cn("font-medium", size === "md" ? "text-[13px]" : "text-xs")}
          style={{ color: disabled ? "var(--text-faint)" : "var(--text)" }}
        >
          {disabled ? "Disabled" : meta.label}
        </span>
      ) : null}
      {beta && !disabled ? <span className="badge badge-neutral text-[10px]">Beta</span> : null}
    </span>
  );
}

export function UptimeBar({
  days,
  uptime,
  showPercent = true,
}: {
  days: UptimeDay[];
  uptime?: number | null;
  showPercent?: boolean;
}) {
  // Always 30 blocks so the bar never changes height while loading (5.11).
  const cells: (UptimeDay | null)[] = Array.from({ length: 30 }, (_, index) => {
    const start = 30 - days.length;
    return index < start ? null : (days[index - start] ?? null);
  });

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-6 items-end gap-[2px]" role="img" aria-label="Uptime for the last 30 days">
        {cells.map((day, index) => {
          if (!day) {
            return (
              <span
                key={index}
                className="skeleton h-5 w-[6px] rounded-[2px]"
                style={{ opacity: 0.5 }}
              />
            );
          }
          const color =
            day.state === "down"
              ? "var(--danger)"
              : day.state === "degraded"
                ? "var(--warning)"
                : "var(--success)";
          return (
            <span
              key={day.date}
              className="h-5 w-[6px] rounded-[2px] transition-opacity hover:opacity-70"
              style={{ background: color }}
              title={`${day.date} · ${day.state} · ${
                day.uptime === null ? "no data" : percent(day.uptime, 2)
              } uptime`}
            />
          );
        })}
      </div>
      {showPercent ? (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {uptime === null || uptime === undefined ? "—" : percent(uptime)} uptime
        </span>
      ) : null}
    </div>
  );
}

export function StatusBanner({
  state,
  modelId,
  action,
}: {
  state: HealthState;
  modelId: string;
  action?: React.ReactNode;
}) {
  if (state === "healthy" || state === "unknown") return null;

  const down = state === "down";
  return (
    <div
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
      style={{
        background: down ? "var(--danger-soft)" : "var(--warning-soft)",
        borderColor: down ? "var(--danger)" : "var(--warning)",
      }}
      role="status"
    >
      <p className="text-[13px]" style={{ color: down ? "var(--danger)" : "var(--warning)" }}>
        {down
          ? `${modelId} is unavailable right now.`
          : `This model is slower than usual. Estimated time is longer.`}
      </p>
      {action}
    </div>
  );
}

export function IncidentList({
  incidents,
}: {
  incidents: {
    started_at: string;
    ended_at: string | null;
    state: HealthState;
    summary: string;
  }[];
}) {
  if (!incidents.length) {
    return (
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        No incidents in the last 30 days.
      </p>
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
      {incidents.map((incident, index) => {
        const durationLabel =
          incident.ended_at && incident.started_at
            ? `${Math.max(
                1,
                Math.round(
                  (new Date(incident.ended_at).getTime() -
                    new Date(incident.started_at).getTime()) /
                    60000,
                ),
              )} min`
            : "ongoing";
        return (
          <li key={`${incident.started_at}-${index}`} className="flex items-center gap-3 py-2.5">
            <span className="w-16 shrink-0 text-xs" style={{ color: "var(--text-faint)" }}>
              {new Date(incident.started_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <StatusDot state={incident.state} showLabel={false} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{incident.summary}</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {durationLabel}
            </span>
            <span
              className="badge"
              style={{
                background: incident.ended_at ? "var(--success-soft)" : "var(--warning-soft)",
                color: incident.ended_at ? "var(--success)" : "var(--warning)",
              }}
            >
              {incident.ended_at ? "Resolved" : "Ongoing"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    queued: { label: "Queued", className: "badge-neutral" },
    running: { label: "Running", className: "badge-info" },
    done: { label: "Done", className: "badge-success" },
    failed: { label: "Failed", className: "badge-danger" },
    canceled: { label: "Canceled", className: "badge-neutral" },
  };
  const entry = map[status] ?? { label: status, className: "badge-neutral" };
  return <span className={cn("badge", entry.className)}>{entry.label}</span>;
}