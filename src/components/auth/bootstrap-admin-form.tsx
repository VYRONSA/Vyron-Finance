"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const MIN_PASSWORD_LENGTH = 8;

export function BootstrapAdminForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => router.push("/login"), 1800);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't create the administrator account.");
      }
    } catch {
      setError("Couldn't reach the authentication service. Check your Supabase configuration.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-lg border border-vf-success/25 bg-vf-success/8 px-4 py-3 text-sm text-[#1f6e4b]">
        Platform Super Administrator created. Taking you to login…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="setup-email" className="mb-1.5 block text-sm font-medium text-vf-ink">
          Email address
        </label>
        <input
          id="setup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label htmlFor="setup-password" className="mb-1.5 block text-sm font-medium text-vf-ink">
          Password
        </label>
        <input
          id="setup-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
        />
      </div>

      <div>
        <label htmlFor="setup-confirm-password" className="mb-1.5 block text-sm font-medium text-vf-ink">
          Confirm password
        </label>
        <input
          id="setup-confirm-password"
          name="confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full" disabled={loading}>
        {loading ? "Creating…" : "Create Platform Super Administrator"}
      </Button>
    </form>
  );
}
