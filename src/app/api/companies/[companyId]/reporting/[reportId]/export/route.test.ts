/**
 * Reporting Centre export — access control stays in front of every format,
 * including the server-rendered PDF: no session → 401, no RunReports
 * permission → 403, and in both cases no report runs and no PDF is built.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/is-configured", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/report-centre/source-for-company", () => ({ reportSourceForCompany: vi.fn() }));
vi.mock("@/server/pdf/pdf-generation-service", () => ({ generateReportPdf: vi.fn(), PdfGenerationError: class PdfGenerationError extends Error {} }));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { generateReportPdf } from "@/server/pdf/pdf-generation-service";

const call = (format: string) =>
  GET(new Request(`http://localhost/api/companies/company-a/reporting/trial-balance/export?format=${format}`), {
    params: Promise.resolve({ companyId: "company-a", reportId: "trial-balance" }),
  });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(reportSourceForCompany).mockReset();
  vi.mocked(generateReportPdf).mockReset();
});

describe("GET /reporting/[reportId]/export — access control", () => {
  it.each(["pdf", "csv", "xlsx"])("unauthenticated %s request → 401, nothing runs", async (format) => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await call(format);
    expect(res.status).toBe(401);
    expect(reportSourceForCompany).not.toHaveBeenCalled();
    expect(generateReportPdf).not.toHaveBeenCalled();
  });

  it("signed in without RunReports → 403, no PDF is built", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as never);
    const res = await call("pdf");
    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("company-a", "RunReports");
    expect(generateReportPdf).not.toHaveBeenCalled();
  });
});
