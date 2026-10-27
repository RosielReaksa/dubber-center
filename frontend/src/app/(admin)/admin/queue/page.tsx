"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Wrench } from "lucide-react";

import { AdminSection, AdminTable, Pagination } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader, QueryState } from "@/components/common/states";
import { StatusDot } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";

export default function AdminQueuePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepResult, setSweepResult] = useState<{ count: number; stuck: { job_id: string; model: string; age_minutes: number }[] } | null>(null);

  const queueQuery = useQuery({
    queryKey: adminKeys.queue(),
    queryFn: () => adminApi.queue(),
    refetchInterval: 10_000,
  });

  const workersQuery = useQuery({
    queryKey: adminKeys.workers(),
    queryFn: () => adminApi.workers(),
    refetchInterval: 10_000,
  });

  const models = queueQuery.data?.data ?? [];
  const workers = workersQuery.data?.data ?? [];

  const togglePause = async (model: string, paused: boolean) => {
    try {
      if (paused) await adminApi.resumeQueue(model);
      else await adminApi.pauseQueue(model);
      toast.success(paused ? "Queue resumed" : "Queue paused");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error("Could not change the queue", friendlyError(error));
    }
  };

  return (
    <div>
      <PageHeader
        title="Queue and workers"
        description="Backlog per model and the workers currently connected."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              setSweepOpen(true);
              setSweepResult(null);
              try {
                setSweepResult(await adminApi.sweepStuck(true));
              } catch (error) {
                toast.error("Could not preview the sweep", friendlyError(error));
              }
            }}
          >
            <Wrench size={14} /> Sweep stuck jobs
          </button>
        }
      />

      <AdminSection title="Queues">
        <QueryState
          isLoading={queueQuery.isLoading}
          error={queueQuery.error}
          isEmpty={!models.length}
          empty="No models registered."
          onRetry={() => void queueQuery.refetch()}
        />
        {models.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((model) => {
              const utilization = model.max_concurrent
                ? Math.min(100, (model.running / model.max_concurrent) * 100)
                : 0;
              return (
                <div key={model.model} className="card card-pad">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{model.name}</p>
                      <p className="mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                        {model.model}
                      </p>
                    </div>
                    <StatusDot state={model.health_state as never} showLabel={false} />
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Waiting</dt>
                      <dd className="font-serif text-lg">{model.waiting}</dd>
                    </div>
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Running</dt>
                      <dd className="font-serif text-lg">
                        {model.running}
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                          /{model.max_concurrent}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Longest wait</dt>
                      <dd>
                        {model.longest_wait_minutes === null ? "—" : `${model.longest_wait_minutes} min`}
                      </dd>
                    </div>
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Status</dt>
                      <dd>
                        <span className={model.queue_paused ? "badge badge-warning" : "badge badge-success"}>
                          {model.queue_paused ? "Paused" : "Running"}
                        </span>
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <div className="h-full rounded-full" style={{ width: `${utilization}%`, background: "var(--accent)" }} />
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm mt-3 w-full"
                    onClick={() => void togglePause(model.model, model.queue_paused)}
                  >
                    {model.queue_paused ? <Play size={12} /> : <Pause size={12} />}
                    {model.queue_paused ? "Resume queue" : "Pause queue"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </AdminSection>

      <div className="mt-6">
        <AdminSection title="Workers" description="A heartbeat every 10 seconds; missing means offline.">
          <QueryState
            isLoading={workersQuery.isLoading}
            error={workersQuery.error}
            isEmpty={!workers.length}
            empty="No workers have reported yet. Start a worker to see it here."
            onRetry={() => void workersQuery.refetch()}
          />
          {workers.length ? (
            <AdminTable>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Worker</th>
                    <th scope="col">Host</th>
                    <th scope="col">Model</th>
                    <th scope="col">Job</th>
                    <th scope="col">Heartbeat</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((worker) => (
                    <tr key={worker.worker_id}>
                      <td className="mono text-xs">{worker.worker_id}</td>
                      <td className="text-xs">{worker.host}</td>
                      <td className="mono text-xs">{worker.model || "—"}</td>
                      <td className="mono text-xs">{worker.job_id ? worker.job_id.slice(-8) : "—"}</td>
                      <td className="text-xs">{worker.age_sec}s ago</td>
                      <td>
                        <span className={worker.online ? "badge badge-success" : "badge badge-danger"}>
                          {worker.online ? "Online" : "Offline"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTable>
          ) : null}
        </AdminSection>
      </div>

      <ConfirmDialog
        open={sweepOpen}
        title="Sweep stuck jobs"
        description={
          <>
            {sweepResult === null ? (
              <p>Checking for jobs past their model timeout…</p>
            ) : sweepResult.count === 0 ? (
              <p>No stuck jobs found. Nothing will change.</p>
            ) : (
              <>
                <p>
                  {sweepResult.count} job{sweepResult.count === 1 ? "" : "s"} will be marked failed.
                </p>
                <ul className="mono mt-2 max-h-40 space-y-0.5 overflow-auto text-xs">
                  {sweepResult.stuck.map((job) => (
                    <li key={job.job_id}>
                      {job.job_id.slice(-8)} · {job.model} · {job.age_minutes} min
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        }
        confirmLabel="Mark failed"
        danger
        onCancel={() => setSweepOpen(false)}
        onConfirm={async () => {
          try {
            const result = await adminApi.sweepStuck(false);
            toast.success("Sweep complete", `${result.count} job(s) failed`);
            setSweepOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["admin"] });
          } catch (error) {
            toast.error("Sweep failed", friendlyError(error));
          }
        }}
      />
    </div>
  );
}