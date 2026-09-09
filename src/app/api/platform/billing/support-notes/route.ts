import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePlatformPermission } from "@/server/services/permission-service";
import { addSupportNote } from "@/server/billing-platform/repositories/support-note-repository";

/** Internal Billing Console — add a support note against a billing
 * account. Platform-scope only, mirrors the Customer Portal's own
 * action-route shape (auth -> permission -> validate -> call the
 * repository, no service layer needed since this is a single insert
 * with no business logic beyond the permission gate). */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const access = await requirePlatformPermission("ManageBilling");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => ({}));
  const billingAccountId = typeof body.billingAccountId === "string" ? body.billingAccountId : null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!billingAccountId || !note) {
    return NextResponse.json({ error: "billingAccountId and note are required." }, { status: 400 });
  }

  const performedBy = await getPerformedByLabel();
  const created = await addSupportNote(billingAccountId, note, performedBy);
  return NextResponse.json({ note: created }, { status: 201 });
}
