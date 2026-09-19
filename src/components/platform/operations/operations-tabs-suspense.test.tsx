/**
 * Phase 5F — the other half of the `/platform/operations` build fix.
 *
 * `suspense-boundary.test.ts` proves the page still WRAPS `OperationsTabs`
 * in a `<Suspense>`. This proves the wrapping did not change what the
 * component DOES: the tab is still selected from the `?tab=` query string
 * and still switches on click, rendered inside a real Suspense boundary
 * exactly as the page renders it.
 */
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OperationsTabs } from "./operations-tabs";
import { MOCK_OPERATIONS_SNAPSHOT } from "@/lib/mock/operations-data";

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace }),
  usePathname: () => "/platform/operations",
  useSearchParams: () => searchParams,
}));

/** Rendered the way `page.tsx` renders it — inside the boundary. */
function renderInSuspense(query = "") {
  searchParams = new URLSearchParams(query);
  replace.mockClear();
  return render(
    <Suspense>
      <OperationsTabs snapshots={[MOCK_OPERATIONS_SNAPSHOT]} previewMode />
    </Suspense>,
  );
}

describe("OperationsTabs inside a Suspense boundary", () => {
  it("renders at all through the boundary, defaulting to Platform Health", () => {
    renderInSuspense();
    expect(screen.getByRole("button", { name: "Platform Health" })).toBeInTheDocument();
  });

  it("honours ?tab= from the query string — the deep link still works", () => {
    renderInSuspense("tab=security");
    // The Security tab's own content is on screen, not Platform Health's.
    expect(screen.getByRole("button", { name: "Security" })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Security/);
  });

  it("falls back to the default tab for an unknown slug rather than rendering nothing", () => {
    renderInSuspense("tab=not-a-real-tab");
    expect(screen.getByRole("button", { name: "Platform Health" })).toBeInTheDocument();
  });

  it("clicking a tab still writes the slug back to the URL through the boundary", () => {
    renderInSuspense();
    fireEvent.click(screen.getByRole("button", { name: "Audit" }));
    expect(replace).toHaveBeenCalledWith("/platform/operations?tab=audit", { scroll: false });
  });

  it("selecting the default tab clears the param instead of pinning it", () => {
    renderInSuspense("tab=audit");
    fireEvent.click(screen.getByRole("button", { name: "Platform Health" }));
    expect(replace).toHaveBeenCalledWith("/platform/operations", { scroll: false });
  });
});
