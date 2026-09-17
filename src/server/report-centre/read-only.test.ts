/**
 * ACCOUNTING SAFETY — reporting is READ ONLY.
 *
 * Reports must never modify transactions, imported Xero data or VAT;
 * never allocate or post; never create journals, GL transactions or
 * posting batches. This test enforces it structurally: it reads every
 * source file of the Reporting Centre (the engine, its builders, its
 * data sources, its repository, its API routes and pages) and fails if
 * any of them contains a database write or imports a function that
 * writes.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function filesUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(child);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path.join(ROOT, child)] : [];
  });
}

const REPORTING_SOURCES = [
  "src/server/report-centre",
  "src/server/repositories/report-centre-repository.ts",
  "src/app/api/companies/[companyId]/reporting",
  "src/app/company/[companyId]/reporting",
  "src/components/financial/reporting",
].flatMap(filesUnder);

/** Supabase/PostgREST write verbs and mutating RPCs. A query-builder
 * write is chained off a call or starts a line (`.from("t").delete()`,
 * `\n    .update({...})`) — unlike an in-memory `cache.delete(key)`,
 * which is preceded by an identifier and is not a database write. */
const WRITE_PATTERNS: [RegExp, string][] = [
  [/(^|[\s)])\.insert\s*\(/m, ".insert("],
  [/(^|[\s)])\.update\s*\(/m, ".update("],
  [/(^|[\s)])\.upsert\s*\(/m, ".upsert("],
  [/(^|[\s)])\.delete\s*\(/m, ".delete("],
  [/\.rpc\s*\(\s*["'`]fn_(?!trial_balance|account_balance_before)/, "a mutating rpc("],
];

/** Functions elsewhere in VYRON that write. Importing any of them into
 * the Reporting Centre would give a report the ability to change books. */
const FORBIDDEN_IMPORTS = [
  "postBankTransactions",
  "postJournal",
  "createJournal",
  "approveJournal",
  "allocateRow",
  "allocateReceipt",
  "allocatePayment",
  "applyRuleActions",
  "applyAiClassification",
  "markTransactionPosted",
  "postRuleEngineJournalAtomic",
  "recoverRuleEngineJournalLink",
  "bulkAssign",
  "bulkRecode",
  "generateJournalFromTransactions",
  "generateVatReturn",
  "approveVatReturn",
  "createVatAdjustment",
  "runPosting",
  "insertImportBatch",
  "ingestBankTransactionIdempotent",
  "ingestBillIdempotent",
];

describe("Reporting Centre is read-only", () => {
  it("finds the Reporting Centre source files it is guarding", () => {
    expect(REPORTING_SOURCES.length).toBeGreaterThan(10);
  });

  it.each(REPORTING_SOURCES.map((f) => [path.relative(ROOT, f)]))("%s contains no database write", (relative) => {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const [pattern, label] of WRITE_PATTERNS) {
      expect(pattern.test(text), `${relative} contains ${label}`).toBe(false);
    }
  });

  it.each(REPORTING_SOURCES.map((f) => [path.relative(ROOT, f)]))("%s imports no mutating function", (relative) => {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    const imports = [...text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]));
    for (const name of imports) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(name.startsWith(forbidden), `${relative} imports ${name}`).toBe(false);
      }
    }
  });

  it("the guard itself catches a chained query-builder write, and not an in-memory map", () => {
    const sample = 'await supabase.from("gl_transactions")\n    .delete()\n    .eq("id", 1);';
    expect(WRITE_PATTERNS.some(([p]) => p.test(sample))).toBe(true);
    expect(WRITE_PATTERNS.some(([p]) => p.test('supabase.from("x").update({ a: 1 })'))).toBe(true);
    expect(WRITE_PATTERNS.some(([p]) => p.test("cache.delete(key); map.set(k, v);"))).toBe(false);
  });

  it("the only RPCs the Reporting Centre repository may call are read-only balance functions", () => {
    const repo = fs.readFileSync(path.join(ROOT, "src/server/repositories/report-centre-repository.ts"), "utf8");
    expect(repo).not.toMatch(/\.rpc\s*\(/);
  });
});
