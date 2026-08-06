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
  // `@napi-rs/canvas` — the real, missing piece behind ALL of the above
  // "DOMMatrix is not defined" crashes, found only once file-tracing and
  // bundling were no longer the problem: `pdfjs-dist/legacy/build/pdf.mjs`
  // unconditionally constructs `new DOMMatrix()` at true module top level
  // (confirmed by reading the exact source line pdfjs-dist itself throws
  // from) — true in EVERY pdfjs-dist build (legacy and modern both
  // checked), regardless of whether any rendering API is ever called, so
  // this can't be avoided by using a different build or a narrower
  // import. Node.js has no native `DOMMatrix`; `pdfjs-dist` already ships
  // its own official mechanism for exactly this (not a polyfill this
  // codebase wrote): `@napi-rs/canvas`, one of `pdfjs-dist`'s own
  // `optionalDependencies`, providing a real, N-API-native `DOMMatrix`
  // implementation it auto-detects via `globalThis.DOMMatrix ??
  // canvas?.DOMMatrix`. Present locally (installed automatically
  // alongside `pdfjs-dist`) but not reliably reaching the deployed
  // Vercel function without the same file-tracing help native-binary
  // packages generally need (this package ships one platform-specific
  // binary sub-package per OS/arch, resolved by npm's own
  // `optionalDependencies` platform matching at install time — Vercel's
  // own build installs the correct Linux one; only the deployment trace
  // needed help finding it, the same category of gap Next's own docs
  // show for `sharp`/`aws-crt`).
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/*": ["node_modules/pdfjs-dist/**/*", "node_modules/@napi-rs/**/*"],
  },
};

export default nextConfig;
