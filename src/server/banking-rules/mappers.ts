import type {
  ActionType,
  BankingException,
  BankingRule,
  BankingRuleAction,
  BankingRuleApplication,
  BankingRuleCondition,
  BankingRuleVersion,
  ConditionField,
  ConditionOperator,
  ExceptionStatus,
  ExceptionType,
  Merchant,
  RuleDomain,
} from "./types";

export type BankingRuleConditionRow = {
  id: number;
  field: string;
  operator: string;
  value: string;
  value2: string | null;
};

export type BankingRuleActionRow = {
  id: number;
  action_type: string;
  target_id: number | null;
  target_text: string | null;
};

export type BankingRuleRow = {
  id: number;
  company_id: string;
  domain: string;
  rule_type: string;
  name: string;
  description: string;
  priority: number;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  banking_rule_conditions?: BankingRuleConditionRow[];
  banking_rule_actions?: BankingRuleActionRow[];
};

export function conditionFromRow(row: BankingRuleConditionRow): BankingRuleCondition {
  return {
    id: row.id,
    field: row.field as ConditionField,
    operator: row.operator as ConditionOperator,
    value: row.value,
    value2: row.value2,
  };
}

export function actionFromRow(row: BankingRuleActionRow): BankingRuleAction {
  return {
    id: row.id,
    actionType: row.action_type as ActionType,
    targetId: row.target_id,
    targetText: row.target_text,
  };
}

export function bankingRuleFromRow(row: BankingRuleRow): BankingRule {
  return {
    id: row.id,
    companyId: row.company_id,
    domain: row.domain as RuleDomain,
    ruleType: row.rule_type,
    name: row.name,
    description: row.description,
    priority: row.priority,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    conditions: (row.banking_rule_conditions ?? []).map(conditionFromRow),
    actions: (row.banking_rule_actions ?? []).map(actionFromRow),
  };
}

export type BankingRuleVersionRow = {
  id: number;
  rule_id: number;
  version: number;
  snapshot: unknown;
  created_at: string;
  created_by: string;
};

export function bankingRuleVersionFromRow(row: BankingRuleVersionRow): BankingRuleVersion {
  return {
    id: row.id,
    ruleId: row.rule_id,
    version: row.version,
    snapshot: row.snapshot,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export type BankingRuleApplicationRow = {
  id: number;
  rule_id: number;
  bank_transaction_id: number;
  applied_at: string;
};

export function bankingRuleApplicationFromRow(row: BankingRuleApplicationRow): BankingRuleApplication {
  return {
    id: row.id,
    ruleId: row.rule_id,
    bankTransactionId: row.bank_transaction_id,
    appliedAt: row.applied_at,
  };
}

export type BankingRuleApplicationOutcomeRow = {
  rule_id: number;
  bank_transaction_id: number;
  applied_at: string;
  ae_bank_transactions: { allocation_status: string; journal_id: number | null } | null;
};

/** "Succeeded" mirrors `matching-summary-service.ts::buildMatchingSummary`'s
 * own rule-success judgement — resolved into a real journal (or a
 * confirmed Matched/Allocated status), not merely matched — reused here
 * per-rule so this codebase has exactly ONE definition of "a rule
 * succeeded," not a second one invented for Rule Analytics. */
export function ruleApplicationOutcomeFromRow(row: BankingRuleApplicationOutcomeRow): { ruleId: number; bankTransactionId: number; appliedAt: string; succeeded: boolean } {
  const txn = row.ae_bank_transactions;
  const succeeded = txn !== null && (txn.journal_id !== null || txn.allocation_status === "Matched" || txn.allocation_status === "Allocated");
  return {
    ruleId: row.rule_id,
    bankTransactionId: row.bank_transaction_id,
    appliedAt: row.applied_at,
    succeeded,
  };
}

export type BankingExceptionRow = {
  id: number;
  company_id: string;
  bank_transaction_id: number;
  exception_type: string;
  reason: string;
  evidence: string;
  recommended_action: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export function bankingExceptionFromRow(row: BankingExceptionRow): BankingException {
  return {
    id: row.id,
    companyId: row.company_id,
    bankTransactionId: row.bank_transaction_id,
    exceptionType: row.exception_type as ExceptionType,
    reason: row.reason,
    evidence: row.evidence,
    recommendedAction: row.recommended_action,
    status: row.status as ExceptionStatus,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
  };
}

export type MerchantRow = {
  id: number;
  company_id: string;
  name: string;
  aliases: string[];
  default_supplier_id: number | null;
  default_customer_id: number | null;
  default_gl_account: string;
  default_vat_code: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export function merchantFromRow(row: MerchantRow): Merchant {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    aliases: row.aliases ?? [],
    defaultSupplierId: row.default_supplier_id,
    defaultCustomerId: row.default_customer_id,
    defaultGlAccount: row.default_gl_account ?? "",
    defaultVatCode: row.default_vat_code ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
