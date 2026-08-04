import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { WorkspaceShell } from "@/components/platform/workspace-shell";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <WorkspaceShell previewMode>{children}</WorkspaceShell>;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login?next=/platform");
  }

  return <WorkspaceShell userEmail={data.claims.email as string | undefined}>{children}</WorkspaceShell>;
}
