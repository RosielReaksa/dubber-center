"use client";

import { Check, Copy } from "lucide-react";

import { useCopy } from "@/hooks";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}

/** Copy control used on IDs, keys and snippets (principle 4). */
export function CopyButton({
  value,
  label,
  className,
  size = "sm",
  ariaLabel,
}: CopyButtonProps) {
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={ariaLabel ?? (copied ? "Copied" : `Copy ${label ?? value}`)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm transition-colors",
        size === "sm" ? "px-1.5 py-1 text-xs" : "px-2.5 py-1.5 text-[13px]",
        className,
      )}
      style={{ color: copied ? "var(--success)" : "var(--text-muted)" }}
    >
      {copied ? <Check size={size === "sm" ? 12 : 14} /> : <Copy size={size === "sm" ? 12 : 14} />}
      <span>{copied ? "Copied" : (label ?? "Copy")}</span>
    </button>
  );
}