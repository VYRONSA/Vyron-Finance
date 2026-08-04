import { Badge } from "@/components/ui/badge";
import type { TransactionDetail } from "@/server/accounting/types";

/**
 * "Recovery Insights" — surfaces data the Matching/Allocation Engines
 * already computed at match time (confidence, rules triggered, reason,
 * the duplicate-payment flag). This is deliberately NOT a separate AI/ML
 * system: the reference app's own detail dialog does "zero new inference"
 * either (confirmed by research against `transaction_detail_builder.py`)
 * — everything here is a read of an existing, real, already-stored value.
 * "Learn Rule" now navigates to the Banking Rules workspace pre-filled
 * from this transaction's own beneficiary/GL account (Migration Roadmap
 * Module 6) — real, not a placeholder.
 */
export function TransactionRecoveryPanel({
  detail,
  onAccept,
  onReject,
  onLearnRule,
  previewMode,
}: {
  detail: TransactionDetail;
  onAccept: () => void;
  onReject: () => void;
  onLearnRule?: () => void;
  previewMode: boolean;
}) {
  const { transaction } = detail;
  const isDuplicate = transaction.requiredAction === "Review — possible duplicate payment";
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  return (
    <div className="flex flex-col gap-3 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-vf-ink">Recovery Insights</h3>
        {transaction.confidenceScore !== null && (
          <span className="font-mono text-sm tabular-nums text-vf-ink-soft">{transaction.confidenceScore.toFixed(0)}% confidence</span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm">
        {isDuplicate && (
          <div>
            <dt className="text-xs font-medium text-vf-danger">Possible duplicate payment</dt>
            <dd className="text-vf-ink-soft">{transaction.matchReason}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Likely supplier</dt>
          <dd className="text-vf-ink-soft">{transaction.matchedSupplierName ?? "None identified"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Likely customer</dt>
          <dd className="text-vf-ink-soft">{detail.matchedCustomer?.name ?? "None identified"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Merchant</dt>
          <dd className="text-vf-ink-soft">{detail.matchedMerchant?.name ?? "Not yet identified"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Suggested GL account</dt>
          <dd className="text-vf-ink-soft">{transaction.suggestedGlAccount ?? "Not yet suggested"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Suggested VAT treatment</dt>
          <dd className="text-vf-ink-soft">{transaction.suggestedVatCode ?? "Not yet suggested"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Reasoning</dt>
          <dd className="text-vf-ink-soft">{transaction.matchReason || transaction.allocationReason || "No reasoning recorded."}</dd>
        </div>
        {transaction.rulesTriggered.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-vf-ink-faint">Rules triggered</dt>
            <dd className="flex flex-wrap gap-1.5">
              {transaction.rulesTriggered.map((r) => (
                <Badge key={r} tone="info">
                  {r}
                </Badge>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-vf-paper-border pt-3">
        <button
          type="button"
          disabled={previewMode}
          title={disabledTitle}
          onClick={onAccept}
          className="rounded-full bg-vf-success/14 px-3 py-1.5 text-xs font-semibold text-[#1f6e4b] disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={previewMode}
          title={disabledTitle}
          onClick={onReject}
          className="rounded-full bg-vf-danger/14 px-3 py-1.5 text-xs font-semibold text-vf-danger disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={!onLearnRule}
          title={!onLearnRule ? "Available from the Transaction Explorer grid." : "Create a Banking Rule pre-filled from this transaction."}
          onClick={onLearnRule}
          className="rounded-full bg-vf-paper-border px-3 py-1.5 text-xs font-semibold text-vf-ink-soft disabled:opacity-50"
        >
          Learn Rule
        </button>
      </div>
    </div>
  );
}
