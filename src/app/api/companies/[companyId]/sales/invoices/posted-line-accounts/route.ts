import { NextResponse } from "next/server";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  bulkAssignMissingPostedLineAccounts,
  listRepairScopes,
  previewPostedLineAccountRepair,
} from "@/server/services/posted-line-account-repair-service";
import { NotFoundError, ValidationError } from "@/server/services/sales-invoice-service";

/** Bulk repair of missing revenue accounts on Posted sales invoices — see
 * `posted-line-account-repair-service.ts`.
 *
 * GET (read-only, Sales:View):
 *   no query          -> the repair scopes defined for this company
 *   ?scope=<id>       -> preflight of that pinned scope
 *   ?ids=1,2,3        -> preflight of those invoices (at most 50)
 * POST (Sales:Edit AND Sales:Approve): { "invoiceIds": [1, 2, 3] } — ids
 *   only, at most 50; the account is always 1000 and cannot be chosen. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { companyId } = await params;
  const check = await requirePermission(companyId, "Sales:View");
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const ids = url.searchParams.get("ids");
  try {
    if (scope !== null) return NextResponse.json({ preview: await previewPostedLineAccountRepair(companyId, { scopeId: scope }) });
    if (ids !== null) {
      const invoiceIds = ids.split(",").filter(Boolean).map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
      return NextResponse.json({ preview: await previewPostedLineAccountRepair(companyId, { invoiceIds }) });
    }
    return NextResponse.json({ scopes: listRepairScopes(companyId) });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { companyId } = await params;
  // Changes posted documents (metadata only), so both permissions, as for the single repair.
  const editCheck = await requirePermission(companyId, "Sales:Edit");
  if (!editCheck.ok) return editCheck.response;
  const approveCheck = await requirePermission(companyId, "Sales:Approve");
  if (!approveCheck.ok) return approveCheck.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Send { "invoiceIds": [...] }.' }, { status: 400 });
  }
  const extra = Object.keys(body).filter((k) => k !== "invoiceIds");
  if (extra.length > 0) {
    // In particular no account: the server always uses 1000.
    return NextResponse.json({ error: `Only "invoiceIds" may be sent; not ${extra.map((k) => `"${k}"`).join(", ")}.` }, { status: 400 });
  }
  try {
    const run = await bulkAssignMissingPostedLineAccounts(companyId, (body as { invoiceIds?: unknown }).invoiceIds, await getPerformedByLabel());
    return NextResponse.json(run);
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
