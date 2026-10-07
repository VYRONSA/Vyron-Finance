import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getStatement } from "@/server/repositories/supplier-statement-repository";
import { getDocument } from "@/server/repositories/document-repository";
import { serveSupplierOriginal } from "@/server/documents/supplier-original-response";

/**
 * SD-3C — the ORIGINAL supplier statement, through the SAME audited viewer
 * as invoice-capture originals (SD-3B): Purchasing:View before any lookup;
 * the statement and its document read under the caller's session; every view
 * and every `?download=1` recorded permanently BEFORE the file is returned;
 * nothing returned if it cannot be recorded. No second download mechanism.
 */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; statementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, statementId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;

  const id = Number(statementId);
  if (!Number.isInteger(id)) return Response.json({ error: "Unknown statement." }, { status: 400 });

  const statement = await getStatement(companyId, id);
  if (!statement) return Response.json({ error: "Unknown statement." }, { status: 404 });
  const document = await getDocument(companyId, statement.document_id);
  if (!document) return Response.json({ error: "The original document could not be found." }, { status: 404 });

  return serveSupplierOriginal({
    request,
    companyId,
    document: { id: document.id, filename: document.filename, storagePath: document.storagePath },
    subject: { kind: "statement", statementId: statement.id },
  });
}
