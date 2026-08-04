import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSubscriptionForCompany, cancelSubscription, SubscriptionNotFoundError } from "@/server/billing-platform/engine/billing-engine";

/** Customer Portal — Cancel. Never requires a payment provider (see
 * `billing-engine.ts::cancelSubscription`'s own docstring); real either
 * way, whether or not Stripe is connected. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageBilling");
  if (!check.ok) return check.response;

  const subscription = await getSubscriptionForCompany(companyId);
  if (!subscription) return NextResponse.json({ error: "This company has no billing subscription yet." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const cancelImmediately = Boolean(body.cancelImmediately);
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "Cancelled by customer via Billing Portal.";
  const performedBy = await getPerformedByLabel();

  try {
    const updated = await cancelSubscription({ subscriptionId: subscription.id, cancelImmediately, reason, performedBy });
    return NextResponse.json({ subscription: updated });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
