import { describe, expect, it } from "vitest";
import { evaluateUsageLimit } from "./licensing-engine";

describe("evaluateUsageLimit", () => {
  it("allows any quantity when the limit is null (unlimited)", () => {
    const result = evaluateUsageLimit(null, 1_000_000, 500);
    expect(result).toEqual({ allowed: true, limit: null, used: 1_000_000 });
  });

  it("allows a request that stays under the limit", () => {
    const result = evaluateUsageLimit(10, 5, 1);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.used).toBe(5);
  });

  it("allows a request that lands exactly on the limit", () => {
    const result = evaluateUsageLimit(10, 9, 1);
    expect(result.allowed).toBe(true);
  });

  it("denies a request that would exceed the limit, with a reason", () => {
    const result = evaluateUsageLimit(10, 10, 1);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(10);
    expect(result.used).toBe(10);
    expect(result.reason).toContain("11");
    expect(result.reason).toContain("10");
  });

  it("denies when the limit is 0 (deny-by-default for a company with no governing subscription)", () => {
    const result = evaluateUsageLimit(0, 0, 1);
    expect(result.allowed).toBe(false);
  });
});
