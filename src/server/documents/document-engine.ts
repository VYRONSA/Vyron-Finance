/**
 * Pure Document Platform engine — no Supabase. Version numbering,
 * retention-expiry, storage-path construction, and category validation
 * — the logic every document upload/list/retention sweep needs, kept
 * testable without a database.
 */

import { DOCUMENT_CATEGORIES, type DocumentRecord } from "./types";

/** Pure — the next version number and whether this upload starts a new
 * document group or extends an existing one. `existingVersions` is
 * every version already on record for the SAME logical document (same
 * `documentGroupId`, or the single first-version row before a group id
 * exists) — the caller resolves which prior versions apply, this
 * function only does the arithmetic. */
export function nextVersionNumber(existingVersions: DocumentRecord[]): number {
  if (existingVersions.length === 0) return 1;
  return Math.max(...existingVersions.map((v) => v.versionNumber)) + 1;
}

/** Pure — a real Storage path convention, `{companyId}/{entityType}/{entityId}/{timestamp}-{filename}`,
 * matching the RLS policy's own path-based company check
 * (`(storage.foldername(name))[1]::uuid`) exactly — the DB policy and
 * this function must never disagree about where company_id lives in
 * the path. */
export function buildStoragePath(companyId: string, entityType: string, entityId: number, filename: string, uploadedAtIso: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = uploadedAtIso.replace(/[^0-9]/g, "").slice(0, 14);
  return `${companyId}/${entityType}/${entityId}/${stamp}-${safeName}`;
}

export function isValidDocumentCategory(value: string): boolean {
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

/** Pure — a document is due for retention purge once `retentionUntil`
 * has passed. `retentionUntil: null` means "keep forever" — never
 * treated as "already expired," the opposite of the intended meaning. */
export function isRetentionExpired(document: Pick<DocumentRecord, "retentionUntil">, asOfIso: string): boolean {
  if (document.retentionUntil === null) return false;
  return document.retentionUntil < asOfIso;
}

export function findExpiredForRetention(documents: DocumentRecord[], asOfIso: string): DocumentRecord[] {
  return documents.filter((d) => isRetentionExpired(d, asOfIso));
}

/** Pure — every version of one logical document, most recent first,
 * given the full flat list for an entity (the repository fetches
 * everything for the entity; this function groups it). */
export function groupVersions(documents: DocumentRecord[]): Map<number, DocumentRecord[]> {
  const groups = new Map<number, DocumentRecord[]>();
  for (const doc of documents) {
    const groupKey = doc.documentGroupId ?? doc.id;
    const list = groups.get(groupKey) ?? [];
    list.push(doc);
    groups.set(groupKey, list);
  }
  for (const list of groups.values()) list.sort((a, b) => b.versionNumber - a.versionNumber);
  return groups;
}

/** Pure — only the current version of each logical document, for a
 * default "latest files only" list view. */
export function latestVersionsOnly(documents: DocumentRecord[]): DocumentRecord[] {
  return documents.filter((d) => d.isCurrent);
}
