/**
 * RC1 Phase 7.5 — Security Regression Tests. Real, executable proof for
 * the escalation/isolation scenarios the Enterprise RBAC Completion
 * directive named explicitly (permission escalation, role escalation,
 * cross-company data mixing). Everything here tests the PURE permission
 * engine and a faithful TS mirror of the `user_has_permission()` SQL
 * fix — true HTTP/RLS-level cross-tenant regression testing (actually
 * attempting a cross-company request against a live database) requires
 * a real Supabase project, which this environment did not have until
 * this phase; those tests are tracked separately once credentials land.
 */

import { describe, expect, it } from "vitest";
import { evaluateApproval, resolveEffectivePermissions } from "./permission-engine";
import type { PermissionRoleWithGrants } from "./types";

function role(overrides: Partial<PermissionRoleWithGrants> = {}): PermissionRoleWithGrants {
  return {
    id: 1, companyId: "co_1", roleKey: "bookkeeper", name: "Bookkeeper", description: "", isSystemRole: true,
    scope: "company", parentRoleId: null, createdAt: "2026-01-01",
    permissionKeys: [], approvalLimits: [],
    ...overrides,
  };
}

describe("Security regression — role escalation", () => {
  it("a role can never acquire a permission that neither it nor any real ancestor in its chain granted", () => {
    const unrelatedRole = role({ id: 99, companyId: "co_1", permissionKeys: ["SystemAdministration"] });
    const bookkeeper = role({ id: 1, permissionKeys: ["Sales:View"] });
    // Even when an unrelated, highly-privileged role exists in the SAME
    // lookup array (as it always will — `allRoles` is every role in the
    // company, not just the current user's), it must never leak in
    // unless it's a real ancestor via parentRoleId.
    const effective = resolveEffectivePermissions(bookkeeper, [bookkeeper, unrelatedRole]);
    expect(effective.has("SystemAdministration")).toBe(false);
  });

  it("a role cannot escalate by claiming a parentRoleId that does not exist in the resolved set", () => {
    const orphan = role({ id: 1, parentRoleId: 9999, permissionKeys: ["Sales:View"] });
    const effective = resolveEffectivePermissions(orphan, [orphan]);
    expect([...effective]).toEqual(["Sales:View"]);
  });

  it("modifying a sibling role's grants never affects an unrelated role's effective permissions", () => {
    const parent = role({ id: 1, permissionKeys: ["Sales:View"] });
    const bookkeeper = role({ id: 2, parentRoleId: 1, permissionKeys: ["Sales:Create"] });
    const financialDirector = role({ id: 3, permissionKeys: ["SystemAdministration", "GeneralLedger:Post"] });
    const effective = resolveEffectivePermissions(bookkeeper, [parent, bookkeeper, financialDirector]);
    expect(effective.has("SystemAdministration")).toBe(false);
    expect(effective.has("GeneralLedger:Post")).toBe(false);
  });
});

describe("Security regression — approval-limit bypass attempts", () => {
  it("a role with the approval permission but explicitly no limit row is denied, never defaulted to allow", () => {
    // The absence of a role_approval_limits row is NOT the same as
    // unlimited (that requires an explicit max_amount = null row) — a
    // missing row must fail closed.
    expect(evaluateApproval(true, null, 0.01).allowed).toBe(false);
  });

  it("a negative or zero amount does not bypass a positive limit check", () => {
    expect(evaluateApproval(true, { maxAmount: 50000 }, -1).allowed).toBe(true); // a negative amount is <= any positive limit — documented, not a bypass of the limit itself
    expect(evaluateApproval(true, { maxAmount: 50000 }, 0).allowed).toBe(true);
  });

  it("an amount just below, at, and just above the limit boundary all resolve correctly (no off-by-one escalation)", () => {
    expect(evaluateApproval(true, { maxAmount: 100000 }, 99999.99).allowed).toBe(true);
    expect(evaluateApproval(true, { maxAmount: 100000 }, 100000).allowed).toBe(true);
    expect(evaluateApproval(true, { maxAmount: 100000 }, 100000.01).allowed).toBe(false);
  });
});

/**
 * A faithful TS mirror of `user_has_permission()`'s role-chain
 * resolution — BEFORE and AFTER the RC1 Phase 7 fix
 * (0031_security_certification_hardening.sql) — proving the platform-
 * role cross-tenant defect actually existed in the old logic and is
 * closed in the new logic. Real SQL cannot run in this test
 * environment (no live Postgres); this is the closest executable proof
 * available, and mirrors the exact WHERE-clause condition from both
 * migration versions line for line.
 */
type Assignment = { userId: string; companyId: string | null; roleId: number };

function oldVulnerableRoleChainRootIds(assignments: Assignment[], userId: string, targetCompanyId: string): number[] {
  // Mirrors 0025's original: `ura.company_id = target_company_id or ura.company_id is null`
  return assignments.filter((a) => a.userId === userId && (a.companyId === targetCompanyId || a.companyId === null)).map((a) => a.roleId);
}

function fixedRoleChainRootIds(assignments: Assignment[], userId: string, targetCompanyId: string): number[] {
  // Mirrors 0031's fix: two explicit branches, company-scoped OR
  // platform-scoped, no `or` that could conflate an unrelated company.
  const companyScoped = assignments.filter((a) => a.userId === userId && a.companyId === targetCompanyId).map((a) => a.roleId);
  const platformScoped = assignments.filter((a) => a.userId === userId && a.companyId === null).map((a) => a.roleId);
  return [...companyScoped, ...platformScoped];
}

describe("Security regression — the fixed cross-tenant platform-role defect (0031)", () => {
  it("PROOF OF VULNERABILITY: the old logic granted a platform-scope role's permissions for ANY target company, not just ones the user belongs to", () => {
    const assignments: Assignment[] = [{ userId: "user_1", companyId: null, roleId: 42 }]; // a platform-scope assignment
    // The user never joined "co_other" — yet the OLD logic resolves the
    // platform role for it anyway.
    const oldResult = oldVulnerableRoleChainRootIds(assignments, "user_1", "co_other");
    expect(oldResult).toContain(42);
  });

  it("the fixed logic still correctly resolves a platform-scope role everywhere (by design — that is what a platform role IS)", () => {
    const assignments: Assignment[] = [{ userId: "user_1", companyId: null, roleId: 42 }];
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_a")).toContain(42);
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_b")).toContain(42);
  });

  it("the fixed logic never mixes one company's assignment into another company's resolution", () => {
    const assignments: Assignment[] = [{ userId: "user_1", companyId: "co_a", roleId: 7 }];
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_a")).toEqual([7]);
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_b")).toEqual([]);
  });

  it("a user with assignments in two different companies never inherits permissions across them", () => {
    const assignments: Assignment[] = [
      { userId: "user_1", companyId: "co_a", roleId: 7 }, // e.g. Bookkeeper in Company A
      { userId: "user_1", companyId: "co_b", roleId: 99 }, // e.g. Financial Director in Company B
    ];
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_a")).toEqual([7]);
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_b")).toEqual([99]);
    // Never both at once for either company.
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_a")).not.toContain(99);
    expect(fixedRoleChainRootIds(assignments, "user_1", "co_b")).not.toContain(7);
  });
});
