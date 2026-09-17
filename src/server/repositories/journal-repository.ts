/**
 * Repository layer for Journals — ported from `accounting_engine/
 * journal_service.py`. Draft-only: creation and status transitions
 * (approve/reject), no posting to a General Ledger — that's out of scope
 * in the reference too ("The Posting Engine (Phase E) will build on top
 * of `list_by_status`/`get` here"). No validation here (empty-lines,
 * balance) — that's the service layer's job, matching this codebase's
 * established repository/service split.
 */

import { createClient } from "@/lib/supabase/server";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { journalFromRow, type JournalRow } from "@/server/accounting/mappers";
import { RULE_ENGINE_JOURNAL_SOURCE_TYPE, type Journal, type JournalStatus, type RuleEngineJournalRef } from "@/server/accounting/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

/** Sequential, per-company, `COUNT(*)+1` — ported exactly from
 * `next_journal_number`. Not gap-safe against concurrent creates on its
 * own; `ae_journals`' `unique (company_id, journal_number)` constraint is
 * the same race backstop the reference relies on. */
export async function nextJournalNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ae_journals")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) throw error;
  return `JR${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export type NewJournalLine = {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
};

export type NewJournal = {
  journalNumber?: string;
  journalDate?: string;
  journalType: string;
  description: string;
  reference: string;
  sourceType: string;
  sourceId: number | null;
  status?: JournalStatus;
  lines: NewJournalLine[];
};

export async function createJournal(companyId: string, journal: NewJournal): Promise<Journal> {
  const supabase = await createClient();
  const journalNumber = journal.journalNumber ?? (await nextJournalNumber(companyId));
  const journalDate = journal.journalDate ?? new Date().toISOString().slice(0, 10);
  const totalDebit = Math.round(journal.lines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(journal.lines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;

  const { data: journalRow, error: journalError } = await supabase
    .from("ae_journals")
    .insert({
      company_id: companyId,
      journal_number: journalNumber,
      journal_date: journalDate,
      journal_type: journal.journalType,
      description: journal.description,
      reference: journal.reference,
      source_type: journal.sourceType,
      source_id: journal.sourceId,
      status: journal.status ?? "Draft",
      total_debit: totalDebit,
      total_credit: totalCredit,
    })
    .select("*")
    .single<JournalRow>();
  if (journalError) throw journalError;

  const { data: lineRows, error: linesError } = await supabase
    .from("ae_journal_lines")
    .insert(
      journal.lines.map((line, index) => ({
        journal_id: journalRow.id,
        account_code: line.accountCode,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        line_order: index,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  return journalFromRow({ ...journalRow, ae_journal_lines: lineRows });
}

export async function getJournal(companyId: string, journalId: number): Promise<Journal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_journals")
    .select("*, ae_journal_lines(*)")
    .eq("company_id", companyId)
    .eq("id", journalId)
    .maybeSingle<JournalRow>();
  if (error) throw error;
  return data ? journalFromRow(data) : null;
}

/** Phase 25I — `(source_type, source_id)` is not unique in general (an
 * automation source, unlike `journal_number`, was never meant to be a
 * hard identity key), so this is an existence CHECK, not a guarantee —
 * callers that create one journal per source (e.g.
 * `journal-workflow-service.ts::reverseJournal`) call this first to avoid
 * creating a second one. The Banking Rule source is the exception:
 * migration 0100 makes it unique and the rule engine posts atomically
 * (`posting-repository.ts::postRuleEngineJournalAtomic`). */
export async function getJournalBySource(companyId: string, sourceType: string, sourceId: number): Promise<Journal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_journals")
    .select("*, ae_journal_lines(*)")
    .eq("company_id", companyId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<JournalRow>();
  if (error) throw error;
  return data ? journalFromRow(data) : null;
}

export type UpdatableJournalFields = Partial<{
  journalDate: string;
  journalType: string;
  description: string;
  reference: string;
  lines: NewJournalLine[];
}>;

/** Content edit for a journal that hasn't left Draft yet — status legality
 * (Draft-only) is the service layer's job
 * (`journal-crud-service.ts::updateJournal`). Lines, when supplied, are
 * replaced wholesale (delete then re-insert) — same approach as
 * `posting-rule-repository.ts::replacePostingRuleLines`, simpler and safer
 * than diffing individual line edits for a handful of rows. */
export async function updateJournal(companyId: string, journalId: number, fields: UpdatableJournalFields): Promise<Journal> {
  const supabase = await createClient();

  const headerUpdate: Record<string, unknown> = {};
  if (fields.journalDate !== undefined) headerUpdate.journal_date = fields.journalDate;
  if (fields.journalType !== undefined) headerUpdate.journal_type = fields.journalType;
  if (fields.description !== undefined) headerUpdate.description = fields.description;
  if (fields.reference !== undefined) headerUpdate.reference = fields.reference;
  if (fields.lines) {
    headerUpdate.total_debit = Math.round(fields.lines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
    headerUpdate.total_credit = Math.round(fields.lines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;
  }

  if (Object.keys(headerUpdate).length > 0) {
    const { error } = await supabase.from("ae_journals").update(headerUpdate).eq("company_id", companyId).eq("id", journalId);
    if (error) throw error;
  }

  if (fields.lines) {
    const { error: deleteError } = await supabase.from("ae_journal_lines").delete().eq("journal_id", journalId);
    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase.from("ae_journal_lines").insert(
      fields.lines.map((line, index) => ({
        journal_id: journalId,
        account_code: line.accountCode,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        line_order: index,
      })),
    );
    if (insertError) throw insertError;
  }

  const journal = await getJournal(companyId, journalId);
  if (!journal) throw new Error(`No journal with id ${journalId}`);
  return journal;
}

/** RC1 Phase 6 — the Audit Dashboard's real "journal reversals" count. */
export async function countReversedJournals(companyId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("ae_journals").select("*", { count: "exact", head: true }).eq("company_id", companyId).eq("is_reversed", true);
  if (error) throw error;
  return count ?? 0;
}

/** Finding #060 (RC-16/E13) — whether this company has any Posted
 * journal at all. Used to block changing base currency or financial
 * year start month once real postings exist against the old values —
 * changing either afterward would silently misdate/misdenominate every
 * prior period comparison and currency-denominated report. `.limit(1)`
 * since only existence matters, not a count. */
export async function hasAnyPostedJournal(companyId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("ae_journals").select("*", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "Posted").limit(1);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function listJournalsByStatus(companyId: string, status: JournalStatus): Promise<Journal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_journals")
    .select("*, ae_journal_lines(*)")
    .eq("company_id", companyId)
    .eq("status", status)
    .order("journal_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<JournalRow[]>();
  if (error) throw error;
  return data.map(journalFromRow);
}

/** Every journal for the company, optionally filtered by status — the
 * Journals tab's own listing (a superset of `listJournalsByStatus`, kept
 * separate rather than folding an "all" sentinel into that function's
 * `status` parameter, which is typed as a real `JournalStatus`). */
export async function listJournals(companyId: string, status?: JournalStatus): Promise<Journal[]> {
  const supabase = await createClient();
  let query = supabase.from("ae_journals").select("*, ae_journal_lines(*)").eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("journal_date", { ascending: false }).limit(LIST_CAP).returns<JournalRow[]>();
  if (error) throw error;
  return data.map(journalFromRow);
}

export type ManualJournalHeader = { id: number; journalNumber: string; sourceType: string; reference: string };

/** Master Implementation Tracker — Programme 4, Epic E10, Root Cause
 * RC-6, Finding #049. The Auditor Workspace dashboard used to call the
 * full `listJournals` (every journal, every joined line) just to feed
 * `answerMissingSupportingDocuments`, which only ever needs 4 header
 * columns off `sourceType === "manual"` rows. Filters `source_type`
 * server-side too (the one half of that pure function's rule that's
 * unambiguous to push into SQL without duplicating its "empty reference"
 * business logic in two places) — no join, no unrelated journals. */
export async function listManualJournalHeaders(companyId: string): Promise<ManualJournalHeader[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_journals")
    .select("id, journal_number, source_type, reference")
    .eq("company_id", companyId)
    .eq("source_type", "manual")
    .limit(LIST_CAP)
    .returns<{ id: number; journal_number: string; source_type: string; reference: string }[]>();
  if (error) throw error;
  return data.map((row) => ({ id: row.id, journalNumber: row.journal_number, sourceType: row.source_type, reference: row.reference }));
}

async function setJournalStatus(companyId: string, journalId: number, status: JournalStatus, stampFields: Record<string, string> = {}): Promise<Journal> {
  const supabase = await createClient();
  const { error } = await supabase.from("ae_journals").update({ status, ...stampFields }).eq("company_id", companyId).eq("id", journalId);
  if (error) throw error;
  const journal = await getJournal(companyId, journalId);
  if (!journal) throw new Error(`No journal with id ${journalId}`);
  return journal;
}

/** Workflow transitions — status-legality is the service layer's job
 * (`journal-workflow-service.ts::canTransitionJournalStatus`); this layer
 * just applies the change and stamps who/when, matching the audit-trail
 * pattern already established by `ae_transaction_review_history` etc. */
export async function submitJournal(companyId: string, journalId: number): Promise<Journal> {
  const performedBy = await getPerformedByLabel();
  return setJournalStatus(companyId, journalId, "Submitted", { submitted_by: performedBy, submitted_at: new Date().toISOString() });
}

export async function approveJournal(companyId: string, journalId: number): Promise<Journal> {
  const performedBy = await getPerformedByLabel();
  return setJournalStatus(companyId, journalId, "Approved", { approved_by: performedBy, approved_at: new Date().toISOString() });
}

export async function rejectJournal(companyId: string, journalId: number): Promise<Journal> {
  const performedBy = await getPerformedByLabel();
  return setJournalStatus(companyId, journalId, "Rejected", { rejected_by: performedBy, rejected_at: new Date().toISOString() });
}

export async function cancelJournal(companyId: string, journalId: number): Promise<Journal> {
  const performedBy = await getPerformedByLabel();
  return setJournalStatus(companyId, journalId, "Cancelled", { cancelled_by: performedBy, cancelled_at: new Date().toISOString() });
}

/** Flags the original as reversed and links it to its reversal journal —
 * called once the reversal journal itself has already been created (see
 * `journal-workflow-service.ts::reverseJournal`). Two updates because the
 * reversal's own id doesn't exist until after `createJournal` returns. */
export async function markJournalReversed(companyId: string, originalJournalId: number, reversalJournalId: number): Promise<void> {
  const supabase = await createClient();
  const { error: originalError } = await supabase
    .from("ae_journals")
    .update({ is_reversed: true, reversed_by_journal_id: reversalJournalId })
    .eq("company_id", companyId)
    .eq("id", originalJournalId);
  if (originalError) throw originalError;

  const { error: reversalError } = await supabase
    .from("ae_journals")
    .update({ reversal_of_journal_id: originalJournalId })
    .eq("company_id", companyId)
    .eq("id", reversalJournalId);
  if (reversalError) throw reversalError;
}

/** Phase 25K — guarded by `.is("journal_id", null)`, same conditional-
 * claim discipline as `bulkUpdateWithAllocationHistory`'s
 * `guardPostedTransactions` (`transaction-explorer-repository.ts`): a
 * transaction posted by another process (a concurrent Rule Engine run,
 * or a second "Generate Journal" click) in the window between the
 * caller's own read and this write is no longer linked here, rather
 * than silently re-pointing its `journal_id` to a second, unrelated
 * journal. Returns whether the link actually happened so the caller can
 * report the transaction as skipped instead of silently over-counting it.
 *
 * Migration 0100 — the database also refuses the link when a live Banking
 * Rule journal already carries this transaction (its
 * `ae_bank_transactions_rule_engine_journal_guard` trigger), even though
 * `journal_id` is still NULL. That refusal is the same "not linked"
 * answer, not a crash. */
export async function linkTransactionToJournal(companyId: string, transactionId: number, journalId: number): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .update({ journal_id: journalId })
    .eq("company_id", companyId)
    .eq("id", transactionId)
    .is("journal_id", null)
    .select("id");
  if (error) {
    if (isRuleEngineJournalGuardError(error)) return false;
    throw error;
  }
  return !!data && data.length > 0;
}

/** Migration 0100's trigger refusal (`VYRON_RULE_ENGINE_JOURNAL_EXISTS`). */
export function isRuleEngineJournalGuardError(error: unknown): boolean {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  return message.includes("VYRON_RULE_ENGINE_JOURNAL_EXISTS");
}

// PostgREST puts `.in()` values in the URL; keep each request well under
// its length limit.
const SOURCE_LOOKUP_CHUNK = 200;

/** Migration 0100 — every Banking Rule journal (any status) for the given
 * bank transactions, keyed by transaction id. One query per 200 ids, so a
 * whole worklist or posting selection costs a handful of round trips
 * instead of one per transaction. At most one journal per transaction
 * (unique index `ae_journals_rule_engine_source_key`). */
export async function listRuleEngineJournalsForTransactions(companyId: string, transactionIds: number[]): Promise<Map<number, RuleEngineJournalRef>> {
  const result = new Map<number, RuleEngineJournalRef>();
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) return result;
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += SOURCE_LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + SOURCE_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("ae_journals")
      .select("id, journal_number, status, is_reversed, source_id")
      .eq("company_id", companyId)
      .eq("source_type", RULE_ENGINE_JOURNAL_SOURCE_TYPE)
      .in("source_id", chunk)
      .returns<{ id: number; journal_number: string; status: JournalStatus; is_reversed: boolean | null; source_id: number }[]>();
    if (error) throw error;
    for (const row of data) {
      const sourceId = Number(row.source_id);
      result.set(sourceId, { id: Number(row.id), journalNumber: row.journal_number, status: row.status, isReversed: row.is_reversed ?? false, sourceId });
    }
  }
  return result;
}
