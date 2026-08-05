import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import {
  applyBulkReview,
  applyRule,
  applyRulesToRemainingBatchTransactions,
  assignCustomer,
  assignGl,
  assignMerchant,
  assignSupplier,
  assignVat,
  deleteImport,
  generateJournal,
  ValidationError,
} from "@/server/services/transaction-explorer-service";
import { requirePermission } from "@/server/services/permission-service";

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
      case "apply-rule": {
        const results = await applyRule(companyId, body.transactionIds ?? [], performedBy);
        return NextResponse.json({ results });
      }
      case "apply-rule-to-batch": {
        const results = await applyRulesToRemainingBatchTransactions(companyId, body.importBatch ?? "", body.excludeTransactionId ?? null, performedBy);
        return NextResponse.json({ results });
      }
      case "generate-journal": {
        const outcome = await generateJournal(companyId, body.transactionIds ?? []);
        return NextResponse.json({ outcome });
      }
      case "delete-import": {
        const deletedCount = await deleteImport(companyId, body.importType, body.importBatch ?? "");
        return NextResponse.json({ deletedCount });
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
