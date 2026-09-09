"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CompanyBankStatementEmail } from "@/server/company-bank-statement-email/types";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Phase 21B/21C — Bank Statement Email identity + real operational
 * status. Shows the company's stable inbound address (lazily created
 * server-side on first load) with a Copy action, and — only once
 * genuinely backed by stored data — when a statement was last received/
 * processed/failed. Never a fabricated "Active"/"Connected" status:
 * before any real email has ever arrived (`lastReceivedAt` is `null`),
 * this shows "Waiting for first statement," never a fake success. */
export function CompanyBankStatementEmailTab({ companyId }: { companyId: string }) {
  const [bankStatementEmail, setBankStatementEmail] = useState<CompanyBankStatementEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/companies/${companyId}/bank-statement-email`)
      .then(async (res) => ({ ok: res.ok, body: await res.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setError(body.error ?? "Couldn't load your bank statement email address.");
          return;
        }
        setBankStatementEmail(body.bankStatementEmail);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the API. Check the dev server is running.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handleCopy() {
    if (!bankStatementEmail?.emailAddress) return;
    await navigator.clipboard.writeText(bankStatementEmail.emailAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-vf-ink">Bank Statement Email</p>
        <p className="mt-0.5 max-w-[54ch] text-xs text-vf-ink-faint">
          A dedicated address for this company to receive bank statements by email. VYRON automatically processes
          supported statements sent here once this environment&apos;s inbound email routing is configured to deliver to it.
        </p>
      </div>

      {loading && <p className="text-sm text-vf-ink-faint">Loading…</p>}
      {error && (
        <p role="alert" className="text-sm text-vf-danger">
          {error}
        </p>
      )}

      {!loading &&
        !error &&
        bankStatementEmail &&
        (bankStatementEmail.emailAddress ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-vf-sm border border-vf-paper-border bg-vf-paper-alt px-3 py-2 font-mono text-sm text-vf-ink">
                {bankStatementEmail.emailAddress}
              </code>
              <Button variant="subtle" size="sm" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-vf-ink-faint">
              Send your bank statements to this address. VYRON will automatically process supported statements once
              this environment&apos;s inbound email is fully configured.
            </p>
            <dl className="mt-1 flex flex-col gap-1 text-xs text-vf-ink-faint">
              {!bankStatementEmail.lastReceivedAt ? (
                <div className="flex gap-1">
                  <dt className="font-medium text-vf-ink-soft">Status:</dt>
                  <dd>Waiting for first statement</dd>
                </div>
              ) : (
                <div className="flex gap-1">
                  <dt className="font-medium text-vf-ink-soft">Last received:</dt>
                  <dd>{formatTimestamp(bankStatementEmail.lastReceivedAt)}</dd>
                </div>
              )}
              {bankStatementEmail.lastSuccessfulImportAt && (
                <div className="flex gap-1">
                  <dt className="font-medium text-vf-ink-soft">Last processed:</dt>
                  <dd>{formatTimestamp(bankStatementEmail.lastSuccessfulImportAt)}</dd>
                </div>
              )}
              {bankStatementEmail.lastFailureAt && (
                <div className="flex gap-1">
                  <dt className="font-medium text-vf-danger">Last error:</dt>
                  <dd className="text-vf-danger">{formatTimestamp(bankStatementEmail.lastFailureAt)}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-vf-ink-faint">
            Your bank statement email address will appear here once this environment&apos;s inbound email domain is
            configured.
          </p>
        ))}
    </div>
  );
}
