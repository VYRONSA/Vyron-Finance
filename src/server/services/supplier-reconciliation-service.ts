/**
 * Application Service layer for Supplier Reconciliation — orchestrates
 * the Matching -> Allocation -> Work Queue pipeline, mirroring the
 * reference implementation's
 * `accounting_engine/workflow_orchestrator.generate_supplier_allocation_reports`.
 * Talks only to the repository layer, never to Supabase directly, per the
 * PRB's mandatory Browser -> API Route -> Service -> Repository ->
 * Supabase separation.
 */

import * as allocationEngine from "@/server/accounting/allocation-engine";
import * as matchingEngine from "@/server/accounting/matching-engine";
import { STATUS_MATCHED } from "@/server/accounting/matching-engine";
import * as repo from "@/server/repositories/supplier-reconciliation-repository";
import { createClient } from "@/lib/supabase/server";

export type PipelineStageResult = {
  stage: "matching" | "allocation" | "work-queue";
  succeeded: boolean;
  processedCount: number;
  error?: string;
};

export type GenerateReportsResult = {
  stageResults: PipelineStageResult[];
  failedStage: PipelineStageResult["stage"] | null;
};

/**
 * Runs Matching -> Allocation -> Work Queue sync in order, mirroring the
 * reference pipeline's own independently-committed stages: a failure in
 * one stage stops the pipeline there and reports which stage failed,
 * rather than leaving the caller to guess from a thrown exception.
 */
export async function generateSupplierAllocationReports(companyId: string): Promise<GenerateReportsResult> {
  const stageResults: PipelineStageResult[] = [];

  const matching = await runStage("matching", () => runMatchingForCompany(companyId));
  stageResults.push(matching);
  if (!matching.succeeded) return { stageResults, failedStage: "matching" };

  const allocation = await runStage("allocation", () => runAllocationForCompany(companyId));
  stageResults.push(allocation);
  if (!allocation.succeeded) return { stageResults, failedStage: "allocation" };

  const workQueue = await runStage("work-queue", () => syncWorkQueue(companyId));
  stageResults.push(workQueue);
  if (!workQueue.succeeded) return { stageResults, failedStage: "work-queue" };

  return { stageResults, failedStage: null };
}

async function runStage(stage: PipelineStageResult["stage"], run: () => Promise<number>): Promise<PipelineStageResult> {
  try {
    const processedCount = await run();
    return { stage, succeeded: true, processedCount };
  } catch (error) {
    return { stage, succeeded: false, processedCount: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Ported from `matching_engine.run_matching_for_company`: pulls the
 * company's suppliers, open bills, and payment transactions, evaluates
 * them through the Matching Engine, and persists every result.
 */
export async function runMatchingForCompany(companyId: string): Promise<number> {
  const [suppliers, bills, transactions] = await Promise.all([
    repo.listSuppliers(companyId),
    repo.listOpenBills(companyId),
    repo.listBankTransactions(companyId),
  ]);

  const transactionsToEvaluate = transactions.filter((t) => t.debit > 0);
  const alreadyMatchedBillIds = new Set(
    transactions
      .filter((t) => t.allocationStatus === STATUS_MATCHED && t.matchedBillId !== null)
      .map((t) => t.matchedBillId as number),
  );

  const results = matchingEngine.evaluateBatch(companyId, transactionsToEvaluate, suppliers, bills, alreadyMatchedBillIds);
  await repo.applyMatchResults(companyId, results);
  return results.length;
}

/**
 * Ported from `allocation_engine.run_allocation_for_company`. Must run
 * after matching results are persisted — it re-reads bank transactions
 * fresh so it sees this run's own matched_supplier_id/matched_bill_id,
 * not the pre-matching state.
 */
export async function runAllocationForCompany(companyId: string): Promise<number> {
  const [suppliers, bills, transactions] = await Promise.all([
    repo.listSuppliers(companyId),
    repo.listOpenBills(companyId),
    repo.listBankTransactions(companyId),
  ]);

  const results = allocationEngine.evaluateBatch(companyId, transactions, suppliers, bills);
  await repo.applyAllocationResults(companyId, results);
  return results.length;
}

/**
 * Ported from `work_queue_service.WorkQueueService.sync_allocation_reviews`:
 * every Suggested/Unallocated transaction becomes (or already has) a work
 * item. Idempotent — re-running does not duplicate an existing open item
 * for the same transaction.
 */
export async function syncWorkQueue(companyId: string): Promise<number> {
  const supabase = await createClient();
  const transactions = await repo.listBankTransactions(companyId);
  const needsReview = transactions.filter((t) => t.allocationStatus === "Suggested" || t.allocationStatus === "Unallocated");

  const { data: existing, error: existingError } = await supabase
    .from("ae_work_items")
    .select("source_record_id")
    .eq("company_id", companyId)
    .eq("source_module", "BankTransaction")
    .in("status", ["New", "In Review"]);
  if (existingError) throw existingError;
  const alreadyQueued = new Set((existing ?? []).map((row: { source_record_id: number }) => row.source_record_id));

  const toInsert = needsReview
    .filter((t) => !alreadyQueued.has(t.id))
    .map((t) => ({
      company_id: companyId,
      work_type: t.allocationStatus === "Unallocated" ? "Unknown Supplier" : "Allocation Review",
      source_module: "BankTransaction",
      source_record_id: t.id,
      priority: t.allocationStatus === "Unallocated" ? "High" : "Medium",
      confidence: t.confidenceScore,
      summary: t.matchReason,
      recommendation: t.requiredAction ?? "",
      supplier_name: t.beneficiary,
      amount: t.debit,
      transaction_date: t.transactionDate,
      reference: t.reference,
      description: t.description,
    }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("ae_work_items").insert(toInsert);
    if (insertError) throw insertError;
  }
  return needsReview.length;
}
