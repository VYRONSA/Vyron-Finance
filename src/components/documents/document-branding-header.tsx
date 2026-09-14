"use client";

import { useEffect, useState } from "react";
import type { Company } from "@/server/company-management/types";
import type { CompanyBrandingAssets } from "@/server/company-branding/types";
import { DocumentBrandingBlock } from "./print/branding-block";

/** Phase 20C/20D — the ONE shared company header for every customer-
 * facing document (Invoice, Customer Statement, and any future document
 * type) in the browser. Reuses the EXISTING, already-tenant-isolated
 * routes — never a second logo lookup, never a direct Supabase Storage
 * call from a document component:
 *   - `GET /api/companies/{companyId}` (existing route) for the full
 *     `Company` record — name, trading name, registration/VAT numbers,
 *     physical/postal address, telephone/email/website.
 *   - `GET /api/companies/{companyId}/branding` (Phase 20B) for the
 *     logo, which itself calls `getCompanyBrandingAssets(companyId)` —
 *     the single source of truth for company branding.
 * The markup is `DocumentBrandingBlock`, which the server-rendered PDF
 * renders with the same data loaded on the server. If there is no logo,
 * or the signed URL fails to load, the logo area is simply omitted —
 * never a broken image. */
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
  return <DocumentBrandingBlock company={company} logoSrc={showLogo ? branding!.logoUrl! : null} onLogoError={() => setLogoFailed(true)} />;
}
