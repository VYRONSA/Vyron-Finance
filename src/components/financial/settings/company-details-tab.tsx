"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { Company, CompanyStatus, Currency } from "@/server/company-management/types";

const STATUSES: CompanyStatus[] = ["active", "needs-attention", "onboarding"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CompanyDetailsTab({ company, currencies, previewMode }: { company: Company; currencies: Currency[]; previewMode: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: company.name,
    industry: company.industry,
    status: company.status,
    registrationNumber: company.registrationNumber,
    address: company.address,
    financialYearStartMonth: String(company.financialYearStartMonth),
    baseCurrencyCode: company.baseCurrencyCode,
    tradingName: company.tradingName,
    vatNumber: company.vatNumber,
    telephone: company.telephone,
    email: company.email,
    website: company.website,
    postalAddress: company.postalAddress,
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
          tradingName: values.tradingName,
          vatNumber: values.vatNumber,
          telephone: values.telephone,
          email: values.email,
          website: values.website,
          postalAddress: values.postalAddress,
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
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Business Information</p>
        <Field label="Legal Name" htmlFor="cd-name" required>
          <Input id="cd-name" value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Trading Name" htmlFor="cd-trading-name">
          <Input id="cd-trading-name" value={values.tradingName} onChange={(e) => set("tradingName", e.target.value)} placeholder="If different from the legal name" />
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Registration Number" htmlFor="cd-reg">
            <Input id="cd-reg" value={values.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} placeholder="Company registration number" />
          </Field>
          <Field label="VAT Number" htmlFor="cd-vat-number">
            <Input id="cd-vat-number" value={values.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} placeholder="If VAT registered" />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Contact Information</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Telephone" htmlFor="cd-telephone">
            <Input id="cd-telephone" type="tel" value={values.telephone} onChange={(e) => set("telephone", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="cd-email">
            <Input id="cd-email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>
        <Field label="Website" htmlFor="cd-website">
          <Input id="cd-website" value={values.website} onChange={(e) => set("website", e.target.value)} placeholder="example.co.za" />
        </Field>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Address</p>
        <Field label="Physical Address" htmlFor="cd-address">
          <Input id="cd-address" value={values.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Postal Address" htmlFor="cd-postal-address">
          <Input id="cd-postal-address" value={values.postalAddress} onChange={(e) => set("postalAddress", e.target.value)} placeholder="If different from the physical address" />
        </Field>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Financial Configuration</p>
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
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
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
