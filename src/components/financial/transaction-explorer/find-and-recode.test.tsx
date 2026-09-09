/**
 * Phase 38 — Phase 37's production audit found Inactive suppliers
 * (deactivated merge duplicates) selectable in both Find & Recode's
 * "Supplier" search filter and its recode-target picker, since both
 * built their `<option>` list from the raw `suppliers` prop with no
 * status filter.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { FindAndRecode } from "./find-and-recode";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> & Pick<BankTransactionRecord, "id">): BankTransactionRecord {
  return {
    companyId: "co_1", transactionDate: "2026-07-01", reference: "REF-1", description: "Payment", beneficiary: "ABC",
    debit: 100, credit: 0, balance: null, bankAccount: "MAIN", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-07-01T00:00:00Z", allocationStatus: "Unallocated",
    matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [],
    matchReason: "", requiredAction: null, suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null,
    allocationReason: "", isManualOverride: false, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null,
    allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null, reconciliationId: null,
    reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null,
    ...overrides,
  };
}

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

const ACTIVE_SUPPLIER = supplier({ id: 1, name: "Active Supplies", status: "Active" });
const INACTIVE_SUPPLIER = supplier({ id: 2, name: "Deactivated Duplicate", status: "Inactive" });

function baseProps(overrides: Partial<Parameters<typeof FindAndRecode>[0]> = {}) {
  return {
    companyId: "co_1",
    previewMode: false,
    bankAccounts: [],
    chartOfAccounts: [],
    suppliers: [ACTIVE_SUPPLIER, INACTIVE_SUPPLIER],
    customers: [],
    vatTreatments: [],
    initialPresets: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Find & Recode — Supplier filter Active-only (Phase 38)", () => {
  it("the Supplier search filter shows only the Active supplier", () => {
    render(<FindAndRecode {...baseProps()} />);
    // The "Supplier" filter label is a plain sibling `<label>` (no
    // `htmlFor`/`aria-label`), so it isn't reachable via `getByLabelText`
    // — locate its `<select>` by DOM proximity instead of adding a
    // test-only attribute to the component.
    const label = screen.getByText("Supplier", { selector: "label" });
    const filter = label.parentElement?.querySelector("select") as HTMLSelectElement;
    expect(filter).toBeTruthy();
    const optionLabels = Array.from(filter.options).map((o) => o.text);
    expect(optionLabels).toContain("Active Supplies");
    expect(optionLabels).not.toContain("Deactivated Duplicate");
  });
});

describe("Find & Recode — recode-target Supplier picker Active-only (Phase 38)", () => {
  it("the 'New supplier' recode-target picker shows only the Active supplier", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ transactions: [txn({ id: 1 })], hasMore: false }) })));
    render(<FindAndRecode {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select all matching" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Select all matching" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Change & Recode" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "supplier" } });

    const picker = (await screen.findByLabelText("New supplier")) as HTMLSelectElement;
    const optionLabels = Array.from(picker.options).map((o) => o.text);
    expect(optionLabels).toContain("Active Supplies");
    expect(optionLabels).not.toContain("Deactivated Duplicate");
  });
});

/**
 * Phase 46, Part B — the "Change & Recode" action used to live in a
 * SEPARATE box below the full results table, and the outcome banner
 * rendered at the very bottom of the page below THAT — reaching either
 * one meant scrolling past the whole results table. These prove the
 * merged top-workflow block: the action panel is visible immediately once
 * a search has run (disabled with a helper message until something is
 * selected), the target picker switches with the account type, the
 * confirmation names the exact count/type/target, and the result renders
 * in that same block — never requiring the results table to be reached
 * first.
 */
function fetchRouter(overrides: { search?: unknown; preview?: unknown; commit?: unknown } = {}) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/find-and-recode/preview")) {
      return { ok: true, json: async () => ({ preview: overrides.preview ?? glPreview() }) };
    }
    if (u.includes("/find-and-recode/commit")) {
      return { ok: true, json: async () => ({ outcome: overrides.commit ?? { requested: 17, recoded: 17, skipped: [] } }) };
    }
    return { ok: true, json: async () => (overrides.search ?? { transactions: [txn({ id: 1 }), txn({ id: 2 })], hasMore: false }) };
  });
}

function glPreview() {
  return {
    matchingCount: 17,
    eligibleCount: 17,
    postedCount: 0,
    estimatedAffectedValue: 1234.56,
    currentAccountBreakdown: [{ currentAccount: null, count: 17, totalValue: 1234.56 }],
    sample: [],
    newGlAccount: { accountCode: "6950", description: "Marketing Materials" },
  };
}

function supplierPreview() {
  return {
    matchingCount: 17,
    eligibleCount: 17,
    postedCount: 0,
    estimatedAffectedValue: 1234.56,
    currentSupplierBreakdown: [{ currentSupplierId: null, currentSupplierName: null, count: 17, totalValue: 1234.56 }],
    sample: [],
    newSupplier: { id: 1, name: "Three Streams FISH" },
  };
}

async function searchAndReachRecodePanel(fetchImpl: ReturnType<typeof vi.fn>, extraSuppliers: Supplier[] = []) {
  vi.stubGlobal("fetch", fetchImpl);
  render(<FindAndRecode {...baseProps({ suppliers: [ACTIVE_SUPPLIER, INACTIVE_SUPPLIER, ...extraSuppliers], customers: [{ id: 1, name: "Acme Customer" }] })} />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Change & Recode" })).toBeInTheDocument());
}

describe("Change & Recode — top workflow (Phase 46)", () => {
  it("the action panel is visible immediately after a search, with NO scrolling past the results table required", async () => {
    await searchAndReachRecodePanel(fetchRouter());
    // The panel exists before anything is selected — this is the
    // requirement that it's part of the top workflow, not gated behind
    // a selection.
    expect(screen.getByRole("heading", { name: "Change & Recode" })).toBeInTheDocument();
  });

  it("Change & Recode is disabled and shows a helpful message when nothing is selected", async () => {
    await searchAndReachRecodePanel(fetchRouter());
    expect(screen.getByRole("button", { name: "Change & Recode" })).toBeDisabled();
    expect(screen.getByText("Select at least one transaction to recode.")).toBeInTheDocument();
  });

  it("selecting transactions removes the helper message, but Change & Recode stays disabled until a target is also chosen", async () => {
    await searchAndReachRecodePanel(fetchRouter());
    fireEvent.click(screen.getByRole("button", { name: "Select all matching" }));
    expect(screen.queryByText("Select at least one transaction to recode.")).not.toBeInTheDocument();
    // Still disabled — a target hasn't been chosen yet.
    expect(screen.getByRole("button", { name: "Change & Recode" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "supplier" } });
    fireEvent.change(screen.getByLabelText("New supplier"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Change & Recode" })).not.toBeDisabled();
  });

  it("GL Account is the default target type and shows the GL account picker", async () => {
    await searchAndReachRecodePanel(fetchRouter());
    expect(screen.getByLabelText("New GL account")).toBeInTheDocument();
    expect(screen.queryByLabelText("New supplier")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New customer")).not.toBeInTheDocument();
  });

  it("switching target type to Supplier shows the supplier picker (Active only) instead of the GL picker", async () => {
    await searchAndReachRecodePanel(fetchRouter());
    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "supplier" } });
    expect(screen.getByLabelText("New supplier")).toBeInTheDocument();
    expect(screen.queryByLabelText("New GL account")).not.toBeInTheDocument();
    const picker = screen.getByLabelText("New supplier") as HTMLSelectElement;
    const optionLabels = Array.from(picker.options).map((o) => o.text);
    expect(optionLabels).toContain("Active Supplies");
    expect(optionLabels).not.toContain("Deactivated Duplicate");
  });

  it("switching target type to Customer shows the customer picker", async () => {
    await searchAndReachRecodePanel(fetchRouter());
    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "customer" } });
    const picker = screen.getByLabelText("New customer") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.text)).toContain("Acme Customer");
  });

  it("clicking Change & Recode with a Supplier target opens a confirmation naming the count, type, and target", async () => {
    await searchAndReachRecodePanel(fetchRouter({ preview: supplierPreview() }));
    fireEvent.click(screen.getByRole("button", { name: "Select all matching" }));
    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "supplier" } });
    fireEvent.change(screen.getByLabelText("New supplier"), { target: { value: "1" } });

    fireEvent.click(screen.getByRole("button", { name: "Change & Recode" }));
    await waitFor(() =>
      expect(screen.getByText("Change & Recode 17 transactions? Current allocation will be changed to: Supplier — Three Streams FISH.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("confirming a successful recode shows the success result in the SAME top block, not at the bottom of the page", async () => {
    await searchAndReachRecodePanel(fetchRouter({ preview: supplierPreview(), commit: { requested: 17, recoded: 17, skipped: [] } }));
    fireEvent.click(screen.getByRole("button", { name: "Select all matching" }));
    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "supplier" } });
    fireEvent.change(screen.getByLabelText("New supplier"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change & Recode" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());

    // Two "Change & Recode" buttons exist at this point (the action
    // button and the confirm button) — the confirm one is the last.
    const confirmButtons = screen.getAllByRole("button", { name: "Change & Recode" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(screen.getByText("✓ 17 transactions successfully recoded.")).toBeInTheDocument());
    // The outcome sits inside the SAME "Change & Recode" panel — its
    // heading is still an ancestor-adjacent sibling, not something the
    // user had to scroll past a results table to reach.
    const heading = screen.getByRole("heading", { name: "Change & Recode" });
    const outcomeText = screen.getByText("✓ 17 transactions successfully recoded.");
    expect(heading.parentElement?.contains(outcomeText)).toBe(true);
  });

  it("a partial failure shows requested/recoded/failed counts with the failure reason", async () => {
    await searchAndReachRecodePanel(
      fetchRouter({
        preview: supplierPreview(),
        commit: { requested: 17, recoded: 15, skipped: [{ transactionId: 1, reason: "Already posted" }, { transactionId: 2, reason: "Already posted" }] },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Select all matching" }));
    fireEvent.change(screen.getByLabelText("Recode target type"), { target: { value: "supplier" } });
    fireEvent.change(screen.getByLabelText("New supplier"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change & Recode" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());
    const confirmButtons = screen.getAllByRole("button", { name: "Change & Recode" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(screen.getByText("17 selected · 15 recoded · 2 failed")).toBeInTheDocument());
    expect(screen.getByText("Already posted")).toBeInTheDocument();
  });
});

/**
 * Phase 47 — production defect: "select a GL account in the Current GL
 * account filter, it doesn't remain/display correctly afterwards." Traced
 * the complete value flow (GL picker → `draft.glAccount` state → filter
 * state → Search request → server filter → displayed value) directly —
 * confirmed the state and the fetch request were ALWAYS correct; the
 * actual defect was `Combobox`'s own input styling (`bg-transparent`,
 * `border-transparent`), built for a dense Transaction Explorer grid
 * cell, making a genuinely-selected value visually read as faded/empty
 * next to this page's solid-background `Select` fields. Fixed via a new
 * `inputClassName` prop applied only at this page's 3 Combobox call
 * sites. These tests prove both halves: the value/request were already
 * right (a real regression guard, not new behavior), and the visual fix
 * is actually applied. Also checks the Supplier/Customer selectors (per
 * the explicit instruction to verify, not assume, they're unaffected) —
 * both are plain `<Select>` elements, already styled via `FIELD_BASE`
 * directly, so they were never subject to this defect.
 */
const ACCOUNT_1010 = {
  id: 1, companyId: "co_1", accountCode: "1010", description: "Petty Cash", accountType: "Asset" as const,
  category: "Current Assets", normalBalance: "Debit" as const, parentAccountId: null, reportingGroup: "",
  financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null,
  projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
};

function fetchListRouter(transactions: BankTransactionRecord[] = []) {
  return vi.fn<(url: RequestInfo | URL) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async () => ({
    ok: true,
    json: async () => ({ transactions, hasMore: false }),
  }));
}

describe("Current GL account filter — selection stays visible and correct (Phase 47)", () => {
  it("selecting a GL account writes it into the filter's own value AND its options list resolves it to the real label", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_1010] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /1010/ }));

    expect(input.value).toBe("1010 — Petty Cash");
    expect(input).not.toBeDisabled();
  });

  it("the selected value is styled with the same solid field treatment as its sibling Select fields (the actual bug — a value that WAS there but looked faded/absent)", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_1010] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /1010/ }));

    // FIELD_BASE's defining, distinguishing classes — a solid background
    // and a real border, replacing the dense-grid-cell default of
    // `bg-transparent`/`border-transparent`.
    expect(input.className).toContain("bg-vf-paper");
    expect(input.className).not.toContain("border-transparent");
  });

  it("the selected GL account is actually included in the Search request sent to the server", async () => {
    const fetchMock = fetchListRouter();
    vi.stubGlobal("fetch", fetchMock);
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_1010] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /1010/ }));

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("glAccount=1010");
  });

  it("the value survives a Search round-trip — still correctly displayed afterwards, not disabled", async () => {
    const fetchMock = fetchListRouter([txn({ id: 1 })]);
    vi.stubGlobal("fetch", fetchMock);
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_1010] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /1010/ }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("1 result shown")).toBeInTheDocument());

    expect(input.value).toBe("1010 — Petty Cash");
    expect(input).not.toBeDisabled();
  });

  it("Reset clears the selected GL account back to the placeholder", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_1010] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: /1010/ }));
    expect(input.value).toBe("1010 — Petty Cash");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Any");
  });

  it("Supplier and Customer search filters each keep their own selected value correctly, independent of the GL filter and each other", async () => {
    const fetchMock = fetchListRouter();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FindAndRecode
        {...baseProps({
          chartOfAccounts: [ACCOUNT_1010],
          suppliers: [ACTIVE_SUPPLIER, INACTIVE_SUPPLIER],
          customers: [{ id: 5, name: "Acme Customer" }],
        })}
      />,
    );
    const glInput = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    fireEvent.focus(glInput);
    fireEvent.mouseDown(screen.getByRole("option", { name: /1010/ }));

    const supplierLabel = screen.getByText("Supplier", { selector: "label" });
    const supplierSelect = supplierLabel.parentElement?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(supplierSelect, { target: { value: String(ACTIVE_SUPPLIER.id) } });

    const customerLabel = screen.getByText("Customer", { selector: "label" });
    const customerSelect = customerLabel.parentElement?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(customerSelect, { target: { value: "5" } });

    // All three keep their own value — none clobbers another.
    expect(glInput.value).toBe("1010 — Petty Cash");
    expect(supplierSelect.value).toBe(String(ACTIVE_SUPPLIER.id));
    expect(customerSelect.value).toBe("5");

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("glAccount=1010");
    expect(url).toContain(`supplierId=${ACTIVE_SUPPLIER.id}`);
    expect(url).toContain("customerId=5");
  });
});

/**
 * Phase 48 — the user reported the Phase 47 fix (which concluded the
 * defect was purely CSS, with the state/value flow already correct) did
 * not resolve the problem: on live production, selecting a GL account
 * left the field showing "Any". Re-investigated from scratch rather than
 * assuming the Phase 47 conclusion still held: re-checked the database
 * schema (`account_code text not null` — genuinely a string column, not
 * numeric — `supabase/migrations/0007_general_ledger.sql:23`), the
 * mapper (`accountCode: row.account_code`, a straight passthrough, no
 * coercion — `src/server/general-ledger/mappers.ts:46`), and specifically
 * tested the exact scenario the user described (three real accounts,
 * "1000 — Bank" / "1010 — Petty Cash" / "1100 — Debtors", the full
 * mousedown+mouseup+click event sequence, not just a single simplified
 * event) — found no ID-type mismatch and no selection-mechanics bug.
 *
 * One concrete, verifiable operational fact fully explains what the user
 * saw without requiring a second code defect: Phase 47's fix was
 * explicitly NOT deployed (see that phase's own final report — "Not
 * performed... wait for explicit deployment approval"). Production was
 * still running the pre-fix build, which has the exact `bg-transparent`/
 * `border-transparent` styling that makes a genuinely-selected value look
 * indistinguishable from empty. This is reported as a real, load-bearing
 * possibility, not asserted as certain — the tests below exist
 * specifically so it doesn't matter which explanation is right: they
 * prove the ACTUAL rendered `<input>` element's value changes in
 * response to a real click/selection event, opened the same way a real
 * browser does (focus-follows-click), with the exact multi-account data
 * and full interaction sequence the user described.
 */
describe("Current GL account — full click-to-search-to-reset flow, realistic multi-account data (Phase 48)", () => {
  const ACCOUNT_BANK = { id: 10, companyId: "co_1", accountCode: "1000", description: "Bank", accountType: "Asset" as const, category: "", normalBalance: "Debit" as const, parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z" };
  const ACCOUNT_PETTY_CASH = { ...ACCOUNT_BANK, id: 11, accountCode: "1010", description: "Petty Cash" };
  const ACCOUNT_DEBTORS = { ...ACCOUNT_BANK, id: 12, accountCode: "1100", description: "Debtors" };

  /** Opens the Combobox the way a real browser click does — the browser's
   * own native "clicking a focusable element focuses it" behavior isn't
   * reproduced by a bare `fireEvent.click` in jsdom (confirmed directly:
   * it fires no `focus` event here), so an explicit `.focus()` plus
   * `fireEvent.focus` is what actually reproduces "the user clicked into
   * the field," matching the exact pattern already established and
   * working for this component elsewhere in the codebase (see
   * `transaction-grid.test.tsx`'s own Combobox interaction tests). */
  function openAndSelect(input: HTMLInputElement, accountCodePattern: RegExp) {
    input.focus();
    fireEvent.focus(input);
    const option = screen.getByRole("option", { name: accountCodePattern });
    fireEvent.mouseDown(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
  }

  it("click GL account → the displayed field value actually changes — the exact user-reported regression", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_BANK, ACCOUNT_PETTY_CASH, ACCOUNT_DEBTORS] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    expect(input.value).toBe("");

    openAndSelect(input, /^1010/);

    expect(input.value).toBe("1010 — Petty Cash");
    expect(input).not.toBeDisabled();
    expect(document.activeElement).toBe(input);
  });

  it("the full flow: select → Search includes it → change to a different account → display updates → Reset clears it → select again → Search again", async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async () => ({
      ok: true,
      json: async () => ({ transactions: [], hasMore: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_BANK, ACCOUNT_PETTY_CASH, ACCOUNT_DEBTORS] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;

    // Select 1010 — Petty Cash.
    openAndSelect(input, /^1010/);
    expect(input.value).toBe("1010 — Petty Cash");

    // Search — the filter state (the string "1010", matching this app's
    // existing account-code-is-the-identifier convention throughout Find
    // & Recode — see `draftToFilters`/`filtersToQuery`; there is no
    // separate numeric GL account id in this filter's contract) reaches
    // the request.
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("glAccount=1010");

    // Change to a DIFFERENT account — the displayed value must update,
    // not get stuck on the first selection.
    openAndSelect(input, /^1000/);
    expect(input.value).toBe("1000 — Bank");

    // Reset clears it back to the placeholder.
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Any");

    // Select again and search again — the whole cycle repeats correctly,
    // not just the first time.
    openAndSelect(input, /^1100/);
    expect(input.value).toBe("1100 — Debtors");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain("glAccount=1100");
  });

  it("GL, Supplier, and Customer selected together all remain visibly displayed at once and all three reach the same Search request", async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async () => ({
      ok: true,
      json: async () => ({ transactions: [], hasMore: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FindAndRecode
        {...baseProps({
          chartOfAccounts: [ACCOUNT_BANK, ACCOUNT_PETTY_CASH, ACCOUNT_DEBTORS],
          suppliers: [ACTIVE_SUPPLIER, INACTIVE_SUPPLIER],
          customers: [{ id: 5, name: "Acme Customer" }],
        })}
      />,
    );
    const glInput = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    openAndSelect(glInput, /^1010/);

    const supplierSelect = (screen.getByText("Supplier", { selector: "label" }).parentElement?.querySelector("select")) as HTMLSelectElement;
    fireEvent.change(supplierSelect, { target: { value: String(ACTIVE_SUPPLIER.id) } });

    const customerSelect = (screen.getByText("Customer", { selector: "label" }).parentElement?.querySelector("select")) as HTMLSelectElement;
    fireEvent.change(customerSelect, { target: { value: "5" } });

    // All three still hold their own value simultaneously — none was
    // cleared or clobbered by selecting the others.
    expect(glInput.value).toBe("1010 — Petty Cash");
    expect(supplierSelect.value).toBe(String(ACTIVE_SUPPLIER.id));
    expect(customerSelect.value).toBe("5");

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("glAccount=1010");
    expect(url).toContain(`supplierId=${ACTIVE_SUPPLIER.id}`);
    expect(url).toContain("customerId=5");
  });
});

/**
 * Phase 49, Defect 1 — "Any → GL Account works, but GL Account → Any does
 * not": once a real GL account was selected, there was no way to clear
 * it from inside the picker — `Combobox` has no built-in "clear" concept,
 * and nothing in its option list represented "no filter." Fixed with a
 * real, closed-list "Any" option (`ANY_GL_ACCOUNT_VALUE` sentinel,
 * matching this codebase's own established pattern for a synthetic
 * Combobox entry — see `ADD_NEW_GL_ACCOUNT_VALUE` in
 * transaction-grid.tsx) that commits the SAME `draft.glAccount = ""`
 * representation Reset already uses — no second state system. These
 * prove every transition, through the real rendered control, not just
 * React state: Any → 1010 → 1100 → Any, and Any → 1010 → Any directly.
 */
describe("Current GL account — Any is a real, selectable, round-trippable option (Phase 49, Defect 1)", () => {
  const ACCOUNT_PETTY_CASH = { id: 11, companyId: "co_1", accountCode: "1010", description: "Petty Cash", accountType: "Asset" as const, category: "", normalBalance: "Debit" as const, parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z" };
  const ACCOUNT_DEBTORS = { ...ACCOUNT_PETTY_CASH, id: 12, accountCode: "1100", description: "Debtors" };

  function openAndSelect(input: HTMLInputElement, namePattern: RegExp) {
    input.focus();
    fireEvent.focus(input);
    // Scoped to THIS combobox's own listbox — several other filters on
    // this page (Bank account/Supplier/Customer/Banking Rule) are plain
    // `<select>`s that each have their own "Any" `<option>`, so an
    // unscoped query for "Any" is ambiguous once they're all rendered
    // together.
    const listboxId = input.getAttribute("aria-controls")!;
    fireEvent.mouseDown(within(document.getElementById(listboxId)!).getByRole("option", { name: namePattern }));
  }

  it("Any is listed as a real option in the closed (no-query) browse list, at the top", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_PETTY_CASH] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    input.focus();
    fireEvent.focus(input);
    const listboxId = input.getAttribute("aria-controls")!;
    const options = within(document.getElementById(listboxId)!).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Any");
  });

  it("Any → 1010 → open picker → select Any → back to Any", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_PETTY_CASH] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    expect(input.value).toBe("");

    openAndSelect(input, /^1010/);
    expect(input.value).toBe("1010 — Petty Cash");

    openAndSelect(input, /^Any$/);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Any");
  });

  it("Any → 1010 → 1100 → Any — every transition works, not just the first", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_PETTY_CASH, ACCOUNT_DEBTORS] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;

    openAndSelect(input, /^1010/);
    expect(input.value).toBe("1010 — Petty Cash");

    openAndSelect(input, /^1100/);
    expect(input.value).toBe("1100 — Debtors");

    openAndSelect(input, /^Any$/);
    expect(input.value).toBe("");
  });

  it("selecting Any writes the same empty-filter representation Search/Reset already use — omitted from the Search request", async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async () => ({
      ok: true,
      json: async () => ({ transactions: [], hasMore: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_PETTY_CASH] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;

    openAndSelect(input, /^1010/);
    openAndSelect(input, /^Any$/);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("glAccount=");
  });

  it("Reset also returns Current GL account to Any (unregressed by this fix)", () => {
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_PETTY_CASH] })} />);
    const input = screen.getByLabelText("Current GL account filter") as HTMLInputElement;
    openAndSelect(input, /^1010/);
    expect(input.value).toBe("1010 — Petty Cash");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(input.value).toBe("");
  });

  it("the recode-target 'New GL account' picker deliberately does NOT get an Any option — you must recode to a real account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ transactions: [txn({ id: 1 })], hasMore: false }) })));
    render(<FindAndRecode {...baseProps({ chartOfAccounts: [ACCOUNT_PETTY_CASH] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const target = await screen.findByLabelText("New GL account");
    target.focus();
    fireEvent.focus(target);
    const listboxId = target.getAttribute("aria-controls")!;
    const options = within(document.getElementById(listboxId)!).getAllByRole("option");
    expect(options.map((o) => o.textContent)).not.toContain("Any");
  });
});

/**
 * Phase 49 — "since this defect has now appeared in the GL selector,
 * audit the Find & Recode filter controls for the same problem." Bank
 * Account, Supplier, Customer, and Banking Rule are all plain native
 * `<select>` elements (not `Combobox`) that already render an explicit
 * `<option value="">Any</option>` as their first entry — a native select
 * always exposes every option, including "Any," with zero extra
 * mechanism needed, so these were never at risk of the Combobox-specific
 * defect. These prove the full round trip through the real controls
 * anyway, rather than asserting that from reading the source alone.
 */
describe("Any → select → select → Any — audited across every Find & Recode filter (Phase 49)", () => {
  it("Bank Account: Any -> select -> Any", () => {
    render(<FindAndRecode {...baseProps({ bankAccounts: [{ id: 1, accountName: "MAIN" }, { id: 2, accountName: "SAVINGS" }] })} />);
    const select = screen.getByText("Bank account", { selector: "label" }).parentElement?.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "1" } });
    expect(select.value).toBe("1");
    fireEvent.change(select, { target: { value: "" } });
    expect(select.value).toBe("");
  });

  it("Supplier: Any -> select -> Any", () => {
    render(<FindAndRecode {...baseProps({ suppliers: [ACTIVE_SUPPLIER] })} />);
    const select = screen.getByText("Supplier", { selector: "label" }).parentElement?.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: String(ACTIVE_SUPPLIER.id) } });
    expect(select.value).toBe(String(ACTIVE_SUPPLIER.id));
    fireEvent.change(select, { target: { value: "" } });
    expect(select.value).toBe("");
  });

  it("Customer: Any -> select -> Any", () => {
    render(<FindAndRecode {...baseProps({ customers: [{ id: 5, name: "Acme Customer" }] })} />);
    const select = screen.getByText("Customer", { selector: "label" }).parentElement?.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "5" } });
    expect(select.value).toBe("5");
    fireEvent.change(select, { target: { value: "" } });
    expect(select.value).toBe("");
  });

  it("Banking Rule: Any -> select -> Any", () => {
    render(<FindAndRecode {...baseProps()} />);
    const select = screen.getByText("Banking Rule", { selector: "label" }).parentElement?.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "yes" } });
    expect(select.value).toBe("yes");
    fireEvent.change(select, { target: { value: "" } });
    expect(select.value).toBe("");
  });
});
