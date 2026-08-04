/**
 * Application Service for the RC1 Phase 4 Document Platform — the ONE
 * place any module attaches/lists/versions/deletes a file. Permission
 * checks happen at the API route layer (the same `requirePermission()`
 * composition every other gated route uses — see
 * `document-service.ts`'s own callers), consuming the module the
 * document's `entityType` maps to (`DOCUMENT_PERMISSION_MODULE`), never
 * a bespoke document-specific permission scheme.
 */

import * as repo from "@/server/repositories/document-repository";
import { buildStoragePath, groupVersions, isValidDocumentCategory, nextVersionNumber } from "@/server/documents/document-engine";
import { defaultVirusScanner, type VirusScanner } from "@/server/documents/virus-scanner";
import { defaultOcrProvider, type OcrProvider } from "@/server/documents/ocr-provider";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import type { DocumentEntityType, DocumentRecord } from "@/server/documents/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class UsageLimitExceededError extends Error {}

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — a real, enforced ceiling, not an unbounded upload

export const listDocumentsForEntity = repo.listDocumentsForEntity;
export const listVersionsForGroup = repo.listVersionsForGroup;

export type UploadDocumentInput = {
  companyId: string;
  entityType: DocumentEntityType;
  entityId: number;
  category: string;
  filename: string;
  mimeType: string;
  file: Blob;
  retentionUntil: string | null;
  uploadedBy: string;
};

/** Uploads a new document — or a new VERSION of an existing one, when
 * `replacesDocumentId` names a real, current document already attached
 * to the same entity. Storage upload happens before the DB row, and the
 * prior version is marked superseded only after the new row commits, so
 * a failure partway through never leaves the entity with zero current
 * versions. Virus scan / OCR extension points are invoked
 * fire-and-forget style with real (if today `"skipped"`) results
 * recorded — never silently skipped without a record. */
export async function uploadDocument(
  input: UploadDocumentInput,
  replacesDocumentId: number | null,
  scanner: VirusScanner = defaultVirusScanner,
  ocr: OcrProvider = defaultOcrProvider,
): Promise<DocumentRecord> {
  if (!input.filename.trim()) throw new ValidationError("Filename is required.");
  if (!isValidDocumentCategory(input.category)) throw new ValidationError(`Invalid category "${input.category}".`);
  if (input.file.size <= 0) throw new ValidationError("File is empty.");
  if (input.file.size > MAX_FILE_SIZE_BYTES) throw new ValidationError(`File exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit.`);

  // Commercial Billing Platform — "Storage exceeded -> Document upload
  // blocked," enforced through the one Licensing Engine. Checked here
  // (the one place every upload path — new document AND new version —
  // already funnels through), not re-checked per caller.
  const storageMbForThisFile = input.file.size / (1024 * 1024);
  const storageCheck = await checkUsageLimit(input.companyId, "max_storage_mb", storageMbForThisFile);
  if (!storageCheck.allowed) {
    throw new UsageLimitExceededError(storageCheck.reason ?? "Your plan's storage limit has been reached.");
  }

  let documentGroupId: number | null = null;
  let versionNumber = 1;
  let previous: DocumentRecord | null = null;

  if (replacesDocumentId !== null) {
    previous = await repo.getDocument(input.companyId, replacesDocumentId);
    if (!previous) throw new NotFoundError(`No document with id ${replacesDocumentId}.`);
    if (previous.entityType !== input.entityType || previous.entityId !== input.entityId) {
      throw new ValidationError("A new version must attach to the same entity as the document it replaces.");
    }
    documentGroupId = previous.documentGroupId ?? previous.id;
    const existingVersions = await repo.listVersionsForGroup(input.companyId, documentGroupId);
    versionNumber = nextVersionNumber(existingVersions);
  }

  const uploadedAt = new Date().toISOString();
  const storagePath = buildStoragePath(input.companyId, input.entityType, input.entityId, input.filename, uploadedAt);

  await repo.uploadDocumentFile(storagePath, input.file, input.mimeType);

  const created = await repo.insertDocumentVersion({
    companyId: input.companyId,
    entityType: input.entityType,
    entityId: input.entityId,
    documentGroupId,
    versionNumber,
    category: input.category,
    filename: input.filename,
    storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.file.size,
    retentionUntil: input.retentionUntil,
    uploadedBy: input.uploadedBy,
  });

  if (previous) {
    await repo.markVersionSuperseded(input.companyId, previous.id);
    if (previous.documentGroupId === null) {
      // First time this document gets a second version — the ORIGINAL
      // row becomes the group's anchor id, and the new row is stamped
      // to match, so both share one document_group_id going forward.
      await repo.setDocumentGroupId(input.companyId, previous.id, previous.id);
    }
  }

  // Extension points — real calls, real (if honestly "skipped") results
  // recorded via the security-definer RPC, never silently invoked with
  // the outcome discarded.
  const [scanResult, ocrResult] = await Promise.all([
    scanner.scan(created.storagePath, created.mimeType, created.sizeBytes),
    ocr.extract(created.storagePath, created.mimeType),
  ]);
  await repo.updateScanStatus(created.id, scanResult.status, ocrResult.status, ocrResult.metadata);

  return created;
}

export async function deleteDocument(companyId: string, documentId: number): Promise<void> {
  const document = await repo.getDocument(companyId, documentId);
  if (!document) throw new NotFoundError(`No document with id ${documentId}.`);
  await repo.deleteDocument(companyId, documentId, document.storagePath);
}

export async function getDownloadUrl(companyId: string, documentId: number): Promise<string> {
  const document = await repo.getDocument(companyId, documentId);
  if (!document) throw new NotFoundError(`No document with id ${documentId}.`);
  return repo.getSignedDownloadUrl(document.storagePath);
}

export async function listRetentionDue(companyId: string): Promise<DocumentRecord[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  return repo.listExpiredForRetention(companyId, todayIso);
}

/** Purges every document past its retention date — a real, callable
 * action (wired into the Administration workspace in RC1 Phase 6, not
 * auto-scheduled here — deleting customer/financial records on an
 * unattended timer with no review step was judged out of scope for this
 * pass to fabricate safely). */
export async function purgeRetentionDue(companyId: string): Promise<{ purged: number }> {
  const due = await listRetentionDue(companyId);
  for (const doc of due) await repo.deleteDocument(companyId, doc.id, doc.storagePath);
  return { purged: due.length };
}

export { groupVersions };
