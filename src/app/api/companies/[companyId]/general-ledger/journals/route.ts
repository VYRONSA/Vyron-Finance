import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listJournals } from "@/server/services/journal-workflow-service";
import { createManualJournal, ValidationError } from "@/server/services/journal-crud-service";
import type { JournalStatus } from "@/server/accounting/types";
import { requirePermission } from "@/server/services/permission-service";

const VALID_STATUSES: JournalStatus[] = ["Draft", "Submitted", "Approved", "Rejected", "Posted", "Cancelled"];

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam && !VALID_STATUSES.includes(statusParam as JournalStatus)) {
    return NextResponse.json({ error: `Invalid status '${statusParam}'.` }, { status: 400 });
  }

  const journals = await listJournals(companyId, (statusParam as JournalStatus) || undefined);
  return NextResponse.json({ journals });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  try {
    const journal = await createManualJournal(companyId, body);
    return NextResponse.json({ journal }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
