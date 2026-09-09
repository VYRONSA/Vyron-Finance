/**
 * Application service for Find & Recode's saved filter presets
 * (Phase 25F). Thin validation wrapper around
 * `find-and-recode-preset-repository.ts` — the same `ValidationError`
 * convention every other service in this codebase already uses. Stores
 * and reconstructs the EXACT existing `TransactionExplorerFilters` shape
 * `find-and-recode-service.ts` already consumes; no second filter
 * representation.
 */

import * as repo from "@/server/repositories/find-and-recode-preset-repository";
import type { FindAndRecodeFilterPreset } from "@/server/repositories/find-and-recode-preset-repository";
import type { AllocationMethod, AllocationStatus, SortDirection, TransactionExplorerFilters, TransactionSortColumn } from "@/server/accounting/types";

export class ValidationError extends Error {}

export type { FindAndRecodeFilterPreset };

const ALLOCATION_STATUSES: AllocationStatus[] = ["Matched", "Allocated", "Suggested", "Unallocated"];
const ALLOCATION_METHODS: AllocationMethod[] = ["Matched Bill", "Supplier Default", "Manual", "Future AI"];
const SORT_COLUMNS: TransactionSortColumn[] = ["transactionDate", "debit", "credit"];
const SORT_DIRECTIONS: SortDirection[] = ["asc", "desc"];

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function enumOrNull<T extends string>(v: unknown, allowed: T[]): T | null {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : null;
}
function statusArray(v: unknown): AllocationStatus[] | null {
  if (!Array.isArray(v)) return null;
  const valid = v.filter((s): s is AllocationStatus => typeof s === "string" && (ALLOCATION_STATUSES as string[]).includes(s));
  return valid.length > 0 ? valid : null;
}
function methodArray(v: unknown): AllocationMethod[] | null {
  if (!Array.isArray(v)) return null;
  const valid = v.filter((s): s is AllocationMethod => typeof s === "string" && (ALLOCATION_METHODS as string[]).includes(s));
  return valid.length > 0 ? valid : null;
}

/**
 * Reconstructs a well-formed `TransactionExplorerFilters` from an
 * arbitrary, possibly malformed/corrupted value — used on BOTH write
 * (server-side validation of what the client sent, per the brief's own
 * "validate the saved filter structure server-side") and read (so a
 * corrupted or hand-edited row can never crash the app; every field
 * degrades independently to its own safe "no filter" default rather
 * than failing the whole preset). Never adds a filter the input didn't
 * already express — an absent/invalid field always degrades to "not
 * filtered," never to an invented constraint.
 */
export function sanitizeTransactionExplorerFilters(raw: unknown): TransactionExplorerFilters {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    search: str(r.search),
    dateFrom: str(r.dateFrom),
    dateTo: str(r.dateTo),
    minAmount: num(r.minAmount),
    maxAmount: num(r.maxAmount),
    statuses: statusArray(r.statuses),
    bankAccountId: num(r.bankAccountId),
    importBatch: str(r.importBatch),
    duplicateOnly: bool(r.duplicateOnly, false),
    unknownSupplierOnly: bool(r.unknownSupplierOnly, false),
    sortBy: enumOrNull(r.sortBy, SORT_COLUMNS) ?? "transactionDate",
    sortDirection: enumOrNull(r.sortDirection, SORT_DIRECTIONS) ?? "desc",
    description: str(r.description),
    reference: str(r.reference),
    glAccount: str(r.glAccount),
    supplierId: num(r.supplierId),
    customerId: num(r.customerId),
    allocationMethods: methodArray(r.allocationMethods),
    hasRule: typeof r.hasRule === "boolean" ? r.hasRule : null,
    manualOverrideOnly: bool(r.manualOverrideOnly, false),
    needsReviewOnly: bool(r.needsReviewOnly, false),
  };
}

function isUniqueNameViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  return code === "23505" && message.includes("find_and_recode_filter_presets");
}

function withSanitizedFilters(preset: FindAndRecodeFilterPreset): FindAndRecodeFilterPreset {
  return { ...preset, filters: sanitizeTransactionExplorerFilters(preset.filters) };
}

export async function listPresets(companyId: string, userId: string): Promise<FindAndRecodeFilterPreset[]> {
  const presets = await repo.listFindAndRecodePresets(companyId, userId);
  return presets.map(withSanitizedFilters);
}

export async function savePreset(companyId: string, userId: string, name: string, filters: unknown): Promise<FindAndRecodeFilterPreset> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new ValidationError("A preset name is required.");
  if (trimmedName.length > 100) throw new ValidationError("Preset names must be 100 characters or fewer.");

  const sanitizedFilters = sanitizeTransactionExplorerFilters(filters);
  try {
    const created = await repo.createFindAndRecodePreset(companyId, userId, trimmedName, sanitizedFilters);
    return withSanitizedFilters(created);
  } catch (error) {
    if (isUniqueNameViolation(error)) throw new ValidationError(`A preset named "${trimmedName}" already exists.`);
    throw error;
  }
}

export async function renamePreset(companyId: string, userId: string, presetId: number, name: string): Promise<FindAndRecodeFilterPreset> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new ValidationError("A preset name is required.");
  if (trimmedName.length > 100) throw new ValidationError("Preset names must be 100 characters or fewer.");

  try {
    const updated = await repo.renameFindAndRecodePreset(companyId, userId, presetId, trimmedName);
    if (!updated) throw new ValidationError("Preset not found.");
    return withSanitizedFilters(updated);
  } catch (error) {
    if (isUniqueNameViolation(error)) throw new ValidationError(`A preset named "${trimmedName}" already exists.`);
    throw error;
  }
}

export async function deletePreset(companyId: string, userId: string, presetId: number): Promise<void> {
  await repo.deleteFindAndRecodePreset(companyId, userId, presetId);
}
