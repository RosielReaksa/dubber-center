"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  ChartNoAxesColumn,
  FileClock,
  LayoutDashboard,
  ListChecks,
  Menu,
  Server,
  Settings,
  Users,
  Boxes,
  ScrollText,
} from "lucide-react";

import { AppProviders } from "@/components/shell-providers";
import { LocaleSwitcher } from "@/components/common/locale-switcher";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, minRole: "support" },
  { href: "/admin/models", label: "Models", icon: Boxes, minRole: "support" },
  { href: "/admin/jobs", label: "Jobs", icon: ListChecks, minRole: "support" },
  { href: "/admin/users", label: "Users", icon: Users, minRole: "support" },
  { href: "/admin/usage", label: "Usage", icon: ChartNoAxesColumn, minRole: "support" },
  { href: "/admin/queue", label: "Queue", icon: Server, minRole: "support" },
  { href: "/admin/alerts", label: "Alerts", icon: Bell, minRole: "support" },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, minRole: "support" },
  { href: "/admin/settings", label: "Settings", icon: Settings, minRole: "owner" },
] as const;

const RANK = { user: 0, support: 1, admin: 2, owner: 3 } as const;

function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { user, loading, isStaff, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!isStaff) router.replace("/jobs");
  }, [loading, user, isStaff, router, pathname]);

  const role = user?.role ?? "user";
  const visible = NAV.filter((item) => RANK[role] >= RANK[item.minRole]);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r transition-transform md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4" style={{ borderColor: "var(--border)" }}>
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-xs font-semibold"
            style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          >
            D
          </span>
          <span className="font-serif text-[15px]">Dubber Center</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Admin">
          {visible.map((item) => {
            const active =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px]"
                style={{
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon size={15} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
          <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {user?.email}
          </p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
            {role}
          </p>
          <Link
            href="/jobs"
            className="btn btn-ghost btn-sm mt-2 w-full justify-start"
            style={{ color: "var(--text-muted)" }}
          >
            ← Customer area
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm w-full justify-start"
            onClick={async () => {
              await logout();
              router.push("/");
            }}
          >
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--bg) 88%, transparent)",
          }}
        >
          <button
            type="button"
            className="rounded-sm p-1.5 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <Link href="/admin/jobs" className="hidden text-[13px] sm:block" style={{ color: "var(--text-muted)" }}>
            Search jobs…
          </Link>
          <div className="ml-auto flex items-center gap-2.5">
            <LocaleSwitcher />
            <ThemeToggle />
            <Link href="/admin/alerts" className="rounded-sm p-1.5" aria-label="Alerts">
              <Bell size={16} />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-admin flex-1 px-4 py-6 sm:px-6">
          {loading ? (
            <div className="space-y-4">
              <div className="skeleton h-8 w-56" />
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((key) => (
                  <div key={key} className="skeleton h-24" />
                ))}
              </div>
              <div className="skeleton h-64 w-full" />
            </div>
          ) : isStaff ? (
            children
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <AdminShell>{children}</AdminShell>
    </AppProviders>
  );
}