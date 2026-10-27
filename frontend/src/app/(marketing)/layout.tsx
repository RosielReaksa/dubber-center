"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { AppProviders } from "@/components/shell-providers";
import { LocaleSwitcher } from "@/components/common/locale-switcher";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function MarketingNav() {
  const { t } = useI18n();
  const { user, loading, isStaff } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { href: "/models", label: t("nav.models") },
    { href: "/docs", label: t("nav.docs") },
    { href: "/status", label: t("nav.status") },
  ];

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur"
      style={{
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
        borderColor: "var(--border)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-page items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-medium">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-xs font-semibold"
            style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          >
            D
          </span>
          <span className="font-serif text-md">Dubber Center</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-sm px-2.5 py-1.5 text-[13px] transition-colors"
              style={{
                color: pathname.startsWith(link.href) ? "var(--text)" : "var(--text-muted)",
                background: pathname.startsWith(link.href) ? "var(--surface-2)" : "transparent",
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          {loading ? (
            <span className="skeleton h-8 w-20" />
          ) : user ? (
            <>
              {isStaff ? (
                <Link href="/admin" className="btn btn-secondary btn-sm">
                  {t("nav.admin")}
                </Link>
              ) : null}
              <Link href="/jobs" className="btn btn-primary btn-sm">
                {t("nav.jobs")}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                {t("nav.login")}
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                {t("nav.signup")}
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="ml-auto rounded-sm p-1.5 sm:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Menu"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open ? (
        <div className="border-t px-4 py-3 sm:hidden" style={{ borderColor: "var(--border)" }}>
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-sm px-2 py-2 text-sm">
                {link.label}
              </Link>
            ))}
            <Link href={user ? "/jobs" : "/login"} className="rounded-sm px-2 py-2 text-sm">
              {user ? t("nav.jobs") : t("nav.login")}
            </Link>
          </nav>
          <div className="mt-3 flex items-center gap-3">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="mt-24 border-t" style={{ borderColor: "var(--border)" }}>
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs sm:px-6 lg:px-8">
        <p style={{ color: "var(--text-faint)" }}>
          © {new Date().getFullYear()} Dubber Center. One API for every dubbing model.
        </p>
        <nav className="flex gap-4" aria-label="Footer">
          <Link href="/docs">Docs</Link>
          <Link href="/status">Status</Link>
          <Link href="/models">Models</Link>
          <a href="mailto:hello@example.com">Contact</a>
        </nav>
      </div>
    </footer>
  );
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <div className="flex min-h-screen flex-col">
        <MarketingNav />
        <main className={cn("mx-auto w-full max-w-page flex-1 px-4 py-10 sm:px-6 lg:px-8")}>
          {children}
        </main>
        <MarketingFooter />
      </div>
    </AppProviders>
  );
}