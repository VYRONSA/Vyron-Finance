/**
 * Phase 5Q.6 — recording certification evidence.
 *
 * Certification run #47 made 24 provider calls and kept every answer in
 * memory. The summary printed; the payloads did not survive the process.
 * Scoring that run field-by-field is now impossible without paying for 24
 * more calls. This module exists so that cannot happen twice.
 *
 * WHAT IT WRITES, AND WHERE IT CANNOT WRITE
 *
 * One row per case in `ai_certification_evidence`, whose only foreign key
 * is to the certification run. It creates no capture, no bill, no journal
 * and no task — see migration 0110 for why `ai_extraction_attempts` was
 * examined and rejected for this purpose.
 *
 * FAIL CLOSED, AND STOP
 *
 * If the evidence cannot be recorded, the run must stop. The reservation
 * has already been consumed and the call already paid for; continuing
 * would spend the rest of the ceiling producing results nobody can score,
 * which is precisely how #47 ended up unscoreable. A run that cannot
 * record itself has no reason to continue.
 */

import type { CertificationDb } from "./certification-budget";

export type EvidenceRecord = {
  runId: number;
  companyId: string;
  caseId: string;
  corpusSha256: string;
  documentFile: string;
  documentSha256: string;
  outcome: "extracted" | "provider_error";
  model: string | null;
  callsUsed: number | null;
  callCeiling: number | null;
  durationMs: number | null;
  usage: unknown;
  errorCategory: string | null;
  httpStatus: number | null;
  /** Already sanitised at the provider boundary. */
  providerMessage: string | null;
  /** The complete ExtractionResult, or null when the provider failed. */
  extracted: unknown;
  validationStatus: string | null;
  validationFindings: unknown;
  lineCount: number | null;
  declaredLineCount: number | null;
};

export type EvidenceResult =
  | { recorded: true; evidenceId: number }
  | { recorded: false; reason: string };

/** One recorded row, as the scorer reads it back. */
export type StoredEvidence = {
  id: number;
  certification_run_id: number;
  company_id: string;
  corpus_case_id: string;
  corpus_sha256: string;
  document_file: string;
  document_sha256: string;
  model: string | null;
  calls_used_at_reservation: number | null;
  call_ceiling: number | null;
  duration_ms: number | null;
  usage: unknown;
  outcome: "extracted" | "provider_error";
  error_category: string | null;
  http_status: number | null;
  provider_message: string | null;
  extracted: unknown;
  validation_status: string | null;
  validation_findings: unknown;
  line_count: number | null;
  declared_line_count: number | null;
};

/**
 * Reads back one run's evidence.
 *
 * Through a function, not a table read. The table has RLS on, every grant
 * revoked and no policy — which is what keeps it out of the application's
 * reach, and also means PostgREST cannot SELECT it at all. That was found
 * by running the writer end to end: the insert succeeded and every read
 * came back empty. Reading is therefore a security-definer function too.
 */
export async function readCertificationEvidence(db: CertificationDb, runId: number): Promise<StoredEvidence[]> {
  const { data, error } = await db.rpc("fn_ai_certification_read_evidence", { p_run_id: runId });
  if (error) throw error;
  return (data ?? []) as StoredEvidence[];
}

/**
 * Records one case's evidence.
 *
 * Returns a result rather than throwing, so the caller decides what a
 * failure means — and the caller stops. A thrown error here would be
 * caught by whatever `try` happened to be in scope, which is how a
 * "must stop" condition quietly becomes a logged warning.
 */
export async function recordCertificationEvidence(
  db: CertificationDb,
  record: EvidenceRecord,
): Promise<EvidenceResult> {
  try {
    const { data, error } = await db.rpc("fn_ai_certification_record_evidence", {
      p_run_id: record.runId,
      p_company_id: record.companyId,
      p_case_id: record.caseId,
      p_corpus_sha256: record.corpusSha256,
      p_document_file: record.documentFile,
      p_document_sha256: record.documentSha256,
      p_outcome: record.outcome,
      p_model: record.model,
      p_calls_used: record.callsUsed,
      p_call_ceiling: record.callCeiling,
      p_duration_ms: record.durationMs,
      p_usage: record.usage ?? null,
      p_error_category: record.errorCategory,
      p_http_status: record.httpStatus,
      p_provider_message: record.providerMessage,
      p_extracted: record.extracted ?? null,
      p_validation_status: record.validationStatus,
      p_validation_findings: record.validationFindings ?? [],
      p_line_count: record.lineCount,
      p_declared_line_count: record.declaredLineCount,
    });
    if (error) throw error;

    const evidenceId = Number(data);
    if (!Number.isFinite(evidenceId) || evidenceId <= 0) {
      return { recorded: false, reason: `Evidence for "${record.caseId}" returned no id. Nothing was recorded.` };
    }
    return { recorded: true, evidenceId };
  } catch (error) {
    // Deliberately generic: a database error can carry connection detail,
    // and the caller only needs to know it failed and must stop.
    const detail = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "unknown error");
    return { recorded: false, reason: `Evidence for "${record.caseId}" could not be recorded: ${detail}` };
  }
}
