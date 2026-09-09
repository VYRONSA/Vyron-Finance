/**
 * Domain types for Phase 20B — Company Branding & Logo Storage
 * Foundation. See supabase/migrations/0076_company_branding.sql. Storage
 * foundation only: no invoice/statement/PDF rendering type lives here.
 */

/** Raster formats only (brief: "if SVG support requires sanitization
 * infrastructure that doesn't exist, do NOT invent one") — SVG can embed
 * scripts/external references, and no sanitizer exists anywhere in this
 * codebase, so SVG is left as a documented future enhancement, not
 * supported here. */
export const SUPPORTED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SupportedLogoMimeType = (typeof SUPPORTED_LOGO_MIME_TYPES)[number];

/** A real, enforced ceiling for a logo image — deliberately much smaller
 * than the Document Platform's 25MB general-purpose ceiling
 * (document-service.ts), since a logo is a small UI asset, not an
 * arbitrary business document. */
export const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024;

export type CompanyBrandingRecord = {
  id: number;
  companyId: string;
  logoStoragePath: string | null;
  logoFilename: string | null;
  logoMimeType: string | null;
  logoSizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What `getCompanyBrandingAssets()` actually returns to callers — a
 * signed, short-lived URL rather than the raw storage path, and a real
 * `hasLogo` flag rather than callers having to null-check every field. */
export type CompanyBrandingAssets = {
  hasLogo: boolean;
  logoUrl: string | null;
  logoFilename: string | null;
  logoMimeType: string | null;
  logoSizeBytes: number | null;
  updatedAt: string | null;
};

export function isSupportedLogoMimeType(value: string): value is SupportedLogoMimeType {
  return (SUPPORTED_LOGO_MIME_TYPES as readonly string[]).includes(value);
}
