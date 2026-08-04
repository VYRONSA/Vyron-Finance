/**
 * Service layer for Posting Rules. `buildJournalLinesFromRule` is the
 * pure, exhaustively unit-tested core — the reference's own hardcoded
 * `posting_rules.py` dispatch logic, now driven by data instead of code
 * (per the explicit "nothing may hardcode journal entries" requirement).
 * Net/VAT/Gross splitting reuses the same `rate` field Tax Configuration
 * already exposes on `VatTreatment` — one source of VAT math, not two.
 *
 * No calling module exists yet (Sales/Customers isn't built) — this is
 * real, tested, ready-to-use engine code with no caller, honestly, same as
 * every other genuinely-new-but-not-yet-wired capability in this port.
 */

import * as repo from "@/server/repositories/posting-rule-repository";
import { cleanText, isBlankRow, normalizeHeader, parseCsvText } from "@/server/import-centre/csv-utils";
import { splitGrossAmount, type AmountSplit } from "@/server/general-ledger/amount-split";
import type { NewJournalLine } from "@/server/repositories/journal-repository";
import type { PostingRule, PostingRuleAmountSource, PostingRuleSide } from "@/server/general-ledger/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const BALANCE_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PostingEventContext = {
  /** The full, VAT-inclusive amount for the event (an invoice's grand
   * total, a payment's amount, etc.) — every rule line's amount is
   * derived from this one figure plus `vatRatePercent`. */
  grossAmount: number;
  vatRatePercent: number;
  description: string;
  /** Account codes for lines whose `fixedAccountCode` is null (e.g. a
   * specific bill's own expense account) — keyed by the rule line's
   * `role`. */
  accountsByRole?: Record<string, string>;
};

/** Re-exported from `amount-split.ts` unchanged — see that file's own
 * docstring for why the implementation lives there. */
export { splitGrossAmount, type AmountSplit };

export type BuildJournalLinesResult = { ok: true; lines: NewJournalLine[] } | { ok: false; reason: string };

/** Pure — the one place a bug would silently generate a wrong or
 * unbalanced journal from a posting rule, so it's exhaustively unit
 * tested independently of Supabase, matching this codebase's established
 * rigor for double-entry-producing code. */
export function buildJournalLinesFromRule(rule: PostingRule, context: PostingEventContext): BuildJournalLinesResult {
  if (!rule.isActive) return { ok: false, reason: `Posting rule "${rule.eventType}" is inactive.` };
  if (rule.lines.length === 0) return { ok: false, reason: `Posting rule "${rule.eventType}" has no lines configured.` };

  const amounts = splitGrossAmount(context.grossAmount, context.vatRatePercent);
  const lines: NewJournalLine[] = [];

  for (const ruleLine of rule.lines) {
    const accountCode = ruleLine.fixedAccountCode ?? context.accountsByRole?.[ruleLine.role];
    if (!accountCode) {
      return { ok: false, reason: `No account supplied for role "${ruleLine.role}" on posting rule "${rule.eventType}".` };
    }
    const amount = amounts[ruleLine.amountSource];
    if (amount === 0) continue; // e.g. a VAT line for a zero-rated event — omitted, not a zero-value line.
    lines.push({
      accountCode,
      debit: ruleLine.side === "Debit" ? amount : 0,
      credit: ruleLine.side === "Credit" ? amount : 0,
      description: context.description,
    });
  }

  if (lines.length === 0) return { ok: false, reason: `Posting rule "${rule.eventType}" produced no lines for this event.` };

  const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    return { ok: false, reason: `Posting rule "${rule.eventType}" produced an unbalanced journal (debit ${totalDebit} != credit ${totalCredit}).` };
  }

  return { ok: true, lines };
}

export async function buildJournalFromEvent(companyId: string, eventType: string, context: PostingEventContext): Promise<BuildJournalLinesResult> {
  const rule = await repo.getPostingRuleByEventType(companyId, eventType);
  if (!rule) return { ok: false, reason: `No posting rule configured for event type "${eventType}".` };
  return buildJournalLinesFromRule(rule, context);
}

export const listPostingRules = repo.listPostingRules;
export const getPostingRule = repo.getPostingRule;
export const setPostingRuleActive = repo.setPostingRuleActive;

/** At least one Debit and one Credit line, each with a role — the
 * structural minimum for a rule that can ever produce a balanced journal.
 * Doesn't (can't) check numeric balance here since real amounts only
 * exist per-event, not per-rule-definition. */
export function validatePostingRuleLines(lines: { side: string; role: string }[]): void {
  if (lines.length < 2) throw new ValidationError("A posting rule needs at least two lines.");
  if (!lines.some((l) => l.side === "Debit")) throw new ValidationError("A posting rule needs at least one Debit line.");
  if (!lines.some((l) => l.side === "Credit")) throw new ValidationError("A posting rule needs at least one Credit line.");
  if (lines.some((l) => !l.role?.trim())) throw new ValidationError("Every posting rule line needs a role.");
}

export async function createPostingRule(companyId: string, input: repo.NewPostingRule): Promise<PostingRule> {
  if (!input.eventType?.trim()) throw new ValidationError("Event Type is required.");
  validatePostingRuleLines(input.lines);
  return repo.createPostingRule(companyId, { ...input, eventType: input.eventType.trim() });
}

export async function replacePostingRuleLines(companyId: string, ruleId: number, lines: repo.NewPostingRuleLine[]): Promise<PostingRule> {
  validatePostingRuleLines(lines);
  return repo.replacePostingRuleLines(companyId, ruleId, lines);
}

export async function updatePostingRuleDescription(companyId: string, ruleId: number, description: string): Promise<PostingRule> {
  return repo.updatePostingRule(companyId, ruleId, { description });
}

/** Copies a rule's lines under a new event type — same "copy every field
 * except the identifying one" shape as
 * `chart-of-accounts-service.ts::duplicateChartOfAccount`. */
export async function duplicatePostingRule(companyId: string, ruleId: number, newEventType: string): Promise<PostingRule> {
  if (!newEventType?.trim()) throw new ValidationError("Event Type is required.");
  const source = await repo.getPostingRule(companyId, ruleId);
  if (!source) throw new NotFoundError(`No posting rule with id ${ruleId}.`);
  return repo.createPostingRule(companyId, {
    eventType: newEventType.trim(),
    description: source.description,
    lines: source.lines.map((line) => ({
      lineOrder: line.lineOrder,
      side: line.side,
      role: line.role,
      fixedAccountCode: line.fixedAccountCode,
      amountSource: line.amountSource,
    })),
  });
}

// ---------------------------------------------------------------------
// CSV export / import — same hand-rolled approach as Chart of Accounts /
// Import Centre, no new dependency. One row per rule *line* (denormalized)
// since that's the shape an accountant editing this in a spreadsheet
// actually wants — grouped back into rules on import by Event Type.
// ---------------------------------------------------------------------

const CSV_HEADERS = ["Event Type", "Description", "Active", "Line Order", "Side", "Role", "Fixed Account Code", "Amount Source"];

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildPostingRulesCsv(rules: PostingRule[]): string {
  const lines = [CSV_HEADERS.map(csvField).join(",")];
  for (const rule of rules) {
    for (const line of rule.lines) {
      lines.push(
        [
          rule.eventType,
          rule.description,
          rule.isActive ? "Yes" : "No",
          String(line.lineOrder),
          line.side,
          line.role,
          line.fixedAccountCode ?? "",
          line.amountSource,
        ]
          .map(csvField)
          .join(","),
      );
    }
  }
  return lines.join("\r\n");
}

export type PostingRuleImportRow = {
  eventType: string;
  description: string;
  isActive: boolean;
  lineOrder: number;
  side: PostingRuleSide;
  role: string;
  fixedAccountCode: string | null;
  amountSource: PostingRuleAmountSource;
};

const SIDES: PostingRuleSide[] = ["Debit", "Credit"];
const AMOUNT_SOURCES_LIST: PostingRuleAmountSource[] = ["gross", "net", "vat"];

/** Pure — validates each row independently and collects every error
 * rather than throwing on the first, matching
 * `chart-of-accounts-service.ts::parseChartOfAccountsCsv`. */
export function parsePostingRulesCsv(csvText: string): { rows: PostingRuleImportRow[]; errors: string[] } {
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

  const idxEventType = col("eventtype");
  const idxSide = col("side");
  const idxRole = col("role");
  const idxAmountSource = col("amountsource");
  if (idxEventType === undefined || idxSide === undefined || idxRole === undefined || idxAmountSource === undefined) {
    return { rows: [], errors: ["Missing required columns: Event Type, Side, Role, Amount Source."] };
  }

  const rows: PostingRuleImportRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const eventType = cleanText(raw[idxEventType]);
    const sideRaw = cleanText(raw[idxSide]);
    const role = cleanText(raw[idxRole]);
    const amountSourceRaw = cleanText(raw[idxAmountSource]).toLowerCase();
    const side = SIDES.find((s) => s.toLowerCase() === sideRaw.toLowerCase());
    const amountSource = AMOUNT_SOURCES_LIST.find((s) => s === amountSourceRaw);

    if (!eventType) return void errors.push(`Row ${rowNumber}: Event Type is required.`);
    if (!side) return void errors.push(`Row ${rowNumber}: Side must be Debit or Credit.`);
    if (!role) return void errors.push(`Row ${rowNumber}: Role is required.`);
    if (!amountSource) return void errors.push(`Row ${rowNumber}: Amount Source must be gross, net, or vat.`);

    const lineOrderRaw = cell(raw, "lineorder");
    const fixedAccountCode = cell(raw, "fixedaccountcode");

    rows.push({
      eventType,
      description: cell(raw, "description"),
      isActive: cell(raw, "active") ? /^(y|yes|true|1)$/i.test(cell(raw, "active")) : true,
      lineOrder: lineOrderRaw ? Number(lineOrderRaw) : rows.filter((r) => r.eventType === eventType).length,
      side,
      role,
      fixedAccountCode: fixedAccountCode || null,
      amountSource,
    });
  });

  return { rows, errors };
}

export type ImportPostingRulesOutcome = { created: string[]; updated: string[]; errors: string[] };

/** Groups parsed rows by Event Type and either creates a new rule or
 * replaces an existing one's lines — an existing rule's `isActive`/
 * `description` are updated from its first row too, so the same export ->
 * edit -> import round-trip a spreadsheet-based workflow expects actually
 * works. */
export async function importPostingRulesCsv(companyId: string, csvText: string): Promise<ImportPostingRulesOutcome> {
  const { rows, errors } = parsePostingRulesCsv(csvText);
  if (rows.length === 0) return { created: [], updated: [], errors };

  const byEventType = new Map<string, PostingRuleImportRow[]>();
  for (const row of rows) {
    const group = byEventType.get(row.eventType) ?? [];
    group.push(row);
    byEventType.set(row.eventType, group);
  }

  const existingRules = await repo.listPostingRules(companyId);
  const existingByEventType = new Map(existingRules.map((r) => [r.eventType, r]));

  const created: string[] = [];
  const updated: string[] = [];

  for (const [eventType, group] of byEventType) {
    const lines = group
      .sort((a, b) => a.lineOrder - b.lineOrder)
      .map((r) => ({ lineOrder: r.lineOrder, side: r.side, role: r.role, fixedAccountCode: r.fixedAccountCode, amountSource: r.amountSource }));

    try {
      validatePostingRuleLines(lines);
    } catch (err) {
      errors.push(`${eventType}: ${err instanceof Error ? err.message : "invalid rule."}`);
      continue;
    }

    const existing = existingByEventType.get(eventType);
    try {
      if (existing) {
        await repo.replacePostingRuleLines(companyId, existing.id, lines);
        await repo.updatePostingRule(companyId, existing.id, { description: group[0].description || existing.description, is_active: group[0].isActive });
        updated.push(eventType);
      } else {
        await repo.createPostingRule(companyId, { eventType, description: group[0].description, lines });
        created.push(eventType);
      }
    } catch (err) {
      errors.push(`${eventType}: ${err instanceof Error ? err.message : "failed to import."}`);
    }
  }

  return { created, updated, errors };
}
