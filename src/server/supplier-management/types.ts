/**
 * Domain types for Supplier Management's new sub-entities (Commercial
 * Platform, Module 2). The `Supplier` type itself lives in
 * `server/accounting/types.ts` (extended there, not duplicated here) —
 * this file is just Contacts and Addresses, which have no reference-app
 * equivalent at all.
 */

export type SupplierContact = {
  id: number;
  supplierId: number;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  position: string;
  isPrimary: boolean;
  createdAt: string;
};

export type SupplierAddressType = "Billing" | "Delivery" | "Postal" | "Physical";

export type SupplierAddress = {
  id: number;
  supplierId: number;
  addressType: SupplierAddressType;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
};
