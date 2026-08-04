import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { FinancialWorkspaceShell } from "@/components/financial/workspace-shell";
import { MOCK_COMPANY } from "@/lib/mock/financial-data";
import { getCompany } from "@/server/services/company-service";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <FinancialWorkspaceShell companyId={companyId} companyName={MOCK_COMPANY.name} previewMode>
        {children}
      </FinancialWorkspaceShell>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect(`/login?next=/company/${companyId}`);
  }

  // Real lookup — RLS means this returns null both for a genuinely
  // missing company and one this user's organisation doesn't own, so a
  // 404 never leaks which case it was.
  const company = await getCompany(companyId);
  if (!company) notFound();

  return (
    <FinancialWorkspaceShell companyId={companyId} companyName={company.name} userEmail={data.claims.email as string | undefined}>
      {children}
    </FinancialWorkspaceShell>
  );
}
