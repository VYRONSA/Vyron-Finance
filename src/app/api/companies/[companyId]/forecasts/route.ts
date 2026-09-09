import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  getCashflowForecast,
  getCustomerPaymentForecast,
  getExpenseForecast,
  getInventoryForecast,
  getRevenueForecast,
  getSupplierPaymentForecast,
  getVatForecast,
} from "@/server/services/forecast-service";

const FORECAST_GETTERS = {
  cashflow: getCashflowForecast,
  revenue: getRevenueForecast,
  expense: getExpenseForecast,
  vat: getVatForecast,
  inventory: getInventoryForecast,
  "customer-payment": getCustomerPaymentForecast,
  "supplier-payment": getSupplierPaymentForecast,
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as keyof typeof FORECAST_GETTERS | null;
  const referenceDate = url.searchParams.get("referenceDate") ?? new Date().toISOString().slice(0, 10);

  if (!type || !(type in FORECAST_GETTERS)) {
    return NextResponse.json({ error: `type must be one of: ${Object.keys(FORECAST_GETTERS).join(", ")}.` }, { status: 400 });
  }

  const forecast = await FORECAST_GETTERS[type](companyId, referenceDate);
  return NextResponse.json({ forecast });
}
