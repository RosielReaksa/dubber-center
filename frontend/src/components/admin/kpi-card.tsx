"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/common/states";

/** KPI tile: a big serif number that links to the filtered page it describes. */
export function KpiCard({
  label,
  value,
  href,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const color =
    tone === "positive" ? "var(--success)" : tone === "negative" ? "var(--danger)" : "var(--text)";

  const body = (
    <>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 font-serif text-2xl" style={{ color }}>
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
          {hint}
        </p>
      ) : null}
    </>
  );

  const className =
    "card block px-4 py-3.5 transition-colors" + (href ? " hover:bg-surface-2" : "");

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function KpiRow({ children, loading }: { children: React.ReactNode; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[86px]" />
        ))}
      </div>
    );
  }
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/** Section wrapper with an optional right-aligned action. */
export function AdminSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-medium">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AdminTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {total} {total === 1 ? "row" : "rows"}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {page} / {pages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Plain-language explanation for each check/job error code (6.8). */
export const ERROR_CODE_HELP: Record<string, string> = {
  provider_auth: "The provider key is invalid or expired.",
  provider_unavailable: "The provider service is down or returning errors.",
  provider_rate_limited: "The provider is rate-limiting requests.",
  gpu_unavailable: "The GPU was not visible to the worker.",
  disk_full: "The worker ran out of disk space.",
  service_unreachable: "The model service could not be contacted.",
  timeout: "The job ran past the model's time limit.",
  output_invalid: "The model returned an output that failed validation.",
  output_silent: "The dubbed audio was silent.",
  output_missing: "The expected output file was not created.",
  invalid_input: "The input video could not be used.",
  canceled: "The job was canceled.",
  unknown: "An unexpected error occurred.",
};

export function ErrorCode({ code }: { code: string | null | undefined }) {
  if (!code) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <span className="mono text-xs" title={ERROR_CODE_HELP[code] ?? code}>
      {code}
    </span>
  );
}