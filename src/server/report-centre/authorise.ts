/**
 * Access to the Reporting Centre's API routes.
 *
 * Live: a signed-in session (`requireSession`) plus the RBAC catalog's
 * own global `RunReports` permission — seeded for Auditor, Accountant,
 * Financial Manager and every all-permissions role (migration 0025).
 * Row Level Security additionally scopes every row read to the user's
 * company.
 *
 * Preview Mode (no Supabase project configured): the routes serve the
 * Preview Mode mock ledger — the same sample data the pages already
 * render without a session. There is nothing to protect until a backend
 * exists; the moment credentials are set, the live branch applies.
 */

import type { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";

export async function authoriseReporting(companyId: string): Promise<NextResponse | null> {
  if (!isSupabaseConfigured()) return null;
  const session = await requireSession();
  if (!session.ok) return session.response;
  const permission = await requirePermission(companyId, "RunReports");
  return permission.ok ? null : permission.response;
}
