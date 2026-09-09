"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Finding #010 — `createAuditEngagement` (service + a real POST route,
 * `audit/engagements/route.ts`) always existed; there was simply no UI
 * to reach it, so a company could never get past "No audit engagement
 * exists yet." Mirrors `financial-years-tab.tsx`'s create-form pattern. */
export function AuditEngagementCreateForm({ companyId, previewMode }: { companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [leadAuditor, setLeadAuditor] = useState("");
  const [materiality, setMateriality] = useState("");
  const [performanceMateriality, setPerformanceMateriality] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function create() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/audit/engagements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          leadAuditor: leadAuditor || undefined,
          materiality: materiality ? Number(materiality) : undefined,
          performanceMateriality: performanceMateriality ? Number(performanceMateriality) : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <EmptyState
          className="px-0 py-0 text-left items-start"
          title="No audit engagement exists yet."
          description="Create one below to start planning — Areas, Risk Register, Team, Findings, Working Papers, and Queries all attach to it."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Engagement Name" htmlFor="ae-name" required className="sm:col-span-2">
            <Input id="ae-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FY2026 Annual Audit" />
          </Field>
          <Field label="Lead Auditor" htmlFor="ae-lead">
            <Input id="ae-lead" value={leadAuditor} onChange={(e) => setLeadAuditor(e.target.value)} />
          </Field>
          <Field label="Materiality" htmlFor="ae-materiality">
            <Input id="ae-materiality" type="number" step="0.01" value={materiality} onChange={(e) => setMateriality(e.target.value)} />
          </Field>
          <Field label="Performance Materiality" htmlFor="ae-perf-materiality" className="sm:col-span-2">
            <Input id="ae-perf-materiality" type="number" step="0.01" value={performanceMateriality} onChange={(e) => setPerformanceMateriality(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" size="sm" className="self-start" disabled={previewMode || loading || !name.trim()} title={disabledTitle} onClick={create}>
          Create Engagement
        </Button>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
