"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";

import { PageHeader } from "@/components/common/states";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useToast } from "@/components/common/toast";
import { api, friendlyError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n, type Locale } from "@/lib/i18n";

const PREFS_KEY = "dc-prefs";

interface Prefs {
  defaultModel?: string;
  defaultSource?: string;
  defaultTarget?: string;
  webhookUrl?: string;
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { locale, setLocale } = useI18n();
  const toast = useToast();

  const modelsQuery = useQuery({ queryKey: queryKeys.models(), queryFn: () => api.models() });

  const [prefs, setPrefs] = useState<Prefs>({});
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs(JSON.parse(raw) as Prefs);
    } catch {
      /* storage blocked */
    }
    setLoaded(true);
  }, []);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };

  const models = modelsQuery.data?.data ?? [];
  const model = models.find((item) => item.id === prefs.defaultModel) ?? models[0];

  const testWebhook = async () => {
    const target = prefs.webhookUrl?.trim();
    if (!target) {
      toast.error("Add a webhook URL first");
      return;
    }
    setTesting(true);
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dubber-Event": "test" },
        body: JSON.stringify({
          event: "test",
          job_id: "job_test",
          status: "done",
          model: model?.id ?? "unknown",
          message: "This is a test delivery from Dubber Center.",
          sent_at: new Date().toISOString(),
        }),
      });
      if (response.ok) {
        toast.success("Webhook responded", `Received HTTP ${response.status}.`);
      } else {
        toast.error("Webhook returned an error", `HTTP ${response.status}. Expected a 2xx.`);
      }
    } catch (error) {
      toast.error("Could not reach the webhook", friendlyError(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        description="Your profile, defaults for new jobs, and webhook delivery."
      />

      <section className="card card-pad mb-4">
        <h2 className="mb-4 text-[13px] font-medium">Profile</h2>
        <dl className="space-y-2 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--text-muted)" }}>Email</dt>
            <dd>{user?.email ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--text-muted)" }}>Name</dt>
            <dd>{user?.name ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--text-muted)" }}>Plan</dt>
            <dd>{user?.plan ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--text-muted)" }}>Role</dt>
            <dd>{user?.role ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="card card-pad mb-4">
        <h2 className="mb-1 text-[13px] font-medium">Default model and languages</h2>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Prefilled in the dub studio. Stored in this browser.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="default-model" className="label">
              Model
            </label>
            <select
              id="default-model"
              className="input"
              value={model?.id ?? ""}
              onChange={(event) => update({ defaultModel: event.target.value })}
              disabled={!loaded || !models.length}
            >
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="default-source" className="label">
              From
            </label>
            <select
              id="default-source"
              className="input"
              value={prefs.defaultSource ?? model?.languages.source[0] ?? "en"}
              onChange={(event) => update({ defaultSource: event.target.value })}
              disabled={!model}
            >
              {(model?.languages.source ?? []).map((code) => (
                <option key={code} value={code}>
                  {code.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="default-target" className="label">
              To
            </label>
            <select
              id="default-target"
              className="input"
              value={prefs.defaultTarget ?? model?.languages.target[0] ?? "km"}
              onChange={(event) => update({ defaultTarget: event.target.value })}
              disabled={!model}
            >
              {(model?.languages.target ?? []).map((code) => (
                <option key={code} value={code}>
                  {code.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card card-pad mb-4">
        <h2 className="mb-1 text-[13px] font-medium">Webhook</h2>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Delivered per job when you pass <code className="mono">webhook_url</code>. Requests carry{" "}
          <code className="mono">X-Signature: sha256=&lt;hmac&gt;</code> over the raw body.
        </p>
        <label htmlFor="webhook-url" className="label">
          Endpoint
        </label>
        <input
          id="webhook-url"
          type="url"
          className="input"
          placeholder="https://my.site/hooks/dub"
          value={prefs.webhookUrl ?? ""}
          onChange={(event) => update({ webhookUrl: event.target.value })}
        />
        <div className="mt-3">
          <button type="button" className="btn btn-secondary" disabled={testing} onClick={() => void testWebhook()}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send test webhook
          </button>
        </div>
      </section>

      <section className="card card-pad mb-4">
        <h2 className="mb-4 text-[13px] font-medium">Appearance and language</h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[13px]">Theme</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Follow the system, or pick light or dark.
            </p>
          </div>
          <ThemeToggle />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[13px]">Interface language</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              English and Khmer.
            </p>
          </div>
          <select
            className="input w-auto"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            aria-label="Interface language"
          >
            <option value="en">English</option>
            <option value="km">ខ្មែរ</option>
          </select>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="mb-1 text-[13px] font-medium">Session</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Signing out ends this browser session. API keys stay valid until revoked.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void logout();
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}