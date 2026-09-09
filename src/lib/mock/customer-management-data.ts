/**
 * Preview Mode seed data for Customer Management (Commercial Platform,
 * Module 1). Field shapes match the real domain types exactly.
 */

import type { Customer, CustomerAddress, CustomerContact } from "@/server/customer-management/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: 1, companyId: COMPANY_ID, customerCode: "CUST-1000", name: "Meridian Traders", customerType: "Company",
    customerGroup: "Retail", industry: "Retail", vatNumber: "4123456789", registrationNumber: "2016/112233/07",
    creditLimit: 150000, paymentTermsDays: 30, currencyCode: "ZAR", priceList: "Standard", salesRep: "T. Naidoo",
    isActive: true, riskRating: "Low", notes: "", createdAt: "2025-03-10T09:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, customerCode: "CUST-1001", name: "Bramwell Dental Practice", customerType: "Company",
    customerGroup: "Healthcare", industry: "Healthcare", vatNumber: "4198765432", registrationNumber: "2019/445566/07",
    creditLimit: 50000, paymentTermsDays: 14, currencyCode: "ZAR", priceList: "Standard", salesRep: "K. van Wyk",
    isActive: true, riskRating: "Medium", notes: "Occasionally pays late — follow up before due date.", createdAt: "2025-05-22T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, customerCode: "CUST-1002", name: "J. Fourie (Sole Proprietor)", customerType: "Individual",
    customerGroup: "Direct", industry: "Consulting", vatNumber: "", registrationNumber: "",
    creditLimit: 10000, paymentTermsDays: 7, currencyCode: "ZAR", priceList: "Standard", salesRep: "T. Naidoo",
    isActive: true, riskRating: "High", notes: "New account — no payment history yet.", createdAt: "2026-06-01T09:00:00Z",
  },
];

export const MOCK_CUSTOMER_CONTACTS: Record<number, CustomerContact[]> = {
  1: [
    { id: 1, customerId: 1, name: "Nomsa Dlamini", email: "nomsa@meridiantraders.co.za", phone: "011 555 0134", mobile: "082 555 0134", position: "Financial Manager", isPrimary: true, createdAt: "2025-03-10T09:00:00Z" },
    { id: 2, customerId: 1, name: "Peter van der Merwe", email: "peter@meridiantraders.co.za", phone: "011 555 0135", mobile: "", position: "Buyer", isPrimary: false, createdAt: "2025-03-10T09:00:00Z" },
  ],
  2: [
    { id: 3, customerId: 2, name: "Dr. Sarah Bramwell", email: "sarah@bramwelldental.co.za", phone: "021 555 0298", mobile: "083 555 0298", position: "Practice Owner", isPrimary: true, createdAt: "2025-05-22T09:00:00Z" },
  ],
  3: [
    { id: 4, customerId: 3, name: "Johan Fourie", email: "johan.fourie@gmail.com", phone: "", mobile: "084 555 0177", position: "Owner", isPrimary: true, createdAt: "2026-06-01T09:00:00Z" },
  ],
};

export const MOCK_CUSTOMER_ADDRESSES: Record<number, CustomerAddress[]> = {
  1: [
    { id: 1, customerId: 1, addressType: "Billing", line1: "12 Fenwick Street", line2: "", city: "Cape Town", region: "Western Cape", postalCode: "8001", country: "South Africa", isDefault: true, createdAt: "2025-03-10T09:00:00Z" },
    { id: 2, customerId: 1, addressType: "Delivery", line1: "Unit 4, Harbour Industrial Park", line2: "9 Dockside Road", city: "Cape Town", region: "Western Cape", postalCode: "8001", country: "South Africa", isDefault: true, createdAt: "2025-03-10T09:00:00Z" },
  ],
  2: [
    { id: 3, customerId: 2, addressType: "Billing", line1: "44 Harlow Road", line2: "", city: "Johannesburg", region: "Gauteng", postalCode: "2196", country: "South Africa", isDefault: true, createdAt: "2025-05-22T09:00:00Z" },
  ],
  3: [],
};
