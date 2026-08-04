"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { CompanyDetailsTab } from "./company-details-tab";
import { FinancialYearsTab } from "./financial-years-tab";
import { OrgMasterDataTab } from "./org-master-data-tab";
import { CurrenciesTab } from "./currencies-tab";
import { TaxConfigurationTab } from "./tax-configuration-tab";
import { RolesPermissionsTab } from "./roles-permissions-tab";
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
import type { PermissionRoleWithGrants, UserRoleAssignment } from "@/server/permissions/types";

const TABS = ["Company Details", "Financial Years", "Branches", "Departments", "Cost Centres", "Projects", "Currencies", "Tax Configuration", "Roles & Permissions"] as const;
type Tab = (typeof TABS)[number];

export function SettingsTabs({
  companyId,
  company,
  financialYears,
  suggestedFinancialYear,
  branches,
  departments,
  costCentres,
  projects,
  currencies,
  companyCurrencies,
  vatTreatments,
  roles,
  roleAssignments,
  previewMode,
}: {
  companyId: string;
  company: Company;
  financialYears: FinancialYear[];
  suggestedFinancialYear: { yearLabel: string; startDate: string; endDate: string };
  branches: Branch[];
  departments: Department[];
  costCentres: CostCentre[];
  projects: Project[];
  currencies: Currency[];
  companyCurrencies: CompanyCurrency[];
  vatTreatments: VatTreatment[];
  roles: PermissionRoleWithGrants[];
  roleAssignments: UserRoleAssignment[];
  previewMode: boolean;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("Company Details");

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Company Details" && <CompanyDetailsTab company={company} previewMode={previewMode} />}
        {activeTab === "Financial Years" && (
          <FinancialYearsTab companyId={companyId} financialYears={financialYears} suggested={suggestedFinancialYear} previewMode={previewMode} />
        )}
        {activeTab === "Branches" && (
          <OrgMasterDataTab
            apiPath={`/api/companies/${companyId}/branches`}
            resourceLabel="Branch"
            resourceLabelPlural="Branches"
            items={branches}
            hasAddress
            previewMode={previewMode}
          />
        )}
        {activeTab === "Departments" && (
          <OrgMasterDataTab
            apiPath={`/api/companies/${companyId}/departments`}
            resourceLabel="Department"
            resourceLabelPlural="Departments"
            items={departments}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Cost Centres" && (
          <OrgMasterDataTab
            apiPath={`/api/companies/${companyId}/cost-centres`}
            resourceLabel="Cost Centre"
            resourceLabelPlural="Cost Centres"
            items={costCentres}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Projects" && (
          <OrgMasterDataTab
            apiPath={`/api/companies/${companyId}/projects`}
            resourceLabel="Project"
            resourceLabelPlural="Projects"
            items={projects}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Currencies" && (
          <CurrenciesTab
            companyId={companyId}
            currencies={currencies}
            companyCurrencies={companyCurrencies}
            baseCurrencyCode={company.baseCurrencyCode}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Tax Configuration" && (
          <TaxConfigurationTab companyId={companyId} vatTreatments={vatTreatments} previewMode={previewMode} />
        )}
        {activeTab === "Roles & Permissions" && (
          <RolesPermissionsTab companyId={companyId} roles={roles} assignments={roleAssignments} previewMode={previewMode} />
        )}
      </CardContent>
    </Card>
  );
}
