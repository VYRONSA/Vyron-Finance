import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listCommunicationAttachments } from "@/server/services/communication-service";
import { getDocument } from "@/server/repositories/document-repository";

/** Every document attached to this communication, hydrated with its real
 * filename/category from the shared Document Platform (Phase 4) — no
 * duplicated attachment metadata, just a join at read time. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; communicationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, communicationId } = await params;
  const attachments = await listCommunicationAttachments(Number(communicationId));
  const documents = await Promise.all(attachments.map((a) => getDocument(companyId, a.documentId)));
  return NextResponse.json({ attachments: documents.filter((d) => d !== null) });
}
