/**
 * Phase 5P — the single controlled probe, tested.
 *
 * @vitest-environment node
 *
 * NO REAL PROVIDER REQUEST IS MADE BY ANY TEST IN THIS FILE, and none can
 * be: every test either injects a fake provider or runs a dry run that
 * stops before the door. `generateObject` is additionally mocked at the
 * module boundary, so there is no path to the network even if a credential
 * is present in the environment running this suite.
 *
 * The properties proved here are the ones the authorisation turns on:
 * exactly one request, no fallback, no persistence, no writes.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

import {
  DEFAULT_PROBE_CASE,
  MAX_PROVIDER_REQUESTS,
  runCertificationProbe,
  singleRequestProvider,
} from "./certification-probe";
import type { ExtractionProvider } from "./extraction-provider";
import type { ExtractionProviderResult } from "./types";

const ENV_ON = {
  VYRON_AI_INVOICE_EXTRACTION: "certification",
  AI_GATEWAY_API_KEY: "synthetic-test-placeholder",
};

const GOOD_RESULT: ExtractionProviderResult = {
  ok: true,
  model: "openai/gpt-4o-mini",
  usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200 },
  result: {
    header: {
      documentType: "Invoice",
      supplierName: "Karoo Wholesale Supplies",
      supplierVatNumber: "4111222333",
      supplierRegistrationNumber: "2015/445566/07",
      invoiceNumber: "KW-10041",
      invoiceDate: "2026-06-11",
      dueDate: "2026-07-11",
      orderReference: "PO-4471",
      currencyCode: "ZAR",
      subtotal: 1000,
      discountTotal: null,
      vatAmount: 150,
      total: 1150,
      confidence: 88,
    },
    lines: [
      { description: "Maize meal 10kg", supplierSku: "MM10", quantity: 10, uom: "bag", packDescription: null, packQuantity: null, unitPrice: 100, discount: null, vatRatePercent: 15, vatAmount: 150, lineTotal: 1000, confidence: 90 },
    ],
    invoiceNumbersSeen: ["KW-10041"],
    missingFields: [],
    warnings: [],
    declaredLineCount: 1,
  },
};

function fakeProvider(result: ExtractionProviderResult = GOOD_RESULT): ExtractionProvider & { calls: number } {
  const provider = {
    calls: 0,
    async extract() {
      provider.calls += 1;
      return result;
    },
  };
  return provider;
}

beforeEach(() => generateObjectMock.mockReset());

describe("the request ceiling is exactly one", () => {
  it("MAX_PROVIDER_REQUESTS is 1", () => {
    expect(MAX_PROVIDER_REQUESTS).toBe(1);
  });

  it("permits one call and refuses the second", async () => {
    const inner = fakeProvider();
    const { provider, callsMade } = singleRequestProvider(inner);

    await provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" });
    expect(callsMade()).toBe(1);

    await expect(provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" })).rejects.toThrow(/ceiling reached/i);
    // The decisive part: the refusal did not reach the inner provider.
    expect(inner.calls).toBe(1);
  });

  it("counts a FAILED request against the ceiling", async () => {
    // A failed request is still a request. Treating it otherwise is how a
    // "one call" probe quietly becomes three.
    const exploding: ExtractionProvider = {
      async extract() {
        throw new Error("network died");
      },
    };
    const { provider, callsMade } = singleRequestProvider(exploding);

    await expect(provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" })).rejects.toThrow();
    expect(callsMade()).toBe(1);
    await expect(provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" })).rejects.toThrow(/ceiling reached/i);
  });

  it("refuses concurrent second calls too", async () => {
    const inner = fakeProvider();
    const { provider } = singleRequestProvider(inner);
    const results = await Promise.allSettled([
      provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" }),
      provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" }),
      provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(inner.calls).toBe(1);
  });

  it("a completed probe reports exactly one request", async () => {
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: fakeProvider() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerRequests).toBe(1);
  });
});

describe("every gate runs before the door", () => {
  it("a dry run passes all gates and sends nothing", async () => {
    const inner = fakeProvider();
    const result = await runCertificationProbe({ confirm: false, env: ENV_ON, provider: inner });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("not-confirmed");
    expect(result.providerRequests).toBe(0);
    expect(inner.calls).toBe(0);
    // It names the document it WOULD have sent, so readiness is auditable.
    expect(result.reason).toContain("clean-pdf.pdf");
  });

  it("anything other than confirm === true is a dry run", async () => {
    for (const confirm of [undefined, null, 0, "", "true", 1] as unknown[]) {
      const inner = fakeProvider();
      const result = await runCertificationProbe({ confirm: confirm as boolean, env: ENV_ON, provider: inner });
      expect(result.ok).toBe(false);
      expect(inner.calls).toBe(0);
    }
  });

  it("refuses an unknown case before reading anything", async () => {
    const inner = fakeProvider();
    const result = await runCertificationProbe({ caseId: "no-such-case", confirm: true, env: ENV_ON, provider: inner });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("case-selection");
    expect(inner.calls).toBe(0);
  });

  it("refuses when the corpus is not countersigned", async () => {
    // Pointed at a directory with no countersignature file at all.
    const inner = fakeProvider();
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: inner, corpusRoot: "src/server" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("countersignature");
    expect(inner.calls).toBe(0);
  });

  it("uses the baseline document by default", () => {
    expect(DEFAULT_PROBE_CASE).toBe("clean-pdf");
  });

  it("names the case and both hashes in the result, so the record is complete", async () => {
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: fakeProvider() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.caseId).toBe("clean-pdf");
    expect(result.documentFile).toBe("clean-pdf.pdf");
    expect(result.corpusSha256).toBe("cce1e6168c1613554f79787abddec3885f47836cf739e96afb9884589beaa799");
    expect(result.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.mimeType).toBe("application/pdf");
  });
});

describe("no fallback provider", () => {
  it("refuses when the switch is off, whatever else is true", async () => {
    const result = await runCertificationProbe({ confirm: true, env: { AI_GATEWAY_API_KEY: "x" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("provider-selection");
  });

  it("refuses when the credential is absent, even with the switch on", async () => {
    const result = await runCertificationProbe({ confirm: true, env: { VYRON_AI_INVOICE_EXTRACTION: "certification" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("provider-selection");
  });

  it("names no provider other than the existing Gateway selector", () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-probe.ts", "utf8");
    // It goes through `selectExtractionProvider`, the one selector, and
    // constructs nothing itself. A second construction path here would be
    // a second provider architecture.
    expect(source).not.toMatch(/createGatewayExtractionProvider|new\s+\w*Provider|generateObject|@ai-sdk|fetch\(/);
    expect(source).toMatch(/selectExtractionProvider/);
  });

  it("a refusal never reaches a provider", async () => {
    const inner = fakeProvider();
    for (const env of [{}, { AI_GATEWAY_API_KEY: "x" }, { VYRON_AI_INVOICE_EXTRACTION: "certification" }]) {
      await runCertificationProbe({ confirm: true, env, provider: inner });
    }
    expect(inner.calls).toBe(0);
  });
});

describe("it cannot write anything", () => {
  const source = readFileSync("src/server/supplier-invoice-capture/certification-probe.ts", "utf8");
  const imports = source.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";

  it("imports no repository, service or scheduler", () => {
    // There is no code path from this file to an accounting row, because
    // nothing that can write one is in scope.
    expect(imports).not.toMatch(/repositor|-service|scheduler|supabase|createClient/i);
  });

  it("creates no task and activates no scheduler", () => {
    expect(source).not.toMatch(/AutomationTask|SupplierInvoiceExtraction|syncSupplierInvoiceExtractionTask|createAutomationTask/);
  });

  it("writes no file and mutates no environment", () => {
    expect(source).not.toMatch(/writeFile|appendFile|mkdir|rm\(|unlink|process\.env\s*\[/);
    expect(source).not.toMatch(/process\.env\.\w+\s*=/);
  });

  it("only ever reads", () => {
    const fsCalls = source.match(/\b(readFileSync|writeFileSync|appendFileSync|rmSync|unlinkSync)\b/g) ?? [];
    expect(new Set(fsCalls)).toEqual(new Set(["readFileSync"]));
  });
});

describe("nothing sensitive escapes", () => {
  it("carries the extracted values — the probe cannot be repeated to recover them", async () => {
    // The contract changed deliberately at execution time. The probe gets
    // exactly ONE request, so discarding the model's answer would mean the
    // only way to see what it read is to spend another call, which the
    // ceiling forbids. The values are safe to carry because the corpus is
    // wholly synthetic — a separate test asserts no production data is in
    // it. This must never be pointed at a real customer document.
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: fakeProvider() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (!result.extraction.succeeded) return;

    expect(result.extraction.extracted.supplierName).toBe("Karoo Wholesale Supplies");
    expect(result.extraction.extracted.invoiceNumber).toBe("KW-10041");
    expect(result.extraction.extracted.total).toBe(1150);
    expect(result.extraction.extracted.lines).toHaveLength(1);
    expect(result.extraction.extracted.lines[0].unitPrice).toBe(100);
  });

  it("still never carries the credential or the document bytes", async () => {
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: fakeProvider() });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("synthetic-test-placeholder");
    expect(serialised).not.toMatch(/bytes"\s*:\s*\[/);
    // Only the byte COUNT, never the bytes.
    expect(serialised).toMatch(/"documentBytes":\d+/);
  });

  it("a provider failure reports a category, not a payload", async () => {
    const failing = fakeProvider({
      ok: false,
      category: "payment-required",
      httpStatus: 402,
      message: "Payment required.",
      model: "openai/gpt-4o-mini",
    });
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: failing });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extraction.succeeded).toBe(false);
    if (result.extraction.succeeded) return;
    expect(result.extraction.errorCategory).toBe("payment-required");
    expect(result.extraction.httpStatus).toBe(402);
    // Still exactly one request, even though it failed.
    expect(result.providerRequests).toBe(1);
  });

  it("the extraction is validated by the existing deterministic validator", async () => {
    const result = await runCertificationProbe({ confirm: true, env: ENV_ON, provider: fakeProvider() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (!result.extraction.succeeded) return;
    expect(result.extraction.validationStatus).toBe("Pass");
    expect(result.extraction.lineCount).toBe(1);
  });
});

describe("the entry script", () => {
  const entry = readFileSync("scripts/certification-probe.mjs", "utf8");

  it("defaults to a dry run — a request requires typing --confirm", () => {
    expect(entry).toMatch(/const confirm = args\.includes\("--confirm"\)/);
    expect(entry).toMatch(/runCertificationProbe\(\{ caseId, confirm \}\)/);
  });

  it("sets the provider switch IN-PROCESS only, and never persists it", () => {
    expect(entry).toMatch(/process\.env\.VYRON_AI_INVOICE_EXTRACTION = "certification"/);
    // Comments stripped first: the file describes what it does NOT do
    // ("It is NOT written to `.env.local`"), and a guard that trips on its
    // own explanation is noise rather than evidence.
    const code = entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/);
  });

  it("loads ONLY the credential variable from .env.local", () => {
    expect(entry).toMatch(/const CREDENTIAL_VAR = "AI_GATEWAY_API_KEY"/);
    expect(entry).toMatch(/if \(name !== CREDENTIAL_VAR\) continue/);
  });

  it("never prints the credential", () => {
    // No console call anywhere in the file may mention the variable, and
    // the loader returns a boolean rather than the value.
    const consoleLines = entry.split("\n").filter((l) => /console\.(log|error|warn|info)/.test(l));
    expect(consoleLines.some((l) => /AI_GATEWAY_API_KEY|CREDENTIAL_VAR|process\.env\[/.test(l))).toBe(false);
    expect(entry).toMatch(/return true;/);
  });

  it("fails closed when jiti is unavailable rather than finding another way", () => {
    expect(entry).toMatch(/die\("jiti is not available/);
  });
});
