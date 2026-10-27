"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";

import { AdminTable, Pagination } from "@/components/admin/kpi-card";
import { PageHeader, QueryState } from "@/components/common/states";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys, type AdminAlert } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { exactTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZE = 25;

export default function AdminAlertsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [page, setPage] = useState(1);

  const alertsQuery = useQuery({
    queryKey: adminKeys.alerts({ status, page: String(page) }),
    queryFn: () => adminApi.alerts({ status: status === "all" ? "" : status, page: String(page), size: String(SIZE) }),
  });

  const resolve = async (alert: AdminAlert) => {
    try {
      await adminApi.resolveAlert(alert.id);
      toast.success("Alert resolved");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error("Could not resolve", friendlyError(error));
    }
  };

  const rows = alertsQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader title="Alerts" description="Open problems, newest first. Resolving one closes it." />

      <div className="mb-4 inline-flex rounded-sm border p-0.5" style={{ borderColor: "var(--border)" }}>
        {(["open", "resolved", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            aria-pressed={status === value}
            className="rounded px-2.5 py-1 text-xs capitalize"
            style={{
              background: status === value ? "var(--accent-soft)" : "transparent",
              color: status === value ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {value}
          </button>
        ))}
      </div>

      <QueryState
        isLoading={alertsQuery.isLoading}
        error={alertsQuery.error}
        isEmpty={!rows.length}
        empty={status === "open" ? "No open alerts. All clear." : "No alerts in this view."}
        onRetry={() => void alertsQuery.refetch()}
      />

      {rows.length ? (
        <>
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Type</th>
                  <th scope="col">Message</th>
                  <th scope="col">Subject</th>
                  <th scope="col">When</th>
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <span
                        className={cn(
                          "badge",
                          alert.severity === "critical" ? "badge-danger" : "badge-warning",
                        )}
                      >
                        {alert.severity}
                      </span>
                    </td>
                    <td className="text-xs">{alert.type}</td>
                    <td className="max-w-[380px] text-[13px]">{alert.message}</td>
                    <td className="mono text-xs">{alert.subject_id ?? "—"}</td>
                    <td className="whitespace-nowrap text-xs" title={exactTime(alert.created_at)}>
                      {relativeTime(alert.created_at)}
                    </td>
                    <td className="text-right">
                      {alert.status === "open" ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resolve(alert)}>
                          <Check size={13} /> Resolve
                        </button>
                      ) : (
                        <span className="badge badge-neutral">Resolved</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
          <Pagination page={page} size={SIZE} total={alertsQuery.data?.total ?? 0} onChange={setPage} />
        </>
      ) : null}
    </div>
  );
}