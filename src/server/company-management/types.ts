/**
 * Domain types for the Company Management module — Company Setup,
 * Financial Years, Branches, Departments, Cost Centres, Currencies, Tax
 * Configuration. See supabase/migrations/0006_company_management.sql.
 * Financial Year and VAT treatment defaults are ported from the
 * reference's `accounting/period_manager.py` / `accounting_engine/
 * vat_codes.py`; Branch/Department/Cost Centre/multi-currency have no
 * reference-app equivalent — genuinely new master data for this port.
 */

export type CompanyStatus = "active" | "needs-attention" | "onboarding";

export type Company = {
  id: string;
  organisationId: string;
  name: string;
  industry: string;
  status: CompanyStatus;
  registrationNumber: string;
  address: string;
  financialYearStartMonth: number;
  baseCurrencyCode: string;
  createdAt: string;
};

export type Currency = {
  code: string;
  name: string;
  symbol: string;
};

export type CompanyCurrency = {
  id: number;
  companyId: string;
  currencyCode: string;
  isActive: boolean;
};

export type FinancialYearStatus = "Open" | "Closed";

export type FinancialYear = {
  id: number;
  companyId: string;
  yearLabel: string;
  startDate: string;
  endDate: string;
  status: FinancialYearStatus;
  isCurrent: boolean;
  createdAt: string;
  // Financial Period locking (Module 10, General Ledger) — genuinely new,
  // neither reference backend ever had period locking. lockDate is a soft
  // pre-close lock: postings on or before it are blocked even while the
  // year is still "Open". See services/financial-period-service.ts.
  lockDate: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
};

export type Branch = {
  id: number;
  companyId: string;
  name: string;
  code: string;
  address: string;
  isActive: boolean;
  createdAt: string;
};

export type Department = {
  id: number;
  companyId: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
};

export type CostCentre = {
  id: number;
  companyId: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
};

/** Financial Reporting & Executive Intelligence Platform (Module 9) — the
 * 4th Management Reporting dimension, mirroring Branch/Department/Cost
 * Centre exactly ("One Business Object"). */
export type Project = {
  id: number;
  companyId: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
};

/** VAT Intelligence & Tax Compliance Platform (Module 8) — real type
 * taxonomy, not string-matching on `name`/`code`. Zero-rated/Exempt/
 * Outside Scope/Import/Export/Reverse Charge are now structural, not
 * convention. */
export type VatType = "Standard" | "ZeroRated" | "Exempt" | "OutsideScope" | "Import" | "Export" | "ReverseCharge";

export const VAT_TYPES: VatType[] = ["Standard", "ZeroRated", "Exempt", "OutsideScope", "Import", "Export", "ReverseCharge"];

export type VatTreatment = {
  id: number;
  companyId: string;
  code: string;
  name: string;
  rate: number;
  vatType: VatType;
  isActive: boolean;
  createdAt: string;
};
