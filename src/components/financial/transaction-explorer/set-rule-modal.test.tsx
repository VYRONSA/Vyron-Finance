/**
 * Phase 29 — "Set Rule is not sufficient... the user must be able to
 * edit the Rule Search Text before saving the rule." This modal is the
 * fix: it must show the full original description for context, let the
 * accountant edit the search text away from the full raw narration
 * (e.g. down to "Ren Remuneration"), and choose a match type — never
 * silently create the rule with a hardcoded criterion.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SetRuleModal } from "./set-rule-modal";
import type { RuleCreationOptions } from "./transaction-bulk-action-bar";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-08-01", reference: "", description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration",
    beneficiary: "FNB OB Pmt FNB OB 000024505 Ren Remuneration", debit: 25000, credit: 0, balance: null, bankAccount: "Cheque Account",
    bankAccountId: 1, glAccount: "", vat: null, notes: "", importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null, confidenceScore: null,
    rulesTriggered: [], matchReason: "", requiredAction: null, suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null,
    allocationReason: "", isManualOverride: false, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null,
    matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported",
    captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

const defaultOptions: RuleCreationOptions = { matchField: "beneficiary", matchDescription: "FNB OB Pmt FNB OB 000024505 Ren Remuneration", matchType: "contains", applyToRemaining: true, applyToFutureImports: true };

describe("SetRuleModal (Phase 29)", () => {
  it("shows the full original transaction description for context", () => {
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("FNB OB Pmt FNB OB 000024505 Ren Remuneration")).toBeInTheDocument();
  });

  // Phase 31A — the transaction Description became editable via the
  // grid's own inline row; `currentDescription` is how the caller passes
  // the row's CURRENT (possibly just-edited, not-yet-saved) description
  // into this modal's context box, instead of the stale server value.
  it("shows the CURRENT (edited) description for context, not the stale original transaction.description, when the two differ", () => {
    render(
      <SetRuleModal
        transaction={txn()}
        currentDescription="Ren Remuneration"
        accountLabel="Salaries & Wages" accountTypeLabel="GL Account"
        vatCode=""
        initialOptions={defaultOptions}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Ren Remuneration")).toBeInTheDocument();
    expect(screen.queryByText("FNB OB Pmt FNB OB 000024505 Ren Remuneration")).not.toBeInTheDocument();
  });

  // Item 4/9 — "use the changed description when creating a rule" is
  // satisfied by showing it for context/reference; it must NOT silently
  // become the Rule Search Text default (which stays anchored to
  // whatever the caller's `initialOptions` already resolved, unchanged).
  it("editing the transaction description does not change the Rule Search Text default — Set Rule stays an explicit, independent action", () => {
    render(
      <SetRuleModal
        transaction={txn()}
        currentDescription="Ren Remuneration"
        accountLabel="Salaries & Wages" accountTypeLabel="GL Account"
        vatCode=""
        initialOptions={defaultOptions}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText("Rule Search Text") as HTMLInputElement;
    expect(input.value).toBe(defaultOptions.matchDescription); // untouched by the edited description
  });

  it("defaults the Rule Search Text to the transaction's beneficiary, but it is editable", () => {
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={() => {}} onCancel={() => {}} />);
    const input = screen.getByLabelText("Rule Search Text") as HTMLInputElement;
    expect(input.value).toBe("FNB OB Pmt FNB OB 000024505 Ren Remuneration");
    fireEvent.change(input, { target: { value: "Ren Remuneration" } });
    expect(input.value).toBe("Ren Remuneration");
  });

  it("confirms with the EDITED search text, not the full original description — the exact Phase 29 requirement", () => {
    const onConfirm = vi.fn();
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Rule Search Text"), { target: { value: "Ren Remuneration" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ matchDescription: "Ren Remuneration", matchType: "contains" }));
  });

  it("lets the user change the match type away from the default Contains", () => {
    const onConfirm = vi.fn();
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "exact" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ matchType: "exact" }));
  });

  it("shows the GL account and VAT code the row is currently set to allocate to, read-only", () => {
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="STD" initialOptions={defaultOptions} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Salaries & Wages")).toBeInTheDocument();
    expect(screen.getByText("STD")).toBeInTheDocument();
  });

  // Phase 40, Live Defect 1 — production screenshot: a Supplier rule
  // ("Description contains Fish" → "Supplier → Three Streams FISH")
  // displayed "GL Account — Three Streams FISH". The underlying
  // set_supplier action/targetId were always correct (see
  // transaction-grid.test.tsx's ruleActionsFor coverage) — this was
  // purely the confirmation dialog's field LABEL always reading "GL
  // Account" regardless of the row's real allocation Type. The caller
  // now derives this label from the same Type ruleActionsFor uses
  // (`accountTypeLabelFor`), so it can never disagree with reality again.
  it("Live Defect 1 — labels the resolved target 'Supplier', not 'GL Account', for a Supplier rule", () => {
    render(
      <SetRuleModal
        transaction={txn()}
        currentDescription="Three Streams Fish invoice"
        accountLabel="Three Streams FISH"
        accountTypeLabel="Supplier"
        vatCode=""
        initialOptions={{ matchField: "description", matchDescription: "Fish", matchType: "contains", applyToRemaining: true, applyToFutureImports: true }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Supplier")).toBeInTheDocument();
    expect(screen.getByText("Three Streams FISH")).toBeInTheDocument();
    expect(screen.queryByText("GL Account")).not.toBeInTheDocument();
  });

  it("Live Defect 1 — labels the resolved target 'Customer' for a Customer rule", () => {
    render(
      <SetRuleModal
        transaction={txn()}
        currentDescription={txn().description}
        accountLabel="Meridian Traders"
        accountTypeLabel="Customer"
        vatCode=""
        initialOptions={defaultOptions}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.queryByText("GL Account")).not.toBeInTheDocument();
  });

  // Phase 29A, Section 8 — "Click Set Rule again → reopen the existing
  // pending Rule Creation options... preserve the current pending search
  // text and Match Type." `transaction-grid.tsx` wires the "i" preview
  // button's onEdit to reopen this SAME modal with
  // `ruleOptionsByTransaction.get(id)` (the previously-confirmed options)
  // as `initialOptions` instead of the hardcoded default — this proves
  // the modal itself correctly seeds from and preserves ANY given
  // initialOptions, not just the default, which is the property that fix
  // depends on.
  it("reopening with previously-confirmed options (not the default) shows and preserves exactly that edited state — the Set Rule reopen fix", () => {
    const previouslyConfirmed: RuleCreationOptions = { matchField: "beneficiary", matchDescription: "Ren Remuneration", matchType: "exact", applyToRemaining: false, applyToFutureImports: true };
    const onConfirm = vi.fn();
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={previouslyConfirmed} onConfirm={onConfirm} onCancel={() => {}} />);

    const input = screen.getByLabelText("Rule Search Text") as HTMLInputElement;
    expect(input.value).toBe("Ren Remuneration"); // NOT reset to the full beneficiary
    expect((screen.getByLabelText("Match") as HTMLSelectElement).value).toBe("exact");
    expect(screen.getByRole("checkbox", { name: "Apply to Remaining Transactions" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Apply to Future Imports" })).toBeChecked();

    // Saving again without further edits preserves the reopened state exactly.
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(onConfirm).toHaveBeenCalledWith(previouslyConfirmed);
  });

  it("Cancel calls onCancel without ever calling onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables Save Rule when the search text is emptied out", () => {
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Rule Search Text"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save Rule" })).toBeDisabled();
  });

  it("preserves applyToRemaining/applyToFutureImports from the initial options and lets them be toggled", () => {
    const onConfirm = vi.fn();
    render(<SetRuleModal transaction={txn()} currentDescription={txn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={defaultOptions} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to Future Imports" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ applyToRemaining: true, applyToFutureImports: false }));
  });
});

// Phase 31B — "Match Against" (description vs. beneficiary). Both fields
// already exist in the rule engine's own vocabulary; this is purely the
// UI making the choice explicit and correctly keeping the three values
// (Transaction Description, Rule Search Text, Beneficiary) independent.
describe("SetRuleModal — Match Against (Phase 31B)", () => {
  // Distinct beneficiary/description text is what makes the field
  // choice's effect on the search-text default actually observable.
  const distinctTxn = () => txn({ description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration", beneficiary: "REN REMUNERATION CC" });
  const descriptionDefault: RuleCreationOptions = {
    matchField: "description",
    matchDescription: "FNB OB Pmt FNB OB 000024505 Ren Remuneration",
    matchType: "contains",
    applyToRemaining: true,
    applyToFutureImports: true,
  };

  it("item 10 — defaults to Description, exposing the current transaction text as the starting point for the rule search", () => {
    render(
      <SetRuleModal transaction={distinctTxn()} currentDescription={distinctTxn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={descriptionDefault} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect((screen.getByLabelText("Match Against") as HTMLSelectElement).value).toBe("description");
    expect((screen.getByLabelText("Rule Search Text") as HTMLInputElement).value).toBe("FNB OB Pmt FNB OB 000024505 Ren Remuneration");
  });

  it("switching Match Against re-derives the search text from the NEWLY selected field, as long as the text hasn't been manually edited yet", () => {
    render(
      <SetRuleModal transaction={distinctTxn()} currentDescription={distinctTxn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={descriptionDefault} onConfirm={() => {}} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Match Against"), { target: { value: "beneficiary" } });
    expect((screen.getByLabelText("Rule Search Text") as HTMLInputElement).value).toBe("REN REMUNERATION CC");
  });

  it("item 13 — once the Rule Search Text has been deliberately edited, switching Match Against never overwrites it", () => {
    render(
      <SetRuleModal transaction={distinctTxn()} currentDescription={distinctTxn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={descriptionDefault} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const searchInput = screen.getByLabelText("Rule Search Text") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "Ren Remuneration" } }); // deliberate edit
    fireEvent.change(screen.getByLabelText("Match Against"), { target: { value: "beneficiary" } });
    expect(searchInput.value).toBe("Ren Remuneration"); // untouched by the field switch
  });

  it("item 15 — the saved rule uses the intended configured search value AND the intended match field together", () => {
    const onConfirm = vi.fn();
    render(
      <SetRuleModal transaction={distinctTxn()} currentDescription={distinctTxn().description} accountLabel="Salaries & Wages" accountTypeLabel="GL Account" vatCode="" initialOptions={descriptionDefault} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Rule Search Text"), { target: { value: "Ren Remuneration" } });
    fireEvent.change(screen.getByLabelText("Match Against"), { target: { value: "beneficiary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ matchField: "beneficiary", matchDescription: "Ren Remuneration" }));
  });
});
