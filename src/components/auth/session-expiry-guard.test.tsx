import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SessionExpiryGuard } from "./session-expiry-guard";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
}));

describe("SessionExpiryGuard", () => {
  const originalFetch = window.fetch;

  beforeEach(() => {
    push.mockClear();
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it("redirects to /login on a 401 from an /api/ call", async () => {
    window.fetch = vi.fn().mockResolvedValue({ status: 401 });
    render(<SessionExpiryGuard />);

    await window.fetch("/api/companies/co_1/general-ledger/journals");

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatch(/^\/login\?error=/);
    expect(decodeURIComponent(push.mock.calls[0][0])).toContain("session has expired");
  });

  it("does not redirect on a successful response", async () => {
    window.fetch = vi.fn().mockResolvedValue({ status: 200 });
    render(<SessionExpiryGuard />);

    await window.fetch("/api/companies/co_1/general-ledger/journals");

    expect(push).not.toHaveBeenCalled();
  });

  it("does not redirect on a 401 from a non-/api/ request (e.g. Supabase Auth)", async () => {
    window.fetch = vi.fn().mockResolvedValue({ status: 401 });
    render(<SessionExpiryGuard />);

    await window.fetch("https://project.supabase.co/auth/v1/token");

    expect(push).not.toHaveBeenCalled();
  });

  it("restores the original fetch on unmount", () => {
    const stub = vi.fn().mockResolvedValue({ status: 200 });
    window.fetch = stub;
    const { unmount } = render(<SessionExpiryGuard />);

    expect(window.fetch).not.toBe(stub);
    unmount();
    expect(window.fetch).toBe(stub);
  });
});
