import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// The .ts tests that render React hooks and therefore need a DOM.
const DOM_TS_TESTS = [
  "src/components/documents/use-customer-address.test.ts",
  "src/hooks/use-unsaved-changes-warning.test.ts",
  "src/hooks/use-url-param.test.ts",
];

// Two projects, same tests, same assertions:
//   dom   — component tests (*.test.tsx, plus the hook tests above) in
//           jsdom, with the Testing Library / jest-dom / jest-axe setup.
//   logic — the plain TypeScript tests (~300 files) in Node, which is
//           where they already run in production. Previously each of them
//           also got its own jsdom and the full component-test setup, so a
//           full run built ~11 jsdom workers at once and drove free memory
//           to ~40MB on a 16GB machine; Windows then paged, and the
//           heaviest component renders (e.g. TransactionGrid's
//           mount/unmount cycles) stalled past their 5s timeout.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        // Runs after the logic tests (groupOrder), on its own. Each jsdom
        // worker is a heavy, CPU-bound render environment; four at a time
        // keeps them on real cores and inside memory.
        test: { name: "dom", environment: "jsdom", pool: "threads", maxWorkers: 4, sequence: { groupOrder: 1 }, setupFiles: ["./vitest.setup.ts"], include: ["src/**/*.test.tsx", ...DOM_TS_TESTS] },
      },
      { extends: true, test: { name: "logic", environment: "node", sequence: { groupOrder: 0 }, include: ["src/**/*.test.ts"], exclude: DOM_TS_TESTS } },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
