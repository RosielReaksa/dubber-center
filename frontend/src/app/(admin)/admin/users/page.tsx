"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { AdminTable, Pagination } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CopyButton } from "@/components/common/copy-button";
import { PageHeader, QueryState } from "@/components/common/states";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { exactTime, money, relativeTime, shortId } from "@/lib/format";
import { useDebounce } from "@/hooks";

const SIZE = 25;

function UsersTable() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState(search.get("q") ?? "");
  const debounced = useDebounce(q, 250);
  const [page, setPage] = useState(1);

  const params: Record<string, string> = { page: String(page), size: String(SIZE) };
  if (debounced) params.q = debounced;
  if (search.get("role")) params.role = search.get("role")!;
  if (search.get("status")) params.status = search.get("status")!;

  const usersQuery = useQuery({
    queryKey: adminKeys.users(params),
    queryFn: () => adminApi.users(params),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "user", plan: "free", credits: "0" });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: string; prefix: string } | null>(null);

  const createUser = async () => {
    setCreating(true);
    try {
      const result = (await adminApi.createUser({
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        role: form.role,
        plan: form.plan,
        credits: Number(form.credits) || 0,
      })) as { api_key?: string; key_prefix?: string };
      setCreated({ key: result.api_key ?? "", prefix: result.key_prefix ?? "" });
      setCreateOpen(false);
      setForm({ email: "", name: "", role: "user", plan: "free", credits: "0" });
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error("Could not create user", friendlyError(error));
    } finally {
      setCreating(false);
    }
  };

  const rows = usersQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Accounts, roles, credits and access."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> New user
          </button>
        }
      />

      {created ? (
        <div className="card card-pad mb-4" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <p className="text-[13px] font-medium">Copy this key now — it is shown once.</p>
          <div className="mt-2 flex items-center gap-2 rounded-sm border px-2.5 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <code className="mono min-w-0 flex-1 overflow-x-auto text-xs">{created.key}</code>
            <CopyButton value={created.key} label="Copy" />
          </div>
          <button type="button" className="mt-2 text-xs underline" onClick={() => setCreated(null)} style={{ color: "var(--text-muted)" }}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="user-search">
          Search users
        </label>
        <input
          id="user-search"
          className="input w-full max-w-xs"
          placeholder="Email or name…"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <QueryState
        isLoading={usersQuery.isLoading}
        error={usersQuery.error}
        isEmpty={!rows.length}
        empty="No users match this search."
        onRetry={() => void usersQuery.refetch()}
      />

      {rows.length ? (
        <>
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">
                    Credits
                  </th>
                  <th scope="col" className="text-right">
                    Jobs
                  </th>
                  <th scope="col">Last active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id} className="cursor-pointer" onClick={() => router.push(`/admin/users/${user.id}`)}>
                    <td>
                      <p className="text-[13px]">{user.email}</p>
                      {user.name ? (
                        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                          {user.name}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-xs">{user.plan}</td>
                    <td>
                      <span className={user.role === "user" ? "badge badge-neutral" : "badge badge-accent"}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span className={user.status === "active" ? "badge badge-success" : "badge badge-danger"}>
                        {user.status}
                      </span>
                    </td>
                    <td className="text-right">{money(user.credits)}</td>
                    <td className="text-right">{user.jobs}</td>
                    <td className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {user.last_seen_at ? (
                        <span title={exactTime(user.last_seen_at)}>{relativeTime(user.last_seen_at)}</span>
                      ) : (
                        "Never"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
          <Pagination page={page} size={SIZE} total={usersQuery.data?.total ?? 0} onChange={setPage} />
        </>
      ) : null}

      <ConfirmDialog
        open={createOpen}
        title="Create a user"
        description="The API key is generated with the account and shown once."
        confirmLabel="Create user"
        busy={creating}
        onCancel={() => setCreateOpen(false)}
        onConfirm={() => void createUser()}
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="new-email" className="label">
              Email
            </label>
            <input
              id="new-email"
              type="email"
              className="input"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="new-role" className="label">
              Role
            </label>
            <select
              id="new-role"
              className="input"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            >
              {["user", "support", "admin"].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-credits" className="label">
              Starting credits
            </label>
            <input
              id="new-credits"
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={form.credits}
              onChange={(event) => setForm({ ...form, credits: event.target.value })}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <UsersTable />
    </Suspense>
  );
}