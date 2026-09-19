/**
 * Phase 5D — build regression guard for `/platform/operations`.
 *
 * `OperationsTabs` keeps its selected tab in the query string
 * (`useUrlParam` -> `useSearchParams`). This page renders STATICALLY when
 * Supabase is not configured — Preview Mode takes the mock-data branch and
 * awaits nothing — and a client component reading search params during a
 * static prerender bails out of prerendering, which fails `next build`
 * outright with "useSearchParams() should be wrapped in a suspense
 * boundary". That failure was live on db05b34 and blocked every
 * production build.
 *
 * A unit test cannot run the prerender, so this asserts the invariant that
 * prevents it: the page wraps `OperationsTabs` in a `<Suspense>` boundary.
 * If someone removes the boundary, this fails here in seconds instead of
 * at the end of a production build.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(join(process.cwd(), "src/app/platform/operations/page.tsx"), "utf8");

describe("/platform/operations — useSearchParams prerender guard", () => {
  it("imports Suspense from react", () => {
    expect(pageSource).toMatch(/import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*"react"/);
  });

  it("renders OperationsTabs inside a Suspense boundary", () => {
    // The opening <Suspense ...> must come before <OperationsTabs, and the
    // closing </Suspense> after it.
    const open = pageSource.search(/<Suspense[\s>]/);
    const tabs = pageSource.indexOf("<OperationsTabs");
    const close = pageSource.indexOf("</Suspense>");

    expect(open).toBeGreaterThan(-1);
    expect(tabs).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(tabs);
  });

  it("still renders OperationsTabs exactly once — the boundary did not change what the page shows", () => {
    expect(pageSource.split("<OperationsTabs").length - 1).toBe(1);
  });

  it("the tab component really does read search params, so the boundary is required (not cargo cult)", () => {
    const tabsSource = readFileSync(join(process.cwd(), "src/components/platform/operations/operations-tabs.tsx"), "utf8");
    const hookSource = readFileSync(join(process.cwd(), "src/hooks/use-url-param.ts"), "utf8");

    expect(tabsSource).toContain("useUrlParam");
    expect(hookSource).toContain("useSearchParams");
  });
});
