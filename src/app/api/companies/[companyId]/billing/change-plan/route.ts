import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSubscriptionForCompany, changeSubscriptionPlan, SubscriptionNotFoundError, PlanNotFoundError, ProviderRequiredError } from "@/server/billing-platform/engine/billing-engine";
import { PLAN_KEYS, BILLING_CYCLES, type PlanKey, type BillingCycle } from "@/server/billing-platform/types";

function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}
function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value);
}

/** Customer Portal — Upgrade/Downgrade (the same real operation, see
 * `billing-engine.ts::changeSubscriptionPlan`'s own docstring). Moving
 * to/from any priced plan without a connected provider returns `409`
 * with a clear reason — an honest block, not a fabricated success. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageBilling");
  if (!check.ok) return check.response;

  const subscription = await getSubscriptionForCompany(companyId);
  if (!subscription) return NextResponse.json({ error: "This company has no billing subscription yet." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (!isPlanKey(body.newPlanKey) || !isBillingCycle(body.newBillingCycle)) {
    return NextResponse.json({ error: "newPlanKey and newBillingCycle are required and must be valid." }, { status: 400 });
  }

  const performedBy = await getPerformedByLabel();

  try {
    const updated = await changeSubscriptionPlan({ subscriptionId: subscription.id, newPlanKey: body.newPlanKey, newBillingCycle: body.newBillingCycle, performedBy });
    return NextResponse.json({ subscription: updated });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError || error instanceof PlanNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ProviderRequiredError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
