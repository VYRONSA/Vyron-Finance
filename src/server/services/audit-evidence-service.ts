/**
 * Application Service for the Working Paper Integration / drill-through
 * requirement — "every figure in the financial statements must support
 * drill-through to... Audit Working Paper → Audit Finding." Fetches the
 * real, already-persisted `audit_findings`/`audit_working_papers` (no
 * new detector) and applies the pure filters in
 * `audit-trail-link-engine.ts` to surface exactly which of them concern
 * a given General Ledger account.
 */

import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listAuditWorkingPapers } from "@/server/services/audit-working-paper-service";
import { findRelatedAuditFindings, findRelatedWorkingPapers } from "@/server/reporting/audit-trail-link-engine";
import type { AuditFinding, AuditWorkingPaper } from "@/server/audit/types";

export type AuditEvidenceForAccount = { findings: AuditFinding[]; workingPapers: AuditWorkingPaper[] };

export async function getAuditEvidenceForAccount(companyId: string, accountId: number, accountCode: string): Promise<AuditEvidenceForAccount> {
  const [findings, workingPapers] = await Promise.all([listAuditFindings(companyId), listAuditWorkingPapers(companyId)]);
  return {
    findings: findRelatedAuditFindings(findings, { accountId }),
    workingPapers: findRelatedWorkingPapers(workingPapers, accountCode),
  };
}
