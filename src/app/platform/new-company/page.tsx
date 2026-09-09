import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { CreateCompanyForm } from "@/components/platform/create-company-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listCurrencies } from "@/server/services/currency-service";
import { MOCK_CURRENCIES } from "@/lib/mock/company-management-data";

export const metadata: Metadata = {
  title: "Create Company — VYRON FINANCE",
};

export default async function NewCompanyPage() {
  const previewMode = !isSupabaseConfigured();
  const currencies = previewMode ? MOCK_CURRENCIES : await listCurrencies();

  return (
    <div className="mx-auto w-full max-w-3xl py-4">
      {/* This is a large, static container the user actively works inside
          for several minutes, not a glanceable dashboard tile — `Card`'s
          shared hover-lift (Phase 3) is cancelled here so filling in a
          field doesn't make the whole wizard wobble under the cursor. */}
      <Card className="overflow-hidden hover:translate-y-0 hover:shadow-vf-paper-lg">
        <CardContent className="p-6 sm:p-10">
          <CreateCompanyForm currencies={currencies} previewMode={previewMode} />
        </CardContent>
      </Card>
    </div>
  );
}
