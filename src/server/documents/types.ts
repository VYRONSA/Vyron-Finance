/**
 * Domain types for the RC1 Phase 4 Document Platform — the ONE shared
 * place every module attaches a file. See
 * supabase/migrations/0027_document_platform.sql.
 */

import type { PermissionModule } from "@/server/permissions/types";

export const DOCUMENT_ENTITY_TYPES = ["Customer", "Supplier", "Inventory", "Asset", "Journal", "BankStatement", "AuditEvidence", "FinancialStatement"] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

/** The exact module each entity type's documents inherit permissions
 * from — kept in sync with the SQL `document_permission_module()`
 * function (0027) so the pure engine and the DB policy can never
 * silently disagree about which permission gates which document.
 * Typed against the REAL `PermissionModule` union (not a bare string)
 * so a typo here is a compile error, not a silently-always-false RLS
 * check discovered in production. */
export const DOCUMENT_PERMISSION_MODULE: Record<DocumentEntityType, PermissionModule> = {
  Customer: "Sales",
  Supplier: "Purchasing",
  Inventory: "Inventory",
  Asset: "Assets",
  Journal: "GeneralLedger",
  BankStatement: "Banking",
  AuditEvidence: "Auditor",
  FinancialStatement: "Reports",
};

export const DOCUMENT_CATEGORIES = [
  "General", "Contract", "Invoice", "Statement", "Proof of Payment", "Compliance", "Correspondence", "Evidence", "Report",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type VirusScanStatus = "pending" | "clean" | "infected" | "skipped";
export type OcrStatus = "pending" | "completed" | "skipped";

export type DocumentRecord = {
  id: number;
  companyId: string;
  entityType: DocumentEntityType;
  entityId: number;
  documentGroupId: number | null;
  versionNumber: number;
  isCurrent: boolean;
  category: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  virusScanStatus: VirusScanStatus;
  ocrStatus: OcrStatus;
  ocrMetadata: Record<string, unknown> | null;
  retentionUntil: string | null;
  uploadedBy: string;
  uploadedAt: string;
};
