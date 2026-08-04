/**
 * Service layer for the Automation Audit Trail.
 */

import * as repo from "@/server/repositories/automation-audit-repository";

export const recordAuditEntry = repo.recordAuditEntry;
export const listAuditLog = repo.listAuditLog;
export const listAuditLogForDocument = repo.listAuditLogForDocument;
