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
  prepareConversion,
  revalidateCapture,
  startManualEntry,
  submitForReview,
  ValidationError,
} from "@/server/services/supplier-invoice-capture-service";
import { getPerformedByLabel } from "@/server/auth/require-session";

/** A refusal raised by the database guard (0111/0112) — the caller lacked
 * the permission or the capture was not in a state that allows the change.
 * Reported as such rather than as a server error. */
function isDatabaseRefusal(error: unknown): error is { code: string; message: string } {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "42501";
}

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
        const lines = body.lines ?? [];
        const add = body.add ?? [];
        const remove = body.remove ?? [];
        if (!Array.isArray(lines) || !Array.isArray(add) || !Array.isArray(remove) || !remove.every((n: unknown) => Number.isInteger(n))) {
          return NextResponse.json({ error: "lines and add must be arrays, and remove an array of line numbers." }, { status: 400 });
        }
        await applyLineCorrections(companyId, id, lines, { add, remove });
        break;
      }
      case "manual-entry": {
        // SD-1 — enter the invoice by hand from the original document.
        const check = await requirePermission(companyId, "Purchasing:Edit");
        if (!check.ok) return check.response;
        await startManualEntry(companyId, id);
        break;
      }
      case "submit-for-review": {
        const check = await requirePermission(companyId, "Purchasing:Edit");
        if (!check.ok) return check.response;
        await submitForReview(companyId, id);
        break;
      }
      case "revalidate": {
        // Corrections re-validate automatically; this re-runs it on demand
        // (for example after a concurrent edit left the verdict Pending).
        const check = await requirePermission(companyId, "Purchasing:Edit");
        if (!check.ok) return check.response;
        await revalidateCapture(companyId, id, await getPerformedByLabel());
        break;
      }
      case "cancel": {
        // Phase SD-0 — rejecting a supplier invoice is a Reject, not an
        // Edit; the database guard (0111) enforces the same permission.
        const check = await requirePermission(companyId, "Purchasing:Reject");
        if (!check.ok) return check.response;
        await cancelCapture(companyId, id);
        break;
      }
      case "convert": {
        const createCheck = await requirePermission(companyId, "Purchasing:Create");
        if (!createCheck.ok) return createCheck.response;

        // SD-1 — every refusal is evaluated first, and the amount the
        // approval limit is checked against is the amount the Draft document
        // will carry: computed by the purchase-bill engine from the reviewed
        // lines (raised to the reviewed printed total when that is larger).
        // Never the extracted header total, and never 0 for a missing one.
        const { approvalAmount } = await prepareConversion(companyId, id);

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
          approvalAmount,
        );
        if (!approvalCheck.ok) return approvalCheck.response;

        const { billId } = await convertCaptureToBill(companyId, id, approvalAmount);
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
    if (isDatabaseRefusal(error)) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
