import type { CompanyBrandingRecord } from "./types";

export type CompanyBrandingRow = {
  id: number;
  company_id: string;
  logo_storage_path: string | null;
  logo_filename: string | null;
  logo_mime_type: string | null;
  logo_size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export function companyBrandingFromRow(row: CompanyBrandingRow): CompanyBrandingRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    logoStoragePath: row.logo_storage_path,
    logoFilename: row.logo_filename,
    logoMimeType: row.logo_mime_type,
    logoSizeBytes: row.logo_size_bytes,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
