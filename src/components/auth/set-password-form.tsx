"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const MIN_PASSWORD_LENGTH = 8;

/**
 * The one place `supabase.auth.updateUser({ password })` is called —
 * shared by /reset-password (after a recovery/invite email link) and
 * the in-app Account page's voluntary password change. `mode` only
 * changes copy and whether a current-password re-check runs first;
 * "change" re-verifies via `signInWithPassword` before updating, so a
 * hijacked-but-still-open session can't silently lock the real owner
 * out without ever proving they know the current password.
 */
export function SetPasswordForm({ mode, userEmail }: { mode: "reset" | "change"; userEmail?: string }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
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
      const supabase = createClient();

      if (mode === "change") {
        if (!userEmail) {
          setError("No signed-in user found.");
          return;
        }
        const { error: reauthError } = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword });
        if (reauthError) {
          setError("Current password is incorrect.");
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setDone(true);
      if (mode === "reset") {
        setTimeout(() => {
          router.push("/platform");
          router.refresh();
        }, 1500);
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
        {mode === "reset" ? "Password set. Taking you into VYRON FINANCE…" : "Password changed."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {mode === "change" && (
        <div>
          <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium text-vf-ink">
            Current password
          </label>
          <input
            id="current-password"
            name="current-password"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-vf-paper-border bg-vf-paper px-3.5 py-2.5 text-vf-ink outline-none focus:border-vf-red-500"
          />
        </div>
      )}

      <div>
        <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-vf-ink">
          New password
        </label>
        <input
          id="new-password"
          name="new-password"
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
        <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-vf-ink">
          Confirm new password
        </label>
        <input
          id="confirm-password"
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
        {loading ? "Saving…" : mode === "reset" ? "Set Password" : "Change Password"}
      </Button>
    </form>
  );
}
