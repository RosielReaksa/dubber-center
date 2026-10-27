"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";

import { AdminTable, Pagination } from "@/components/admin/kpi-card";
import { PageHeader, QueryState } from "@/components/common/states";
import { adminApi, adminKeys } from "@/lib/api/admin";
import { exactTime, relativeTime } from "@/lib/format";

const SIZE = 25;

type AuditRow = {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const params: Record<string, string> = { page: String(page), size: String(SIZE) };
  if (action) params.action = action;

  const auditQuery = useQuery({
    queryKey: adminKeys.audit(params),
    queryFn: () => adminApi.audit(params),
  });

  const rows = auditQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every admin write, with the before and after values."
      />

      <div className="mb-4 flex items-center gap-2.5">
        <label className="sr-only" htmlFor="audit-action">
          Filter by action
        </label>
        <input
          id="audit-action"
          className="input w-56"
          placeholder="Filter by action (e.g. model.update)"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <QueryState
        isLoading={auditQuery.isLoading}
        error={auditQuery.error}
        isEmpty={!rows.length}
        empty="No audit entries yet."
        onRetry={() => void auditQuery.refetch()}
      />

      {rows.length ? (
        <>
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 32 }}>
                    <span className="sr-only">Expand</span>
                  </th>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: AuditRow) => {
                  const expanded = open === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="cursor-pointer"
                        onClick={() => setOpen(expanded ? null : row.id)}
                      >
                        <td>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="whitespace-nowrap text-xs" title={exactTime(row.created_at)}>
                          {relativeTime(row.created_at)}
                        </td>
                        <td className="mono text-[11px]">{row.actor_user_id ?? "system"}</td>
                        <td className="mono text-xs">{row.action}</td>
                        <td className="mono text-xs">
                          {row.target_type}
                          {row.target_id ? `:${row.target_id}` : ""}
                        </td>
                        <td className="mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {row.ip ?? "—"}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--surface-2)" }}>
                            <AuditDiff before={row.before} after={row.after} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </AdminTable>
          <Pagination page={page} size={SIZE} total={auditQuery.data?.total ?? 0} onChange={setPage} />
        </>
      ) : null}
    </div>
  );
}

function AuditDiff({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length) {
    return <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>No field changes recorded.</p>;
  }

  return (
    <div className="p-3">
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <th scope="col" className="py-1 pr-3 font-medium">
              Field
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Before
            </th>
            <th scope="col" className="py-1 font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td className="py-0.5 pr-3 mono">{key}</td>
              <td className="py-0.5 pr-3 mono" style={{ color: "var(--danger)" }}>
                {JSON.stringify(before?.[key] ?? null)}
              </td>
              <td className="py-0.5 mono" style={{ color: "var(--success)" }}>
                {JSON.stringify(after?.[key] ?? null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}