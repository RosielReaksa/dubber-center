"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { PageHeader, QueryState } from "@/components/common/states";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { minutes as fmtMinutes, money } from "@/lib/format";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
] as const;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full" style={{ background: "var(--surface-2)" }}>
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${width}%`, background: "var(--accent)" }}
      />
    </div>
  );
}

export default function UsagePage() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");

  const params = useMemo(
    () => ({ from: isoDaysAgo(Number(range) - 1), to: isoDaysAgo(0) }),
    [range],
  );

  const usageQuery = useQuery({
    queryKey: queryKeys.usage(params),
    queryFn: () => api.usage(params),
  });

  const data = usageQuery.data;
  const maxDay = Math.max(1, ...(data?.by_day.map((row) => row.minutes) ?? [0]));
  const maxModel = Math.max(1, ...(data?.by_model.map((row) => row.minutes) ?? [0]));

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ["model", "jobs", "minutes", "cost"],
      ...data.by_model.map((row) => [row.key, String(row.jobs), row.minutes.toFixed(2), row.cost.toFixed(4)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `usage-${data.from_date}-to-${data.to_date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Usage"
        description={data ? `Usage from ${data.from_date} through ${data.to_date}.` : "Your dubbing minutes and cost."}
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!data || !data.by_model.length}
            onClick={exportCsv}
          >
            <Download size={14} /> Export CSV
          </button>
        }
      />

      <div className="mb-5 inline-flex rounded-sm border p-0.5" style={{ borderColor: "var(--border)" }}>
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setRange(item.key)}
            aria-pressed={range === item.key}
            className="rounded px-3 py-1.5 text-xs"
            style={{
              background: range === item.key ? "var(--accent-soft)" : "transparent",
              color: range === item.key ? "var(--accent)" : "var(--text-muted)",
              fontWeight: range === item.key ? 500 : 400,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <QueryState
        isLoading={usageQuery.isLoading}
        error={usageQuery.error}
        isEmpty={!data || data.total_jobs === 0}
        empty="No usage in this period. Finished jobs will appear here."
        onRetry={() => void usageQuery.refetch()}
      />

      {data && data.total_jobs > 0 ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Jobs", String(data.total_jobs)],
              ["Minutes dubbed", data.total_minutes.toFixed(1)],
              ["Total cost", money(data.total_cost)],
            ].map(([label, value]) => (
              <div key={label} className="card card-pad">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {label}
                </p>
                <p className="mt-1 font-serif text-2xl">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card card-pad">
              <h2 className="mb-4 text-[13px] font-medium">Minutes per model</h2>
              <ul className="space-y-3">
                {data.by_model.map((row) => (
                  <li key={row.key}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-[13px]">
                      <span className="mono text-xs">{row.key}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {fmtMinutes(row.minutes)} · {money(row.cost)}
                      </span>
                    </div>
                    <Bar value={row.minutes} max={maxModel} />
                  </li>
                ))}
              </ul>
            </section>

            <section className="card card-pad">
              <h2 className="mb-4 text-[13px] font-medium">Minutes per day</h2>
              <div className="h-[240px]">
                <ul className="flex h-full items-end gap-1 overflow-x-auto">
                  {data.by_day.map((row) => (
                    <li key={row.key} className="flex h-full min-w-[10px] flex-1 flex-col justify-end">
                      <div
                        className="w-full rounded-t-[2px] transition-all"
                        style={{
                          height: `${Math.max(2, (row.minutes / maxDay) * 100)}%`,
                          background: "var(--accent)",
                          opacity: 0.85,
                        }}
                        title={`${row.key}: ${row.minutes.toFixed(1)} min, ${row.jobs} jobs`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
              {data.by_day.length ? (
                <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--text-faint)" }}>
                  <span>{data.by_day[0]?.key}</span>
                  <span>{data.by_day[data.by_day.length - 1]?.key}</span>
                </div>
              ) : null}
            </section>
          </div>

          <section>
            <h2 className="mb-3 text-[13px] font-medium">By model</h2>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col" className="text-right">
                        Jobs
                      </th>
                      <th scope="col" className="text-right">
                        Minutes
                      </th>
                      <th scope="col" className="text-right">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_model.map((row) => (
                      <tr key={row.key}>
                        <td className="mono text-xs">{row.key}</td>
                        <td className="text-right">{row.jobs}</td>
                        <td className="text-right">{row.minutes.toFixed(1)}</td>
                        <td className={cn("text-right")}>{money(row.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}