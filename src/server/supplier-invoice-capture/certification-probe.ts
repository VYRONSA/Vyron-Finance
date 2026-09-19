/**
 * Phase 5P — the single controlled certification probe.
 *
 * ONE provider request, against ONE frozen corpus document, behind every
 * gate built in 5N and 5O. This is the first time any VYRON code will send
 * anything to the AI Gateway for invoice extraction, so it is deliberately
 * the smallest thing that can do that honestly.
 *
 * WHAT IT DOES NOT DO, AND CANNOT
 *
 *  - It writes NOTHING. No repository, service, journal, bill, supplier or
 *    task is imported here, so there is no code path from this file to an
 *    accounting row. Reading a document off disk and asking a model about
 *    it is the entire scope.
 *  - It creates no scheduler and activates no task.
 *  - It never returns, logs or stores the provider's raw answer, the
 *    document bytes, or the credential. The report type below is the whole
 *    output surface, and none of those appear in it.
 *  - It has no second provider. If the certification switch and credential
 *    do not both resolve to the Gateway adapter, it refuses — it does not
 *    look for something else to use.
 *
 * THE CEILING IS A LATCH, NOT A POLICY
 *
 * `MAX_PROVIDER_REQUESTS` is 1, and it is enforced by a closure that counts
 * BEFORE it calls, so even a failed request consumes it. A second call
 * throws rather than being queued, retried or silently dropped. That is the
 * difference between a limit and an intention.
 *
 * ORDER MATTERS. Every gate runs before the provider is even constructed:
 * countersignature, corpus integrity, the selected case's own hash, then
 * provider selection. A failure at any point returns before a byte leaves
 * the machine.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { requireCountersignedCorpus } from "./countersign";
import {
  loadManifest,
  requireCertificationCase,
  requireVerifiedCorpus,
  type CertificationCase,
} from "./certification-corpus";
import { decideExtractionProvider, selectExtractionProvider } from "./provider-selection";
import { validateExtraction } from "./validation";
import type { ExtractionProvider } from "./extraction-provider";
import type { ExtractionInput } from "./types";

/** One. Not "a small number" — one. */
export const MAX_PROVIDER_REQUESTS = 1;

/** The baseline document. Chosen because every particular is present and
 * its arithmetic agrees, so a failure here is unambiguously the provider's
 * and not the document's. */
export const DEFAULT_PROBE_CASE = "clean-pdf";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/**
 * Wraps a provider so it can be called exactly `MAX_PROVIDER_REQUESTS`
 * times, ever.
 *
 * The counter increments BEFORE the inner call, so a request that throws
 * still consumes the allowance — a failed request is still a request, and
 * treating it otherwise is how a "one call" probe becomes three.
 */
export function singleRequestProvider(inner: ExtractionProvider): {
  provider: ExtractionProvider;
  callsMade: () => number;
} {
  let used = 0;
  return {
    provider: {
      async extract(input: ExtractionInput) {
        if (used >= MAX_PROVIDER_REQUESTS) {
          throw new Error(
            `Certification probe ceiling reached: ${MAX_PROVIDER_REQUESTS} provider request permitted, a further one was attempted and refused.`,
          );
        }
        used += 1;
        return inner.extract(input);
      },
    },
    callsMade: () => used,
  };
}

export type ProbeRefusal = {
  ok: false;
  stage:
    | "countersignature"
    | "corpus-integrity"
    | "case-selection"
    | "document-hash"
    | "provider-selection"
    | "not-confirmed";
  reason: string;
  providerRequests: 0;
};

export type ProbeOutcome = {
  ok: true;
  caseId: string;
  documentFile: string;
  documentSha256: string;
  documentBytes: number;
  mimeType: string;
  corpusSha256: string;
  model: string | null;
  /** Exactly one, always — asserted by test. */
  providerRequests: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** Token usage as the provider reported it, or null. Never a payload. */
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  extraction:
    | {
        succeeded: true;
        lineCount: number;
        declaredLineCount: number | null;
        validationStatus: string;
        findingCodes: string[];
        /**
         * The values the model returned, for THIS run only.
         *
         * Field-level SCORING is Phase 5Q's job. But the probe gets exactly
         * one request and cannot be repeated, so discarding the answer
         * would mean the only way to see what the model read is to spend
         * another call — which is precisely what the ceiling forbids.
         *
         * Safe to carry because the certification corpus is wholly
         * synthetic: every supplier, number and amount in it is invented,
         * and a test asserts no production data appears. This must NOT be
         * populated from a real customer document.
         */
        extracted: {
          documentType: string | null;
          supplierName: string | null;
          supplierVatNumber: string | null;
          supplierRegistrationNumber: string | null;
          invoiceNumber: string | null;
          invoiceDate: string | null;
          dueDate: string | null;
          orderReference: string | null;
          currencyCode: string | null;
          subtotal: number | null;
          discountTotal: number | null;
          vatAmount: number | null;
          total: number | null;
          confidence: number | null;
          lines: {
            description: string | null;
            supplierSku: string | null;
            quantity: number | null;
            uom: string | null;
            unitPrice: number | null;
            discount: number | null;
            vatRatePercent: number | null;
            vatAmount: number | null;
            lineTotal: number | null;
          }[];
        };
      }
    | {
        succeeded: false;
        errorCategory: string;
        httpStatus: number | null;
        /** Already sanitised at the provider boundary. */
        message: string;
      };
};

export type ProbeResult = ProbeOutcome | ProbeRefusal;

export type ProbeOptions = {
  caseId?: string;
  /** Must be true for a request to be made. Anything else is a dry run
   * that performs every check and stops at the door. */
  confirm: boolean;
  corpusRoot?: string;
  /** Injected in tests. Production path constructs it from the switch. */
  provider?: ExtractionProvider;
  env?: Record<string, string | undefined>;
};

function refuse(stage: ProbeRefusal["stage"], reason: string): ProbeRefusal {
  return { ok: false, stage, reason, providerRequests: 0 };
}

/**
 * Runs the probe.
 *
 * Every gate is checked in order, and each returns before the next begins.
 * Nothing below the failing line executes.
 */
export async function runCertificationProbe(options: ProbeOptions): Promise<ProbeResult> {
  const env = options.env ?? process.env;
  const corpusRoot = options.corpusRoot;
  const caseId = options.caseId ?? DEFAULT_PROBE_CASE;

  // 1. The answer keys must be independently countersigned. Without this a
  //    result cannot be interpreted, so there is no point producing one.
  try {
    if (corpusRoot) requireCountersignedCorpus(corpusRoot);
    else requireCountersignedCorpus();
  } catch (error) {
    return refuse("countersignature", error instanceof Error ? error.message : String(error));
  }

  // 2. The corpus must be exactly what was reviewed.
  let manifestHash: string;
  try {
    const manifest = corpusRoot ? requireVerifiedCorpus(corpusRoot) : requireVerifiedCorpus();
    manifestHash = manifest.corpusSha256;
  } catch (error) {
    return refuse("corpus-integrity", error instanceof Error ? error.message : String(error));
  }

  // 3. The case is named before anything is read, so the record of which
  //    document was sent cannot be reconstructed after the fact.
  let selected: CertificationCase;
  try {
    selected = corpusRoot ? requireCertificationCase(caseId, corpusRoot) : requireCertificationCase(caseId);
  } catch (error) {
    return refuse("case-selection", error instanceof Error ? error.message : String(error));
  }

  // 4. That one document's own hash, checked individually against the
  //    manifest. The corpus-wide check above proves the set; this proves
  //    the file about to be transmitted.
  const manifest = corpusRoot ? loadManifest(corpusRoot) : loadManifest();
  const entry = manifest.cases.find((c) => c.caseId === caseId)!;
  const bytes = readFileSync(selected.documentPath);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== entry.documentSha256) {
    return refuse(
      "document-hash",
      `The document for "${caseId}" does not match the manifest. Expected ${entry.documentSha256.slice(0, 16)}…, found ${actualHash.slice(0, 16)}….`,
    );
  }

  const extension = selected.documentFile.slice(selected.documentFile.lastIndexOf("."));
  const mimeType = MIME_BY_EXTENSION[extension.toLowerCase()];
  if (!mimeType) {
    return refuse("case-selection", `No supported media type for "${selected.documentFile}".`);
  }

  // 5. Provider selection. There is exactly one acceptable answer, and no
  //    fallback: if the switch and credential do not both resolve to the
  //    Gateway adapter, the probe refuses rather than finding another way.
  const decision = decideExtractionProvider(env);
  if (decision.provider !== "gateway") {
    return refuse("provider-selection", decision.reason);
  }

  // 6. The door. A dry run performs every check above and stops here,
  //    which is how readiness is demonstrated without spending anything.
  if (options.confirm !== true) {
    return refuse(
      "not-confirmed",
      `Dry run: every gate passed and the probe is ready to send "${selected.documentFile}" (${bytes.length} bytes, ${mimeType}). ` +
        `No request was made. Re-run with explicit confirmation to make the single call.`,
    );
  }

  const { provider, callsMade } = singleRequestProvider(options.provider ?? (await selectExtractionProvider(env)));

  const startedAt = new Date();
  const started = Date.now();
  const answer = await provider.extract({ bytes: new Uint8Array(bytes), mimeType });
  const durationMs = Date.now() - started;
  const completedAt = new Date();

  const base = {
    ok: true as const,
    caseId,
    documentFile: selected.documentFile,
    documentSha256: actualHash,
    documentBytes: bytes.length,
    mimeType,
    corpusSha256: manifestHash,
    providerRequests: callsMade(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
  };

  if (!answer.ok) {
    return {
      ...base,
      model: answer.model,
      usage: null,
      extraction: {
        succeeded: false,
        errorCategory: answer.category,
        httpStatus: answer.httpStatus,
        // Sanitised at the provider boundary by `toProviderFailure`.
        message: answer.message,
      },
    };
  }

  // The same deterministic validation every captured document goes
  // through. The probe does not grade the answer — it confirms the
  // pipeline ran and reports what the validator concluded.
  const report = validateExtraction(answer.result);

  return {
    ...base,
    model: answer.model,
    usage: answer.usage ?? null,
    extraction: {
      succeeded: true,
      lineCount: answer.result.lines.length,
      declaredLineCount: answer.result.declaredLineCount,
      validationStatus: report.status,
      findingCodes: report.findings.map((f) => f.code),
      // Plain property reads off a value `parseExtractionResponse` has
      // already validated, so this cannot throw after the request has been
      // spent — which matters when the request cannot be repeated.
      extracted: {
        documentType: answer.result.header.documentType,
        supplierName: answer.result.header.supplierName,
        supplierVatNumber: answer.result.header.supplierVatNumber,
        supplierRegistrationNumber: answer.result.header.supplierRegistrationNumber,
        invoiceNumber: answer.result.header.invoiceNumber,
        invoiceDate: answer.result.header.invoiceDate,
        dueDate: answer.result.header.dueDate,
        orderReference: answer.result.header.orderReference,
        currencyCode: answer.result.header.currencyCode,
        subtotal: answer.result.header.subtotal,
        discountTotal: answer.result.header.discountTotal,
        vatAmount: answer.result.header.vatAmount,
        total: answer.result.header.total,
        confidence: answer.result.header.confidence,
        lines: answer.result.lines.map((line) => ({
          description: line.description,
          supplierSku: line.supplierSku,
          quantity: line.quantity,
          uom: line.uom,
          unitPrice: line.unitPrice,
          discount: line.discount,
          vatRatePercent: line.vatRatePercent,
          vatAmount: line.vatAmount,
          lineTotal: line.lineTotal,
        })),
      },
    },
  };
}
