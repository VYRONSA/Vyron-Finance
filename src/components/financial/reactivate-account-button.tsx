"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconArchive } from "@/components/ui/icons";

/** Finding #021 — `reactivateBankAccount` (bank-account-service.ts) and
 * the PATCH route's `action: "reactivate"` case have existed since the
 * Archive feature shipped; this is the missing UI half — mirrors
 * `ArchiveAccountButton` exactly, the sibling action. */
export function ReactivateAccountButton({
  companyId,
  accountId,
  previewMode,
}: {
  companyId: string;
  accountId: number;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (previewMode) {
    return (
      <Button variant="ghostDark" size="sm" disabled title="Available once a production Supabase project is connected">
        <IconArchive className="h-3.5 w-3.5" />
        Reactivate Account
      </Button>
    );
  }

  async function handleReactivate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reactivate" }),
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
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghostDark" size="sm" onClick={handleReactivate} disabled={loading}>
        <IconArchive className="h-3.5 w-3.5" />
        {loading ? "Reactivating…" : "Reactivate Account"}
      </Button>
      {error && <span className="text-xs text-vf-red-300">{error}</span>}
    </div>
  );
}
