/**
 * Row <-> domain type mappers for Supplier Management's new sub-entities
 * (see supabase/migrations/0009_supplier_management.sql).
 */

import type { SupplierAddress, SupplierAddressType, SupplierContact } from "./types";

export type SupplierContactRow = {
  id: number;
  supplier_id: number;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  position: string;
  is_primary: boolean;
  created_at: string;
};

export function supplierContactFromRow(row: SupplierContactRow): SupplierContact {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    position: row.position,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export type SupplierAddressRow = {
  id: number;
  supplier_id: number;
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

export function supplierAddressFromRow(row: SupplierAddressRow): SupplierAddress {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    addressType: row.address_type as SupplierAddressType,
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
