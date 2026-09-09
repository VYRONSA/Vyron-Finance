/**
 * Phase 16, Part 13/17 — mandatory security test: a user with no role
 * (or no Banking permission) in a company can never initiate or list
 * that company's bank connections. Every dependency is mocked; this
 * never touches a real Supabase project or FNB.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-connectivity-service", () => ({ initiateBankConnection: vi.fn(), listBankConnections: vi.fn() }));

import { GET, POST } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { initiateBankConnection, listBankConnections } from "@/server/bank-connectivity/bank-connectivity-service";

function request(body?: Record<string, unknown>): Request {
  return new Request("http://localhost/api/companies/x/bank-connections", { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined });
}

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(requirePermission).mockReset();
  vi.mocked(initiateBankConnection).mockReset();
  vi.mocked(listBankConnections).mockReset();
});

describe("POST /api/companies/[companyId]/bank-connections — mandatory tenant-isolation security test", () => {
  it("blocks a user with no Banking:Create permission in Company B from ever initiating a connection there", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await POST(request({ provider: "FNB" }), params("company-b"));

    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("company-b", "Banking:Create");
    expect(initiateBankConnection).not.toHaveBeenCalled();
  });

  it("scopes initiation to the exact company in the URL", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    vi.mocked(initiateBankConnection).mockResolvedValue({ connection: { id: 1 } as never, authorizationUrl: "https://fnb.example/authorize" });

    await POST(request({ provider: "FNB" }), params("company-a"));

    expect(initiateBankConnection).toHaveBeenCalledWith("company-a", "FNB", "production", expect.any(String), null);
  });
});

describe("GET /api/companies/[companyId]/bank-connections — mandatory tenant-isolation security test", () => {
  it("blocks a user with no Banking:View permission in Company B from listing that company's connections", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await GET(request(), params("company-b"));

    expect(response.status).toBe(403);
    expect(listBankConnections).not.toHaveBeenCalled();
  });
});

describe("regression — existing gates", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(request(), params("co_1"));
    expect(response.status).toBe(401);
  });
});
