/**
 * Application Service for reusable Auditor Queries — evaluates a saved
 * `AuditQueryDefinition` against the same GL/journal/bank repositories
 * every other module already reads. No new query engine; conditions are
 * simple field/operator/value comparisons, deterministic and safe (no
 * `eval()`), same discipline as the Report Designer's calculated fields.
 */

import { listJournals } from "@/server/services/journal-workflow-service";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import * as repo from "@/server/repositories/audit-query-repository";
import type { AuditQuery, AuditQueryCondition, AuditQueryDefinition } from "@/server/audit/types";

export class ValidationError extends Error {}

export const listAuditQueries = repo.listAuditQueries;
export const deleteAuditQuery = repo.deleteAuditQuery;

export async function createAuditQuery(companyId: string, performedBy: string, input: repo.NewAuditQuery): Promise<AuditQuery> {
  if (!input.name?.trim()) throw new ValidationError("Query name is required.");
  if (input.queryDefinition.conditions.length === 0) throw new ValidationError("At least one condition is required.");
  return repo.createAuditQuery(companyId, { ...input, name: input.name.trim(), createdBy: performedBy });
}

function dayOfWeekUtc(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay();
}

/** Pure — evaluates one condition against one record. */
export function evaluateCondition(record: Record<string, unknown>, condition: AuditQueryCondition): boolean {
  const fieldValue = record[condition.field];
  switch (condition.operator) {
    case "gt":
      return typeof fieldValue === "number" && fieldValue > Number(condition.value);
    case "gte":
      return typeof fieldValue === "number" && fieldValue >= Number(condition.value);
    case "lt":
      return typeof fieldValue === "number" && fieldValue < Number(condition.value);
    case "lte":
      return typeof fieldValue === "number" && fieldValue <= Number(condition.value);
    case "eq":
      return fieldValue === condition.value;
    case "neq":
      return fieldValue !== condition.value;
    case "isWeekend":
      return typeof fieldValue === "string" && [0, 6].includes(dayOfWeekUtc(fieldValue));
    case "isTrue":
      return Boolean(fieldValue);
    case "isFalse":
      return !fieldValue;
    default:
      return false;
  }
}

/** Pure — a record matches only if it satisfies EVERY condition (AND). */
export function evaluateQuery(records: Record<string, unknown>[], definition: AuditQueryDefinition): Record<string, unknown>[] {
  return records.filter((r) => definition.conditions.every((c) => evaluateCondition(r, c)));
}

export async function runAuditQuery(companyId: string, definition: AuditQueryDefinition, periodStart: string, periodEnd: string): Promise<Record<string, unknown>[]> {
  if (definition.source === "journals") {
    const journals = await listJournals(companyId);
    const records = journals
      .filter((j) => j.journalDate >= periodStart && j.journalDate <= periodEnd)
      .map((j) => ({ id: j.id, journalNumber: j.journalNumber, journalDate: j.journalDate, sourceType: j.sourceType, amount: Math.max(j.totalDebit, j.totalCredit), status: j.status }));
    return evaluateQuery(records, definition);
  }
  if (definition.source === "glTransactions") {
    const result = await listGlTransactionsInRange(companyId, periodStart, periodEnd);
    const records = result.transactions.map((t) => ({ id: t.id, postingDate: t.postingDate, accountCode: t.accountCode, amount: Math.max(t.debit, t.credit), journalNumber: t.journalNumber, sourceType: t.sourceType }));
    return evaluateQuery(records, definition);
  }
  const result = await listTransactionsForExport(companyId, {
    search: null, dateFrom: periodStart, dateTo: periodEnd, minAmount: null, maxAmount: null, statuses: null,
    bankAccountId: null, importBatch: null, duplicateOnly: false, unknownSupplierOnly: false, sortBy: "transactionDate", sortDirection: "desc",
  });
  const records = result.transactions.map((t) => ({ id: t.id, transactionDate: t.transactionDate, beneficiary: t.beneficiary, amount: Math.max(t.debit, t.credit), allocationStatus: t.allocationStatus }));
  return evaluateQuery(records, definition);
}
