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
  // full "DOMMatrix is not defined" story (three distinct failure modes
  // this round, each confirmed live against the actual deployed API,
  // not guessed). This option is required TOGETHER WITH that file's
  // non-literal import specifiers, not as an alternative to them:
  // `serverExternalPackages` is what makes Vercel's own deployment
  // tracing actually include `pdfjs-dist`'s files in the deployed
  // function at all (confirmed: without it, a non-literal specifier
  // resolves to a bare "Cannot find package 'pdfjs-dist'" at runtime,
  // since Vercel's file-tracing can no longer statically discover the
  // dependency once the specifier isn't a literal string) — while the
  // non-literal specifiers are what avoid Turbopack's own bundling
  // transformation of `pdfjs-dist`'s content crashing at module-
  // evaluation time (a real bug in that transformation, not in this
  // package or this codebase — the exact same file imports cleanly in
  // plain Node.js every time).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
