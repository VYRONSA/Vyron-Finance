/**
 * Phase 21K — the cron-secured, company-independent Virtualmin/IMAP poll
 * route. Mirrors the mocking convention already used for the sibling
 * `/api/automation/run-due-tasks` cron route: `requireCronSecret` and
 * the underlying orchestration function are both mocked, no real
 * request/response wiring beyond Next.js's own `Request`/`NextResponse`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-cron-secret", () => ({ requireCronSecret: vi.fn() }));
vi.mock("@/server/services/inbound-bank-statement-email-service", () => ({ pollBankStatementImapMailbox: vi.fn() }));

import { POST } from "./route";
import { requireCronSecret } from "@/server/auth/require-cron-secret";
import { pollBankStatementImapMailbox } from "@/server/services/inbound-bank-statement-email-service";
import { NextResponse } from "next/server";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://vyron.example/api/automation/poll-bank-statement-mailbox", { method: "POST", headers });
}

beforeEach(() => {
  vi.mocked(requireCronSecret).mockReset().mockReturnValue({ ok: true });
  vi.mocked(pollBankStatementImapMailbox).mockReset();
});

describe("POST /api/automation/poll-bank-statement-mailbox", () => {
  it("rejects a request that fails cron-secret authentication, never attempting a poll", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireCronSecret).mockReturnValue({ ok: false, response: unauthorized });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(pollBankStatementImapMailbox).not.toHaveBeenCalled();
  });

  it("authenticates successfully and returns the real poll outcome", async () => {
    vi.mocked(pollBankStatementImapMailbox).mockResolvedValue({ configured: true, candidates: 3, processed: 2, rejected: 1, failed: 0, duplicate: 0, elapsedMs: 850 });

    const response = await POST(request({ authorization: "Bearer test-secret" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, outcome: { configured: true, candidates: 3, processed: 2, rejected: 1, failed: 0, duplicate: 0, elapsedMs: 850 } });
  });

  it("reports an honest configured:false outcome (not an error) when IMAP/admin env vars aren't set yet", async () => {
    vi.mocked(pollBankStatementImapMailbox).mockResolvedValue({ configured: false, candidates: 0, processed: 0, rejected: 0, failed: 0, duplicate: 0, elapsedMs: 1 });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome.configured).toBe(false);
  });

  it("returns 502 with a generic message (never the raw connection/auth error) when the real IMAP poll fails", async () => {
    vi.mocked(pollBankStatementImapMailbox).mockRejectedValue(new Error("ECONNREFUSED mail.vyronsoft.co.za:993 — bad password for bankstatements@vyronsoft.co.za"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/password|vyronsoft\.co\.za:993|ECONNREFUSED/i);
  });

  it("never leaks message-level content (recipient, sender, subject) in the response — the outcome is aggregate counts only", async () => {
    vi.mocked(pollBankStatementImapMailbox).mockResolvedValue({ configured: true, candidates: 1, processed: 1, rejected: 0, failed: 0, duplicate: 0, elapsedMs: 100 });

    const response = await POST(request());
    const body = await response.json();

    expect(Object.keys(body.outcome).sort()).toEqual(["candidates", "configured", "duplicate", "elapsedMs", "failed", "processed", "rejected"].sort());
  });
});
