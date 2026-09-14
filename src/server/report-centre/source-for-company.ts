/**
 * The data source every Reporting Centre route and page reads through:
 * Preview Mode's mock data until a Supabase project is configured, the
 * live repositories (RLS-scoped to the signed-in user) once it is — the
 * same switch every other VYRON page makes.
 */

import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createPreviewSource } from "./preview-source";
import { createProductionSource } from "./production-source";
import type { ReportDataSource } from "./source";

export function reportSourceForCompany(companyId: string): ReportDataSource {
  return isSupabaseConfigured() ? createProductionSource(companyId) : createPreviewSource(companyId);
}
