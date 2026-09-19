/**
 * Phase 5L — supplier resolution for a captured invoice.
 *
 * Adapted from VYRON COST's `vyron-supplier-resolution.ts`, which is a good
 * piece of work that COST's own document pipeline never called — its
 * extraction path used a bare `ilike` on the supplier name and a
 * `.maybeSingle()` whose error was never read, so two suppliers sharing a
 * name silently became "no supplier at all".
 *
 * Two deliberate departures from COST:
 *
 *  1. **More signals, because Finance has them.** `ae_suppliers` carries a
 *     real `alternativeNames` array, `registrationNumber`, `supplierCode`
 *     and full bank details. COST had none of that on its document, and its
 *     one alias field was overwritten with a single-element array on every
 *     save, so it could never accumulate aliases.
 *  2. **Never a name string as an identity.** Everything downstream —
 *     learning, duplicate detection, history — keys on `supplierId`.
 *
 * THE RULE: a fuzzy match is a PROPOSAL. It is never applied. This module
 * cannot return a resolved supplier from a similarity score; that is
 * enforced by construction below, not by a caller remembering to check.
 */

import type { Supplier } from "@/server/accounting/types";
import type { SupplierMatchTier } from "./types";

/** Legal-form suffixes that carry no identity. Ordered longest-first so
 * "(pty) ltd" is stripped as a unit before "ltd". */
const LEGAL_SUFFIXES = [
  "proprietary limited", "pty limited", "pty ltd", "close corporation", "incorporated",
  "limited", "holdings", "group", "trading as", "trading", "enterprises", "ltd", "inc", "cc", "bk", "sa", "t/a",
];

/** Case-folded, whitespace-collapsed. The weakest normalisation, used for
 * an exact-name comparison that still survives typing differences. */
export function exactNameKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Punctuation, ampersands, articles and legal suffixes removed, so
 * "The Acme Foods (Pty) Ltd." and "Acme Foods" share a key. */
export function normalisedNameKey(value: string | null | undefined): string {
  let key = exactNameKey(value)
    .replace(/[.,()[\]{}'"`]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (key === suffix) break;
      if (key.endsWith(` ${suffix}`)) {
        key = key.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return key.replace(/\s+/g, " ").trim();
}

/** Registration and VAT numbers compared on their characters alone —
 * "4123456789" and "4123/456/789" are the same number. */
export function normalisedIdentifier(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Levenshtein distance, single working row. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}

/** Similarity in 0..1 over the normalised names. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalisedNameKey(a);
  const right = normalisedNameKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const longest = Math.max(left.length, right.length);
  return (longest - levenshtein(left, right)) / longest;
}

export const FUZZY_PROPOSAL_THRESHOLD = 0.86;
export const MAX_CANDIDATES = 5;

export type SupplierCandidate = {
  supplierId: number;
  supplierName: string;
  vatNumber: string;
  similarity: number;
  /** Why this supplier is being proposed, in words a reviewer can act on. */
  reason: string;
};

export type SupplierResolution =
  /** A deterministic identifier matched exactly one supplier. Safe to
   * pre-select; the reviewer can still change it. */
  | { outcome: "resolved"; supplierId: number; supplierName: string; tier: SupplierMatchTier; candidates: SupplierCandidate[] }
  /** Either several suppliers matched, or only a similarity score did.
   * A human must choose. NEVER auto-applied. */
  | { outcome: "ambiguous"; candidates: SupplierCandidate[]; reason: string }
  /** Nothing matched. The reviewer selects an existing supplier or creates
   * one through the ordinary supplier service. */
  | { outcome: "unmatched"; candidates: SupplierCandidate[] };

export type SupplierResolutionInput = {
  supplierName: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  /** A supplier this company has previously confirmed for this exact
   * normalised name — the "learned" tier. Deterministic, because a human
   * confirmed it; not a similarity score. */
  learnedSupplierId?: number | null;
};

/**
 * Resolves in strict order of how much the signal actually proves.
 *
 *   1 VAT number          a tax identity; unique per legal entity
 *   2 registration number a company identity
 *   3 supplier code       the company's own identifier for them
 *   4 exact name
 *   5 normalised name
 *   6 learned mapping     a human previously confirmed this name
 *   7 fuzzy               PROPOSAL ONLY — never resolved
 *
 * Tiers 1–3 are compared against the supplier's identifiers; tiers 4–5
 * against its name AND its `alternativeNames`, which is where a genuine
 * alias belongs.
 *
 * A tier matching MORE THAN ONE supplier is ambiguous, not resolved — it
 * means the master data has a duplicate, and picking one at random is how
 * an invoice gets billed to the wrong entity.
 */
export function resolveSupplier(input: SupplierResolutionInput, suppliers: Supplier[]): SupplierResolution {
  const active = suppliers.filter((s) => s.status !== "Inactive");
  const pool = active.length > 0 ? active : suppliers;

  const deterministic: { tier: SupplierMatchTier; matches: Supplier[] }[] = [];

  const vatKey = normalisedIdentifier(input.vatNumber);
  if (vatKey) {
    deterministic.push({ tier: "vat", matches: pool.filter((s) => normalisedIdentifier(s.vatNumber) === vatKey) });
  }

  const regKey = normalisedIdentifier(input.registrationNumber);
  if (regKey) {
    deterministic.push({ tier: "registration", matches: pool.filter((s) => normalisedIdentifier(s.registrationNumber) === regKey) });
  }

  // A supplier code is only a signal when the document happens to print
  // it; it arrives here as part of the name text in practice, so it is
  // matched exactly and case-insensitively against the code field.
  const nameText = exactNameKey(input.supplierName);
  if (nameText) {
    deterministic.push({
      tier: "supplier-code",
      matches: pool.filter((s) => s.supplierCode.trim() !== "" && exactNameKey(s.supplierCode) === nameText),
    });

    const exactKey = nameText;
    deterministic.push({
      tier: "exact-name",
      matches: pool.filter((s) => exactNameKey(s.name) === exactKey || s.alternativeNames.some((n) => exactNameKey(n) === exactKey)),
    });

    const normKey = normalisedNameKey(input.supplierName);
    if (normKey) {
      deterministic.push({
        tier: "normalised-name",
        matches: pool.filter(
          (s) => normalisedNameKey(s.name) === normKey || s.alternativeNames.some((n) => normalisedNameKey(n) === normKey),
        ),
      });
    }
  }

  if (input.learnedSupplierId) {
    deterministic.push({ tier: "learned", matches: pool.filter((s) => s.id === input.learnedSupplierId) });
  }

  for (const { tier, matches } of deterministic) {
    if (matches.length === 1) {
      return {
        outcome: "resolved",
        supplierId: matches[0].id,
        supplierName: matches[0].name,
        tier,
        candidates: [],
      };
    }
    if (matches.length > 1) {
      return {
        outcome: "ambiguous",
        candidates: toCandidates(matches, input.supplierName, `More than one supplier has this ${describeTier(tier)}.`),
        reason: `${matches.length} suppliers share this ${describeTier(tier)}. Choose the right one, or merge the duplicates first.`,
      };
    }
  }

  // Tier 7 — similarity. Proposals only. This branch cannot return
  // "resolved"; there is no code path from a score to a supplierId.
  const scored = pool
    .map((s) => ({ supplier: s, similarity: Math.max(nameSimilarity(input.supplierName, s.name), ...s.alternativeNames.map((n) => nameSimilarity(input.supplierName, n)), 0) }))
    .filter((c) => c.similarity >= FUZZY_PROPOSAL_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_CANDIDATES);

  if (scored.length > 0) {
    return {
      outcome: "ambiguous",
      candidates: scored.map((c) => ({
        supplierId: c.supplier.id,
        supplierName: c.supplier.name,
        vatNumber: c.supplier.vatNumber,
        similarity: Math.round(c.similarity * 1000) / 1000,
        reason: "The name is similar, but nothing on the document confirms it.",
      })),
      reason: "No identifier on this document matches a supplier. These have similar names — confirm which one, or create a new supplier.",
    };
  }

  return { outcome: "unmatched", candidates: [] };
}

function toCandidates(suppliers: Supplier[], extractedName: string | null, reason: string): SupplierCandidate[] {
  return suppliers.slice(0, MAX_CANDIDATES).map((s) => ({
    supplierId: s.id,
    supplierName: s.name,
    vatNumber: s.vatNumber,
    similarity: Math.round(nameSimilarity(extractedName, s.name) * 1000) / 1000,
    reason,
  }));
}

function describeTier(tier: SupplierMatchTier): string {
  return (
    {
      vat: "VAT number",
      registration: "registration number",
      "supplier-code": "supplier code",
      "exact-name": "name",
      "normalised-name": "name",
      learned: "previously confirmed mapping",
      manual: "selection",
    } as Record<SupplierMatchTier, string>
  )[tier];
}
