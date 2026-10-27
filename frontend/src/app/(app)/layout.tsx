"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Mic,
  Settings,
  ShieldCheck,
  ChartNoAxesColumn,
} from "lucide-react";

import { AppProviders, Badge } from "@/components/shell-providers";
import { LocaleSwitcher } from "@/components/common/locale-switcher";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useAuth } from "@/lib/auth/auth-context";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function AppChrome({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { user, loading, logout, isStaff } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  const nav = [
    { href: "/dub", label: t("nav.studio"), icon: Mic },
    { href: "/jobs", label: t("nav.jobs"), icon: LayoutDashboard },
    { href: "/keys", label: t("nav.keys"), icon: KeyRound },
    { href: "/credits", label: t("nav.credits"), icon: CreditCard },
    { href: "/usage", label: t("nav.usage"), icon: ChartNoAxesColumn },
    { href: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto flex h-14 max-w-page items-center gap-4 px-4 sm:px-6">
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

          <nav className="ml-4 hidden items-center gap-0.5 md:flex" aria-label="Customer area">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px]"
                  style={{
                    color: active ? "var(--text)" : "var(--text-muted)",
                    background: active ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <Icon size={14} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Admin is reachable only by staff; there is no separate admin login. */}
          {isStaff ? (
            <Link
              href="/admin"
              className="hidden items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] lg:inline-flex"
              style={{
                color: "var(--accent)",
                background: "var(--accent-soft)",
              }}
            >
              <ShieldCheck size={14} aria-hidden />
              {t("nav.admin")}
            </Link>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <span className="hidden items-center gap-2 sm:inline-flex">
                <Badge tone="neutral">{money(user.credits)} credits</Badge>
              </span>
            ) : null}
            <LocaleSwitcher />
            <ThemeToggle />
            {user ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  await logout();
                  router.push("/");
                }}
              >
                {t("nav.logout")}
              </button>
            ) : null}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden" style={{ borderColor: "var(--border)" }}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap rounded-sm px-2.5 py-1 text-xs",
                pathname.startsWith(item.href) ? "font-medium" : "",
              )}
              style={{ color: pathname.startsWith(item.href) ? "var(--text)" : "var(--text-muted)" }}
            >
              {item.label}
            </Link>
          ))}
          {isStaff ? (
            <Link
              href="/admin"
              className="whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium"
              style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
            >
              {t("nav.admin")}
            </Link>
          ) : null}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-page flex-1 px-4 py-8 sm:px-6">
        {loading ? (
          <div className="space-y-4">
            <div className="skeleton h-8 w-48" />
            <div className="skeleton h-40 w-full" />
          </div>
        ) : user ? (
          children
        ) : null}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <AppChrome>{children}</AppChrome>
    </AppProviders>
  );
}