/**
 * Application Service for Phase 20B — Company Branding & Logo Storage
 * Foundation. The ONE place any caller reads, uploads, replaces, or
 * removes a company's logo. Storage foundation only — nothing here
 * renders a logo onto an invoice, statement, credit note, financial
 * statement, or PDF; that "Document Branding Layer" is deliberately not
 * built in this phase.
 *
 * Permission checks happen at the API route layer (the same
 * `requirePermission()` composition every other Settings-gated route
 * uses — see `src/app/api/companies/[companyId]/route.ts`'s PATCH
 * handler), never re-implemented here. Every repository call is scoped
 * to the caller-supplied `companyId` (RLS is defense-in-depth, not the
 * only check) — this service never trusts a company id without that
 * scoping.
 */

import * as repo from "@/server/repositories/company-branding-repository";
import { buildLogoStoragePath, validateLogoFile } from "@/server/company-branding/branding-engine";
import type { CompanyBrandingAssets } from "@/server/company-branding/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

/** The one place a caller learns "does this company have a logo, and
 * where." Never returns a raw storage path — always a short-lived
 * signed URL, generated fresh on every call. */
export async function getCompanyBrandingAssets(companyId: string): Promise<CompanyBrandingAssets> {
  const branding = await repo.getCompanyBranding(companyId);
  if (!branding?.logoStoragePath) {
    return { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: branding?.updatedAt ?? null };
  }
  const logoUrl = await repo.getSignedLogoUrl(branding.logoStoragePath);
  return {
    hasLogo: true,
    logoUrl,
    logoFilename: branding.logoFilename,
    logoMimeType: branding.logoMimeType,
    logoSizeBytes: branding.logoSizeBytes,
    updatedAt: branding.updatedAt,
  };
}

/** Phase 24B — for embedding a logo into a SENT email, where a 5-minute
 * signed URL (`getCompanyBrandingAssets`'s own `logoUrl`) would already
 * be dead by the time a recipient opens it. Downloads the real bytes
 * once and inlines them as a base64 `data:` URI, which needs no ongoing
 * Storage access at all to keep rendering. Returns `null` — never a
 * broken-image placeholder — when the company has no logo. */
export async function getCompanyLogoDataUri(companyId: string): Promise<string | null> {
  const branding = await repo.getCompanyBranding(companyId);
  if (!branding?.logoStoragePath || !branding.logoMimeType) return null;
  const bytes = await repo.downloadLogoFile(branding.logoStoragePath);
  return `data:${branding.logoMimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export type UploadLogoInput = {
  companyId: string;
  filename: string;
  mimeType: string;
  file: Blob;
  uploadedBy: string;
};

/** Uploads a company's first logo, or replaces its existing one — one
 * function for both, since the ordering rule is identical either way:
 * (1) upload the new file, (2) point the DB row at it, (3) ONLY THEN
 * remove the old file, if there was one. A failure at step 1 or 2 always
 * leaves the previous logo (if any) fully intact — the DB row is either
 * left untouched (step 2 never ran) or fully updated (step 2 committed),
 * never partially written. A failure removing the superseded file at
 * step 3 is a harmless storage orphan (nothing still references it) —
 * the same accepted "storage-first" tradeoff document-repository.ts's
 * own upload path already documents — and is never surfaced as an error
 * to the caller, since the new logo is already live and correct. */
export async function uploadLogo(input: UploadLogoInput): Promise<CompanyBrandingAssets> {
  if (!input.filename.trim()) throw new ValidationError("Filename is required.");
  const validation = validateLogoFile(input.mimeType, input.file.size);
  if (!validation.valid) throw new ValidationError(validation.reason);

  const existing = await repo.getCompanyBranding(input.companyId);
  const uploadedAt = new Date().toISOString();
  const storagePath = buildLogoStoragePath(input.companyId, input.filename, uploadedAt);

  await repo.uploadLogoFile(storagePath, input.file, input.mimeType);

  const logoFields = {
    logoStoragePath: storagePath,
    logoFilename: input.filename,
    logoMimeType: input.mimeType,
    logoSizeBytes: input.file.size,
    uploadedBy: input.uploadedBy,
  };

  if (existing) {
    await repo.updateLogoReference(input.companyId, logoFields);
  } else {
    await repo.insertCompanyBranding({ companyId: input.companyId, ...logoFields });
  }

  if (existing?.logoStoragePath) {
    try {
      await repo.deleteLogoFile(existing.logoStoragePath);
    } catch {
      // Best-effort cleanup of the superseded asset only — the new logo
      // is already live and correctly referenced; see the doc comment above.
    }
  }

  return getCompanyBrandingAssets(input.companyId);
}

/** Removes a company's logo — (1) the caller's access to `companyId` is
 * already established by the route's `requireSession`/`requirePermission`
 * composition before this is called, (2) the stored asset is removed,
 * (3) the DB reference is cleared, (4) `getCompanyBrandingAssets` then
 * naturally reports the empty state. Throws `NotFoundError` rather than
 * silently succeeding when there is nothing to remove. */
export async function removeLogo(companyId: string): Promise<void> {
  const existing = await repo.getCompanyBranding(companyId);
  if (!existing?.logoStoragePath) throw new NotFoundError("This company has no logo to remove.");
  await repo.deleteLogoFile(existing.logoStoragePath);
  await repo.clearLogoReference(companyId);
}
