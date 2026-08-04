/**
 * Repository layer for Customer Management — the only layer allowed to
 * speak Supabase for this module.
 */

import { createClient } from "@/lib/supabase/server";
import {
  customerAddressFromRow,
  customerContactFromRow,
  customerFromRow,
  type CustomerAddressRow,
  type CustomerContactRow,
  type CustomerRow,
} from "@/server/customer-management/mappers";
import type { AddressType, Customer, CustomerAddress, CustomerContact, CustomerType, RiskRating } from "@/server/customer-management/types";

// RC1 Phase 3 (Performance Hardening) — this query was unbounded
// (confirmed by the Production Readiness Report's own audit); a company
// with an enterprise-scale customer list could fetch its entire table
// into memory on every call. `LIST_CAP` is a real safety bound (backed
// by a real composite index — see 0026_performance_hardening.sql), not
// a full paginated browsing UI — that remains a disclosed follow-up.
const LIST_CAP = 10_000;

export async function listCustomers(companyId: string): Promise<Customer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", companyId)
    .order("name")
    .limit(LIST_CAP)
    .returns<CustomerRow[]>();
  if (error) throw error;
  return data.map(customerFromRow);
}

export async function getCustomer(companyId: string, customerId: number): Promise<Customer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", customerId)
    .maybeSingle<CustomerRow>();
  if (error) throw error;
  return data ? customerFromRow(data) : null;
}

export type NewCustomer = {
  customerCode: string;
  name: string;
  customerType?: CustomerType;
  customerGroup?: string;
  industry?: string;
  vatNumber?: string;
  registrationNumber?: string;
  creditLimit?: number;
  paymentTermsDays?: number;
  currencyCode?: string | null;
  priceList?: string;
  salesRep?: string;
  riskRating?: RiskRating;
  notes?: string;
};

export async function createCustomer(companyId: string, input: NewCustomer): Promise<Customer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      company_id: companyId,
      customer_code: input.customerCode,
      name: input.name,
      customer_type: input.customerType ?? "Company",
      customer_group: input.customerGroup ?? "",
      industry: input.industry ?? "",
      vat_number: input.vatNumber ?? "",
      registration_number: input.registrationNumber ?? "",
      credit_limit: input.creditLimit ?? 0,
      payment_terms_days: input.paymentTermsDays ?? 30,
      currency_code: input.currencyCode ?? null,
      price_list: input.priceList ?? "",
      sales_rep: input.salesRep ?? "",
      risk_rating: input.riskRating ?? "Low",
      notes: input.notes ?? "",
    })
    .select("*")
    .single<CustomerRow>();
  if (error) throw error;
  return customerFromRow(data);
}

// customer_code is deliberately excluded — immutable after creation, same
// convention as Chart of Accounts' account_code.
export type UpdatableCustomerFields = Partial<{
  name: string;
  customer_type: CustomerType;
  customer_group: string;
  industry: string;
  vat_number: string;
  registration_number: string;
  credit_limit: number;
  payment_terms_days: number;
  currency_code: string | null;
  price_list: string;
  sales_rep: string;
  is_active: boolean;
  risk_rating: RiskRating;
  notes: string;
}>;

export async function updateCustomer(companyId: string, customerId: number, fields: UpdatableCustomerFields): Promise<Customer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", customerId)
    .select("*")
    .single<CustomerRow>();
  if (error) throw error;
  return customerFromRow(data);
}

export async function setCustomerActive(companyId: string, customerId: number, isActive: boolean): Promise<Customer> {
  return updateCustomer(companyId, customerId, { is_active: isActive });
}

export async function listCustomerContacts(customerId: number): Promise<CustomerContact[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_contacts")
    .select("*")
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false })
    .order("name")
    .returns<CustomerContactRow[]>();
  if (error) throw error;
  return data.map(customerContactFromRow);
}

export type NewCustomerContact = { name: string; email?: string; phone?: string; mobile?: string; position?: string; isPrimary?: boolean };

export async function createCustomerContact(customerId: number, input: NewCustomerContact): Promise<CustomerContact> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_contacts")
    .insert({
      customer_id: customerId,
      name: input.name,
      email: input.email ?? "",
      phone: input.phone ?? "",
      mobile: input.mobile ?? "",
      position: input.position ?? "",
      is_primary: input.isPrimary ?? false,
    })
    .select("*")
    .single<CustomerContactRow>();
  if (error) throw error;
  return customerContactFromRow(data);
}

export async function deleteCustomerContact(contactId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("customer_contacts").delete().eq("id", contactId);
  if (error) throw error;
}

export async function listCustomerAddresses(customerId: number): Promise<CustomerAddress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_addresses")
    .select("*")
    .eq("customer_id", customerId)
    .order("address_type")
    .returns<CustomerAddressRow[]>();
  if (error) throw error;
  return data.map(customerAddressFromRow);
}

export type NewCustomerAddress = {
  addressType: AddressType;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  isDefault?: boolean;
};

export async function createCustomerAddress(customerId: number, input: NewCustomerAddress): Promise<CustomerAddress> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_addresses")
    .insert({
      customer_id: customerId,
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
    .single<CustomerAddressRow>();
  if (error) throw error;
  return customerAddressFromRow(data);
}

export async function deleteCustomerAddress(addressId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("customer_addresses").delete().eq("id", addressId);
  if (error) throw error;
}
