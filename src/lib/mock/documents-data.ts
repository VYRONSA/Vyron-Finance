import { MOCK_COMPANY } from "./financial-data";
import type { DocumentRecord } from "@/server/documents/types";

const COMPANY_ID = MOCK_COMPANY.id;

/** Sample rows for the RC1 Phase 4 Document Platform's Preview Mode —
 * one shared shape, filtered client-side by entityType/entityId exactly
 * like the real `/api/companies/[companyId]/documents` route filters
 * server-side. */
export const MOCK_DOCUMENTS: DocumentRecord[] = [
  {
    id: 1, companyId: COMPANY_ID, entityType: "Customer", entityId: 1, documentGroupId: null, versionNumber: 1, isCurrent: true,
    category: "Contract", filename: "meridian-traders-service-agreement.pdf", storagePath: `${COMPANY_ID}/Customer/1/2025-03-10-service-agreement.pdf`,
    mimeType: "application/pdf", sizeBytes: 284_112, virusScanStatus: "clean", ocrStatus: "skipped", ocrMetadata: null,
    retentionUntil: null, uploadedBy: "Nomsa Dlamini", uploadedAt: "2025-03-10T09:12:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, entityType: "Customer", entityId: 1, documentGroupId: null, versionNumber: 1, isCurrent: true,
    category: "Compliance", filename: "meridian-traders-vat-certificate.pdf", storagePath: `${COMPANY_ID}/Customer/1/2025-03-11-vat-certificate.pdf`,
    mimeType: "application/pdf", sizeBytes: 96_430, virusScanStatus: "clean", ocrStatus: "skipped", ocrMetadata: null,
    retentionUntil: "2030-03-11", uploadedBy: "Nomsa Dlamini", uploadedAt: "2025-03-11T14:05:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, entityType: "Supplier", entityId: 1, documentGroupId: 3, versionNumber: 2, isCurrent: true,
    category: "Contract", filename: "fenwick-office-supply-agreement-v2.pdf", storagePath: `${COMPANY_ID}/Supplier/1/2025-06-02-supply-agreement-v2.pdf`,
    mimeType: "application/pdf", sizeBytes: 312_050, virusScanStatus: "clean", ocrStatus: "skipped", ocrMetadata: null,
    retentionUntil: null, uploadedBy: "Grace Mokoena", uploadedAt: "2025-06-02T10:30:00Z",
  },
  {
    id: 4, companyId: COMPANY_ID, entityType: "Supplier", entityId: 1, documentGroupId: 3, versionNumber: 1, isCurrent: false,
    category: "Contract", filename: "fenwick-office-supply-agreement.pdf", storagePath: `${COMPANY_ID}/Supplier/1/2025-02-01-supply-agreement.pdf`,
    mimeType: "application/pdf", sizeBytes: 298_770, virusScanStatus: "clean", ocrStatus: "skipped", ocrMetadata: null,
    retentionUntil: null, uploadedBy: "Grace Mokoena", uploadedAt: "2025-02-01T09:20:00Z",
  },
  {
    id: 5, companyId: COMPANY_ID, entityType: "Asset", entityId: 1, documentGroupId: null, versionNumber: 1, isCurrent: true,
    category: "Proof of Payment", filename: "toyota-hilux-purchase-invoice.pdf", storagePath: `${COMPANY_ID}/Asset/1/2022-01-20-purchase-invoice.pdf`,
    mimeType: "application/pdf", sizeBytes: 154_990, virusScanStatus: "clean", ocrStatus: "skipped", ocrMetadata: null,
    retentionUntil: "2032-01-20", uploadedBy: "System", uploadedAt: "2022-01-20T08:00:00Z",
  },
  {
    id: 6, companyId: COMPANY_ID, entityType: "Asset", entityId: 1, documentGroupId: null, versionNumber: 1, isCurrent: true,
    category: "Evidence", filename: "toyota-hilux-registration-photo.jpg", storagePath: `${COMPANY_ID}/Asset/1/2022-01-22-registration-photo.jpg`,
    mimeType: "image/jpeg", sizeBytes: 1_204_880, virusScanStatus: "pending", ocrStatus: "skipped", ocrMetadata: null,
    retentionUntil: null, uploadedBy: "System", uploadedAt: "2022-01-22T11:45:00Z",
  },
];
