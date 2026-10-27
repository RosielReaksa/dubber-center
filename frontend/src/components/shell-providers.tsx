"use client";

import { useState } from "react";

import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>{children}</AuthProvider>
    </I18nProvider>
  );
}

/** Shared input primitive with an inline error state (forms validate on blur). */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="label">{label}</span>
      {children}
      {error ? <p className="error-text">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent";
  className?: string;
}) {
  return <span className={cn("badge", `badge-${tone}`, className)}>{children}</span>;
}

/** Accessible disclosure used for "Technical details" and collapsible panels. */
export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-sm border", className)} style={{ borderColor: "var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px]"
      >
        <span>{summary}</span>
        <span aria-hidden style={{ color: "var(--text-faint)" }}>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? <div className="border-t px-3 py-2.5 text-xs" style={{ borderColor: "var(--border)" }}>{children}</div> : null}
    </div>
  );
}