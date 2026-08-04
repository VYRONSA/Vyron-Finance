/**
 * Row <-> domain type mappers for Customer Management (see
 * supabase/migrations/0008_customer_management.sql).
 */

import type { AddressType, Customer, CustomerAddress, CustomerContact, CustomerType, RiskRating } from "./types";

export type CustomerRow = {
  id: number;
  company_id: string;
  customer_code: string;
  name: string;
  customer_type: string;
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
  risk_rating: string;
  notes: string;
  created_at: string;
};

export function customerFromRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    companyId: row.company_id,
    customerCode: row.customer_code,
    name: row.name,
    customerType: row.customer_type as CustomerType,
    customerGroup: row.customer_group,
    industry: row.industry,
    vatNumber: row.vat_number,
    registrationNumber: row.registration_number,
    creditLimit: Number(row.credit_limit),
    paymentTermsDays: row.payment_terms_days,
    currencyCode: row.currency_code,
    priceList: row.price_list,
    salesRep: row.sales_rep,
    isActive: row.is_active,
    riskRating: row.risk_rating as RiskRating,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type CustomerContactRow = {
  id: number;
  customer_id: number;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  position: string;
  is_primary: boolean;
  created_at: string;
};

export function customerContactFromRow(row: CustomerContactRow): CustomerContact {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    position: row.position,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export type CustomerAddressRow = {
  id: number;
  customer_id: number;
  address_type: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: string;
};

export function customerAddressFromRow(row: CustomerAddressRow): CustomerAddress {
  return {
    id: row.id,
    customerId: row.customer_id,
    addressType: row.address_type as AddressType,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}
