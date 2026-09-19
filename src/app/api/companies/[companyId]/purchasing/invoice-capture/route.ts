import { NextResponse } from "next/server";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { uploadDocument, ValidationError as DocumentValidationError, UsageLimitExceededError } from "@/server/services/document-service";
import { listCaptures, queueDocumentForExtraction } from "@/server/services/supplier-invoice-capture-service";
import { sha256Hex } from "@/server/supplier-invoice-capture/file-hash";
import type { CaptureStatus } from "@/server/supplier-invoice-capture/types";

export const maxDuration = 60;

/** Only what an invoice can actually be. Anything else is refused before a
 * byte is stored, never sent to a model and never counted against the AI
 * budget. VYRON COST had no size cap at all on its document path. */
const ACCEPTED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const STATUSES: CaptureStatus[] = ["Uploaded", "Queued", "Extracting", "NeedsReview", "Converted", "Duplicate", "Failed", "Cancelled"];

/** The capture inbox. Bounded by the repository — the brief is explicit
 * that this must not load an unbounded list. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && (STATUSES as string[]).includes(statusParam) ? (statusParam as CaptureStatus) : undefined;
  const limitParam = Number(url.searchParams.get("limit"));

  const captures = await listCaptures(companyId, {
    status,
    search: url.searchParams.get("search") ?? undefined,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
  });
  return NextResponse.json({ captures });
}

/**
 * Uploads a supplier invoice and QUEUES it for extraction.
 *
 * The response returns as soon as the document is stored and the work is
 * queued. Extraction itself happens on the automation runner, so closing
 * the browser cannot abandon it — the defect that stranded documents in
 * VYRON COST, which drove extraction from the client.
 *
 * The file is hashed here, and an exact re-upload is identified BEFORE any
 * AI request, so a duplicate never costs a provider call.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  // Permission BEFORE the body is read — a caller who may not capture
  // invoices should not get as far as having their file parsed.
  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  const formData = await request.formData();
  const file = formData.get("file");
  const supplierIdRaw = formData.get("supplierId");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }
  const mimeType = (file.type || "").toLowerCase();
  if (!ACCEPTED_MIME.has(mimeType)) {
    return NextResponse.json({ error: "Upload a PDF, JPG or PNG of the supplier's invoice." }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is larger than 20 MB. Upload a smaller scan." }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentSha256 = await sha256Hex(bytes);

  try {
    // The ONE Document Platform upload path: tenant scoping, virus-scan
    // status, versioning, retention and audit all come from it. There is
    // no second storage path in this feature.
    const document = await uploadDocument(
      {
        companyId,
        entityType: "Supplier",
        // Attached to the supplier once one is resolved; 0 until then, so
        // an unidentified invoice is still stored rather than refused.
        entityId: Number(supplierIdRaw) > 0 ? Number(supplierIdRaw) : 0,
        // An existing category — this feature invents no taxonomy.
        category: "Invoice",
        filename: (file as File).name || "supplier-invoice",
        mimeType,
        file,
        retentionUntil: null,
        uploadedBy: await getPerformedByLabel(),
        contentSha256,
      },
      null,
    );

    const queued = await queueDocumentForExtraction(companyId, document.id, contentSha256);
    return NextResponse.json({ capture: queued, documentId: document.id }, { status: 201 });
  } catch (error) {
    if (error instanceof UsageLimitExceededError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DocumentValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
