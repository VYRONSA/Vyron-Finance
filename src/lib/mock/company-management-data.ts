/**
 * Preview Mode seed data for Company Management (Platform Workspace's
 * company list/create flow, and the per-company Settings page). Field
 * shapes match the real domain types in `server/company-management/
 * types.ts` exactly.
 */

import type {
  Branch,
  Company,
  CompanyCurrency,
  CostCentre,
  Currency,
  Department,
  FinancialYear,
  Project,
  VatTreatment,
} from "@/server/company-management/types";
import { MOCK_COMPANY } from "./financial-data";

const ORG_ID = "org_1";

export const MOCK_COMPANIES_FULL: Company[] = [
  {
    id: "co_1", organisationId: ORG_ID, name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
  },
  {
    id: MOCK_COMPANY.id, organisationId: ORG_ID, name: MOCK_COMPANY.name, industry: "Retail",
    status: "needs-attention", registrationNumber: "2018/654321/07", address: "44 Harlow Road, Johannesburg",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-01-14T09:00:00Z",
  },
  {
    id: "co_3", organisationId: ORG_ID, name: "Netherfield Logistics", industry: "Transport",
    status: "active", registrationNumber: "2020/987654/07", address: "9 Netherfield Way, Durban",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-06-01T09:00:00Z",
  },
  {
    id: "co_4", organisationId: ORG_ID, name: "Bramwell Dental Practice", industry: "Healthcare",
    status: "onboarding", registrationNumber: "", address: "",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2026-07-20T09:00:00Z",
  },
];

export const MOCK_CURRENCIES: Currency[] = [
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "BWP", name: "Botswana Pula", symbol: "P" },
];

export const MOCK_COMPANY_CURRENCIES: CompanyCurrency[] = [
  { id: 1, companyId: MOCK_COMPANY.id, currencyCode: "ZAR", isActive: true },
  { id: 2, companyId: MOCK_COMPANY.id, currencyCode: "USD", isActive: true },
];

export const MOCK_FINANCIAL_YEARS: FinancialYear[] = [
  { id: 1, companyId: MOCK_COMPANY.id, yearLabel: "FY2025", startDate: "2024-03-01", endDate: "2025-02-28", status: "Closed", isCurrent: false, createdAt: "2024-03-01T09:00:00Z", lockDate: null, reopenedAt: null, reopenedBy: null },
  { id: 2, companyId: MOCK_COMPANY.id, yearLabel: "FY2026", startDate: "2025-03-01", endDate: "2026-02-28", status: "Open", isCurrent: true, createdAt: "2025-03-01T09:00:00Z", lockDate: null, reopenedAt: null, reopenedBy: null },
];

export const MOCK_BRANCHES: Branch[] = [
  { id: 1, companyId: MOCK_COMPANY.id, name: "Head Office", code: "HO", address: "44 Harlow Road, Johannesburg", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: MOCK_COMPANY.id, name: "Cape Town Branch", code: "CT", address: "3 Long Street, Cape Town", isActive: true, createdAt: "2025-04-02T09:00:00Z" },
];

export const MOCK_DEPARTMENTS: Department[] = [
  { id: 1, companyId: MOCK_COMPANY.id, name: "Finance", code: "FIN", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: MOCK_COMPANY.id, name: "Retail Operations", code: "OPS", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
];

export const MOCK_COST_CENTRES: CostCentre[] = [
  { id: 1, companyId: MOCK_COMPANY.id, name: "Store Operations", code: "CC-100", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: MOCK_COMPANY.id, name: "Head Office Admin", code: "CC-200", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
];

// Financial Reporting & Executive Intelligence Platform (Module 9) — the
// 4th Management Reporting dimension, mirroring Cost Centres exactly.
export const MOCK_PROJECTS: Project[] = [
  { id: 1, companyId: MOCK_COMPANY.id, name: "Store Refit — Sandton", code: "PRJ-100", isActive: true, createdAt: "2025-03-01T09:00:00Z" },
  { id: 2, companyId: MOCK_COMPANY.id, name: "Website Relaunch", code: "PRJ-200", isActive: true, createdAt: "2025-04-10T09:00:00Z" },
];

// Ported 1:1 from accounting_engine/vat_codes.py's VAT_CODES/VAT_RATES.
export const MOCK_VAT_TREATMENTS: VatTreatment[] = [
  { id: 1, companyId: MOCK_COMPANY.id, code: "Standard Rated", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: MOCK_COMPANY.id, code: "Zero Rated", name: "Zero Rated", rate: 0, vatType: "ZeroRated", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 3, companyId: MOCK_COMPANY.id, code: "Exempt", name: "Exempt", rate: 0, vatType: "Exempt", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 4, companyId: MOCK_COMPANY.id, code: "No VAT", name: "No VAT", rate: 0, vatType: "OutsideScope", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 5, companyId: MOCK_COMPANY.id, code: "Fuel VAT", name: "Fuel VAT", rate: 0, vatType: "ZeroRated", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 6, companyId: MOCK_COMPANY.id, code: "Import VAT", name: "Import VAT", rate: 15, vatType: "Import", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
];
