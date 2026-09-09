/**
 * Phase 26F — direct unit coverage for the two-secret-name widening
 * (`CRON_SECRET` for Vercel's own native Cron Jobs, `AUTOMATION_CRON_SECRET`
 * for any other external scheduler). Both route test files that use this
 * mock it entirely, so this is the only place the actual branching logic
 * is exercised.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { requireCronSecret } from "./require-cron-secret";

function request(authorization?: string): Request {
  return new Request("https://vyron.example/api/automation/run-due-tasks", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.AUTOMATION_CRON_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("requireCronSecret", () => {
  it("returns 501 (never a fabricated pass) when neither secret is configured", () => {
    const result = requireCronSecret(request("Bearer anything"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.response.status).toBe(501);
  });

  it("accepts CRON_SECRET — Vercel's own native Cron Jobs env var name", () => {
    process.env.CRON_SECRET = "vercel-native-secret";
    const result = requireCronSecret(request("Bearer vercel-native-secret"));
    expect(result.ok).toBe(true);
  });

  it("accepts AUTOMATION_CRON_SECRET — the original, still-supported name for any other external scheduler", () => {
    process.env.AUTOMATION_CRON_SECRET = "pg-cron-secret";
    const result = requireCronSecret(request("Bearer pg-cron-secret"));
    expect(result.ok).toBe(true);
  });

  it("when both are set, CRON_SECRET takes precedence", () => {
    process.env.CRON_SECRET = "vercel-secret";
    process.env.AUTOMATION_CRON_SECRET = "other-secret";

    expect(requireCronSecret(request("Bearer vercel-secret")).ok).toBe(true);
    expect(requireCronSecret(request("Bearer other-secret")).ok).toBe(false);
  });

  it("rejects a wrong or missing Authorization header with 401", () => {
    process.env.CRON_SECRET = "the-real-secret";

    const wrong = requireCronSecret(request("Bearer wrong-value"));
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.response.status).toBe(401);

    const missing = requireCronSecret(request());
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.response.status).toBe(401);
  });
});
