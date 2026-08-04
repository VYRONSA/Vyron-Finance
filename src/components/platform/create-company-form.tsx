"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";

const INDUSTRIES = ["Retail", "Professional Services", "Transport", "Healthcare", "Manufacturing", "Hospitality", "Other"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const CURRENCIES = ["ZAR", "USD", "GBP", "EUR"];

export function CreateCompanyForm({ previewMode }: { previewMode: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: "",
    industry: INDUSTRIES[0],
    registrationNumber: "",
    address: "",
    financialYearStartMonth: "3",
    baseCurrencyCode: "ZAR",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = "Company name is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          industry: values.industry,
          registrationNumber: values.registrationNumber.trim(),
          address: values.address.trim(),
          financialYearStartMonth: Number(values.financialYearStartMonth),
          baseCurrencyCode: values.baseCurrencyCode,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? `Request failed (${res.status})`);
        return;
      }

      router.push(`/company/${json.company.id}/dashboard`);
      router.refresh();
    } catch {
      setSubmitError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {previewMode && (
        <p className="rounded-lg border border-vf-warning/25 bg-vf-warning/8 px-3.5 py-2.5 text-sm text-[#93601f]">
          No Supabase project is configured yet — this form is fully functional but saving will fail
          until real credentials exist. See ARCHITECTURE.md.
        </p>
      )}

      <Field label="Company Name" htmlFor="name" required error={errors.name}>
        <Input id="name" value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Acme Trading Ltd" />
      </Field>

      <Field label="Industry" htmlFor="industry">
        <Select id="industry" value={values.industry} onChange={(e) => set("industry", e.target.value)}>
          {INDUSTRIES.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </Select>
      </Field>

      <Field label="Registration Number" htmlFor="registrationNumber">
        <Input
          id="registrationNumber"
          value={values.registrationNumber}
          onChange={(e) => set("registrationNumber", e.target.value)}
          placeholder="2026/123456/07"
        />
      </Field>

      <Field label="Address" htmlFor="address">
        <Input id="address" value={values.address} onChange={(e) => set("address", e.target.value)} placeholder="12 Main Street, Cape Town" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Financial Year Start Month" htmlFor="financialYearStartMonth">
          <Select id="financialYearStartMonth" value={values.financialYearStartMonth} onChange={(e) => set("financialYearStartMonth", e.target.value)}>
            {MONTHS.map((month, i) => (
              <option key={month} value={i + 1}>{month}</option>
            ))}
          </Select>
        </Field>
        <Field label="Base Currency" htmlFor="baseCurrencyCode">
          <Select id="baseCurrencyCode" value={values.baseCurrencyCode} onChange={(e) => set("baseCurrencyCode", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>

      {submitError && (
        <p role="alert" className="rounded-lg border border-vf-danger/25 bg-vf-danger/8 px-3.5 py-2.5 text-sm text-vf-danger">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Creating…" : "Create Company"}
        </Button>
        <Button type="button" variant="subtle" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
