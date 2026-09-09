"use client";

import { useEffect, useState } from "react";
import type { Company } from "@/server/company-management/types";
import type { CompanyBrandingAssets } from "@/server/company-branding/types";

/** Phase 20C/20D — the ONE shared company header for every customer-
 * facing document (Invoice, Customer Statement, and any future document
 * type). Reuses the EXISTING, already-tenant-isolated routes — never a
 * second logo lookup, never a direct Supabase Storage call from a
 * document component:
 *   - `GET /api/companies/{companyId}` (existing route) for the full
 *     `Company` record — name, trading name, registration/VAT numbers,
 *     physical/postal address, telephone/email/website.
 *   - `GET /api/companies/{companyId}/branding` (Phase 20B) for the
 *     logo, which itself calls `getCompanyBrandingAssets(companyId)` —
 *     the single source of truth for company branding.
 * Every field is optional and shown ONLY when non-empty — never a
 * placeholder like "N/A"/"Not provided" for a field the company hasn't
 * filled in. If there is no logo, or the signed URL fails to load, the
 * logo area is simply omitted — never a broken image. */
export function DocumentBrandingHeader({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [branding, setBranding] = useState<CompanyBrandingAssets | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/companies/${companyId}`).then((res) => (res.ok ? res.json() : { company: null })),
      fetch(`/api/companies/${companyId}/branding`).then((res) => (res.ok ? res.json() : { branding: null })),
    ]).then(([companyBody, brandingBody]) => {
      if (cancelled) return;
      setCompany(companyBody.company ?? null);
      setBranding(brandingBody.branding ?? null);
      // Reset on every successful (re-)fetch — this component is always
      // freshly mounted per document view (the caller unmounts it on
      // close), so this only matters if `companyId` ever changes on an
      // already-mounted instance.
      setLogoFailed(false);
    });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const showLogo = Boolean(branding?.hasLogo && branding.logoUrl && !logoFailed);
  const showPostalAddress = Boolean(company?.postalAddress && company.postalAddress !== company.address);
  const contactParts: string[] = [];
  if (company?.telephone) contactParts.push(`Tel: ${company.telephone}`);
  if (company?.email) contactParts.push(company.email);
  if (company?.website) contactParts.push(company.website);
  const contactLine = contactParts.join(" | ");

  return (
    <div className="flex items-start justify-between gap-6 border-b border-vf-paper-border pb-6">
      <div>
        <p className="font-display text-xl font-semibold text-vf-ink">{company?.name ?? " "}</p>
        {company?.tradingName && <p className="text-sm text-vf-ink-soft">t/a {company.tradingName}</p>}
        {company?.address && <p className="mt-1 max-w-[36ch] text-sm text-vf-ink-soft">{company.address}</p>}
        {showPostalAddress && <p className="mt-0.5 max-w-[36ch] text-sm text-vf-ink-soft">Postal: {company?.postalAddress}</p>}
        {contactLine && <p className="mt-1 text-xs text-vf-ink-faint">{contactLine}</p>}
        {company?.registrationNumber && <p className="mt-1 text-xs text-vf-ink-faint">Reg No: {company.registrationNumber}</p>}
        {company?.vatNumber && <p className="text-xs text-vf-ink-faint">VAT No: {company.vatNumber}</p>}
      </div>
      {showLogo && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Supabase Storage URL (company-branding-service.ts), not a static/remote asset next/image's loader is configured for. This is a single-render document view, not a long-lived page, so the 300-second signed-URL expiry window is not a practical concern here.
        <img
          src={branding!.logoUrl!}
          alt={`${company?.name ?? "Company"} logo`}
          className="h-16 max-w-[220px] object-contain"
          onError={() => setLogoFailed(true)}
        />
      )}
    </div>
  );
}
