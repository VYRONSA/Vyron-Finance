/**
 * The company letterhead for printed reports and documents — read once
 * on the server (so the Puppeteer PDF never races a client fetch), from
 * the same company record and branding service the invoice header uses.
 */

import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { getCompanyBrandingAssets } from "@/server/services/company-branding-service";
import { MOCK_COMPANIES_FULL, MOCK_COMPANY_BRANDING } from "@/lib/mock/company-management-data";
import { MOCK_COMPANY } from "@/lib/mock/financial-data";

export type Letterhead = {
  name: string;
  tradingName: string;
  address: string;
  telephone: string;
  email: string;
  website: string;
  registrationNumber: string;
  vatNumber: string;
  logoUrl: string | null;
};

export async function loadLetterhead(companyId: string): Promise<Letterhead> {
  const preview = !isSupabaseConfigured();
  const company = preview ? MOCK_COMPANIES_FULL.find((c) => c.id === MOCK_COMPANY.id) ?? null : await getCompany(companyId);
  const branding = preview ? MOCK_COMPANY_BRANDING : await getCompanyBrandingAssets(companyId).catch(() => null);
  return {
    name: company?.name ?? MOCK_COMPANY.name,
    tradingName: company?.tradingName ?? "",
    address: company?.address ?? "",
    telephone: company?.telephone ?? "",
    email: company?.email ?? "",
    website: company?.website ?? "",
    registrationNumber: company?.registrationNumber ?? "",
    vatNumber: company?.vatNumber ?? "",
    logoUrl: branding?.hasLogo && branding.logoUrl ? branding.logoUrl : null,
  };
}
