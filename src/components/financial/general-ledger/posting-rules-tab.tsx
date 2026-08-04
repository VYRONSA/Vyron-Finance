"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowDown, IconArrowUp, IconPlus, IconSliders } from "@/components/ui/icons";
import type { ChartOfAccount, PostingRule, PostingRuleAmountSource, PostingRuleLine, PostingRuleSide } from "@/server/general-ledger/types";

const AMOUNT_SOURCES: PostingRuleAmountSource[] = ["gross", "net", "vat"];
const AMOUNT_SOURCE_LABEL: Record<PostingRuleAmountSource, string> = {
  gross: "Full Amount",
  net: "Net Amount (excl. VAT)",
  vat: "VAT Amount",
};

type EditableLine = { side: PostingRuleSide; role: string; fixedAccountCode: string; amountSource: PostingRuleAmountSource };

const BLANK_LINE: EditableLine = { side: "Debit", role: "", fixedAccountCode: "", amountSource: "gross" };

function toEditable(line: PostingRuleLine): EditableLine {
  return { side: line.side, role: line.role, fixedAccountCode: line.fixedAccountCode ?? "", amountSource: line.amountSource };
}

function LineEditor({
  lines,
  onChange,
  accounts,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  accounts: ChartOfAccount[];
}) {
  function updateLine(index: number, patch: Partial<EditableLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    onChange([...lines, { ...BLANK_LINE }]);
  }
  function removeLine(index: number) {
    if (lines.length > 2) onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-vf-sm bg-vf-paper-alt/60 p-2 text-sm">
          <div className="w-24">
            <Select aria-label={`Side for line ${i + 1}`} value={line.side} onChange={(e) => updateLine(i, { side: e.target.value as PostingRuleSide })}>
              <option value="Debit">Debit</option>
              <option value="Credit">Credit</option>
            </Select>
          </div>
          <div className="w-40">
            <Input placeholder="Role (e.g. bank, creditors)" value={line.role} aria-label={`Role for line ${i + 1}`} onChange={(e) => updateLine(i, { role: e.target.value })} />
          </div>
          <div className="w-44">
            <Select aria-label={`Account for line ${i + 1}`} value={line.fixedAccountCode} onChange={(e) => updateLine(i, { fixedAccountCode: e.target.value })}>
              <option value="">Supplied by the event (dynamic)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.accountCode}>{a.accountCode} — {a.description}</option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select aria-label={`Amount for line ${i + 1}`} value={line.amountSource} onChange={(e) => updateLine(i, { amountSource: e.target.value as PostingRuleAmountSource })}>
              {AMOUNT_SOURCES.map((s) => (
                <option key={s} value={s}>{AMOUNT_SOURCE_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <Button variant="subtle" size="sm" disabled={lines.length <= 2} onClick={() => removeLine(i)}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="subtle" size="sm" className="w-fit" onClick={addLine}>
        <IconPlus className="h-4 w-4" /> Add Line
      </Button>
    </div>
  );
}

function TestRulePanel({ companyId, eventType, onClose }: { companyId: string; eventType: string; onClose: () => void }) {
  const [grossAmount, setGrossAmount] = useState("1150");
  const [vatRatePercent, setVatRatePercent] = useState("15");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: true; lines: { accountCode: string; debit: number; credit: number; description: string }[] } | { ok: false; reason: string } | null>(null);

  async function runTest() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/general-ledger/posting-rules/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, grossAmount: Number(grossAmount), vatRatePercent: Number(vatRatePercent), description: "Test posting" }),
      });
      const data = await res.json();
      setResult(data.result);
    } catch {
      setResult({ ok: false, reason: "Couldn't reach the API. Check the dev server is running." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-vf-md border border-vf-dark-border/20 bg-vf-paper-alt/60 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Test Rule — sample amounts, nothing is saved</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <Field label="Total Amount" htmlFor={`test-gross-${eventType}`}>
            <Input id={`test-gross-${eventType}`} type="number" step="0.01" value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} />
          </Field>
        </div>
        <div className="w-28">
          <Field label="VAT %" htmlFor={`test-vat-${eventType}`}>
            <Input id={`test-vat-${eventType}`} type="number" step="0.01" value={vatRatePercent} onChange={(e) => setVatRatePercent(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" size="sm" disabled={loading} onClick={runTest}>
          {loading ? "Testing…" : "Run Test"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {result && result.ok && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-vf-ink-faint">
              <th className="pb-1 font-medium">Account</th>
              <th className="pb-1 text-right font-medium">Debit</th>
              <th className="pb-1 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((l, i) => (
              <tr key={i} className="border-t border-vf-paper-border/60">
                <td className="py-1 font-mono">{l.accountCode}</td>
                <td className="py-1 text-right font-mono tabular-nums">{l.debit > 0 ? l.debit.toFixed(2) : ""}</td>
                <td className="py-1 text-right font-mono tabular-nums">{l.credit > 0 ? l.credit.toFixed(2) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && !result.ok && <p className="mt-2 text-sm text-vf-danger">{result.reason}</p>}
    </div>
  );
}

function RuleCard({
  rule,
  companyId,
  accounts,
  previewMode,
}: {
  rule: PostingRule;
  companyId: string;
  accounts: ChartOfAccount[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(rule.description);
  const [lines, setLines] = useState<EditableLine[]>(rule.lines.map(toEditable));
  const [testing, setTesting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateEventType, setDuplicateEventType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/companies/${companyId}/general-ledger/posting-rules/${rule.id}`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function patch(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

  async function submitDuplicate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: duplicateEventType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setDuplicating(false);
      setDuplicateEventType("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-vf-ink">{rule.eventType}</p>
          <Input
            className="mt-1 max-w-md text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label={`Description for ${rule.eventType}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rule.isActive ? "good" : "muted"}>{rule.isActive ? "Enabled" : "Disabled"}</Badge>
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => patch({ isActive: !rule.isActive })}>
            {rule.isActive ? "Disable" : "Enable"}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={previewMode || loading || description === rule.description}
            title={disabledTitle}
            onClick={() => patch({ description })}
          >
            Save Description
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setTesting((t) => !t)}>
            {testing ? "Hide Test" : "Test Rule"}
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setDuplicating((d) => !d)}>
            Duplicate
          </Button>
        </div>
      </div>

      {testing && <TestRulePanel companyId={companyId} eventType={rule.eventType} onClose={() => setTesting(false)} />}

      {duplicating && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-vf-md border border-vf-paper-border p-3">
          <div className="w-56">
            <Field label="New Event Type" htmlFor={`dup-${rule.id}`} required>
              <Input id={`dup-${rule.id}`} value={duplicateEventType} onChange={(e) => setDuplicateEventType(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" size="sm" disabled={loading || !duplicateEventType.trim()} onClick={submitDuplicate}>
            Create Copy
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setDuplicating(false)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="mt-3">
        <LineEditor lines={lines} onChange={setLines} accounts={accounts} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="subtle"
          size="sm"
          disabled={previewMode || loading}
          title={disabledTitle}
          onClick={() =>
            patch({
              lines: lines.map((l, i) => ({
                lineOrder: i,
                side: l.side,
                role: l.role,
                fixedAccountCode: l.fixedAccountCode.trim() || null,
                amountSource: l.amountSource,
              })),
            })
          }
        >
          Save Lines
        </Button>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </div>
    </div>
  );
}

function NewRuleForm({ companyId, accounts, onDone, onCancel }: { companyId: string; accounts: ChartOfAccount[]; onDone: () => void; onCancel: () => void }) {
  const [eventType, setEventType] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([{ ...BLANK_LINE, side: "Debit" }, { ...BLANK_LINE, side: "Credit" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/general-ledger/posting-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          description,
          lines: lines.map((l, i) => ({ lineOrder: i, side: l.side, role: l.role, fixedAccountCode: l.fixedAccountCode.trim() || null, amountSource: l.amountSource })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Posting Rule</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Event Type" htmlFor="new-rule-event" required>
          <Input id="new-rule-event" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="e.g. Expense Claim" />
        </Field>
        <Field label="Description" htmlFor="new-rule-desc">
          <Input id="new-rule-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <LineEditor lines={lines} onChange={setLines} accounts={accounts} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !eventType.trim()} onClick={submit}>
          Create Rule
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function PostingRulesTab({
  companyId,
  postingRules,
  accounts,
  previewMode,
}: {
  companyId: string;
  postingRules: PostingRule[];
  accounts: ChartOfAccount[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const apiBase = `/api/companies/${companyId}/general-ledger/posting-rules`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function handleImportFile(file: File) {
    setImportErrors([]);
    try {
      const csvText = await file.text();
      const res = await fetch(`${apiBase}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (data.errors?.length) setImportErrors(data.errors);
      router.refresh();
    } catch {
      setImportErrors(["Couldn't reach the API. Check the dev server is running."]);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-vf-ink-faint">
        Every future module that generates a business event (sales, purchases, receipts, payments) builds its journal
        from one of these rules — nothing hardcodes journal entries. &ldquo;Supplied by the event&rdquo; means that
        line&rsquo;s account is decided at the moment the event happens (e.g. a specific bill&rsquo;s own expense
        account), not fixed here.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Rule"}
        </Button>
        <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => window.open(`${apiBase}/export`, "_blank")}>
          <IconArrowDown className="h-4 w-4" /> Export CSV
        </Button>
        <label className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-vf-paper-border px-5 py-2 text-[0.88rem] font-semibold text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600 ${previewMode ? "pointer-events-none opacity-50" : ""}`} title={disabledTitle}>
          <IconArrowUp className="h-4 w-4" /> Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={previewMode}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {importErrors.length > 0 && (
        <div className="rounded-vf-md border border-vf-warning/40 bg-vf-warning/10 p-3 text-xs text-[#93601f]">
          <p className="font-medium">Some rows didn&rsquo;t import:</p>
          <ul className="mt-1 list-disc pl-4">
            {importErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <NewRuleForm
          companyId={companyId}
          accounts={accounts}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {postingRules.length === 0 ? (
        <EmptyState icon={<IconSliders className="h-5 w-5" />} title="No posting rules yet." description="Add your first rule above." />
      ) : (
        postingRules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} companyId={companyId} accounts={accounts} previewMode={previewMode} />
        ))
      )}
    </div>
  );
}
