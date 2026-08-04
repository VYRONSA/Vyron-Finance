import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Account — VYRON FINANCE",
};

export default async function AccountPage() {
  const previewMode = !isSupabaseConfigured();
  const userEmail = previewMode ? "preview@vyron.finance" : ((await (await createClient()).auth.getClaims()).data?.claims as { email?: string } | undefined)?.email;

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            {previewMode
              ? "Available once a production Supabase project is connected."
              : `Signed in as ${userEmail}. You'll be asked for your current password first.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {previewMode ? (
            <p className="text-sm text-vf-ink-faint">No Supabase project is configured yet — see ARCHITECTURE.md.</p>
          ) : (
            <SetPasswordForm mode="change" userEmail={userEmail} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
