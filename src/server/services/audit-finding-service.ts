/**
 * Application Service for Audit Findings — thin pass-through over
 * `audit-finding-repository.ts`; the interesting logic (detection,
 * idempotency) lives in the repository and `audit-test-service.ts`/
 * `audit-intelligence-service.ts`.
 */

import * as repo from "@/server/repositories/audit-finding-repository";
import type { AuditFinding } from "@/server/audit/types";

export const listAuditFindings = repo.listAuditFindings;

export async function reviewFinding(companyId: string, findingId: number, status: "Reviewed" | "Dismissed", reviewedBy: string, note: string): Promise<AuditFinding> {
  return repo.reviewFinding(companyId, findingId, status, reviewedBy, note);
}
