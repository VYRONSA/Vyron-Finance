/**
 * Phase 43 — production defect: no `error.tsx`/`global-error.tsx` existed
 * anywhere in the app, and `company/[companyId]/layout.tsx` renders the
 * sidebar shell directly around `{children}` with nothing between them —
 * an uncaught render error anywhere in a page's content had nothing
 * stopping it from taking the whole shell down with it (recoverable only
 * by a full logout/login, i.e. a fresh mount). This boundary is what
 * fixes that by construction: Next.js wraps THIS segment's `page.tsx`
 * (and everything nested under it) in it, but never `layout.tsx` at the
 * same level, so the sidebar always stays outside it, still mounted,
 * still interactive, regardless of what breaks in the content area.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CompanySectionError from "./error";

describe("CompanySectionError boundary (Phase 43)", () => {
  it("renders a clear message that names the rest of the app as still working", () => {
    render(<CompanySectionError error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/rest of the application is still working/i)).toBeInTheDocument();
  });

  it("Try Again calls the Next.js-provided reset(), not a page reload", () => {
    const reset = vi.fn();
    render(<CompanySectionError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("never throws while rendering an error with no digest (the common client-side case)", () => {
    expect(() => render(<CompanySectionError error={new Error("boom")} reset={vi.fn()} />)).not.toThrow();
  });
});
