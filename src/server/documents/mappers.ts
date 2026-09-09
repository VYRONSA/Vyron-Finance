import type { DocumentEntityType, DocumentRecord, OcrStatus, VirusScanStatus } from "./types";

export type DocumentRow = {
  id: number;
  company_id: string;
  entity_type: string;
  entity_id: number;
  document_group_id: number | null;
  version_number: number;
  is_current: boolean;
  category: string;
  filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  virus_scan_status: string;
  ocr_status: string;
  ocr_metadata: Record<string, unknown> | null;
  retention_until: string | null;
  uploaded_by: string;
  uploaded_at: string;
};

export function documentFromRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    entityType: row.entity_type as DocumentEntityType,
    entityId: row.entity_id,
    documentGroupId: row.document_group_id,
    versionNumber: row.version_number,
    isCurrent: row.is_current,
    category: row.category,
    filename: row.filename,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    virusScanStatus: row.virus_scan_status as VirusScanStatus,
    ocrStatus: row.ocr_status as OcrStatus,
    ocrMetadata: row.ocr_metadata,
    retentionUntil: row.retention_until,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
  };
}
