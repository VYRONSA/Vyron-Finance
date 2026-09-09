/**
 * Pure drill-through helpers — no Supabase. "Every figure in the
 * financial statements must support drill-through to: Financial
 * Statement → Disclosure Note → General Ledger → Journal → Business
 * Event → Source Document → Audit Working Paper → Audit Finding." The
 * first five links already exist (a statement line already carries its
 * `accountId`; the General Ledger's Account Activity page already lists
 * every GL transaction with its Journal, and each Journal already
 * carries `sourceType`/`sourceId` — the Business Event/Source Document —
 * see `journal-workflow-service.ts`). This file closes the last two
 * links honestly, over data that already exists: `audit_findings`
 * already tags itself with a real `relatedType`/`relatedId` (see
 * `audit-tests-engine.ts`), and `audit_working_papers`' own generated
 * `content` already carries real account codes (Lead Schedule sections,
 * Supporting Schedule/Account Analysis headers) — nothing here is a new
 * detector, only a real filter over data that was already produced.
 */

import type { AuditFinding, AuditWorkingPaper } from "@/server/audit/types";

export type AuditEvidenceMatch = { accountId?: number; journalId?: number; glTransactionId?: number };

/** Findings whose own `relatedType`/`relatedId` (set at detection time by
 * `audit-tests-engine.ts`/`audit-intelligence-service.ts`) point at this
 * account, journal, or GL transaction. */
export function findRelatedAuditFindings(findings: AuditFinding[], match: AuditEvidenceMatch): AuditFinding[] {
  return findings.filter((f) => {
    if (f.relatedId === null || f.relatedType === null) return false;
    if (match.accountId !== undefined && f.relatedType === "chart_of_account" && f.relatedId === match.accountId) return true;
    if (match.journalId !== undefined && f.relatedType === "journal" && f.relatedId === match.journalId) return true;
    if (match.glTransactionId !== undefined && f.relatedType === "gl_transaction" && f.relatedId === match.glTransactionId) return true;
    return false;
  });
}

type LeadScheduleSection = { lines?: { accountCode?: unknown }[] };

/** Working papers whose already-generated `content` genuinely references
 * this account code — a Supporting Schedule/Account Analysis's own
 * header field, or a Lead Schedule's line-item breakdown. */
export function findRelatedWorkingPapers(papers: AuditWorkingPaper[], accountCode: string): AuditWorkingPaper[] {
  if (!accountCode) return [];
  return papers.filter((p) => {
    const content = p.content as { accountCode?: unknown; sections?: unknown };
    if (typeof content.accountCode === "string" && content.accountCode === accountCode) return true;
    if (Array.isArray(content.sections)) {
      return (content.sections as LeadScheduleSection[]).some((s) => Array.isArray(s.lines) && s.lines.some((l) => l.accountCode === accountCode));
    }
    return false;
  });
}
