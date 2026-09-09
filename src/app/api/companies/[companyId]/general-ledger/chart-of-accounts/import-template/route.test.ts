/**
 * Phase 32 — "every import function must provide a downloadable
 * template." This route is what `chart-of-accounts-tab.tsx`'s "Download
 * Template" button hits — proves it returns exactly the importer's own
 * required header row as a downloadable CSV.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS } from "@/server/services/chart-of-accounts-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
});

describe("GET .../chart-of-accounts/import-template (Phase 32)", () => {
  it("1/2 — a template download exists and is served as a CSV attachment with the expected filename", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain('filename="VYRON_Chart_of_Accounts_Import_Template.csv"');
  });

  it("3/4/5 — the header row exactly matches the importer's own exported contract, required columns included", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    const text = await response.text();
    const headerLine = text.trim().split("\r\n")[0];
    expect(headerLine.split(",")).toEqual(CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS);
    expect(headerLine).toContain("Account Code");
    expect(headerLine).toContain("Normal Balance");
  });

  it("6 — contains no data row, headers only", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    const text = await response.text();
    expect(text.trim().split("\r\n")).toHaveLength(1);
  });

  it("requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    expect(response.status).toBe(401);
  });
});
