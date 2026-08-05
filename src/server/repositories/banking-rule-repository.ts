/**
 * Repository layer for the Banking Rule Engine — same "replace children
 * wholesale" shape as `posting-rule-repository.ts`, extended to two
 * child tables (conditions, actions) instead of one, plus the
 * version-history and rule-application-analytics tables.
 */

import { createClient } from "@/lib/supabase/server";
import {
  bankingRuleApplicationFromRow,
  bankingRuleFromRow,
  bankingRuleVersionFromRow,
  ruleApplicationOutcomeFromRow,
  type BankingRuleApplicationOutcomeRow,
  type BankingRuleApplicationRow,
  type BankingRuleRow,
  type BankingRuleVersionRow,
} from "@/server/banking-rules/mappers";
import type { RuleApplicationOutcome } from "@/server/banking-rules/rule-analytics-engine";
import type { ActionType, BankingRule, BankingRuleApplication, BankingRuleVersion, ConditionField, ConditionOperator, RuleDomain } from "@/server/banking-rules/types";

const RULE_SELECT = "*, banking_rule_conditions(*), banking_rule_actions(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

/** `domain` is optional here (the Automation Rules workspace lists every
 * domain at once, filterable client-side) but REQUIRED on
 * `listActiveBankingRules` below — a pipeline evaluating rules for one
 * domain must never accidentally match another domain's rules against
 * its own records. */
export async function listBankingRules(companyId: string, domain?: RuleDomain, ruleType?: string): Promise<BankingRule[]> {
  const supabase = await createClient();
  let query = supabase.from("banking_rules").select(RULE_SELECT).eq("company_id", companyId).eq("is_deleted", false);
  if (domain) query = query.eq("domain", domain);
  if (ruleType) query = query.eq("rule_type", ruleType);
  const { data, error } = await query.order("rule_type").order("priority").returns<BankingRuleRow[]>();
  if (error) throw error;
  return data.map(bankingRuleFromRow);
}

export async function listActiveBankingRules(companyId: string, domain: RuleDomain): Promise<BankingRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_rules")
    .select(RULE_SELECT)
    .eq("company_id", companyId)
    .eq("domain", domain)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .order("rule_type")
    .order("priority")
    .returns<BankingRuleRow[]>();
  if (error) throw error;
  return data.map(bankingRuleFromRow);
}

export async function getBankingRule(companyId: string, ruleId: number): Promise<BankingRule | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_rules")
    .select(RULE_SELECT)
    .eq("company_id", companyId)
    .eq("id", ruleId)
    .eq("is_deleted", false)
    .maybeSingle<BankingRuleRow>();
  if (error) throw error;
  return data ? bankingRuleFromRow(data) : null;
}

/** Pilot Review Round 1, Phase 8 — soft delete, deliberately not a hard
 * `delete from banking_rules` (see migration 0057's own comment): it
 * would cascade away the version history and application log this same
 * phase's "Rule Statistics"/"Rule History" asks also depend on. Distinct
 * from `setBankingRuleActive` (Enable/Disable — temporarily won't fire,
 * still listed) — this removes the rule from the management list
 * entirely, matching what "Delete" means in every other module here
 * (Customer/Supplier/Bank Account all soft-toggle, never hard-delete). */
export async function deleteBankingRule(companyId: string, ruleId: number, performedBy = "System"): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("banking_rules")
    .update({ is_deleted: true, updated_by: performedBy })
    .eq("company_id", companyId)
    .eq("id", ruleId);
  if (error) throw error;
}

export type NewBankingRuleCondition = { field: ConditionField; operator: ConditionOperator; value: string; value2?: string | null };
export type NewBankingRuleAction = { actionType: ActionType; targetId?: number | null; targetText?: string | null };
export type NewBankingRule = {
  domain: RuleDomain;
  ruleType: string;
  name: string;
  description?: string;
  priority?: number;
  isActive?: boolean;
  conditions: NewBankingRuleCondition[];
  actions: NewBankingRuleAction[];
  performedBy?: string;
};

function conditionRowsFor(ruleId: number, conditions: NewBankingRuleCondition[]) {
  return conditions.map((c) => ({ rule_id: ruleId, field: c.field, operator: c.operator, value: c.value, value2: c.value2 ?? null }));
}

function actionRowsFor(ruleId: number, actions: NewBankingRuleAction[]) {
  return actions.map((a) => ({ rule_id: ruleId, action_type: a.actionType, target_id: a.targetId ?? null, target_text: a.targetText ?? null }));
}

export async function createBankingRule(companyId: string, input: NewBankingRule): Promise<BankingRule> {
  const supabase = await createClient();
  const performedBy = input.performedBy ?? "System";
  const { data: ruleRow, error: ruleError } = await supabase
    .from("banking_rules")
    .insert({
      company_id: companyId,
      domain: input.domain,
      rule_type: input.ruleType,
      name: input.name,
      description: input.description ?? "",
      priority: input.priority ?? 100,
      is_active: input.isActive ?? true,
      created_by: performedBy,
      updated_by: performedBy,
    })
    .select("*")
    .single<BankingRuleRow>();
  if (ruleError) throw ruleError;

  const { data: conditionRows, error: conditionsError } = await supabase
    .from("banking_rule_conditions")
    .insert(conditionRowsFor(ruleRow.id, input.conditions))
    .select("*");
  if (conditionsError) throw conditionsError;

  const { data: actionRows, error: actionsError } = await supabase
    .from("banking_rule_actions")
    .insert(actionRowsFor(ruleRow.id, input.actions))
    .select("*");
  if (actionsError) throw actionsError;

  const rule = bankingRuleFromRow({ ...ruleRow, banking_rule_conditions: conditionRows, banking_rule_actions: actionRows });
  await snapshotVersion(ruleRow.id, 1, rule, performedBy);
  return rule;
}

export type UpdatableBankingRuleFields = Partial<{
  name: string;
  description: string;
  priority: number;
  is_active: boolean;
}>;

/** Replaces name/description/priority/active-state AND (when supplied)
 * the full condition/action set wholesale — same "delete then re-insert"
 * shape `posting-rule-repository.ts::replacePostingRuleLines` already
 * established. Always bumps `version` and snapshots it, so every edit —
 * whether it only toggles Active or fully rewrites the logic — has a
 * real version history entry. */
export async function updateBankingRule(
  companyId: string,
  ruleId: number,
  fields: UpdatableBankingRuleFields,
  children: { conditions?: NewBankingRuleCondition[]; actions?: NewBankingRuleAction[] } = {},
  performedBy = "System",
): Promise<BankingRule> {
  const supabase = await createClient();
  const existing = await getBankingRule(companyId, ruleId);
  if (!existing) throw new Error(`No banking rule with id ${ruleId}`);

  const nextVersion = existing.version + 1;
  const { error: updateError } = await supabase
    .from("banking_rules")
    .update({ ...fields, version: nextVersion, updated_by: performedBy })
    .eq("company_id", companyId)
    .eq("id", ruleId);
  if (updateError) throw updateError;

  if (children.conditions) {
    const { error: deleteError } = await supabase.from("banking_rule_conditions").delete().eq("rule_id", ruleId);
    if (deleteError) throw deleteError;
    if (children.conditions.length > 0) {
      const { error: insertError } = await supabase.from("banking_rule_conditions").insert(conditionRowsFor(ruleId, children.conditions));
      if (insertError) throw insertError;
    }
  }
  if (children.actions) {
    const { error: deleteError } = await supabase.from("banking_rule_actions").delete().eq("rule_id", ruleId);
    if (deleteError) throw deleteError;
    if (children.actions.length > 0) {
      const { error: insertError } = await supabase.from("banking_rule_actions").insert(actionRowsFor(ruleId, children.actions));
      if (insertError) throw insertError;
    }
  }

  const updated = await getBankingRule(companyId, ruleId);
  if (!updated) throw new Error(`No banking rule with id ${ruleId}`);
  await snapshotVersion(ruleId, nextVersion, updated, performedBy);
  return updated;
}

export const setBankingRuleActive = (companyId: string, ruleId: number, isActive: boolean, performedBy = "System") =>
  updateBankingRule(companyId, ruleId, { is_active: isActive }, {}, performedBy);

async function snapshotVersion(ruleId: number, version: number, rule: BankingRule, performedBy: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("banking_rule_versions").insert({
    rule_id: ruleId,
    version,
    snapshot: rule,
    created_by: performedBy,
  });
  if (error) throw error;
}

export async function listBankingRuleVersions(ruleId: number): Promise<BankingRuleVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_rule_versions")
    .select("*")
    .eq("rule_id", ruleId)
    .order("version", { ascending: false })
    .returns<BankingRuleVersionRow[]>();
  if (error) throw error;
  return data.map(bankingRuleVersionFromRow);
}

export async function getBankingRuleVersion(ruleId: number, version: number): Promise<BankingRuleVersion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_rule_versions")
    .select("*")
    .eq("rule_id", ruleId)
    .eq("version", version)
    .maybeSingle<BankingRuleVersionRow>();
  if (error) throw error;
  return data ? bankingRuleVersionFromRow(data) : null;
}

export async function recordRuleApplication(companyId: string, ruleId: number, bankTransactionId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("banking_rule_applications").insert({ company_id: companyId, rule_id: ruleId, bank_transaction_id: bankTransactionId });
  if (error) throw error;
}

export async function listRuleApplicationsSince(companyId: string, sinceIso: string): Promise<BankingRuleApplication[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_rule_applications")
    .select("*")
    .eq("company_id", companyId)
    .gte("applied_at", sinceIso)
    .order("applied_at", { ascending: false })
    .limit(LIST_CAP)
    .returns<BankingRuleApplicationRow[]>();
  if (error) throw error;
  return data.map(bankingRuleApplicationFromRow);
}

/** Rule Analytics' real data source — one joined query against the
 * transaction each application fired against, so "succeeded" is judged
 * from the transaction's real resolved state (journal posted / matched)
 * rather than a second, separately-tracked outcome column that could
 * drift out of sync with the real record. */
export async function listApplicationOutcomes(companyId: string): Promise<RuleApplicationOutcome[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_rule_applications")
    .select("rule_id, bank_transaction_id, applied_at, ae_bank_transactions(allocation_status, journal_id)")
    .eq("company_id", companyId)
    .order("applied_at", { ascending: false })
    .limit(LIST_CAP)
    .returns<BankingRuleApplicationOutcomeRow[]>();
  if (error) throw error;
  return data.map(ruleApplicationOutcomeFromRow);
}
