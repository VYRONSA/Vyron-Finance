import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-connectivity-service", () => ({
  disconnectBankConnection: vi.fn(),
  getBankConnection: vi.fn(),
  listBankConnectionAccounts: vi.fn(),
  NotFoundError: class NotFoundError extends Error {},
}));

import { DELETE, GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { disconnectBankConnection, getBankConnection } from "@/server/bank-connectivity/bank-connectivity-service";

function params(companyId: string, connectionId = "1") {
  return { params: Promise.resolve({ companyId, connectionId }) };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(requirePermission).mockReset();
  vi.mocked(disconnectBankConnection).mockReset();
  vi.mocked(getBankConnection).mockReset();
});

describe("DELETE /api/companies/[companyId]/bank-connections/[connectionId] — mandatory tenant-isolation security test", () => {
  it("blocks a user with no Banking:Delete permission in Company B from disconnecting that company's bank connection", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), params("company-b"));

    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("company-b", "Banking:Delete");
    expect(disconnectBankConnection).not.toHaveBeenCalled();
  });

  it("scopes disconnection to the exact company and connection in the URL", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    await DELETE(new Request("http://localhost", { method: "DELETE" }), params("company-a", "42"));
    expect(disconnectBankConnection).toHaveBeenCalledWith("company-a", 42, expect.any(String));
  });
});

describe("GET /api/companies/[companyId]/bank-connections/[connectionId] — mandatory tenant-isolation security test", () => {
  it("blocks a user with no Banking:View permission in Company B", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost"), params("company-b"));
    expect(response.status).toBe(403);
    expect(getBankConnection).not.toHaveBeenCalled();
  });
});
