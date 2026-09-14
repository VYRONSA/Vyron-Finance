// @vitest-environment node
/**
 * Guard for React error #418 (hydration mismatch). Formatting with the
 * RUNTIME's locale or time zone — `toLocaleString()`, `toLocaleDateString()`,
 * `toLocaleTimeString()`, or `Intl.*Format` without an explicit locale —
 * renders differently on the Vercel server (en-US, UTC) and in a South
 * African browser (en-ZA, SAST), so the server HTML never matches the
 * browser's first render. UI code formats through `src/lib/format.ts`
 * instead; this test fails if a runtime-locale call is reintroduced.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src/components", "src/app", "src/lib"];
const ALLOWED = new Set(["src/lib/format.ts"]);
const RUNTIME_LOCALE = /\.toLocale(?:String|DateString|TimeString)\(|new Intl\.(?:NumberFormat|DateTimeFormat)\(\s*(?:\)|undefined|\[\])/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("no runtime-locale formatting in UI code", () => {
  it("every component, page and shared helper formats deterministically", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.resolve(process.cwd(), root))) {
        const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
        if (ALLOWED.has(rel)) continue;
        fs.readFileSync(file, "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (RUNTIME_LOCALE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
