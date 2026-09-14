import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import {
  allocateRow,
  applyBulkReview,
  applyNewRuleCompanyWide,
  previewApplyRuleCompanyWide,
  applyRule,
  applyRulesToRemainingBatchTransactions,
  assignCustomer,
  assignGl,
  assignMerchant,
  assignSupplier,
  assignVat,
  deleteImport,
  deleteTransactions,
  generateJournal,
  ValidationError,
} from "@/server/services/transaction-explorer-service";
import { requirePermission } from "@/server/services/permission-service";
import { getTransactionsByIds } from "@/server/repositories/transaction-explorer-repository";
import { isEligibleForAiClassification } from "@/server/ai/transaction-classification/types";
import { classifyTransactionsWithAiManual, MAX_AI_CLASSIFICATIONS_PER_RUN } from "@/server/services/transaction-classification-service";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "review": {
        const transactions = await applyBulkReview(companyId, body.transactionIds ?? [], body.newStatus, body.note ?? "", performedBy);
        return NextResponse.json({ transactions });
      }
      case "assign-supplier": {
        await assignSupplier(companyId, body.transactionIds ?? [], body.supplierId, performedBy);
        return NextResponse.json({ ok: true });
      }
      case "assign-gl": {
        await assignGl(companyId, body.transactionIds ?? [], body.glAccount ?? "", performedBy);
        return NextResponse.json({ ok: true });
      }
      case "assign-vat": {
        await assignVat(companyId, body.transactionIds ?? [], body.vatCode ?? "", performedBy);
        return NextResponse.json({ ok: true });
      }
      case "assign-merchant": {
        await assignMerchant(companyId, body.transactionIds ?? [], body.merchantId, performedBy);
        return NextResponse.json({ ok: true });
      }
      case "assign-customer": {
        await assignCustomer(companyId, body.transactionIds ?? [], body.customerId, performedBy);
        return NextResponse.json({ ok: true });
      }
      case "allocate-row": {
        const result = await allocateRow(
          companyId,
          body.transactionIds ?? [],
          {
            type: body.type,
            accountCode: body.accountCode ?? null,
            supplierId: body.supplierId ?? null,
            customerId: body.customerId ?? null,
            vatCode: body.vatCode ?? null,
            allocationNotes: body.allocationNotes ?? "",
            description: body.description ?? null,
            // Migration 0095 — absent means "unchanged", so an ordinary
            // allocation commit never clears an existing override.
            overrideSupplierInvoiceMatching:
              body.overrideSupplierInvoiceMatching === undefined ? null : body.overrideSupplierInvoiceMatching,
          },
          performedBy,
        );
        // Phase 31 — every requested id was blocked (the common case is a
        // single-row commit whose one transaction was posted between page
        // load and Save) means nothing was actually written, even though
        // every underlying call succeeded without throwing. Reporting that
        // honestly as a 409 — instead of the `{ ok: true }` this used to
        // return unconditionally — is what lets the individual Save button,
        // Accept, and the new bulk "Save Selected" all correctly show this
        // as a failure instead of silently doing nothing. A PARTIAL block
        // (some of many ids, e.g. "apply this allocation to 17 similar
        // transactions") is still a genuine, reportable success for the
        // ids that did update — `blockedIds` travels in the response body
        // either way so callers that care can act on it.
        if (result.updatedIds.length === 0 && result.blockedIds.length > 0) {
          return NextResponse.json(
            { error: "This transaction has already been posted to the general ledger and cannot be modified.", blockedIds: result.blockedIds },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true, updatedIds: result.updatedIds, blockedIds: result.blockedIds });
      }
      case "apply-rule": {
        const results = await applyRule(companyId, body.transactionIds ?? [], performedBy);
        return NextResponse.json({ results });
      }
      case "apply-rule-to-batch": {
        const results = await applyRulesToRemainingBatchTransactions(companyId, body.importBatch ?? "", body.excludeTransactionId ?? null, performedBy, body.newRuleId ?? null);
        return NextResponse.json({ results });
      }
      case "apply-rule-company-wide": {
        if (typeof body.ruleId !== "number") return NextResponse.json({ error: "ruleId is required." }, { status: 400 });
        const summary = await applyNewRuleCompanyWide(companyId, body.ruleId, body.excludeTransactionId ?? null, performedBy);
        return NextResponse.json({ summary });
      }
      // Phase 51 — read-only "how many transactions would this affect?"
      // check the UI now calls BEFORE ever offering to run
      // "apply-rule-company-wide" above, so the accountant sees and
      // explicitly confirms the blast radius first. Writes nothing.
      case "preview-apply-rule-company-wide": {
        if (typeof body.ruleId !== "number") return NextResponse.json({ error: "ruleId is required." }, { status: 400 });
        const preview = await previewApplyRuleCompanyWide(companyId, body.ruleId, body.excludeTransactionId ?? null);
        return NextResponse.json({ preview });
      }
      case "generate-journal": {
        const outcome = await generateJournal(companyId, body.transactionIds ?? []);
        return NextResponse.json({ outcome });
      }
      case "delete-import": {
        const deletedCount = await deleteImport(companyId, body.importType, body.importBatch ?? "");
        return NextResponse.json({ deletedCount });
      }
      case "delete": {
        const result = await deleteTransactions(companyId, body.transactionIds ?? []);
        if (result.deletedIds.length === 0 && result.blockedIds.length > 0) {
          return NextResponse.json(
            { error: "Cannot delete posted transaction. It has already been posted to the General Ledger.", blockedIds: result.blockedIds },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true, deletedIds: result.deletedIds, blockedIds: result.blockedIds });
      }
      case "classify-with-ai": {
        // Phase 22B — billing gating lives here, at the route layer,
        // mirroring copilot/ask/route.ts's own hasFeature -> checkUsageLimit
        // -> do-the-work -> (usage recorded on success inside the service)
        // sequence exactly. `Banking:Edit` (already checked above, once,
        // for the whole route) is the only permission this needs — AI
        // classification writes the SAME `suggested_gl_account` field a
        // manual GL assignment already does, so no new permission key.
        const transactionIds: number[] = body.transactionIds ?? [];

        if (!(await hasFeature(companyId, "ai_copilot"))) {
          return NextResponse.json({ error: "AI classification is not included in your current plan." }, { status: 403 });
        }

        let maxCount = MAX_AI_CLASSIFICATIONS_PER_RUN;
        if (transactionIds.length > 0) {
          const candidates = await getTransactionsByIds(companyId, transactionIds);
          const eligibleCount = Math.min(candidates.filter(isEligibleForAiClassification).length, MAX_AI_CLASSIFICATIONS_PER_RUN);
          if (eligibleCount > 0) {
            const usageCheck = await checkUsageLimit(companyId, "max_ai_requests_monthly", eligibleCount);
            if (!usageCheck.allowed) {
              const remaining = usageCheck.limit === null ? eligibleCount : Math.max(0, usageCheck.limit - usageCheck.used);
              if (remaining === 0) {
                return NextResponse.json({ error: usageCheck.reason ?? "AI classification limit reached for your plan this month." }, { status: 403 });
              }
              // Partial allowance remaining (section 6D) — classify as
              // many of the eligible transactions as the plan honestly
              // allows, rather than rejecting the whole request; the rest
              // come back in `outcome.skipped` with an honest reason.
              maxCount = remaining;
            }
          }
        }

        const outcome = await classifyTransactionsWithAiManual(companyId, transactionIds, performedBy, maxCount);
        return NextResponse.json({ outcome });
      }
      default:
        return NextResponse.json({ error: `Unknown bulk action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
