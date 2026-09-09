import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createManualExplorerTransaction, listTransactions, parseFilters, ValidationError } from "@/server/services/transaction-explorer-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);

  try {
    const filters = parseFilters(url.searchParams);
    const cursor = url.searchParams.get("cursor");
    const pageSizeRaw = url.searchParams.get("pageSize");
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
    const result = await listTransactions(companyId, filters, cursor, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

/** Phase 39 — "+ Add Transaction." A real write (not a query-param
 * request), so it gets the same `requireSession`/`requirePermission`
 * shape every mutating Transaction Explorer route already uses (see
 * `transactions/bulk/route.ts`), not just `requireSession` alone. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const performedBy = await getPerformedByLabel();
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  try {
    const transaction = await createManualExplorerTransaction(
      companyId,
      {
        bankAccountId: Number(body.bankAccountId),
        transactionDate: body.transactionDate ?? "",
        reference: body.reference ?? "",
        description: body.description ?? "",
        beneficiary: body.beneficiary ?? "",
        debit: Number(body.debit) || 0,
        credit: Number(body.credit) || 0,
        balance: body.balance === null || body.balance === undefined || body.balance === "" ? null : Number(body.balance),
        glAccount: body.glAccount ?? "",
        vat: Number(body.vat) || 0,
        notes: body.notes ?? "",
        supplierId: body.supplierId ?? null,
        customerId: body.customerId ?? null,
      },
      performedBy,
    );
    return NextResponse.json({ transaction });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
