import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { BrandMark } from "@/components/ui/brand-mark";
import { BootstrapAdminForm } from "@/components/auth/bootstrap-admin-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { hasPlatformSuperAdministrator } from "@/server/services/bootstrap-service";

export const metadata: Metadata = {
  title: "First-Run Setup — VYRON FINANCE",
};

/** The one place a brand-new installation gets its first real
 * administrator without touching the database by hand — see
 * `bootstrap-service.ts`. Locks itself the moment a Platform Super
 * Administrator exists, checked fresh on every load (never cached),
 * and the API route re-checks the same thing independently — this page
 * gating alone is not the security boundary. */
export default async function SetupPage() {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return (
      <Shell>
        <h1 className="text-2xl font-medium text-vf-ink">Not configured yet</h1>
        <p className="mt-1.5 text-sm text-vf-ink-soft">
          First-run setup needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
          SUPABASE_SERVICE_ROLE_KEY in .env.local — see .env.local.example.
        </p>
      </Shell>
    );
  }

  const alreadyBootstrapped = await hasPlatformSuperAdministrator();
  if (alreadyBootstrapped) {
    return (
      <Shell>
        <h1 className="text-2xl font-medium text-vf-ink">Already set up</h1>
        <p className="mt-1.5 text-sm text-vf-ink-soft">A Platform Super Administrator already exists for this installation.</p>
        <Link href="/login" className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-vf-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-vf-red-700">
          Go to login
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-medium text-vf-ink">Welcome to VYRON FINANCE</h1>
      <p className="mt-1.5 text-sm text-vf-ink-soft">
        This installation has no administrator yet. Create the first Platform Super Administrator to get started —
        every company and platform setting will be manageable from this account.
      </p>
      <div className="mt-8">
        <BootstrapAdminForm />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-vf-canvas px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardContent className="p-8 sm:p-10">
          <Link href="/" className="mb-8 flex items-center gap-2.5 font-display text-lg text-vf-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-vf-charcoal">
              <BrandMark className="h-4 w-4" />
            </span>
            VYRON FINANCE
          </Link>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
