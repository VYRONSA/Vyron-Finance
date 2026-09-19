/**
 * Phase 5Q — the durable certification run.
 *
 * Phase 5P proved the pipeline works against a live provider, with one
 * call bounded by an in-process latch. A latch is enough for one call in
 * one process. It is not enough for twenty-four, because a second `node`
 * invocation gets a fresh one: run the script twice and you have spent
 * forty-eight calls with nothing to show that you did.
 *
 * So the ceiling moves into Postgres, where it survives the process.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *     No provider request happens unless a durable reservation succeeded
 *     first.
 *
 * Not "usually". Not "unless the database is down". If the ceiling cannot
 * be consulted then there is no ceiling, and a run with no ceiling does not
 * make calls. There is deliberately NO fallback to the in-process latch —
 * a fallback would turn the one condition that matters into a preference.
 *
 * WHAT IT REUSES, AND WHAT IT DOES NOT INVENT
 *
 * The ceiling is `ai_certification_runs` with `fn_ai_certification_open_run`
 * / `fn_ai_certification_reserve_call` / `fn_ai_certification_close_run`,
 * built and proven in Phase 5N — 40 concurrent connections against a
 * ceiling of 15 granted exactly 15. Nothing here reimplements counting.
 * The reservation is a single conditional UPDATE inside the database; this
 * file only asks.
 *
 * WHY A FAILED CALL STILL COSTS ITS RESERVATION
 *
 * The reservation is taken BEFORE the request and is never released. A
 * failed request reached the provider, took its time and may well have been
 * billed. Giving the allowance back would mean a run that fails twenty-four
 * times could keep going forever, which is precisely the runaway the
 * ceiling exists to stop.
 *
 * WHAT IT STILL CANNOT DO
 *
 * It writes no accounting data, creates no capture, no company and no task.
 * It imports no repository and no service. The only database rows it
 * touches are its own run's.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  reserveCertificationCall,
  type CertificationDb,
  type CertificationReservation,
} from "./certification-budget";
import { recordCertificationEvidence, type EvidenceRecord } from "./certification-evidence";
import { requireCountersignedCorpus } from "./countersign";
import { loadManifest, requireCertificationCase, requireVerifiedCorpus } from "./certification-corpus";
import { decideExtractionProvider, selectExtractionProvider } from "./provider-selection";
import { validateExtraction } from "./validation";
import type { ExtractionProvider } from "./extraction-provider";

/** One reservation per corpus document. Not a round number chosen for
 * comfort — it is the corpus size, and a test asserts they agree. */
export const CERTIFICATION_CALL_CEILING = 24;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export type CaseOutcome = {
  caseId: string;
  documentFile: string;
  documentSha256: string;
  /** The reservation that authorised this call. Always present: no case
   * reaches the provider without one. */
  reservation: { callsUsed: number; callCeiling: number };
  model: string | null;
  durationMs: number;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  result:
    | {
        succeeded: true;
        lineCount: number;
        declaredLineCount: number | null;
        validationStatus: string;
        findingCodes: string[];
        extracted: unknown;
      }
    | { succeeded: false; errorCategory: string; httpStatus: number | null; message: string };
};

export type RunRefusal = {
  ok: false;
  stage: "countersignature" | "corpus-integrity" | "provider-selection" | "no-company" | "no-database" | "run-not-open" | "not-confirmed";
  reason: string;
  providerRequests: 0;
};

export type RunReport = {
  ok: true;
  runId: number;
  corpusSha256: string;
  ceiling: number;
  /** Exactly how many provider requests were made. Never more than the
   * reservations granted. */
  providerRequests: number;
  outcomes: CaseOutcome[];
  /** Set when the run stopped before finishing the corpus. */
  stoppedEarly: { afterCases: number; reason: string } | null;
};

export type RunResult = RunReport | RunRefusal;

export type RunOptions = {
  /** The durable run, opened deliberately by an operator. */
  runId: number;
  /** The company the run belongs to. The evidence writer verifies it
   * matches the run, so a mismatched pair records nothing. */
  companyId: string;
  /** REQUIRED. Without it the run refuses — there is no in-process
   * fallback, by design. */
  db: CertificationDb | null;
  confirm: boolean;
  caseIds?: string[];
  corpusRoot?: string;
  provider?: ExtractionProvider;
  env?: Record<string, string | undefined>;
  /** Injected only by tests, so the reservation path itself can be faked
   * without a database. Defaults to the real one. */
  reserve?: (runId: number, db: CertificationDb) => Promise<CertificationReservation>;
  /** Injected only by tests, so the evidence path can be faked without a
   * database. Defaults to the real writer. */
  record?: (db: CertificationDb, evidence: EvidenceRecord) => Promise<{ recorded: boolean; reason?: string }>;
};

function refuse(stage: RunRefusal["stage"], reason: string): RunRefusal {
  return { ok: false, stage, reason, providerRequests: 0 };
}

export type PreconditionsOk = { ok: true; corpusSha256: string };

/**
 * The corpus and provider gates, in order, with nothing else.
 *
 * Exported so the CLI can run them BEFORE it opens a durable certification
 * run. Opening a run first would write a row describing an experiment that
 * never took place, and `ai_certification_runs` is meant to be a record of
 * what actually happened.
 *
 * Pure apart from reading the corpus off disk: it reserves nothing, opens
 * nothing and contacts no provider.
 */
export function verifyCertificationPreconditions(
  env: Record<string, string | undefined>,
  corpusRoot?: string,
): PreconditionsOk | RunRefusal {
  // 1. The answer keys must be independently countersigned.
  try {
    if (corpusRoot) requireCountersignedCorpus(corpusRoot);
    else requireCountersignedCorpus();
  } catch (error) {
    return refuse("countersignature", error instanceof Error ? error.message : String(error));
  }

  // 2. The corpus must be exactly what was reviewed.
  let corpusSha256: string;
  try {
    const manifest = corpusRoot ? requireVerifiedCorpus(corpusRoot) : requireVerifiedCorpus();
    corpusSha256 = manifest.corpusSha256;
  } catch (error) {
    return refuse("corpus-integrity", error instanceof Error ? error.message : String(error));
  }

  // 3. Provider selection, fail-closed, with no fallback.
  const decision = decideExtractionProvider(env);
  if (decision.provider !== "gateway") {
    return refuse("provider-selection", decision.reason);
  }

  return { ok: true, corpusSha256 };
}

/**
 * Runs the certification corpus, one reserved call at a time.
 *
 * Gates run once up front; the reservation runs per case, immediately
 * before that case's request. A refused reservation STOPS the run — it does
 * not skip the case and carry on, because the only reasons to be refused
 * are "the ceiling is spent" and "the ceiling cannot be reached", and
 * neither improves by trying the next document.
 */
export async function runCertificationCorpus(options: RunOptions): Promise<RunResult> {
  const env = options.env ?? process.env;
  const root = options.corpusRoot;
  const reserve = options.reserve ?? ((runId, db) => reserveCertificationCall(runId, db));
  const record = options.record ?? ((db, evidence) => recordCertificationEvidence(db, evidence));

  // 1-3. Every corpus and provider gate, in order. Exported separately so
  //       the CLI can run them BEFORE opening a durable run — opening a run
  //       against a corpus that then fails its gates would leave a row
  //       recording an experiment that never happened.
  const preconditions = verifyCertificationPreconditions(env, root);
  if (!preconditions.ok) return preconditions;
  const corpusSha256 = preconditions.corpusSha256;

  /*
   * 3a. The company must be named BEFORE anything is spent.
   *
   * Learned from run #62. The CLI is JavaScript and therefore outside
   * typechecking, so when `companyId` became required nothing caught its
   * absence. `undefined` was dropped from the RPC arguments, PostgREST
   * could not resolve the overload, and the failure surfaced only AFTER a
   * provider call had been made and its reservation spent. A required
   * argument discovered mid-run is a design fault, not a typo — so it is
   * checked here, where it costs nothing.
   */
  if (!options.companyId?.trim()) {
    return refuse(
      "no-company",
      "No company was named for this certification run. The evidence writer verifies the run belongs to a company, " +
        "so nothing could be recorded — refused before any provider request.",
    );
  }

  // 4. THE DURABLE CONTROL. No database, no run — and explicitly no
  //    falling back to an in-process counter.
  if (!options.db) {
    return refuse(
      "no-database",
      "No certification database is configured (VYRON_CERTIFICATION_SUPABASE_URL / VYRON_CERTIFICATION_SERVICE_ROLE_KEY). " +
        "The call ceiling cannot be enforced, so no provider request will be made. There is no in-process fallback.",
    );
  }

  const manifest = root ? loadManifest(root) : loadManifest();
  const caseIds = options.caseIds ?? manifest.cases.map((c) => c.caseId);

  if (options.confirm !== true) {
    return refuse(
      "not-confirmed",
      `Dry run: every gate passed and the run is ready to send ${caseIds.length} document(s) against run #${options.runId}. No request was made.`,
    );
  }

  const outcomes: CaseOutcome[] = [];
  const attempted = new Set<string>();
  let stoppedEarly: RunReport["stoppedEarly"] = null;
  const provider = options.provider ?? (await selectExtractionProvider(env));

  for (const caseId of caseIds) {
    // A case is attempted exactly once. There is no retry path here at
    // all, so a failure cannot come back for a second reservation.
    if (attempted.has(caseId)) {
      throw new Error(`Certification run attempted "${caseId}" twice. A case gets one reserved call and no retry.`);
    }
    attempted.add(caseId);

    const selected = root ? requireCertificationCase(caseId, root) : requireCertificationCase(caseId);
    const entry = manifest.cases.find((c) => c.caseId === caseId)!;
    const bytes = readFileSync(selected.documentPath);

    // Per-document hash, checked immediately before sending. The
    // corpus-wide check proves the set; this proves the file.
    const documentSha256 = createHash("sha256").update(bytes).digest("hex");
    if (documentSha256 !== entry.documentSha256) {
      stoppedEarly = { afterCases: outcomes.length, reason: `Document "${caseId}" does not match the manifest. Run stopped.` };
      break;
    }

    const mimeType = MIME_BY_EXTENSION[selected.documentFile.slice(selected.documentFile.lastIndexOf(".")).toLowerCase()];
    if (!mimeType) {
      stoppedEarly = { afterCases: outcomes.length, reason: `No supported media type for "${selected.documentFile}". Run stopped.` };
      break;
    }

    // THE RESERVATION. Before the request, always. If this does not
    // succeed, nothing is sent — for this case or any that follow.
    const reservation = await reserve(options.runId, options.db);
    if (!reservation.reserved) {
      stoppedEarly = {
        afterCases: outcomes.length,
        reason: `Reservation refused before "${caseId}": ${reservation.reason} (${reservation.callsUsed}/${reservation.callCeiling} used). No request was made.`,
      };
      break;
    }

    const started = Date.now();
    const answer = await provider.extract({ bytes: new Uint8Array(bytes), mimeType });
    const durationMs = Date.now() - started;

    const base = {
      caseId,
      documentFile: selected.documentFile,
      documentSha256,
      reservation: { callsUsed: reservation.callsUsed, callCeiling: reservation.callCeiling },
      durationMs,
    };

    if (!answer.ok) {
      // The reservation is NOT given back. A failed request is a spent
      // request.
      const outcome: CaseOutcome = {
        ...base,
        model: answer.model,
        usage: null,
        result: { succeeded: false, errorCategory: answer.category, httpStatus: answer.httpStatus, message: answer.message },
      };

      // Record the failure before stopping. A run that ends with nothing
      // written cannot be reviewed, and a provider failure is itself a
      // certification result worth keeping.
      const failureEvidence = await record(options.db, {
        runId: options.runId,
        companyId: options.companyId,
        caseId,
        corpusSha256,
        documentFile: selected.documentFile,
        documentSha256,
        outcome: "provider_error",
        model: answer.model,
        callsUsed: reservation.callsUsed,
        callCeiling: reservation.callCeiling,
        durationMs,
        usage: null,
        errorCategory: answer.category,
        httpStatus: answer.httpStatus,
        providerMessage: answer.message,
        extracted: null,
        validationStatus: null,
        validationFindings: [],
        lineCount: null,
        declaredLineCount: null,
      });

      outcomes.push(outcome);
      if (!failureEvidence.recorded) {
        stoppedEarly = {
          afterCases: outcomes.length,
          reason: `Provider failure on "${caseId}", and the evidence could not be recorded: ${failureEvidence.reason ?? "unknown"}. Run stopped.`,
        };
        break;
      }
      // A provider failure STOPS the run permanently. Carrying on would
      // send the remaining documents into a provider that has already
      // refused one — the behaviour the extraction sweep avoids, and the
      // behaviour that had VYRON COST re-asking the same documents every
      // two minutes. The failure is itself a certification result.
      stoppedEarly = {
        afterCases: outcomes.length,
        reason: `Provider failure on "${caseId}" (${answer.category}${answer.httpStatus ? ` ${answer.httpStatus}` : ""}). Run stopped; no retry.`,
      };
      break;
    }

    const report = validateExtraction(answer.result);

    /*
     * PERSIST BEFORE CONTINUING.
     *
     * The reservation is already spent and the call already paid for. If
     * this answer cannot be written down, the remaining ceiling would be
     * spent producing results nobody can score — which is exactly how run
     * #47 ended up unscoreable. So a failure to record stops the run.
     */
    const evidence = await record(options.db, {
      runId: options.runId,
      companyId: options.companyId,
      caseId,
      corpusSha256,
      documentFile: selected.documentFile,
      documentSha256,
      outcome: "extracted",
      model: answer.model,
      callsUsed: reservation.callsUsed,
      callCeiling: reservation.callCeiling,
      durationMs,
      usage: answer.usage ?? null,
      errorCategory: null,
      httpStatus: null,
      providerMessage: null,
      // The whole ExtractionResult — header, every line, the lot. This is
      // the field that makes field-by-field scoring possible later.
      extracted: answer.result,
      validationStatus: report.status,
      validationFindings: report.findings,
      lineCount: answer.result.lines.length,
      declaredLineCount: answer.result.declaredLineCount,
    });

    outcomes.push({
      ...base,
      model: answer.model,
      usage: answer.usage ?? null,
      result: {
        succeeded: true,
        lineCount: answer.result.lines.length,
        declaredLineCount: answer.result.declaredLineCount,
        validationStatus: report.status,
        findingCodes: report.findings.map((f) => f.code),
        extracted: answer.result,
      },
    });

    if (!evidence.recorded) {
      stoppedEarly = {
        afterCases: outcomes.length,
        reason: `Evidence for "${caseId}" could not be recorded: ${evidence.reason ?? "unknown"}. Run stopped — a run that cannot record itself must not keep spending.`,
      };
      break;
    }
  }

  return {
    ok: true,
    runId: options.runId,
    corpusSha256,
    ceiling: CERTIFICATION_CALL_CEILING,
    // One request per outcome, because a case only produces an outcome
    // after its reservation was granted and the call was made.
    providerRequests: outcomes.length,
    outcomes,
    stoppedEarly,
  };
}
