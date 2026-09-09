/**
 * Phase 15 — builds the ONE, strict-allow-list `EvidencePackage` sent to
 * an LLM provider. Pure: takes data the caller already fetched from the
 * EXISTING intelligence layer (`getCompanyIntelligenceSummary`,
 * `buildBusinessSituations` — both unchanged from Phases 10-14) and
 * reshapes it into the minimal shape VYRON AI is allowed to see. Fetches
 * nothing itself, so it can never be the place a tenant-isolation bug
 * hides — by the time this function runs, the caller has already
 * resolved `companyId` through the authorized session/permission chain.
 */

import type { BusinessSituation, Finding } from "@/server/financial-intelligence/types";
import type { FinancialIntelligenceSummary } from "@/server/financial-intelligence/financial-intelligence-engine";
import type { EvidenceFinding, EvidencePackage, EvidenceSituation } from "./types";
export type { EvidencePackage } from "./types";

function toEvidenceFinding(f: Finding): EvidenceFinding {
  return {
    id: f.id,
    category: f.category,
    severity: f.severity,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
    recommendedAction: f.recommendedAction,
    actionHref: f.actionHref,
  };
}

function toEvidenceSituation(s: BusinessSituation): EvidenceSituation {
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    severity: s.severity,
    category: s.category,
    evidence: s.evidence,
    contributingFindingIds: s.contributingFindings.map((f) => f.id),
    recommendedActions: s.recommendedActions,
  };
}

export function intelligenceCentreHref(companyId: string): string {
  return `/company/${companyId}/intelligence`;
}

export function buildEvidencePackage(
  company: { id: string; name: string },
  question: string,
  asOfDate: string,
  summary: Pick<FinancialIntelligenceSummary, "findings" | "totalCash" | "netProfit">,
  situations: BusinessSituation[],
): EvidencePackage {
  return {
    companyId: company.id,
    companyName: company.name,
    asOfDate,
    question,
    findings: summary.findings.map(toEvidenceFinding),
    situations: situations.map(toEvidenceSituation),
    totalCash: summary.totalCash ?? null,
    netProfit: summary.netProfit ?? null,
    intelligenceCentreHref: intelligenceCentreHref(company.id),
  };
}
