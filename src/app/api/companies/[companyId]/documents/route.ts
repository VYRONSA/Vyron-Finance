import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listDocumentsForEntity, uploadDocument, ValidationError, NotFoundError, UsageLimitExceededError } from "@/server/services/document-service";
import { DOCUMENT_ENTITY_TYPES, DOCUMENT_PERMISSION_MODULE, type DocumentEntityType } from "@/server/documents/types";

function parseEntityType(value: string | null): DocumentEntityType | null {
  return value && (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value) ? (value as DocumentEntityType) : null;
}

/** Every document attached to one entity — the SAME `documents` table
 * every module reads from, gated by that entity type's own module
 * permission (`Sales:View` for a Customer document, `Assets:View` for
 * an Asset document, ...), never a document-specific permission scheme. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const entityType = parseEntityType(url.searchParams.get("entityType"));
  const entityId = Number(url.searchParams.get("entityId"));
  if (!entityType || !Number.isFinite(entityId)) {
    return NextResponse.json({ error: "entityType and entityId query params are required." }, { status: 400 });
  }

  const check = await requirePermission(companyId, `${DOCUMENT_PERMISSION_MODULE[entityType]}:View`);
  if (!check.ok) return check.response;

  const documents = await listDocumentsForEntity(companyId, entityType, entityId);
  return NextResponse.json({ documents });
}

/** Real file upload — `multipart/form-data`, the file's real bytes land
 * in the ONE shared Storage bucket before the metadata row commits.
 * `replacesDocumentId` (optional) makes this a new VERSION of an
 * existing document instead of a brand-new one. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const formData = await request.formData();
  const entityType = parseEntityType(String(formData.get("entityType") ?? ""));
  const entityId = Number(formData.get("entityId"));
  const file = formData.get("file");

  if (!entityType || !Number.isFinite(entityId) || !(file instanceof Blob)) {
    return NextResponse.json({ error: "entityType, entityId, and file are required." }, { status: 400 });
  }

  const check = await requirePermission(companyId, `${DOCUMENT_PERMISSION_MODULE[entityType]}:Create`);
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const filename = String(formData.get("filename") ?? (file instanceof File ? file.name : "document"));
  const category = String(formData.get("category") ?? "General");
  const retentionUntilRaw = formData.get("retentionUntil");
  const retentionUntil = retentionUntilRaw ? String(retentionUntilRaw) : null;
  const replacesDocumentIdRaw = formData.get("replacesDocumentId");
  const replacesDocumentId = replacesDocumentIdRaw ? Number(replacesDocumentIdRaw) : null;

  try {
    const document = await uploadDocument(
      {
        companyId, entityType, entityId, category, filename,
        mimeType: file.type || "application/octet-stream", file, retentionUntil, uploadedBy: performedBy,
      },
      replacesDocumentId,
    );
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof UsageLimitExceededError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
