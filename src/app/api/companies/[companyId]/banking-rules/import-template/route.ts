import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { BANKING_RULES_IMPORT_TEMPLATE_HEADERS } from "@/server/services/banking-rule-service";

/** Phase 32 — see the identical note on
 * `.../chart-of-accounts/import-template/route.ts`: a server route
 * because the header source lives in a Supabase-touching service module. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  await params;

  return new NextResponse(BANKING_RULES_IMPORT_TEMPLATE_HEADERS.join(",") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="VYRON_Banking_Rules_Import_Template.csv"`,
    },
  });
}
