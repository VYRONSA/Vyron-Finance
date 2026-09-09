"use client";

import { useUrlParam } from "@/hooks/use-url-param";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { CompanyDetailsTab } from "./company-details-tab";
import { CompanyBrandingTab } from "./company-branding-tab";
import { CompanyBankStatementEmailTab } from "./company-bank-statement-email-tab";
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
import type { CompanyBrandingAssets } from "@/server/company-branding/types";
import type { PermissionRoleWithGrants, UserRoleAssignment } from "@/server/permissions/types";

const TABS = ["Company Details", "Branding", "Bank Statement Email", "Financial Years", "Branches", "Departments", "Cost Centres", "Projects", "Currencies", "Tax Configuration", "Roles & Permissions"] as const;
type Tab = (typeof TABS)[number];

function slugFromTab(tab: Tab): string {
  return tab.toLowerCase().replace(/\s+&\s+|\s+/g, "-");
}

function tabFromSlug(slug: string): Tab {
  const found = TABS.find((t) => slugFromTab(t) === slug);
  return found ?? "Company Details";
}

export function SettingsTabs({
  companyId,
  company,
  branding,
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
  branding: CompanyBrandingAssets;
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
  // Finding #196 (RC-5) — the active tab survives a refresh and
  // participates in Back/Forward instead of resetting on every navigation.
  const [tabSlug, setTabSlug] = useUrlParam("tab", slugFromTab("Company Details"));
  const activeTab = tabFromSlug(tabSlug);
  const setActiveTab = (tab: Tab) => setTabSlug(slugFromTab(tab));

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
        {activeTab === "Company Details" && <CompanyDetailsTab company={company} currencies={currencies} previewMode={previewMode} />}
        {activeTab === "Branding" && <CompanyBrandingTab companyId={companyId} branding={branding} previewMode={previewMode} />}
        {activeTab === "Bank Statement Email" && <CompanyBankStatementEmailTab companyId={companyId} />}
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
