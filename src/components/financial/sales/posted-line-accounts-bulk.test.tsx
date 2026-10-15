import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { isPostedRepairCandidate, PostedLineAccountsBulkRepair, REPAIR_PAGE_SIZE } from "./posted-line-accounts-bulk";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";

const line = (id: number, glAccount: string | null) => ({ id, glAccount }) as SalesInvoiceLine;
const inv = (id: number, o: Partial<SalesInvoice> = {}) =>
  ({ id, invoiceNumber: `SI-${id}`, documentType: "Invoice", status: "Posted", total: 100, lines: [line(id * 10, null), line(id * 10 + 1, "1005")], ...o }) as SalesInvoice;


function Harness({ invoices, visible, onDone = () => {} }: { invoices: SalesInvoice[]; visible?: SalesInvoice[]; onDone?: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  return <PostedLineAccountsBulkRepair companyId="co_1" invoices={invoices} visibleInvoices={visible ?? invoices} selected={selected} onSelectedChange={setSelected} previewMode={false} onDone={onDone} />;
}

type Posted = { invoiceIds: number[] };
let posts: Posted[];
let postResult: (ids: number[]) => { status: number; body: unknown };
let scopeResponse: unknown;

beforeEach(() => {
  posts = [];
  postResult = (ids) => ({ status: 200, body: { results: ids.map((id) => ({ invoiceId: id, invoiceNumber: `SI-${id}`, outcome: "repaired", linesAssigned: 1, message: "1 line(s) set to 1000; journal unchanged." })) } });
  scopeResponse = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Posted;
      posts.push(body);
      const r = postResult(body.invoiceIds);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (input.includes("?scope=")) return new Response(JSON.stringify({ preview: scopeResponse }), { status: 200 });
    return new Response(JSON.stringify({ scopes: [{ id: "handcrafted-batch-1b", label: "Batch 1B", description: "", expected: {} }] }), { status: 200 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("isPostedRepairCandidate", () => {
  it("is true only for a Posted Invoice with a line without an account", () => {
    expect(isPostedRepairCandidate(inv(1))).toBe(true);
    expect(isPostedRepairCandidate(inv(1, { status: "Draft" }))).toBe(false);
    expect(isPostedRepairCandidate(inv(1, { documentType: "Credit Note" }))).toBe(false);
    expect(isPostedRepairCandidate(inv(1, { documentType: "Debit Note" }))).toBe(false);
    expect(isPostedRepairCandidate(inv(1, { lines: [line(1, "1000")] }))).toBe(false);
  });
});

describe("PostedLineAccountsBulkRepair", () => {
  it("is not shown when no Posted invoice lacks an account", () => {
    const { container } = render(<Harness invoices={[inv(1, { status: "Draft" }), inv(2, { lines: [line(1, "1000")] })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("selects all eligible visible results only, and shows invoices, lines and total", () => {
    const invoices = [inv(1, { total: 100.5 }), inv(2, { total: 200, lines: [line(20, null), line(21, null)] }), inv(3, { status: "Draft" }), inv(4)];
    render(<Harness invoices={invoices} visible={invoices.slice(0, 3)} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible results (2)" }));
    expect(screen.getByText(/Selected:/).textContent).toBe("Selected: 2 invoice(s), 3 line(s) without an account, invoice total R300.50.");
  });

  it("confirms with the exact promise, then sends invoice ids only (no account) and shows each result", async () => {
    const onDone = vi.fn();
    render(<Harness invoices={[inv(1), inv(2)]} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible results (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Review repair…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm account repair" });
    expect(dialog.textContent).toContain("to 1000 — Product Sales");
    expect(dialog.textContent).toContain("Only lines with no account change; a line that already has an account is never changed.");
    expect(dialog.textContent).toContain("Journals, invoice amounts, VAT, outstanding balances and invoice statuses do not change.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign 1000 to 2 line(s)" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(posts).toEqual([{ invoiceIds: [1, 2] }]);
    const results = screen.getByLabelText("Repair results");
    expect(results.textContent).toContain("Repaired 2, already repaired 0, skipped 0, failed 0; 2 line(s) set to 1000.");
  });

  it(`sends a large selection in pages of ${REPAIR_PAGE_SIZE}`, async () => {
    const invoices = Array.from({ length: 120 }, (_, i) => inv(i + 1));
    render(<Harness invoices={invoices} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible results (120)" }));
    fireEvent.click(screen.getByRole("button", { name: "Review repair…" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign 1000 to 120 line(s)" }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts.map((p) => p.invoiceIds.length)).toEqual([50, 50, 20]);
    expect(new Set(posts.flatMap((p) => p.invoiceIds)).size).toBe(120);
  });

  it("shows partial failures and retries only the failed invoices", async () => {
    postResult = (ids) => ({
      status: 200,
      body: { results: ids.map((id) => (id === 2 ? { invoiceId: 2, invoiceNumber: "SI-2", outcome: "failed", linesAssigned: 0, message: "audit unavailable" } : { invoiceId: id, invoiceNumber: `SI-${id}`, outcome: "repaired", linesAssigned: 1, message: "ok" })) },
    });
    render(<Harness invoices={[inv(1), inv(2), inv(3)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible results (3)" }));
    fireEvent.click(screen.getByRole("button", { name: "Review repair…" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign 1000 to 3 line(s)" }));
    expect(await screen.findByText("audit unavailable")).toBeInTheDocument();

    postResult = (ids) => ({ status: 200, body: { results: ids.map((id) => ({ invoiceId: id, invoiceNumber: `SI-${id}`, outcome: "repaired", linesAssigned: 1, message: "ok" })) } });
    fireEvent.click(screen.getByRole("button", { name: "Retry failed (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign 1000 to 1 line(s)" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ invoiceIds: [2] });
  });

  it("marks a whole page failed when the server refuses it (e.g. permission), so it can be retried", async () => {
    postResult = () => ({ status: 403, body: { error: 'Your role does not have the "Sales:Approve" permission.' } });
    render(<Harness invoices={[inv(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible results (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Review repair…" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign 1000 to 1 line(s)" }));
    expect(await screen.findByText('Your role does not have the "Sales:Approve" permission.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry failed (1)" })).toBeInTheDocument();
  });

  it("previews the pinned scope; selects exactly its invoices only when the preflight is ready", async () => {
    const candidate = (id: number) => ({ invoiceId: id, invoiceNumber: `SI-${id}`, journalNumber: `JR${id}`, total: 100, vatAmount: 13.04, missingLines: 1, lineCount: 2, eligible: true, alreadyRepaired: false, reason: null });
    scopeResponse = {
      account: { code: "1000", description: "Product Sales", ok: true, problem: null },
      candidates: [candidate(1), candidate(2)],
      eligible: { invoices: 2, lines: 2, total: 200, vatAmount: 26.08 },
      journalCount: 1390,
      scope: { id: "handcrafted-batch-1b", label: "Batch 1B", description: "", expected: { invoices: 2, lines: 2, total: 200, vatAmount: 26.08, journals: 1390 }, problems: [] },
      ready: true,
    };
    render(<Harness invoices={[inv(1), inv(2), inv(3)]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Preflight: Batch 1B" }));
    expect(await screen.findByText("Every pinned invoice, journal and figure matches.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select exactly these 2 invoice(s)" }));
    expect(screen.getByText(/Selected:/).textContent).toContain("Selected: 2 invoice(s)");
  });

  it("cannot select a scope whose preflight found a problem", async () => {
    scopeResponse = {
      account: { code: "1000", description: "Product Sales", ok: true, problem: null },
      candidates: [],
      eligible: { invoices: 0, lines: 0, total: 0, vatAmount: 0 },
      journalCount: 1391,
      scope: { id: "handcrafted-batch-1b", label: "Batch 1B", description: "", expected: { invoices: 43, lines: 132, total: 101911.04, vatAmount: 13292.78, journals: 1390 }, problems: ["The company has 1391 journals, expected 1390."] },
      ready: false,
    };
    render(<Harness invoices={[inv(1)]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Preflight: Batch 1B" }));
    expect(await screen.findByText("The company has 1391 journals, expected 1390.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select exactly these 0 invoice(s)" })).toBeDisabled();
  });
});
