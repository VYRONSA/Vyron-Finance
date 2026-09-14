import type { Company } from "@/server/company-management/types";

export type BrandingCompany = Pick<
  Company,
  "name" | "tradingName" | "address" | "postalAddress" | "telephone" | "email" | "website" | "registrationNumber" | "vatNumber"
>;

/** The company header on every customer-facing document (Invoice, Customer
 * Statement). Pure markup — no hooks, no "use client" — so the SAME header
 * renders in the browser (`DocumentBrandingHeader` loads the data) and in
 * the server-rendered PDF (the data is loaded on the server). Every field is
 * shown only when non-empty; with no logo the logo area is simply omitted. */
export function DocumentBrandingBlock({
  company,
  logoSrc,
  onLogoError,
}: {
  company: BrandingCompany | null;
  logoSrc: string | null;
  onLogoError?: () => void;
}) {
  const showPostalAddress = Boolean(company?.postalAddress && company.postalAddress !== company.address);
  const contactParts: string[] = [];
  if (company?.telephone) contactParts.push(`Tel: ${company.telephone}`);
  if (company?.email) contactParts.push(company.email);
  if (company?.website) contactParts.push(company.website);
  const contactLine = contactParts.join(" | ");

  return (
    <div className="flex items-start justify-between gap-6 border-b border-vf-paper-border pb-6">
      <div>
        <p className="font-display text-xl font-semibold text-vf-ink">{company?.name ?? " "}</p>
        {company?.tradingName && <p className="text-sm text-vf-ink-soft">t/a {company.tradingName}</p>}
        {company?.address && <p className="mt-1 max-w-[36ch] text-sm text-vf-ink-soft">{company.address}</p>}
        {showPostalAddress && <p className="mt-0.5 max-w-[36ch] text-sm text-vf-ink-soft">Postal: {company?.postalAddress}</p>}
        {contactLine && <p className="mt-1 text-xs text-vf-ink-faint">{contactLine}</p>}
        {company?.registrationNumber && <p className="mt-1 text-xs text-vf-ink-faint">Reg No: {company.registrationNumber}</p>}
        {company?.vatNumber && <p className="text-xs text-vf-ink-faint">VAT No: {company.vatNumber}</p>}
      </div>
      {logoSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed Storage URL on screen, an inline data: URI in the PDF; neither suits next/image.
        <img src={logoSrc} alt={`${company?.name ?? "Company"} logo`} className="h-16 max-w-[220px] object-contain" onError={onLogoError} />
      )}
    </div>
  );
}
