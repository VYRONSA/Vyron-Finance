/**
 * Phase 5G — the Back control.
 *
 * The rule under test is that Back is a real link FIRST and a history
 * step only when history is provably the better answer. A bare
 * `router.back()` is wrong on a pasted URL, in a new tab, on the first
 * page of a session, or when the previous page belonged to a different
 * company — and those are exactly the cases pinned below.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackLink, shouldUseHistoryBack } from "./back-link";

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push: vi.fn(), replace: vi.fn() }) }));

/** jsdom's `document.referrer` is read-only; redefine it per test. */
function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

beforeEach(() => {
  back.mockReset();
  setReferrer("");
});

describe("shouldUseHistoryBack", () => {
  const origin = "https://app.vyron.test";
  const scope = "/company/co_1";

  it("no history (empty referrer) — use the explicit destination", () => {
    expect(shouldUseHistoryBack("", origin, scope)).toBe(false);
  });

  it("previous page was inside this company — a history step is right", () => {
    expect(shouldUseHistoryBack(`${origin}/company/co_1/suppliers`, origin, scope)).toBe(true);
  });

  it("the scope root itself counts", () => {
    expect(shouldUseHistoryBack(`${origin}/company/co_1`, origin, scope)).toBe(true);
  });

  it("previous page belonged to ANOTHER company — never step across the tenant boundary", () => {
    expect(shouldUseHistoryBack(`${origin}/company/co_2/suppliers`, origin, scope)).toBe(false);
  });

  it("a company whose id merely starts the same is not the same company", () => {
    expect(shouldUseHistoryBack(`${origin}/company/co_10/suppliers`, origin, scope)).toBe(false);
  });

  it("an external site is never an in-app back", () => {
    expect(shouldUseHistoryBack("https://mail.example.com/thread", origin, scope)).toBe(false);
  });

  it("a malformed referrer is treated as no history, not a crash", () => {
    expect(shouldUseHistoryBack("not a url", origin, scope)).toBe(false);
  });

  it("platform scope works the same way", () => {
    expect(shouldUseHistoryBack(`${origin}/platform/billing`, origin, "/platform")).toBe(true);
    expect(shouldUseHistoryBack(`${origin}/company/co_1/dashboard`, origin, "/platform")).toBe(false);
  });
});

describe("BackLink", () => {
  it("renders a real link to the fallback, with an accessible label", () => {
    render(<BackLink href="/company/co_1/suppliers" label="Back to Suppliers" />);
    const link = screen.getByRole("link", { name: /Back to Suppliers/ });
    expect(link).toHaveAttribute("href", "/company/co_1/suppliers");
  });

  it("direct URL (no history): the link navigates, no history step is taken", () => {
    render(<BackLink href="/company/co_1/suppliers" label="Back to Suppliers" />);
    fireEvent.click(screen.getByRole("link", { name: /Back to Suppliers/ }));
    expect(back).not.toHaveBeenCalled();
  });

  it("previous page in the same company: the click becomes a history step", () => {
    setReferrer(`${window.location.origin}/company/co_1/suppliers`);
    render(<BackLink href="/company/co_1/suppliers" label="Back to Suppliers" />);
    fireEvent.click(screen.getByRole("link", { name: /Back to Suppliers/ }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("previous page in a DIFFERENT company: falls back to the link, preserving tenant context", () => {
    setReferrer(`${window.location.origin}/company/co_2/suppliers`);
    render(<BackLink href="/company/co_1/suppliers" label="Back to Suppliers" />);
    fireEvent.click(screen.getByRole("link", { name: /Back to Suppliers/ }));
    expect(back).not.toHaveBeenCalled();
  });

  it("the company scope is derived from the destination, so each page guards its own tenant", () => {
    setReferrer(`${window.location.origin}/company/co_9/anything`);
    render(<BackLink href="/company/co_9/customers" label="Back to Customers" />);
    fireEvent.click(screen.getByRole("link", { name: /Back to Customers/ }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("modifier-clicks are left to the browser (open in a new tab still works)", () => {
    setReferrer(`${window.location.origin}/company/co_1/suppliers`);
    render(<BackLink href="/company/co_1/suppliers" label="Back to Suppliers" />);
    fireEvent.click(screen.getByRole("link", { name: /Back to Suppliers/ }), { metaKey: true });
    expect(back).not.toHaveBeenCalled();
  });

  it("is keyboard reachable: it is a link with an href, not a click-only div", () => {
    render(<BackLink href="/company/co_1/suppliers" label="Back to Suppliers" />);
    const link = screen.getByRole("link", { name: /Back to Suppliers/ });
    // An anchor with an href is in the tab order by default; assert the
    // element really is one rather than a role-painted element.
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  it("defaults its label to 'Back'", () => {
    render(<BackLink href="/company/co_1/suppliers" />);
    expect(screen.getByRole("link", { name: /Back/ })).toBeInTheDocument();
  });
});
