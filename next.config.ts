import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray package-lock.json at C:\Users\humres\ (unrelated to this
  // project) made Turbopack guess the wrong workspace root. Pin it
  // explicitly to this project's own directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Keeps `pdfjs-dist` out of Next's Server Components bundling
  // entirely, so it resolves via native Node module loading instead of
  // being pulled into the build output of any page that merely imports
  // `pdf-text-extraction.ts` transitively (e.g. the Company Dashboard,
  // via `import-service.ts`'s `listRecentImports`) — see that file's
  // own docstring for the full "DOMMatrix is not defined" story and why
  // `pdf-parse` itself was dropped entirely (its own package resolution
  // proved unreliable specifically on Vercel; `pdfjs-dist`'s deep,
  // unambiguous import paths have been reliable throughout).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
