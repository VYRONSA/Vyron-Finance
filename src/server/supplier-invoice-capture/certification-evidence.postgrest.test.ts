/**
 * Phase 5Q.7 — the evidence writer, end to end through real PostgREST.
 *
 * @vitest-environment node
 *
 * THE GAP THIS CLOSES. Everything else about the evidence layer is proved
 * against fakes (TypeScript) or against the SQL functions directly (psql).
 * Neither exercises the path the certification run actually uses:
 * supabase-js → PostgREST → `fn_ai_certification_record_evidence`. That
 * path has more moving parts than a `select` — argument naming, jsonb
 * marshalling, the security-definer boundary — and the first time it would
 * otherwise have run was mid-way through a 24-call certification, with the
 * ceiling already being spent.
 *
 * WHAT IT USES. The LOCAL sandbox only, through the same
 * `createCertificationDb` the run uses, with the same certification
 * variables. No AI provider is contacted: the payload below is a synthetic
 * literal, not an extraction.
 *
 * WHICH COMPANY, AND WHY NOT THE CERTIFICATION ONE. This runs against
 * "Legacy Company", deliberately NOT the Phase 5J Sandbox. Evidence is
 * sealed once its run closes, so proving that property necessarily leaves
 * a row behind — and the certification company must stay at zero evidence
 * for its own pre-run gate. The artefact is documented in the phase report.
 *
 * SKIPS when the certification variables are absent, so CI without a local
 * Supabase stays green.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import { createCertificationDb, openCertificationRun, closeCertificationRun, type CertificationDb } from "./certification-budget";
import { readCertificationEvidence, recordCertificationEvidence } from "./certification-evidence";

/** The certification variables live in `.env.local`, which Vitest does not
 * load. Read the same whitelist the CLI reads — names only into env. */
function loadCertificationEnv(): boolean {
  if (process.env.VYRON_CERTIFICATION_SUPABASE_URL && process.env.VYRON_CERTIFICATION_SERVICE_ROLE_KEY) return true;
  if (!existsSync(".env.local")) return false;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (name !== "VYRON_CERTIFICATION_SUPABASE_URL" && name !== "VYRON_CERTIFICATION_SERVICE_ROLE_KEY") continue;
    process.env[name] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return Boolean(process.env.VYRON_CERTIFICATION_SUPABASE_URL && process.env.VYRON_CERTIFICATION_SERVICE_ROLE_KEY);
}

const configured = loadCertificationEnv();
const LOCAL_ONLY = "http://127.0.0.1:56321";
/** Legacy Company — NOT the certification sandbox. See the header. */
const COMPANY = "5a0c0000-0000-4000-8000-00000000beef";

/** A synthetic ExtractionResult. Invented here; no model produced it. */
const PAYLOAD = {
  header: {
    documentType: "Invoice", supplierName: "Karoo Wholesale Supplies", supplierVatNumber: "4111222333",
    supplierRegistrationNumber: "2015/445566/07", invoiceNumber: "PG-RT-0001", invoiceDate: "2026-06-11",
    dueDate: "2026-07-11", orderReference: null, currencyCode: "ZAR",
    subtotal: 1000, discountTotal: null, vatAmount: 150, total: 1150, confidence: null,
  },
  lines: [
    { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", packDescription: null,
      packQuantity: null, unitPrice: 100, discount: null, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, confidence: null },
  ],
  invoiceNumbersSeen: ["PG-RT-0001"], missingFields: [], warnings: [], declaredLineCount: 1,
};

const sha = (c: string) => c.repeat(64).slice(0, 64);

describe.skipIf(!configured)("evidence writer through real PostgREST (local sandbox only)", () => {
  let db: CertificationDb;
  let runId: number;
  let evidenceId: number;

  beforeAll(async () => {
    // Refuse to run against anything but the known local endpoint. A test
    // that could point at production is not a safe test.
    expect(process.env.VYRON_CERTIFICATION_SUPABASE_URL?.replace(/\/+$/, "")).toBe(LOCAL_ONLY);
    expect(process.env.VYRON_CERTIFICATION_SUPABASE_URL).not.toContain("gnvhzckxryuttsqnvriv");

    const built = createCertificationDb(process.env);
    expect(built).not.toBeNull();
    db = built!;

    runId = await openCertificationRun(COMPANY, "5Q.7 postgrest evidence path", 2, "postgrest-test", db);
    expect(runId).toBeGreaterThan(0);
  });

  it("writes one evidence record through the real RPC", async () => {
    const result = await recordCertificationEvidence(db, {
      runId, companyId: COMPANY, caseId: "postgrest-roundtrip",
      corpusSha256: sha("a"), documentFile: "postgrest-roundtrip.pdf", documentSha256: sha("b"),
      outcome: "extracted", model: "synthetic/no-provider-was-called",
      callsUsed: 1, callCeiling: 2, durationMs: 1234,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      errorCategory: null, httpStatus: null, providerMessage: null,
      extracted: PAYLOAD, validationStatus: "Pass", validationFindings: [],
      lineCount: 1, declaredLineCount: 1,
    });

    expect(result.recorded).toBe(true);
    if (!result.recorded) return;
    expect(result.evidenceId).toBeGreaterThan(0);
    evidenceId = result.evidenceId;
  });

  it("the COMPLETE payload survives the round trip", async () => {
    // jsonb marshalling through PostgREST is exactly the thing fakes
    // cannot prove. Read it back THROUGH THE INTENDED PATH — a direct
    // table select returns nothing, because the table is locked down.
    const rows = await readCertificationEvidence(db, runId);
    expect(rows).toHaveLength(1);

    const row = rows[0] as unknown as { extracted: typeof PAYLOAD; validation_status: string; usage: { totalTokens: number }; calls_used_at_reservation: number; model: string };
    expect(row.extracted.header.invoiceNumber).toBe("PG-RT-0001");
    expect(row.extracted.header.total).toBe(1150);
    expect(row.extracted.lines).toHaveLength(1);
    expect(row.extracted.lines[0].unitPrice).toBe(100);
    expect(row.extracted.declaredLineCount).toBe(1);
    expect(row.validation_status).toBe("Pass");
    expect(row.usage.totalTokens).toBe(15);
    expect(row.calls_used_at_reservation).toBe(1);
    expect(row.model).toBe("synthetic/no-provider-was-called");
  });

  it("refuses a duplicate case for the same run", async () => {
    const again = await recordCertificationEvidence(db, {
      runId, companyId: COMPANY, caseId: "postgrest-roundtrip",
      corpusSha256: sha("a"), documentFile: "postgrest-roundtrip.pdf", documentSha256: sha("b"),
      outcome: "extracted", model: null, callsUsed: 2, callCeiling: 2, durationMs: 1,
      usage: null, errorCategory: null, httpStatus: null, providerMessage: null,
      extracted: PAYLOAD, validationStatus: "Pass", validationFindings: [], lineCount: 1, declaredLineCount: 1,
    });
    expect(again.recorded).toBe(false);
  });

  it("refuses a company that does not own the run", async () => {
    const wrongCompany = await recordCertificationEvidence(db, {
      runId, companyId: "5a0c0000-0000-4000-8000-00000000513a", caseId: "wrong-company",
      corpusSha256: sha("a"), documentFile: "x.pdf", documentSha256: sha("b"),
      outcome: "extracted", model: null, callsUsed: null, callCeiling: null, durationMs: null,
      usage: null, errorCategory: null, httpStatus: null, providerMessage: null,
      extracted: null, validationStatus: null, validationFindings: [], lineCount: null, declaredLineCount: null,
    });
    expect(wrongCompany.recorded).toBe(false);
  });

  it("is NOT readable as an ordinary table — only through the reader function", async () => {
    // The isolation property: application code holding this client still
    // cannot see certification evidence.
    const { data } = await db.from("ai_certification_evidence").select("id").eq("id", String(evidenceId)).maybeSingle();
    expect(data).toBeNull();
  });

  it("cannot be UPDATED through PostgREST", async () => {
    const { error } = await (db.from("ai_certification_evidence") as unknown as {
      update(v: Record<string, unknown>): { eq(c: string, v: string): Promise<{ error: unknown }> };
    }).update({ validation_status: "Incomplete" }).eq("id", String(evidenceId));
    expect(error).not.toBeNull();
  });

  it("creates no accounting record — proven where it can actually be measured", async () => {
    // Accounting tables are as locked down through PostgREST as the
    // evidence table is, so counting them through this client is not
    // possible and a fingerprint here would be vacuous. The real proof is
    // `supabase/tests/certification_evidence.test.sql`, which counts nine
    // accounting tables either side of a recorded row using psql.
    //
    // What IS provable here is the structural half: the writer reaches
    // exactly one function, and that function inserts into exactly one
    // table.
    const source = readFileSync("src/server/supplier-invoice-capture/certification-evidence.ts", "utf8");
    expect(source.match(/\.rpc\(/g)).toHaveLength(2); // write + read
    expect(source).not.toMatch(/supplier_invoice_captures|ae_imported_bills|ae_journals|AutomationTask/);
  });

  it("is SEALED once the run closes — the artefact is intentionally permanent", async () => {
    await closeCertificationRun(runId, db);

    const { error } = await (db.from("ai_certification_evidence") as unknown as {
      delete(): { eq(c: string, v: string): Promise<{ error: unknown }> };
    }).delete().eq("id", String(evidenceId));
    expect(error).not.toBeNull();

    // Still there, and still complete.
    expect(await readCertificationEvidence(db, runId)).toHaveLength(1);
  });

  it("accepts no further evidence once closed", async () => {
    const late = await recordCertificationEvidence(db, {
      runId, companyId: COMPANY, caseId: "after-close",
      corpusSha256: sha("a"), documentFile: "late.pdf", documentSha256: sha("b"),
      outcome: "extracted", model: null, callsUsed: null, callCeiling: null, durationMs: null,
      usage: null, errorCategory: null, httpStatus: null, providerMessage: null,
      extracted: null, validationStatus: null, validationFindings: [], lineCount: null, declaredLineCount: null,
    });
    expect(late.recorded).toBe(false);
  });
});
