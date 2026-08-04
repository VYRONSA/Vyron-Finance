import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BankAccountForm } from "@/components/financial/bank-account-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export const metadata: Metadata = {
  title: "Create Bank Account — VYRON FINANCE",
};

export default async function NewBankAccountPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Create Bank Account</CardTitle>
          <CardDescription>Set up a new bank account before importing statements against it.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <BankAccountForm companyId={companyId} mode="create" previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}
