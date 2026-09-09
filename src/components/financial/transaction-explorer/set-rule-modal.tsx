"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { MATCH_TYPE_LABELS, type MatchType, type RuleCreationOptions, type RuleMatchField } from "./transaction-bulk-action-bar";
import type { BankTransactionRecord } from "@/server/accounting/types";

const MATCH_FIELD_LABELS: Record<RuleMatchField, string> = { description: "Description", beneficiary: "Beneficiary" };

/** Phase 29 — "Set Rule" used to fire the moment the checkbox was ticked,
 * always using `{ matchDescription: t.beneficiary, matchType: "contains" }`
 * — the FULL raw narration (e.g. "FNB OB Pmt FNB OB 000024505 Ren
 * Remuneration") as the match text, with no way for the accountant to
 * narrow it to the meaningful portion (e.g. "Ren Remuneration") before
 * the rule was created. This modal is the missing step: it shows the
 * full original description for context, lets the accountant edit the
 * search text and choose a match type from the SAME `MatchType`/
 * `MATCH_TYPE_LABELS` vocabulary `transaction-bulk-action-bar.tsx`'s own
 * `CreateRulePanel` already uses for the bulk-action-bar's equivalent
 * flow (one rule-options shape, reused here, not duplicated), and
 * displays the GL/VAT the row is about to be allocated to for context.
 * Saving here only stores the final `RuleCreationOptions` locally — the
 * rule itself is still only created when the row actually commits (see
 * `transaction-grid.tsx`'s `commitRow`), exactly like before.
 *
 * Phase 31B — "Match against" (`RuleMatchField`) makes explicit which of
 * the transaction's own fields the rule condition actually compares
 * against — `description` (the editable narration the accountant is
 * looking at) or `beneficiary` (the stable, never-edited field older
 * rules were built against). Both already exist in the rule engine's own
 * `CONDITION_FIELDS` vocabulary and the full Banking Rules page already
 * lets an accountant pick either — this only brings the inline flow in
 * line with a capability that already existed. The transaction's own
 * Description, this modal's Rule Search Text, and its Beneficiary are
 * three genuinely distinct values, deliberately never coupled beyond the
 * one-time default described on `searchTextTouched` below. */
export function SetRuleModal({
  transaction,
  currentDescription,
  accountLabel,
  accountTypeLabel,
  vatCode,
  initialOptions,
  onConfirm,
  onCancel,
}: {
  transaction: BankTransactionRecord;
  /** Phase 31A — the row's CURRENT description, including any not-yet-saved
   * edit this session (falls back to `transaction.description` when the
   * row hasn't been touched) — shown for context AND, Phase 31B, used as
   * the Rule Search Text's initial default (see `initialOptions`'s own
   * caller-side doc comment in `transaction-grid.tsx`). */
  currentDescription: string;
  /** The account/supplier/customer name the row is currently set to
   * allocate to (already resolved by the caller via the same
   * `accountDescriptionFor` helper `rulePreviewText` uses) — display
   * only, not editable here. */
  accountLabel: string;
  /** Phase 40, Live Defect 1 — this field label used to be hardcoded
   * "GL Account" regardless of the row's actual allocation Type, so a
   * Supplier rule's confirmation dialog displayed "GL Account — Three
   * Streams FISH" even though the underlying `accountLabel` value (and
   * the actual `set_supplier` action this modal creates) were already
   * correct — a pure display bug, not a data bug. The caller
   * (`transaction-grid.tsx`) derives this from the SAME `edit.type` that
   * `ruleTypeFor`/`ruleActionsFor` already use, so the label can never
   * disagree with what's actually stored. */
  accountTypeLabel: string;
  vatCode: string;
  initialOptions: RuleCreationOptions;
  onConfirm: (options: RuleCreationOptions) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<RuleCreationOptions>(initialOptions);
  // Phase 31B — "must NOT overwrite a deliberately entered Rule Search
  // Text." The ONLY thing that ever auto-fills the search text is the
  // "Match against" selector, and only until the accountant types into
  // the field themselves — the moment they do, this flips permanently
  // (for the rest of this modal session) and the selector only ever
  // changes which field the text is matched against, never the text.
  const [searchTextTouched, setSearchTextTouched] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panelRef);
  const searchTextEmpty = !options.matchDescription.trim();

  function textForField(field: RuleMatchField): string {
    return field === "description" ? currentDescription : transaction.beneficiary;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-rule-heading"
        tabIndex={-1}
        className="relative flex w-full max-w-lg flex-col gap-4 rounded-vf-lg bg-vf-paper p-6 shadow-2xl"
      >
        <h2 id="set-rule-heading" className="text-lg font-semibold text-vf-ink">
          Create Banking Rule
        </h2>

        <div>
          <span className="mb-1 block text-xs font-medium text-vf-ink-soft">Transaction Description</span>
          <p className="rounded-md border border-vf-paper-border bg-vf-paper-alt/60 px-3 py-2 text-sm text-vf-ink-soft">{currentDescription || transaction.description}</p>
        </div>

        <div>
          <label htmlFor="rule-match-field" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Match Against
          </label>
          <Select
            id="rule-match-field"
            className="max-w-[200px]"
            value={options.matchField}
            onChange={(e) => {
              const field = e.target.value as RuleMatchField;
              // Only re-derive the search text from the newly selected
              // field's own current value while nothing has been typed
              // yet — once the accountant has entered their own text,
              // switching fields changes ONLY what the rule matches
              // against, never the text itself.
              setOptions({ ...options, matchField: field, matchDescription: searchTextTouched ? options.matchDescription : textForField(field) });
            }}
          >
            {(Object.keys(MATCH_FIELD_LABELS) as RuleMatchField[]).map((f) => (
              <option key={f} value={f}>
                {MATCH_FIELD_LABELS[f]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-vf-ink-faint">
            {options.matchField === "description"
              ? "The rule compares future transactions' Description against the text below."
              : "The rule compares future transactions' Beneficiary against the text below — the same stable field older rules already use."}
          </p>
        </div>

        <div>
          <label htmlFor="rule-search-text" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Rule Search Text
          </label>
          <Input
            id="rule-search-text"
            autoFocus
            value={options.matchDescription}
            onChange={(e) => {
              setSearchTextTouched(true);
              setOptions({ ...options, matchDescription: e.target.value });
            }}
            placeholder="e.g. Ren Remuneration"
          />
          <p className="mt-1 text-xs text-vf-ink-faint">Edit this down to the meaningful part of the text — the rule does not have to match the entire narration.</p>
        </div>

        <div>
          <label htmlFor="rule-match-type" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Match
          </label>
          <Select id="rule-match-type" className="max-w-[200px]" value={options.matchType} onChange={(e) => setOptions({ ...options, matchType: e.target.value as MatchType })}>
            {(Object.keys(MATCH_TYPE_LABELS) as MatchType[]).map((mt) => (
              <option key={mt} value={mt}>
                {MATCH_TYPE_LABELS[mt]}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="block text-xs font-medium text-vf-ink-soft">{accountTypeLabel}</span>
            <span className="text-vf-ink">{accountLabel || "—"}</span>
          </div>
          <div>
            <span className="block text-xs font-medium text-vf-ink-soft">VAT Code</span>
            <span className="text-vf-ink">{vatCode || "—"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
            <input type="checkbox" checked={options.applyToRemaining} onChange={(e) => setOptions({ ...options, applyToRemaining: e.target.checked })} />
            Apply to Remaining Transactions
          </label>
          <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
            <input type="checkbox" checked={options.applyToFutureImports} onChange={(e) => setOptions({ ...options, applyToFutureImports: e.target.checked })} />
            Apply to Future Imports
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(options)} disabled={searchTextEmpty}>
            Save Rule
          </Button>
        </div>
      </div>
    </div>
  );
}
