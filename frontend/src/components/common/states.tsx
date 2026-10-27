"use client";

import { AlertCircle, Inbox, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}
    >
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: "var(--surface-2)", color: "var(--text-faint)" }}
        aria-hidden
      >
        {icon ?? <Inbox size={18} />}
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px]" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
        aria-hidden
      >
        <AlertCircle size={18} />
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px]" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn-secondary mt-4">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
      <Loader2 size={14} className="animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  action,
  breadcrumbs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Singular alias for `actions`, accepted for convenience. */
  action?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
}) {
  const controls = actions ?? action;
  return (
    <header className="mb-6">
      {breadcrumbs ? <div className="mb-3">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-[13px]" style={{ color: "var(--text-muted)" }}>
              {description}
            </p>
          ) : null}
        </div>
        {controls ? <div className="flex flex-wrap items-center gap-2">{controls}</div> : null}
      </div>
    </header>
  );
}

/**
 * Renders the loading, error or empty state for a query and nothing when there
 * is data to show. Pages draw their content next to it, so every screen gets all
 * three states without repeating the branching (spec section 8).
 */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  empty = "Nothing here yet.",
  skeleton,
  errorTitle,
  onRetry,
}: {
  isLoading?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  skeleton?: React.ReactNode;
  errorTitle?: string;
  onRetry?: () => void;
}) {
  if (isLoading) {
    return (
      <>
        {skeleton ?? (
          <div className="space-y-3">
            <div className="skeleton h-8 w-48" />
            <div className="skeleton h-40 w-full" />
            <div className="skeleton h-40 w-full" />
          </div>
        )}
      </>
    );
  }

  if (error) {
    const message =
      error instanceof Error ? error.message : "The request could not be completed.";
    return (
      <ErrorState
        title={errorTitle ?? "Could not load this page"}
        description={message}
        onRetry={onRetry}
      />
    );
  }

  if (isEmpty) {
    return typeof empty === "string" ? <EmptyState title={empty} /> : <>{empty}</>;
  }

  return null;
}