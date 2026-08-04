/**
 * Application Service for the Report Designer — CRUD validation over
 * `report-definition-repository.ts`, plus the one safe calculated-field
 * evaluator every saved report's `calculatedFields` run through when a
 * report is rendered. Deliberately NOT `eval()`/`new Function()` — each
 * field is a single `left <op> right` expression where each operand is
 * either a numeric literal or another column's field name, resolved
 * against one report row at a time.
 */

import * as repo from "@/server/repositories/report-definition-repository";
import { REPORT_TYPES, type CalculatedField, type ReportDefinition } from "@/server/reporting/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listReportDefinitions = repo.listReportDefinitions;
export const getReportDefinition = repo.getReportDefinition;
export const deleteReportDefinition = repo.deleteReportDefinition;

export async function createReportDefinition(companyId: string, performedBy: string, input: repo.NewReportDefinition): Promise<ReportDefinition> {
  if (!input.name?.trim()) throw new ValidationError("Report name is required.");
  if (!REPORT_TYPES.includes(input.reportType)) throw new ValidationError(`Report Type must be one of: ${REPORT_TYPES.join(", ")}.`);
  if (input.columns.length === 0) throw new ValidationError("Select at least one column.");
  for (const field of input.calculatedFields) validateCalculatedField(field);

  return repo.createReportDefinition(companyId, { ...input, name: input.name.trim(), createdBy: performedBy });
}

function validateCalculatedField(field: CalculatedField): void {
  if (!field.name?.trim()) throw new ValidationError("Calculated field name is required.");
  if (!["+", "-", "*", "/"].includes(field.operator)) throw new ValidationError(`Unsupported calculated field operator: ${field.operator}.`);
  if (field.left === undefined || field.right === undefined) throw new ValidationError("Calculated field operands are required.");
}

/** Pure — resolves one operand against a report row: a numeric literal
 * if parseable, otherwise looked up as a field name (defaulting to 0 for
 * a missing/non-numeric value, never throwing on a malformed row). */
function resolveOperand(operand: string, row: Record<string, unknown>): number {
  const literal = Number(operand);
  if (!Number.isNaN(literal) && operand.trim() !== "") return literal;
  const value = Number(row[operand]);
  return Number.isFinite(value) ? value : 0;
}

/** Pure — applies every calculated field to one report row, returning a
 * new row with the calculated values merged in. Division by zero yields
 * 0 rather than Infinity/NaN, keeping report output always finite. */
export function evaluateCalculatedFields(row: Record<string, unknown>, fields: CalculatedField[]): Record<string, unknown> {
  const result = { ...row };
  for (const field of fields) {
    const left = resolveOperand(field.left, result);
    const right = resolveOperand(field.right, result);
    let value: number;
    switch (field.operator) {
      case "+":
        value = left + right;
        break;
      case "-":
        value = left - right;
        break;
      case "*":
        value = left * right;
        break;
      case "/":
        value = right === 0 ? 0 : left / right;
        break;
    }
    result[field.name] = Math.round(value * 100) / 100;
  }
  return result;
}
