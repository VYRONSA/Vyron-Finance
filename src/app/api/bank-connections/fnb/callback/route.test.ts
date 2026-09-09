/**
 * Phase 16, Part 13/17/24 — mandatory security test for the OAuth
 * callback: even with a valid, single-use state token that resolves to
 * a real company, the CURRENT signed-in session must still independently
 * hold Banking:Edit on that exact company, or the connection is refused
 * — proving a forged/replayed callback can't attach a connection to a
 * company the current user has no rights to.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-connectivity-service", () => ({ completeBankConnectionAuthorization: vi.fn(), ValidationError: class ValidationError extends Error {} }));

import { GET } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { completeBankConnectionAuthorization } from "@/server/bank-connectivity/bank-connectivity-service";

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(requirePermission).mockReset();
  vi.mocked(completeBankConnectionAuthorization).mockReset();
});

describe("GET /api/bank-connections/fnb/callback — mandatory security", () => {
  it("redirects to an error and never completes when the resolved company's permission check fails", async () => {
    vi.mocked(completeBankConnectionAuthorization).mockResolvedValue({ companyId: "company-b", connection: { id: 1 } as never, redirectAfter: null });
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await GET(new Request("http://localhost/api/bank-connections/fnb/callback?code=real-code&state=real-state"));

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("bankConnectionError=unauthorized");
    expect(location).not.toContain("/company/company-b/bank-accounts?bankConnected=1");
    expect(requirePermission).toHaveBeenCalledWith("company-b", "Banking:Edit");
  });

  it("redirects to the real company's Banking Command Centre only when permission succeeds", async () => {
    vi.mocked(completeBankConnectionAuthorization).mockResolvedValue({ companyId: "company-a", connection: { id: 1 } as never, redirectAfter: null });
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });

    const response = await GET(new Request("http://localhost/api/bank-connections/fnb/callback?code=real-code&state=real-state"));

    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/company/company-a/bank-accounts");
    expect(location).toContain("bankConnected=1");
  });

  it("rejects a callback with a missing code or state without ever calling completeBankConnectionAuthorization", async () => {
    const response = await GET(new Request("http://localhost/api/bank-connections/fnb/callback"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("bankConnectionError=missing_code_or_state");
    expect(completeBankConnectionAuthorization).not.toHaveBeenCalled();
  });

  it("ignores an attacker-supplied absolute redirectAfter and only ever redirects same-origin", async () => {
    vi.mocked(completeBankConnectionAuthorization).mockResolvedValue({ companyId: "company-a", connection: { id: 1 } as never, redirectAfter: "https://evil.example/steal" });
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });

    const response = await GET(new Request("http://localhost/api/bank-connections/fnb/callback?code=c&state=s"));

    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example");
    expect(location).toContain("/company/company-a/bank-accounts");
  });

  it("returns 401 when there is no session at all", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("http://localhost/api/bank-connections/fnb/callback?code=c&state=s"));
    expect(response.status).toBe(401);
    expect(completeBankConnectionAuthorization).not.toHaveBeenCalled();
  });

  it("redirects to an error, never throwing a raw stack trace to the browser, when state validation fails (invalid/expired/reused state)", async () => {
    const { ValidationError } = await import("@/server/bank-connectivity/bank-connectivity-service");
    vi.mocked(completeBankConnectionAuthorization).mockRejectedValue(new ValidationError("This authorization link is invalid, has expired, or was already used."));

    const response = await GET(new Request("http://localhost/api/bank-connections/fnb/callback?code=c&state=already-used-state"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("bankConnectionError=");
  });
});
