"use client";

import { Languages } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
      <Languages size={14} aria-hidden />
      <span className="sr-only">Language</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as "en" | "km")}
        className="cursor-pointer rounded-sm border bg-transparent px-1.5 py-1 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        <option value="en">English</option>
        <option value="km">ខ្មែរ</option>
      </select>
    </label>
  );
}