"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { SCENARIO_TYPES, type CopilotScenario, type ScenarioType } from "@/server/copilot/types";
import type { ScenarioImpact } from "@/server/copilot/scenario-engine";

const SCENARIO_LABELS: Record<ScenarioType, string> = {
  SalesIncrease: "Increase Sales by %",
  ReceiptDelay: "Delay Customer Receipts",
  SupplierPriceIncrease: "Increase Supplier Prices by %",
  AssetReplacement: "Replace a Fixed Asset",
  OpexReduction: "Reduce Operating Expenses by %",
  Hiring: "Hire Additional Staff",
};

type AssetOption = { id: number; assetNumber: string; description: string };

function ParameterFields({ scenarioType, params, setParam, assetOptions }: { scenarioType: ScenarioType; params: Record<string, string>; setParam: (key: string, value: string) => void; assetOptions: AssetOption[] }) {
  const field = (key: string, label: string, placeholder?: string) => (
    <div key={key}>
      <label className="mb-1 block text-xs font-medium text-vf-ink-faint">{label}</label>
      <Input value={params[key] ?? ""} onChange={(e) => setParam(key, e.target.value)} placeholder={placeholder} className="w-40" />
    </div>
  );

  if (scenarioType === "SalesIncrease" || scenarioType === "SupplierPriceIncrease" || scenarioType === "OpexReduction") {
    return field("percent", "Percent (%)", "10");
  }
  if (scenarioType === "ReceiptDelay") {
    return (
      <>
        {field("delayDays", "Delay (days)", "30")}
        {field("averageDailyReceipts", "Avg Daily Receipts (optional)")}
      </>
    );
  }
  if (scenarioType === "AssetReplacement") {
    return (
      <>
        <div>
          <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Asset Being Replaced (optional)</label>
          <select value={params.assetId ?? ""} onChange={(e) => setParam("assetId", e.target.value)} className="min-w-[200px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            <option value="">None</option>
            {assetOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.assetNumber} — {a.description}
              </option>
            ))}
          </select>
        </div>
        {field("newAssetCost", "New Asset Cost", "50000")}
        {field("newAssetResidualValue", "New Residual Value", "0")}
        {field("newAssetUsefulLifeMonths", "New Useful Life (months)", "60")}
      </>
    );
  }
  return field("annualSalaryCost", "Annual Salary Cost", "360000");
}

function ImpactSummary({ impact }: { impact: ScenarioImpact }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-sm text-vf-ink-soft">{impact.financialImpactSummary}</p>
      <div className="flex flex-wrap gap-3 text-xs text-vf-ink-faint">
        <span>Cash-Flow Impact: <span className="font-medium text-vf-ink">{impact.cashFlowImpact}</span></span>
        <span>Profitability Impact: <span className="font-medium text-vf-ink">{impact.profitabilityImpact}</span></span>
        <span>Balance Sheet Impact: <span className="font-medium text-vf-ink">{impact.balanceSheetImpact}</span></span>
      </div>
      {impact.keyRatiosAffected.length > 0 && (
        <div>
          <p className="text-xs font-medium text-vf-ink-faint">Key Ratios Affected</p>
          <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
            {impact.keyRatiosAffected.map((r, i) => (
              <li key={i}>
                {r.ratio}: {r.before ?? "n/a"} → {r.after ?? "n/a"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {impact.assumptions.length > 0 && (
        <div className="rounded-vf-sm bg-vf-info/10 p-2">
          <p className="text-xs font-medium text-vf-ink-faint">Assumptions Used</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-vf-ink-soft">
            {impact.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ companyId, scenario, previewMode }: { companyId: string; scenario: CopilotScenario; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function remove() {
    setLoading(true);
    try {
      await fetch(`/api/companies/${companyId}/copilot/scenarios/${scenario.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="info">{SCENARIO_LABELS[scenario.scenarioType]}</Badge>
          <p className="text-sm font-medium text-vf-ink">{scenario.name}</p>
        </div>
        <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={remove}>
          Delete
        </Button>
      </div>
      <p className="mt-1 text-xs text-vf-ink-faint">Modeled {new Date(scenario.createdAt).toLocaleString()} by {scenario.createdBy}. Isolated — never modifies live accounting data.</p>
      <ImpactSummary impact={scenario.results as unknown as ScenarioImpact} />
    </div>
  );
}

export function CopilotScenariosTab({
  companyId,
  scenarios,
  periodStart,
  periodEnd,
  assetOptions,
  previewMode,
}: {
  companyId: string;
  scenarios: CopilotScenario[];
  periodStart: string;
  periodEnd: string;
  assetOptions: AssetOption[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [scenarioType, setScenarioType] = useState<ScenarioType>("SalesIncrease");
  const [name, setName] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  function setParam(key: string, value: string) {
    setParams((p) => ({ ...p, [key]: value }));
  }

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const parameters: Record<string, number> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value.trim() !== "" && !Number.isNaN(Number(value))) parameters[key] = Number(value);
      }
      const res = await fetch(`/api/companies/${companyId}/copilot/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || SCENARIO_LABELS[scenarioType], scenarioType, parameters, periodStart, periodEnd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setName("");
      setParams({});
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">
        Model a scenario against live baseline figures — every projection shows Financial, Cash-Flow, Profitability, and Balance Sheet impact plus
        Key Ratios and Assumptions Used. Scenarios are isolated and never modify live accounting data.
      </p>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Scenario</label>
            <select
              value={scenarioType}
              onChange={(e) => {
                setScenarioType(e.target.value as ScenarioType);
                setParams({});
              }}
              className="min-w-[220px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
            >
              {SCENARIO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SCENARIO_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Name (optional)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={SCENARIO_LABELS[scenarioType]} className="w-56" />
          </div>
          <ParameterFields scenarioType={scenarioType} params={params} setParam={setParam} assetOptions={assetOptions} />
          <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={run}>
            Run Scenario
          </Button>
          {error && <p className="text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {scenarios.length === 0 ? (
        <EmptyState title="No scenarios modeled yet." description="Run one above to see its Financial, Cash-Flow, Profitability, and Balance Sheet impact." />
      ) : (
        <div className="flex flex-col gap-3">
          {scenarios.map((s) => (
            <ScenarioCard key={s.id} companyId={companyId} scenario={s} previewMode={previewMode} />
          ))}
        </div>
      )}
    </div>
  );
}
