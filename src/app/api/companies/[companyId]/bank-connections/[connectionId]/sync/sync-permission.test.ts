/**
 * Phase 5C — manual "Sync Now".
 *
 *   Banking:Edit  sync / import / classify bank transactions (unchanged —
 *                 syncing is legitimately an Edit operation, so a user with
 *                 Edit is NOT blocked from syncing)
 *   Banking:Post  let the attached Banking Rules pass post what was synced
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-connectivity-service", () => ({ getBankConnection: vi.fn(), listBankConnectionAccounts: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-sync-service", () => ({ syncBankConnectionAccount: vi.fn() }));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { getBankConnection, listBankConnectionAccounts } from "@/server/bank-connectivity/bank-connectivity-service";
import { syncBankConnectionAccount } from "@/server/bank-connectivity/bank-sync-service";

const params = { params: Promise.resolve({ companyId: "co_1", connectionId: "7" }) };
const request = () => new Request("http://localhost/api/companies/co_1/bank-connections/7/sync", { method: "POST" });

const OUTCOME = {
  run: { id: 1 },
  transactionsFetched: 10,
  transactionsImported: 10,
  transactionsDuplicate: 0,
  rulePass: { notPermitted: 4, notAttempted: 0, stopReason: null },
};

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("syncer@example.test");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(hasPermission).mockReset().mockResolvedValue(true);
  vi.mocked(getBankConnection).mockReset().mockResolvedValue({ id: 7 } as never);
  vi.mocked(listBankConnectionAccounts).mockReset().mockResolvedValue([{ id: 11, status: "Active" }] as never);
  vi.mocked(syncBankConnectionAccount).mockReset().mockResolvedValue(OUTCOME as never);
});

describe("POST bank-connections/[id]/sync — sync is Edit, posting is Post", () => {
  it("a user with Banking:Edit but NOT Banking:Post can still sync", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Banking:Edit");
    expect(syncBankConnectionAccount).toHaveBeenCalledTimes(1);
  });

  it("without Banking:Post the sync's rule pass may not post", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await POST(request(), params);
    expect(hasPermission).toHaveBeenCalledWith("co_1", "Banking:Post");
    expect(vi.mocked(syncBankConnectionAccount).mock.calls[0]![5]).toEqual({ mayPost: false });
  });

  it("with Banking:Post it may post", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    await POST(request(), params);
    expect(vi.mocked(syncBankConnectionAccount).mock.calls[0]![5]).toEqual({ mayPost: true });
  });

  it("the per-account response carries what was left unposted", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    const response = await POST(request(), params);
    const body = await response.json();
    expect(body.results[0]).toMatchObject({ status: "Success", rulePass: { notPermitted: 4 } });
  });

  it("without Banking:Edit nothing is synced", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(syncBankConnectionAccount).not.toHaveBeenCalled();
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("it asks about exactly the company in the path", async () => {
    const otherParams = { params: Promise.resolve({ companyId: "co_2", connectionId: "7" }) };
    await POST(request(), otherParams);
    expect(requirePermission).toHaveBeenCalledWith("co_2", "Banking:Edit");
    expect(hasPermission).toHaveBeenCalledWith("co_2", "Banking:Post");
    expect(vi.mocked(syncBankConnectionAccount).mock.calls[0]![0]).toBe("co_2");
  });

  it("an unauthenticated request never reaches a permission check", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(syncBankConnectionAccount).not.toHaveBeenCalled();
  });
});
