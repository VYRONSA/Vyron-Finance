import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSubscriptionForCompany, resumeSubscription, SubscriptionNotFoundError, ProviderRequiredError } from "@/server/billing-platform/engine/billing-engine";

export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageBilling");
  if (!check.ok) return check.response;

  const subscription = await getSubscriptionForCompany(companyId);
  if (!subscription) return NextResponse.json({ error: "This company has no billing subscription yet." }, { status: 404 });

  const performedBy = await getPerformedByLabel();

  try {
    const updated = await resumeSubscription(subscription.id, performedBy);
    return NextResponse.json({ subscription: updated });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ProviderRequiredError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
