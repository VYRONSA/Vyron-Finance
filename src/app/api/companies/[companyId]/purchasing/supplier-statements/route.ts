import { after, NextResponse } from "next/server";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { uploadDocument, ValidationError as DocumentValidationError, UsageLimitExceededError } from "@/server/services/document-service";
import { listSupplierStatements, processStatement, registerUploadedStatement } from "@/server/services/supplier-statement-service";
import { detectInlineFileType } from "@/server/documents/inline-file-type";
import { sha256Hex } from "@/server/supplier-invoice-capture/file-hash";
import { detectStatementFileType, STATEMENT_MIME } from "@/server/supplier-statements/file-type";
import type { StatementStatus } from "@/server/supplier-statements/types";

/** Owner decision (SD-3A): 25 MB, 60 pages (the page limit is applied when
 * the file is read, after the response). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const STATUSES: StatementStatus[] = ["Queued", "Processing", "ManualEntry", "NeedsReview", "Ready", "Reconciled", "Duplicate", "Failed", "Rejected"];

/** Supplier statements, newest first (bounded). */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && (STATUSES as string[]).includes(statusParam) ? (statusParam as StatementStatus) : undefined;
  const statements = await listSupplierStatements(companyId, { status });
  return NextResponse.json({ statements });
}

/**
 * Uploads a supplier statement — PDF first; JPEG/PNG scans; CSV/XLSX as a
 * secondary convenience.
 *
 * The response returns as soon as the original is retained and the statement
 * is Queued. Reading it happens AFTER the response (owner decision: no heavy
 * PDF extraction inside the upload request), via `after()`; a statement left
 * Queued can be requeued from its detail route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  // Permission BEFORE the body is read.
  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "A file is required." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "That file is larger than 25 MB." }, { status: 413 });

  const filename = (file as File).name || "supplier-statement";
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The kind comes from the bytes, never the browser's declared type.
  const kind = detectStatementFileType(bytes, filename);
  if (!kind) {
    return NextResponse.json({ error: "Upload the supplier's statement as a PDF (or a JPG/PNG scan, CSV or XLSX)." }, { status: 415 });
  }
  const mimeType = kind === "image" ? (detectInlineFileType(bytes) ?? "image/png") : STATEMENT_MIME[kind];
  const contentSha256 = await sha256Hex(bytes);

  try {
    // The one Document Platform upload path: tenant scoping, scanning,
    // versioning and audit come from it. Retained as evidence (0114).
    const document = await uploadDocument(
      {
        companyId,
        entityType: "Supplier",
        entityId: 0,
        category: "Statement",
        filename,
        mimeType,
        file: new Blob([bytes], { type: mimeType }),
        retentionUntil: null,
        uploadedBy: await getPerformedByLabel(),
        contentSha256,
      },
      null,
    );
    const registered = await registerUploadedStatement(companyId, document.id, contentSha256, kind);

    if (registered.status === "Queued") {
      const performedBy = await getPerformedByLabel();
      after(async () => {
        try {
          await processStatement(companyId, registered.statementId, performedBy);
        } catch (error) {
          console.error("Supplier statement processing did not complete; it stays Queued and can be requeued.", {
            companyId,
            statementId: registered.statementId,
            error: error instanceof Error ? error.name : "error",
          });
        }
      });
    }
    return NextResponse.json({ statement: registered, documentId: document.id }, { status: 201 });
  } catch (error) {
    if (error instanceof UsageLimitExceededError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DocumentValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
