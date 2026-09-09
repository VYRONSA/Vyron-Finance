/**
 * Repository layer for Posting Rules — the database-driven rule engine
 * that replaces the reference's hardcoded `posting_rules.py` dispatch
 * functions (see `supabase/migrations/0007_general_ledger.sql`'s header
 * comment). Seeded with the reference's exact 8 event types via
 * `seed_company_defaults()`; this file is the CRUD layer on top.
 */

import { createClient } from "@/lib/supabase/server";
import { postingRuleFromRow, type PostingRuleRow } from "@/server/general-ledger/mappers";
import type { PostingRule, PostingRuleAmountSource, PostingRuleSide } from "@/server/general-ledger/types";

const RULE_WITH_LINES_SELECT = "*, posting_rule_lines(*)";

export async function listPostingRules(companyId: string): Promise<PostingRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posting_rules")
    .select(RULE_WITH_LINES_SELECT)
    .eq("company_id", companyId)
    .order("event_type")
    .returns<PostingRuleRow[]>();
  if (error) throw error;
  return data.map(postingRuleFromRow);
}

export async function getPostingRule(companyId: string, ruleId: number): Promise<PostingRule | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posting_rules")
    .select(RULE_WITH_LINES_SELECT)
    .eq("company_id", companyId)
    .eq("id", ruleId)
    .maybeSingle<PostingRuleRow>();
  if (error) throw error;
  return data ? postingRuleFromRow(data) : null;
}

export async function getPostingRuleByEventType(companyId: string, eventType: string): Promise<PostingRule | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posting_rules")
    .select(RULE_WITH_LINES_SELECT)
    .eq("company_id", companyId)
    .eq("event_type", eventType)
    .maybeSingle<PostingRuleRow>();
  if (error) throw error;
  return data ? postingRuleFromRow(data) : null;
}

export type NewPostingRuleLine = {
  lineOrder: number;
  side: PostingRuleSide;
  role: string;
  fixedAccountCode: string | null;
  amountSource: PostingRuleAmountSource;
};

export type NewPostingRule = { eventType: string; description?: string; lines: NewPostingRuleLine[] };

function lineRowsFor(ruleId: number, lines: NewPostingRuleLine[]) {
  return lines.map((l) => ({
    posting_rule_id: ruleId,
    line_order: l.lineOrder,
    side: l.side,
    role: l.role,
    fixed_account_code: l.fixedAccountCode,
    amount_source: l.amountSource,
  }));
}

export async function createPostingRule(companyId: string, input: NewPostingRule): Promise<PostingRule> {
  const supabase = await createClient();
  const { data: ruleRow, error: ruleError } = await supabase
    .from("posting_rules")
    .insert({ company_id: companyId, event_type: input.eventType, description: input.description ?? "" })
    .select("*")
    .single<PostingRuleRow>();
  if (ruleError) throw ruleError;

  const { data: lineRows, error: linesError } = await supabase
    .from("posting_rule_lines")
    .insert(lineRowsFor(ruleRow.id, input.lines))
    .select("*");
  if (linesError) throw linesError;

  return postingRuleFromRow({ ...ruleRow, posting_rule_lines: lineRows });
}

export type UpdatablePostingRuleFields = Partial<{ description: string; is_active: boolean }>;

export async function updatePostingRule(companyId: string, ruleId: number, fields: UpdatablePostingRuleFields): Promise<PostingRule> {
  const supabase = await createClient();
  const { error } = await supabase.from("posting_rules").update(fields).eq("company_id", companyId).eq("id", ruleId);
  if (error) throw error;
  const rule = await getPostingRule(companyId, ruleId);
  if (!rule) throw new Error(`No posting rule with id ${ruleId}`);
  return rule;
}

export const setPostingRuleActive = (companyId: string, ruleId: number, isActive: boolean) =>
  updatePostingRule(companyId, ruleId, { is_active: isActive });

/** Replaces a rule's lines wholesale (delete then re-insert) — simpler and
 * safer than diffing individual line edits for a settings-scale table with
 * at most a handful of lines per rule. Ownership is verified via the
 * `company_id` filter on the initial fetch before any write. */
export async function replacePostingRuleLines(companyId: string, ruleId: number, lines: NewPostingRuleLine[]): Promise<PostingRule> {
  const supabase = await createClient();
  const { data: ruleRow, error: ruleError } = await supabase
    .from("posting_rules")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", ruleId)
    .single<PostingRuleRow>();
  if (ruleError) throw ruleError;

  const { error: deleteError } = await supabase.from("posting_rule_lines").delete().eq("posting_rule_id", ruleId);
  if (deleteError) throw deleteError;

  const { data: lineRows, error: insertError } = await supabase
    .from("posting_rule_lines")
    .insert(lineRowsFor(ruleId, lines))
    .select("*");
  if (insertError) throw insertError;

  return postingRuleFromRow({ ...ruleRow, posting_rule_lines: lineRows });
}
