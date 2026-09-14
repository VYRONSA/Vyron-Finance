"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TransactionDetailPanel } from "./transaction-detail-panel";
import { computeMatchStatus } from "./transaction-grid";
import {
  ATTENTION_GROUPS,
  classifyForReview,
  recommendedActionFor,
  type ReviewGroupKey,
} from "@/components/financial/transaction-review-classification";
import { IconShieldCheck } from "@/components/ui/icons";
import { MOCK_TRANSACTION_DETAILS } from "@/lib/mock/transaction-explorer-data";
import type { BankTransactionRecord, TransactionDetail } from "@/server/accounting/types";
import type { BankingException, ExceptionType } from "@/server/banking-rules/types";
import { formatAmount } from "@/lib/format";

function money(value: number): string {
  return formatAmount(value);
}

const GROUP_BADGE: Record<ReviewGroupKey, "warn" | "info"> = {
  possibleDuplicate: "warn",
  unusual: "warn",
  needsReview: "info",
  matched: "info",
  allocated: "info",
  ready: "info",
};

/**
 * Phase 9 — Transaction Intelligence Workspace. The "Needs Your
 * Attention" queue, and the fast open → decide → next loop around it.
 * Every mutation here calls the SAME `POST /transactions/bulk`
 * `{action:"review", ...}` endpoint `transaction-explorer.tsx`'s own
 * Accept/Reject buttons already call — no second mutation path. Detail
 * comes from the SAME `GET /transactions/{id}` endpoint and the SAME
 * `TransactionDetailPanel` component the main grid already uses.
 */
export function TransactionAttentionQueue({
  companyId,
  previewMode,
  initialItems,
  openExceptions,
}: {
  companyId: string;
  previewMode: boolean;
  initialItems: BankTransactionRecord[];
  openExceptions: BankingException[];
}) {
  const [items, setItems] = useState<BankTransactionRecord[]>(initialItems);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const exceptionsByTransaction = useMemo(() => {
    const map = new Map<number, ExceptionType[]>();
    for (const exc of openExceptions) {
      const list = map.get(exc.bankTransactionId) ?? [];
      list.push(exc.exceptionType);
      map.set(exc.bankTransactionId, list);
    }
    return map;
  }, [openExceptions]);

  const grouped = useMemo(() => {
    const buckets: Record<ReviewGroupKey, BankTransactionRecord[]> = { possibleDuplicate: [], unusual: [], needsReview: [], matched: [], allocated: [], ready: [] };
    for (const t of items) {
      buckets[classifyForReview(t, exceptionsByTransaction.get(t.id) ?? [])].push(t);
    }
    return buckets;
  }, [items, exceptionsByTransaction]);

  const attentionItems = useMemo(() => ATTENTION_GROUPS.flatMap((key) => grouped[key]), [grouped]);
  const selectedExceptions = selectedId !== null ? (exceptionsByTransaction.get(selectedId)?.length ? openExceptions.filter((e) => e.bankTransactionId === selectedId) : []) : [];

  function nextAttentionItem(afterId: number): BankTransactionRecord | null {
    const idx = attentionItems.findIndex((t) => t.id === afterId);
    if (idx === -1) return attentionItems[0] ?? null;
    return attentionItems.slice(idx + 1).find((t) => t.id !== afterId) ?? attentionItems.find((t) => t.id !== afterId) ?? null;
  }

  async function selectTransaction(t: BankTransactionRecord) {
    setSelectedId(t.id);
    setActionError(null);
    if (previewMode) {
      setDetail(MOCK_TRANSACTION_DETAILS[t.id] ?? null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/${t.id}`);
      const body = await res.json();
      if (res.ok) setDetail(body.detail);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
  }

  function skip() {
    if (selectedId === null) return;
    const next = nextAttentionItem(selectedId);
    if (next) void selectTransaction(next);
    else closeDetail();
  }

  async function handleReview(transactionId: number, newStatus: "Approved" | "Rejected") {
    if (previewMode) return;
    setMutating(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review", transactionIds: [transactionId], newStatus, note: "" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      const detailRes = await fetch(`/api/companies/${companyId}/transactions/${transactionId}`);
      const detailBody = await detailRes.json();
      const updated: BankTransactionRecord | undefined = detailRes.ok ? detailBody.detail?.transaction : undefined;
      const next = nextAttentionItem(transactionId);
      if (updated) setItems((prev) => prev.map((t) => (t.id === transactionId ? updated : t)));
      if (next) await selectTransaction(next);
      else closeDetail();
    } catch {
      setActionError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setMutating(false);
    }
  }

  if (attentionItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={<IconShieldCheck className="h-5 w-5" />}
            title="You're all caught up."
            description="VYRON has no transactions currently requiring review."
            action={
              <div className="flex flex-wrap items-center gap-3">
                <Button href="#all-transactions" variant="subtle" size="sm">
                  View All Transactions
                </Button>
                <Button href={`/company/${companyId}/bank-accounts`} variant="subtle" size="sm">
                  Go to Banking
                </Button>
                <Button href={`/company/${companyId}/import-centre`} variant="subtle" size="sm">
                  Import Statement
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Needs Your Attention</CardTitle>
            <CardDescription>
              {attentionItems.length} transaction{attentionItems.length === 1 ? "" : "s"} need{attentionItems.length === 1 ? "s" : ""} your attention.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0">
          {actionError && (
            <p role="alert" className="text-sm text-vf-danger">
              {actionError}
            </p>
          )}
          {attentionItems.slice(0, 12).map((t) => {
            const group = classifyForReview(t, exceptionsByTransaction.get(t.id) ?? []);
            const status = computeMatchStatus(t, false, false);
            const action = recommendedActionFor(group, t, companyId);
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-vf-md border border-vf-paper-border p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-vf-ink">{t.description || t.beneficiary || "—"}</p>
                    <Badge tone={GROUP_BADGE[group]}>{status.label}</Badge>
                    {t.ruleId !== null && <Badge tone="info">Processed by Banking Rule</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-vf-ink-faint">
                    {t.transactionDate ?? "No date"} · {money(t.debit || t.credit)} · {t.bankAccount || "Unknown account"}
                  </p>
                </div>
                {action.kind === "open-detail" ? (
                  <Button variant="subtle" size="sm" onClick={() => selectTransaction(t)}>
                    {action.label}
                  </Button>
                ) : (
                  <Button href={action.href!} variant="subtle" size="sm">
                    {action.label}
                  </Button>
                )}
              </div>
            );
          })}
          {attentionItems.length > 12 && (
            <p className="text-xs text-vf-ink-faint">
              +{attentionItems.length - 12} more —{" "}
              <a className="underline" href="#all-transactions">
                view every transaction below
              </a>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <TransactionDetailPanel
        detail={detail}
        loading={detailLoading || mutating}
        onClose={closeDetail}
        onSkip={attentionItems.length > 1 ? skip : undefined}
        previewMode={previewMode}
        exceptions={selectedExceptions}
        onAccept={() => {
          if (selectedId !== null) void handleReview(selectedId, "Approved");
        }}
        onReject={() => {
          if (selectedId !== null) void handleReview(selectedId, "Rejected");
        }}
      />
    </>
  );
}
