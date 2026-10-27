"use client";

import Link from "next/link";
import type { Model } from "@/lib/api/client";
import { pricePerMinute, languageName, typeLabel, relativeTime } from "@/lib/format";
import { CopyButton } from "@/components/common/copy-button";
import { StatusDot } from "@/components/common/status";

export function ModelCard({ model }: { model: Model }) {
  return <article className={`card flex flex-wrap items-center gap-4 p-4 ${model.health_state === "down" ? "opacity-60" : ""}`}>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Link className="font-medium hover:underline" href={`/models/${encodeURIComponent(model.id)}`}>{model.name}</Link><span className="badge badge-neutral">{typeLabel(model.type)}</span><span className="mono text-xs" style={{ color: "var(--text-muted)" }}>{model.id}</span><CopyButton value={model.id} label="ID" /></div>
      <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>{model.description || "No description provided."}</p><p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>{model.languages.source.slice(0, 2).map(languageName).join(", ")} → {model.languages.target.slice(0, 2).map(languageName).join(", ")}{model.languages.source.length + model.languages.target.length > 4 ? " + more" : ""}</p></div>
    <div className="flex items-center gap-5"><span className="text-sm">{pricePerMinute(model.price_per_minute)}</span><div><StatusDot state={model.health_state} checkedAt={model.health_checked_at} beta={model.status === "beta"} disabled={model.status === "disabled"} /><span className="block text-xs" style={{ color: "var(--text-faint)" }}>{relativeTime(model.health_checked_at)}</span></div></div>
  </article>;
}

export function ModelGridCard({ model }: { model: Model }) {
  return <div className={model.health_state === "down" ? "opacity-60" : ""}><ModelCard model={model} /></div>;
}
