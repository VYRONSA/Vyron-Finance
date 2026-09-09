"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Currency } from "@/server/company-management/types";
import {
  StepAccountingSetup,
  StepAIConfiguration,
  StepBusinessProfile,
  StepCompanyDetails,
  WIZARD_DEFAULTS,
  type WizardValues,
} from "./create-company-wizard-steps";
import { CreationSuccess, StepReview } from "./create-company-wizard-review";

const STEP_LABELS = ["Company Details", "Accounting Setup", "Business Profile", "AI Configuration", "Review"];

/** The exact shape `/api/companies` accepts. Phase 20D added `companies.
 * trading_name`/`vat_number` (0077_company_profile_extension.sql), so
 * `tradingName`/`vatNumber` now persist too — the wizard already
 * collected both and showed them on the Review step, but they were
 * silently dropped before this. Every OTHER field the wizard collects
 * (logo, VAT/tax/CoA/opening-balance preferences, business profile,
 * every AI toggle) still has no backing column or API parameter
 * anywhere in the system, so it remains deliberately left out of this
 * payload rather than sent somewhere the server would silently ignore
 * it — see `WizardValues`'s own doc comment in
 * create-company-wizard-steps.tsx for the full accounting of which
 * fields are real. */
function buildCreateCompanyPayload(values: WizardValues) {
  return {
    name: values.name.trim(),
    industry: values.industry,
    registrationNumber: values.registrationNumber.trim(),
    address: values.address.trim(),
    financialYearStartMonth: Number(values.financialYearStartMonth),
    baseCurrencyCode: values.baseCurrencyCode,
    tradingName: values.tradingName.trim(),
    vatNumber: values.vatNumber.trim(),
  };
}

export function CreateCompanyForm({ currencies, previewMode }: { currencies: Currency[]; previewMode: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<WizardValues>(WIZARD_DEFAULTS);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdCompany, setCreatedCompany] = useState<{ id: string; name: string } | null>(null);

  function set<K extends keyof WizardValues>(key: K, value: WizardValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function goNext() {
    if (step === 0 && !values.name.trim()) {
      setNameError("Company name is required.");
      return;
    }
    setNameError(null);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    if (!values.name.trim()) {
      setStep(0);
      setNameError("Company name is required.");
      return;
    }

    setLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCreateCompanyPayload(values)),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? `Request failed (${res.status})`);
        return;
      }

      // Phase 5 — "Do NOT simply redirect. Show a premium success
      // screen." Refresh now (in the background) so the sidebar's
      // company list and any cached layout data are already current by
      // the time the user clicks through from the success screen,
      // without forcing that navigation immediately.
      router.refresh();
      setCreatedCompany({ id: json.company.id, name: json.company.name ?? values.name.trim() });
    } catch {
      setSubmitError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  if (createdCompany) {
    return <CreationSuccess companyId={createdCompany.id} companyName={createdCompany.name} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {previewMode && (
        <p className="rounded-lg border border-vf-warning/25 bg-vf-warning/8 px-3.5 py-2.5 text-sm text-[#93601f]">
          No Supabase project is configured yet — this wizard is fully functional but saving will fail
          until real credentials exist. See ARCHITECTURE.md.
        </p>
      )}

      {/* Progress bar */}
      <ol className="flex items-start">
        {STEP_LABELS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "current" : "upcoming";
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-2 last:flex-none">
              <div className="flex w-full items-center">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ease-vf-out",
                    state === "done" && "bg-vf-red-500 text-vf-on-dark",
                    state === "current" && "bg-vf-red-500/12 text-vf-red-600 ring-2 ring-vf-red-500",
                    state === "upcoming" && "bg-vf-paper-alt text-vf-ink-faint",
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <span className={cn("mx-1.5 h-0.5 flex-1 rounded-full transition-colors duration-200 ease-vf-out", state === "done" ? "bg-vf-red-500" : "bg-vf-paper-border")} />
                )}
              </div>
              <span className={cn("hidden text-center text-[0.7rem] font-medium sm:block", state === "upcoming" ? "text-vf-ink-faint" : "text-vf-ink")}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Step content */}
      <div key={step} className="vf-step-in">
        {step === 0 && <StepCompanyDetails values={values} set={set} />}
        {step === 1 && <StepAccountingSetup values={values} set={set} currencies={currencies} />}
        {step === 2 && <StepBusinessProfile values={values} set={set} />}
        {step === 3 && <StepAIConfiguration values={values} set={set} />}
        {step === 4 && <StepReview values={values} currencies={currencies} loading={loading} submitError={submitError} onSubmit={handleSubmit} />}

        {step === 0 && nameError && (
          <p role="alert" className="mt-3 text-xs text-vf-danger">
            {nameError}
          </p>
        )}
      </div>

      {/* Wizard navigation — the Review step (last) has its own "Create
          Company" button inside StepReview, so no "Next" renders there. */}
      {step < STEP_LABELS.length - 1 && (
        <div className="flex items-center justify-between border-t border-vf-paper-border pt-6">
          <Button type="button" variant="subtle" onClick={step === 0 ? () => router.back() : goBack}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          <Button type="button" variant="primary" onClick={goNext}>
            Continue
          </Button>
        </div>
      )}
      {step === STEP_LABELS.length - 1 && (
        <div className="flex items-center justify-start border-t border-vf-paper-border pt-6">
          <Button type="button" variant="subtle" onClick={goBack} disabled={loading}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
