import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requireApproval, requirePermission } from "@/server/services/permission-service";
import {
  applyHeaderCorrection,
  applyLineCorrections,
  cancelCapture,
  convertCaptureToBill,
  getCapture,
  listCaptureEvents,
  listCaptureLines,
  NotFoundError,
  ValidationError,
} from "@/server/services/supplier-invoice-capture-service";

/** One capture, with its lines and its audit trail — everything the review
 * screen needs in one round trip. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; captureId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, captureId } = await params;
  // Checked BEFORE the lookup, so a 403 cannot be probed into a 404 — the
  // same ordering `sales/invoices/[invoiceId]` adopted in Phase 5I.
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;

  const id = Number(captureId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Unknown invoice." }, { status: 400 });

  const capture = await getCapture(companyId, id);
  if (!capture) return NextResponse.json({ error: "Unknown invoice." }, { status: 404 });

  const [lines, events] = await Promise.all([listCaptureLines(companyId, id), listCaptureEvents(companyId, id)]);
  return NextResponse.json({ capture, lines, events });
}

/**
 * Review actions.
 *
 * `convert` is the accounting boundary and is gated twice: `Purchasing:Create`
 * to create the bill at all, and `requireApproval` against the reviewer's
 * own role-based limit for the invoice's value. The actor is the SESSION's —
 * `convertCaptureToBill` reads it from `getPerformedByLabel()` and this
 * route never passes one. VYRON COST took `approvedBy` from the request
 * body on an audited financial action.
 *
 * There is deliberately no `force` action, no override and no PIN.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; captureId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, captureId } = await params;
  const id = Number(captureId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Unknown invoice." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  try {
    switch (action) {
      case "correct-header": {
        const check = await requirePermission(companyId, "Purchasing:Edit");
        if (!check.ok) return check.response;
        await applyHeaderCorrection(companyId, id, body.header ?? {});
        break;
      }
      case "correct-lines": {
        const check = await requirePermission(companyId, "Purchasing:Edit");
        if (!check.ok) return check.response;
        if (!Array.isArray(body.lines)) return NextResponse.json({ error: "lines must be an array." }, { status: 400 });
        await applyLineCorrections(companyId, id, body.lines);
        break;
      }
      case "cancel": {
        const check = await requirePermission(companyId, "Purchasing:Edit");
        if (!check.ok) return check.response;
        await cancelCapture(companyId, id);
        break;
      }
      case "convert": {
        const createCheck = await requirePermission(companyId, "Purchasing:Create");
        if (!createCheck.ok) return createCheck.response;

        const capture = await getCapture(companyId, id);
        if (!capture) return NextResponse.json({ error: "Unknown invoice." }, { status: 404 });

        // The reviewer's own delegated authority, against this invoice's
        // value — the same mechanism a credit note's approval uses. A
        // shared PIN, as VYRON COST used, is not a substitute for knowing
        // who may approve how much.
        const approvalCheck = await requireApproval(
          companyId,
          "Purchasing:Approve",
          // An EXISTING approval category — purchasing approvals already
          // have one, and inventing a category would put this outside the
          // limits an administrator has already configured.
          "PurchaseApproval",
          Number(capture.total ?? 0),
        );
        if (!approvalCheck.ok) return approvalCheck.response;

        const { billId } = await convertCaptureToBill(companyId, id);
        return NextResponse.json({ billId }, { status: 201 });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${action}'.` }, { status: 400 });
    }

    const [capture, lines] = await Promise.all([getCapture(companyId, id), listCaptureLines(companyId, id)]);
    return NextResponse.json({ capture, lines });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
