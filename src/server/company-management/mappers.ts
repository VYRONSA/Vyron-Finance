/**
 * Row <-> domain type mappers for the Company Management tables (see
 * supabase/migrations/0006_company_management.sql).
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
} from "./types";

export type CompanyRow = {
  id: string;
  organisation_id: string;
  name: string;
  industry: string;
  status: string;
  registration_number: string;
  address: string;
  financial_year_start_month: number;
  base_currency_code: string;
  created_at: string;
};

export function companyFromRow(row: CompanyRow): Company {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    industry: row.industry,
    status: (row.status as Company["status"]) ?? "onboarding",
    registrationNumber: row.registration_number,
    address: row.address,
    financialYearStartMonth: row.financial_year_start_month,
    baseCurrencyCode: row.base_currency_code,
    createdAt: row.created_at,
  };
}

export type CurrencyRow = { code: string; name: string; symbol: string };

export function currencyFromRow(row: CurrencyRow): Currency {
  return { code: row.code, name: row.name, symbol: row.symbol };
}

export type CompanyCurrencyRow = { id: number; company_id: string; currency_code: string; is_active: boolean };

export function companyCurrencyFromRow(row: CompanyCurrencyRow): CompanyCurrency {
  return { id: row.id, companyId: row.company_id, currencyCode: row.currency_code, isActive: row.is_active };
}

export type FinancialYearRow = {
  id: number;
  company_id: string;
  year_label: string;
  start_date: string;
  end_date: string;
  status: string;
  is_current: boolean;
  created_at: string;
  lock_date: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
};

export function financialYearFromRow(row: FinancialYearRow): FinancialYear {
  return {
    id: row.id,
    companyId: row.company_id,
    yearLabel: row.year_label,
    startDate: row.start_date,
    endDate: row.end_date,
    status: (row.status as FinancialYear["status"]) ?? "Open",
    isCurrent: row.is_current,
    createdAt: row.created_at,
    lockDate: row.lock_date ?? null,
    reopenedAt: row.reopened_at ?? null,
    reopenedBy: row.reopened_by ?? null,
  };
}

export type BranchRow = { id: number; company_id: string; name: string; code: string; address: string; is_active: boolean; created_at: string };

export function branchFromRow(row: BranchRow): Branch {
  return { id: row.id, companyId: row.company_id, name: row.name, code: row.code, address: row.address, isActive: row.is_active, createdAt: row.created_at };
}

export type DepartmentRow = { id: number; company_id: string; name: string; code: string; is_active: boolean; created_at: string };

export function departmentFromRow(row: DepartmentRow): Department {
  return { id: row.id, companyId: row.company_id, name: row.name, code: row.code, isActive: row.is_active, createdAt: row.created_at };
}

export type CostCentreRow = { id: number; company_id: string; name: string; code: string; is_active: boolean; created_at: string };

export function costCentreFromRow(row: CostCentreRow): CostCentre {
  return { id: row.id, companyId: row.company_id, name: row.name, code: row.code, isActive: row.is_active, createdAt: row.created_at };
}

export type ProjectRow = { id: number; company_id: string; name: string; code: string; is_active: boolean; created_at: string };

export function projectFromRow(row: ProjectRow): Project {
  return { id: row.id, companyId: row.company_id, name: row.name, code: row.code, isActive: row.is_active, createdAt: row.created_at };
}

export type VatTreatmentRow = {
  id: number;
  company_id: string;
  code: string;
  name: string;
  rate: number;
  vat_type: string;
  is_active: boolean;
  created_at: string;
};

export function vatTreatmentFromRow(row: VatTreatmentRow): VatTreatment {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    rate: Number(row.rate),
    vatType: row.vat_type as VatTreatment["vatType"],
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}
