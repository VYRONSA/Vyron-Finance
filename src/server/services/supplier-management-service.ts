/**
 * Service layer for Supplier Management. Core CRUD/read
 * (`listSuppliers`/`getSupplier`) is reused from
 * `supplier-reconciliation-service.ts`'s own repository rather than
 * duplicated — this file adds validation on top of
 * `supplier-management-repository.ts`'s new functions (update, Contacts,
 * Addresses).
 */

import * as repo from "@/server/repositories/supplier-management-repository";
import {
  createSupplierByName,
  findSupplierByCode,
  findSupplierByName,
  listSuppliers as listSuppliersRepo,
  getSupplier as getSupplierRepo,
} from "@/server/repositories/supplier-reconciliation-repository";
import { queueCommunication } from "@/server/services/communication-service";
import { getCompany } from "@/server/services/company-service";
import { recordPermissionAuditEntry } from "@/server/repositories/permission-repository";
import { parseSupplierImportCsv } from "@/server/import-centre/customer-supplier-import-parser";
import type { Supplier, SupplierRiskRating, SupplierType } from "@/server/accounting/types";
import type { SupplierAddress, SupplierAddressType, SupplierContact } from "@/server/supplier-management/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const SUPPLIER_TYPES: SupplierType[] = ["Company", "Individual"];
const RISK_RATINGS: SupplierRiskRating[] = ["Low", "Medium", "High"];
const ADDRESS_TYPES: SupplierAddressType[] = ["Billing", "Delivery", "Postal", "Physical"];

export const listSuppliers = listSuppliersRepo;
export const getSupplier = getSupplierRepo;

export type NewSupplierRequest = {
  name: string;
  supplierCode?: string;
  supplierCategory?: string;
  supplierType?: SupplierType;
  riskRating?: SupplierRiskRating;
  paymentTermsDays?: number;
};

/** Creates via the same `createSupplierByName` the Matching Engine relies
 * on (Import Centre's own supplier-dedup path), then fills in the
 * Supplier Management fields in one follow-up update — reuses the real
 * creation path rather than a parallel insert.
 *
 * Phase 33 — `createSupplierByName` below is a bare, unconditional
 * insert with no rollback if the follow-up `updateSupplier` then throws
 * (e.g. a duplicate Supplier Code, or negative Payment Terms): that left
 * a real, permanent, code-less orphan `ae_suppliers` row behind even on
 * an import row the caller was told had "failed." Every check
 * `updateSupplier` would otherwise throw on for these two fields is
 * duplicated here, BEFORE the insert, so those specific failure paths
 * can no longer create the row they were supposed to reject. This does
 * not eliminate every theoretical failure between the two calls (a
 * genuine, unexpected DB error on the follow-up update could still leave
 * an orphan) — that residual risk already existed for every other field
 * on this same two-call path and is out of Phase 33's scope. */
export async function createSupplier(companyId: string, input: NewSupplierRequest, options: { skipCommunication?: boolean } = {}): Promise<Supplier> {
  if (!input.name?.trim()) throw new ValidationError("Supplier Name is required.");
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays < 0) throw new ValidationError("Payment Terms cannot be negative.");
  if (input.supplierCode?.trim()) {
    const duplicateCode = await findSupplierByCode(companyId, input.supplierCode);
    if (duplicateCode) throw new ValidationError(`Supplier code '${input.supplierCode.trim()}' is already used by ${duplicateCode.name}.`);
  }
  const created = await createSupplierByName(companyId, input.name.trim());
  const supplier =
    input.supplierCode === undefined &&
    input.supplierCategory === undefined &&
    input.supplierType === undefined &&
    input.riskRating === undefined &&
    input.paymentTermsDays === undefined
      ? created
      : await updateSupplier(companyId, created.id, {
          supplierCode: input.supplierCode,
          supplierCategory: input.supplierCategory,
          supplierType: input.supplierType,
          riskRating: input.riskRating,
          paymentTermsDays: input.paymentTermsDays,
        });

  // Finding #039 (RC-12) — see customer-service.ts::createCustomer's
  // identical note; bulk CSV import opts out of the per-row onboarding
  // email.
  if (options.skipCommunication) return supplier;

  try {
    const contacts = await repo.listSupplierContacts(supplier.id);
    const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
    const company = await getCompany(companyId);
    await queueCommunication(companyId, {
      module: "Purchasing",
      businessObjectType: "Supplier",
      businessObjectId: supplier.id,
      channel: "Email",
      templateCode: "SupplierOnboarding",
      recipients: [{ type: "Supplier", id: supplier.id, name: supplier.name, address: contact?.email || null }],
      variables: { supplierName: supplier.name, supplierCode: supplier.supplierCode, companyName: company?.name },
    });
  } catch {
    // Communication failures must never break the primary operation.
  }

  return supplier;
}

export type BulkImportOutcome = { created: number; duplicates: number; failed: number; errors: string[]; warnings: string[] };

/** Finding #039 (RC-12) — mirrors `customer-service.ts::bulkImportCustomers`,
 * with one deliberate addition: Phase 33.
 *
 * Phase 33 — this had NO duplicate-prevention at all: `createSupplier` ->
 * `createSupplierByName` is a bare insert, `ae_suppliers` has no unique
 * constraint on `name`, and a blank Supplier Code (the common case —
 * it's an optional column) never touches the one partial unique index
 * that does exist (`(company_id, supplier_code) where supplier_code <>
 * ''`). Re-importing the identical file therefore silently created a
 * second, fully independent supplier per row, every time, with
 * `created: N, failed: 0` both runs — exactly what happened in
 * production. Fixed by reusing `findSupplierByName` — the SAME
 * case-insensitive name/alternative-name lookup the Bills importer's
 * `getOrCreateSupplierId` (import-service.ts) already uses as this
 * codebase's established supplier-identity rule — rather than inventing
 * a new one. A name match is counted as a `duplicate` and the row is
 * skipped entirely (existing supplier record left completely untouched);
 * it is not an error. */
export async function bulkImportSuppliers(companyId: string, csvText: string): Promise<BulkImportOutcome> {
  const { rows, errors: parseErrors } = parseSupplierImportCsv(csvText);
  const errors = [...parseErrors];
  const warnings: string[] = [];
  let created = 0;
  let duplicates = 0;

  for (const row of rows) {
    try {
      const existing = await findSupplierByName(companyId, row.name);
      if (existing) {
        duplicates++;
        warnings.push(`Row ${row.rowNumber} (${row.name}): already exists as supplier "${existing.name}" (#${existing.id}) — skipped, not re-imported.`);
        continue;
      }
      await createSupplier(
        companyId,
        {
          name: row.name,
          supplierCode: row.supplierCode || undefined,
          supplierCategory: row.supplierCategory || undefined,
          paymentTermsDays: row.paymentTermsDays,
        },
        { skipCommunication: true },
      );
      created++;
    } catch (err) {
      errors.push(`Row ${row.rowNumber} (${row.name}): ${err instanceof Error ? err.message : "failed to create."}`);
    }
  }

  return { created, duplicates, failed: errors.length, errors, warnings };
}

export type EditSupplierRequest = Partial<{
  name: string;
  defaultGlAccount: string | null;
  defaultVatCode: string | null;
  supplierCode: string;
  supplierCategory: string;
  supplierType: SupplierType;
  bankName: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  vatNumber: string;
  taxNumber: string;
  riskRating: SupplierRiskRating;
  paymentTermsDays: number;
  spendingLimit: number;
}>;

/** Pilot Review Round 1, Phase 3 — banking details are the one supplier
 * field class with direct payment-fraud exposure (a changed bank account
 * number silently redirects a real payment run); gated behind
 * `Purchasing:Approve`, already held by Purchasing Manager+, not base
 * Purchasing:Edit clerks. Reuses the existing grant this codebase
 * already seeds for every senior Purchasing role — no new permission key.
 * Finding #154 — Spending Limit gets the same elevated gate
 * `creditLimit` already has on the customer side (`customer-service.ts::
 * editRequiresElevatedPermission`), since it directly controls how much
 * exposure a single supplier can accumulate. */
export function editRequiresElevatedPermission(input: EditSupplierRequest): boolean {
  return input.bankName !== undefined || input.bankAccountNumber !== undefined || input.bankBranchCode !== undefined || input.spendingLimit !== undefined;
}

export async function updateSupplier(companyId: string, supplierId: number, input: EditSupplierRequest, performedBy = "System", reason = ""): Promise<Supplier> {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Supplier Name cannot be empty.");
  if (input.supplierType !== undefined && !SUPPLIER_TYPES.includes(input.supplierType)) throw new ValidationError("Invalid Supplier Type.");
  if (input.riskRating !== undefined && !RISK_RATINGS.includes(input.riskRating)) throw new ValidationError("Invalid Risk Rating.");
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays < 0) throw new ValidationError("Payment Terms cannot be negative.");
  if (input.spendingLimit !== undefined && input.spendingLimit < 0) throw new ValidationError("Spending Limit cannot be negative.");

  // Same NotFoundError pre-check `customer-service.ts::updateCustomer`
  // already has (RC1 Phase 7.6) — a nonexistent or cross-tenant id
  // previously reached `.single()` on zero rows and threw a raw,
  // uncaught PostgREST error (500) instead of a clean 404. The write was
  // always correctly blocked at the data layer (RLS + company_id
  // filter); only the error response was wrong.
  const existing = await getSupplierRepo(companyId, supplierId);
  if (!existing) throw new NotFoundError(`No supplier with id ${supplierId}.`);

  // Finding #037 — no uniqueness constraint existed on supplier_code at
  // all; a blank code is never a collision.
  if (input.supplierCode !== undefined && input.supplierCode.trim()) {
    const duplicate = await findSupplierByCode(companyId, input.supplierCode, supplierId);
    if (duplicate) throw new ValidationError(`Supplier code '${input.supplierCode.trim()}' is already used by ${duplicate.name}.`);
  }

  const updated = await repo.updateSupplier(companyId, supplierId, {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.defaultGlAccount !== undefined && { default_gl_account: input.defaultGlAccount }),
    ...(input.defaultVatCode !== undefined && { default_vat_code: input.defaultVatCode }),
    ...(input.supplierCode !== undefined && { supplier_code: input.supplierCode }),
    ...(input.supplierCategory !== undefined && { supplier_category: input.supplierCategory }),
    ...(input.supplierType !== undefined && { supplier_type: input.supplierType }),
    ...(input.bankName !== undefined && { bank_name: input.bankName }),
    ...(input.bankAccountNumber !== undefined && { bank_account_number: input.bankAccountNumber }),
    ...(input.bankBranchCode !== undefined && { bank_branch_code: input.bankBranchCode }),
    ...(input.vatNumber !== undefined && { vat_number: input.vatNumber }),
    ...(input.taxNumber !== undefined && { tax_number: input.taxNumber }),
    ...(input.riskRating !== undefined && { risk_rating: input.riskRating }),
    ...(input.paymentTermsDays !== undefined && { payment_terms_days: input.paymentTermsDays }),
    ...(input.spendingLimit !== undefined && { spending_limit: input.spendingLimit }),
  });

  // Every editable field, not a hand-picked subset — same "complete
  // audit history" requirement as customer-service.ts::updateCustomer.
  const changedFields: [string, unknown, unknown][] = [
    ["name", existing.name, updated.name],
    ["defaultGlAccount", existing.defaultGlAccount, updated.defaultGlAccount],
    ["defaultVatCode", existing.defaultVatCode, updated.defaultVatCode],
    ["supplierCode", existing.supplierCode, updated.supplierCode],
    ["supplierCategory", existing.supplierCategory, updated.supplierCategory],
    ["supplierType", existing.supplierType, updated.supplierType],
    ["bankName", existing.bankName, updated.bankName],
    ["bankAccountNumber", existing.bankAccountNumber, updated.bankAccountNumber],
    ["bankBranchCode", existing.bankBranchCode, updated.bankBranchCode],
    ["vatNumber", existing.vatNumber, updated.vatNumber],
    ["taxNumber", existing.taxNumber, updated.taxNumber],
    ["riskRating", existing.riskRating, updated.riskRating],
    ["paymentTermsDays", existing.paymentTermsDays, updated.paymentTermsDays],
    ["spendingLimit", existing.spendingLimit, updated.spendingLimit],
  ];
  for (const [field, oldValue, newValue] of changedFields) {
    if (oldValue !== newValue) {
      await recordPermissionAuditEntry(companyId, "Supplier", String(supplierId), field, String(oldValue), String(newValue), reason || "Supplier details updated.", performedBy);
    }
  }

  return updated;
}

export const setSupplierActive = repo.setSupplierActive;

/** Phase 25K — same cross-company ownership gap already closed for
 * Customer Contacts/Addresses (`customer-service.ts`), on the identical
 * Supplier shape: every function below used to take only `supplierId`,
 * with no `companyId` check anywhere in the call chain. */
async function requireCompanySupplier(companyId: string, supplierId: number): Promise<void> {
  const supplier = await getSupplierRepo(companyId, supplierId);
  if (!supplier) throw new NotFoundError(`No supplier with id ${supplierId}.`);
}

export async function listSupplierContacts(companyId: string, supplierId: number): Promise<SupplierContact[]> {
  await requireCompanySupplier(companyId, supplierId);
  return repo.listSupplierContacts(supplierId);
}

export async function createSupplierContact(companyId: string, supplierId: number, input: repo.NewSupplierContact): Promise<SupplierContact> {
  await requireCompanySupplier(companyId, supplierId);
  if (!input.name?.trim()) throw new ValidationError("Contact Name is required.");
  return repo.createSupplierContact(supplierId, { ...input, name: input.name.trim() });
}

export async function deleteSupplierContact(companyId: string, supplierId: number, contactId: number): Promise<void> {
  await requireCompanySupplier(companyId, supplierId);
  return repo.deleteSupplierContact(contactId);
}

export async function listSupplierAddresses(companyId: string, supplierId: number): Promise<SupplierAddress[]> {
  await requireCompanySupplier(companyId, supplierId);
  return repo.listSupplierAddresses(supplierId);
}

export async function createSupplierAddress(companyId: string, supplierId: number, input: repo.NewSupplierAddress): Promise<SupplierAddress> {
  await requireCompanySupplier(companyId, supplierId);
  if (!ADDRESS_TYPES.includes(input.addressType)) throw new ValidationError("Invalid Address Type.");
  return repo.createSupplierAddress(supplierId, input);
}

export async function deleteSupplierAddress(companyId: string, supplierId: number, addressId: number): Promise<void> {
  await requireCompanySupplier(companyId, supplierId);
  return repo.deleteSupplierAddress(addressId);
}
