"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import en from "../../messages/en.json";
import km from "../../messages/km.json";

export type Locale = "en" | "km";

type Catalog = Record<string, unknown>;

const catalogs: Record<Locale, Catalog> = { en, km };
const STORAGE_KEY = "dc-locale";

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /**
   * `t("nav.models")` looks the key up in the active catalog.
   * `t("page.someKey", "English text")` uses the fallback when the key is not
   * translated yet — pages can add copy without editing the shared catalogs.
   */
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function lookup(catalog: Catalog, key: string): string | undefined {
  const parts = key.split(".");
  let node: unknown = catalog;
  for (const part of parts) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "km" || saved === "en") setLocaleState(saved);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be blocked */
    }
    document.documentElement.lang = next;
    // Khmer needs a little more line height (frontend plan 3.2)
    document.documentElement.dataset.locale = next;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, fallback?: string) => {
      return lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? fallback ?? key;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}