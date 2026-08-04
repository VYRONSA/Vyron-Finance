"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { IconBell, IconFileText } from "@/components/ui/icons";
import type { CommunicationRecord, CommunicationStatus, CommunicationTemplate } from "@/server/communications/types";
import type { CommunicationDashboardSummary } from "@/server/communications/dashboard-engine";

const TABS = ["Dashboard", "Log", "Templates"] as const;
type Tab = (typeof TABS)[number];

const STATUS_TONE: Record<CommunicationStatus, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted",
  PendingApproval: "warn",
  Rejected: "danger",
  Queued: "info",
  Sending: "info",
  Sent: "good",
  Failed: "danger",
  Cancelled: "muted",
  Expired: "muted",
};

function DashboardTab({ dashboard }: { dashboard: CommunicationDashboardSummary }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile value={String(dashboard.queued)} label="Queued" />
        <StatTile value={String(dashboard.scheduled)} label="Scheduled" />
        <StatTile value={String(dashboard.sent)} label="Sent" />
        <StatTile value={String(dashboard.delivered)} label="Delivered (future)" />
        <StatTile value={String(dashboard.retrying)} label="Retrying" />
        <StatTile value={String(dashboard.failed)} label="Failed" />
        <StatTile value={String(dashboard.awaitingApproval)} label="Awaiting Approval" />
        <StatTile value={dashboard.averageDeliverySeconds !== null ? `${dashboard.averageDeliverySeconds.toFixed(1)}s` : "—"} label="Avg. Delivery Time" />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Top Failure Reasons</p>
        {dashboard.topFailureReasons.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">No failures recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dashboard.topFailureReasons.map((f) => (
              <li key={f.reason} className="flex items-center justify-between rounded-vf-sm border border-vf-paper-border px-3 py-2 text-sm">
                <span className="text-vf-ink-soft">{f.reason}</span>
                <span className="font-mono tabular-nums text-vf-ink-faint">{f.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LogTab({ companyId, communications, previewMode }: { companyId: string; communications: CommunicationRecord[]; previewMode: boolean }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const filtered = statusFilter === "All" ? communications : communications.filter((c) => c.status === statusFilter);

  async function act(id: number, action: "approve" | "reject" | "cancel") {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/communications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-48">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All statuses</option>
            {Object.keys(STATUS_TONE).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconBell className="h-5 w-5" />} title="No communications yet" description="Every reminder, statement, and notification queued through the platform will appear here." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Recipient</TableHeadCell>
              <TableHeadCell>Module</TableHeadCell>
              <TableHeadCell>Channel</TableHeadCell>
              <TableHeadCell>Subject</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell>Scheduled / Sent</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-vf-ink">{c.recipients.map((r) => r.name).join(", ") || "—"}</TableCell>
                <TableCell>{c.module}</TableCell>
                <TableCell>{c.channel}</TableCell>
                <TableCell className="max-w-[24ch] truncate">{c.subject ?? "—"}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                  {c.status === "Failed" && c.failureReason && <p className="mt-1 max-w-[24ch] text-xs text-vf-ink-faint">{c.failureReason}</p>}
                </TableCell>
                <TableCell className="text-xs text-vf-ink-faint">{new Date(c.sentAt ?? c.scheduledFor).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    {c.status === "PendingApproval" && (
                      <>
                        <Button variant="subtle" size="sm" disabled={previewMode || loadingId === c.id} title={disabledTitle} onClick={() => act(c.id, "approve")}>Approve</Button>
                        <Button variant="subtle" size="sm" disabled={previewMode || loadingId === c.id} title={disabledTitle} onClick={() => act(c.id, "reject")}>Reject</Button>
                      </>
                    )}
                    {(c.status === "Queued" || c.status === "PendingApproval") && (
                      <Button variant="subtle" size="sm" disabled={previewMode || loadingId === c.id} title={disabledTitle} onClick={() => act(c.id, "cancel")}>Cancel</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function TemplatesTab({ companyId, templates, previewMode }: { companyId: string; templates: CommunicationTemplate[]; previewMode: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [previewVars, setPreviewVars] = useState("{}");
  const [previewResult, setPreviewResult] = useState<{ subject: string | null; body: string; missingVariables: string[] } | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  function select(template: CommunicationTemplate) {
    setSelectedId(template.id);
    setSubject(template.subjectTemplate ?? "");
    setBody(template.bodyTemplate);
    setPreviewResult(null);
    setError(null);
    setNotice(null);
  }

  function parsedVariables(): Record<string, unknown> {
    try {
      return JSON.parse(previewVars || "{}");
    } catch {
      return {};
    }
  }

  async function save() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/communications/templates/${selected.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectTemplate: subject, bodyTemplate: body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotice("Saved as a new version.");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function preview() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/communications/templates/${selected.id}/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variables: parsedVariables() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setPreviewResult(data);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function testSend() {
    if (!selected || !testRecipient) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/communications/templates/${selected.id}/test-send`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testRecipient, variables: parsedVariables() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotice(`Test send queued — status: ${data.communication.status}${data.communication.failureReason ? ` (${data.communication.failureReason})` : ""}`);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="lg:w-1/3">
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Template</TableHeadCell>
              <TableHeadCell>Channel</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id} className={cn("cursor-pointer", selectedId === t.id && "bg-vf-paper-alt/70")} onClick={() => select(t)}>
                <TableCell className="font-medium text-vf-ink">
                  {t.name}
                  {t.requiresApproval && <Badge tone="warn" className="ml-2">Requires Approval</Badge>}
                  {!t.isActive && <Badge tone="muted" className="ml-2">Inactive</Badge>}
                </TableCell>
                <TableCell>{t.channel}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex-1">
        {!selected ? (
          <EmptyState icon={<IconFileText className="h-5 w-5" />} title="Select a template" description="Choose a template on the left to edit, preview, or test send it." />
        ) : (
          <div className="flex flex-col gap-4 rounded-vf-md border border-vf-paper-border p-4">
            <div>
              <p className="text-sm font-semibold text-vf-ink">{selected.name} <span className="text-xs font-normal text-vf-ink-faint">({selected.code} · v{selected.version})</span></p>
              <p className="mt-1 text-xs text-vf-ink-faint">Variables: {selected.variablesSchema.map((v) => v.name).join(", ") || "none"}</p>
            </div>

            {selected.subjectTemplate !== null && (
              <Field label="Subject" htmlFor="tmpl-subject">
                <Input id="tmpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={previewMode} />
              </Field>
            )}
            <Field label="Body" htmlFor="tmpl-body">
              <textarea
                id="tmpl-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={previewMode}
                rows={6}
                className="w-full rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={save}>Save New Version</Button>
            </div>

            <div className="border-t border-vf-paper-border pt-3">
              <Field label="Preview variables (JSON)" htmlFor="tmpl-vars">
                <Input id="tmpl-vars" value={previewVars} onChange={(e) => setPreviewVars(e.target.value)} />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="subtle" size="sm" disabled={loading} onClick={preview}>Preview</Button>
                <Input placeholder="test@example.com" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} className="w-56" />
                <Button variant="subtle" size="sm" disabled={previewMode || loading || !testRecipient} title={disabledTitle} onClick={testSend}>Test Send</Button>
              </div>
              {previewResult && (
                <div className="mt-3 rounded-vf-sm border border-vf-paper-border p-3 text-sm">
                  {previewResult.subject && <p className="font-medium text-vf-ink">{previewResult.subject}</p>}
                  <p className="mt-1 whitespace-pre-wrap text-vf-ink-soft">{previewResult.body}</p>
                  {previewResult.missingVariables.length > 0 && (
                    <p className="mt-2 text-xs text-vf-warning">Missing: {previewResult.missingVariables.join(", ")}</p>
                  )}
                </div>
              )}
            </div>

            {notice && <p className="text-sm text-vf-success">{notice}</p>}
            {error && <p className="text-sm text-vf-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommunicationsTabs({
  companyId,
  communications,
  templates,
  dashboard,
  previewMode,
}: {
  companyId: string;
  communications: CommunicationRecord[];
  templates: CommunicationTemplate[];
  dashboard: CommunicationDashboardSummary;
  previewMode: boolean;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Dashboard" && <DashboardTab dashboard={dashboard} />}
        {activeTab === "Log" && <LogTab companyId={companyId} communications={communications} previewMode={previewMode} />}
        {activeTab === "Templates" && <TemplatesTab companyId={companyId} templates={templates} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
