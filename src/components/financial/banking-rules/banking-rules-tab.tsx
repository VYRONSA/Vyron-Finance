"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowDown, IconArrowUp, IconPlus, IconSliders } from "@/components/ui/icons";
import {
  CONDITION_OPERATORS,
  RULE_DOMAINS,
  type ActionType,
  type BankingRule,
  type ConditionField,
  type ConditionOperator,
  type RuleDomain,
} from "@/server/banking-rules/types";
import { DOMAIN_ACTION_TYPES, DOMAIN_CONDITION_FIELDS, DOMAIN_RULE_TYPES } from "@/server/banking-rules/automation-rule-domains";

type EditableCondition = { field: ConditionField; operator: ConditionOperator; value: string; value2: string };
type EditableAction = { actionType: ActionType; targetId: string; targetText: string };

const BLANK_CONDITION: EditableCondition = { field: "beneficiary", operator: "contains", value: "", value2: "" };
const BLANK_ACTION: EditableAction = { actionType: "set_gl_account", targetId: "", targetText: "" };

const ACTION_TAKES_ID: ActionType[] = ["set_merchant", "set_supplier", "set_customer"];

function ConditionEditor({ conditions, onChange, fields }: { conditions: EditableCondition[]; onChange: (c: EditableCondition[]) => void; fields: string[] }) {
  function update(i: number, patch: Partial<EditableCondition>) {
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Conditions (all must match)</p>
      {conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-vf-sm bg-vf-paper-alt/60 p-2 text-sm">
          <div className="w-36">
            <Select aria-label={`Field for condition ${i + 1}`} value={c.field} onChange={(e) => update(i, { field: e.target.value as ConditionField })}>
              {fields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <Select aria-label={`Operator for condition ${i + 1}`} value={c.operator} onChange={(e) => update(i, { operator: e.target.value as ConditionOperator })}>
              {CONDITION_OPERATORS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Input placeholder="Value" value={c.value} aria-label={`Value for condition ${i + 1}`} onChange={(e) => update(i, { value: e.target.value })} />
          </div>
          {c.operator === "between" && (
            <div className="w-40">
              <Input placeholder="Second value" value={c.value2} aria-label={`Second value for condition ${i + 1}`} onChange={(e) => update(i, { value2: e.target.value })} />
            </div>
          )}
          <Button variant="subtle" size="sm" disabled={conditions.length <= 1} onClick={() => onChange(conditions.filter((_, idx) => idx !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="subtle" size="sm" className="w-fit" onClick={() => onChange([...conditions, { ...BLANK_CONDITION }])}>
        <IconPlus className="h-4 w-4" /> Add Condition
      </Button>
    </div>
  );
}

function ActionEditor({ actions, onChange, actionTypes }: { actions: EditableAction[]; onChange: (a: EditableAction[]) => void; actionTypes: string[] }) {
  function update(i: number, patch: Partial<EditableAction>) {
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Actions</p>
      {actions.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-vf-sm bg-vf-paper-alt/60 p-2 text-sm">
          <div className="w-44">
            <Select aria-label={`Action type for action ${i + 1}`} value={a.actionType} onChange={(e) => update(i, { actionType: e.target.value as ActionType })}>
              {actionTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>
          {ACTION_TAKES_ID.includes(a.actionType) ? (
            <div className="w-40">
              <Input placeholder="Target id" value={a.targetId} aria-label={`Target id for action ${i + 1}`} onChange={(e) => update(i, { targetId: e.target.value })} />
            </div>
          ) : (
            <div className="w-56">
              <Input placeholder="Value (GL code, VAT code, exception type…)" value={a.targetText} aria-label={`Target value for action ${i + 1}`} onChange={(e) => update(i, { targetText: e.target.value })} />
            </div>
          )}
          <Button variant="subtle" size="sm" disabled={actions.length <= 1} onClick={() => onChange(actions.filter((_, idx) => idx !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="subtle" size="sm" className="w-fit" onClick={() => onChange([...actions, { ...BLANK_ACTION }])}>
        <IconPlus className="h-4 w-4" /> Add Action
      </Button>
    </div>
  );
}

function toApiConditions(conditions: EditableCondition[]) {
  return conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, value2: c.operator === "between" ? c.value2 : null }));
}

function toApiActions(actions: EditableAction[]) {
  return actions.map((a) => ({
    actionType: a.actionType,
    targetId: ACTION_TAKES_ID.includes(a.actionType) && a.targetId.trim() ? Number(a.targetId) : null,
    targetText: !ACTION_TAKES_ID.includes(a.actionType) && a.targetText.trim() ? a.targetText.trim() : null,
  }));
}

function SimulatePanel({ companyId, ruleId, onClose }: { companyId: string; ruleId: number; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ matchedCount: number; totalCount: number } | null>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/banking-rules/${ruleId}/simulate`);
      const data = await res.json();
      setResult(data.result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-vf-md border border-vf-dark-border/20 bg-vf-paper-alt/60 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Simulate — checks recent transactions, changes nothing</p>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run Simulation"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onClose}>
          Close
        </Button>
        {result && (
          <span className="text-sm text-vf-ink-soft">
            Would match {result.matchedCount} of {result.totalCount} recent transaction(s).
          </span>
        )}
      </div>
    </div>
  );
}

function TestPanel({ companyId, ruleId, onClose }: { companyId: string; ruleId: number; onClose: () => void }) {
  const [beneficiary, setBeneficiary] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ matched: boolean; matchedConditions: unknown[]; unmatchedConditions: unknown[] } | null>(null);

  async function run() {
    setLoading(true);
    try {
      const debit = Number(amount) || 0;
      const res = await fetch(`/api/companies/${companyId}/banking-rules/${ruleId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: { beneficiary, description, reference, notes: "", bankAccount: "", glAccount: "", debit, credit: 0, amount: debit } }),
      });
      const data = await res.json();
      setResult(data.result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-vf-md border border-vf-dark-border/20 bg-vf-paper-alt/60 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Test — check one hand-built hypothetical transaction, changes nothing</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label htmlFor={`test-beneficiary-${ruleId}`} className="mb-1 block text-xs text-vf-ink-faint">Beneficiary</label>
          <Input id={`test-beneficiary-${ruleId}`} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`test-description-${ruleId}`} className="mb-1 block text-xs text-vf-ink-faint">Description</label>
          <Input id={`test-description-${ruleId}`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`test-reference-${ruleId}`} className="mb-1 block text-xs text-vf-ink-faint">Reference</label>
          <Input id={`test-reference-${ruleId}`} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`test-amount-${ruleId}`} className="mb-1 block text-xs text-vf-ink-faint">Amount</label>
          <Input id={`test-amount-${ruleId}`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={loading} onClick={run}>
          {loading ? "Testing…" : "Run Test"}
        </Button>
        <Button variant="subtle" size="sm" onClick={onClose}>
          Close
        </Button>
        {result && (
          <span className={`text-sm font-medium ${result.matched ? "text-vf-success" : "text-vf-ink-soft"}`}>
            {result.matched ? "Matched" : "Did not match"} — {result.matchedConditions.length} of {result.matchedConditions.length + result.unmatchedConditions.length} condition(s) satisfied.
          </span>
        )}
      </div>
    </div>
  );
}

function VersionHistoryPanel({ companyId, ruleId, previewMode, onRestored }: { companyId: string; ruleId: number; previewMode: boolean; onRestored: () => void }) {
  const [versions, setVersions] = useState<{ version: number; createdAt: string; createdBy: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/banking-rules/${ruleId}/versions`);
      const data = await res.json();
      setVersions(data.versions);
    } finally {
      setLoading(false);
    }
  }

  async function restore(version: number) {
    setRestoringVersion(version);
    try {
      const res = await fetch(`/api/companies/${companyId}/banking-rules/${ruleId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (res.ok) onRestored();
    } finally {
      setRestoringVersion(null);
    }
  }

  if (versions === null) {
    return (
      <Button variant="subtle" size="sm" disabled={loading} onClick={load}>
        {loading ? "Loading…" : "Show Version History"}
      </Button>
    );
  }

  return (
    <ul className="mt-2 flex flex-col gap-1.5 text-xs text-vf-ink-faint">
      {versions.map((v, i) => (
        <li key={v.version} className="flex items-center gap-2">
          <span>
            v{v.version} — {new Date(v.createdAt).toLocaleString()} by {v.createdBy}
          </span>
          {i !== 0 && (
            <Button variant="subtle" size="sm" disabled={previewMode || restoringVersion !== null} title={disabledTitle} onClick={() => restore(v.version)}>
              {restoringVersion === v.version ? "Restoring…" : "Restore"}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function RuleCard({ rule, companyId, previewMode }: { rule: BankingRule; companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description);
  const [priority, setPriority] = useState(String(rule.priority));
  const [conditions, setConditions] = useState<EditableCondition[]>(rule.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, value2: c.value2 ?? "" })));
  const [actions, setActions] = useState<EditableAction[]>(rule.actions.map((a) => ({ actionType: a.actionType, targetId: a.targetId !== null ? String(a.targetId) : "", targetText: a.targetText ?? "" })));
  const [simulating, setSimulating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/companies/${companyId}/banking-rules/${rule.id}`;
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

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="muted">{rule.domain}</Badge>
            <Badge tone="info">{rule.ruleType}</Badge>
            <Input className="max-w-xs text-sm" value={name} onChange={(e) => setName(e.target.value)} aria-label={`Name for rule ${rule.id}`} />
          </div>
          <Input className="mt-1.5 max-w-md text-sm" value={description} onChange={(e) => setDescription(e.target.value)} aria-label={`Description for rule ${rule.id}`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rule.isActive ? "good" : "muted"}>{rule.isActive ? "Enabled" : "Disabled"}</Badge>
          <div className="w-24">
            <Input type="number" value={priority} aria-label={`Priority for rule ${rule.id}`} onChange={(e) => setPriority(e.target.value)} title="Lower runs first among rules of the same type" />
          </div>
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => patch({ isActive: !rule.isActive })}>
            {rule.isActive ? "Disable" : "Enable"}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setSimulating((s) => !s)}>
            {simulating ? "Hide Simulate" : "Simulate"}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setTesting((t) => !t)}>
            {testing ? "Hide Test" : "Test"}
          </Button>
        </div>
      </div>

      {simulating && <SimulatePanel companyId={companyId} ruleId={rule.id} onClose={() => setSimulating(false)} />}
      {testing && <TestPanel companyId={companyId} ruleId={rule.id} onClose={() => setTesting(false)} />}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ConditionEditor conditions={conditions} onChange={setConditions} fields={DOMAIN_CONDITION_FIELDS[rule.domain]} />
        <ActionEditor actions={actions} onChange={setActions} actionTypes={DOMAIN_ACTION_TYPES[rule.domain]} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="subtle"
          size="sm"
          disabled={previewMode || loading}
          title={disabledTitle}
          onClick={() =>
            patch({
              name,
              description,
              priority: Number(priority) || 100,
              conditions: toApiConditions(conditions),
              actions: toApiActions(actions),
            })
          }
        >
          Save Changes
        </Button>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </div>

      <div className="mt-3 border-t border-vf-paper-border pt-2">
        <VersionHistoryPanel companyId={companyId} ruleId={rule.id} previewMode={previewMode} onRestored={() => router.refresh()} />
      </div>
    </div>
  );
}

function NewRuleForm({
  companyId,
  defaultBeneficiary,
  defaultGlAccount,
  onDone,
  onCancel,
}: {
  companyId: string;
  defaultBeneficiary: string;
  defaultGlAccount: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [domain, setDomain] = useState<RuleDomain>("Banking");
  const [ruleType, setRuleType] = useState<string>(DOMAIN_RULE_TYPES.Banking[3]); // "GL"
  const [name, setName] = useState("");
  const [conditions, setConditions] = useState<EditableCondition[]>([
    { ...BLANK_CONDITION, value: defaultBeneficiary },
  ]);
  const [actions, setActions] = useState<EditableAction[]>([
    { ...BLANK_ACTION, targetText: defaultGlAccount },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeDomain(nextDomain: RuleDomain) {
    setDomain(nextDomain);
    setRuleType(DOMAIN_RULE_TYPES[nextDomain][0]);
    setConditions([{ ...BLANK_CONDITION, field: DOMAIN_CONDITION_FIELDS[nextDomain][0] }]);
    setActions([{ ...BLANK_ACTION, actionType: DOMAIN_ACTION_TYPES[nextDomain][0] }]);
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/banking-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, ruleType, name, conditions: toApiConditions(conditions), actions: toApiActions(actions) }),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Automation Rule</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Domain" htmlFor="new-rule-domain" required>
          <Select id="new-rule-domain" value={domain} onChange={(e) => changeDomain(e.target.value as RuleDomain)}>
            {RULE_DOMAINS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Rule Type" htmlFor="new-rule-type" required>
          <Select id="new-rule-type" value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
            {DOMAIN_RULE_TYPES[domain].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="new-rule-name" required>
          <Input id="new-rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Netherfield Freight -> Distribution" />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ConditionEditor conditions={conditions} onChange={setConditions} fields={DOMAIN_CONDITION_FIELDS[domain]} />
        <ActionEditor actions={actions} onChange={setActions} actionTypes={DOMAIN_ACTION_TYPES[domain]} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !name.trim()} onClick={submit}>
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

export function BankingRulesTab({ companyId, rules, previewMode }: { companyId: string; rules: BankingRule[]; previewMode: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(Boolean(searchParams.get("prefillBeneficiary")));
  const [domainFilter, setDomainFilter] = useState<RuleDomain | "All">("All");
  const [runningEngine, setRunningEngine] = useState(false);
  const [runOutcome, setRunOutcome] = useState<{ processed: number; autoPosted: number; exceptionsRaised: number } | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const apiBase = `/api/companies/${companyId}/banking-rules`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function handleImportFile(file: File) {
    setImportErrors([]);
    try {
      const csvText = await file.text();
      const res = await fetch(`${apiBase}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText }) });
      const data = await res.json();
      if (data.errors?.length) setImportErrors(data.errors);
      router.refresh();
    } catch {
      setImportErrors(["Couldn't reach the API. Check the dev server is running."]);
    }
  }

  async function runEngine() {
    setRunningEngine(true);
    setRunOutcome(null);
    try {
      const res = await fetch(`${apiBase}/run`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setRunOutcome(data.outcome);
      router.refresh();
    } finally {
      setRunningEngine(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-vf-ink-faint">
        Every rule composes with every other rule TYPE (a transaction can be resolved by a Merchant rule, a GL rule,
        and a VAT rule all at once) — within the same type, only the highest-priority match wins. Resolved
        transactions with a GL account post automatically through the same Posting Engine every other module uses.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Rule"}
        </Button>
        <Button variant="subtle" size="sm" disabled={previewMode || runningEngine} title={disabledTitle} onClick={runEngine}>
          {runningEngine ? "Running…" : "Run Rule Engine Now"}
        </Button>
        <div className="w-44">
          <Select aria-label="Filter by domain" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value as RuleDomain | "All")}>
            <option value="All">All domains</option>
            {RULE_DOMAINS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </div>
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

      {runOutcome && (
        <p role="status" className="text-sm text-vf-ink-soft">
          Processed {runOutcome.processed} transaction(s) — {runOutcome.autoPosted} automatically posted, {runOutcome.exceptionsRaised} exception(s) raised.
        </p>
      )}

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
          defaultBeneficiary={searchParams.get("prefillBeneficiary") ?? ""}
          defaultGlAccount={searchParams.get("prefillGlAccount") ?? ""}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {(() => {
        const visibleRules = domainFilter === "All" ? rules : rules.filter((r) => r.domain === domainFilter);
        return visibleRules.length === 0 ? (
          <EmptyState icon={<IconSliders className="h-5 w-5" />} title="No automation rules yet." description="Add your first rule above, or use Learn Rule from a transaction in Transaction Explorer." />
        ) : (
          visibleRules.map((rule) => <RuleCard key={rule.id} rule={rule} companyId={companyId} previewMode={previewMode} />)
        );
      })()}
    </div>
  );
}
