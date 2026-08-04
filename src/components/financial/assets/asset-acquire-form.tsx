"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DEPRECIATION_METHODS, type AssetClass, type DepreciationMethod } from "@/server/assets/types";

export function AssetAcquireForm({ companyId, assetClasses, previewMode }: { companyId: string; assetClasses: AssetClass[]; previewMode: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [assetClassId, setAssetClassId] = useState("");
  const [cost, setCost] = useState("");
  const [residualValue, setResidualValue] = useState("0");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("60");
  const [depreciationMethod, setDepreciationMethod] = useState<DepreciationMethod>("StraightLine");
  const [diminishingBalanceRatePercent, setDiminishingBalanceRatePercent] = useState("20");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [inServiceDate, setInServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentAccountCode, setPaymentAccountCode] = useState("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/assets/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          assetClassId: assetClassId ? Number(assetClassId) : null,
          cost: Number(cost),
          residualValue: Number(residualValue),
          usefulLifeMonths: Number(usefulLifeMonths),
          depreciationMethod,
          diminishingBalanceRatePercent: Number(diminishingBalanceRatePercent),
          purchaseDate,
          inServiceDate,
          paymentAccountCode,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setDescription("");
      setCost("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setOpen(true)}>
        Acquire Asset
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Delivery Vehicle" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Asset Class</label>
            <select value={assetClassId} onChange={(e) => setAssetClassId(e.target.value)} className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
              <option value="">None</option>
              {assetClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Cost</label>
            <Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" className="w-32" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Residual Value</label>
            <Input value={residualValue} onChange={(e) => setResidualValue(e.target.value)} className="w-32" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Useful Life (months)</label>
            <Input value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} className="w-28" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Depreciation Method</label>
            <Select value={depreciationMethod} onChange={(e) => setDepreciationMethod(e.target.value as DepreciationMethod)}>
              {DEPRECIATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          {depreciationMethod === "DiminishingBalance" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Annual Rate %</label>
              <Input value={diminishingBalanceRatePercent} onChange={(e) => setDiminishingBalanceRatePercent(e.target.value)} className="w-24" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Purchase Date</label>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">In-Service Date</label>
            <Input type="date" value={inServiceDate} onChange={(e) => setInServiceDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Paid From (account code)</label>
            <Input value={paymentAccountCode} onChange={(e) => setPaymentAccountCode(e.target.value)} className="w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={previewMode || loading || !description.trim() || !cost} title={disabledTitle} onClick={submit}>
            Save & Post Acquisition
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
