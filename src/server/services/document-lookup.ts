/**
 * Shared "fetch a document or 404" helper — every `[documentId]` route
 * needs the document's own `entityType` before it can even determine
 * WHICH permission to check (a document's permission module depends on
 * what it's attached to), so this lookup has to happen before
 * `requirePermission()` can run. One implementation, not three.
 */

import { NextResponse } from "next/server";
import * as repo from "@/server/repositories/document-repository";
import type { DocumentRecord } from "@/server/documents/types";

export async function getDocumentOr404(companyId: string, documentId: number): Promise<DocumentRecord | NextResponse> {
  const document = await repo.getDocument(companyId, documentId);
  if (!document) return NextResponse.json({ error: `No document with id ${documentId}.` }, { status: 404 });
  return document;
}
