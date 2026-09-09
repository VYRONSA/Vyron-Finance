"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  IconArchive,
  IconBank,
  IconBanknote,
  IconBuilding,
  IconFileText,
  IconGrid,
  IconSparkles,
  IconUsers,
} from "@/components/ui/icons";
import type { Currency } from "@/server/company-management/types";
import { StepHeading, type WizardValues } from "./create-company-wizard-steps";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-vf-paper-border/70 py-2.5 text-sm last:border-b-0">
      <span className="text-vf-ink-faint">{label}</span>
      <span className="font-medium text-vf-ink">{value || "—"}</span>
    </div>
  );
}

export function StepReview({
  values,
  currencies,
  loading,
  submitError,
  onSubmit,
}: {
  values: WizardValues;
  currencies: Currency[];
  loading: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  const currencyLabel = currencies.find((c) => c.code === values.baseCurrencyCode);
  const capabilities = [
    values.hasInventory && "Inventory",
    values.hasManufacturing && "Manufacturing",
    values.hasPayroll && "Payroll",
    values.hasProjects && "Projects",
  ].filter((v): v is string => Boolean(v));
  const enabledAiFeatures = [
    values.aiBookkeeper && "AI Bookkeeper",
    values.aiAccountant && "AI Accountant",
    values.aiCfo && "AI CFO",
    values.autoCategorisation && "Automatic Categorisation",
    values.duplicateDetection && "Duplicate Detection",
    values.anomalyDetection && "Financial Anomaly Detection",
    values.predictiveCashFlow && "Predictive Cash Flow",
    values.nlAssistant && "Natural Language Assistant",
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="flex flex-col gap-6">
      <StepHeading eyebrow="Step 5 of 5" title="Review" description="Here's everything you've told us. Confirm it looks right, then create the company." />

      <div className="flex items-center gap-4 rounded-vf-md border border-vf-paper-border p-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-vf-paper-alt text-vf-ink-faint">
          {values.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local file preview only, see create-company-wizard-steps.tsx
            <img src={values.logoDataUrl} alt="Company logo preview" className="h-full w-full object-cover" />
          ) : (
            <IconBuilding className="h-6 w-6" />
          )}
        </span>
        <div>
          <p className="text-base font-semibold text-vf-ink">{values.name || "Untitled company"}</p>
          {values.tradingName && <p className="text-sm text-vf-ink-faint">Trading as {values.tradingName}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="mb-1 text-xs font-semibold tracking-wide text-vf-ink-faint uppercase">Company Information</p>
            <SummaryRow label="Industry" value={values.industry} />
            <SummaryRow label="Registration No." value={values.registrationNumber} />
            <SummaryRow label="VAT Number" value={values.vatNumber} />
            <SummaryRow label="Address" value={values.address} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="mb-1 text-xs font-semibold tracking-wide text-vf-ink-faint uppercase">Accounting Setup</p>
            <SummaryRow label="Base Currency" value={currencyLabel ? `${currencyLabel.code} — ${currencyLabel.name}` : values.baseCurrencyCode} />
            <SummaryRow label="Financial Year Start" value={MONTHS[Number(values.financialYearStartMonth) - 1] ?? ""} />
            <SummaryRow label="VAT Registered" value={values.vatRegistered ? `Yes — ${values.vatFrequency}` : "No"} />
            <SummaryRow label="Tax System" value={values.defaultTaxSystem} />
            <SummaryRow label="Chart of Accounts" value={values.chartOfAccountsTemplate} />
            <SummaryRow label="Opening Balances" value={values.openingBalanceMethod} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="mb-1 text-xs font-semibold tracking-wide text-vf-ink-faint uppercase">Business Profile</p>
            <SummaryRow label="Employees" value={values.employeeRange} />
            <SummaryRow label="Branches" value={values.branchRange} />
            <SummaryRow label="Monthly Transactions" value={values.monthlyTransactionsRange} />
            <SummaryRow label="Involves" value={capabilities.length > 0 ? capabilities.join(", ") : "None selected"} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-vf-ink-faint uppercase">
              <IconSparkles className="h-3.5 w-3.5 text-vf-red-500" />
              AI Features
            </p>
            <p className="pt-2 text-sm leading-relaxed text-vf-ink-soft">
              {enabledAiFeatures.length > 0 ? enabledAiFeatures.join(", ") : "All AI features turned off."}
            </p>
          </CardContent>
        </Card>
      </div>

      {submitError && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {submitError}
        </p>
      )}

      <Button type="button" variant="primary" size="default" disabled={loading} onClick={onSubmit} className="min-h-13 w-full text-base sm:w-auto sm:px-10">
        {loading ? "Creating your company…" : "Create Company"}
      </Button>
    </div>
  );
}

export function CreationSuccess({ companyId, companyName }: { companyId: string; companyName: string }) {
  const NEXT_STEPS: { title: string; description: string; icon: ComponentType<{ className?: string }>; href: string }[] = [
    { title: "Import Opening Balances", description: "Bring in your starting trial balance.", icon: IconFileText, href: `/company/${companyId}/opening-balances` },
    { title: "Connect Bank", description: "Add the bank accounts you'll reconcile against.", icon: IconBank, href: `/company/${companyId}/bank-accounts` },
    { title: "Invite Users", description: "Bring your team into this company.", icon: IconUsers, href: `/company/${companyId}/settings?tab=roles-permissions` },
    { title: "Import Customers", description: "Load your existing customer list.", icon: IconBuilding, href: `/company/${companyId}/customers` },
    { title: "Import Suppliers", description: "Load your existing supplier list.", icon: IconArchive, href: `/company/${companyId}/suppliers` },
    { title: "Enter Dashboard", description: "Jump straight into the workspace.", icon: IconGrid, href: `/company/${companyId}/dashboard` },
  ];

  return (
    <div className="flex flex-col items-center gap-8 py-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-vf-success/12 text-vf-success">
        <IconBanknote className="h-8 w-8" />
      </span>
      <div>
        <h2 className="font-display text-3xl font-medium text-vf-ink">{companyName} has been created</h2>
        <p className="mt-2 text-sm text-vf-ink-faint">Your company has been created successfully. Here&rsquo;s what to do next.</p>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
        {NEXT_STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <Link key={step.title} href={step.href} className="block">
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-vf-sm bg-vf-red-500/10 text-vf-red-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-vf-ink">{step.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-vf-ink-faint">{step.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
