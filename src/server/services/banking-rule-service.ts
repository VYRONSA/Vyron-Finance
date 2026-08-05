/**
 * Service layer for the platform's ONE Rule Engine (Automation Rules) —
 * validation and CSV import/export on top of the repository, same shape
 * as `posting-rule-service.ts`. Built for Banking (Module 6); extended
 * with a `domain` dimension for the Automation Platform (Module 7) — see
 * `automation-rule-domains.ts` for what each domain's rule types/fields/
 * actions actually are.
 */

import * as repo from "@/server/repositories/banking-rule-repository";
import { cleanText, isBlankRow, normalizeHeader, parseCsvText } from "@/server/import-centre/csv-utils";
import { simulateRuleAgainstTransactions, testRuleAgainstRecord, type EvaluableRecord, type RuleTestResult } from "@/server/banking-rules/rule-engine";
import { DOMAIN_ACTION_TYPES, DOMAIN_CONDITION_FIELDS, DOMAIN_RULE_TYPES } from "@/server/banking-rules/automation-rule-domains";
import { buildRuleAnalytics, buildRuleHistory, compareRuleAnalytics, type RuleAnalyticsEntry, type RuleApplicationOutcome } from "@/server/banking-rules/rule-analytics-engine";
import { detectRuleConflicts, type RuleConflict } from "@/server/banking-rules/conflict-detection";
import {
  CONDITION_OPERATORS,
  RULE_DOMAINS,
  type ActionType,
  type BankingRule,
  type ConditionField,
  type ConditionOperator,
  type RuleDomain,
} from "@/server/banking-rules/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export function validateRuleShape(input: { domain: string; ruleType: string; name: string; conditions: { field: string; operator: string }[]; actions: { actionType: string }[] }): void {
  if (!RULE_DOMAINS.includes(input.domain as RuleDomain)) {
    throw new ValidationError(`Invalid domain "${input.domain}" — expected one of ${RULE_DOMAINS.join(", ")}.`);
  }
  const domain = input.domain as RuleDomain;
  const validRuleTypes = DOMAIN_RULE_TYPES[domain];
  if (!validRuleTypes.includes(input.ruleType)) {
    throw new ValidationError(`Invalid rule type "${input.ruleType}" for domain ${domain} — expected one of ${validRuleTypes.join(", ")}.`);
  }
  if (!input.name?.trim()) throw new ValidationError("Rule name is required.");
  if (input.conditions.length === 0) throw new ValidationError("A rule needs at least one condition.");
  if (input.actions.length === 0) throw new ValidationError("A rule needs at least one action.");
  const validFields = DOMAIN_CONDITION_FIELDS[domain];
  const validActions = DOMAIN_ACTION_TYPES[domain];
  for (const c of input.conditions) {
    if (!validFields.includes(c.field)) throw new ValidationError(`Invalid condition field "${c.field}" for domain ${domain} — expected one of ${validFields.join(", ")}.`);
    if (!CONDITION_OPERATORS.includes(c.operator as ConditionOperator)) throw new ValidationError(`Invalid condition operator "${c.operator}".`);
  }
  for (const a of input.actions) {
    if (!validActions.includes(a.actionType)) throw new ValidationError(`Invalid action type "${a.actionType}" for domain ${domain} — expected one of ${validActions.join(", ")}.`);
  }
}

export const listBankingRules = repo.listBankingRules;
export const getBankingRule = repo.getBankingRule;
export const listBankingRuleVersions = repo.listBankingRuleVersions;
export const listRuleApplicationsSince = repo.listRuleApplicationsSince;

export async function createBankingRule(companyId: string, input: repo.NewBankingRule): Promise<BankingRule> {
  validateRuleShape(input);
  return repo.createBankingRule(companyId, { ...input, name: input.name.trim() });
}

export async function updateBankingRule(
  companyId: string,
  ruleId: number,
  fields: repo.UpdatableBankingRuleFields,
  children: { conditions?: repo.NewBankingRuleCondition[]; actions?: repo.NewBankingRuleAction[] },
  performedBy: string,
): Promise<BankingRule> {
  if (children.conditions !== undefined && children.conditions.length === 0) {
    throw new ValidationError("A rule needs at least one condition.");
  }
  if (children.actions !== undefined && children.actions.length === 0) {
    throw new ValidationError("A rule needs at least one action.");
  }
  return repo.updateBankingRule(companyId, ruleId, fields, children, performedBy);
}

export const setBankingRuleActive = repo.setBankingRuleActive;

/** Pilot Review Round 1, Phase 8 — "Delete" (soft, see repository's own
 * comment). Distinct from Enable/Disable. */
export async function deleteBankingRule(companyId: string, ruleId: number, performedBy: string): Promise<void> {
  const existing = await repo.getBankingRule(companyId, ruleId);
  if (!existing) throw new NotFoundError(`No banking rule with id ${ruleId}.`);
  await repo.deleteBankingRule(companyId, ruleId, performedBy);
}

export async function getRuleConflicts(companyId: string, domain: RuleDomain): Promise<RuleConflict[]> {
  const rules = await repo.listBankingRules(companyId, domain);
  return detectRuleConflicts(rules);
}

export type SimulateResult = { matchedCount: number; totalCount: number; sample: { transactionId: number; matched: boolean }[] };

/** Pure evaluation over an already-fetched candidate record set — the
 * "Simulate"/"Preview" requirement, using the exact same matching logic
 * the real pipeline runs, for any domain (not just Banking). */
export function simulateRule(rule: BankingRule, records: (EvaluableRecord & { id: number })[]): SimulateResult {
  const results = simulateRuleAgainstTransactions(rule, records);
  return {
    matchedCount: results.filter((r) => r.matched).length,
    totalCount: results.length,
    sample: results.slice(0, 50),
  };
}

/** "Test Rule" — evaluates one hand-built hypothetical record (no real
 * transaction required), with a per-condition matched/unmatched
 * breakdown. Distinct from Simulate (bulk dry-run against real sampled
 * data) but built on the exact same `ruleMatches` core — see
 * `rule-engine.ts::testRuleAgainstRecord`'s own docstring. */
export function testRule(rule: BankingRule, record: EvaluableRecord): RuleTestResult {
  return testRuleAgainstRecord(rule, record);
}

/** Rule Analytics — Success %/Failure %/last-applied per rule, computed
 * from the real `banking_rule_applications` log joined against each
 * fired transaction's own resolved state. See
 * `rule-analytics-engine.ts::buildRuleAnalytics` for the pure logic. */
export async function getRuleAnalyticsDetailed(companyId: string): Promise<RuleAnalyticsEntry[]> {
  const [rules, outcomes] = await Promise.all([repo.listBankingRules(companyId), repo.listApplicationOutcomes(companyId)]);
  return buildRuleAnalytics(rules, outcomes);
}

/** Rule Comparison — filters already-computed analytics down to the
 * requested rules, in the requested order; no second calculation. */
export async function getRuleComparison(companyId: string, ruleIds: number[]): Promise<RuleAnalyticsEntry[]> {
  const entries = await getRuleAnalyticsDetailed(companyId);
  return compareRuleAnalytics(entries, ruleIds);
}

/** Rule History — one rule's own individual applications (transaction +
 * timestamp + outcome), most recent first. */
export async function getRuleHistory(companyId: string, ruleId: number): Promise<RuleApplicationOutcome[]> {
  const outcomes = await repo.listApplicationOutcomes(companyId);
  return buildRuleHistory(outcomes, ruleId);
}

/** Rollback — restores a prior version's content as a NEW version (the
 * same "reverse via a new record" audit-trail convention journal
 * reversal, GRN reversal, and Cashbook reversal already established this
 * session), never mutating history. The restored version therefore has
 * its own real `version` number, `updated_by`, and a fresh
 * `banking_rule_versions` snapshot — the rollback itself is auditable. */
export async function restoreBankingRuleVersion(companyId: string, ruleId: number, version: number, performedBy: string): Promise<BankingRule> {
  const versionRow = await repo.getBankingRuleVersion(ruleId, version);
  if (!versionRow) throw new NotFoundError(`No version ${version} found for rule ${ruleId}.`);
  const snapshot = versionRow.snapshot as BankingRule;
  validateRuleShape({
    domain: snapshot.domain,
    ruleType: snapshot.ruleType,
    name: snapshot.name,
    conditions: snapshot.conditions,
    actions: snapshot.actions,
  });
  return repo.updateBankingRule(
    companyId,
    ruleId,
    { name: snapshot.name, description: snapshot.description, priority: snapshot.priority, is_active: snapshot.isActive },
    {
      conditions: snapshot.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, value2: c.value2 })),
      actions: snapshot.actions.map((a) => ({ actionType: a.actionType, targetId: a.targetId, targetText: a.targetText })),
    },
    performedBy,
  );
}

// ---------------------------------------------------------------------
// CSV export / import — same hand-rolled approach as Posting Rules /
// Chart of Accounts. One row per rule CONDITION (denormalized); actions
// are exported as a single semicolon-joined cell since a rule typically
// has few actions and this keeps the round-trip simple.
// ---------------------------------------------------------------------

const CSV_HEADERS = ["Domain", "Rule Type", "Name", "Description", "Priority", "Active", "Condition Field", "Operator", "Value", "Value2", "Actions"];

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function serializeActions(actions: { actionType: string; targetId: number | null; targetText: string | null }[]): string {
  return actions.map((a) => `${a.actionType}=${a.targetId ?? a.targetText ?? ""}`).join(";");
}

function parseActionsCell(cell: string): { actionType: ActionType; targetId: number | null; targetText: string | null }[] {
  if (!cell.trim()) return [];
  return cell.split(";").filter(Boolean).map((entry) => {
    const [actionType, value] = entry.split("=");
    const isNumeric = /^\d+$/.test(value ?? "");
    return {
      actionType: actionType as ActionType,
      targetId: isNumeric ? Number(value) : null,
      targetText: isNumeric ? null : (value ?? null),
    };
  });
}

export function buildBankingRulesCsv(rules: BankingRule[]): string {
  const lines = [CSV_HEADERS.map(csvField).join(",")];
  for (const rule of rules) {
    for (const condition of rule.conditions) {
      lines.push(
        [
          rule.domain,
          rule.ruleType,
          rule.name,
          rule.description,
          String(rule.priority),
          rule.isActive ? "Yes" : "No",
          condition.field,
          condition.operator,
          condition.value,
          condition.value2 ?? "",
          serializeActions(rule.actions),
        ]
          .map(csvField)
          .join(","),
      );
    }
  }
  return lines.join("\r\n");
}

export type BankingRuleImportRow = {
  domain: RuleDomain;
  ruleType: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  condition: { field: ConditionField; operator: ConditionOperator; value: string; value2: string | null };
  actions: { actionType: ActionType; targetId: number | null; targetText: string | null }[];
};

export function parseBankingRulesCsv(csvText: string): { rows: BankingRuleImportRow[]; errors: string[] } {
  const table = parseCsvText(csvText).filter((row) => !isBlankRow(row));
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const [headerRow, ...dataRows] = table;
  const headerIndex = new Map<string, number>();
  headerRow.forEach((h, i) => headerIndex.set(normalizeHeader(h), i));
  const col = (key: string) => headerIndex.get(key);
  const cell = (raw: string[], key: string) => {
    const idx = col(key);
    return idx !== undefined ? cleanText(raw[idx]) : "";
  };

  const rows: BankingRuleImportRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const domain = (cell(raw, "domain") || "Banking") as RuleDomain;
    const ruleType = cell(raw, "ruletype");
    const name = cell(raw, "name");
    const field = cell(raw, "conditionfield");
    const operator = cell(raw, "operator") as ConditionOperator;
    const value = cell(raw, "value");

    if (!RULE_DOMAINS.includes(domain)) return void errors.push(`Row ${rowNumber}: invalid Domain "${domain}".`);
    if (!DOMAIN_RULE_TYPES[domain].includes(ruleType)) return void errors.push(`Row ${rowNumber}: invalid Rule Type "${ruleType}" for domain ${domain}.`);
    if (!name) return void errors.push(`Row ${rowNumber}: Name is required.`);
    if (!DOMAIN_CONDITION_FIELDS[domain].includes(field)) return void errors.push(`Row ${rowNumber}: invalid Condition Field "${field}" for domain ${domain}.`);
    if (!CONDITION_OPERATORS.includes(operator)) return void errors.push(`Row ${rowNumber}: invalid Operator "${operator}".`);

    rows.push({
      domain,
      ruleType,
      name,
      description: cell(raw, "description"),
      priority: cell(raw, "priority") ? Number(cell(raw, "priority")) : 100,
      isActive: cell(raw, "active") ? /^(y|yes|true|1)$/i.test(cell(raw, "active")) : true,
      condition: { field, operator, value, value2: cell(raw, "value2") || null },
      actions: parseActionsCell(cell(raw, "actions")),
    });
  });

  return { rows, errors };
}

export type ImportBankingRulesOutcome = { created: string[]; updated: string[]; errors: string[] };

export async function importBankingRulesCsv(companyId: string, csvText: string, performedBy: string): Promise<ImportBankingRulesOutcome> {
  const { rows, errors } = parseBankingRulesCsv(csvText);
  if (rows.length === 0) return { created: [], updated: [], errors };

  const byName = new Map<string, BankingRuleImportRow[]>();
  for (const row of rows) {
    const group = byName.get(row.name) ?? [];
    group.push(row);
    byName.set(row.name, group);
  }

  const existingRules = await repo.listBankingRules(companyId);
  const existingByName = new Map(existingRules.map((r) => [r.name, r]));

  const created: string[] = [];
  const updated: string[] = [];

  for (const [name, group] of byName) {
    const first = group[0];
    const conditions = group.map((r) => r.condition);
    const actions = first.actions;

    try {
      validateRuleShape({ domain: first.domain, ruleType: first.ruleType, name, conditions, actions });
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : "invalid rule."}`);
      continue;
    }

    const existing = existingByName.get(name);
    try {
      if (existing) {
        await repo.updateBankingRule(companyId, existing.id, { description: first.description, priority: first.priority, is_active: first.isActive }, { conditions, actions }, performedBy);
        updated.push(name);
      } else {
        await repo.createBankingRule(companyId, { domain: first.domain, ruleType: first.ruleType, name, description: first.description, priority: first.priority, isActive: first.isActive, conditions, actions, performedBy });
        created.push(name);
      }
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : "failed to import."}`);
    }
  }

  return { created, updated, errors };
}
