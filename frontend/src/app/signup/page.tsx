"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { AppProviders } from "@/components/shell-providers";
import { useAuth } from "@/lib/auth/auth-context";
import { friendlyError } from "@/lib/api/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

function SignupForm() {
  const { signup } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/jobs";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(email, password, name || undefined);
      router.push(next);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor="name" className="label">
          Name <span style={{ color: "var(--text-faint)" }}>(optional)</span>
        </label>
        <input
          id="name"
          className="input"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
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
          minLength={8}
          className="input"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="hint">At least 8 characters.</p>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : null}
        Create account
      </button>
    </form>
  );
}

export default function SignupPage() {
  return (
    <AppProviders>
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-center text-2xl">Create your account</h1>
        <p className="mt-2 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
          Start with a free account. No card required.
        </p>
        <Suspense fallback={<div className="mt-8 h-64 skeleton" />}>
          <SignupForm />
        </Suspense>
      </div>
    </AppProviders>
  );
}