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
  listSuppliers as listSuppliersRepo,
  getSupplier as getSupplierRepo,
} from "@/server/repositories/supplier-reconciliation-repository";
import { queueCommunication } from "@/server/services/communication-service";
import { getCompany } from "@/server/services/company-service";
import type { Supplier, SupplierRiskRating, SupplierType } from "@/server/accounting/types";
import type { SupplierAddress, SupplierAddressType, SupplierContact } from "@/server/supplier-management/types";

export class ValidationError extends Error {}

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
 * creation path rather than a parallel insert. */
export async function createSupplier(companyId: string, input: NewSupplierRequest): Promise<Supplier> {
  if (!input.name?.trim()) throw new ValidationError("Supplier Name is required.");
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
}>;

export async function updateSupplier(companyId: string, supplierId: number, input: EditSupplierRequest): Promise<Supplier> {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Supplier Name cannot be empty.");
  if (input.supplierType !== undefined && !SUPPLIER_TYPES.includes(input.supplierType)) throw new ValidationError("Invalid Supplier Type.");
  if (input.riskRating !== undefined && !RISK_RATINGS.includes(input.riskRating)) throw new ValidationError("Invalid Risk Rating.");
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays < 0) throw new ValidationError("Payment Terms cannot be negative.");

  return repo.updateSupplier(companyId, supplierId, {
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
  });
}

export const setSupplierActive = repo.setSupplierActive;

export const listSupplierContacts = repo.listSupplierContacts;

export async function createSupplierContact(supplierId: number, input: repo.NewSupplierContact): Promise<SupplierContact> {
  if (!input.name?.trim()) throw new ValidationError("Contact Name is required.");
  return repo.createSupplierContact(supplierId, { ...input, name: input.name.trim() });
}

export const deleteSupplierContact = repo.deleteSupplierContact;

export const listSupplierAddresses = repo.listSupplierAddresses;

export async function createSupplierAddress(supplierId: number, input: repo.NewSupplierAddress): Promise<SupplierAddress> {
  if (!ADDRESS_TYPES.includes(input.addressType)) throw new ValidationError("Invalid Address Type.");
  return repo.createSupplierAddress(supplierId, input);
}

export const deleteSupplierAddress = repo.deleteSupplierAddress;
