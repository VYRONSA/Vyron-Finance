"use client";

import type { ChangeEvent, ComponentType } from "react";
import { useRef } from "react";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  IconArchive,
  IconBanknote,
  IconBarChart,
  IconBookOpen,
  IconBuilding,
  IconListChecks,
  IconReceipt,
  IconRefresh,
  IconReconcile,
  IconSearch,
  IconShieldCheck,
  IconSliders,
  IconSparkles,
} from "@/components/ui/icons";
import type { Currency } from "@/server/company-management/types";

const INDUSTRIES = ["Retail", "Professional Services", "Transport", "Healthcare", "Manufacturing", "Hospitality", "Other"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const EMPLOYEE_RANGES = ["1–5", "6–20", "21–50", "51–200", "200+"];
const BRANCH_RANGES = ["Just one", "2–5", "6–15", "16+"];
const TRANSACTION_RANGES = ["Fewer than 100", "100–500", "500–2,000", "2,000+"];
const VAT_FREQUENCIES = ["Monthly", "Bi-monthly", "Annually"];
const TAX_SYSTEMS = ["Standard VAT", "Simplified Turnover Tax", "VAT Exempt"];
const COA_TEMPLATES = ["Standard Chart of Accounts", "Retail & Trade", "Professional Services", "Manufacturing"];
const OPENING_BALANCE_METHODS = ["Import from a file", "Enter manually", "Skip for now — I'll do this later"];

/**
 * Every field the Company Creation Wizard collects. Only the ones with a
 * `// real` comment below are ever sent to `/api/companies` — that
 * request body is unchanged from before this redesign (see
 * `create-company-form.tsx`'s `buildCreateCompanyPayload`). Everything
 * else has no backing column/parameter anywhere in the system yet; it's
 * captured because the wizard asks for it and shown back on the Review
 * step, but never submitted — the same "collect the preference, don't
 * pretend it's saved" treatment Step 4 (AI Configuration) uses, applied
 * consistently to every other UI-only field instead of just that one
 * section.
 */
export type WizardValues = {
  name: string; // real
  tradingName: string; // real — Phase 20D (companies.trading_name)
  registrationNumber: string; // real
  vatNumber: string; // real — Phase 20D (companies.vat_number)
  industry: string; // real
  financialYearStartMonth: string; // real
  address: string; // real
  logoDataUrl: string | null;

  baseCurrencyCode: string; // real
  vatRegistered: boolean;
  vatFrequency: string;
  defaultTaxSystem: string;
  chartOfAccountsTemplate: string;
  openingBalanceMethod: string;

  employeeRange: string;
  branchRange: string;
  monthlyTransactionsRange: string;
  hasInventory: boolean;
  hasManufacturing: boolean;
  hasPayroll: boolean;
  hasProjects: boolean;

  aiBookkeeper: boolean;
  aiAccountant: boolean;
  aiCfo: boolean;
  autoCategorisation: boolean;
  duplicateDetection: boolean;
  anomalyDetection: boolean;
  predictiveCashFlow: boolean;
  nlAssistant: boolean;
};

export const WIZARD_DEFAULTS: WizardValues = {
  name: "",
  tradingName: "",
  registrationNumber: "",
  vatNumber: "",
  industry: INDUSTRIES[0]!,
  financialYearStartMonth: "3",
  address: "",
  logoDataUrl: null,

  baseCurrencyCode: "ZAR",
  vatRegistered: false,
  vatFrequency: VAT_FREQUENCIES[0]!,
  defaultTaxSystem: TAX_SYSTEMS[0]!,
  chartOfAccountsTemplate: COA_TEMPLATES[0]!,
  openingBalanceMethod: OPENING_BALANCE_METHODS[0]!,

  employeeRange: EMPLOYEE_RANGES[0]!,
  branchRange: BRANCH_RANGES[0]!,
  monthlyTransactionsRange: TRANSACTION_RANGES[1]!,
  hasInventory: false,
  hasManufacturing: false,
  hasPayroll: false,
  hasProjects: false,

  // "These can all default ON" (Phase 5 brief, Step 4).
  aiBookkeeper: true,
  aiAccountant: true,
  aiCfo: true,
  autoCategorisation: true,
  duplicateDetection: true,
  anomalyDetection: true,
  predictiveCashFlow: true,
  nlAssistant: true,
};

export type SetValue = <K extends keyof WizardValues>(key: K, value: WizardValues[K]) => void;

/** One selectable tile — used for the Step 3 capability toggles, the
 * Step 3 range pickers, and every Step 4 AI feature. A styled button
 * with `aria-pressed`, not a checkbox/radio, per the brief's "modern
 * cards instead of plain checkboxes." */
function ToggleCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-3 rounded-vf-md border p-4 text-left transition-[border-color,box-shadow,background-color] duration-150 ease-vf-out",
        selected
          ? "border-vf-red-500 bg-vf-red-500/6 shadow-[0_0_0_1px_var(--color-vf-red-500)]"
          : "border-vf-paper-border hover:border-vf-red-300 hover:shadow-vf-paper-sm",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150 ease-vf-out",
          selected ? "bg-vf-red-500/15 text-vf-red-600" : "bg-vf-paper-alt text-vf-ink-faint",
        )}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-vf-ink">{title}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-vf-ink-faint">{description}</p>}
      </div>
    </button>
  );
}

/** A row of mutually-exclusive `ToggleCard`s — "how many employees," "how
 * many branches," and so on. None of these are required by the real
 * `createCompany` validation, so there's always a sensible default
 * selected rather than an empty/invalid state. */
function RangeCardGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (next: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-vf-sm border px-3 py-2.5 text-center text-sm font-medium transition-[border-color,box-shadow,background-color,color] duration-150 ease-vf-out",
            value === option
              ? "border-vf-red-500 bg-vf-red-500/6 text-vf-red-600 shadow-[0_0_0_1px_var(--color-vf-red-500)]"
              : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-300",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function StepHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <span className="text-xs font-semibold tracking-[0.14em] text-vf-red-600 uppercase">{eyebrow}</span>
      <h2 className="mt-2 font-display text-2xl font-medium text-vf-ink sm:text-3xl">{title}</h2>
      <p className="mt-2 max-w-[60ch] text-sm text-vf-ink-faint">{description}</p>
    </div>
  );
}

export function StepCompanyDetails({ values, set }: { values: WizardValues; set: SetValue }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("logoDataUrl", typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        eyebrow="Step 1 of 5"
        title="Company Details"
        description="The essentials — this is what appears on your invoices, statements, and everywhere else your company is named."
      />

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-vf-paper-border bg-vf-paper-alt text-vf-ink-faint transition-colors duration-150 ease-vf-out hover:border-vf-red-400 hover:text-vf-red-500"
          title="Upload a company logo"
        >
          {values.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a locally-picked file preview, never uploaded anywhere; next/image's remote-loader machinery doesn't apply to a data: URL like this.
            <img src={values.logoDataUrl} alt="Company logo preview" className="h-full w-full object-cover" />
          ) : (
            <IconBuilding className="h-7 w-7" />
          )}
        </button>
        <div>
          <p className="text-sm font-medium text-vf-ink">Company Logo</p>
          <p className="mt-0.5 max-w-[42ch] text-xs text-vf-ink-faint">
            Optional. Shown here as a preview — logo storage is coming in a future update.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 text-xs font-semibold text-vf-red-600 hover:text-vf-red-700"
          >
            {values.logoDataUrl ? "Change image" : "Upload image"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Company logo"
            className="hidden"
            onChange={handleLogoChange}
          />
        </div>
      </div>

      <Field label="Company Name" htmlFor="name" required>
        <Input id="name" value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Acme Trading Ltd" autoFocus />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Trading Name" htmlFor="tradingName">
          <Input id="tradingName" value={values.tradingName} onChange={(e) => set("tradingName", e.target.value)} placeholder="If different from the registered name" />
        </Field>
        <Field label="Industry" htmlFor="industry">
          <Select id="industry" value={values.industry} onChange={(e) => set("industry", e.target.value)}>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </Select>
        </Field>
        <Field label="Registration Number" htmlFor="registrationNumber">
          <Input id="registrationNumber" value={values.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} placeholder="Company registration number" />
        </Field>
        <Field label="VAT Number" htmlFor="vatNumber">
          <Input id="vatNumber" value={values.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} placeholder="If registered for VAT" />
        </Field>
        <Field label="Financial Year Start Month" htmlFor="financialYearStartMonth">
          <Select id="financialYearStartMonth" value={values.financialYearStartMonth} onChange={(e) => set("financialYearStartMonth", e.target.value)}>
            {MONTHS.map((month, i) => (
              <option key={month} value={i + 1}>{month}</option>
            ))}
          </Select>
        </Field>
        <Field label="Address" htmlFor="address">
          <Input id="address" value={values.address} onChange={(e) => set("address", e.target.value)} placeholder="12 Main Street, Cape Town" />
        </Field>
      </div>
    </div>
  );
}

export function StepAccountingSetup({ values, set, currencies }: { values: WizardValues; set: SetValue; currencies: Currency[] }) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        eyebrow="Step 2 of 5"
        title="Accounting Setup"
        description="How your books are kept. Every option below can be changed later from Settings — nothing here is permanent."
      />

      <Field label="Base Currency" htmlFor="baseCurrencyCode">
        <Select id="baseCurrencyCode" value={values.baseCurrencyCode} onChange={(e) => set("baseCurrencyCode", e.target.value)}>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-vf-ink-faint">The currency your financial statements and General Ledger are kept in.</p>
      </Field>

      <div className="rounded-vf-sm border border-vf-paper-border bg-vf-paper-alt/60 px-4 py-3 text-sm text-vf-ink-soft">
        Financial year starts in <span className="font-medium text-vf-ink">{MONTHS[Number(values.financialYearStartMonth) - 1]}</span> — set on the previous step.
      </div>

      <div>
        <ToggleCard
          icon={IconReceipt}
          title="VAT Registered"
          description="Turn this on if the company charges and reclaims VAT. It unlocks VAT filing frequency below."
          selected={values.vatRegistered}
          onClick={() => set("vatRegistered", !values.vatRegistered)}
        />
      </div>

      <Field label="VAT Filing Frequency" htmlFor="vatFrequency">
        <Select
          id="vatFrequency"
          value={values.vatFrequency}
          disabled={!values.vatRegistered}
          onChange={(e) => set("vatFrequency", e.target.value)}
        >
          {VAT_FREQUENCIES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-vf-ink-faint">How often VAT returns are prepared and submitted. Only applies if VAT registered.</p>
      </Field>

      <Field label="Default Tax System" htmlFor="defaultTaxSystem">
        <Select id="defaultTaxSystem" value={values.defaultTaxSystem} onChange={(e) => set("defaultTaxSystem", e.target.value)}>
          {TAX_SYSTEMS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-vf-ink-faint">The default tax treatment new transactions are coded with — you can override it per transaction.</p>
      </Field>

      <Field label="Chart of Accounts" htmlFor="chartOfAccountsTemplate">
        <Select id="chartOfAccountsTemplate" value={values.chartOfAccountsTemplate} onChange={(e) => set("chartOfAccountsTemplate", e.target.value)}>
          {COA_TEMPLATES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-vf-ink-faint">A starting set of General Ledger accounts suited to your industry. Fully editable afterwards.</p>
      </Field>

      <Field label="Opening Balance Method" htmlFor="openingBalanceMethod">
        <Select id="openingBalanceMethod" value={values.openingBalanceMethod} onChange={(e) => set("openingBalanceMethod", e.target.value)}>
          {OPENING_BALANCE_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-vf-ink-faint">How you&rsquo;ll bring in your existing balances — from a file, typed in by hand, or later from the Dashboard.</p>
      </Field>
    </div>
  );
}

export function StepBusinessProfile({ values, set }: { values: WizardValues; set: SetValue }) {
  return (
    <div className="flex flex-col gap-7">
      <StepHeading
        eyebrow="Step 3 of 5"
        title="Business Profile"
        description="A quick shape of the business — this helps VYRON FINANCE surface the right modules first."
      />

      <div>
        <p className="mb-2.5 text-sm font-medium text-vf-ink">Employees</p>
        <RangeCardGroup options={EMPLOYEE_RANGES} value={values.employeeRange} onChange={(v) => set("employeeRange", v)} />
      </div>

      <div>
        <p className="mb-2.5 text-sm font-medium text-vf-ink">Branches</p>
        <RangeCardGroup options={BRANCH_RANGES} value={values.branchRange} onChange={(v) => set("branchRange", v)} />
      </div>

      <div>
        <p className="mb-2.5 text-sm font-medium text-vf-ink">Estimated Monthly Transactions</p>
        <RangeCardGroup options={TRANSACTION_RANGES} value={values.monthlyTransactionsRange} onChange={(v) => set("monthlyTransactionsRange", v)} />
      </div>

      <div>
        <p className="mb-2.5 text-sm font-medium text-vf-ink">Does this business involve any of the following?</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ToggleCard icon={IconArchive} title="Inventory" description="Stock items you buy, hold, and sell." selected={values.hasInventory} onClick={() => set("hasInventory", !values.hasInventory)} />
          <ToggleCard icon={IconSliders} title="Manufacturing" description="Converting raw materials into finished goods." selected={values.hasManufacturing} onClick={() => set("hasManufacturing", !values.hasManufacturing)} />
          <ToggleCard icon={IconBanknote} title="Payroll" description="Paying employees through the business." selected={values.hasPayroll} onClick={() => set("hasPayroll", !values.hasPayroll)} />
          <ToggleCard icon={IconListChecks} title="Projects" description="Tracking income and costs per project or job." selected={values.hasProjects} onClick={() => set("hasProjects", !values.hasProjects)} />
        </div>
      </div>
    </div>
  );
}

const AI_FEATURES: { key: keyof WizardValues; icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  { key: "aiBookkeeper", icon: IconBookOpen, title: "AI Bookkeeper", description: "Keeps day-to-day capture and coding moving, so nothing sits unprocessed." },
  { key: "aiAccountant", icon: IconShieldCheck, title: "AI Accountant", description: "Reviews postings for consistency and flags anything that looks off." },
  { key: "aiCfo", icon: IconBarChart, title: "AI CFO", description: "Surfaces the trends and numbers that matter most, before you have to ask." },
  { key: "autoCategorisation", icon: IconSliders, title: "Automatic Transaction Categorisation", description: "Suggests GL accounts and VAT codes for incoming transactions." },
  { key: "duplicateDetection", icon: IconReconcile, title: "Duplicate Detection", description: "Watches for the same transaction or document being captured twice." },
  { key: "anomalyDetection", icon: IconSearch, title: "Financial Anomaly Detection", description: "Highlights unusual amounts, timing, or patterns worth a second look." },
  { key: "predictiveCashFlow", icon: IconRefresh, title: "Predictive Cash Flow", description: "Projects your near-term cash position from current trends." },
  { key: "nlAssistant", icon: IconSparkles, title: "Natural Language Assistant", description: "Ask questions about this company's numbers in plain English." },
];

export function StepAIConfiguration({ values, set }: { values: WizardValues; set: SetValue }) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        eyebrow="Step 4 of 5"
        title="AI Configuration"
        description="Meet VYRON AI. Every capability below is on by default — turn off anything you'd rather handle yourself."
      />

      <p className="rounded-vf-sm border border-vf-info/25 bg-vf-info/8 px-4 py-3 text-sm text-vf-info">
        These are preferences for this company, not a live connection yet — VYRON AI capabilities are rolling out progressively,
        and you can revisit this list anytime.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {AI_FEATURES.map((feature) => (
          <ToggleCard
            key={feature.key}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
            selected={Boolean(values[feature.key])}
            onClick={() => set(feature.key, !values[feature.key] as WizardValues[typeof feature.key])}
          />
        ))}
      </div>
    </div>
  );
}
