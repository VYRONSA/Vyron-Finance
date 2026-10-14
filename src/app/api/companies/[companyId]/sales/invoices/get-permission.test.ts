/**
 * Phase 5I — reading invoices requires `Sales:View`.
 *
 * Before this, both GET routes checked only that someone was signed in.
 * The PDF route for the SAME document already required `Sales:View`, so
 * a caller refused the PDF could still read every invoice's customer,
 * amounts, dates and status as JSON. Row-level security still enforces
 * the tenant boundary underneath; this adds the module permission the
 * rest of Sales already uses.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), requireApproval: vi.fn() }));
vi.mock("@/server/services/sales-invoice-service", () => ({
  listSalesInvoices: vi.fn(),
  listSalesInvoicesByCustomer: vi.fn(),
  getSalesInvoice: vi.fn(),
  createSalesInvoice: vi.fn(),
  createInvoiceFromOrder: vi.fn(),
  approveAndPostInvoice: vi.fn(),
  assignMissingLineAccounts: vi.fn(),
  submitInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  retryPostInvoice: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {},
}));

import { GET as listGet } from "./route";
import { GET as oneGet } from "./[invoiceId]/route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSalesInvoice, listSalesInvoices } from "@/server/services/sales-invoice-service";

const listParams = { params: Promise.resolve({ companyId: "co_1" }) };
const oneParams = { params: Promise.resolve({ companyId: "co_1", invoiceId: "5" }) };
const listReq = () => new Request("http://localhost/api/companies/co_1/sales/invoices");
const oneReq = () => new Request("http://localhost/api/companies/co_1/sales/invoices/5");

const DENIED = NextResponse.json({ error: 'Your role ("Bookkeeper") does not have the "Sales:View" permission.' }, { status: 403 });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(listSalesInvoices).mockReset().mockResolvedValue([]);
  vi.mocked(getSalesInvoice).mockReset().mockResolvedValue({ id: 5 } as never);
});

describe("GET /sales/invoices — authorisation", () => {
  it("an authorised user gets the invoices, and Sales:View was the check", async () => {
    const response = await listGet(listReq(), listParams);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:View");
  });

  it("an unauthorised user is refused, and no invoice data is read", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: DENIED });

    const response = await listGet(listReq(), listParams);

    expect(response.status).toBe(403);
    expect(listSalesInvoices).not.toHaveBeenCalled();
  });

  it("an unauthenticated request never reaches the permission check", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);

    const response = await listGet(listReq(), listParams);

    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(listSalesInvoices).not.toHaveBeenCalled();
  });

  it("the permission is checked against the company in the path, not a default", async () => {
    await listGet(
      new Request("http://localhost/api/companies/co_2/sales/invoices"),
      { params: Promise.resolve({ companyId: "co_2" }) },
    );
    expect(requirePermission).toHaveBeenCalledWith("co_2", "Sales:View");
  });

  it("cross-tenant: a user refused in the other company cannot read its invoices", async () => {
    vi.mocked(requirePermission).mockImplementation(async (companyId) =>
      companyId === "co_1" ? { ok: true } : { ok: false, response: DENIED },
    );

    const mine = await listGet(listReq(), listParams);
    const theirs = await listGet(
      new Request("http://localhost/api/companies/co_2/sales/invoices"),
      { params: Promise.resolve({ companyId: "co_2" }) },
    );

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(403);
    // The refused company's data was never fetched.
    expect(vi.mocked(listSalesInvoices).mock.calls.every(([c]) => c === "co_1")).toBe(true);
  });
});

describe("GET /sales/invoices/[invoiceId] — authorisation", () => {
  it("an authorised user gets the invoice", async () => {
    const response = await oneGet(oneReq(), oneParams);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Sales:View");
  });

  it("an unauthorised user is refused and the invoice is never loaded", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: DENIED });

    const response = await oneGet(oneReq(), oneParams);

    expect(response.status).toBe(403);
    expect(getSalesInvoice).not.toHaveBeenCalled();
  });

  it("refusal comes before the not-found check, so a 403 cannot be probed into a 404", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: DENIED });
    vi.mocked(getSalesInvoice).mockResolvedValue(null as never);

    const response = await oneGet(oneReq(), oneParams);

    // A refused caller must not be able to learn which invoice ids exist.
    expect(response.status).toBe(403);
  });
});
