"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

/** Sent as a request header — never as part of a URL or the request body. */
const BOOTSTRAP_SECRET_HEADER = "x-vyron-bootstrap-secret";

/** Invites the first Platform Super Administrator. No password is chosen
 * here: the invitee sets their own from the emailed link. */
export function BootstrapAdminForm() {
  const [setupSecret, setSetupSecret] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; reissued: boolean } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!setupSecret) {
      setError("Enter the setup secret configured for this installation.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter the platform owner's email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json", [BOOTSTRAP_SECRET_HEADER]: setupSecret },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvited({ email, reissued: data.outcome === "reissued" });
        setSetupSecret("");
      } else {
        setError(data.error ?? "Couldn't send the invitation.");
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  if (invited) {
    return (
      <p role="status" className="rounded-lg border border-vf-success/25 bg-vf-success/8 px-4 py-3 text-sm text-[#1f6e4b]">
        {invited.reissued ? "Invitation sent again" : "Invitation sent"} to {invited.email}. Open the link in that email to set your password. Setup is
        complete once the invitation has been accepted.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="setup-secret" className="mb-1.5 block text-sm font-medium text-vf-ink">
          Setup secret
        </label>
        <PasswordInput id="setup-secret" name="setup-secret" required autoComplete="off" value={setupSecret} onChange={(e) => setSetupSecret(e.target.value)} />
      </div>

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

      {error && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full" disabled={loading}>
        {loading ? "Sending…" : "Send administrator invitation"}
      </Button>
    </form>
  );
}
