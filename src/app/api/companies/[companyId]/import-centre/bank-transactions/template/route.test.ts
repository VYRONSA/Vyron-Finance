/**
 * Phase 32 — Bank Transactions is the one importer that genuinely
 * supports both CSV and XLSX, so it gets an Excel template too. `exceljs`
 * is already a dependency (used to PARSE .xlsx bank statements) — this
 * proves the GENERATED workbook is itself readable by that same parser's
 * own header check, not just "some bytes came back."
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { STANDARD_HEADERS } from "@/server/import-centre/bank-statement-parser";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
});

describe("GET .../import-centre/bank-transactions/template (Phase 32)", () => {
  it("serves an XLSX attachment with the expected filename", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(response.headers.get("Content-Disposition")).toContain('filename="VYRON_Bank_Transactions_Import_Template.xlsx"');
  });

  it("the generated workbook's header row exactly matches STANDARD_HEADERS, in order — a real, readable .xlsx file, not just bytes", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    const buffer = await response.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    for (let col = 1; col <= STANDARD_HEADERS.length; col++) headers.push(String(headerRow.getCell(col).value ?? ""));

    expect(headers).toEqual(STANDARD_HEADERS);
    expect(sheet.rowCount).toBe(1); // headers only — no fabricated data row
  });

  it("requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    expect(response.status).toBe(401);
  });
});
