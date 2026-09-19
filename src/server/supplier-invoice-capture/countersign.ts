/**
 * Phase 5O — the countersignature gate.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 * The 24 answer keys were authored by the same system that will later be
 * measured against them. An accuracy figure produced from an uncountersigned
 * corpus is partly marking its own homework, and the number would look
 * exactly as convincing either way. So live certification is gated on a
 * second, independent reader having agreed with each key.
 *
 * THE SIGNATURE IS BOUND TO THE CORPUS HASH
 *
 * A countersignature records the `corpusSha256` it was given for. Change one
 * byte of one document or one answer key and every signature becomes void,
 * because it was about different bytes. That is deliberate: a sign-off that
 * survived an edit would be worse than none, since it would carry authority
 * it had not earned.
 *
 * A DISCREPANCY IS A RESULT, NOT A FAILURE
 *
 * A reviewer who disagrees with a key records it. That blocks certification
 * until the disagreement is resolved by a human — either the key is corrected
 * (which changes the hash and voids every signature, so the corpus is
 * re-reviewed) or the reviewer withdraws the objection. Nothing here resolves
 * a discrepancy automatically, and nothing downgrades one to a warning.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_ROOT, loadManifest, verifyCorpusIntegrity } from "./certification-corpus";

export type CountersignStatus = "pending" | "agreed" | "discrepancy";

export type CaseCountersignature = {
  status: CountersignStatus;
  reviewedBy: string | null;
  reviewedOn: string | null;
  checks: Record<string, boolean>;
  discrepancies: { field: string; originalValue: string; correctedValue: string; reason: string }[];
  notes: string;
};

export type CountersignatureFile = {
  corpusSha256: string;
  reviewedBy: string | null;
  reviewedOn: string | null;
  cases: Record<string, CaseCountersignature>;
};

/** The six confirmations the review pack asks for. A signature that does not
 * carry all six is incomplete, however it was produced. */
export const REQUIRED_CHECKS = [
  "supplierIdentity",
  "documentIdentity",
  "lineItems",
  "totals",
  "absenceSemantics",
  "expectations",
] as const;

export function loadCountersignatures(root: string = CORPUS_ROOT): CountersignatureFile {
  const path = join(root, "countersignatures.json");
  if (!existsSync(path)) {
    throw new Error(`No countersignature file at ${path}. Build the review pack with scripts/build-countersign-pack.mjs.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as CountersignatureFile;
}

export type CountersignReport = {
  /** True only when every case is agreed, by a named reviewer, against the
   * corpus as it stands right now. */
  complete: boolean;
  corpusSha256: string;
  signedAgainst: string;
  /** False when the corpus has changed since it was signed. */
  boundToCurrentCorpus: boolean;
  total: number;
  agreed: number;
  pending: number;
  discrepancies: number;
  reviewedBy: string | null;
  reviewedOn: string | null;
  /** Why certification is blocked, in the order a person should act on. */
  blockers: string[];
};

/**
 * Reports the state of the countersignature without deciding anything.
 *
 * Returns a report rather than throwing so a pre-flight can PRINT what is
 * outstanding. `requireCountersignedCorpus` is the throwing version and is
 * what the certification run itself must call.
 */
export function countersignReport(root: string = CORPUS_ROOT): CountersignReport {
  const manifest = loadManifest(root);
  const signatures = loadCountersignatures(root);
  const blockers: string[] = [];

  const integrity = verifyCorpusIntegrity(root);
  if (!integrity.ok) {
    blockers.push(`The corpus does not match its manifest (${integrity.problems.length} problem(s)). Certification cannot proceed on an unverified corpus.`);
  }

  const boundToCurrentCorpus = signatures.corpusSha256 === manifest.corpusSha256;
  if (!boundToCurrentCorpus) {
    blockers.push(
      `The countersignature was given for corpus ${signatures.corpusSha256.slice(0, 16)}…, but the corpus is now ` +
        `${manifest.corpusSha256.slice(0, 16)}…. The corpus changed after review, so every signature is void and the corpus must be re-reviewed.`,
    );
  }

  let agreed = 0;
  let pending = 0;
  let discrepancies = 0;
  const incomplete: string[] = [];

  for (const entry of manifest.cases) {
    const signature = signatures.cases?.[entry.caseId];
    if (!signature || signature.status === "pending") {
      pending += 1;
      continue;
    }
    if (signature.status === "discrepancy") {
      discrepancies += 1;
      continue;
    }
    // An "agreed" signature still has to be a real one.
    const missingChecks = REQUIRED_CHECKS.filter((check) => signature.checks?.[check] !== true);
    if (missingChecks.length > 0) {
      incomplete.push(`${entry.caseId} (unconfirmed: ${missingChecks.join(", ")})`);
      pending += 1;
      continue;
    }
    if (!signature.reviewedBy?.trim()) {
      incomplete.push(`${entry.caseId} (no reviewer named)`);
      pending += 1;
      continue;
    }
    agreed += 1;
  }

  if (pending > 0) {
    blockers.push(`${pending} of ${manifest.cases.length} answer keys are not yet independently countersigned.`);
  }
  if (incomplete.length > 0) {
    blockers.push(`Marked agreed but incomplete: ${incomplete.join("; ")}.`);
  }
  if (discrepancies > 0) {
    blockers.push(
      `${discrepancies} case(s) have a recorded discrepancy. A human must resolve each one — either correct the answer key ` +
        `(which changes the corpus hash and requires a fresh review) or withdraw the objection. Nothing resolves these automatically.`,
    );
  }
  if (!signatures.reviewedBy?.trim()) {
    blockers.push("The countersignature names no reviewer. An unattributed sign-off is not a sign-off.");
  }

  return {
    complete: blockers.length === 0,
    corpusSha256: manifest.corpusSha256,
    signedAgainst: signatures.corpusSha256,
    boundToCurrentCorpus,
    total: manifest.cases.length,
    agreed,
    pending,
    discrepancies,
    reviewedBy: signatures.reviewedBy ?? null,
    reviewedOn: signatures.reviewedOn ?? null,
    blockers,
  };
}

/**
 * The gate. Phase 5P pre-flight must pass through this before a provider is
 * contacted.
 *
 * Throws with every blocker named, because a person reading the failure needs
 * to know what to do, not merely that they cannot proceed.
 */
export function requireCountersignedCorpus(root: string = CORPUS_ROOT): CountersignReport {
  const report = countersignReport(root);
  if (!report.complete) {
    throw new Error(
      `The certification corpus is not independently countersigned. Live certification refused.\n` +
        report.blockers.map((b) => `  - ${b}`).join("\n"),
    );
  }
  return report;
}
