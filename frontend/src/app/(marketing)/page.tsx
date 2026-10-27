"use client";

import Link from "next/link";
import { ArrowRight, Copy, Download, Mic, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AppProviders } from "@/components/shell-providers";
import { CopyButton } from "@/components/common/copy-button";
import { StatusDot } from "@/components/common/status";
import { api, friendlyError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { pricePerMinute, typeLabel } from "@/lib/format";

const CODE = `curl -X POST ${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/v1/dub \\
  -H "Authorization: Bearer $DUBBER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "paidv1",
    "video_url": "https://example.com/video.mp4",
    "source_lang": "en",
    "target_lang": "km"
  }'`;

function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.models(),
    queryFn: () => api.models(),
  });

  const featured = data?.data.filter((model) => model.status !== "disabled").slice(0, 3) ?? [];

  return (
    <div>
      {/* --- hero ---------------------------------------------------- */}
      <section className="py-14 sm:py-20">
        <p className="mb-4 inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="badge badge-accent">New</span>
          Model health and 30-day uptime, built in
        </p>
        <h1 className="max-w-3xl text-balance text-3xl">Every dubbing model, one API.</h1>
        <p className="mt-4 max-w-xl text-pretty text-md" style={{ color: "var(--text-muted)" }}>
          Pick a model by name, send a video, get a dubbed video back. Paid pipelines and local
          GPU models behind the same request shape.
        </p>
        <div className="mt-7 flex flex-wrap gap-2.5">
          <Link href="/models" className="btn btn-primary btn-lg">
            Browse models
            <ArrowRight size={15} />
          </Link>
          <Link href="/docs" className="btn btn-secondary btn-lg">
            Read the docs
          </Link>
        </div>

        <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-4 text-sm">
          <div>
            <dt style={{ color: "var(--text-faint)" }}>Models</dt>
            <dd className="font-serif text-xl">{isLoading ? "—" : (data?.total ?? 0)}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-faint)" }}>Languages</dt>
            <dd className="font-serif text-xl">
              {isLoading
                ? "—"
                : new Set([...(data?.languages.source ?? []), ...(data?.languages.target ?? [])])
                    .size}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-faint)" }}>Async jobs</dt>
            <dd className="font-serif text-xl">One request</dd>
          </div>
        </dl>
      </section>

      {/* --- featured ------------------------------------------------ */}
      <section className="border-t py-12" style={{ borderColor: "var(--border)" }}>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg">Featured models</h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
              Live from the registry, including current health.
            </p>
          </div>
          <Link href="/models" className="text-[13px] underline" style={{ color: "var(--accent)" }}>
            See all
          </Link>
        </div>

        {error ? (
          <p className="text-[13px]" style={{ color: "var(--danger)" }}>
            {friendlyError(error)}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading
            ? [0, 1, 2].map((key) => <div key={key} className="skeleton h-40" />)
            : featured.map((model) => (
                <Link
                  key={model.id}
                  href={`/models/${model.id}`}
                  className="card card-pad transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{model.name}</p>
                      <p className="mono mt-0.5 text-xs" style={{ color: "var(--text-faint)" }}>
                        {model.id}
                      </p>
                    </div>
                    <span className="badge badge-neutral">{typeLabel(model.type)}</span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
                    {model.description}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <StatusDot
                      state={model.health_state}
                      beta={model.status === "beta"}
                      checkedAt={model.health_checked_at}
                    />
                    <span style={{ color: "var(--text-muted)" }}>
                      {pricePerMinute(model.price_per_minute)}
                    </span>
                  </div>
                </Link>
              ))}
        </div>
      </section>

      {/* --- how it works -------------------------------------------- */}
      <section className="border-t py-12" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-lg">How it works</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {[
            { icon: Mic, title: "Pick a model", text: "Compare price, languages, speed and health." },
            { icon: Upload, title: "Send the video", text: "Upload directly or pass a URL. One request." },
            { icon: Download, title: "Download", text: "Dubbed video, audio, subtitles and timing JSON." },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <div
                  className="mb-3 flex h-8 w-8 items-center justify-center rounded-sm"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  <Icon size={16} />
                </div>
                <p className="text-[14px] font-medium">
                  <span style={{ color: "var(--text-faint)" }}>{index + 1}. </span>
                  {step.title}
                </p>
                <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
                  {step.text}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* --- code ---------------------------------------------------- */}
      <section className="border-t py-12" style={{ borderColor: "var(--border)" }}>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg">Try it</h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
              Jobs are async: create one, then poll or wait for a webhook.
            </p>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div
            className="flex items-center justify-between border-b px-4 py-2"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
          >
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <Copy size={12} /> curl
            </span>
            <CopyButton value={CODE} label="Copy" />
          </div>
          <pre className="overflow-x-auto p-4 text-xs leading-relaxed" style={{ color: "var(--text)" }}>
            {CODE}
          </pre>
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  return (
    <AppProviders>
      <Home />
    </AppProviders>
  );
}