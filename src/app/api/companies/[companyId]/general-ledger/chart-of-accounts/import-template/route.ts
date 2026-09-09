import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS } from "@/server/services/chart-of-accounts-service";

/** Phase 32 — "every import function must provide a downloadable
 * template." A server route (not a client-side Blob download, unlike
 * Suppliers/Customers) because the header source,
 * `CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS`, lives inside
 * `chart-of-accounts-service.ts` alongside Supabase-touching functions —
 * importing it into a "use client" component would pull that whole
 * module into the browser bundle. Mirrors the existing `.../export`
 * route's own `Content-Disposition: attachment` pattern exactly, just
 * with a fixed header row and no data rows (headers only — never a
 * fabricated example row that could be mistaken for real data). */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  await params; // company-scoped route for consistency; the template itself has no company-specific content

  return new NextResponse(CHART_OF_ACCOUNTS_IMPORT_TEMPLATE_HEADERS.join(",") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="VYRON_Chart_of_Accounts_Import_Template.csv"`,
    },
  });
}
