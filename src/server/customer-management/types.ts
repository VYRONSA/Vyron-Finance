/**
 * Domain types for Customer Management (Commercial Platform, Module 1).
 * See supabase/migrations/0008_customer_management.sql.
 *
 * Customer Financial Information and Customer Intelligence are
 * deliberately not modeled here — they're derived from the Sales module
 * (Module 3) instead. See `services/customer-financial-service.ts`.
 */

export type CustomerType = "Company" | "Individual";
export type RiskRating = "Low" | "Medium" | "High";

export type Customer = {
  id: number;
  companyId: string;
  customerCode: string;
  name: string;
  customerType: CustomerType;
  customerGroup: string;
  industry: string;
  vatNumber: string;
  registrationNumber: string;
  creditLimit: number;
  paymentTermsDays: number;
  currencyCode: string | null;
  priceList: string;
  salesRep: string;
  isActive: boolean;
  riskRating: RiskRating;
  notes: string;
  createdAt: string;
};

export type CustomerContact = {
  id: number;
  customerId: number;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  position: string;
  isPrimary: boolean;
  createdAt: string;
};

export type AddressType = "Billing" | "Delivery" | "Postal" | "Physical";

export type CustomerAddress = {
  id: number;
  customerId: number;
  addressType: AddressType;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
};
