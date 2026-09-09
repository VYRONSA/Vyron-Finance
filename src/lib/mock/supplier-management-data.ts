/**
 * Preview Mode seed data for Supplier Management's new sub-entities
 * (Contacts, Addresses). The suppliers themselves reuse
 * `MOCK_SUPPLIERS`/`MOCK_BILLS` from `supplier-reconciliation-data.ts`
 * rather than a duplicate list — same three suppliers, same ids.
 */

import type { SupplierAddress, SupplierContact } from "@/server/supplier-management/types";

export const MOCK_SUPPLIER_CONTACTS: Record<number, SupplierContact[]> = {
  1: [
    { id: 1, supplierId: 1, name: "Grace Mokoena", email: "grace@fenwickoffice.co.za", phone: "021 555 0110", mobile: "082 555 0110", position: "Accounts Manager", isPrimary: true, createdAt: "2025-02-01T09:00:00Z" },
  ],
  2: [
    { id: 2, supplierId: 2, name: "Sipho Zulu", email: "sipho@netherfieldfreight.co.za", phone: "031 555 0221", mobile: "083 555 0221", position: "Credit Controller", isPrimary: true, createdAt: "2025-02-10T09:00:00Z" },
  ],
  3: [],
};

export const MOCK_SUPPLIER_ADDRESSES: Record<number, SupplierAddress[]> = {
  1: [
    { id: 1, supplierId: 1, addressType: "Billing", line1: "18 Industria Road", line2: "", city: "Cape Town", region: "Western Cape", postalCode: "7405", country: "South Africa", isDefault: true, createdAt: "2025-02-01T09:00:00Z" },
  ],
  2: [
    { id: 2, supplierId: 2, addressType: "Billing", line1: "5 Harbour Freight Park", line2: "", city: "Durban", region: "KwaZulu-Natal", postalCode: "4001", country: "South Africa", isDefault: true, createdAt: "2025-02-10T09:00:00Z" },
  ],
  3: [],
};
