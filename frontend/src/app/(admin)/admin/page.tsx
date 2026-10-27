"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink } from "lucide-react";

import {
  AdminSection,
  AdminTable,
  ErrorCode,
  KpiCard,
  KpiRow,
} from "@/components/admin/kpi-card";
import { PageHeader, QueryState, Skeleton } from "@/components/common/states";
import { StatusDot } from "@/components/common/status";
import { adminApi, adminKeys, type AdminOverview } from "@/lib/api/admin";
import { money, percent, relativeTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

export default function AdminOverviewPage() {
  const [days, setDays] = useState(1);

  const overviewQuery = useQuery({
    queryKey: adminKeys.overview(days),
    queryFn: () => adminApi.overview(days),
    refetchInterval: 30_000,
  });

  const jobsSeries = useQuery({
    queryKey: adminKeys.timeseries("jobs", days),
    queryFn: () => adminApi.timeseries("jobs", "day", days),
  });

  const revenueSeries = useQuery({
    queryKey: adminKeys.timeseries("revenue", days),
    queryFn: () => adminApi.timeseries("revenue", "day", days),
  });

  const costSeries = useQuery({
    queryKey: adminKeys.timeseries("cost", days),
    queryFn: () => adminApi.timeseries("cost", "day", days),
  });

  const data = overviewQuery.data;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="What needs attention first, then today's numbers."
        actions={
          <div className="inline-flex rounded-sm border p-0.5" style={{ borderColor: "var(--border)" }}>
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
                className="rounded px-2.5 py-1 text-xs"
                style={{
                  background: days === range.days ? "var(--accent-soft)" : "transparent",
                  color: days === range.days ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: days === range.days ? 500 : 400,
                }}
              >
                {range.label}
              </button>
            ))}
          </div>
        }
      />

      <QueryState
        isLoading={overviewQuery.isLoading}
        error={overviewQuery.error}
        empty={false}
        skeleton={
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
                <Skeleton key={key} className="h-[86px]" />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          </div>
        }
        onRetry={() => void overviewQuery.refetch()}
      />

      {data ? (
        <div className="space-y-6">
          <NeedsAttention items={data.needs_attention} />

          <KpiRow>
            <KpiCard
              label="Jobs"
              value={data.jobs_today}
              href={`/admin/jobs?from=${data.window.from.slice(0, 10)}`}
              hint={`${data.jobs_done} finished`}
            />
            <KpiCard
              label="Success rate"
              value={percent(data.success_rate)}
              href="/admin/jobs?status=failed"
              tone={
                data.success_rate === null
                  ? "default"
                  : data.success_rate < 0.9
                    ? "negative"
                    : "positive"
              }
            />
            <KpiCard label="Active" value={data.active_jobs} href="/admin/jobs?status=running" />
            <KpiCard label="In queue" value={data.queue_length} href="/admin/queue" />
            <KpiCard label="Revenue" value={money(data.revenue)} href="/admin/usage" />
            <KpiCard label="Cost" value={money(data.cost)} href="/admin/usage" />
            <KpiCard
              label="Margin"
              value={money(data.margin)}
              href="/admin/usage"
              tone={data.margin < 0 ? "negative" : "positive"}
            />
            <KpiCard
              label="Models down"
              value={data.models_down}
              href="/admin/models?health=down"
              tone={data.models_down > 0 ? "negative" : "default"}
            />
          </KpiRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <AdminSection title="Jobs per day" description="Finished and failed, canaries excluded.">
              <MiniBars points={jobsSeries.data?.points ?? []} color="var(--accent)" />
            </AdminSection>
            <AdminSection title="Revenue vs cost" description="Real jobs only; canary cost is internal.">
              <MiniBars
                points={revenueSeries.data?.points ?? []}
                secondary={costSeries.data?.points ?? []}
                color="var(--success)"
                secondaryColor="var(--danger)"
                legend={["Revenue", "Cost"]}
              />
            </AdminSection>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <AdminSection title="Model health" action={<Link href="/admin/models" className="text-xs underline" style={{ color: "var(--accent)" }}>All models</Link>}>
              <AdminTable>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Health</th>
                      <th scope="col">Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((model) => (
                      <tr key={model.id}>
                        <td>
                          <Link href={`/admin/models/${model.id}`} className="mono text-xs underline">
                            {model.id}
                          </Link>
                        </td>
                        <td>
                          <StatusDot state={model.health_state as never} />
                        </td>
                        <td className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {model.health_since ? relativeTime(model.health_since) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTable>
            </AdminSection>

            <AdminSection
              title="Recent failures"
              action={
                <Link href="/admin/jobs?status=failed" className="text-xs underline" style={{ color: "var(--accent)" }}>
                  All failures
                </Link>
              }
            >
              <AdminTable>
                {data.recent_failures.length ? (
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Job</th>
                        <th scope="col">Model</th>
                        <th scope="col">Error</th>
                        <th scope="col">When</th>
                        <th scope="col" className="text-right">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_failures.map((failure) => (
                        <tr key={failure.job_id}>
                          <td className="mono text-xs">{shortId(failure.job_id, 8)}</td>
                          <td className="mono text-xs">{failure.model}</td>
                          <td>
                            <ErrorCode code={failure.error_code} />
                            {failure.error ? (
                              <p className="max-w-[200px] truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                                {failure.error}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                            {relativeTime(failure.created_at)}
                          </td>
                          <td className="text-right">
                            <Link href={`/admin/jobs/${failure.job_id}`} className="btn btn-ghost btn-sm">
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
                    No failures in this period.
                  </p>
                )}
              </AdminTable>
            </AdminSection>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NeedsAttention({ items }: { items: AdminOverview["needs_attention"] }) {
  if (!items.length) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border px-4 py-3 text-[13px]"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <Check size={15} style={{ color: "var(--success)" }} aria-hidden />
        <span>All systems normal</span>
      </div>
    );
  }

  return (
    <section
      className="rounded-md border"
      style={{ borderColor: "var(--warning)", background: "var(--warning-soft)" }}
      aria-label="Needs attention"
    >
      <p
        className="flex items-center gap-1.5 border-b px-4 py-2 text-xs font-medium"
        style={{ borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)", color: "var(--warning)" }}
      >
        <AlertTriangle size={13} aria-hidden /> Needs attention
      </p>
      <ul>
        {items.map((item, index) => (
          <li
            key={`${item.type}-${item.model}-${index}`}
            className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-[13px] first:border-t-0"
            style={{ borderColor: "color-mix(in srgb, var(--warning) 20%, transparent)" }}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: item.severity === "critical" ? "var(--danger)" : "var(--warning)" }}
              />
              {item.message}
            </span>
            {item.link ? (
              <Link href={item.link} className="btn btn-secondary btn-sm">
                Open <ExternalLink size={12} />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MiniBars({
  points,
  secondary,
  color,
  secondaryColor,
  legend,
}: {
  points: { key: string; value: number }[];
  secondary?: { key: string; value: number }[];
  color: string;
  secondaryColor?: string;
  legend?: [string, string];
}) {
  const max = Math.max(1, ...points.map((point) => point.value), ...(secondary ?? []).map((p) => p.value));

  if (!points.length) {
    return (
      <div className="card flex h-[220px] items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        No data yet. Rollups run every 5 minutes.
      </div>
    );
  }

  return (
    <div className="card card-pad">
      {legend ? (
        <div className="mb-3 flex items-center gap-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {legend[0]}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: secondaryColor }} /> {legend[1]}
          </span>
        </div>
      ) : null}
      <div className="flex h-[180px] items-end gap-1 overflow-x-auto">
        {points.map((point, index) => {
          const other = secondary?.[index];
          return (
            <div
              key={point.key}
              className="group relative flex h-full min-w-[8px] flex-1 items-end gap-[2px]"
              title={`${point.key}: ${point.value}${other ? ` · ${other.value}` : ""}`}
            >
              <div
                className={cn("w-full rounded-t-[2px] transition-opacity group-hover:opacity-80")}
                style={{ height: `${Math.max(2, (point.value / max) * 100)}%`, background: color }}
              />
              {other ? (
                <div
                  className="w-full rounded-t-[2px] transition-opacity group-hover:opacity-80"
                  style={{
                    height: `${Math.max(2, (other.value / max) * 100)}%`,
                    background: secondaryColor,
                    opacity: 0.7,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--text-faint)" }}>
        <span>{points[0]?.key}</span>
        <span>{points[points.length - 1]?.key}</span>
      </div>
    </div>
  );
}