/**
 * Pure Company Branding engine — no Supabase. Storage-path construction
 * and upload validation, kept testable without a database. Mirrors
 * document-engine.ts's `buildStoragePath` convention.
 */

import { MAX_LOGO_SIZE_BYTES, isSupportedLogoMimeType } from "./types";

/** Pure — `{companyId}/logo/{timestamp}-{filename}`, matching the
 * storage RLS policy's own path-based company check
 * (`(storage.foldername(name))[1]::uuid`) exactly. One logo per company,
 * so no entity id segment is needed (unlike document-engine.ts's
 * per-entity path). */
export function buildLogoStoragePath(companyId: string, filename: string, uploadedAtIso: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = uploadedAtIso.replace(/[^0-9]/g, "").slice(0, 14);
  return `${companyId}/logo/${stamp}-${safeName}`;
}

export type LogoValidationResult = { valid: true } | { valid: false; reason: string };

/** Pure — the validation rules a logo upload must pass: a supported
 * raster MIME type, non-empty, and under the size ceiling. Does not
 * inspect file bytes (no image-decoding infrastructure exists in this
 * codebase) — MIME type and size are the same class of check
 * document-service.ts already relies on for uploads generally. */
export function validateLogoFile(mimeType: string, sizeBytes: number): LogoValidationResult {
  if (!isSupportedLogoMimeType(mimeType)) {
    return { valid: false, reason: `Unsupported image type "${mimeType}". Supported formats: PNG, JPEG, WEBP.` };
  }
  if (sizeBytes <= 0) return { valid: false, reason: "File is empty." };
  if (sizeBytes > MAX_LOGO_SIZE_BYTES) {
    return { valid: false, reason: `File exceeds the ${MAX_LOGO_SIZE_BYTES / 1024 / 1024}MB limit.` };
  }
  return { valid: true };
}
