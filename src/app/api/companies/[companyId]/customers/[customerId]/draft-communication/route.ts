import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCustomer } from "@/server/repositories/customer-repository";
import { getCustomerFinancialSummary } from "@/server/services/customer-financial-service";
import { getCompany } from "@/server/services/company-service";
import { draftPaymentReminderMessage, draftWelcomeMessage } from "@/server/copilot/communication-draft-engine";

/** Copilot's "draft, never send" contribution to the Communication
 * Platform — a real, computed suggestion (not a fabricated AI-generated
 * claim, see `communication-draft-engine.ts`) that the caller places
 * into a `<SendCommunicationButton>`'s message field. Only the
 * Communication Platform's own `POST /communications` may actually
 * queue or send it. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  const body = await request.json();
  const customer = await getCustomer(companyId, Number(customerId));
  if (!customer) return NextResponse.json({ error: `No customer with id ${customerId}.` }, { status: 404 });
  const company = await getCompany(companyId);

  if (body.kind === "welcome") {
    return NextResponse.json({ draft: draftWelcomeMessage(customer.name, company?.name ?? "us") });
  }

  const summary = await getCustomerFinancialSummary(companyId, customer);
  return NextResponse.json({ draft: draftPaymentReminderMessage(customer.name, summary.aging, summary.outstandingBalance) });
}
