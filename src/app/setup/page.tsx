import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { BrandMark } from "@/components/ui/brand-mark";
import { BootstrapAdminForm } from "@/components/auth/bootstrap-admin-form";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isPlatformBootstrapEnabled } from "@/server/setup/bootstrap-guard";

/** Rendered on every request — never prerendered or served from a cache,
 * so whether it exists always reflects the live configuration. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "First-Run Setup — VYRON FINANCE",
  robots: { index: false, follow: false, nocache: true },
};

/** First-run setup for a brand-new installation. P0 security remediation:
 * 404 unless `PLATFORM_BOOTSTRAP_ENABLED` is exactly "true" (production
 * leaves it unset). The page never reveals whether a platform
 * administrator exists — the secret-gated API route is the only boundary
 * and the only thing that reports bootstrap state. */
export default function SetupPage() {
  if (!isPlatformBootstrapEnabled()) notFound();

  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return (
      <Shell>
        <h1 className="text-2xl font-medium text-vf-ink">Not configured yet</h1>
        <p className="mt-1.5 text-sm text-vf-ink-soft">
          First-run setup needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-medium text-vf-ink">First-run setup</h1>
      <p className="mt-1.5 text-sm text-vf-ink-soft">
        Invite the first Platform Super Administrator. You need the setup secret configured for this installation, and the address
        must be the configured owner address. An invitation is emailed there; the administrator sets their own password from the
        link, and setup is complete once it has been accepted.
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
            <BrandMark className="h-8 w-8" />
            VYRON FINANCE
          </Link>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
