"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconRefresh } from "@/components/ui/icons";
import {
  RECURRENCE_FREQUENCIES,
  RECURRING_DOCUMENT_LABELS,
  RECURRING_DOCUMENT_TYPES,
  type RecurringDocumentType,
  type RecurringTemplate,
} from "@/server/automation/types";
import type { RecurrenceFrequency } from "@/server/automation/recurrence";

const PAYLOAD_PLACEHOLDER: Record<RecurringDocumentType, string> = {
  CustomerInvoice: `{\n  "customerId": 1,\n  "vatTreatmentCode": "Standard",\n  "lines": [{ "description": "Monthly retainer", "quantity": 1, "unitPrice": 8500 }]\n}`,
  SupplierBill: `{\n  "supplierId": 1,\n  "vatTreatmentCode": "Standard",\n  "subtotal": 4200\n}`,
  Journal: `{\n  "journalType": "Depreciation",\n  "description": "Monthly depreciation",\n  "lines": [\n    { "accountCode": "6500", "debit": 1200, "credit": 0 },\n    { "accountCode": "1600", "debit": 0, "credit": 1200 }\n  ]\n}`,
  InventoryAdjustment: `{\n  "warehouseId": 1,\n  "direction": "Decrease",\n  "lines": [{ "stockItemId": 1, "quantity": 5 }]\n}`,
  CustomerStatement: `{ "customerId": 1 }`,
  SupplierStatement: `{ "supplierId": 1 }`,
  ReminderEmail: `{\n  "recipientType": "Customer",\n  "recipientId": 1,\n  "message": "Friendly reminder"\n}`,
  PaymentReminder: `{\n  "recipientType": "Customer",\n  "recipientId": 1,\n  "message": "Your account is overdue"\n}`,
  PurchaseOrder: `{\n  "supplierId": 1,\n  "lines": [{ "description": "Stationery", "quantity": 10, "unitPrice": 25 }]\n}`,
  SalesOrder: `{\n  "customerId": 1,\n  "lines": [{ "description": "Widgets", "quantity": 10, "unitPrice": 50 }]\n}`,
};

function GeneratedDocumentsPanel({ companyId, templateId }: { companyId: string; templateId: number }) {
  const [docs, setDocs] = useState<{ id: number; generatedAt: string; status: string; summary: string; errorMessage: string | null }[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/recurring-templates/${templateId}/documents`);
      const data = await res.json();
      setDocs(data.documents ?? []);
    } finally {
      setLoading(false);
    }
  }

  if (docs === null) {
    return (
      <Button variant="subtle" size="sm" disabled={loading} onClick={load}>
        {loading ? "Loading…" : "Show Generation History"}
      </Button>
    );
  }
  if (docs.length === 0) return <p className="text-xs text-vf-ink-faint">No occurrences generated yet.</p>;

  return (
    <ul className="flex flex-col gap-1 text-xs text-vf-ink-faint">
      {docs.map((d) => (
        <li key={d.id}>
          {new Date(d.generatedAt).toLocaleString()} — <Badge tone={d.status === "Success" ? "good" : "danger"}>{d.status}</Badge>{" "}
          {d.status === "Success" ? d.summary : d.errorMessage}
        </li>
      ))}
    </ul>
  );
}

function TemplateCard({ template, companyId, previewMode }: { template: RecurringTemplate; companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function action(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/recurring-templates/${template.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function generateNow() {
    setLoading(true);
    setError(null);
    setGenerateResult(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/recurring-templates/${template.id}/generate-now`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setGenerateResult(`${data.outcome.status}${data.outcome.reason ? `: ${data.outcome.reason}` : ""}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{RECURRING_DOCUMENT_LABELS[template.documentType]}</Badge>
            <Badge tone={template.isActive ? "good" : "muted"}>{template.isActive ? "Active" : "Paused"}</Badge>
          </div>
          <p className="mt-1 text-sm font-semibold text-vf-ink">{template.name}</p>
          <p className="mt-0.5 text-xs text-vf-ink-faint">
            {template.frequency}{template.frequency === "Custom" ? ` (every ${template.intervalCount} day(s))` : ""} · Next run {template.nextRunDate}
            {template.lastRunDate && ` · Last run ${template.lastRunDate}`} · {template.occurrencesGenerated}{template.maxOccurrences ? `/${template.maxOccurrences}` : ""} occurrence(s)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => action({ action: template.isActive ? "pause" : "resume" })}>
            {template.isActive ? "Pause" : "Resume"}
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={generateNow}>
            <IconRefresh className="h-4 w-4" /> Generate Now
          </Button>
        </div>
      </div>

      {generateResult && <p className="mt-2 text-xs text-vf-ink-soft">Generation result: {generateResult}</p>}
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}

      <div className="mt-3 border-t border-vf-paper-border pt-2">
        {showHistory ? (
          <GeneratedDocumentsPanel companyId={companyId} templateId={template.id} />
        ) : (
          <Button variant="subtle" size="sm" onClick={() => setShowHistory(true)}>
            Show Generation History
          </Button>
        )}
      </div>
    </div>
  );
}

function NewTemplateForm({ companyId, onDone, onCancel }: { companyId: string; onDone: () => void; onCancel: () => void }) {
  const [documentType, setDocumentType] = useState<RecurringDocumentType>("CustomerInvoice");
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("Monthly");
  const [intervalCount, setIntervalCount] = useState("1");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [maxOccurrences, setMaxOccurrences] = useState("");
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [skipPublicHolidays, setSkipPublicHolidays] = useState(false);
  const [numberingPrefix, setNumberingPrefix] = useState("");
  const [payloadText, setPayloadText] = useState(PAYLOAD_PLACEHOLDER.CustomerInvoice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    let documentPayload: unknown;
    try {
      documentPayload = JSON.parse(payloadText);
    } catch {
      setError("Document payload is not valid JSON.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/companies/${companyId}/recurring-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType,
          name,
          frequency,
          intervalCount: Number(intervalCount) || 1,
          startDate,
          endDate: endDate || null,
          maxOccurrences: maxOccurrences ? Number(maxOccurrences) : null,
          skipWeekends,
          skipPublicHolidays,
          numberingPrefix,
          documentPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Recurring Template</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Document Type" htmlFor="rt-doctype" required>
          <Select
            id="rt-doctype"
            value={documentType}
            onChange={(e) => {
              const next = e.target.value as RecurringDocumentType;
              setDocumentType(next);
              setPayloadText(PAYLOAD_PLACEHOLDER[next]);
            }}
          >
            {RECURRING_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{RECURRING_DOCUMENT_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="rt-name" required>
          <Input id="rt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meridian Traders — Monthly Retainer" />
        </Field>
        <Field label="Numbering Prefix" htmlFor="rt-prefix">
          <Input id="rt-prefix" value={numberingPrefix} onChange={(e) => setNumberingPrefix(e.target.value)} placeholder="e.g. REC-INV-" />
        </Field>
        <Field label="Frequency" htmlFor="rt-frequency" required>
          <Select id="rt-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}>
            {RECURRENCE_FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </Select>
        </Field>
        {frequency === "Custom" && (
          <Field label="Every N Days" htmlFor="rt-interval">
            <Input id="rt-interval" type="number" min="1" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
          </Field>
        )}
        <Field label="Start Date" htmlFor="rt-start" required>
          <Input id="rt-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="End Date" htmlFor="rt-end">
          <Input id="rt-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Max Occurrences" htmlFor="rt-max">
          <Input id="rt-max" type="number" min="1" value={maxOccurrences} onChange={(e) => setMaxOccurrences(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-vf-ink-soft">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} /> Skip weekends
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={skipPublicHolidays} onChange={(e) => setSkipPublicHolidays(e.target.checked)} /> Skip public holidays (future-ready — no calendar configured yet)
        </label>
      </div>
      <div className="mt-3">
        <Field label="Document Payload (JSON)" htmlFor="rt-payload">
          <textarea
            id="rt-payload"
            className="min-h-32 w-full rounded-vf-sm border border-vf-paper-border bg-vf-paper-alt/60 p-2 font-mono text-xs text-vf-ink"
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
          />
        </Field>
        <p className="mt-1 text-xs text-vf-ink-faint">The real create-input for this document type — same fields the manual form would collect.</p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !name.trim() || !startDate} onClick={submit}>
          Create Template
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function RecurringTemplatesTab({ companyId, templates, previewMode }: { companyId: string; templates: RecurringTemplate[]; previewMode: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-vf-ink-faint">
        Every recurring document reuses the same real create-and-post service a manually-created one would — no
        parallel document logic. The Automation Scheduler is what actually decides when each template is due; see
        the Automation Dashboard for the Scheduler&rsquo;s own queue and execution log.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Template"}
        </Button>
      </div>

      {creating && (
        <NewTemplateForm
          companyId={companyId}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {templates.length === 0 ? (
        <EmptyState icon={<IconRefresh className="h-5 w-5" />} title="No recurring templates yet." description="Add your first template above." />
      ) : (
        templates.map((t) => <TemplateCard key={t.id} template={t} companyId={companyId} previewMode={previewMode} />)
      )}
    </div>
  );
}
