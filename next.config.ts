import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray package-lock.json at C:\Users\humres\ (unrelated to this
  // project) made Turbopack guess the wrong workspace root. Pin it
  // explicitly to this project's own directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Deliberately NOT using `serverExternalPackages` for `pdfjs-dist` —
  // see `pdf-text-extraction.ts`'s own docstring for the full
  // "DOMMatrix is not defined" story. It was tried first and made
  // things worse: Turbopack's own runtime loader for
  // `serverExternalPackages`-listed packages (its "externalImport"/
  // "externalRequire" mechanism) crashed with the exact same error on
  // Vercel specifically, for both `pdf-parse` (an ambiguous package.json
  // "exports" map) AND `pdfjs-dist`'s own deep `legacy/build/pdf.mjs`
  // path (which has no "exports" field at all, ruling out condition
  // ambiguity as the cause) — confirmed live against the actual
  // deployed API. Letting Turbopack bundle `pdfjs-dist` normally
  // instead (this module's own lazy `import()` calls mean it's still
  // only loaded on-demand, as a genuine code-split chunk, not eagerly
  // pulled into every page that imports this file transitively) is
  // what actually works.
};

export default nextConfig;
