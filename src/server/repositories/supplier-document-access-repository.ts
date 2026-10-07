/**
 * SD-3B — the permanent record of who viewed or downloaded a supplier
 * document's ORIGINAL, and the one server-side way to read that original.
 *
 * Since 0113 a supplier original (the file behind an invoice capture; a
 * supplier statement from SD-3C) cannot be read by a signed-in client
 * directly from Storage. The only way to its bytes for a person is the
 * audited viewer (`serveSupplierOriginal`), which:
 *   1. has already checked Purchasing:View and found the capture/statement
 *      and its document under the caller's own session (RLS);
 *   2. writes the audit row through `fn_record_supplier_document_access`,
 *      under the caller's session — the database takes the actor from that
 *      session (there is no actor parameter) and re-checks the permission,
 *      the company and that the document is that capture's original;
 *   3. only then returns the bytes read here.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

const BUCKET = "documents";

/** What an original belongs to. Statements are recorded from SD-3C (0114);
 * until then the database refuses them, so nothing is served. */
export type SupplierOriginalSubject = { kind: "capture"; captureId: number } | { kind: "statement"; statementId: number };

export type OriginalAccessAction = "view" | "download";

/** Records one view or download. Throws when the database refuses or the
 * write fails — the caller must then NOT serve the file. */
export async function recordSupplierDocumentAccess(input: {
  companyId: string;
  documentId: number;
  subject: SupplierOriginalSubject;
  action: OriginalAccessAction;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_record_supplier_document_access", {
    p_company_id: input.companyId,
    p_document_id: input.documentId,
    p_capture_id: input.subject.kind === "capture" ? input.subject.captureId : null,
    p_statement_id: input.subject.kind === "statement" ? input.subject.statementId : null,
    p_action: input.action,
  });
  if (error) throw error;
  if (typeof data !== "number" || !Number.isInteger(data) || data <= 0) {
    throw new Error("The access record was not written.");
  }
  return data;
}

/** Whether a document is a supplier original, whose every access must be
 * recorded — the generic document routes refuse these. */
export async function isAuditedSupplierOriginal(documentId: number): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_document_is_audited_original", { p_document_id: documentId });
  if (error) throw error;
  return data === true;
}

/**
 * Reads a supplier original's bytes with the server's own credentials,
 * because 0113 no longer lets a signed-in client read it from Storage.
 *
 * Server-only. Two callers, both of which have already established the
 * right to the file: the audited viewer (after the audit row is written)
 * and the extraction runner (which reads the document of a capture it has
 * claimed). Never call it with a path a client supplied — only with the
 * `storage_path` of a document row read under the caller's session.
 */
export async function readSupplierOriginalBytes(storagePath: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supplier originals cannot be read: SUPABASE_SERVICE_ROLE_KEY is missing.");
  }
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(storagePath);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
