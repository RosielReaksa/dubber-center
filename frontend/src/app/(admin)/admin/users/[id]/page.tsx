"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";

import { AdminSection, AdminTable } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CopyButton } from "@/components/common/copy-button";
import { PageHeader, Skeleton } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { adminApi } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { exactTime, money, relativeTime } from "@/lib/format";

interface KeyRow {
  id: string;
  prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export default function AdminUserPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const toast = useToast();
  const queryClient = useQueryClient();
  const { canEdit, isOwner, user: me } = useAuth();

  const userQuery = useQuery({
    queryKey: ["admin", "user-detail", userId],
    queryFn: () => adminApi.user(userId),
  });

  const [creditsOpen, setCreditsOpen] = useState(false);
  const [amount, setAmount] = useState("25");
  const [reason, setReason] = useState("");
  const [creditsBusy, setCreditsBusy] = useState(false);

  const [keyOpen, setKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState("default");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<KeyRow | null>(null);

  const data = userQuery.data as Record<string, unknown> | undefined;

  if (userQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (!data) {
    return <p style={{ color: "var(--danger)" }}>{friendlyError(userQuery.error)}</p>;
  }

  const keys = (data.keys as KeyRow[]) ?? [];
  const jobs = (data.recent_jobs as Record<string, unknown>[]) ?? [];
  const transactions = (data.credit_transactions as Record<string, unknown>[]) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  const addCredits = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      toast.error("Enter a non-zero amount");
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    setCreditsBusy(true);
    try {
      const result = await adminApi.addCredits(userId, value, reason.trim());
      toast.success("Credits updated", `Balance: ${money(result.balance)}`);
      setCreditsOpen(false);
      setReason("");
      await refresh();
      await userQuery.refetch();
    } catch (error) {
      toast.error("Could not add credits", friendlyError(error));
    } finally {
      setCreditsBusy(false);
    }
  };

  return (
    <div>
      <Link href="/admin/users" className="mb-3 inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
        <ArrowLeft size={14} /> Users
      </Link>

      <PageHeader
        title={String(data.email)}
        description={
          <span>
            {String(data.role)} · {String(data.plan)} · joined {exactTime(String(data.created_at))}
          </span>
        }
        actions={
          canEdit ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setCreditsOpen(true)}>
                Add credits
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setKeyOpen(true)}>
                <KeyRound size={14} /> New key
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ color: String(data.status) === "active" ? "var(--danger)" : undefined }}
                onClick={async () => {
                  try {
                    await adminApi.patchUser(userId, {
                      status: String(data.status) === "active" ? "suspended" : "active",
                    });
                    toast.success("Status updated");
                    await userQuery.refetch();
                  } catch (error) {
                    toast.error("Could not update", friendlyError(error));
                  }
                }}
              >
                {String(data.status) === "active" ? "Suspend" : "Activate"}
              </button>
            </>
          ) : null
        }
      />

      {newKey ? (
        <div className="card card-pad mb-4" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <p className="text-[13px] font-medium">Copy this key now — it is shown once.</p>
          <div className="mt-2 flex items-center gap-2 rounded-sm border px-2.5 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <code className="mono min-w-0 flex-1 overflow-x-auto text-xs">{newKey}</code>
            <CopyButton value={newKey} label="Copy" />
          </div>
          <button type="button" className="mt-2 text-xs underline" onClick={() => setNewKey(null)} style={{ color: "var(--text-muted)" }}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSection title="Account">
          <div className="card card-pad">
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>Credits</dt>
                <dd>{money(Number(data.credits))}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>Status</dt>
                <dd>
                  <span className={data.status === "active" ? "badge badge-success" : "badge badge-danger"}>
                    {String(data.status)}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--text-muted)" }}>Last seen</dt>
                <dd>{data.last_seen_at ? relativeTime(String(data.last_seen_at)) : "Never"}</dd>
              </div>
            </dl>

            {canEdit ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="role" className="label">
                    Role
                  </label>
                  <select
                    id="role"
                    className="input"
                    value={String(data.role)}
                    onChange={async (event) => {
                      try {
                        await adminApi.patchUser(userId, { role: event.target.value });
                        toast.success("Role updated");
                        await userQuery.refetch();
                      } catch (error) {
                        toast.error("Could not change role", friendlyError(error));
                      }
                    }}
                  >
                    {["user", "support", "admin", ...(isOwner ? ["owner"] : [])].map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  {!isOwner ? <p className="hint">Only an owner can grant admin or owner.</p> : null}
                </div>
                <div>
                  <label htmlFor="plan" className="label">
                    Plan
                  </label>
                  <select
                    id="plan"
                    className="input"
                    value={String(data.plan)}
                    onChange={async (event) => {
                      try {
                        await adminApi.patchUser(userId, { plan: event.target.value });
                        toast.success("Plan updated");
                        await userQuery.refetch();
                      } catch (error) {
                        toast.error("Could not change plan", friendlyError(error));
                      }
                    }}
                  >
                    {["free", "pro", "scale"].map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        </AdminSection>

        <AdminSection title="API keys" description="Prefixes only. The full key is never shown again.">
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Prefix</th>
                  <th scope="col">Name</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="mono text-xs">{key.prefix}…</td>
                    <td className="text-xs">{key.name}</td>
                    <td className="text-xs">{key.last_used_at ? relativeTime(key.last_used_at) : "Never"}</td>
                    <td>
                      <span className={key.revoked_at ? "badge badge-neutral" : "badge badge-success"}>
                        {key.revoked_at ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="text-right">
                      {!key.revoked_at && canEdit ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--danger)" }}
                          onClick={() => setRevokeTarget(key)}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!keys.length ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                      No keys.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </AdminTable>
        </AdminSection>

        <AdminSection title="Recent jobs">
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Model</th>
                  <th scope="col">Status</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={String(job.job_id)}>
                    <td>
                      <Link href={`/admin/jobs/${String(job.job_id)}`} className="mono text-xs underline">
                        {String(job.job_id).slice(-8)}
                      </Link>
                    </td>
                    <td className="mono text-xs">{String(job.model)}</td>
                    <td>
                      <StatusBadge status={String(job.status)} />
                    </td>
                    <td className="text-xs">{money(Number(job.cost ?? 0) || null)}</td>
                  </tr>
                ))}
                {!jobs.length ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                      No jobs.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </AdminTable>
        </AdminSection>

        <AdminSection title="Credit history">
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="text-right">
                    Amount
                  </th>
                  <th scope="col" className="text-right">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={String(row.id)}>
                    <td className="text-xs">{relativeTime(String(row.created_at))}</td>
                    <td className="max-w-[180px] truncate text-xs">{String(row.reason)}</td>
                    <td className="text-right text-xs">{money(Number(row.amount))}</td>
                    <td className="text-right text-xs">{money(Number(row.balance_after))}</td>
                  </tr>
                ))}
                {!transactions.length ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                      No transactions.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </AdminTable>
        </AdminSection>
      </div>

      <ConfirmDialog
        open={creditsOpen}
        title="Add credits"
        description="Credits only move through the ledger; the balance updates in the same transaction."
        confirmLabel="Add credits"
        busy={creditsBusy}
        onCancel={() => setCreditsOpen(false)}
        onConfirm={() => void addCredits()}
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="credit-amount" className="label">
              Amount (negative to remove)
            </label>
            <input
              id="credit-amount"
              type="number"
              step="0.01"
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="credit-reason" className="label">
              Reason <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              id="credit-reason"
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Support top-up"
            />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={keyOpen}
        title="Create an API key"
        confirmLabel="Create key"
        onCancel={() => setKeyOpen(false)}
        onConfirm={async () => {
          try {
            const result = await adminApi.createKey(userId, keyName.trim() || "default");
            setNewKey(result.key);
            setKeyOpen(false);
            await userQuery.refetch();
          } catch (error) {
            toast.error("Could not create key", friendlyError(error));
          }
        }}
      >
        <label htmlFor="admin-key-name" className="label">
          Name
        </label>
        <input
          id="admin-key-name"
          className="input"
          value={keyName}
          onChange={(event) => setKeyName(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!revokeTarget}
        title={`Revoke ${revokeTarget?.prefix ?? ""}…?`}
        description="Anything using this key stops working immediately."
        confirmLabel="Revoke key"
        danger
        onCancel={() => setRevokeTarget(null)}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await adminApi.revokeKey(revokeTarget.id, true);
            toast.success("Key revoked");
            setRevokeTarget(null);
            await userQuery.refetch();
          } catch (error) {
            toast.error("Could not revoke", friendlyError(error));
          }
        }}
      />
    </div>
  );
}