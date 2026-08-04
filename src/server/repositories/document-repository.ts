/**
 * Repository layer for the RC1 Phase 4 Document Platform. See
 * supabase/migrations/0027_document_platform.sql. The ONE place any
 * module reaches Supabase Storage — never a per-module upload path.
 */

import { createClient } from "@/lib/supabase/server";
import { documentFromRow, type DocumentRow } from "@/server/documents/mappers";
import type { DocumentEntityType, DocumentRecord } from "@/server/documents/types";

const BUCKET = "documents";
const SIGNED_URL_EXPIRY_SECONDS = 300;

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listDocumentsForEntity(companyId: string, entityType: DocumentEntityType, entityId: number): Promise<DocumentRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("uploaded_at", { ascending: false })
    .limit(LIST_CAP)
    .returns<DocumentRow[]>();
  if (error) throw error;
  return data.map(documentFromRow);
}

export async function listVersionsForGroup(companyId: string, documentGroupId: number): Promise<DocumentRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("company_id", companyId)
    .or(`document_group_id.eq.${documentGroupId},id.eq.${documentGroupId}`)
    .order("version_number", { ascending: false })
    .limit(LIST_CAP)
    .returns<DocumentRow[]>();
  if (error) throw error;
  return data.map(documentFromRow);
}

export async function getDocument(companyId: string, documentId: number): Promise<DocumentRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").select("*").eq("company_id", companyId).eq("id", documentId).maybeSingle<DocumentRow>();
  if (error) throw error;
  return data ? documentFromRow(data) : null;
}

export type NewDocument = {
  companyId: string;
  entityType: DocumentEntityType;
  entityId: number;
  documentGroupId: number | null;
  versionNumber: number;
  category: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  retentionUntil: string | null;
  uploadedBy: string;
};

/** Uploads the real file bytes to the shared Storage bucket, then
 * inserts the metadata row — if either step fails, the caller sees a
 * real error rather than a metadata row with no real file behind it
 * (the storage upload happens first specifically so a failed insert
 * never leaves an orphaned DB row pointing at a real file). */
export async function uploadDocumentFile(storagePath: string, file: Blob | ArrayBuffer, contentType: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, { contentType, upsert: false });
  if (error) throw error;
}

export async function insertDocumentVersion(input: NewDocument): Promise<DocumentRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      company_id: input.companyId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      document_group_id: input.documentGroupId,
      version_number: input.versionNumber,
      is_current: true,
      category: input.category,
      filename: input.filename,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      retention_until: input.retentionUntil,
      uploaded_by: input.uploadedBy,
    })
    .select("*")
    .single<DocumentRow>();
  if (error) throw error;
  return documentFromRow(data);
}

export async function markVersionSuperseded(companyId: string, documentId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({ is_current: false }).eq("company_id", companyId).eq("id", documentId);
  if (error) throw error;
}

/** Sets `document_group_id` on the FIRST version of a document, once a
 * second version exists — before that, a lone document is its own
 * implicit group (see `document-engine.ts::groupVersions`). */
export async function setDocumentGroupId(companyId: string, documentId: number, documentGroupId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({ document_group_id: documentGroupId }).eq("company_id", companyId).eq("id", documentId);
  if (error) throw error;
}

export async function deleteDocument(companyId: string, documentId: number, storagePath: string): Promise<void> {
  const supabase = await createClient();
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (storageError) throw storageError;
  const { error: dbError } = await supabase.from("documents").delete().eq("company_id", companyId).eq("id", documentId);
  if (dbError) throw dbError;
}

export async function getSignedDownloadUrl(storagePath: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function listExpiredForRetention(companyId: string, asOfIso: string): Promise<DocumentRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("company_id", companyId)
    .not("retention_until", "is", null)
    .lt("retention_until", asOfIso)
    .limit(LIST_CAP)
    .returns<DocumentRow[]>();
  if (error) throw error;
  return data.map(documentFromRow);
}

export async function updateScanStatus(documentId: number, virusScanStatus: string | null, ocrStatus: string | null, ocrMetadata: Record<string, unknown> | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_document_scan_status", {
    target_document_id: documentId,
    p_virus_scan_status: virusScanStatus,
    p_ocr_status: ocrStatus,
    p_ocr_metadata: ocrMetadata,
  });
  if (error) throw error;
}
