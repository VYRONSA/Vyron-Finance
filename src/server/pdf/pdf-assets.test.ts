// @vitest-environment node
/**
 * The stylesheet and fonts embedded in server-generated PDFs
 * (`pdf-assets.generated.ts`). The PDF page may load nothing from the
 * network, so both must be complete and inline — and the stylesheet must be
 * regenerated (`npm run pdf:assets -- --css-only`) whenever a component
 * rendered into PDFs changes its classes.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDF_FONT_FACES, PDF_STYLESHEET } from "./pdf-assets.generated";

describe("embedded PDF assets", () => {
  it("the stylesheet is current with the components rendered into PDFs", async () => {
    const script = pathToFileURL(path.resolve(process.cwd(), "scripts/pdf-stylesheet.mjs")).href;
    const { buildPdfStylesheet } = (await import(/* @vite-ignore */ script)) as { buildPdfStylesheet: (root: string) => Promise<string> };
    expect(await buildPdfStylesheet(process.cwd())).toBe(PDF_STYLESHEET);
  }, 60_000);

  it("the stylesheet carries the document classes, print rules and theme tokens", () => {
    for (const needle of [".text-vf-ink", ".font-mono", ".tabular-nums", ".border-vf-paper-border", "@media print", "--color-ink"]) {
      expect(PDF_STYLESHEET).toContain(needle);
    }
  });

  it("the three VYRON font families are embedded as data: URIs", () => {
    for (const family of ["Inter", "IBM Plex Mono", "Source Serif 4"]) {
      expect(PDF_FONT_FACES).toContain(`font-family: '${family}'`);
    }
    expect(PDF_FONT_FACES).toContain("data:font/woff2;base64,");
  });

  it("nothing in either asset points at the network", () => {
    expect(PDF_STYLESHEET).not.toMatch(/url\(\s*["']?https?:/i);
    expect(PDF_FONT_FACES).not.toMatch(/url\(\s*["']?https?:/i);
    expect(PDF_STYLESHEET).not.toMatch(/@import/);
  });
});
