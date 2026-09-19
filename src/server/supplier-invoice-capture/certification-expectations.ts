/**
 * Phase 5Q.7 — resolving what each case is expected to do.
 *
 * WHY THERE ARE TWO SOURCES
 *
 * The frozen answer keys conflate two different kinds of claim:
 *
 *   FACTS ABOUT THE DOCUMENT — "the page prints net 1 000.00, VAT 165.00".
 *     A human read the page and verified this. It is permanently true and
 *     must never change.
 *
 *   A SPECIFICATION OF SYSTEM BEHAVIOUR — "the validator should emit
 *     `totals-mismatch`". That was never a fact. It was wrong the moment
 *     it was written, because no such finding has ever existed.
 *
 * Only the second can be defective, and correcting it by editing the key
 * would change the corpus hash — voiding all 24 countersignatures and
 * detaching certification run #47 from the corpus it names. So the
 * correction lives in `expectations-v2.json`, which overrides behaviour
 * for named cases and touches no document and no answer key.
 *
 * FAIL CLOSED. The override file names the corpus SHA it applies to. If
 * that does not match the corpus on disk, the overrides are refused
 * outright rather than applied to a corpus nobody checked them against.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_ROOT, loadGroundTruth, loadManifest } from "./certification-corpus";

export type ExpectationClassification =
  /** The key named a finding that cannot exist, or got the behaviour wrong. */
  | "answer-key-defect"
  /** The owner settled a policy question and the expectation follows it. */
  | "policy-decision"
  /** The model was right and the key did not anticipate it. */
  | "legitimate-model-output";

export type ExpectationOverride = {
  validationFindings: string[];
  supersedes: string[];
  classification: ExpectationClassification;
  reason: string;
};

export type ExpectationsV2 = {
  version: number;
  authoredOn: string;
  authoredBy: string;
  appliesToCorpusSha256: string;
  overrides: Record<string, ExpectationOverride>;
  knownLimitations?: string[];
};

export type ResolvedExpectation = {
  caseId: string;
  validationFindings: string[];
  /** True when v2 changed this case. */
  overridden: boolean;
  /** Present only when overridden — what the frozen key said, and why it
   * was superseded. */
  original?: string[];
  classification?: ExpectationClassification;
  reason?: string;
};

export function loadExpectationsV2(root: string = CORPUS_ROOT): ExpectationsV2 | null {
  const path = join(root, "expectations-v2.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ExpectationsV2;
}

/**
 * Resolves every case's expected validation findings.
 *
 * The frozen key is the default; v2 overrides only the cases it names.
 * A case absent from v2 is untouched — which is the point of a
 * changed-cases-only override rather than a replacement copy that would
 * drift from the original.
 */
export function resolveExpectations(root: string = CORPUS_ROOT): ResolvedExpectation[] {
  const manifest = loadManifest(root);
  const v2 = loadExpectationsV2(root);

  if (v2 && v2.appliesToCorpusSha256 !== manifest.corpusSha256) {
    throw new Error(
      `expectations-v2.json applies to corpus ${v2.appliesToCorpusSha256.slice(0, 16)}…, but the corpus is ` +
        `${manifest.corpusSha256.slice(0, 16)}…. The overrides were written against a different corpus and are refused.`,
    );
  }

  return manifest.cases.map((entry) => {
    const truth = loadGroundTruth(entry.caseId, root);
    const original = truth.expected.validationFindings;
    const override = v2?.overrides?.[entry.caseId];

    if (!override) {
      return { caseId: entry.caseId, validationFindings: original, overridden: false };
    }
    return {
      caseId: entry.caseId,
      validationFindings: override.validationFindings,
      overridden: true,
      original,
      classification: override.classification,
      reason: override.reason,
    };
  });
}

/** One case's expectation, or throws if the case is unknown. */
export function expectationFor(caseId: string, root: string = CORPUS_ROOT): ResolvedExpectation {
  const found = resolveExpectations(root).find((e) => e.caseId === caseId);
  if (!found) throw new Error(`No expectation for certification case "${caseId}".`);
  return found;
}
