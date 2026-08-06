import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  createBillFromOrder,
  createPurchaseBill,
  listPurchaseBills,
  listPurchaseBillsBySupplier,
  NotFoundError,
  ValidationError,
} from "@/server/services/purchase-bill-service";
import { requirePermission } from "@/server/services/permission-service";

/** Only bills entered through the Purchasing workflow (`origin =
 * 'Purchasing'`) — imported bills stay visible via Supplier
 * Reconciliation, unaffected by this module. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const supplierIdParam = url.searchParams.get("supplierId");

  const bills = supplierIdParam ? await listPurchaseBillsBySupplier(companyId, Number(supplierIdParam)) : await listPurchaseBills(companyId);
  return NextResponse.json({ bills });
}

/** Either a real Order -> Bill conversion (`orderId`/`invoiceNumber`/
 * `invoiceDate`/`vatTreatmentCode`, no subtotal — the service sums the
 * order's own lines and requires it to be fully `Received` first), a
 * multi-line bill (`supplierId`/`invoiceNumber`/`invoiceDate`/`lines`
 * — "Additional Requirement: Purchase Processing"), or the legacy
 * single-amount path (`supplierId`/`invoiceNumber`/`invoiceDate`/
 * `vatTreatmentCode`/`subtotal`) — `createPurchaseBill` itself
 * dispatches on whether `lines` is present. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  try {
    if (body.orderId) {
      const bill = await createBillFromOrder(companyId, Number(body.orderId), body.invoiceNumber, body.invoiceDate, body.vatTreatmentCode);
      return NextResponse.json({ bill }, { status: 201 });
    }
    const bill = await createPurchaseBill(companyId, body);
    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
