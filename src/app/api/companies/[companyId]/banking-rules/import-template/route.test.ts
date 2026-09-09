import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { BANKING_RULES_IMPORT_TEMPLATE_HEADERS } from "@/server/services/banking-rule-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
});

describe("GET .../banking-rules/import-template (Phase 32)", () => {
  it("serves a CSV attachment with the expected filename", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain('filename="VYRON_Banking_Rules_Import_Template.csv"');
  });

  it("the header row exactly matches the importer's own exported contract, headers only", async () => {
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    const text = await response.text();
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(1);
    expect(lines[0].split(",")).toEqual(BANKING_RULES_IMPORT_TEMPLATE_HEADERS);
  });

  it("requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(new Request("http://localhost/x"), params("co_1"));
    expect(response.status).toBe(401);
  });
});
