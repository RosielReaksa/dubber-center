"use client";

import { LogIn, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AppProviders } from "@/components/shell-providers";
import { useAuth } from "@/lib/auth/auth-context";
import { friendlyError } from "@/lib/api/client";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/jobs";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.push(next);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          className="input"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          className="input"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
        Sign in
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AppProviders>
      <div className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-center text-2xl">Welcome back</h1>
        <p className="mt-2 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
          Sign in to dub videos, manage keys and credits.
        </p>
        <Suspense fallback={<div className="mt-8 h-56 skeleton" />}>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
          New here?{" "}
          <Link href="/signup" className="underline" style={{ color: "var(--accent)" }}>
            Create an account
          </Link>
        </p>
      </div>
    </AppProviders>
  );
}