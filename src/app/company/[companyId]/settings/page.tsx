import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsTabs } from "@/components/financial/settings/settings-tabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listFinancialYears, suggestFinancialYear } from "@/server/services/financial-year-service";
import { listBranches, listCostCentres, listDepartments, listProjects } from "@/server/services/org-master-data-service";
import { listCompanyCurrencies, listCurrencies } from "@/server/services/currency-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { getRolesWithGrants, listAssignmentsForCompany } from "@/server/services/permission-service";
import {
  MOCK_BRANCHES,
  MOCK_COMPANIES_FULL,
  MOCK_COMPANY_CURRENCIES,
  MOCK_COST_CENTRES,
  MOCK_CURRENCIES,
  MOCK_DEPARTMENTS,
  MOCK_FINANCIAL_YEARS,
  MOCK_PROJECTS,
  MOCK_VAT_TREATMENTS,
} from "@/lib/mock/company-management-data";
import { MOCK_PERMISSION_ROLES, MOCK_ROLE_ASSIGNMENTS } from "@/lib/mock/permissions-data";

export const metadata: Metadata = {
  title: "Settings — VYRON FINANCE",
};

export default async function CompanySettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  const [financialYears, branches, departments, costCentres, projects, currencies, companyCurrencies, vatTreatments, roles, roleAssignments] = previewMode
    ? [MOCK_FINANCIAL_YEARS, MOCK_BRANCHES, MOCK_DEPARTMENTS, MOCK_COST_CENTRES, MOCK_PROJECTS, MOCK_CURRENCIES, MOCK_COMPANY_CURRENCIES, MOCK_VAT_TREATMENTS, MOCK_PERMISSION_ROLES, MOCK_ROLE_ASSIGNMENTS]
    : await Promise.all([
        listFinancialYears(companyId),
        listBranches(companyId),
        listDepartments(companyId),
        listCostCentres(companyId),
        listProjects(companyId),
        listCurrencies(),
        listCompanyCurrencies(companyId),
        listVatTreatments(companyId),
        getRolesWithGrants(companyId),
        listAssignmentsForCompany(companyId),
      ]);

  const today = new Date().toISOString().slice(0, 10);
  const suggestedFinancialYear = suggestFinancialYear(today, company.financialYearStartMonth);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Financial Workspace
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Settings</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Company details, Financial Years, Branches, Departments, Cost Centres, Currencies, and Tax
              Configuration for {company.name}.
            </p>
          </div>
        </CardContent>
      </Card>

      <SettingsTabs
        companyId={companyId}
        company={company}
        financialYears={financialYears}
        suggestedFinancialYear={suggestedFinancialYear}
        branches={branches}
        departments={departments}
        costCentres={costCentres}
        projects={projects}
        currencies={currencies}
        companyCurrencies={companyCurrencies}
        vatTreatments={vatTreatments}
        roles={roles}
        roleAssignments={roleAssignments}
        previewMode={previewMode}
      />
    </div>
  );
}
