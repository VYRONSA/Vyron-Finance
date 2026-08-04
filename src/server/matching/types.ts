/**
 * Domain types for the Matching Platform (Module 14). See
 * supabase/migrations/0023_matching_platform.sql and
 * 0024_matching_split_inventory_item.sql (the Inventory Item dimension).
 */

export type BankTransactionSplit = {
  id: number;
  bankTransactionId: number;
  companyId: string;
  lineOrder: number;
  amount: number;
  description: string;
  glAccount: string;
  vatCode: string;
  supplierId: number | null;
  customerId: number | null;
  projectId: number | null;
  costCentreId: number | null;
  departmentId: number | null;
  branchId: number | null;
  inventoryItemId: number | null;
  createdAt: string;
};

export type PartyType = "Customer" | "Supplier";

export type MerchantMerge = {
  id: number;
  companyId: string;
  survivingMerchantId: number;
  mergedMerchantId: number;
  mergedMerchantName: string;
  transactionsRepointed: number;
  performedBy: string;
  performedAt: string;
};

export type PartyMerge = {
  id: number;
  companyId: string;
  partyType: PartyType;
  survivingPartyId: number;
  mergedPartyId: number;
  mergedPartyName: string;
  performedBy: string;
  performedAt: string;
};

export type MatchingOverride = {
  id: number;
  companyId: string;
  itemType: string;
  itemId: number;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  performedBy: string;
  performedAt: string;
};
