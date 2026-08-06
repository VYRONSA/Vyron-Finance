import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray package-lock.json at C:\Users\humres\ (unrelated to this
  // project) made Turbopack guess the wrong workspace root. Pin it
  // explicitly to this project's own directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // `pdf-parse`'s "." export map lists a "browser" condition ahead of
  // "import"/"require" (its browser build alone pulls in 14 unguarded
  // top-level `DOMMatrix` references from pdfjs-dist's web build,
  // confirmed by grepping the built output — the "import"/"require"
  // conditions' own build has none). Next's Server Components bundler
  // resolved that "browser" condition for any page whose module graph
  // merely imports `pdf-text-extraction.ts` transitively (e.g. the
  // Company Dashboard, via `import-service.ts`'s `listRecentImports`),
  // crashing SSR with "DOMMatrix is not defined" even though nothing on
  // that page ever calls PDF parsing. `serverExternalPackages` opts
  // these two out of that bundling entirely, so they resolve via native
  // Node `require()` instead — which correctly picks the Node-safe
  // "import"/"require" conditions, not "browser". See
  // `pdf-text-extraction.ts`'s own docstring for the paired fix (lazy
  // imports, so these packages are never touched at all unless a real
  // PDF import request actually runs).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
