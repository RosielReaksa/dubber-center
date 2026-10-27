"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  toast: (input: Omit<Toast, "id" | "variant"> & { variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, "id" | "variant"> & { variant?: ToastVariant }) => {
      const id = nextId++;
      setToasts((current) => [...current, { ...input, id, variant: input.variant ?? "default" }]);
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: "success" }),
      error: (title, description) => toast({ title, description, variant: "error" }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-md border p-3.5 shadow-lg",
              "animate-in",
            )}
            style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {item.description}
                </p>
              ) : null}
              {item.action ? (
                <button
                  type="button"
                  onClick={item.action.onClick}
                  className="mt-1.5 text-xs font-medium underline"
                  style={{ color: "var(--accent)" }}
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
            <span
              aria-hidden
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{
                background:
                  item.variant === "success"
                    ? "var(--success)"
                    : item.variant === "error"
                      ? "var(--danger)"
                      : "var(--accent)",
              }}
            />
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="rounded p-0.5"
              style={{ color: "var(--text-faint)" }}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}