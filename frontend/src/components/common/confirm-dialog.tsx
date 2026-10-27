"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Confirm dialog that names the object and the impact (frontend plan 8). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.4)" }}
      />
      <div
        className="relative w-full max-w-[440px] rounded-lg p-5 shadow-xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <h2 id="confirm-title" className="text-lg">
          {title}
        </h2>
        {description ? (
          <div className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={cn("btn", danger ? "btn-danger" : "btn-primary")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : (confirmLabel ?? "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}