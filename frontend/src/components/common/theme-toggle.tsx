"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "dc-theme";

export function ThemeToggle() {
  const [mode, setMode] = useState<Theme>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setMode(saved);
  }, []);

  const apply = (next: Theme) => {
    setMode(next);
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = next === "system" ? (systemDark ? "dark" : "light") : next;
    document.documentElement.setAttribute("data-theme", resolved);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
  };

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: "System theme", icon: <Monitor size={14} /> },
    { value: "light", label: "Light theme", icon: <Sun size={14} /> },
    { value: "dark", label: "Dark theme", icon: <Moon size={14} /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-sm border p-0.5"
      style={{ borderColor: "var(--border)" }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => apply(option.value)}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors"
          style={{
            background: mode === option.value ? "var(--accent-soft)" : "transparent",
            color: mode === option.value ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}