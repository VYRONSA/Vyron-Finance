import { describe, expect, it } from "vitest";
import { evaluateApproval, hasPermission, resolveApprovalLimit, resolveEffectivePermissions } from "./permission-engine";
import type { PermissionRoleWithGrants } from "./types";

function role(overrides: Partial<PermissionRoleWithGrants> = {}): PermissionRoleWithGrants {
  return {
    id: 1, companyId: "co_1", roleKey: "bookkeeper", name: "Bookkeeper", description: "", isSystemRole: true,
    scope: "company", parentRoleId: null, createdAt: "2026-01-01",
    permissionKeys: [], approvalLimits: [],
    ...overrides,
  };
}

describe("resolveEffectivePermissions", () => {
  it("returns a role's own permissions with no parent", () => {
    const r = role({ permissionKeys: ["Sales:View", "Sales:Create"] });
    const effective = resolveEffectivePermissions(r, [r]);
    expect([...effective].sort()).toEqual(["Sales:Create", "Sales:View"]);
  });

  it("unions a child role's permissions with its parent's (Senior Bookkeeper inherits Bookkeeper)", () => {
    const bookkeeper = role({ id: 1, permissionKeys: ["Sales:View", "Sales:Create", "Sales:Edit"] });
    const seniorBookkeeper = role({ id: 2, roleKey: "senior_bookkeeper", parentRoleId: 1, permissionKeys: ["Sales:Post", "ApproveJournals"] });
    const effective = resolveEffectivePermissions(seniorBookkeeper, [bookkeeper, seniorBookkeeper]);
    expect(effective.has("Sales:View")).toBe(true);
    expect(effective.has("Sales:Create")).toBe(true);
    expect(effective.has("Sales:Post")).toBe(true);
    expect(effective.has("ApproveJournals")).toBe(true);
  });

  it("walks a multi-level inheritance chain", () => {
    const grandparent = role({ id: 1, permissionKeys: ["Sales:View"] });
    const parent = role({ id: 2, parentRoleId: 1, permissionKeys: ["Sales:Create"] });
    const child = role({ id: 3, parentRoleId: 2, permissionKeys: ["Sales:Edit"] });
    const effective = resolveEffectivePermissions(child, [grandparent, parent, child]);
    expect([...effective].sort()).toEqual(["Sales:Create", "Sales:Edit", "Sales:View"]);
  });

  it("never grants a parent's permissions to a sibling role (no accidental leakage)", () => {
    const parent = role({ id: 1, permissionKeys: ["Sales:View"] });
    const childA = role({ id: 2, parentRoleId: 1, permissionKeys: ["Sales:Create"] });
    const childB = role({ id: 3, parentRoleId: 1, permissionKeys: ["Purchasing:Create"] });
    const effectiveA = resolveEffectivePermissions(childA, [parent, childA, childB]);
    expect(effectiveA.has("Purchasing:Create")).toBe(false);
  });

  it("is cycle-safe — a role that (incorrectly) points to itself never infinite-loops", () => {
    const cyclic = role({ id: 1, parentRoleId: 1, permissionKeys: ["Sales:View"] });
    const effective = resolveEffectivePermissions(cyclic, [cyclic]);
    expect(effective.has("Sales:View")).toBe(true);
  });

  it("is cycle-safe for a longer A->B->A cycle", () => {
    const a = role({ id: 1, parentRoleId: 2, permissionKeys: ["Sales:View"] });
    const b = role({ id: 2, parentRoleId: 1, permissionKeys: ["Purchasing:View"] });
    const effective = resolveEffectivePermissions(a, [a, b]);
    expect(effective.has("Sales:View")).toBe(true);
    expect(effective.has("Purchasing:View")).toBe(true);
  });
});

describe("hasPermission", () => {
  it("checks membership in the effective set", () => {
    const effective = new Set<"Sales:View" | "Sales:Create">(["Sales:View"]);
    expect(hasPermission(effective, "Sales:View")).toBe(true);
    expect(hasPermission(effective, "Sales:Create")).toBe(false);
  });
});

describe("resolveApprovalLimit", () => {
  it("returns the role's own limit when it has one", () => {
    const r = role({ approvalLimits: [{ id: 1, roleId: 1, category: "Journal", maxAmount: 50000 }] });
    expect(resolveApprovalLimit(r, [r], "Journal")).toEqual({ maxAmount: 50000 });
  });

  it("returns null (unlimited) when maxAmount is explicitly null", () => {
    const r = role({ approvalLimits: [{ id: 1, roleId: 1, category: "Journal", maxAmount: null }] });
    expect(resolveApprovalLimit(r, [r], "Journal")).toEqual({ maxAmount: null });
  });

  it("returns no-limit-row (the object is null) when neither the role nor any ancestor defines the category", () => {
    const r = role({ approvalLimits: [] });
    expect(resolveApprovalLimit(r, [r], "Journal")).toBeNull();
  });

  it("falls back to a parent's limit when the child defines none for that category", () => {
    const parent = role({ id: 1, approvalLimits: [{ id: 1, roleId: 1, category: "Journal", maxAmount: 50000 }] });
    const child = role({ id: 2, parentRoleId: 1, approvalLimits: [] });
    expect(resolveApprovalLimit(child, [parent, child], "Journal")).toEqual({ maxAmount: 50000 });
  });

  it("prefers the child's own limit over the parent's when both define the category", () => {
    const parent = role({ id: 1, approvalLimits: [{ id: 1, roleId: 1, category: "Journal", maxAmount: 50000 }] });
    const child = role({ id: 2, parentRoleId: 1, approvalLimits: [{ id: 2, roleId: 2, category: "Journal", maxAmount: 500000 }] });
    expect(resolveApprovalLimit(child, [parent, child], "Journal")).toEqual({ maxAmount: 500000 });
  });
});

describe("evaluateApproval", () => {
  it("denies when the role lacks the approval permission, regardless of limit", () => {
    const result = evaluateApproval(false, { maxAmount: 1_000_000 }, 100);
    expect(result.allowed).toBe(false);
  });

  it("denies when no limit row exists anywhere in the chain", () => {
    const result = evaluateApproval(true, null, 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No approval limit");
  });

  it("allows unlimited (maxAmount null) regardless of amount", () => {
    const result = evaluateApproval(true, { maxAmount: null }, 10_000_000);
    expect(result.allowed).toBe(true);
  });

  it("allows an amount exactly at the limit", () => {
    const result = evaluateApproval(true, { maxAmount: 50000 }, 50000);
    expect(result.allowed).toBe(true);
  });

  it("denies an amount one cent over the limit", () => {
    const result = evaluateApproval(true, { maxAmount: 50000 }, 50000.01);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceeds");
  });

  it("matches the directive's own worked example: Bookkeeper <=R50,000, Finance Manager <=R500,000, Financial Director unlimited", () => {
    expect(evaluateApproval(true, { maxAmount: 50000 }, 40000).allowed).toBe(true);
    expect(evaluateApproval(true, { maxAmount: 50000 }, 60000).allowed).toBe(false);
    expect(evaluateApproval(true, { maxAmount: 500000 }, 60000).allowed).toBe(true);
    expect(evaluateApproval(true, { maxAmount: 500000 }, 600000).allowed).toBe(false);
    expect(evaluateApproval(true, { maxAmount: null }, 10_000_000).allowed).toBe(true);
  });
});
