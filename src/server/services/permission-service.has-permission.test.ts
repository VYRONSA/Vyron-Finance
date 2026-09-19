/**
 * Phase 5C — `hasPermission` asks the same question `requirePermission`
 * answers, but as a question rather than a gate.
 *
 * It exists so a route can perform LESS of an operation instead of
 * refusing all of it: an importer who holds `Banking:Create` but not
 * `Banking:Post` imports the transactions and leaves the posting for
 * someone who can. Two properties matter and are pinned here:
 *   1. it resolves permissions exactly as `requirePermission` does
 *      (including role inheritance), so the two can never disagree;
 *   2. it records NO `PermissionDenied` event — a capability downgrade is
 *      not a refusal, and logging it as one would bury real refusals in
 *      the Security Dashboard.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/repositories/permission-repository", async (importOriginal) => ({
  // The service re-exports several administration functions from this
  // repository, so the real module shape has to be preserved.
  ...(await importOriginal<typeof import("@/server/repositories/permission-repository")>()),
  getUserRoleAssignment: vi.fn(),
  listRolesWithGrantsForCompany: vi.fn(),
}));
vi.mock("@/server/services/operations-service", () => ({ recordSystemEvent: vi.fn() }));

import { hasPermission, requirePermission } from "./permission-service";
import { getCurrentUserId } from "@/server/auth/require-session";
import * as repo from "@/server/repositories/permission-repository";
import { recordSystemEvent } from "@/server/services/operations-service";
import type { PermissionKey, PermissionRoleWithGrants } from "@/server/permissions/types";

function role(overrides: Partial<PermissionRoleWithGrants> = {}): PermissionRoleWithGrants {
  return {
    id: 1,
    companyId: "co_1",
    name: "Bookkeeper",
    description: "",
    isSystem: true,
    parentRoleId: null,
    permissionKeys: ["Banking:View", "Banking:Create", "Banking:Edit"] as PermissionKey[],
    approvalLimits: [],
    ...overrides,
  } as PermissionRoleWithGrants;
}

/** Installs one company role and assigns the current user to it. */
function install(roles: PermissionRoleWithGrants[], assignedRoleId: number | null) {
  vi.mocked(repo.listRolesWithGrantsForCompany).mockResolvedValue(roles);
  vi.mocked(repo.getUserRoleAssignment).mockResolvedValue(assignedRoleId === null ? null : ({ roleId: assignedRoleId } as never));
}

beforeEach(() => {
  vi.mocked(getCurrentUserId).mockReset().mockResolvedValue("user-1");
  vi.mocked(repo.getUserRoleAssignment).mockReset();
  vi.mocked(repo.listRolesWithGrantsForCompany).mockReset();
  vi.mocked(recordSystemEvent).mockReset().mockResolvedValue(undefined as never);
});

describe("hasPermission", () => {
  it("true when the role holds the key", async () => {
    install([role({ permissionKeys: ["Banking:Edit", "Banking:Post"] as PermissionKey[] })], 1);
    expect(await hasPermission("co_1", "Banking:Post")).toBe(true);
  });

  it("false when the role does not hold the key", async () => {
    install([role()], 1);
    expect(await hasPermission("co_1", "Banking:Post")).toBe(false);
  });

  it("false — never permissive — when the user has no role in this company", async () => {
    install([role()], null);
    expect(await hasPermission("co_1", "Banking:Post")).toBe(false);
  });

  it("honours role inheritance, exactly as requirePermission does", async () => {
    const parent = role({ id: 2, name: "Senior Bookkeeper", permissionKeys: ["Banking:Post"] as PermissionKey[] });
    const child = role({ id: 1, parentRoleId: 2, permissionKeys: ["Banking:Edit"] as PermissionKey[] });
    install([child, parent], 1);
    expect(await hasPermission("co_1", "Banking:Post")).toBe(true);
  });

  it("records NO PermissionDenied event when the answer is false", async () => {
    install([role()], 1);
    await hasPermission("co_1", "Banking:Post");
    expect(recordSystemEvent).not.toHaveBeenCalled();
  });

  it("requirePermission still DOES record a denial — the audit trail for real refusals is unchanged", async () => {
    install([role()], 1);
    const check = await requirePermission("co_1", "Banking:Post");
    expect(check.ok).toBe(false);
    expect(recordSystemEvent).toHaveBeenCalledWith("co_1", "PermissionDenied", "warning", "user-1", expect.stringContaining("Banking:Post"), { permissionKey: "Banking:Post" });
  });

  it("agrees with requirePermission for the same role and key, both ways", async () => {
    for (const keys of [["Banking:Edit"], ["Banking:Edit", "Banking:Post"]] as PermissionKey[][]) {
      install([role({ permissionKeys: keys })], 1);
      const allowed = (await requirePermission("co_1", "Banking:Post")).ok;
      install([role({ permissionKeys: keys })], 1);
      expect(await hasPermission("co_1", "Banking:Post")).toBe(allowed);
    }
  });

  it("asks about the company it was given (tenant scoping)", async () => {
    install([role({ companyId: "co_2" })], 1);
    await hasPermission("co_2", "Banking:Post");
    expect(repo.getUserRoleAssignment).toHaveBeenCalledWith("user-1", "co_2");
    expect(repo.listRolesWithGrantsForCompany).toHaveBeenCalledWith("co_2");
  });
});
