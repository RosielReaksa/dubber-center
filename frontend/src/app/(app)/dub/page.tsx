"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

import { Dropzone } from "@/components/upload/dropzone";
import { UploadProgress } from "@/components/upload/upload-progress";
import { PageHeader, QueryState } from "@/components/common/states";
import { StatusDot } from "@/components/common/status";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useToast } from "@/components/common/toast";
import { api, friendlyError, ApiError, type FileTicket, type Model } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuth } from "@/lib/auth/auth-context";
import { clock, languageName, money, pricePerMinute } from "@/lib/format";

const LAST_USED_KEY = "dc-last-dub";

/** 60 -> "60", 12.5 -> "12.5" (trim trailing zeros). */
function formatMax(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

interface LastUsed {
  model?: string;
  source?: string;
  target?: string;
}

function loadLastUsed(): LastUsed {
  try {
    const raw = window.localStorage.getItem(LAST_USED_KEY);
    return raw ? (JSON.parse(raw) as LastUsed) : {};
  } catch {
    return {};
  }
}

function saveLastUsed(value: LastUsed) {
  try {
    window.localStorage.setItem(LAST_USED_KEY, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}

/** Seconds, or null when the browser cannot decode the file. */
async function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const element = document.createElement("video");
    element.preload = "metadata";
    const finish = (value: number | null) => {
      URL.revokeObjectURL(objectUrl);
      element.removeAttribute("src");
      resolve(value);
    };
    element.onloadedmetadata = () => {
      const seconds = element.duration;
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    element.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 5000); // never block the form on metadata
    element.src = objectUrl;
  });
}

function DubStudio() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const { user } = useAuth();

  const modelsQuery = useQuery({
    queryKey: queryKeys.models(),
    queryFn: () => api.models(),
  });

  const models = useMemo(
    () => (modelsQuery.data?.data ?? []).filter((model) => model.status !== "disabled"),
    [modelsQuery.data],
  );

  // --- selection state ---------------------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [ticket, setTicket] = useState<FileTicket | null>(null);
  const [url, setUrl] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [durationSec, setDurationSec] = useState<number | null>(null);

  const [modelId, setModelId] = useState("");
  const [source, setSource] = useState("en");
  const [target, setTarget] = useState("km");
  const [subtitles, setSubtitles] = useState(true);
  const [background, setBackground] = useState(false);

  const [uploadError, setUploadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [switchTo, setSwitchTo] = useState<Model | null>(null);

  const requestedModel = search.get("model");

  // Restore the last used model/languages once (URL param wins).
  useEffect(() => {
    const last = loadLastUsed();
    const preferred = requestedModel ?? last.model;
    if (preferred) setModelId(preferred);
    if (last.source) setSource(last.source);
    if (last.target) setTarget(last.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default to the first usable model once the list arrives.
  useEffect(() => {
    if (!modelId && models.length) {
      const firstUsable = models.find((model) => model.health_state !== "down") ?? models[0];
      if (firstUsable) setModelId(firstUsable.id);
    }
  }, [modelId, models]);

  const model = models.find((item) => item.id === modelId) ?? null;

  // Keep the pair valid when the model changes.
  useEffect(() => {
    if (!model) return;
    if (!model.languages.source.includes(source)) setSource(model.languages.source[0] ?? "en");
    if (!model.languages.target.includes(target)) setTarget(model.languages.target[0] ?? "km");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  const pairSupported = !!model && model.languages.source.includes(source) && model.languages.target.includes(target);

  const alternatives = useMemo(
    () =>
      models.filter(
        (candidate) =>
          candidate.id !== model?.id &&
          candidate.health_state !== "down" &&
          candidate.languages.source.includes(source) &&
          candidate.languages.target.includes(target),
      ),
    [models, model?.id, source, target],
  );

  const minutes = durationSec !== null ? durationSec / 60 : null;
  const tooLong = !!model && minutes !== null && minutes > model.max_video_minutes;
  const estimate = model && minutes !== null ? minutes * model.price_per_minute : 0;
  const degradedMultiplier = model?.health_state === "degraded" ? 1.5 : 1;

  // --- video chosen ------------------------------------------------------
  const onFileChosen = useCallback(async (next: File | null) => {
    setFile(next);
    setTicket(null);
    setUploadError("");
    setSubmitError("");
    setUrl("");
    setInputMode("file");
    setDurationSec(null);
    if (next) {
      const seconds = await readDuration(next);
      setDurationSec(seconds);
    }
  }, []);

  const onUploaded = useCallback((next: FileTicket) => setTicket(next), []);

  // --- submit ------------------------------------------------------------
  const blockedReason = (() => {
    if (!model) return "Choose a model";
    if (inputMode === "file" && !ticket) return file ? "Wait for the upload to finish" : "Add a video";
    if (inputMode === "url" && !url.trim()) return "Add a video URL";
    if (!pairSupported) return "Choose a supported language pair";
    if (tooLong) return `Video is longer than ${formatMax(model.max_video_minutes)} min for ${model.name}`;
    if (user && user.credits <= 0) return "Add credits to start a job";
    if (estimate > (user?.credits ?? 0)) return "Estimated cost is above your balance";
    return null;
  })();

  const start = async (chosenModel: Model = model!) => {
    if (!chosenModel) return;
    setBusy(true);
    setSubmitError("");
    try {
      const job = await api.createJob({
        model: chosenModel.id,
        ...(inputMode === "file" ? { file_id: ticket?.file_id } : { video_url: url.trim() }),
        source_lang: source,
        target_lang: target,
        ...(minutes !== null ? { minutes: Number(minutes.toFixed(3)) } : {}),
        options: { subtitles, keep_background_audio: background },
      });
      saveLastUsed({ model: chosenModel.id, source, target });
      toast.success("Job started", "Opening the job page…");
      router.push(`/jobs/${job.job_id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "model_unavailable") {
        const fallback = alternatives[0] ?? null;
        setSwitchTo(fallback);
        setSubmitError(
          fallback
            ? `${chosenModel.name} became unavailable.`
            : `${chosenModel.name} became unavailable. Try again later.`,
        );
        setBusy(false);
        return;
      }
      setSubmitError(friendlyError(error));
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Dub a video"
        description="Pick a model and a language pair, then start. Jobs run in the background and always survive a refresh."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
        <div className="space-y-5">
          {/* --- 1. video ------------------------------------------- */}
          <section className="card card-pad">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-md">1. Video</h2>
              <div className="inline-flex rounded-sm border p-0.5" style={{ borderColor: "var(--border)" }}>
                {(["file", "url"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setInputMode(mode);
                      setTicket(null);
                      setFile(null);
                      setDurationSec(null);
                    }}
                    className="rounded px-2.5 py-1 text-xs"
                    style={{
                      background: inputMode === mode ? "var(--accent-soft)" : "transparent",
                      color: inputMode === mode ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    {mode === "file" ? "Upload" : "Paste URL"}
                  </button>
                ))}
              </div>
            </div>

            {inputMode === "file" ? (
              <>
                <Dropzone file={file} onChange={onFileChosen} disabled={busy} />
                {file && !ticket ? (
                  <UploadProgress file={file} onUploaded={onUploaded} onError={setUploadError} />
                ) : null}
                {ticket ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "var(--success)" }}>
                    <span aria-hidden>✓</span> Uploaded and ready
                  </p>
                ) : null}
                <p className="hint">mp4, mov, mkv or webm · up to 2 GB</p>
              </>
            ) : (
              <div>
                <label htmlFor="video-url" className="label">
                  Video URL
                </label>
                <input
                  id="video-url"
                  type="url"
                  className="input"
                  placeholder="https://example.com/video.mp4"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setSubmitError("");
                  }}
                />
                <p className="hint">The model downloads this URL itself. It must be publicly reachable.</p>
              </div>
            )}

            {uploadError ? (
              <p className="error-text" role="alert">
                {uploadError}
              </p>
            ) : null}
          </section>

          {/* --- 2. settings ---------------------------------------- */}
          <section className="card card-pad">
            <h2 className="mb-4 text-md">2. Settings</h2>
            <QueryState
              isLoading={modelsQuery.isLoading}
              error={modelsQuery.error}
              isEmpty={!models.length}
              empty="No dubbing models are available right now."
              onRetry={() => void modelsQuery.refetch()}
            />

            {models.length ? (
              <>
                <label htmlFor="model" className="label">
                  Model
                </label>
                <select
                  id="model"
                  className="input"
                  value={modelId}
                  onChange={(event) => {
                    setModelId(event.target.value);
                    setSubmitError("");
                  }}
                >
                  {models.map((item) => (
                    <option key={item.id} value={item.id} disabled={item.health_state === "down"}>
                      {item.name} — {item.id}
                      {item.health_state === "down" ? " (unavailable)" : ""}
                      {item.health_state === "degraded" ? " (degraded)" : ""}
                      {item.price_per_minute === 0 ? " · free" : ` · ${pricePerMinute(item.price_per_minute)}`}
                    </option>
                  ))}
                </select>

                {model ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StatusDot
                      state={model.health_state}
                      checkedAt={model.health_checked_at}
                      beta={model.status === "beta"}
                    />
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Up to {formatMax(model.max_video_minutes)} min · {model.max_concurrent} at a time
                    </span>
                  </div>
                ) : null}

                {model?.health_state === "degraded" ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: "var(--warning)" }}>
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                    This model is slower than usual. Estimated time is longer.
                  </p>
                ) : null}

                {model?.health_state === "down" ? (
                  <div
                    className="mt-3 rounded-sm border p-3 text-xs"
                    style={{ borderColor: "var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" }}
                  >
                    <p>{model.name} is not accepting new jobs right now.</p>
                    {alternatives.length ? (
                      <p className="mt-1.5">
                        Try {alternatives[0]?.name}:{" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setModelId(alternatives[0]!.id)}
                        >
                          switch to it
                        </button>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="source-lang" className="label">
                      From
                    </label>
                    <select
                      id="source-lang"
                      className="input"
                      value={source}
                      onChange={(event) => setSource(event.target.value)}
                    >
                      {(model?.languages.source ?? []).map((code) => (
                        <option key={code} value={code}>
                          {languageName(code)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="target-lang" className="label">
                      To
                    </label>
                    <select
                      id="target-lang"
                      className="input"
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                    >
                      {(model?.languages.target ?? []).map((code) => (
                        <option key={code} value={code}>
                          {languageName(code)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {model && !pairSupported ? (
                  <div
                    className="mt-3 rounded-sm border p-3 text-xs"
                    style={{ borderColor: "var(--warning)", background: "var(--warning-soft)", color: "var(--warning)" }}
                  >
                    <p>
                      {model.name} does not support {languageName(source)} → {languageName(target)}.
                    </p>
                    {alternatives.length ? (
                      <p className="mt-1.5">
                        Models that do:{" "}
                        {alternatives.slice(0, 3).map((candidate, index) => (
                          <span key={candidate.id}>
                            {index > 0 ? ", " : ""}
                            <button type="button" className="underline" onClick={() => setModelId(candidate.id)}>
                              {candidate.name}
                            </button>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <fieldset className="mt-4">
                  <legend className="label">Options</legend>
                  <div className="flex flex-wrap gap-5">
                    <label className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={subtitles}
                        onChange={(event) => setSubtitles(event.target.checked)}
                      />
                      Subtitles
                    </label>
                    <label className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={background}
                        onChange={(event) => setBackground(event.target.checked)}
                      />
                      Keep background audio
                    </label>
                  </div>
                </fieldset>
              </>
            ) : null}
          </section>
        </div>

        {/* --- 3. summary ------------------------------------------- */}
        <aside className="card card-pad h-fit lg:sticky lg:top-20">
          <h2 className="text-md">3. Summary</h2>

          <dl className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--text-muted)" }}>Video length</dt>
              <dd>{durationSec === null ? "Reading…" : clock(durationSec)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--text-muted)" }}>Model</dt>
              <dd className="mono">{model?.id ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--text-muted)" }}>Rate</dt>
              <dd>{model ? pricePerMinute(model.price_per_minute) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
              <dt style={{ color: "var(--text-muted)" }}>Estimated cost</dt>
              <dd className="font-medium">{minutes === null ? "—" : money(estimate)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--text-muted)" }}>Your credits</dt>
              <dd>{money(user?.credits ?? 0)}</dd>
            </div>
          </dl>

          {model?.health_state === "degraded" ? (
            <p className="mt-3 text-xs" style={{ color: "var(--warning)" }}>
              Estimated time is about {degradedMultiplier}× longer than usual.
            </p>
          ) : null}

          {tooLong ? (
            <p className="mt-3 text-xs" style={{ color: "var(--danger)" }}>
              This video is longer than {formatMax(model?.max_video_minutes)} min allows.{" "}
              {alternatives.length ? "Try another model, or a shorter video." : "Choose a shorter video."}
            </p>
          ) : null}

          {submitError ? (
            <p className="mt-3 text-[13px]" role="alert" style={{ color: "var(--danger)" }}>
              {submitError}
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn-primary btn-lg mt-5 w-full"
            disabled={busy || !!blockedReason}
            onClick={() => void start()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
            {busy ? "Starting…" : "Start dubbing"}
          </button>

          {blockedReason && !busy ? (
            <p className="mt-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {blockedReason}
            </p>
          ) : null}

          {user && user.credits <= 0 ? (
            <Link href="/credits" className="mt-3 block text-center text-xs underline" style={{ color: "var(--accent)" }}>
              Add credits
            </Link>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={!!switchTo}
        title="Model became unavailable"
        description={
          switchTo
            ? `${model?.name ?? "This model"} is not accepting jobs right now. Use ${switchTo.name} instead?`
            : "This model is not accepting jobs right now. Try again later."
        }
        confirmLabel={switchTo ? `Use ${switchTo.name}` : "OK"}
        onCancel={() => setSwitchTo(null)}
        onConfirm={() => {
          const next = switchTo;
          setSwitchTo(null);
          if (next) {
            setModelId(next.id);
            void start(next);
          }
        }}
      />
    </div>
  );
}

export default function DubPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <DubStudio />
    </Suspense>
  );
}