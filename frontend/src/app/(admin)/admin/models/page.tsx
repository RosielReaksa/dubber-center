"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Pause, Play, Plus, Zap } from "lucide-react";

import { AdminTable, Pagination } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader, QueryState } from "@/components/common/states";
import { StatusDot } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys, type AdminModelRow } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { money, percent, relativeTime } from "@/lib/format";
import { useDebounce } from "@/hooks";

const SIZE = 25;

function ModelsTable() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState(search.get("q") ?? "");
  const [page, setPage] = useState(1);
  const health = search.get("health") ?? "";
  const debouncedQuery = useDebounce(q, 250);

  const params: Record<string, string> = { page: String(page), size: String(SIZE) };
  if (debouncedQuery) params.q = debouncedQuery;
  if (health) params.health = health;

  const modelsQuery = useQuery({
    queryKey: adminKeys.models(params),
    queryFn: () => adminApi.models(params),
  });

  const [disableTarget, setDisableTarget] = useState<AdminModelRow | null>(null);
  const [impact, setImpact] = useState<Record<string, unknown> | null>(null);
  const [disableBusy, setDisableBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  const toggleQueue = useMutation({
    mutationFn: (model: AdminModelRow) =>
      model.queue_paused ? adminApi.resumeQueue(model.id) : adminApi.pauseQueue(model.id),
    onSuccess: async (_data, model) => {
      toast.success(model.queue_paused ? "Queue resumed" : "Queue paused");
      await refresh();
    },
    onError: (error) => toast.error("Could not change the queue", friendlyError(error)),
  });

  const check = useMutation({
    mutationFn: (id: string) => adminApi.checkNow(id),
    onSuccess: async () => {
      toast.success("Check complete", "Ping and canary results were recorded.");
      await refresh();
    },
    onError: (error) => toast.error("Check failed", friendlyError(error)),
  });

  const openDisable = async (model: AdminModelRow) => {
    setDisableTarget(model);
    setImpact(null);
    try {
      const result = await adminApi.disableModel(model.id, true);
      setImpact(result);
    } catch (error) {
      toast.error("Could not preview the impact", friendlyError(error));
    }
  };

  const confirmDisable = async () => {
    if (!disableTarget) return;
    setDisableBusy(true);
    try {
      await adminApi.disableModel(disableTarget.id, false);
      toast.success(`${disableTarget.id} disabled`);
      setDisableTarget(null);
      await refresh();
    } catch (error) {
      toast.error("Could not disable", friendlyError(error));
    } finally {
      setDisableBusy(false);
    }
  };

  const rows = modelsQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Models"
        description="What the registry offers, how each is doing, and how to pause it."
        actions={
          <Link href="/admin/models/new" className="btn btn-primary">
            <Plus size={14} /> Add model
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="model-search">
          Search models
        </label>
        <input
          id="model-search"
          className="input w-full max-w-xs"
          placeholder="Search name or id…"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={health === "not-healthy"}
            onChange={(event) => router.replace(event.target.checked ? "/admin/models?health=down" : "/admin/models")}
          />
          Down only
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void modelsQuery.refetch()}>
          Refresh
        </button>
      </div>

      <QueryState
        isLoading={modelsQuery.isLoading}
        error={modelsQuery.error}
        isEmpty={!rows.length}
        empty="No models match this search."
        onRetry={() => void modelsQuery.refetch()}
      />

      {rows.length ? (
        <>
          <AdminTable>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Health</th>
                  <th scope="col" className="text-right">
                    24h success
                  </th>
                  <th scope="col" className="text-right">
                    Price/min
                  </th>
                  <th scope="col" className="text-right">
                    Concurrency
                  </th>
                  <th scope="col">Queue</th>
                  <th scope="col" className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((model) => (
                  <tr key={model.id}>
                    <td>
                      <Link href={`/admin/models/${model.id}`} className="text-[13px] font-medium underline">
                        {model.name}
                      </Link>
                      <p className="mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                        {model.id}
                      </p>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{model.type}</span>
                    </td>
                    <td>
                      <span className={model.status === "disabled" ? "badge badge-neutral" : "badge badge-success"}>
                        {model.status}
                      </span>
                    </td>
                    <td>
                      <StatusDot
                        state={model.health_state as never}
                        since={model.health_since}
                        checkedAt={model.health_checked_at}
                        disabled={model.status === "disabled"}
                      />
                      {model.health_since && model.health_state !== "unknown" ? (
                        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                          {model.health_state} for {relativeTime(model.health_since).replace(" ago", "")}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-right">{percent(model.success_rate_24h)}</td>
                    <td className="text-right">{money(model.price_per_minute)}</td>
                    <td className="text-right">{model.max_concurrent}</td>
                    <td>
                      <span className={model.queue_paused ? "badge badge-warning" : "badge badge-neutral"}>
                        {model.queue_paused ? "Paused" : "Running"}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Run a ping and canary now"
                          disabled={check.isPending}
                          onClick={() => check.mutate(model.id)}
                        >
                          <Zap size={13} /> Check
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={toggleQueue.isPending}
                          onClick={() => toggleQueue.mutate(model)}
                        >
                          {model.queue_paused ? <Play size={13} /> : <Pause size={13} />}
                          {model.queue_paused ? "Resume" : "Pause"}
                        </button>
                        {model.status === "disabled" ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={async () => {
                              try {
                                await adminApi.enableModel(model.id);
                                toast.success(`${model.id} enabled`);
                                await refresh();
                              } catch (error) {
                                toast.error("Could not enable", friendlyError(error));
                              }
                            }}
                          >
                            Enable
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: "var(--danger)" }}
                            onClick={() => void openDisable(model)}
                          >
                            Disable
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
          <Pagination
            page={page}
            size={SIZE}
            total={modelsQuery.data?.total ?? 0}
            onChange={setPage}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={!!disableTarget}
        title={`Disable ${disableTarget?.id}?`}
        description={
          <>
            <p>New jobs for this model will be rejected. Running jobs are allowed to finish.</p>
            {impact ? (
              <div className="mt-3 rounded-sm border p-3" style={{ borderColor: "var(--border)" }}>
                <p className="mono text-xs">
                  running_jobs: {String((impact.will_affect as Record<string, number>)?.running_jobs ?? "—")}
                </p>
                <p className="mono text-xs">
                  queued_jobs: {String((impact.will_affect as Record<string, number>)?.queued_jobs ?? "—")}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
                Checking impact…
              </p>
            )}
          </>
        }
        confirmLabel={`Disable ${disableTarget?.id ?? ""}`}
        danger
        busy={disableBusy}
        onCancel={() => setDisableTarget(null)}
        onConfirm={() => void confirmDisable()}
      />
    </div>
  );
}

export default function AdminModelsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-64 w-full" />
        </div>
      }
    >
      <ModelsTable />
    </Suspense>
  );
}