/**
 * SD-2 — the Supplier Documents screens, mounted for real: stages,
 * permission-aware controls, the original-document viewer, credit notes,
 * manual entry and the approve / reject flows (through the SD-1 API).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { CaptureInbox } from "./capture-inbox";
import { CaptureReviewWorkspace } from "./capture-review";
import type { ReviewCapture } from "./review-types";
import type { CapturePermissions, InboxRow } from "@/lib/supplier-documents/capture-stages";
import type { Supplier } from "@/server/accounting/types";

const refresh = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn(), replace }),
  usePathname: () => "/company/co_1/supplier-documents/invoice-capture",
  useSearchParams: () => search,
}));

const ALL: CapturePermissions = { view: true, upload: true, edit: true, reject: true, approve: true };
const VIEW_ONLY: CapturePermissions = { view: true, upload: false, edit: false, reject: false, approve: false };

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    id: 1, status: "NeedsReview", stage: "needs-review", documentType: "Invoice", supplierName: "Acme Supplies", supplierConfirmed: true,
    invoiceNumber: "INV-100", invoiceDate: "2026-09-01", total: 1150, validationStatus: "Pass", duplicateStatus: "None",
    manualEntry: false, filename: "acme-inv-100.pdf", receivedAt: "2026-09-02T08:00:00Z", billId: null, billPostingStatus: null,
    ...overrides,
  };
}

const ROWS: InboxRow[] = [
  row(),
  row({ id: 2, status: "Queued", stage: "inbox", filename: "scan.png", supplierName: null, supplierConfirmed: false, invoiceNumber: null, total: null, validationStatus: "Pending" }),
  row({ id: 3, status: "Converted", stage: "posted", documentType: "Credit Note", total: -575, billId: 90, billPostingStatus: "Posted", filename: "cn-77.pdf" }),
  row({ id: 4, status: "Duplicate", stage: "inbox", duplicateStatus: "Blocked", filename: "dup.pdf" }),
];

const SUPPLIERS = [{ id: 7, name: "Acme Supplies", status: "Active", supplierCode: "ACME", alternativeNames: [] } as unknown as Supplier];
const VAT = [{ code: "Standard Rated", name: "Standard rate", rate: 15, isActive: true }] as never[];
const COA = [{ accountCode: "5100", description: "Purchases", accountType: "Expense", isActive: true }] as never[];

function capture(overrides: Partial<ReviewCapture> = {}): ReviewCapture {
  return {
    id: 5, status: "NeedsReview", stage: "needs-review", manualEntry: false,
    header: { documentType: "Invoice", invoiceNumber: "INV-100", invoiceDate: "2026-09-01", dueDate: null, orderReference: null, currencyCode: "ZAR", subtotal: 1000, discountTotal: null, vatAmount: 150, total: 1150 },
    extracted: { documentType: "Invoice", invoiceNumber: "INV-10O", invoiceDate: "2026-09-01", dueDate: null, orderReference: null, currencyCode: "ZAR", subtotal: 1000, discountTotal: null, vatAmount: 150, total: 1150, supplierName: "ACME SUPPLIES (PTY) LTD" },
    extractedLines: [{ description: "Widget", quantity: 10, unitPrice: 100, vatAmount: 150, lineTotal: 1000 }],
    supplierNameExtracted: "ACME SUPPLIES (PTY) LTD", supplierVatNumberExtracted: "4123456789", supplierRegistrationNumberExtracted: null,
    supplierId: 7, supplierMatchTier: "vat", supplierCandidates: [],
    validationStatus: "Pass", validationFindings: [], validatedAt: "2026-09-02T08:05:00Z",
    duplicateStatus: "None", duplicateReason: "", duplicateOfCaptureId: null, duplicateOfBillId: null,
    lastErrorMessage: null, modelConfidence: null, receivedAt: "2026-09-02T08:00:00Z", uploadedBy: "clerk@example.test",
    convertedAt: null, convertedBy: null,
    lines: [{
      lineOrder: 0, description: "Widget", supplierSku: null, quantity: 10, uom: null, packDescription: null, unitPrice: 100, discount: null,
      vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, glAccountSuggested: "5100", glAccountSource: "supplier-default",
      vatCodeSuggested: "Standard Rated", vatCodeSource: "supplier-default", glAccountConfirmed: null, vatCodeConfirmed: null, isExcluded: false,
    }],
    events: [{ id: 1, eventType: "FieldCorrected", detail: { fields: ["invoiceNumber"] }, performedBy: "reviewer@example.test", occurredAt: "2026-09-02T08:04:00Z" }],
    document: { id: 11, filename: "acme-inv-100.pdf", mimeType: "application/pdf", sizeBytes: 20480, uploadedAt: "2026-09-02T08:00:00Z" },
    bill: null,
    ...overrides,
  };
}

function renderReview(c: ReviewCapture, can: CapturePermissions = ALL) {
  return render(<CaptureReviewWorkspace companyId="co_1" capture={c} can={can} suppliers={SUPPLIERS} vatTreatments={VAT} chartOfAccounts={COA} />);
}

const fetchMock = vi.fn();
beforeEach(() => {
  search = new URLSearchParams();
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the Invoice Capture inbox", () => {
  it("shows the six stages with their counts and lists only the current stage", async () => {
    search = new URLSearchParams("stage=needs-review");
    const { container } = render(<CaptureInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    const stages = screen.getByRole("navigation", { name: "Invoice capture stages" });
    for (const label of ["Inbox", "Processing", "Needs Review", "Approved", "Posted", "Rejected"]) {
      expect(within(stages).getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    expect(within(stages).getByRole("button", { name: /^Inbox/ })).toHaveTextContent("2");
    expect(screen.getByText("acme-inv-100.pdf")).toBeInTheDocument();
    expect(screen.queryByText("scan.png")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open acme-inv-100.pdf" })).toHaveAttribute("href", "/company/co_1/supplier-documents/invoice-capture/1");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("presents a credit note as one, with its amount as a credit", () => {
    search = new URLSearchParams("stage=posted");
    render(<CaptureInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    expect(screen.getByText("Credit note")).toBeInTheDocument();
    expect(screen.getByText("CR")).toBeInTheDocument();
    expect(screen.getByText(/Credit note #90 · Posted/)).toBeInTheDocument();
  });

  it("flags a blocked duplicate in the Inbox", () => {
    render(<CaptureInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    const dupRow = screen.getByText("dup.pdf").closest("tr")!;
    // Both the status and the check say so.
    expect(within(dupRow).getAllByText("Duplicate")).toHaveLength(2);
  });

  it("offers upload only to users who may capture, and never in Preview Mode", () => {
    const { rerender } = render(<CaptureInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    expect(screen.getByLabelText(/Supplier invoice or credit note/)).toBeInTheDocument();
    rerender(<CaptureInbox companyId="co_1" rows={ROWS} can={VIEW_ONLY} previewMode={false} />);
    expect(screen.queryByLabelText(/Supplier invoice or credit note/)).not.toBeInTheDocument();
    rerender(<CaptureInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={true} />);
    expect(screen.queryByLabelText(/Supplier invoice or credit note/)).not.toBeInTheDocument();
  });

  it("uploads through the capture API and refreshes", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ capture: { status: "Queued" } }) });
    render(<CaptureInbox companyId="co_1" rows={ROWS} can={ALL} previewMode={false} />);
    const file = new File(["%PDF-1.7"], "new.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/Supplier invoice or credit note/), { target: { files: [file] } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/purchasing/invoice-capture", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("status")).toHaveTextContent("new.pdf");
  });
});

describe("reviewing a supplier document", () => {
  it("shows the ORIGINAL document inline from the same-origin route — never the JSON download link", async () => {
    const { container } = renderReview(capture());
    const frame = screen.getByTitle("Original document: acme-inv-100.pdf");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "/api/companies/co_1/purchasing/invoice-capture/5/original");
    expect(screen.getByRole("link", { name: "Download original" })).toHaveAttribute("href", "/api/companies/co_1/purchasing/invoice-capture/5/original?download=1");
    expect(container.querySelector('a[href*="/documents/"][href$="/download"]')).toBeNull();
    // The frame holds the browser's own PDF viewer, not our markup; jsdom
    // cannot host it, so axe checks our markup without entering the frame.
    expect(await axe(container, { iframes: false } as never)).toHaveNoViolations();
  });

  it("shows an image original as an image", () => {
    renderReview(capture({ document: { id: 11, filename: "scan.png", mimeType: "image/png", sizeBytes: 900, uploadedAt: "" } }));
    expect(screen.getByRole("img", { name: "Original document: scan.png" })).toHaveAttribute("src", "/api/companies/co_1/purchasing/invoice-capture/5/original");
  });

  it("shows what was read beside what the reviewer corrected", () => {
    renderReview(capture());
    expect(screen.getByText("Read from the document: INV-10O")).toBeInTheDocument();
    expect(screen.getAllByText("Corrected").length).toBeGreaterThan(0);
    expect(screen.getByText("As read from the document")).toBeInTheDocument();
  });

  it("offers approval only to an approver, and only when nothing blocks it", async () => {
    const { rerender } = renderReview(capture());
    expect(screen.getByRole("button", { name: "Approve — create draft bill" })).toBeEnabled();
    rerender(<CaptureReviewWorkspace companyId="co_1" capture={capture({ validationStatus: "Pending" })} can={ALL} suppliers={SUPPLIERS} vatTreatments={VAT} chartOfAccounts={COA} />);
    expect(screen.getByRole("button", { name: "Approve — create draft bill" })).toBeDisabled();
    expect(screen.getByText(/not been validated yet/)).toBeInTheDocument();
    rerender(<CaptureReviewWorkspace companyId="co_1" capture={capture()} can={{ ...ALL, approve: false }} suppliers={SUPPLIERS} vatTreatments={VAT} chartOfAccounts={COA} />);
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
  });

  it("a view-only user sees the document and its details, with no way to change them", () => {
    renderReview(capture(), VIEW_ONLY);
    expect(screen.getByTitle("Original document: acme-inv-100.pdf")).toBeInTheDocument();
    for (const name of [/Approve/, /^Reject$/, /Save details/, /Save lines/, /Confirm supplier/, /Add a line/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/You can view this document/)).toBeInTheDocument();
  });

  it("approving asks for confirmation, then converts through the API", async () => {
    renderReview(capture());
    fireEvent.click(screen.getByRole("button", { name: "Approve — create draft bill" }));
    fireEvent.click(screen.getByRole("button", { name: "Create draft bill" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/co_1/purchasing/invoice-capture/5");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "convert" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a refusal from the server (e.g. an approval limit) is shown, not swallowed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Your approval limit is R10 000.00." }) });
    renderReview(capture());
    fireEvent.click(screen.getByRole("button", { name: "Approve — create draft bill" }));
    fireEvent.click(screen.getByRole("button", { name: "Create draft bill" }));
    expect(await screen.findByText("Your approval limit is R10 000.00.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejecting is confirmed, and says the original is kept", async () => {
    renderReview(capture());
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByText(/original document and its history are kept/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ action: "cancel" });
  });

  it("presents a credit note as a credit note, and approves it as one", () => {
    renderReview(capture({ header: { ...capture().header, documentType: "Credit Note" }, validationStatus: "Review" }));
    expect(screen.getByText("This is a supplier credit note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve — create draft credit note" })).toBeEnabled();
  });

  it("a waiting document can be entered by hand", async () => {
    renderReview(capture({ status: "Queued", stage: "inbox", validationStatus: "Pending", lines: [], extracted: null, extractedLines: null }));
    fireEvent.click(screen.getByRole("button", { name: "Enter by hand" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ action: "manual-entry" });
  });

  it("a manual entry is editable and is submitted for review", async () => {
    renderReview(capture({ status: "ManualEntry", stage: "inbox", manualEntry: true, extracted: null, extractedLines: null, validationStatus: "Pending" }));
    expect(screen.getAllByText("Entered by hand").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add a line" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ action: "submit-for-review" });
  });

  it("header corrections send only the changed fields", async () => {
    renderReview(capture());
    fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ action: "correct-header", header: { total: 1200 } });
  });

  it("unsaved edits survive a refresh that changes nothing they show (e.g. after confirming the supplier)", () => {
    const { rerender } = renderReview(capture());
    fireEvent.change(screen.getByLabelText("Total"), { target: { value: "1200" } });
    // The page refreshes and hands over a NEW but identical capture object.
    rerender(<CaptureReviewWorkspace companyId="co_1" capture={capture()} can={ALL} suppliers={SUPPLIERS} vatTreatments={VAT} chartOfAccounts={COA} />);
    expect(screen.getByLabelText("Total")).toHaveValue("1200");
    expect(screen.getByRole("button", { name: "Save details" })).toBeEnabled();
    // ...but a refresh that DOES change the stored value shows the stored value.
    rerender(<CaptureReviewWorkspace companyId="co_1" capture={capture({ header: { ...capture().header, total: 1300 } })} can={ALL} suppliers={SUPPLIERS} vatTreatments={VAT} chartOfAccounts={COA} />);
    expect(screen.getByLabelText("Total")).toHaveValue("1300");
  });

  it("shows a blocked duplicate and links to the other document", () => {
    renderReview(capture({ duplicateStatus: "Blocked", duplicateReason: "Already captured.", duplicateOfCaptureId: 3 }));
    expect(screen.getByText("Duplicate — this cannot be approved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the other document" })).toHaveAttribute("href", "/company/co_1/supplier-documents/invoice-capture/3");
  });

  it("an approved document links to its draft in Purchasing and offers no edits", () => {
    renderReview(capture({ status: "Converted", stage: "approved", bill: { id: 90, invoiceNumber: "INV-100", documentType: "Bill", postingStatus: "Draft", total: 1150 }, convertedBy: "approver@example.test", convertedAt: "2026-09-02T09:00:00Z" }));
    expect(screen.getByRole("link", { name: "Open in Purchasing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save details/ })).not.toBeInTheDocument();
  });
});
