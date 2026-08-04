import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateCompanyForm } from "@/components/platform/create-company-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export const metadata: Metadata = {
  title: "Create Company — VYRON FINANCE",
};

export default function NewCompanyPage() {
  const previewMode = !isSupabaseConfigured();

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Create Company</CardTitle>
          <CardDescription>
            Sets up a new company with its own Financial Year, GL, VAT treatments, and workspace. If this
            is your first company, a new organisation is created for you automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CreateCompanyForm previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}
