"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldAlert } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CopyButton } from "@/components/common/copy-button";
import { PageHeader, QueryState } from "@/components/common/states";
import { useToast } from "@/components/common/toast";
import { friendlyError, request } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { exactTime, relativeTime } from "@/lib/format";

interface ApiKeyRow {
  id: string;
  prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export default function KeysPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const keysQuery = useQuery({
    queryKey: queryKeys.keys(),
    queryFn: () => request<{ data: ApiKeyRow[] }>("/v1/keys"),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("default");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const createKey = async () => {
    setCreating(true);
    try {
      const result = await request<{ key: string; prefix: string }>("/v1/keys", {
        method: "POST",
        body: { name: name.trim() || "default" },
      });
      setCreatedKey(result.key);
      setCreateOpen(false);
      setName("default");
      await queryClient.invalidateQueries({ queryKey: queryKeys.keys() });
    } catch (error) {
      toast.error("Could not create key", friendlyError(error));
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async () => {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    try {
      await request(`/v1/keys/${revokeTarget.id}`, { method: "DELETE" });
      toast.success("Key revoked");
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.keys() });
    } catch (error) {
      toast.error("Could not revoke key", friendlyError(error));
    } finally {
      setRevokeBusy(false);
    }
  };

  const keys = keysQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Use a key as `Authorization: Bearer <key>`. Keys are shown once, then only their prefix."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> Create key
          </button>
        }
      />

      {createdKey ? (
        <div
          className="card card-pad mb-5"
          style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Copy this key now</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                It will not be shown again. If you lose it, revoke it and create another.
              </p>
              <div
                className="mt-2.5 flex items-center gap-2 rounded-sm border px-2.5 py-2"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <code className="mono min-w-0 flex-1 overflow-x-auto text-xs">{createdKey}</code>
                <CopyButton value={createdKey} label="Copy key" />
              </div>
              <button
                type="button"
                className="mt-2 text-xs underline"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setCreatedKey(null)}
              >
                I have saved it
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <QueryState
          isLoading={keysQuery.isLoading}
          error={keysQuery.error}
          isEmpty={!keys.length}
          empty={
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <div
                className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: "var(--surface-2)", color: "var(--text-faint)" }}
                aria-hidden
              >
                <KeyRound size={18} />
              </div>
              <p className="text-[15px] font-medium">No API keys yet</p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
                Create one to call the API from your own code.
              </p>
              <button type="button" className="btn btn-primary mt-4" onClick={() => setCreateOpen(true)}>
                Create key
              </button>
            </div>
          }
          onRetry={() => void keysQuery.refetch()}
        />

        {keys.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Created</th>
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
                    <td>{key.name}</td>
                    <td>
                      <span className="mono text-xs">{key.prefix}…</span>
                    </td>
                    <td>
                      <span title={exactTime(key.created_at)}>{relativeTime(key.created_at)}</span>
                    </td>
                    <td>
                      {key.last_used_at ? (
                        <span title={exactTime(key.last_used_at)}>{relativeTime(key.last_used_at)}</span>
                      ) : (
                        <span style={{ color: "var(--text-faint)" }}>Never</span>
                      )}
                    </td>
                    <td>
                      <span className={key.revoked_at ? "badge badge-neutral" : "badge badge-success"}>
                        {key.revoked_at ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="text-right">
                      {!key.revoked_at ? (
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
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={createOpen}
        title="Create an API key"
        description="Give it a name so you can tell it apart later."
        confirmLabel="Create key"
        busy={creating}
        onCancel={() => setCreateOpen(false)}
        onConfirm={() => void createKey()}
      >
        <label htmlFor="key-name" className="label">
          Name
        </label>
        <input
          id="key-name"
          className="input"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="production"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!revokeTarget}
        title={`Revoke "${revokeTarget?.name ?? ""}"?`}
        description={
          <>
            Anything using <code className="mono text-xs">{revokeTarget?.prefix}…</code> will stop
            working immediately. This cannot be undone.
          </>
        }
        confirmLabel="Revoke key"
        danger
        busy={revokeBusy}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void revokeKey()}
      />
    </div>
  );
}