/**
 * Phase 11 — VYRON Intelligence Centre. Pure, framework-free presentation
 * logic over the `Finding[]` the Financial Intelligence Engine (Phase
 * 10) already produced — no financial logic lives here, only how to
 * group/filter/label findings that already exist. Nothing here computes
 * a severity, a category, or evidence; it only reads them.
 */

import type { Finding, FindingCategory, FindingMetaGroup, FindingSource } from "@/server/financial-intelligence/types";
import { FINDING_CATEGORY_LABEL, FINDING_META_GROUP } from "@/server/financial-intelligence/types";

export const ALL_CATEGORIES = "All";
export type CategoryFilter = FindingCategory | typeof ALL_CATEGORIES;

/**
 * "Do not create categories that the engine does not support" (brief,
 * section 6) — only categories with at least one real finding, in the
 * order they first appear in the already-severity-sorted `findings`
 * array (so the most urgent category leads).
 */
export function distinctCategories(findings: Finding[]): FindingCategory[] {
  const seen = new Set<FindingCategory>();
  const order: FindingCategory[] = [];
  for (const f of findings) {
    if (!seen.has(f.category)) {
      seen.add(f.category);
      order.push(f.category);
    }
  }
  return order;
}

export function filterFindings(findings: Finding[], category: CategoryFilter): Finding[] {
  if (category === ALL_CATEGORIES) return findings;
  return findings.filter((f) => f.category === category);
}

/**
 * Data Quality findings get their own visual treatment (brief, section
 * 8) — split out here so the UI never has to re-derive which findings
 * are which, and the Priority Queue's category filter only ever applies
 * to the non-Data-Quality findings it's actually filtering.
 */
export function splitDataQuality(findings: Finding[]): { dataQuality: Finding[]; other: Finding[] } {
  return {
    dataQuality: findings.filter((f) => f.category === "DataQuality"),
    other: findings.filter((f) => f.category !== "DataQuality"),
  };
}

export function categoryLabel(category: FindingCategory): string {
  return FINDING_CATEGORY_LABEL[category];
}

/**
 * Phase 13, section 14 — "Make sure the centre can distinguish:
 * Financial Risk / Operational Attention / Data Quality." Data Quality
 * is already visually separated by `splitDataQuality`; this covers the
 * remaining distinction between Financial Risk and Operational
 * Attention among everything else. Pure lookup — see
 * `FINDING_META_GROUP` (financial-intelligence/types.ts) for the real
 * category -> group mapping.
 */
export function metaGroup(category: FindingCategory): FindingMetaGroup {
  return FINDING_META_GROUP[category];
}

/** Only the groups actually present among the given findings, in a
 * fixed, stable order — never invents a group with zero findings. */
export function distinctMetaGroups(findings: Finding[]): FindingMetaGroup[] {
  const present = new Set(findings.map((f) => metaGroup(f.category)));
  return (["Financial Risk", "Operational Attention", "Data Quality"] as FindingMetaGroup[]).filter((g) => present.has(g));
}

/** "The source of the finding must be transparent" (Phase 10, section
 * 7) — humanized for direct display, never the raw union value. */
export const FINDING_SOURCE_LABEL: Record<FindingSource, string> = {
  Deterministic: "Deterministic — computed directly from your data",
  Derived: "Derived — computed from an existing summary",
  ExistingIntelligenceSignal: "Existing Intelligence Signal — already detected elsewhere in VYRON",
};
