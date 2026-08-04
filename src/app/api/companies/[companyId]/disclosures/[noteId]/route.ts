import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { updateDisclosureNoteUserNotes } from "@/server/services/disclosure-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; noteId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, noteId } = await params;
  const body = await request.json();
  const { userNotes } = body;
  if (typeof userNotes !== "string") return NextResponse.json({ error: "userNotes (string) is required." }, { status: 400 });

  const check = await requirePermission(companyId, "Reports:Edit");
  if (!check.ok) return check.response;

  const note = await updateDisclosureNoteUserNotes(companyId, Number(noteId), userNotes);
  return NextResponse.json({ note });
}
