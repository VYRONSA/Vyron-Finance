import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ForecastResult } from "@/server/reporting/forecast-engine";

function confidenceTone(confidence: number): "good" | "warn" | "danger" {
  if (confidence >= 0.6) return "good";
  if (confidence >= 0.3) return "warn";
  return "danger";
}

function ForecastCard({ title, forecast, unit = "" }: { title: string; forecast: ForecastResult; unit?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-vf-ink">{title}</h3>
          <Badge tone={confidenceTone(forecast.confidence)}>{Math.round(forecast.confidence * 100)}% confidence</Badge>
        </div>
        <p className="mt-1 text-xs text-vf-ink-faint">{forecast.method} · fitted from {forecast.historicalPoints} historical period(s)</p>

        {forecast.forecast.length === 0 ? (
          <p className="mt-3 text-sm text-vf-ink-faint">Not enough historical data to project forward yet.</p>
        ) : (
          <div className="mt-3 flex flex-col">
            {forecast.forecast.map((p) => (
              <div key={p.period} className="flex items-center justify-between border-t border-vf-paper-border py-1.5 text-sm first:border-0">
                <span className="text-vf-ink-soft">{p.period}</span>
                <span className="font-mono tabular-nums text-vf-ink">
                  {unit}
                  {p.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        )}

        <details className="mt-3 text-xs text-vf-ink-faint">
          <summary className="cursor-pointer select-none">Assumptions</summary>
          <ul className="mt-1.5 list-disc pl-4">
            {forecast.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}

export function ForecastingTab({
  cashflow,
  revenue,
  expense,
  vat,
  inventory,
  customerPayment,
  supplierPayment,
}: {
  cashflow: ForecastResult;
  revenue: ForecastResult;
  expense: ForecastResult;
  vat: ForecastResult;
  inventory: ForecastResult;
  customerPayment: ForecastResult;
  supplierPayment: ForecastResult;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">
        Every forecast below is fitted by the same transparent ordinary least-squares linear regression — no black-box model, no overstated certainty. Confidence
        is derived from how well the historical trend fits (R²), not invented.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ForecastCard title="Cashflow" forecast={cashflow} unit="R " />
        <ForecastCard title="Revenue" forecast={revenue} unit="R " />
        <ForecastCard title="Expenses" forecast={expense} unit="R " />
        <ForecastCard title="VAT Payable" forecast={vat} unit="R " />
        <ForecastCard title="Inventory Value" forecast={inventory} unit="R " />
        <ForecastCard title="Customer Payment Days" forecast={customerPayment} />
        <ForecastCard title="Supplier Payment Days" forecast={supplierPayment} />
      </div>
    </div>
  );
}
