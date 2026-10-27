export function money(value: number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function pricePerMinute(value: number): string {
  if (value === 0) return "Free";
  return `${money(value)}/min`;
}

/** 754 → "12:34" */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/** 754 → "12 min 34 s" */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return secs ? `${minutes}m ${secs}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function minutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1) return `${Math.round(value * 60)}s`;
  return `${value.toFixed(1)} min`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, "second"],
    [3_600_000, "minute"],
    [86_400_000, "hour"],
    [2_592_000_000, "day"],
    [31_536_000_000, "month"],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return formatter.format(-Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return formatter.format(-Math.round(diff / 3_600_000), "hour");
  if (abs < 2_592_000_000) return formatter.format(-Math.round(diff / 86_400_000), "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function exactTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function shortId(id: string, length = 8): string {
  const tail = id.includes("_") ? id.split("_").pop() ?? id : id;
  return tail.slice(0, length);
}

export function languageName(code: string): string {
  const names: Record<string, string> = {
    en: "English",
    km: "Khmer",
    zh: "Chinese",
    th: "Thai",
    vi: "Vietnamese",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    es: "Spanish",
    de: "German",
    hi: "Hindi",
    id: "Indonesian",
    ms: "Malay",
    my: "Burmese",
    lo: "Lao",
    fil: "Filipino",
  };
  return names[code.toLowerCase()] ?? code.toUpperCase();
}

export function typeLabel(type: string): string {
  return { api: "API", local: "Local", hybrid: "Hybrid" }[type] ?? type;
}