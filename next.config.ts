import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray package-lock.json at C:\Users\humres\ (unrelated to this
  // project) made Turbopack guess the wrong workspace root. Pin it
  // explicitly to this project's own directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // `pdfjs-dist` — see `pdf-text-extraction.ts`'s own docstring for the
  // full "DOMMatrix is not defined" story: three distinct failure modes
  // this round, each confirmed live against the actual deployed API,
  // not guessed. `serverExternalPackages` alone (with a literal import
  // specifier) crashed Turbopack's own bundling of `pdfjs-dist`'s
  // content; a non-literal specifier avoided that crash but ALSO
  // defeated Vercel's own deployment file-tracing, which (confirmed
  // live) also relies on statically-analysable specifiers to know
  // `pdfjs-dist` needs to be included in the deployed function at all —
  // without it, the non-literal specifier resolves to a bare "Cannot
  // find package 'pdfjs-dist'" at runtime. `outputFileTracingIncludes`
  // is the two mechanisms' actual common ground: it force-includes the
  // package's files in the trace independently of whether any import of
  // it is literal, so the non-literal specifier can avoid the crash
  // without losing the files it needs at runtime.
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/*": ["node_modules/pdfjs-dist/**/*"],
  },
};

export default nextConfig;
