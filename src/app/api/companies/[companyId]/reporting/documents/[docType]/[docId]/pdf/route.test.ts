/**
 * Document Centre PDF — access control stays in front of the
 * server-rendered PDF: no session → 401, no RunReports permission → 403,
 * and in both cases no document is loaded and no PDF is built.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/is-configured", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/report-centre/documents", () => ({ isDocumentType: () => true, loadBusinessDocument: vi.fn() }));
vi.mock("@/server/report-centre/source-for-company", () => ({ reportSourceForCompany: vi.fn() }));
vi.mock("@/server/pdf/pdf-generation-service", () => ({ generateBusinessDocumentPdf: vi.fn(), PdfGenerationError: class PdfGenerationError extends Error {} }));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { loadBusinessDocument } from "@/server/report-centre/documents";
import { generateBusinessDocumentPdf } from "@/server/pdf/pdf-generation-service";

const call = () =>
  GET(new Request("http://localhost/api/companies/company-a/reporting/documents/purchase-bill/101/pdf"), {
    params: Promise.resolve({ companyId: "company-a", docType: "purchase-bill", docId: "101" }),
  });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(loadBusinessDocument).mockReset();
  vi.mocked(generateBusinessDocumentPdf).mockReset();
});

describe("GET /reporting/documents/[docType]/[docId]/pdf — access control", () => {
  it("unauthenticated → 401, no document is loaded, no PDF is built", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await call();
    expect(res.status).toBe(401);
    expect(loadBusinessDocument).not.toHaveBeenCalled();
    expect(generateBusinessDocumentPdf).not.toHaveBeenCalled();
  });

  it("signed in without RunReports → 403, no PDF is built", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as never);
    const res = await call();
    expect(res.status).toBe(403);
    expect(generateBusinessDocumentPdf).not.toHaveBeenCalled();
  });
});
