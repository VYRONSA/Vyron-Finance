/**
 * Read-only lookups for the bulk Posted-invoice line-account repair
 * (`posted-line-account-repair-service.ts`). Nothing here writes.
 */
import { createClient } from "@/lib/supabase/server";

/** How many journals the company has — the preflight shows it against the
 * scope's pinned baseline, and the repair must leave it unchanged. */
export async function countCompanyJournals(companyId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("ae_journals").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return count ?? 0;
}
