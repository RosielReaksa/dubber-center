"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { AdminTable, KpiCard } from "@/components/admin/kpi-card";
import { PageHeader, QueryState } from "@/components/common/states";
import { adminApi, adminKeys } from "@/lib/api/admin";
import { API_URL } from "@/lib/api/client";
import { money } from "@/lib/format";

const GROUPS = [
  { key: "model", label: "By model" },
  { key: "user", label: "By user" },
  { key: "day", label: "By day" },
] as const;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function AdminUsagePage() {
  const [groupBy, setGroupBy] = useState<"model" | "user" | "day">("model");
  const [range, setRange] = useState("30");

  const params = useMemo(
    () => ({ group_by: groupBy, from: isoDaysAgo(Number(range) - 1), to: isoDaysAgo(0) }),
    [groupBy, range],
  );

  const usageQuery = useQuery({
    queryKey: adminKeys.usage(params),
    queryFn: () => adminApi.usage(params),
  });

  const data = usageQuery.data;
  const rows =
    groupBy === "user"
      ? (data?.by_user ?? []).map((row) => ({ key: row.user_id, ...row }))
      : groupBy === "model"
        ? (data?.by_model ?? [])
        : (data?.by_day ?? []);

  const exportCsv = async () => {
    const response = await fetch(
      `${API_URL}/v1/admin/usage/export.csv?from=${params.from}&to=${params.to}`,
      { credentials: "include" },
    );
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `usage-${params.from}-${params.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Usage and billing"
        description="Revenue and internal cost per model, user or day."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void exportCsv()}>
            <Download size={14} /> Export CSV
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-sm border p-0.5" style={{ borderColor: "var(--border)" }}>
          {GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => setGroupBy(group.key)}
              aria-pressed={groupBy === group.key}
              className="rounded px-2.5 py-1 text-xs"
              style={{
                background: groupBy === group.key ? "var(--accent-soft)" : "transparent",
                color: groupBy === group.key ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {group.label}
            </button>
          ))}
        </div>

        <select
          className="input w-auto"
          value={range}
          onChange={(event) => setRange(event.target.value)}
          aria-label="Date range"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <QueryState
        isLoading={usageQuery.isLoading}
        error={usageQuery.error}
        isEmpty={!data || data.total_jobs === 0}
        empty="No usage in this period."
        onRetry={() => void usageQuery.refetch()}
      />

      {data && data.total_jobs > 0 ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard label="Jobs" value={data.total_jobs} />
            <KpiCard label="Minutes" value={data.total_minutes.toFixed(1)} />
            <KpiCard label="Cost" value={money(data.total_cost)} />
          </div>

          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{groupBy === "day" ? "Date" : groupBy === "user" ? "User" : "Model"}</th>
                  <th scope="col" className="text-right">
                    Jobs
                  </th>
                  <th scope="col" className="text-right">
                    Minutes
                  </th>
                  <th scope="col" className="text-right">
                    Cost
                  </th>
                  <th scope="col" className="text-right">
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const margin = row.cost;
                  return (
                    <tr key={row.key}>
                      <td className="mono text-xs">{row.key}</td>
                      <td className="text-right">{row.jobs}</td>
                      <td className="text-right">{row.minutes.toFixed(1)}</td>
                      <td className="text-right">{money(row.cost)}</td>
                      <td className="text-right" style={{ color: margin < 0 ? "var(--danger)" : "var(--text)" }}>
                        {money(margin)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTable>
        </div>
      ) : null}
    </div>
  );
}