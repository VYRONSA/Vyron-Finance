"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { AuditArea, AuditEngagement, AuditProgrammeStep, AuditRiskRegisterEntry, AuditTeamAssignment } from "@/server/audit/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const RISK_TONE = { Low: "info", Medium: "warn", High: "danger" } as const;

export function AuditPlanningTab({
  companyId,
  engagement,
  areas,
  programmeStepsByArea,
  risks,
  team,
  previewMode,
}: {
  companyId: string;
  engagement: AuditEngagement;
  areas: AuditArea[];
  programmeStepsByArea: Record<number, AuditProgrammeStep[]>;
  risks: AuditRiskRegisterEntry[];
  team: AuditTeamAssignment[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [newMember, setNewMember] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newRisk, setNewRisk] = useState("");
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function addTeamMember() {
    if (!newMember.trim()) return;
    setLoading(true);
    try {
      await fetch(`/api/companies/${companyId}/audit/engagements/${engagement.id}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName: newMember, role: newRole }),
      });
      setNewMember("");
      setNewRole("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function addRisk() {
    if (!newRisk.trim()) return;
    setLoading(true);
    try {
      await fetch(`/api/companies/${companyId}/audit/engagements/${engagement.id}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskDescription: newRisk }),
      });
      setNewRisk("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function toggleStep(stepId: number, isComplete: boolean) {
    await fetch(`/api/companies/${companyId}/audit/steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isComplete: !isComplete }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-vf-ink-faint">Status</p>
            <Badge tone="info">{engagement.status}</Badge>
          </div>
          <div>
            <p className="text-xs font-medium text-vf-ink-faint">Materiality</p>
            <p className="font-mono text-sm tabular-nums text-vf-ink">{money(engagement.materiality)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-vf-ink-faint">Performance Materiality</p>
            <p className="font-mono text-sm tabular-nums text-vf-ink">{money(engagement.performanceMateriality)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-vf-ink-faint">Lead Auditor</p>
            <p className="text-sm text-vf-ink">{engagement.leadAuditor || "—"}</p>
          </div>
          {engagement.planningNotes && (
            <div className="col-span-full">
              <p className="text-xs font-medium text-vf-ink-faint">Planning Notes</p>
              <p className="text-sm text-vf-ink-soft">{engagement.planningNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-vf-ink">Audit Areas & Programmes</h3>
        {areas.length === 0 ? (
          <EmptyState title="No audit areas defined." description="Areas group the audit programme by risk (Revenue, Inventory, VAT, ...)." />
        ) : (
          <div className="flex flex-col gap-3">
            {areas.map((area) => {
              const steps = programmeStepsByArea[area.id] ?? [];
              return (
                <div key={area.id} className="rounded-vf-md border border-vf-paper-border p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-vf-ink">{area.name}</p>
                    <Badge tone={RISK_TONE[area.riskLevel]}>{area.riskLevel} Risk</Badge>
                  </div>
                  {area.notes && <p className="mt-1 text-xs text-vf-ink-faint">{area.notes}</p>}
                  {steps.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {steps.map((step) => (
                        <li key={step.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={step.isComplete} disabled={previewMode} onChange={() => toggleStep(step.id, step.isComplete)} className="h-4 w-4" />
                          <span className={step.isComplete ? "text-vf-ink-faint line-through" : "text-vf-ink-soft"}>{step.description}</span>
                          {step.assignedTo && <span className="text-xs text-vf-ink-faint">({step.assignedTo})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-vf-ink">Risk Register</h3>
          <div className="flex flex-col gap-3">
            {risks.map((r) => (
              <div key={r.id} className="rounded-vf-md border border-vf-paper-border p-3 text-sm">
                <p className="font-medium text-vf-ink">{r.riskDescription}</p>
                <div className="mt-1 flex gap-2">
                  <Badge tone={RISK_TONE[r.likelihood]}>Likelihood: {r.likelihood}</Badge>
                  <Badge tone={RISK_TONE[r.impact]}>Impact: {r.impact}</Badge>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Input placeholder="New risk description" value={newRisk} onChange={(e) => setNewRisk(e.target.value)} />
              <Button variant="subtle" size="sm" disabled={previewMode || loading || !newRisk.trim()} title={disabledTitle} onClick={addRisk}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-vf-ink">Team Assignments</h3>
          <div className="flex flex-col gap-3">
            {team.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-vf-md border border-vf-paper-border p-3 text-sm">
                <span className="font-medium text-vf-ink">{m.memberName}</span>
                <span className="text-vf-ink-faint">{m.role}</span>
              </div>
            ))}
            <div className="flex gap-2">
              <Input placeholder="Name" value={newMember} onChange={(e) => setNewMember(e.target.value)} className="flex-1" />
              <Input placeholder="Role" value={newRole} onChange={(e) => setNewRole(e.target.value)} className="flex-1" />
              <Button variant="subtle" size="sm" disabled={previewMode || loading || !newMember.trim()} title={disabledTitle} onClick={addTeamMember}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
