"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PageHeader, QueryState } from "@/components/common/states";
import { useToast } from "@/components/common/toast";
import { adminApi, adminKeys } from "@/lib/api/admin";
import { friendlyError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";

const HELP: Record<string, string> = {
  "health.ping_timeout_sec": "How long a ping may take before it counts as failed.",
  "health.down_ping_failures": "Failed pings in a row that mean the model is down.",
  "health.down_canary_failures": "Failed canaries in a row that mean down.",
  "health.window_minutes": "Rolling window used for real-traffic stats.",
  "health.down_success_rate": "Success rate below this (with enough jobs) means down.",
  "health.down_min_jobs": "Minimum jobs before the down success-rate rule applies.",
  "health.degraded_success_rate": "Success rate below this means degraded.",
  "health.degraded_min_jobs": "Minimum jobs before the degraded rule applies.",
  "health.p95_multiplier": "p95 above baseline times this means degraded.",
  "health.max_queue_wait_minutes": "Oldest queued wait that means degraded.",
  "health.recover_passes": "Passing evaluations needed to improve a state.",
  "rate_limit.per_minute": "Requests per minute allowed per API key.",
  "file.retention_days": "How long uploaded and output files are kept.",
  "alerts.failure_rate_threshold": "Model failure rate that raises an alert.",
  "alerts.low_credit_threshold": "Credit balance that raises a low-balance alert.",
};

const ORDER = ["health", "alerts", "rate_limit", "file", "billing", "jobs"];

export default function AdminSettingsPage() {
  const { isOwner } = useAuth();
  const toast = useToast();

  const settingsQuery = useQuery({
    queryKey: adminKeys.settings(),
    queryFn: () => adminApi.settings(),
    enabled: isOwner,
  });

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setDraft(Object.fromEntries(settingsQuery.data.data.map((row) => [row.key, row.value])));
    }
  }, [settingsQuery.data]);

  const original = useMemo(
    () => Object.fromEntries((settingsQuery.data?.data ?? []).map((row) => [row.key, row.value])),
    [settingsQuery.data],
  );

  const changed = useMemo(
    () => Object.keys(draft).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(original[key])),
    [draft, original],
  );

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Settings" />
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          Only an owner can change platform settings.
        </p>
      </div>
    );
  }

  const grouped = ORDER.map((prefix) => ({
    prefix,
    rows: (settingsQuery.data?.data ?? []).filter((row) => row.key.startsWith(prefix)),
  })).filter((group) => group.rows.length);

  return (
    <div className="max-w-3xl pb-24">
      <PageHeader
        title="Settings"
        description="Platform thresholds. Workers pick up changes within 30 seconds."
      />

      <QueryState
        isLoading={settingsQuery.isLoading}
        error={settingsQuery.error}
        empty={false}
        onRetry={() => void settingsQuery.refetch()}
      />

      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.prefix} className="card card-pad">
            <h2 className="mb-4 text-[13px] font-medium capitalize">{group.prefix.replace(/_/g, " ")}</h2>
            <div className="space-y-4">
              {group.rows.map((row) => (
                <div key={row.key} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)] sm:items-start sm:gap-6">
                  <div>
                    <label htmlFor={row.key} className="mono text-xs">
                      {row.key}
                    </label>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {HELP[row.key] ?? `Default: ${JSON.stringify(row.default)}`}
                    </p>
                  </div>
                  <SettingInput
                    id={row.key}
                    value={draft[row.key] ?? row.value}
                    onChange={(value) => setDraft((current) => ({ ...current, [row.key]: value }))}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {changed.length ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-[13px]">
              {changed.length} setting{changed.length === 1 ? "" : "s"} changed
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(original)}>
                Discard
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const values = Object.fromEntries(changed.map((key) => [key, draft[key]]));
                    await adminApi.saveSettings(values);
                    toast.success("Settings saved");
                    await settingsQuery.refetch();
                  } catch (error) {
                    toast.error("Could not save", friendlyError(error));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <select id={id} className="input" value={String(value)} onChange={(event) => onChange(event.target.value === "true")}>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  }

  if (typeof value === "number") {
    return (
      <input
        id={id}
        type="number"
        step="any"
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
      />
    );
  }

  if (Array.isArray(value)) {
    return (
      <input
        id={id}
        className="input"
        value={value.join(", ")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }

  return <input id={id} className="input" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}