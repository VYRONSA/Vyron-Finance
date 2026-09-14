import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

// jsdom doesn't implement Element.scrollTo — needed by any test that
// renders FinancialWorkspaceShell (workspace-shell.tsx resets <main>'s
// own scroll position on every route change).
// Guarded: node-environment test files (PDF rendering, source guards) have no DOM.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

afterEach(() => {
  cleanup();
});
