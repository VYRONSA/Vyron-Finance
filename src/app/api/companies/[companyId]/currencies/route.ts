import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listCompanyCurrencies, listCurrencies, setCompanyCurrencyEnabled } from "@/server/services/currency-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const [currencies, companyCurrencies] = await Promise.all([listCurrencies(), listCompanyCurrencies(companyId)]);
  return NextResponse.json({ currencies, companyCurrencies });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Create");
  if (!check.ok) return check.response;

  const companyCurrency = await setCompanyCurrencyEnabled(companyId, body.currencyCode, body.isActive ?? true);
  return NextResponse.json({ companyCurrency });
}
