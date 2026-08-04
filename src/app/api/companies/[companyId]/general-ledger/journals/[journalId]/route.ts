import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveJournal,
  cancelJournal,
  getJournal,
  NotFoundError,
  rejectJournal,
  reverseJournal,
  submitJournal,
  ValidationError,
} from "@/server/services/journal-workflow-service";
import { updateJournal } from "@/server/services/journal-crud-service";
import { requireApproval, requirePermission } from "@/server/services/permission-service";

export async function PUT(request: Request, { params }: { params: Promise<{ companyId: string; journalId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, journalId } = await params;
  const body = await request.json();

  const editCheck = await requirePermission(companyId, "GeneralLedger:Edit");
  if (!editCheck.ok) return editCheck.response;

  try {
    const journal = await updateJournal(companyId, Number(journalId), body);
    return NextResponse.json({ journal });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; journalId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, journalId } = await params;
  const id = Number(journalId);
  const body = await request.json();

  try {
    switch (body.action) {
      case "submit": {
        const submitCheck = await requirePermission(companyId, "GeneralLedger:Edit");
        if (!submitCheck.ok) return submitCheck.response;
        const journal = await submitJournal(companyId, id);
        return NextResponse.json({ journal });
      }
      case "approve": {
        const existing = await getJournal(companyId, id);
        if (!existing) return NextResponse.json({ error: `No journal with id ${id}.` }, { status: 404 });
        const approvalCheck = await requireApproval(companyId, "ApproveJournals", "Journal", Math.max(existing.totalDebit, existing.totalCredit));
        if (!approvalCheck.ok) return approvalCheck.response;
        const journal = await approveJournal(companyId, id);
        return NextResponse.json({ journal });
      }
      case "reject": {
        const rejectCheck = await requirePermission(companyId, "ApproveJournals");
        if (!rejectCheck.ok) return rejectCheck.response;
        const journal = await rejectJournal(companyId, id);
        return NextResponse.json({ journal });
      }
      case "cancel": {
        const cancelCheck = await requirePermission(companyId, "GeneralLedger:Edit");
        if (!cancelCheck.ok) return cancelCheck.response;
        const journal = await cancelJournal(companyId, id);
        return NextResponse.json({ journal });
      }
      case "reverse": {
        const reverseCheck = await requirePermission(companyId, "GeneralLedger:Reverse");
        if (!reverseCheck.ok) return reverseCheck.response;
        const outcome = await reverseJournal(companyId, id);
        return NextResponse.json(outcome);
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
