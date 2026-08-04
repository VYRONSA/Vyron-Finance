/**
 * Repository layer for Supplier Management's additions on top of the
 * real, already-live `ae_suppliers` table — core CRUD
 * (`listSuppliers`/`getSupplier`/`createSupplierByName`) stays in
 * `supplier-reconciliation-repository.ts`, reused here rather than
 * duplicated. This file is: updating the new columns, Contacts,
 * Addresses, and the real bills-by-supplier query that powers Age
 * Analysis/Outstanding Bills/Purchase History.
 */

import { createClient } from "@/lib/supabase/server";
import { billFromRow, supplierFromRow, type ImportedBillRow, type SupplierRow } from "@/server/accounting/mappers";
import type { ImportedBill, Supplier, SupplierRiskRating, SupplierType } from "@/server/accounting/types";
import {
  supplierAddressFromRow,
  supplierContactFromRow,
  type SupplierAddressRow,
  type SupplierContactRow,
} from "@/server/supplier-management/mappers";
import type { SupplierAddress, SupplierAddressType, SupplierContact } from "@/server/supplier-management/types";

export type UpdatableSupplierFields = Partial<{
  name: string;
  alternative_names: string[];
  default_gl_account: string | null;
  default_vat_code: string | null;
  status: "Active" | "Inactive";
  supplier_code: string;
  supplier_category: string;
  supplier_type: SupplierType;
  bank_name: string;
  bank_account_number: string;
  bank_branch_code: string;
  vat_number: string;
  tax_number: string;
  risk_rating: SupplierRiskRating;
  payment_terms_days: number;
}>;

export async function updateSupplier(companyId: string, supplierId: number, fields: UpdatableSupplierFields): Promise<Supplier> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_suppliers")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", supplierId)
    .select("*")
    .single<SupplierRow>();
  if (error) throw error;
  return supplierFromRow(data);
}

export const setSupplierActive = (companyId: string, supplierId: number, isActive: boolean) =>
  updateSupplier(companyId, supplierId, { status: isActive ? "Active" : "Inactive" });

export async function listSupplierContacts(supplierId: number): Promise<SupplierContact[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_contacts")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("is_primary", { ascending: false })
    .order("name")
    .returns<SupplierContactRow[]>();
  if (error) throw error;
  return data.map(supplierContactFromRow);
}

export type NewSupplierContact = { name: string; email?: string; phone?: string; mobile?: string; position?: string; isPrimary?: boolean };

export async function createSupplierContact(supplierId: number, input: NewSupplierContact): Promise<SupplierContact> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_contacts")
    .insert({
      supplier_id: supplierId,
      name: input.name,
      email: input.email ?? "",
      phone: input.phone ?? "",
      mobile: input.mobile ?? "",
      position: input.position ?? "",
      is_primary: input.isPrimary ?? false,
    })
    .select("*")
    .single<SupplierContactRow>();
  if (error) throw error;
  return supplierContactFromRow(data);
}

export async function deleteSupplierContact(contactId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_contacts").delete().eq("id", contactId);
  if (error) throw error;
}

export async function listSupplierAddresses(supplierId: number): Promise<SupplierAddress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_addresses")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("address_type")
    .returns<SupplierAddressRow[]>();
  if (error) throw error;
  return data.map(supplierAddressFromRow);
}

export type NewSupplierAddress = {
  addressType: SupplierAddressType;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  isDefault?: boolean;
};

export async function createSupplierAddress(supplierId: number, input: NewSupplierAddress): Promise<SupplierAddress> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_addresses")
    .insert({
      supplier_id: supplierId,
      address_type: input.addressType,
      line1: input.line1 ?? "",
      line2: input.line2 ?? "",
      city: input.city ?? "",
      region: input.region ?? "",
      postal_code: input.postalCode ?? "",
      country: input.country ?? "",
      is_default: input.isDefault ?? false,
    })
    .select("*")
    .single<SupplierAddressRow>();
  if (error) throw error;
  return supplierAddressFromRow(data);
}

export async function deleteSupplierAddress(addressId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_addresses").delete().eq("id", addressId);
  if (error) throw error;
}

/** Real purchase history / outstanding bills — `ae_imported_bills` already
 * exists and is already populated by Import Centre, so unlike Customer
 * Management's financial info this is a real query, not an honest stub. */
export async function listBillsBySupplier(companyId: string, supplierId: number): Promise<ImportedBill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select("*")
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .order("invoice_date", { ascending: false })
    .limit(10_000)
    .returns<ImportedBillRow[]>();
  if (error) throw error;
  return data.map(billFromRow);
}
