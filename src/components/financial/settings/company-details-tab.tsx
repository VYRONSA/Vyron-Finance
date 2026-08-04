"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { Company, CompanyStatus } from "@/server/company-management/types";

const STATUSES: CompanyStatus[] = ["active", "needs-attention", "onboarding"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const CURRENCIES = ["ZAR", "USD", "GBP", "EUR"];

export function CompanyDetailsTab({ company, previewMode }: { company: Company; previewMode: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: company.name,
    industry: company.industry,
    status: company.status,
    registrationNumber: company.registrationNumber,
    address: company.address,
    financialYearStartMonth: String(company.financialYearStartMonth),
    baseCurrencyCode: company.baseCurrencyCode,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          industry: values.industry,
          status: values.status,
          registrationNumber: values.registrationNumber,
          address: values.address,
          financialYearStartMonth: Number(values.financialYearStartMonth),
          baseCurrencyCode: values.baseCurrencyCode,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <Field label="Company Name" htmlFor="cd-name" required>
        <Input id="cd-name" value={values.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Industry" htmlFor="cd-industry">
        <Input id="cd-industry" value={values.industry} onChange={(e) => set("industry", e.target.value)} />
      </Field>
      <Field label="Status" htmlFor="cd-status">
        <Select id="cd-status" value={values.status} onChange={(e) => set("status", e.target.value as CompanyStatus)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </Field>
      <Field label="Registration Number" htmlFor="cd-reg">
        <Input id="cd-reg" value={values.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} />
      </Field>
      <Field label="Address" htmlFor="cd-address">
        <Input id="cd-address" value={values.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Financial Year Start Month" htmlFor="cd-fy-start">
          <Select id="cd-fy-start" value={values.financialYearStartMonth} onChange={(e) => set("financialYearStartMonth", e.target.value)}>
            {MONTHS.map((month, i) => (
              <option key={month} value={i + 1}>{month}</option>
            ))}
          </Select>
        </Field>
        <Field label="Base Currency" htmlFor="cd-currency">
          <Select id="cd-currency" value={values.baseCurrencyCode} onChange={(e) => set("baseCurrencyCode", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm text-vf-danger">
          {error}
        </p>
      )}
      {saved && <p className="text-sm text-vf-success">Saved.</p>}

      <div>
        <Button
          variant="primary"
          disabled={loading || previewMode}
          title={previewMode ? "Available once a production Supabase project is connected" : undefined}
          onClick={handleSave}
        >
          {loading ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
