"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconArchive } from "@/components/ui/icons";

export function ArchiveAccountButton({
  companyId,
  accountId,
  previewMode,
}: {
  companyId: string;
  accountId: number;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (previewMode) {
    return (
      <Button variant="ghostDark" size="sm" disabled title="Available once a production Supabase project is connected">
        <IconArchive className="h-3.5 w-3.5" />
        Archive Account
      </Button>
    );
  }

  async function handleArchive() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-vf-on-dark-soft">Archive this account?</span>
        <Button variant="primary" size="sm" onClick={handleArchive} disabled={loading}>
          {loading ? "Archiving…" : "Confirm"}
        </Button>
        <Button variant="ghostDark" size="sm" onClick={() => setConfirming(false)} disabled={loading}>
          Cancel
        </Button>
        {error && <span className="text-xs text-vf-red-300">{error}</span>}
      </div>
    );
  }

  return (
    <Button variant="ghostDark" size="sm" onClick={() => setConfirming(true)}>
      <IconArchive className="h-3.5 w-3.5" />
      Archive Account
    </Button>
  );
}
