/**
 * SD-3D — supplier-statement reconciliation: runs, decisions, history.
 *
 * READ-ONLY FROM AN ACCOUNTING PERSPECTIVE. A run reads the statement and
 * the supplier's records, asks the pure engine to classify the differences,
 * and stores the result as an immutable run together with EVERYTHING it was
 * computed from (the input snapshot) and that snapshot's SHA-256 — so any
 * run can be replayed and must reproduce itself exactly
 * (`verifyStatementReconciliation`).
 *
 * It never writes a journal, bill, payment, allocation, GL row or supplier
 * balance, and never creates an adjustment to make a statement agree.
 */
import { createHash } from "node:crypto";
import * as repo from "@/server/repositories/supplier-statement-reconciliation-repository";
import * as statements from "@/server/repositories/supplier-statement-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import {
  canonicalJson,
  ENGINE_VERSION,
  reconcileStatement,
  type EngineInput,
  type EngineResult,
  type LedgerRefType,
  type ResolutionInput,
} from "@/server/supplier-statements/reconciliation-engine";
import { buildLedgerRecords, buildUnpostedRecords } from "@/server/supplier-statements/reconciliation-input";

export class ReconciliationError extends Error {}
export class NotFoundError extends Error {}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function fingerprint(input: EngineInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** Gathers the engine input for a statement, as things stand now. */
async function buildInput(companyId: string, statement: statements.StatementRow): Promise<EngineInput> {
  const supplierId = statement.supplier_id!;
  const [lines, resolutions, sources, captures] = await Promise.all([
    statements.listStatementLinesAsSystem(companyId, statement.id),
    repo.listResolutionsAsSystem(companyId, statement.id),
    repo.loadSupplierSources(companyId, supplierId),
    repo.loadSupplierCaptures(companyId, supplierId),
  ]);
  const unpostedBillIds = sources.bills.map((b) => b.id);
  const captureBillIds = await repo.loadCaptureBillIds(companyId, unpostedBillIds);

  return {
    engineVersion: ENGINE_VERSION,
    statement: {
      id: statement.id,
      statementDate: statement.statement_date!,
      periodFrom: statement.period_from,
      openingBalance: num(statement.opening_balance)!,
      closingBalance: num(statement.closing_balance)!,
      signConvention: statement.sign_convention,
    },
    lines: lines
      .filter((l) => !l.is_excluded)
      .map((l) => ({
        id: l.id,
        lineOrder: l.line_order,
        pageNumber: l.page_number,
        date: l.transaction_date,
        reference: l.reference_text,
        description: l.description,
        type: l.transaction_type,
        debit: num(l.debit),
        credit: num(l.credit),
      })),
    ledger: buildLedgerRecords(sources, supplierId, statement.statement_date!),
    unposted: buildUnpostedRecords(sources, captures, captureBillIds, supplierId),
    resolutions: resolutions.map(
      (r): ResolutionInput => ({
        id: r.id,
        action: r.action,
        lineId: r.statement_line_id,
        refType: r.precisia_ref_type as ResolutionInput["refType"],
        refId: r.precisia_ref_id,
        revokesId: r.revokes_resolution_id,
        reason: r.reason,
      }),
    ),
  };
}

export type RunSummary = {
  id: number;
  runNumber: number;
  fingerprint: string;
  statementClosing: number;
  precisiaBalance: number;
  difference: number;
  explained: number;
  unexplained: number;
};

/** Runs (or reruns) the reconciliation of a READY statement against its
 * CONFIRMED supplier. */
export async function runStatementReconciliation(companyId: string, statementId: number): Promise<RunSummary> {
  // Read under the caller's session first: RLS decides whether they may see it.
  const visible = await statements.getStatement(companyId, statementId);
  if (!visible) throw new NotFoundError(`No statement with id ${statementId}.`);
  if (visible.status !== "Ready" && visible.status !== "Reconciled") {
    throw new ReconciliationError(`Only a statement marked ready can be reconciled (this one is ${visible.status}).`);
  }
  if (!visible.supplier_id || !visible.supplier_confirmed_at) throw new ReconciliationError("Confirm the supplier before reconciling.");
  if (!visible.statement_date || num(visible.opening_balance) === null || num(visible.closing_balance) === null) {
    throw new ReconciliationError("The statement needs its date, opening and closing balance before it can be reconciled.");
  }
  const base = await statements.getCompanyBaseCurrency(companyId);
  if (visible.currency_code && visible.currency_code !== base) {
    throw new ReconciliationError(`Unsupported currency (${visible.currency_code}): manual review required. No exchange rate is applied.`);
  }

  const performedBy = await getPerformedByLabel();
  const input = await buildInput(companyId, visible);
  const result = reconcileStatement(input);
  const print = fingerprint(input);
  const runNumber = await repo.nextRunNumber(companyId, statementId);

  const runId = await repo.insertRun(
    {
      company_id: companyId,
      statement_id: statementId,
      run_number: runNumber,
      engine_version: ENGINE_VERSION,
      basis: "supplier-ledger-document-date",
      supplier_id: visible.supplier_id,
      as_at_date: result.windowTo,
      window_from: result.windowFrom,
      window_to: result.windowTo,
      statement_opening: result.statementOpening,
      statement_closing: result.statementClosing,
      precisia_balance_before_window: result.balanceBeforeWindow,
      precisia_balance_at: result.balanceAt,
      difference: result.difference,
      explained_amount: result.explained,
      explained_by_reviewer_amount: result.explainedByReviewer,
      unexplained_amount: result.unexplained,
      category_summary: { ...result.summary, __residual: { count: 0, amount: result.residual } },
      input_snapshot: input,
      input_fingerprint: print,
      created_by: performedBy,
    },
    result.items.map((i) => ({
      item_order: i.order,
      statement_line_id: i.lineId,
      statement_line_order: i.lineOrder,
      category: i.category,
      sub_status: i.subStatus,
      match_tier: i.matchTier,
      precisia_ref_type: i.refType,
      precisia_ref_id: i.refId,
      related_refs: i.relatedRefs,
      suggestions: i.suggestions,
      statement_amount: i.statementAmount,
      precisia_amount: i.precisiaAmount,
      amount_difference: i.amountDifference,
      effect_on_difference: i.effect,
      explained: i.explained,
      explained_by_resolution_id: i.explainedByResolutionId,
      message: i.message,
    })),
    companyId,
  );
  await repo.markStatementReconciled(companyId, statementId);
  await statements.recordSystemStatementEvent(
    companyId,
    statementId,
    "ReconciliationRun",
    { runId, runNumber, engineVersion: ENGINE_VERSION, fingerprint: print, difference: result.difference, unexplained: result.unexplained, items: result.items.length },
    performedBy,
  );
  return {
    id: runId,
    runNumber,
    fingerprint: print,
    statementClosing: result.statementClosing,
    precisiaBalance: result.balanceAt,
    difference: result.difference,
    explained: result.explained,
    unexplained: result.unexplained,
  };
}

const REF_TYPES: ReadonlySet<string> = new Set<LedgerRefType | "opening-difference">([
  "bill", "credit-note", "debit-note", "supplier-payment", "bank-transaction", "opening-balance", "opening-difference",
]);

export type ResolutionRequest = {
  action: "manual-link" | "explained" | "revoke";
  statementLineId?: number | null;
  refType?: string | null;
  refId?: number | null;
  revokesResolutionId?: number | null;
  reason: string;
};

/** Records a reviewer's decision (append-only). Takes effect at the next run. */
export async function recordStatementResolution(companyId: string, statementId: number, request: ResolutionRequest): Promise<number> {
  if (!["manual-link", "explained", "revoke"].includes(request.action)) throw new ReconciliationError("Unknown decision.");
  if (!request.reason || request.reason.trim().length < 3) throw new ReconciliationError("Give a reason for this decision.");
  if (request.refType && !REF_TYPES.has(request.refType)) throw new ReconciliationError("Unknown record type.");
  const id = await repo.recordResolution({
    companyId,
    statementId,
    action: request.action,
    statementLineId: request.statementLineId ?? null,
    refType: request.refType ?? null,
    refId: request.refId ?? null,
    revokesResolutionId: request.revokesResolutionId ?? null,
    reason: request.reason.trim(),
  });
  // Ids only — the reason lives on the resolution itself.
  await statements.recordStatementEvent(companyId, statementId, request.action === "revoke" ? "ResolutionRevoked" : "ResolutionRecorded", {
    resolutionId: id,
    action: request.action,
    revokes: request.revokesResolutionId ?? null,
  });
  return id;
}

export async function listStatementReconciliations(companyId: string, statementId: number) {
  const [runs, resolutions] = await Promise.all([repo.listRuns(companyId, statementId), repo.listResolutions(companyId, statementId)]);
  const latest = runs[0];
  return {
    runs: runs.map((r) => ({
      id: r.id,
      runNumber: r.run_number,
      engineVersion: r.engine_version,
      asAt: r.as_at_date,
      statementClosing: num(r.statement_closing),
      precisiaBalance: num(r.precisia_balance_at),
      difference: num(r.difference),
      explained: num(r.explained_amount),
      explainedByReviewer: num(r.explained_by_reviewer_amount),
      unexplained: num(r.unexplained_amount),
      summary: r.category_summary,
      fingerprint: r.input_fingerprint,
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
    resolutions: resolutions.map((r) => ({
      id: r.id,
      action: r.action,
      statementLineId: r.statement_line_id,
      refType: r.precisia_ref_type,
      refId: r.precisia_ref_id,
      revokes: r.revokes_resolution_id,
      reason: r.reason,
      performedBy: r.performed_by,
      createdAt: r.created_at,
      revoked: resolutions.some((x) => x.revokes_resolution_id === r.id),
    })),
    /** Decisions recorded after the latest run are not reflected until the
     * next run. */
    stale: !!latest && resolutions.some((r) => r.created_at > latest.created_at),
  };
}

export async function getStatementReconciliation(companyId: string, statementId: number, runId: number) {
  const found = await repo.getRun(companyId, statementId, runId);
  if (!found) return null;
  const { run, items } = found;
  return {
    run: {
      id: run.id,
      runNumber: run.run_number,
      engineVersion: run.engine_version,
      basis: run.basis,
      supplierId: run.supplier_id,
      asAt: run.as_at_date,
      windowFrom: run.window_from,
      windowTo: run.window_to,
      statementOpening: num(run.statement_opening),
      statementClosing: num(run.statement_closing),
      precisiaBalanceBeforeWindow: num(run.precisia_balance_before_window),
      precisiaBalance: num(run.precisia_balance_at),
      difference: num(run.difference),
      explained: num(run.explained_amount),
      explainedByReviewer: num(run.explained_by_reviewer_amount),
      unexplained: num(run.unexplained_amount),
      summary: run.category_summary,
      fingerprint: run.input_fingerprint,
      createdBy: run.created_by,
      createdAt: run.created_at,
    },
    items: items.map((i) => ({
      order: i.item_order,
      statementLineId: i.statement_line_id,
      statementLineOrder: i.statement_line_order,
      category: i.category,
      subStatus: i.sub_status,
      matchTier: i.match_tier,
      refType: i.precisia_ref_type,
      refId: i.precisia_ref_id,
      relatedRefs: i.related_refs,
      suggestions: i.suggestions,
      statementAmount: num(i.statement_amount),
      precisiaAmount: num(i.precisia_amount),
      amountDifference: num(i.amount_difference),
      effect: num(i.effect_on_difference),
      explained: i.explained,
      explainedByResolutionId: i.explained_by_resolution_id,
      message: i.message,
    })),
  };
}

/** Replays a stored run from its persisted input snapshot and checks that the
 * fingerprint and every stored result reproduce exactly. */
export async function verifyStatementReconciliation(companyId: string, statementId: number, runId: number): Promise<{ fingerprintMatches: boolean; resultMatches: boolean }> {
  const found = await repo.getRun(companyId, statementId, runId);
  if (!found) throw new NotFoundError(`No reconciliation run ${runId}.`);
  const input = found.run.input_snapshot as EngineInput;
  const replay: EngineResult = reconcileStatement(input);
  const fingerprintMatches = fingerprint(input) === found.run.input_fingerprint;
  const stored = found.items.map((i) => [i.item_order, i.category, i.sub_status, i.match_tier, i.precisia_ref_type, i.precisia_ref_id, num(i.effect_on_difference), i.explained, i.statement_line_id]);
  const replayed = replay.items.map((i) => [i.order, i.category, i.subStatus, i.matchTier, i.refType, i.refId, i.effect, i.explained, i.lineId]);
  const resultMatches =
    JSON.stringify(stored) === JSON.stringify(replayed) &&
    num(found.run.difference) === replay.difference &&
    num(found.run.explained_amount) === replay.explained &&
    num(found.run.unexplained_amount) === replay.unexplained &&
    num(found.run.precisia_balance_at) === replay.balanceAt;
  return { fingerprintMatches, resultMatches };
}
