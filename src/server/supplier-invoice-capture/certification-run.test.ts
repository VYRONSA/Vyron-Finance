/**
 * Phase 5Q — the durable certification run, tested.
 *
 * @vitest-environment node
 *
 * NO PROVIDER REQUEST IS MADE BY ANY TEST IN THIS FILE, and no database is
 * contacted: every test injects a fake provider and a fake RPC surface.
 * `generateObject` is mocked at the module boundary as well, so there is no
 * path to the network even with a credential in the environment.
 *
 * The fake database below reproduces the ONE property that matters about
 * `fn_ai_certification_reserve_call`: a single counter, shared by every
 * caller, that refuses past its ceiling. Its atomicity under real
 * concurrency is proved where it actually lives —
 * `supabase/tests/certification_call_ceiling.concurrency.sh`, 40 connections
 * against a ceiling of 15 granting exactly 15.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

import { CERTIFICATION_CALL_CEILING, runCertificationCorpus } from "./certification-run";
import { reserveCertificationCall, type CertificationDb } from "./certification-budget";
import { loadManifest } from "./certification-corpus";
import type { ExtractionProvider } from "./extraction-provider";
import type { ExtractionProviderResult } from "./types";
import type { EvidenceRecord } from "./certification-evidence";

const MANIFEST = loadManifest();
const ENV_ON = { VYRON_AI_INVOICE_EXTRACTION: "certification", AI_GATEWAY_API_KEY: "synthetic-test-placeholder" };
const CO = "5a0c0000-0000-4000-8000-00000000513a";

const GOOD: ExtractionProviderResult = {
  ok: true,
  model: "openai/gpt-4o-mini",
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  result: {
    header: {
      documentType: "Invoice", supplierName: "Karoo Wholesale Supplies", supplierVatNumber: "4111222333",
      supplierRegistrationNumber: null, invoiceNumber: "KW-10041", invoiceDate: "2026-06-11", dueDate: null,
      orderReference: null, currencyCode: "ZAR", subtotal: 1000, discountTotal: null, vatAmount: 150, total: 1150, confidence: null,
    },
    lines: [{ description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", packDescription: null, packQuantity: null, unitPrice: 100, discount: null, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, confidence: null }],
    invoiceNumbersSeen: ["KW-10041"], missingFields: [], warnings: [], declaredLineCount: 1,
  },
};

/**
 * A stand-in for the certification run table: ONE counter, shared by every
 * client built against it — which is what makes it durable rather than
 * per-process.
 */
function fakeDatabase(ceiling: number, evidenceFails = false) {
  const state = { callsUsed: 0, status: "Open" as "Open" | "Exhausted" | "Closed", evidenceWritten: 0 };
  const db: CertificationDb = {
    // The run reserves, sends and records; it never reads tables. A `from`
    // that throws proves that, rather than leaving it to a comment.
    from() {
      throw new Error("the certification run must not read tables");
    },
    async rpc(fn: string) {
      if (fn === "fn_ai_certification_record_evidence") {
        if (evidenceFails) return { data: null, error: { message: "disk full" } };
        state.evidenceWritten += 1;
        return { data: state.evidenceWritten, error: null };
      }
      if (fn !== "fn_ai_certification_reserve_call") return { data: null, error: null };
      if (state.status !== "Open" || state.callsUsed >= ceiling) {
        return {
          data: { reserved: false, calls_used: state.callsUsed, call_ceiling: ceiling, status: state.status === "Open" ? "Exhausted" : state.status, reason: "This certification run has reached its call ceiling." },
          error: null,
        };
      }
      state.callsUsed += 1;
      if (state.callsUsed >= ceiling) state.status = "Exhausted";
      return { data: { reserved: true, calls_used: state.callsUsed, call_ceiling: ceiling, status: state.status, reason: "" }, error: null };
    },
  };
  return { db, state };
}

function fakeProvider(result: ExtractionProviderResult = GOOD): ExtractionProvider & { calls: number } {
  const p = { calls: 0, async extract() { p.calls += 1; return result; } };
  return p;
}

const ALL_CASES = MANIFEST.cases.map((c) => c.caseId);

beforeEach(() => generateObjectMock.mockReset());

describe("the ceiling matches the corpus", () => {
  it("is 24, and the corpus has 24 documents", () => {
    expect(CERTIFICATION_CALL_CEILING).toBe(24);
    expect(MANIFEST.cases).toHaveLength(CERTIFICATION_CALL_CEILING);
  });
});

describe("exactly 24 reservations, and no twenty-fifth", () => {
  it("runs all 24 documents with exactly 24 provider requests", async () => {
    const { db, state } = fakeDatabase(24);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcomes).toHaveLength(24);
    expect(result.providerRequests).toBe(24);
    expect(provider.calls).toBe(24);
    expect(state.callsUsed).toBe(24);
    expect(result.stoppedEarly).toBeNull();
  });

  it("refuses the 25th and stops the run rather than skipping", async () => {
    // A ceiling of 23 against 24 documents: the last one must be refused
    // BEFORE its request, and the run must stop there.
    const { db, state } = fakeDatabase(23);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(provider.calls).toBe(23);
    expect(state.callsUsed).toBe(23);
    expect(result.stoppedEarly?.afterCases).toBe(23);
    expect(result.stoppedEarly?.reason).toMatch(/Reservation refused/);
    expect(result.stoppedEarly?.reason).toMatch(/No request was made/);
  });

  it("an exhausted run makes no request at all", async () => {
    const { db } = fakeDatabase(0);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider });

    expect(provider.calls).toBe(0);
    if (!result.ok) return;
    expect(result.providerRequests).toBe(0);
  });
});

describe("a second process cannot reset the ceiling", () => {
  it("two independent runs against the SAME durable counter share it", async () => {
    // The defect this prevents: an in-process latch gives every `node`
    // invocation a fresh allowance, so running the script twice spends
    // twice the calls with nothing recording that it happened.
    const { db, state } = fakeDatabase(24);

    const first = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider(), caseIds: ALL_CASES.slice(0, 20) });
    expect(first.ok && first.providerRequests).toBe(20);
    expect(state.callsUsed).toBe(20);

    // A completely separate invocation — new options, new provider.
    const secondProvider = fakeProvider();
    const second = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: secondProvider, caseIds: ALL_CASES });

    // Only the 4 remaining reservations are granted, not a fresh 24.
    expect(secondProvider.calls).toBe(4);
    expect(state.callsUsed).toBe(24);
    if (second.ok) expect(second.stoppedEarly?.reason).toMatch(/ceiling/i);
  });

  it("concurrent runs against one counter cannot exceed it between them", async () => {
    const { db, state } = fakeDatabase(10);
    const a = fakeProvider();
    const b = fakeProvider();

    await Promise.all([
      runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: a, caseIds: ALL_CASES }),
      runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: b, caseIds: ALL_CASES }),
    ]);

    expect(a.calls + b.calls).toBe(10);
    expect(state.callsUsed).toBe(10);
  });
});

describe("a failed provider call still consumes its reservation", () => {
  const FAILURE: ExtractionProviderResult = {
    ok: false, category: "server-error", httpStatus: 503, message: "Service unavailable.", model: "openai/gpt-4o-mini",
  };

  it("consumes its reservation and STOPS the run permanently", async () => {
    // Two rules at once. The reservation is never given back — a failed
    // request reached the provider, took its time and may have been
    // billed. And the run stops rather than sending the remaining 23
    // documents into a provider that has already refused one.
    const { db, state } = fakeDatabase(24);
    const provider = fakeProvider(FAILURE);
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider });

    expect(provider.calls).toBe(1);
    // Consumed, not released: one reservation spent on the failed call.
    expect(state.callsUsed).toBe(1);
    if (!result.ok) return;
    expect(result.providerRequests).toBe(1);
    expect(result.outcomes[0].result.succeeded).toBe(false);
    expect(result.stoppedEarly?.afterCases).toBe(1);
    expect(result.stoppedEarly?.reason).toMatch(/Provider failure/);
    expect(result.stoppedEarly?.reason).toMatch(/no retry/i);
  });

  it("no retry can obtain a second reservation for the same case", async () => {
    const { db, state } = fakeDatabase(24);
    const provider = fakeProvider(FAILURE);
    await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider, caseIds: ["clean-pdf"] });

    // One case, one reservation, one request. There is no retry path.
    expect(state.callsUsed).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it("refuses to process the same case twice in one run", async () => {
    const { db } = fakeDatabase(24);
    await expect(
      runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider(), caseIds: ["clean-pdf", "clean-pdf"] }),
    ).rejects.toThrow(/twice/i);
  });
});

describe("fail closed — no reservation, no request", () => {
  it("refuses outright when no certification database is configured", async () => {
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db: null, confirm: true, env: ENV_ON, provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("no-database");
    expect(result.providerRequests).toBe(0);
    expect(provider.calls).toBe(0);
    // The decisive sentence: it does not fall back to the latch.
    expect(result.reason).toMatch(/no in-process fallback/i);
  });

  it("a database ERROR during reservation stops the run before any request", async () => {
    const exploding: CertificationDb = {
      from() {
        throw new Error("the certification run must not read tables");
      },
      async rpc() {
        throw new Error("connection refused");
      },
    };
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db: exploding, confirm: true, env: ENV_ON, provider });

    expect(provider.calls).toBe(0);
    if (!result.ok) return;
    expect(result.providerRequests).toBe(0);
    expect(result.stoppedEarly?.reason).toMatch(/could not be read|refused/i);
  });

  it("the reservation wrapper turns any database failure into a refusal", async () => {
    const exploding: CertificationDb = {
      from() { throw new Error("the certification run must not read tables"); },
      async rpc() { throw new Error("socket hang up"); },
    };
    const reservation = await reserveCertificationCall(1, exploding);
    expect(reservation.reserved).toBe(false);
    expect(reservation.reason).toMatch(/no provider call was made/i);
  });

  it("a malformed reservation answer is a refusal, not a grant", async () => {
    for (const data of [null, {}, { reserved: "yes" }, { reserved: 1 }]) {
      const db: CertificationDb = {
        from() { throw new Error("the certification run must not read tables"); },
        async rpc() { return { data, error: null }; },
      };
      const provider = fakeProvider();
      await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider, caseIds: ["clean-pdf"] });
      expect(provider.calls).toBe(0);
    }
  });
});

describe("the existing gates are all preserved", () => {
  it("refuses when the corpus is not countersigned", async () => {
    const { db } = fakeDatabase(24);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider, corpusRoot: "src/server" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("countersignature");
    expect(provider.calls).toBe(0);
  });

  it("refuses when the provider switch is off", async () => {
    const { db } = fakeDatabase(24);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: {}, provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("provider-selection");
    expect(provider.calls).toBe(0);
  });

  it("is a dry run unless confirm is exactly true", async () => {
    const { db, state } = fakeDatabase(24);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: false, env: ENV_ON, provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("not-confirmed");
    expect(provider.calls).toBe(0);
    // A dry run reserves nothing: it must not cost anything to check.
    expect(state.callsUsed).toBe(0);
  });

  it("verifies each document's own hash immediately before sending", async () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-run.ts", "utf8");
    expect(source).toMatch(/createHash\("sha256"\)\.update\(bytes\)/);
    expect(source).toMatch(/documentSha256 !== entry\.documentSha256/);
  });

  it("reports the corpus hash it ran against", async () => {
    const { db } = fakeDatabase(24);
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider(), caseIds: ["clean-pdf"] });
    if (!result.ok) return;
    expect(result.corpusSha256).toBe("cce1e6168c1613554f79787abddec3885f47836cf739e96afb9884589beaa799");
  });
});

describe("it reuses the existing controls and writes nothing", () => {
  const source = readFileSync("src/server/supplier-invoice-capture/certification-run.ts", "utf8");
  const imports = source.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";

  it("calls the EXISTING certification functions, and reimplements no counting", () => {
    expect(imports).toMatch(/certification-budget/);
    // No SQL, no counter, no ceiling arithmetic of its own.
    expect(source).not.toMatch(/callsUsed\s*\+\+|calls_used\s*=|update\s+ai_certification_runs/i);
  });

  it("imports no repository, service, scheduler or accounting module", () => {
    expect(imports).not.toMatch(/repositor|-service|scheduler|purchase-bill|posting|journal/i);
  });

  it("creates no task, capture, company or accounting row", () => {
    expect(source).not.toMatch(/AutomationTask|createAutomationTask|supplier_invoice_captures|ae_imported_bills|ae_journals|insert into/i);
  });

  it("only reads from disk", () => {
    const fsCalls = source.match(/\b(readFileSync|writeFileSync|appendFileSync|rmSync|unlinkSync)\b/g) ?? [];
    expect(new Set(fsCalls)).toEqual(new Set(["readFileSync"]));
  });

  it("never carries the credential into its report", async () => {
    const { db } = fakeDatabase(24);
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider(), caseIds: ["clean-pdf"] });
    expect(JSON.stringify(result)).not.toContain("synthetic-test-placeholder");
  });

  it("the certification database uses DEDICATED env names, never the app's", async () => {
    const budget = readFileSync("src/server/supplier-invoice-capture/certification-budget.ts", "utf8");
    const code = budget.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // If certification read the app's own Supabase variables, a shell that
    // had production in them would point certification at production.
    expect(code).toMatch(/VYRON_CERTIFICATION_SUPABASE_URL/);
    expect(code).toMatch(/VYRON_CERTIFICATION_SERVICE_ROLE_KEY/);
    expect(code).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

/**
 * Phase 5Q.1 — the CLI entry point.
 *
 * Source-level assertions, because the properties that matter here are
 * structural: what it refuses to do, what it never reads, and the order it
 * does things in. Running it would require a database and a credential,
 * and would send twenty-four paid requests.
 */
describe("the 24-document CLI", () => {
  const cli = readFileSync("scripts/certification-run.mjs", "utf8");
  const code = cli.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("requires an explicit --confirm; anything else is a dry run", () => {
    expect(code).toMatch(/const confirm = args\.includes\("--confirm"\)/);
    expect(code).toMatch(/if \(!confirm\) \{[\s\S]*?DRY RUN — READY/);
    // A dry run must not CALL anything that opens a run or reserves a
    // call. Matching the bare word "reserve" would trip on the dry run's
    // own message ("nothing was reserved"), which is the opposite of a
    // problem.
    const dryRunBlock = code.slice(code.indexOf("if (!confirm)"), code.indexOf("const runId"));
    expect(dryRunBlock).not.toMatch(/openCertificationRun\(|reserveCertificationCall\(|runCertificationCorpus\(/);
  });

  it("fails closed without the certification Supabase URL", () => {
    expect(code).toMatch(/if \(!found\.includes\("VYRON_CERTIFICATION_SUPABASE_URL"\)\)[\s\S]{0,200}die\(/);
  });

  it("fails closed without the certification service-role key", () => {
    expect(code).toMatch(/if \(!found\.includes\("VYRON_CERTIFICATION_SERVICE_ROLE_KEY"\)\)[\s\S]{0,200}die\(/);
  });

  it("can NEVER fall back to the application's Supabase variables", () => {
    // The defect this prevents: a shell with production in
    // NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY would have
    // certification open runs in the production database.
    expect(code).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
    const budget = readFileSync("src/server/supplier-invoice-capture/certification-budget.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(budget).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("loads ONLY whitelisted secrets, and prints none of them", () => {
    expect(code).toMatch(/const SECRET_VARS = \["AI_GATEWAY_API_KEY", "VYRON_CERTIFICATION_SUPABASE_URL", "VYRON_CERTIFICATION_SERVICE_ROLE_KEY"\]/);
    expect(code).toMatch(/if \(!SECRET_VARS\.includes\(name\)\) continue/);
    // The loader returns NAMES, never values.
    expect(code).toMatch(/found\.push\(name\)/);
    const consoleLines = code.split("\n").filter((l) => /console\.(log|error)/.test(l));
    expect(consoleLines.some((l) => /process\.env\[|value|SERVICE_ROLE_KEY['"]?\s*\)/.test(l))).toBe(false);
  });

  it("runs the corpus gates BEFORE opening the durable run", () => {
    // Opening first would leave a row describing an experiment that never
    // happened.
    expect(code.indexOf("verifyCertificationPreconditions")).toBeLessThan(code.indexOf("openCertificationRun"));
  });

  it("opens exactly ONE run, with the ceiling from the controller", () => {
    expect(code.match(/openCertificationRun\(/g)).toHaveLength(1);
    expect(code).toMatch(/run\.CERTIFICATION_CALL_CEILING,/);
  });

  it("closes the run deterministically, however it ends", () => {
    expect(code).toMatch(/finally \{[\s\S]*?closeCertificationRun/);
  });

  it("sets the provider switch in-process only and never persists it", () => {
    expect(code).toMatch(/process\.env\.VYRON_AI_INVOICE_EXTRACTION = "certification"/);
    expect(code).not.toMatch(/writeFileSync|appendFileSync/);
  });

  it("delegates reservation and sending to the controller — no second implementation", () => {
    expect(code).toMatch(/runCertificationCorpus\(\{ runId, companyId, db, confirm: true \}\)/);
    expect(code).not.toMatch(/fn_ai_certification_reserve_call|extract\(/);
  });

  it("imports no repository, service, scheduler or accounting module", () => {
    expect(code).not.toMatch(/repositor|-service|scheduler|purchase-bill|journal/i);
  });

  it("creates no company, capture, bill or task", () => {
    expect(code).not.toMatch(/createCompany|insert into|supplier_invoice_captures|ae_imported_bills|AutomationTask/i);
  });

  it("its report prints outcomes, not extracted document content", () => {
    // Field-by-field scoring is the reporting phase's job. The CLI prints
    // validation status, counts and timings.
    const reportBlock = code.slice(code.indexOf("CERTIFICATION RUN COMPLETE"));
    expect(reportBlock).not.toMatch(/supplierName|invoiceNumber|extracted\./);
    expect(reportBlock).toMatch(/validationStatus|lineCount/);
  });
});

/**
 * Phase 5Q.6 — evidence persistence.
 *
 * Run #47 made 24 calls and kept the answers in memory. Scoring it
 * field-by-field is now impossible without paying for 24 more. These
 * tests exist so that cannot happen twice.
 */
describe("certification evidence is persisted, or the run stops", () => {
  it("records one piece of evidence per case", async () => {
    const { db, state } = fakeDatabase(24);
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerRequests).toBe(24);
    expect(state.evidenceWritten).toBe(24);
  });

  it("carries the FULL extracted payload, not a summary", async () => {
    // The field that makes field-by-field scoring possible later. A
    // summary would leave the next run as unscoreable as #47.
    const { db } = fakeDatabase(24);
    const recorded: EvidenceRecord[] = [];
    await runCertificationCorpus({
      runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider(), caseIds: ["clean-pdf"],
      record: async (_db, evidence) => { recorded.push(evidence); return { recorded: true }; },
    });

    expect(recorded).toHaveLength(1);
    const payload = recorded[0].extracted as { header: { invoiceNumber: string }; lines: unknown[] };
    expect(payload.header.invoiceNumber).toBe("KW-10041");
    expect(payload.lines).toHaveLength(1);
    expect(recorded[0].validationStatus).toBe("Pass");
    expect(recorded[0].outcome).toBe("extracted");
  });

  it("ties every payload to the run, company, corpus and document", async () => {
    const { db } = fakeDatabase(24);
    const recorded: EvidenceRecord[] = [];
    await runCertificationCorpus({
      runId: 99, companyId: CO, db, confirm: true, env: ENV_ON, provider: fakeProvider(), caseIds: ["clean-pdf"],
      record: async (_db, evidence) => { recorded.push(evidence); return { recorded: true }; },
    });

    const e = recorded[0];
    expect(e.runId).toBe(99);
    expect(e.companyId).toBe(CO);
    expect(e.caseId).toBe("clean-pdf");
    expect(e.documentFile).toBe("clean-pdf.pdf");
    expect(e.corpusSha256).toBe("cce1e6168c1613554f79787abddec3885f47836cf739e96afb9884589beaa799");
    expect(e.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    // The reservation that authorised the call.
    expect(e.callsUsed).toBe(1);
    expect(e.callCeiling).toBe(24);
  });

  it("STOPS the run when evidence cannot be recorded", async () => {
    // The reservation is already spent and the call already paid for.
    // Continuing would spend the rest of the ceiling producing results
    // nobody can score.
    const { db, state } = fakeDatabase(24, true);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider });

    expect(provider.calls).toBe(1);
    expect(state.evidenceWritten).toBe(0);
    if (!result.ok) return;
    expect(result.stoppedEarly?.afterCases).toBe(1);
    expect(result.stoppedEarly?.reason).toMatch(/could not be recorded/i);
    expect(result.stoppedEarly?.reason).toMatch(/must not keep spending/i);
  });

  it("records a provider FAILURE too, before stopping", async () => {
    // A provider failure is itself a certification result worth keeping.
    const { db, state } = fakeDatabase(24);
    const failing = fakeProvider({
      ok: false, category: "server-error", httpStatus: 503, message: "Service unavailable.", model: "openai/gpt-4o-mini",
    });
    const result = await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: true, env: ENV_ON, provider: failing });

    expect(state.evidenceWritten).toBe(1);
    if (!result.ok) return;
    expect(result.stoppedEarly?.reason).toMatch(/Provider failure/);
  });

  it("writes nothing on a dry run", async () => {
    const { db, state } = fakeDatabase(24);
    await runCertificationCorpus({ runId: 1, companyId: CO, db, confirm: false, env: ENV_ON, provider: fakeProvider() });
    expect(state.evidenceWritten).toBe(0);
    expect(state.callsUsed).toBe(0);
  });

  it("the writer creates no accounting record and imports nothing that could", () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-evidence.ts", "utf8");
    const imports = source.match(/^import[\s\S]*?;$/gm)?.join(" ") ?? "";
    expect(imports).not.toMatch(/repositor|-service|scheduler|purchase-bill|journal/i);
    expect(source).not.toMatch(/supplier_invoice_captures|ae_imported_bills|ae_journals|AutomationTask/);
    // Exactly two RPCs: the writer and the reader. The reader exists
    // because the table is locked down so tightly that PostgREST cannot
    // SELECT it — found by running the writer end to end in 5Q.7.
    expect(source.match(/\.rpc\(/g)).toHaveLength(2);
    expect(source).toMatch(/fn_ai_certification_record_evidence/);
    expect(source).toMatch(/fn_ai_certification_read_evidence/);
  });
});

describe("a required argument must fail before anything is spent (run #62)", () => {
  it("refuses when no company is named, WITHOUT making a provider call", async () => {
    // Run #62 spent a real provider call before discovering the CLI had
    // not passed companyId: the argument was dropped from the RPC,
    // PostgREST could not resolve the overload, and the run stopped after
    // the money was gone. This check moves that discovery to before the
    // first reservation.
    const { db, state } = fakeDatabase(24);
    const provider = fakeProvider();
    const result = await runCertificationCorpus({ runId: 1, companyId: "", db, confirm: true, env: ENV_ON, provider });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("no-company");
    expect(provider.calls).toBe(0);
    expect(state.callsUsed).toBe(0);
    expect(state.evidenceWritten).toBe(0);
  });

  it("the CLI passes companyId through to the controller", () => {
    // The defect was in the .mjs entry, which typechecking does not see.
    const cli = readFileSync("scripts/certification-run.mjs", "utf8");
    expect(cli).toMatch(/runCertificationCorpus\(\{ runId, companyId, db, confirm: true \}\)/);
  });
});
