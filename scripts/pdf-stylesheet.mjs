// The stylesheet embedded in every server-generated PDF: the app's own
// globals.css (theme tokens, base rules) compiled by Tailwind for exactly the
// class names used by the components rendered into PDFs. Shared by
// build-pdf-assets.mjs (writes it) and the drift test (checks it is current).
import fs from "node:fs";
import path from "node:path";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

/** Every file whose markup can appear in a server-generated PDF. */
export const PDF_SOURCES = [
  { dir: "src/components/documents/print", pattern: "**/*.tsx" },
  { dir: "src/components/financial/reporting", pattern: "report-document.tsx" },
  { dir: "src/components/financial/reporting", pattern: "report-table.tsx" },
  { dir: "src/components/financial/reporting", pattern: "report-parts.tsx" },
  { dir: "src/components/ui", pattern: "badge.tsx" },
];

export async function buildPdfStylesheet(root) {
  const cssPath = path.join(root, "src/app/globals.css");
  const compiler = await compile(fs.readFileSync(cssPath, "utf8"), { base: path.dirname(cssPath), onDependency: () => {} });
  const scanner = new Scanner({
    sources: [
      ...PDF_SOURCES.map((s) => ({ base: path.join(root, s.dir), pattern: s.pattern, negated: false })),
      // Tests never render into a PDF; their class names must not change the stylesheet.
      { base: path.join(root, "src/components/documents/print"), pattern: "**/*.test.tsx", negated: true },
    ],
  });
  const candidates = [...new Set(scanner.scan())].sort();
  return optimize(compiler.build(candidates), { minify: true }).code;
}
