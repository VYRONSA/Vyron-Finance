/**
 * Repository layer for Phase 20B — Company Branding & Logo Storage
 * Foundation. See supabase/migrations/0076_company_branding.sql. The ONE
 * place company logo assets reach Supabase Storage/the database —
 * mirrors document-repository.ts's exact call shapes.
 */

import { createClient } from "@/lib/supabase/server";
import { companyBrandingFromRow, type CompanyBrandingRow } from "@/server/company-branding/mappers";
import type { CompanyBrandingRecord } from "@/server/company-branding/types";

const BUCKET = "company-branding";
const SIGNED_URL_EXPIRY_SECONDS = 300;

export async function getCompanyBranding(companyId: string): Promise<CompanyBrandingRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_branding")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle<CompanyBrandingRow>();
  if (error) throw error;
  return data ? companyBrandingFromRow(data) : null;
}

/** Uploads the real logo bytes to the dedicated bucket — the caller
 * always writes to a fresh, timestamped path, so `upsert: false` is safe
 * and matches document-repository.ts's own convention (a failed insert
 * afterwards never silently overwrites a real file). */
export async function uploadLogoFile(storagePath: string, file: Blob, contentType: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, { contentType, upsert: false });
  if (error) throw error;
}

export async function deleteLogoFile(storagePath: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

/** Phase 24B — a signed logo URL expires in 5 minutes (fine for an
 * immediately-rendered browser preview, useless once embedded as an
 * `<img src>` in a SENT email a recipient might open days later). The
 * branded email template downloads the real bytes once, at send time,
 * and inlines them as a base64 data URI instead — mirrors
 * `document-repository.ts::downloadDocumentFile`'s exact same reasoning
 * and shape. */
export async function downloadLogoFile(storagePath: string): Promise<ArrayBuffer> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw error;
  return data.arrayBuffer();
}

export async function getSignedLogoUrl(storagePath: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export type NewCompanyBrandingLogo = {
  companyId: string;
  logoStoragePath: string;
  logoFilename: string;
  logoMimeType: string;
  logoSizeBytes: number;
  uploadedBy: string;
};

/** Creates the company's first-ever branding row. `company_branding` has
 * a unique constraint on `company_id`, so this is only ever called once
 * per company — every later upload goes through `updateLogoReference`. */
export async function insertCompanyBranding(input: NewCompanyBrandingLogo): Promise<CompanyBrandingRecord> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("company_branding")
    .insert({
      company_id: input.companyId,
      logo_storage_path: input.logoStoragePath,
      logo_filename: input.logoFilename,
      logo_mime_type: input.logoMimeType,
      logo_size_bytes: input.logoSizeBytes,
      uploaded_by: input.uploadedBy,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single<CompanyBrandingRow>();
  if (error) throw error;
  return companyBrandingFromRow(data);
}

/** Points an existing branding row at a newly-uploaded logo — called
 * only AFTER the new file's upload has already succeeded (replace-
 * ordering requirement: upload new, update DB, only then remove old). */
export async function updateLogoReference(companyId: string, input: Omit<NewCompanyBrandingLogo, "companyId">): Promise<CompanyBrandingRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_branding")
    .update({
      logo_storage_path: input.logoStoragePath,
      logo_filename: input.logoFilename,
      logo_mime_type: input.logoMimeType,
      logo_size_bytes: input.logoSizeBytes,
      uploaded_by: input.uploadedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .select("*")
    .single<CompanyBrandingRow>();
  if (error) throw error;
  return companyBrandingFromRow(data);
}

/** Clears the logo reference back to empty (Remove Logo) — the row
 * itself is kept (not deleted) so a later upload always has exactly one
 * existing row to update, never a race to re-insert past the unique
 * `company_id` constraint. */
export async function clearLogoReference(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_branding")
    .update({
      logo_storage_path: null,
      logo_filename: null,
      logo_mime_type: null,
      logo_size_bytes: null,
      uploaded_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId);
  if (error) throw error;
}
