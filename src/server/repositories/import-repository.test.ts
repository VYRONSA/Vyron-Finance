/**
 * Phase 31C — the bank-import dedup mechanism
 * (`ingestBankTransactionIdempotent`) previously matched a re-imported
 * row against existing rows using the LIVE `description` column, which
 * Phase 31A/31B made accountant-editable — meaning an edited row's
 * natural key no longer matched what a fresh re-parse of the ORIGINAL
 * source file would produce, so re-importing the same statement could
 * silently insert a genuine duplicate transaction. Migration 0089 adds
 * `import_description`, a snapshot of `description` written ONLY at
 * insert time and never touched again — this is the first test file for
 * `import-repository.ts` (none existed before), specifically because the
 * actual safety mechanism IS the SQL WHERE/insert-conflict behavior, not
 * just a pure decision function — same reasoning as
 * `supplier-reconciliation-repository.test.ts`'s own fake-Supabase
 * precedent. This fake is purpose-built for exactly the two query shapes
 * `ingestBankTransactionIdempotent` uses (an INSERT that can collide, and
 * a fallback SELECT keyed on a fixed set of `.eq()` filters) rather than
 * a fully generic filter parser.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { fakeRef } = vi.hoisted(() => ({ fakeRef: { current: undefined as unknown } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeRef.current }));

import { ingestBankTransactionIdempotent, type NewBankTransaction } from "./import-repository";
import { assignSourceOccurrences } from "@/server/import-centre/import-source-occurrence";

type Row = Record<string, unknown>;

function makeFakeSupabase(seedRows: Row[]) {
  const rows: Row[] = seedRows.map((r) => ({ ...r }));
  let nextId = rows.reduce((max, r) => Math.max(max, r.id as number), 0) + 1;

  // Mirrors the real `ae_bank_transactions_natural_key` constraint
  // exactly as migration 0092 redefines it — company/bank_account/date/
  // reference/debit/credit/import_description, plus `source_occurrence`,
  // the ordinal that lets two genuinely identical source records coexist
  // while a re-submitted file still collides row for row.
  function naturalKey(row: Row): string {
    return JSON.stringify([
      row.company_id,
      row.bank_account,
      row.transaction_date,
      row.reference,
      row.debit,
      row.credit,
      row.import_description,
      row.source_occurrence ?? 1,
    ]);
  }

  return {
    from(table: string) {
      if (table !== "ae_bank_transactions") throw new Error(`FakeSupabase: unexpected table '${table}'`);
      return {
        insert(payload: Row) {
          return {
            select: () => ({
              single: async () => {
                const collision = rows.find((r) => naturalKey(r) === naturalKey(payload));
                if (collision) {
                  return {
                    data: null,
                    error: { code: "23505", message: 'duplicate key value violates unique constraint "ae_bank_transactions_natural_key"' },
                  };
                }
                const row: Row = { id: nextId++, rules_triggered: [], allocation_status: "Unallocated", created_at: "2026-08-01T00:00:00Z", ...payload };
                rows.push(row);
                return { data: row, error: null };
              },
            }),
          };
        },
        select() {
          const filters: [string, unknown][] = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            single: async () => {
              const match = rows.find((r) => filters.every(([col, val]) => r[col] === val));
              if (!match) return { data: null, error: { code: "PGRST116", message: "no rows found" } };
              return { data: match, error: null };
            },
          };
          return builder;
        },
      };
    },
    // test-only escape hatch to inspect the fake table's final state
    _rows: rows,
  };
}

function txn(overrides: Partial<NewBankTransaction> = {}): NewBankTransaction {
  return {
    transactionDate: "2026-08-01",
    reference: "",
    description: "FNB OB Pmt FNB OB 000024403 Ren Renumeration",
    beneficiary: "FNB OB Pmt FNB OB 000024403 Ren Renumeration",
    debit: 100000,
    credit: 0,
    balance: null,
    bankAccount: "62050837304",
    bankAccountId: 1,
    vat: null,
    glAccount: "",
    notes: "",
    importBatch: "BATCH-1",
    sourceFilename: "statement.pdf",
    ...overrides,
  };
}

const COMPANY_ID = "company-a";

describe("ingestBankTransactionIdempotent — immutable import identity (Phase 31C)", () => {
  let fake: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    fake = fakeRef.current = makeFakeSupabase([]) as never;
  });

  it("1. import creates a transaction", async () => {
    const result = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    expect(result.created).toBe(true);
    expect(result.transaction.description).toBe(txn().description);
  });

  it("2. re-importing the identical source row does not create a duplicate", async () => {
    await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    const second = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    expect(second.created).toBe(false);
    expect(fake._rows.length).toBe(1);
  });

  it("4/5. after the accountant edits the LIVE description, re-importing the ORIGINAL source still recognises the existing transaction — the exact bug this migration fixes", async () => {
    const original = txn();
    const created = await ingestBankTransactionIdempotent(COMPANY_ID, original);
    expect(created.created).toBe(true);

    // Simulate the accountant editing the live `description` column via
    // Transaction Explorer (Phase 31A/31B) — `import_description` is
    // NEVER touched by that write path, only `description` is.
    const editedRow = fake._rows.find((r) => r.id === created.transaction.id)!;
    editedRow.description = "Ren Remuneration";
    // import_description intentionally left untouched, exactly like the
    // real allocateRow/description-edit code path.

    const reImport = await ingestBankTransactionIdempotent(COMPANY_ID, original); // re-parsing the SAME original file reproduces the ORIGINAL description
    expect(reImport.created).toBe(false); // recognised as the existing transaction, not inserted again
    expect(fake._rows.length).toBe(1); // still exactly one row — no duplicate
  });

  it("3. editing Notes does not affect identity (Notes was never part of the natural key)", async () => {
    const created = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    const row = fake._rows.find((r) => r.id === created.transaction.id)!;
    row.notes = "Followed up with supplier";
    const reImport = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    expect(reImport.created).toBe(false);
    expect(fake._rows.length).toBe(1);
  });

  it("7/8/9/10. GL/Supplier/Customer/VAT changes do not affect identity — none of them were ever part of the natural key", async () => {
    const created = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    const row = fake._rows.find((r) => r.id === created.transaction.id)!;
    row.gl_account = "6100";
    row.matched_supplier_id = 42;
    row.matched_customer_id = 7;
    row.vat = 15000;
    const reImport = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    expect(reImport.created).toBe(false);
    expect(fake._rows.length).toBe(1);
  });

  it("11/12. AI classification and Banking Rule fields do not affect identity", async () => {
    const created = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    const row = fake._rows.find((r) => r.id === created.transaction.id)!;
    row.allocation_method = "Future AI";
    row.rule_id = 5;
    row.rules_triggered = ["Auto: Ren Remuneration → GL"];
    const reImport = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    expect(reImport.created).toBe(false);
    expect(fake._rows.length).toBe(1);
  });

  it("13. two genuinely different transactions (different description, same account/date/amount/blank reference) are NOT incorrectly treated as duplicates — the exact production scenario found in the collision analysis", async () => {
    // Mirrors the real production pair: same bank_account/date/debit/blank
    // reference, only the description differs.
    const first = await ingestBankTransactionIdempotent(
      COMPANY_ID,
      txn({ description: "FNB OB Pmt FNB OB 000024403 Ren Renumeration", beneficiary: "FNB OB Pmt FNB OB 000024403 Ren Renumeration" }),
    );
    const second = await ingestBankTransactionIdempotent(
      COMPANY_ID,
      txn({ description: "FNB OB Pmt FNB OB 000024404 Mam Mama Yama", beneficiary: "FNB OB Pmt FNB OB 000024404 Mam Mama Yama" }),
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(true); // both genuinely created — never collapsed into one
    expect(fake._rows.length).toBe(2);
  });

  it("14. duplicateCount-style reporting stays correct: 1 new + 1 duplicate import reports exactly that", async () => {
    const first = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    const second = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    expect([first.created, second.created]).toEqual([true, false]);
  });

  it("company isolation — an identical row for a DIFFERENT company is never treated as a duplicate", async () => {
    const first = await ingestBankTransactionIdempotent(COMPANY_ID, txn());
    const second = await ingestBankTransactionIdempotent("company-b", txn());
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(fake._rows.length).toBe(2);
  });

  it("sets import_description to the description at the time of THIS insert, never a stale or different value", async () => {
    await ingestBankTransactionIdempotent(COMPANY_ID, txn({ description: "Exact text" }));
    expect(fake._rows[0].import_description).toBe("Exact text");
  });

  it("a non-unique-violation error is never swallowed as a duplicate", async () => {
    fakeRef.current = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23503", message: "foreign key violation" } }) }) }),
      }),
    };
    await expect(ingestBankTransactionIdempotent(COMPANY_ID, txn())).rejects.toMatchObject({ code: "23503" });
  });
});

/**
 * Migration 0092 — VYRON migrates the client's records; it does not audit
 * or consolidate them. These are the two properties that have to hold at
 * once, and that the old value-tuple natural key could not hold
 * simultaneously: every genuine source record is imported, AND
 * re-submitting one source file imports nothing new.
 *
 * The scenario is the real one from the Metanoia Hospitality / New
 * Handcrafted Food Products Xero migration, where 621 source rows
 * produced 480 rows on file because look-alike records were rejected.
 */
describe("duplicate-preserving import identity (migration 0092)", () => {
  let fake: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    fake = fakeRef.current = makeFakeSupabase([]) as never;
  });

  /** What every ingestion path does: stamp each row with its ordinal
   * among identical rows in its own source, then ingest in file order. */
  async function ingestSourceFile(rows: NewBankTransaction[]) {
    const stamped = assignSourceOccurrences(rows);
    const results = [];
    for (const row of stamped) {
      results.push(await ingestBankTransactionIdempotent(COMPANY_ID, { ...row, sourceOccurrence: row.sourceOccurrence }));
    }
    return results;
  }

  it("1. imports BOTH of two Xero transactions that share date, amount and description", async () => {
    const identical = { transactionDate: "2026-03-15", reference: "", description: "Payable Payment — Three Streams Fish", debit: 112134.57, credit: 0 };
    const results = await ingestSourceFile([txn(identical), txn(identical)]);

    expect(results.map((r) => r.created)).toEqual([true, true]);
    expect(fake._rows).toHaveLength(2);
    // Both rows keep the client's figures exactly — nothing merged,
    // nothing netted off, nothing adjusted.
    expect(fake._rows.map((r) => r.debit)).toEqual([112134.57, 112134.57]);
    expect(fake._rows.map((r) => r.source_occurrence)).toEqual([1, 2]);
  });

  it("1b. imports all THREE of three identical source rows, not just the first", async () => {
    const identical = { transactionDate: "2026-03-15", reference: "", description: "Spend Money — Bank Charges", debit: 50, credit: 0 };
    const results = await ingestSourceFile([txn(identical), txn(identical), txn(identical)]);
    expect(results.map((r) => r.created)).toEqual([true, true, true]);
    expect(fake._rows).toHaveLength(3);
  });

  it("2. re-running the exact same source import creates no additional copies", async () => {
    const identical = { transactionDate: "2026-03-15", reference: "", description: "Payable Payment — Three Streams Fish", debit: 112134.57, credit: 0 };
    const sourceFile = [txn(identical), txn(identical), txn({ transactionDate: "2026-03-16", description: "Receivable Payment — Dulcenbosch", debit: 0, credit: 3202.6 })];

    const firstRun = await ingestSourceFile(sourceFile);
    expect(firstRun.map((r) => r.created)).toEqual([true, true, true]);
    expect(fake._rows).toHaveLength(3);

    const secondRun = await ingestSourceFile(sourceFile);
    expect(secondRun.map((r) => r.created)).toEqual([false, false, false]);
    expect(fake._rows).toHaveLength(3);
    // And the rows it reported back are the specific records already on
    // file, matched by ordinal — not the same row returned twice.
    expect(secondRun.map((r) => r.transaction.id)).toEqual(firstRun.map((r) => r.transaction.id));
  });

  it("2b. re-running an import that previously dropped duplicates recovers exactly the dropped rows", async () => {
    // Simulates the live Metanoia state: the first run happened under the
    // OLD constraint, so only the first of each identical pair is on
    // file, at occurrence 1 (which is what migration 0092's backfill sets
    // every pre-existing row to).
    const identical = { transactionDate: "2026-03-15", reference: "", description: "Payable Payment — Three Streams Fish", debit: 112134.57, credit: 0 };
    await ingestSourceFile([txn(identical)]);
    expect(fake._rows).toHaveLength(1);

    // Re-running the full source file with the fix in place: the row
    // already on file collides, the one that was dropped is inserted.
    const rerun = await ingestSourceFile([txn(identical), txn(identical)]);
    expect(rerun.map((r) => r.created)).toEqual([false, true]);
    expect(fake._rows).toHaveLength(2);
  });

  it("9. company isolation — identical source files for two companies never collide with each other", async () => {
    const identical = { transactionDate: "2026-03-15", reference: "", description: "Payable Payment — Three Streams Fish", debit: 112134.57, credit: 0 };
    await ingestSourceFile([txn(identical), txn(identical)]);

    const stamped = assignSourceOccurrences([txn(identical), txn(identical)]);
    for (const row of stamped) {
      const result = await ingestBankTransactionIdempotent("company-b", { ...row, sourceOccurrence: row.sourceOccurrence });
      expect(result.created).toBe(true);
    }
    expect(fake._rows).toHaveLength(4);
    expect(fake._rows.filter((r) => r.company_id === COMPANY_ID)).toHaveLength(2);
    expect(fake._rows.filter((r) => r.company_id === "company-b")).toHaveLength(2);
  });
});
