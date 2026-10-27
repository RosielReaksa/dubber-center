"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Save, Zap } from "lucide-react";

import { AdminSection, AdminTable, ErrorCode } from "@/components/admin/kpi-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageHeader, QueryState, Skeleton } from "@/components/common/states";
import { StatusDot, UptimeBar } from "@/components/common/status";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys } from "@/lib/api/admin";
import { api, friendlyError } from "@/lib/api/client";
import { exactTime, money, percent, relativeTime } from "@/lib/format";
import { useDebounce } from "@/hooks";
import { cn } from "@/lib/utils";

/** Minimal YAML renderer for the editor's initial text (no extra dependency). */
function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    return /^[a-zA-Z0-9_.:/-]+$/.test(value) && value !== "" ? value : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return "\n" + value.map((item) => `${pad}- ${toYaml(item, indent + 1)}`).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "{}";
    return "\n" + entries.map(([key, item]) => `${pad}${key}: ${toYaml(item, indent + 1)}`).join("\n");
  }
  return String(value);
}

export default function AdminModelPage() {
  const params = useParams<{ id: string }>();
  const isNew = params.id === "new";
  const modelId = isNew ? "" : params.id;

  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const modelQuery = useQuery({
    queryKey: adminKeys.model(modelId),
    queryFn: () => adminApi.model(modelId),
    enabled: !isNew,
  });

  const historyQuery = useQuery({
    queryKey: adminKeys.healthHistory(modelId),
    queryFn: () => adminApi.healthHistory(modelId),
    enabled: !isNew,
  });

  const statusQuery = useQuery({
    queryKey: ["model-status", modelId],
    queryFn: () => api.modelStatus(modelId),
    enabled: !isNew,
  });

  const [yaml, setYaml] = useState("");
  const [dirty, setDirty] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (isNew || initialized.current) return;
    const manifest = modelQuery.data?.manifest as Record<string, unknown> | undefined;
    if (manifest) {
      setYaml(toYaml(manifest).replace(/^\n/, ""));
      initialized.current = true;
    }
  }, [isNew, modelQuery.data]);

  const debouncedYaml = useDebounce(yaml, 400);

  const validation = useQuery({
    queryKey: ["validate-manifest", debouncedYaml],
    queryFn: () => adminApi.validateManifest(debouncedYaml),
    enabled: debouncedYaml.trim().length > 10,
  });

  const save = useMutation({
    mutationFn: () => adminApi.saveModel(yaml, isNew ? undefined : modelId),
    onSuccess: async () => {
      toast.success(isNew ? "Model created" : "Model saved");
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      if (isNew) {
        const preview = validation.data?.preview as { id?: string } | undefined;
        router.push(preview?.id ? `/admin/models/${preview.id}` : "/admin/models");
      }
    },
    onError: (error) => toast.error("Could not save", friendlyError(error)),
  });

  const checkNow = useMutation({
    mutationFn: () => adminApi.checkNow(modelId),
    onSuccess: async () => {
      toast.success("Check complete");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toast.error("Check failed", friendlyError(error)),
  });

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableImpact, setDisableImpact] = useState<Record<string, unknown> | null>(null);

  const model = modelQuery.data as Record<string, unknown> | undefined;
  const preview = validation.data?.preview as Record<string, unknown> | undefined;
  const daily = statusQuery.data?.daily ?? [];

  const previewLangs = useMemo(() => {
    const languages = preview?.languages as { source?: string[]; target?: string[] } | undefined;
    return {
      source: languages?.source ?? [],
      target: languages?.target ?? [],
    };
  }, [preview]);

  if (!isNew && modelQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (!isNew && modelQuery.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Model" />
        <p className="text-[13px]" style={{ color: "var(--danger)" }}>
          {friendlyError(modelQuery.error)}
        </p>
        <Link href="/admin/models" className="btn btn-secondary">
          Back to models
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/models"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        <ArrowLeft size={14} /> Models
      </Link>

      <PageHeader
        title={isNew ? "Add a model" : String(model?.name ?? modelId)}
        description={
          isNew
            ? "Paste or edit the manifest on the right. Validation runs as you type."
            : `${modelId} · ${String(model?.type ?? "")} · configured ${String(model?.status ?? "")}`
        }
        actions={
          !isNew ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={checkNow.isPending}
                onClick={() => checkNow.mutate()}
              >
                {checkNow.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Check now
              </button>
              {String(model?.status) === "disabled" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await adminApi.enableModel(modelId);
                      toast.success("Model enabled");
                      await queryClient.invalidateQueries({ queryKey: ["admin"] });
                      await modelQuery.refetch();
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
                  className="btn btn-secondary"
                  style={{ color: "var(--danger)" }}
                  onClick={async () => {
                    setDisableOpen(true);
                    setDisableImpact(null);
                    try {
                      setDisableImpact(await adminApi.disableModel(modelId, true));
                    } catch {
                      /* keep the dialog without impact */
                    }
                  }}
                >
                  Disable
                </button>
              )}
            </>
          ) : null
        }
      />

      {!isNew && model ? (
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <StatusDot
            state={String(model.health_state) as never}
            since={model.health_since as string | null}
            checkedAt={model.health_checked_at as string | null}
            size="md"
          />
          {statusQuery.data?.uptime_30d !== undefined ? (
            <UptimeBar days={daily} uptime={statusQuery.data?.uptime_30d} />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* --- form / preview ------------------------------------------ */}
        <div className="space-y-4">
          <AdminSection title="Catalog preview" description="How the model appears to customers.">
            <div className="card card-pad">
              {preview ? (
                <>
                  <p className="text-[15px] font-medium">{String(preview.name ?? "")}</p>
                  <p className="mono text-xs" style={{ color: "var(--text-faint)" }}>
                    {String(preview.id ?? "")}
                  </p>
                  <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
                    {String(preview.description ?? "")}
                  </p>
                  <p className="mt-3 text-xs">
                    {previewLangs.source.slice(0, 3).join(", ").toUpperCase()} →{" "}
                    {previewLangs.target.slice(0, 3).join(", ").toUpperCase()}
                    {" · "}
                    {money(Number(preview.price_per_minute ?? 0))}/min
                  </p>
                </>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                  A valid manifest shows a preview here.
                </p>
              )}
            </div>
          </AdminSection>

          <AdminSection title="Validation">
            <div className="card card-pad" aria-live="polite">
              {!debouncedYaml.trim() ? (
                <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                  Paste a manifest to validate it.
                </p>
              ) : validation.isLoading ? (
                <p className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
                  <Loader2 size={14} className="animate-spin" /> Checking…
                </p>
              ) : validation.data?.valid ? (
                <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--success)" }}>
                  <CheckCircle2 size={14} /> Manifest is valid
                </p>
              ) : (
                <div>
                  <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--danger)" }}>
                    <AlertCircle size={14} /> Manifest has problems
                  </p>
                  <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--danger)" }}>
                    {(validation.data?.errors ?? [friendlyError(validation.error)]).map((error, index) => (
                      <li key={index} className="mono break-words">
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AdminSection>

          {!isNew ? (
            <AdminSection title="Health history">
              <QueryState
                isLoading={historyQuery.isLoading}
                error={historyQuery.error}
                isEmpty={!historyQuery.data?.checks.length && !historyQuery.data?.state_changes.length}
                empty="No checks recorded yet. Use Check now, or wait for the ping cron."
              />
              {historyQuery.data ? (
                <div className="space-y-3">
                  <AdminTable>
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Type</th>
                          <th scope="col">Result</th>
                          <th scope="col">Latency</th>
                          <th scope="col">Error</th>
                          <th scope="col">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyQuery.data.checks.slice(0, 12).map((row, index) => (
                          <tr key={index}>
                            <td className="text-xs">{row.type}</td>
                            <td>
                              <span className={row.ok ? "badge badge-success" : "badge badge-danger"}>
                                {row.ok ? "OK" : "Failed"}
                              </span>
                            </td>
                            <td className="text-xs">{row.latency_ms === null ? "—" : `${Math.round(row.latency_ms)} ms`}</td>
                            <td>
                              <ErrorCode code={row.error_code} />
                            </td>
                            <td className="whitespace-nowrap text-xs" title={exactTime(row.checked_at)}>
                              {relativeTime(row.checked_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AdminTable>

                  {historyQuery.data.state_changes.length ? (
                    <div className="card card-pad">
                      <p className="mb-2 text-[13px] font-medium">State changes</p>
                      <ul className="space-y-2 text-xs">
                        {historyQuery.data.state_changes.map((change, index) => (
                          <li key={index} className="flex gap-2">
                            <span className="mono w-24 shrink-0" style={{ color: "var(--text-faint)" }}>
                              {new Date(change.created_at).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span>
                              <span className="mono">
                                {change.old_state} → {change.new_state}
                              </span>
                              {change.reason ? (
                                <span style={{ color: "var(--text-muted)" }}> — {change.reason}</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </AdminSection>
          ) : null}
        </div>

        {/* --- manifest editor ---------------------------------------- */}
        <div className="lg:sticky lg:top-20 lg:h-fit">
          <AdminSection
            title="Manifest"
            description="YAML. Adding a model is a manifest, not code."
            action={
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!validation.data?.valid || save.isPending || (!dirty && !isNew)}
                onClick={() => save.mutate()}
              >
                {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {isNew ? "Create model" : "Save"}
              </button>
            }
          >
            <textarea
              value={yaml}
              onChange={(event) => {
                setYaml(event.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              aria-label="Model manifest YAML"
              className={cn(
                "mono min-h-[520px] w-full resize-y rounded-md border p-3 text-xs leading-relaxed",
              )}
              style={{
                background: "var(--surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
              placeholder={
                isNew
                  ? `id: newmodel\nname: New Model\nlanguages:\n  source: [en]\n  target: [km]\nrunner:\n  kind: http\n  http:\n    submit_url: http://...\n    status_url: http://.../jobs/{external_id}\n    result_url: http://.../jobs/{external_id}/result`
                  : ""
              }
            />
          </AdminSection>
        </div>
      </div>

      <ConfirmDialog
        open={disableOpen}
        title={`Disable ${modelId}?`}
        description={
          <>
            <p>New jobs are rejected; running jobs finish normally.</p>
            {disableImpact ? (
              <div className="mt-3 rounded-sm border p-3 text-xs" style={{ borderColor: "var(--border)" }}>
                <p className="mono">
                  running_jobs: {String((disableImpact.will_affect as Record<string, number>)?.running_jobs ?? "—")}
                </p>
                <p className="mono">
                  queued_jobs: {String((disableImpact.will_affect as Record<string, number>)?.queued_jobs ?? "—")}
                </p>
              </div>
            ) : null}
          </>
        }
        confirmLabel={`Disable ${modelId}`}
        danger
        onCancel={() => setDisableOpen(false)}
        onConfirm={async () => {
          try {
            await adminApi.disableModel(modelId, false);
            toast.success("Model disabled");
            setDisableOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["admin"] });
            await modelQuery.refetch();
          } catch (error) {
            toast.error("Could not disable", friendlyError(error));
          }
        }}
      />
    </div>
  );
}