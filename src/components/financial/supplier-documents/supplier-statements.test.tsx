/**
 * SD-3E — the Supplier Statements screens, mounted for real: inbox stages and
 * upload, the review workspace (supplier confirmation, readiness, corrections),
 * and the reconciliation workspace (S, P, D, Explained, Unexplained;
 * classifications; explain / link / withdraw through the SD-3D API).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatementInbox, type StatementInboxRow } from "./statement-inbox";
import { StatementReviewWorkspace } from "./statement-review";
import { StatementReconciliation } from "./statement-reconciliation";
import type { ReconRunDetailView, ReconRunSummaryView, ResolutionView, StatementLineView, StatementView } from "./statement-types";
import type { CapturePermissions } from "@/lib/supplier-documents/capture-stages";
import type { Supplier } from "@/server/accounting/types";

const refresh = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn(), replace }),
  usePathname: () => "/company/co_1/supplier-documents/statements/7",
  useSearchParams: () => search,
}));

const ALL: CapturePermissions = { view: true, upload: true, edit: true, reject: true, approve: true };
const VIEW_ONLY: CapturePermissions = { view: true, upload: false, edit: false, reject: false, approve: false };
const SUPPLIERS = [{ id: 3, name: "Karoo Building Supplies", status: "Active", supplierCode: "KBS", alternativeNames: [] } as unknown as Supplier];

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  search = new URLSearchParams();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const ROWS: StatementInboxRow[] = [
  { id: 1, status: "NeedsReview", stage: "needs-review", sourceType: "pdf-text", supplierName: "Karoo Building Supplies", supplierConfirmed: false, statementDate: "2026-09-30", closingBalance: 4260.06, currencyCode: null, validationStatus: "Pass", filename: "karoo.pdf", receivedAt: "2026-10-01T08:00:00Z" },
  { id: 2, status: "ManualEntry", stage: "to-enter", sourceType: "pdf-scanned", supplierName: null, supplierConfirmed: false, statementDate: null, closingBalance: null, currencyCode: null, validationStatus: "Pending", filename: "scan.pdf", receivedAt: "2026-10-01T08:00:00Z" },
];

function statement(over: Partial<StatementView> = {}): StatementView {
  return {
    id: 7, status: "NeedsReview", statusReason: "", sourceType: "pdf-text", documentId: 70, extractionMethod: "layout",
    supplierId: 3, supplierConfirmed: false, supplierConfirmedBy: null, supplierConfirmedAt: null, supplierMatchTier: "vat", supplierCandidates: [],
    supplierNameExtracted: "Karoo Building Supplies (Pty) Ltd", supplierVatExtracted: "4123456789", supplierRegistrationExtracted: null, accountNumberExtracted: "000123",
    header: { statementDate: "2026-09-30", periodFrom: "2026-09-01", periodTo: "2026-09-30", currencyCode: null, openingBalance: 1500, closingBalance: 4260.06, printedTotalDebits: null, printedTotalCredits: null, signConvention: "debit-increases-owed" },
    extractedHeader: { closingBalance: 4260.06 }, currencySupported: true, pageCount: 1, validationStatus: "Pass", validationFindings: [], warnings: [],
    manualEntry: false, duplicateOfStatementId: null, createdAt: "2026-10-01T08:00:00Z", ...over,
  };
}
const LINES: StatementLineView[] = [
  { id: 40, lineOrder: 1, pageNumber: 1, rowOnPage: 3, transactionDate: "2026-09-03", referenceText: "0001042", description: "Tax Invoice", transactionType: "invoice", typeSource: "inferred", debit: 2300, credit: null, runningBalance: 3800, rawText: "03/09/2026 0001042", unresolvedFields: [], isExcluded: false, exclusionReason: null, corrected: false },
  { id: 41, lineOrder: 2, pageNumber: 1, rowOnPage: 4, transactionDate: null, referenceText: "0102", description: "Produce", transactionType: "unknown", typeSource: "inferred", debit: null, credit: null, runningBalance: null, rawText: "31/02/2026 0102 Produce 1,234", unresolvedFields: ["transaction_date", "debit"], isExcluded: false, exclusionReason: null, corrected: false },
];

function review(over: Partial<StatementView> = {}, can = ALL, extra: Partial<Parameters<typeof StatementReviewWorkspace>[0]> = {}) {
  return render(
    <StatementReviewWorkspace companyId="co_1" statement={statement(over)} lines={LINES} events={[]} document={{ id: 70, filename: "karoo.pdf", mimeType: "application/pdf", sizeBytes: 70000 }}
      suppliers={SUPPLIERS} can={can} runs={[]} selectedRun={null} latestRunId={null} resolutions={[]} stale={false} {...extra} />,
  );
}

describe("Statements inbox", () => {
  it("shows the stages and the PDF-first upload control", async () => {
    const { container } = render(<StatementInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    expect(screen.getByRole("navigation", { name: "Statement stages" })).toBeTruthy();
    expect(screen.getByLabelText(/Supplier statement \(PDF; or a JPG\/PNG scan, CSV or XLSX\)/)).toBeTruthy();
    expect((await axe(container)).violations).toEqual([]);
  });
  it("lists statements in the chosen stage, flagging an unconfirmed supplier", () => {
    search = new URLSearchParams("stage=needs-review");
    render(<StatementInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    expect(screen.getByText("karoo.pdf")).toBeTruthy();
    expect(screen.getByText("Not yet confirmed")).toBeTruthy();
    expect(screen.queryByText("scan.pdf")).toBeNull();
  });
  it("offers no upload without Purchasing:Create", () => {
    render(<StatementInbox companyId="co_1" rows={ROWS} can={VIEW_ONLY} previewMode={false} />);
    expect(screen.queryByText("Upload statement")).toBeNull();
  });
});

describe("Statement review", () => {
  it("a supplier proposed by VAT number is NOT confirmed; mark-ready is blocked until a person confirms it", () => {
    review();
    expect(screen.getByText(/NOT confirmed/)).toBeTruthy();
    expect(screen.getByText(/Confirm the supplier\. A proposed match/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mark ready for reconciliation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("confirming sends the chosen supplier and the explicit account-number choice", async () => {
    review();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm supplier" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/co_1/purchasing/supplier-statements/7");
    expect(JSON.parse(init.body)).toEqual({ action: "confirm-supplier", supplierId: 3, saveAccountNumber: true });
  });

  it("unread values are shown with what was actually read", () => {
    review();
    expect(screen.getAllByText("Unread").length).toBeGreaterThan(0);
    expect(screen.getByText(/As read: 31\/02\/2026 0102 Produce 1,234/)).toBeTruthy();
    expect(screen.getAllByText(/1 line has a value that could not be read reliably/).length).toBeGreaterThan(0);
  });

  it("a confirmed, validated statement can be marked ready", async () => {
    review({ supplierConfirmed: true, supplierConfirmedBy: "reviewer@x.test" }, ALL, { lines: [LINES[0]] } as never);
    const button = screen.getByRole("button", { name: "Mark ready for reconciliation" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "mark-ready" }));
  });

  it("an unsupported currency is stated plainly", () => {
    review({ currencySupported: false, header: { ...statement().header, currencyCode: "USD" } });
    expect(screen.getAllByText(/Unsupported currency — manual review required/).length).toBeGreaterThan(0);
  });

  it("view-only users get no correction or confirmation controls", () => {
    review({}, VIEW_ONLY);
    expect(screen.queryByRole("button", { name: "Confirm supplier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Correct lines" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save details" })).toBeNull();
    expect(screen.getByText(/You can view this statement/)).toBeTruthy();
  });

  it("the original is shown through the audited statement viewer", () => {
    review();
    const frame = screen.getByTitle("Original document: karoo.pdf") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/api/companies/co_1/purchasing/supplier-statements/7/original");
  });

  it("is accessible", async () => {
    const { container } = review();
    // The frame holds the browser's own PDF viewer; axe checks our markup
    // without entering it (as in the SD-2 tests).
    expect((await axe(container, { iframes: false } as never)).violations).toEqual([]);
  });
});

const RUN_SUMMARY: ReconRunSummaryView = { id: 1, runNumber: 1, asAt: "2026-09-30", statementClosing: 4260.06, precisiaBalance: 2945.5, difference: 1314.56, explained: 714.56, explainedByReviewer: 0, unexplained: 600, fingerprint: "a".repeat(64), createdBy: "reviewer@x.test", createdAt: "2026-10-01T09:00:00Z" };
const RUN: ReconRunDetailView = {
  run: { ...RUN_SUMMARY, windowFrom: "2026-09-01", windowTo: "2026-09-30", statementOpening: 1500, precisiaBalanceBeforeWindow: 1500, residual: 0 },
  items: [
    { order: 1, statementLineId: 40, statementLineOrder: 1, category: "Matched", subStatus: "exact", matchTier: "exact", refType: "bill", refId: 9, relatedRefs: [], suggestions: [], statementAmount: 2300, precisiaAmount: 2300, amountDifference: 0, effect: 0, explained: true, explainedByResolutionId: null, message: "Line 1 matched Bill 0001042." },
    { order: 2, statementLineId: 44, statementLineOrder: 5, category: "Missing in PRECISIA", subStatus: "imported-not-posted", matchTier: null, refType: "unposted-bill", refId: 12, relatedRefs: [], suggestions: [], statementAmount: 1234.56, precisiaAmount: null, amountDifference: null, effect: 1234.56, explained: true, explainedByResolutionId: null, message: "The document on line 5 (0001093) is in PRECISIA but was never posted." },
    { order: 3, statementLineId: null, statementLineOrder: null, category: "Potential Duplicate", subStatus: "double-recorded-payment", matchTier: null, refType: null, refId: null,
      relatedRefs: [{ refType: "supplier-payment", refId: 5, amount: -300, date: "2026-09-20", number: "SP-300" }, { refType: "bank-transaction", refId: 6, amount: -300, date: "2026-09-20", number: "EFT 300" }],
      suggestions: [], statementAmount: null, precisiaAmount: -600, amountDifference: null, effect: 600, explained: false, explainedByResolutionId: null, message: "A payment appears in PRECISIA twice." },
    { order: 4, statementLineId: null, statementLineOrder: null, category: "Missing on Statement", subStatus: "timing", matchTier: null, refType: "bill", refId: 13, relatedRefs: [{ refType: "bill", refId: 13, amount: 500, date: "2026-09-29", number: "0001100" }], suggestions: [], statementAmount: null, precisiaAmount: 500, amountDifference: null, effect: -500, explained: true, explainedByResolutionId: null, message: "Bill 0001100 is in PRECISIA but not on the statement." },
  ],
};

function recon(over: Partial<Parameters<typeof StatementReconciliation>[0]> = {}) {
  return render(<StatementReconciliation companyId="co_1" statementId={7} status="Reconciled" canEdit runs={[RUN_SUMMARY]} selected={RUN} latestRunId={1} resolutions={[]} stale={false} {...over} />);
}

describe("Reconciliation workspace", () => {
  it("shows S, P, D, Explained and Unexplained exactly as the run recorded them", () => {
    recon();
    const balances = screen.getByRole("region", { name: "Balances" });
    for (const text of ["4 260.06", "2 945.50", "1 314.56", "714.56", "600.00"]) {
      expect(within(balances).getAllByText((t) => t.replace(/\s/g, " ").includes(text.replace(/\s/g, " ")) || t.replace(/[\s,]/g, "") === text.replace(/\s/g, "")).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/D = Explained \+ Unexplained, to the cent/)).toBeTruthy();
  });

  it("groups items by classification, and flags what is unexplained", () => {
    recon();
    for (const c of ["Matched", "Missing in PRECISIA", "Potential Duplicate", "Missing on Statement"]) expect(screen.getAllByText(c).length).toBeGreaterThan(0);
    expect(screen.getByText("Imported — not posted")).toBeTruthy();
    expect(screen.getAllByText("Unexplained").length).toBeGreaterThan(0);
  });

  it("there is no control that posts, adjusts or 'fixes' a difference", () => {
    recon();
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(labels.some((l) => /post|adjust|write.?off|balance it|fix/i.test(l))).toBe(false);
  });

  it("explaining needs a reason and goes to the decisions API with the right target", async () => {
    recon();
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    const record = screen.getByRole("button", { name: "Record explanation" }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Captured twice; accounting will correct it" } });
    fireEvent.click(record);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/co_1/purchasing/supplier-statements/7/resolutions");
    expect(JSON.parse(init.body)).toEqual({ action: "explained", refType: "supplier-payment", refId: 5, reason: "Captured twice; accounting will correct it" });
  });

  it("a stale run is called out, and reconciling again posts a new run", async () => {
    recon({ stale: true });
    expect(screen.getByText(/Decisions were recorded after the latest run/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reconcile again/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/purchasing/supplier-statements/7/reconciliations", { method: "POST" }));
  });

  it("a decision can be withdrawn (with a reason), never edited", async () => {
    const decision: ResolutionView = { id: 9, action: "explained", statementLineId: null, refType: "supplier-payment", refId: 5, revokes: null, reason: "Captured twice", performedBy: "reviewer@x.test", createdAt: "2026-10-01T09:10:00Z", revoked: false };
    recon({ resolutions: [decision] });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.change(screen.getByLabelText("Reason for withdrawing"), { target: { value: "Explanation was wrong" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Withdraw" }).at(-1)!);
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "revoke", revokesResolutionId: 9, reason: "Explanation was wrong" }));
  });

  it("view-only users see the result but no actions", () => {
    recon({ canEdit: false });
    expect(screen.queryByRole("button", { name: /Reconcile/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
  });

  it("an earlier run is read-only (decisions are made on the latest run)", () => {
    recon({ latestRunId: 2 });
    expect(screen.getByText(/You are viewing an earlier run/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
  });

  it("is accessible", async () => {
    const { container } = recon();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("Statement review — a proposal that arrives after the page opened", () => {
  it("the supplier choice follows the stored supplier, so the proposal can be confirmed", async () => {
    const { rerender } = render(
      <StatementReviewWorkspace companyId="co_1" statement={statement({ status: "Processing", supplierId: null, supplierMatchTier: null })} lines={[]} events={[]} document={null}
        suppliers={SUPPLIERS} can={ALL} runs={[]} selectedRun={null} latestRunId={null} resolutions={[]} stale={false} />,
    );
    rerender(
      <StatementReviewWorkspace companyId="co_1" statement={statement()} lines={LINES} events={[]} document={null}
        suppliers={SUPPLIERS} can={ALL} runs={[]} selectedRun={null} latestRunId={null} resolutions={[]} stale={false} />,
    );
    const button = screen.getByRole("button", { name: "Confirm supplier" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: "confirm-supplier", supplierId: 3 }));
  });
});

describe("Statement review — SD-3F AI provenance", () => {
  const AI_LINES: StatementLineView[] = [
    { ...LINES[0], id: 50, extractedBy: "ai" },
    { ...LINES[0], id: 51, lineOrder: 2, referenceText: "0001057", extractedBy: "ai", corrected: true },
    { ...LINES[0], id: 52, lineOrder: 3, referenceText: "0001093", extractedBy: "reviewer" },
  ];

  it("AI-read lines are marked, a reviewer's correction is still shown, and the statement says it was read by AI", () => {
    render(
      <StatementReviewWorkspace companyId="co_1" statement={statement({ extractionMethod: "ai", sourceType: "pdf-scanned" })} lines={AI_LINES} events={[]}
        document={{ id: 70, filename: "scan.pdf", mimeType: "application/pdf", sizeBytes: 70000 }} suppliers={SUPPLIERS} can={ALL} runs={[]} selectedRun={null}
        latestRunId={null} resolutions={[]} stale={false} />,
    );
    expect(screen.getAllByText("AI read")).toHaveLength(2);
    expect(screen.getAllByText("Corrected").length).toBeGreaterThan(0);
    expect(screen.getByText(/read by AI from the scan/)).toBeTruthy();
  });

  it("a statement read deterministically carries no AI mark", () => {
    review();
    expect(screen.queryByText("AI read")).toBeNull();
    expect(screen.queryByText(/read by AI from the scan/)).toBeNull();
  });
});
