"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBank, IconClock, IconRefresh } from "@/components/ui/icons";

export type ConnectedBankRow = {
  connectionId: number;
  linkedAccountId: number;
  provider: string;
  status: "PendingAuthorization" | "Connected" | "Disconnected" | "Error";
  bankAccountName: string;
  maskedAccountNumber: string;
  currentBalance: number;
  currency: string;
  lastSyncAt: string | null;
  lastSyncStatus: "Success" | "Failed" | "PartialFailure" | null;
  lastTransactionReceivedAt: string | null;
};

function money(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const CONNECTION_STATUS_TONE: Record<ConnectedBankRow["status"], "good" | "warn" | "danger" | "muted"> = {
  Connected: "good",
  PendingAuthorization: "warn",
  Error: "danger",
  Disconnected: "muted",
};

const SYNC_STATUS_TONE: Record<NonNullable<ConnectedBankRow["lastSyncStatus"]>, "good" | "warn" | "danger"> = {
  Success: "good",
  PartialFailure: "warn",
  Failed: "danger",
};

/**
 * Phase 16, Part 9 — Connected Banks foundation. Every row here is real
 * data the server already fetched (`listConnectedBanksForDisplay`) —
 * this component never invents a balance, a sync time, or a "Connected"
 * status. In Preview Mode (no Supabase project configured) there is no
 * real bank connection to show and none is fabricated; the empty state
 * and a disabled Connect action are the only things rendered, matching
 * how every other action on this page already behaves in Preview Mode.
 */
export function ConnectedBanksCard({ companyId, rows, previewMode }: { companyId: string; rows: ConnectedBankRow[]; previewMode: boolean }) {
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connectFnb() {
    if (previewMode || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "FNB", redirectAfter: `/company/${companyId}/bank-accounts` }),
      });
      const body = await res.json();
      if (!res.ok || !body.authorizationUrl) {
        setError(body.error ?? "Could not start the FNB connection. Please try again.");
        setConnecting(false);
        return;
      }
      // Real redirect to FNB's own authorization page — the customer
      // authenticates/consents there, never inside VYRON (brief, Part 4).
      window.location.href = body.authorizationUrl;
    } catch {
      setError("Could not start the FNB connection. Please try again.");
      setConnecting(false);
    }
  }

  async function syncNow(connectionId: number) {
    setSyncingId(connectionId);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-connections/${connectionId}/sync`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Sync failed. Please try again.");
      } else {
        window.location.reload();
      }
    } catch {
      setError("Sync failed. Please try again.");
    } finally {
      setSyncingId(null);
    }
  }

  async function disconnect(connectionId: number) {
    setDisconnectingId(connectionId);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-connections/${connectionId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not disconnect. Please try again.");
      } else {
        window.location.reload();
      }
    } catch {
      setError("Could not disconnect. Please try again.");
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2.5">
          <IconBank className="h-4 w-4 text-vf-red-600" />
          <div>
            <CardTitle>Connected Banks</CardTitle>
            <CardDescription>
              Direct bank feeds, in addition to manual statement import. Sync via &ldquo;Sync Now&rdquo; below — unattended
              scheduled syncing requires a configured cron job, not yet connected.
            </CardDescription>
          </div>
        </div>
        <Button variant="subtle" size="sm" disabled={previewMode || connecting} title={previewMode ? "Available once a production Supabase project is connected" : undefined} onClick={connectFnb}>
          <IconBank className="h-4 w-4" />
          {connecting ? "Connecting…" : "Connect FNB"}
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {error && <p className="mb-3 text-xs text-vf-danger">{error}</p>}
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconBank className="h-5 w-5" />}
            title="No banks connected yet"
            description="Connect FNB to sync balances and transactions directly, alongside manual statement import. VYRON never sees your online banking username or password — you authenticate and consent directly with FNB."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <li key={row.linkedAccountId} className="flex flex-col gap-2.5 rounded-vf-md border border-vf-paper-border p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-vf-ink">
                      {row.provider} — {row.bankAccountName}
                    </p>
                    <Badge tone={CONNECTION_STATUS_TONE[row.status]}>{row.status}</Badge>
                    {row.lastSyncStatus && <Badge tone={SYNC_STATUS_TONE[row.lastSyncStatus]}>Sync: {row.lastSyncStatus}</Badge>}
                  </div>
                  <p className="text-xs text-vf-ink-faint">{row.maskedAccountNumber || "Account number not yet available"}</p>
                  <p className="font-mono text-lg font-semibold tabular-nums text-vf-ink">{money(row.currentBalance, row.currency)}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-vf-ink-faint">
                    <span className="flex items-center gap-1">
                      <IconClock className="h-3.5 w-3.5" />
                      Last sync {formatDateTime(row.lastSyncAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <IconClock className="h-3.5 w-3.5" />
                      Last transaction {formatDateTime(row.lastTransactionReceivedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="subtle" size="sm" disabled={row.status !== "Connected" || syncingId === row.connectionId} onClick={() => syncNow(row.connectionId)}>
                    <IconRefresh className="h-4 w-4" />
                    {syncingId === row.connectionId ? "Syncing…" : "Sync Now"}
                  </Button>
                  <Button variant="danger" size="sm" disabled={disconnectingId === row.connectionId} onClick={() => disconnect(row.connectionId)}>
                    {disconnectingId === row.connectionId ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
