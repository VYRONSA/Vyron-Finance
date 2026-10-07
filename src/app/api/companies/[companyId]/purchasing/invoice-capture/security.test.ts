/**
 * @vitest-environment node
 *
 * Runs in the node environment: this suite builds real `File`/`FormData`
 * objects to exercise the upload route, and jsdoms FormData refuses a
 * File constructed inside it.
 */
/**
 * Phase 5L — security of the Supplier Invoice Capture routes.
 *
 * VYRON COST had ZERO permission checks across ~30 document routes, took
 * the approver's identity from the request body, and gated a bypass on a
 * shared PIN printed on its settings page. These tests exist so none of
 * that is possible here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSession = vi.fn();
class PreparationRefused extends Error {}
const requirePermission = vi.fn();
const requireApproval = vi.fn();
const uploadDocument = vi.fn();
const listCaptures = vi.fn();
const queueDocumentForExtraction = vi.fn();
const getCapture = vi.fn();
const convertCaptureToBill = vi.fn();
const applyHeaderCorrection = vi.fn();
const listCaptureLines = vi.fn();
const listCaptureEvents = vi.fn();
const cancelCapture = vi.fn();
const applyLineCorrections = vi.fn();
const prepareConversion = vi.fn();
const startManualEntry = vi.fn();
const submitForReview = vi.fn();
const revalidateCapture = vi.fn();

vi.mock("@/server/auth/require-session", () => ({
  requireSession: () => requireSession(),
  getPerformedByLabel: async () => "reviewer@example.test",
}));
vi.mock("@/server/services/permission-service", () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...args),
  requireApproval: (...args: unknown[]) => requireApproval(...args),
}));
vi.mock("@/server/services/document-service", () => ({
  uploadDocument: (...args: unknown[]) => uploadDocument(...args),
  ValidationError: class extends Error {},
  UsageLimitExceededError: class extends Error {},
}));
vi.mock("@/server/services/supplier-invoice-capture-service", () => ({
  listCaptures: (...a: unknown[]) => listCaptures(...a),
  queueDocumentForExtraction: (...a: unknown[]) => queueDocumentForExtraction(...a),
  getCapture: (...a: unknown[]) => getCapture(...a),
  convertCaptureToBill: (...a: unknown[]) => convertCaptureToBill(...a),
  applyHeaderCorrection: (...a: unknown[]) => applyHeaderCorrection(...a),
  applyLineCorrections: (...a: unknown[]) => applyLineCorrections(...a),
  cancelCapture: (...a: unknown[]) => cancelCapture(...a),
  listCaptureLines: (...a: unknown[]) => listCaptureLines(...a),
  listCaptureEvents: (...a: unknown[]) => listCaptureEvents(...a),
  prepareConversion: (...a: unknown[]) => prepareConversion(...a),
  startManualEntry: (...a: unknown[]) => startManualEntry(...a),
  submitForReview: (...a: unknown[]) => submitForReview(...a),
  revalidateCapture: (...a: unknown[]) => revalidateCapture(...a),
  ValidationError: PreparationRefused,
  NotFoundError: class extends Error {},
}));

const ALLOWED = { ok: true as const };
const FORBIDDEN = { ok: false as const, response: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) };
const UNAUTHENTICATED = { ok: false as const, response: new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }) };

const params = { params: Promise.resolve({ companyId: "co_1" }) };
const captureParams = { params: Promise.resolve({ companyId: "co_1", captureId: "5" }) };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true });
  requirePermission.mockResolvedValue(ALLOWED);
  requireApproval.mockResolvedValue(ALLOWED);
  listCaptures.mockResolvedValue([]);
  listCaptureLines.mockResolvedValue([]);
  listCaptureEvents.mockResolvedValue([]);
  getCapture.mockResolvedValue({ id: 5, total: 1150 });
  convertCaptureToBill.mockResolvedValue({ billId: 900 });
  prepareConversion.mockResolvedValue({ approvalAmount: 1150, documentType: "Bill" });
});

function pdf(name = "invoice.pdf", size = 1000, type = "application/pdf") {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

function upload(file: File) {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://test/api", { method: "POST", body: form });
}

describe("anonymous access", () => {
  it("is refused on every route before anything else happens", async () => {
    requireSession.mockResolvedValue(UNAUTHENTICATED);
    const list = await import("./route");
    const detail = await import("./[captureId]/route");

    expect((await list.GET(new Request("http://test/api"), params)).status).toBe(401);
    expect((await list.POST(upload(pdf()), params)).status).toBe(401);
    expect((await detail.GET(new Request("http://test/api"), captureParams)).status).toBe(401);

    expect(requirePermission).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(listCaptures).not.toHaveBeenCalled();
  });
});

describe("a signed-in user without the permission", () => {
  it("cannot list captures", async () => {
    requirePermission.mockResolvedValue(FORBIDDEN);
    const { GET } = await import("./route");
    expect((await GET(new Request("http://test/api"), params)).status).toBe(403);
    expect(listCaptures).not.toHaveBeenCalled();
  });

  it("cannot upload — and the file is never even parsed or stored", async () => {
    requirePermission.mockResolvedValue(FORBIDDEN);
    const { POST } = await import("./route");
    expect((await POST(upload(pdf()), params)).status).toBe(403);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(queueDocumentForExtraction).not.toHaveBeenCalled();
  });

  it("cannot read one capture, and the refusal comes before the lookup", async () => {
    requirePermission.mockResolvedValue(FORBIDDEN);
    const { GET } = await import("./[captureId]/route");
    expect((await GET(new Request("http://test/api"), captureParams)).status).toBe(403);
    // A 403 cannot be probed into a 404 to learn whether a capture exists.
    expect(getCapture).not.toHaveBeenCalled();
  });

  it("cannot convert a capture into a bill", async () => {
    requirePermission.mockResolvedValue(FORBIDDEN);
    const { PATCH } = await import("./[captureId]/route");
    const request = new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "convert" }) });
    expect((await PATCH(request, captureParams)).status).toBe(403);
    expect(convertCaptureToBill).not.toHaveBeenCalled();
  });
});

describe("permissions used", () => {
  it("reads require Purchasing:View, writes require Create/Edit", async () => {
    const list = await import("./route");
    const detail = await import("./[captureId]/route");

    await list.GET(new Request("http://test/api"), params);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:View");

    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true });
    requirePermission.mockResolvedValue(ALLOWED);
    uploadDocument.mockResolvedValue({ id: 11 });
    queueDocumentForExtraction.mockResolvedValue({ captureId: 1, status: "Queued" });
    await list.POST(upload(pdf()), params);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Create");

    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true });
    requirePermission.mockResolvedValue(ALLOWED);
    getCapture.mockResolvedValue({ id: 5 });
    listCaptureLines.mockResolvedValue([]);
    await detail.PATCH(
      new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "correct-header", header: {} }) }),
      captureParams,
    );
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Edit");
  });

  it("requires Purchasing:Reject (not Edit) to reject a capture, and rejects nothing without it", async () => {
    const { PATCH } = await import("./[captureId]/route");
    await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }), captureParams);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Reject");
    expect(requirePermission).not.toHaveBeenCalledWith("co_1", "Purchasing:Edit");

    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true });
    requirePermission.mockResolvedValue(FORBIDDEN);
    const response = await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }), captureParams);
    expect(response.status).toBe(403);
    expect(cancelCapture).not.toHaveBeenCalled();
  });

  it("checks the permission against the company in the PATH, not one supplied by the caller", async () => {
    const { GET } = await import("./route");
    await GET(new Request("http://test/api?companyId=someone-else"), params);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:View");
  });
});

describe("conversion is gated twice, and the actor is the session's", () => {
  it("requires an approval limit covering the invoice's value", async () => {
    const { PATCH } = await import("./[captureId]/route");
    prepareConversion.mockResolvedValue({ approvalAmount: 250000, documentType: "Bill" });
    await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "convert" }) }), captureParams);

    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Create");
    expect(requireApproval).toHaveBeenCalledWith("co_1", "Purchasing:Approve", "PurchaseApproval", 250000);
  });

  it("SD-1: checks the limit against the PREPARED amount, never the extracted header total", async () => {
    const { PATCH } = await import("./[captureId]/route");
    // The extracted total is missing — it used to become 0 and pass any limit.
    getCapture.mockResolvedValue({ id: 5, total: null });
    prepareConversion.mockResolvedValue({ approvalAmount: 9200, documentType: "Bill" });
    await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "convert" }) }), captureParams);
    expect(requireApproval).toHaveBeenCalledWith("co_1", "Purchasing:Approve", "PurchaseApproval", 9200);
    expect(requireApproval).not.toHaveBeenCalledWith("co_1", "Purchasing:Approve", "PurchaseApproval", 0);
    // ...and converts holding the amount the limit was checked against.
    expect(convertCaptureToBill).toHaveBeenCalledWith("co_1", 5, 9200);
  });

  it("SD-1: a capture that cannot be converted is refused before any approval check", async () => {
    const { PATCH } = await import("./[captureId]/route");
    prepareConversion.mockRejectedValue(new PreparationRefused("The corrected invoice has not been validated yet."));
    const response = await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "convert" }) }), captureParams);
    expect(response.status).toBe(400);
    expect(requireApproval).not.toHaveBeenCalled();
    expect(convertCaptureToBill).not.toHaveBeenCalled();
  });

  it("refuses when the reviewer's limit is too low, and creates nothing", async () => {
    requireApproval.mockResolvedValue(FORBIDDEN);
    const { PATCH } = await import("./[captureId]/route");
    const response = await PATCH(
      new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "convert" }) }),
      captureParams,
    );
    expect(response.status).toBe(403);
    expect(convertCaptureToBill).not.toHaveBeenCalled();
  });

  it("NEVER passes an approver from the request body", async () => {
    const { PATCH } = await import("./[captureId]/route");
    await PATCH(
      new Request("http://test/api", {
        method: "PATCH",
        body: JSON.stringify({ action: "convert", approvedBy: "someone-else", supervisorPin: "vyron-supervisor" }),
      }),
      captureParams,
    );
    // The service takes (companyId, captureId, the server-computed approval
    // amount). There is nowhere for a caller-supplied identity or PIN to arrive.
    expect(convertCaptureToBill).toHaveBeenCalledWith("co_1", 5, 1150);
    expect(convertCaptureToBill).toHaveBeenCalledTimes(1);
  });

  it("has no force action — an unknown action is refused, not treated as an override", async () => {
    const { PATCH } = await import("./[captureId]/route");
    for (const action of ["force", "force-convert", "override", "approve-anyway"]) {
      const response = await PATCH(
        new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action, force: true }) }),
        captureParams,
      );
      expect(response.status).toBe(400);
    }
    expect(convertCaptureToBill).not.toHaveBeenCalled();
  });
});

describe("SD-1 manual entry and re-validation require Purchasing:Edit", () => {
  it.each([
    ["manual-entry", startManualEntry],
    ["submit-for-review", submitForReview],
    ["revalidate", revalidateCapture],
  ] as const)("%s checks Purchasing:Edit and does nothing without it", async (action, fn) => {
    const { PATCH } = await import("./[captureId]/route");
    await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action }) }), captureParams);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Purchasing:Edit");
    expect(fn).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true });
    requirePermission.mockResolvedValue(FORBIDDEN);
    const response = await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action }) }), captureParams);
    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a database refusal (the 0111/0112 guard) is reported as 403, not a server error", async () => {
    const { PATCH } = await import("./[captureId]/route");
    startManualEntry.mockRejectedValue({ code: "42501", message: "only a queued or failed capture can be entered by hand" });
    const response = await PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ action: "manual-entry" }) }), captureParams);
    expect(response.status).toBe(403);
  });
});

describe("upload validation happens before any storage or AI cost", () => {
  it("refuses a file type an invoice cannot be", async () => {
    const { POST } = await import("./route");
    const response = await POST(upload(pdf("macro.xlsm", 100, "application/vnd.ms-excel")), params);
    expect(response.status).toBe(415);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("refuses a file over the size cap — COST had no cap at all", async () => {
    const { POST } = await import("./route");
    const response = await POST(upload(pdf("huge.pdf", 21 * 1024 * 1024)), params);
    expect(response.status).toBe(413);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("refuses an empty file", async () => {
    const { POST } = await import("./route");
    expect((await POST(upload(pdf("empty.pdf", 0)), params)).status).toBe(400);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("accepts PDF, JPG and PNG", async () => {
    const { POST } = await import("./route");
    uploadDocument.mockResolvedValue({ id: 11 });
    queueDocumentForExtraction.mockResolvedValue({ captureId: 1, status: "Queued" });
    for (const type of ["application/pdf", "image/jpeg", "image/png"]) {
      const response = await POST(upload(pdf(`invoice.${type.split("/")[1]}`, 500, type)), params);
      expect(response.status).toBe(201);
    }
  });

  it("computes a content hash and hands it to BOTH the document and the queue", async () => {
    const { POST } = await import("./route");
    uploadDocument.mockResolvedValue({ id: 11 });
    queueDocumentForExtraction.mockResolvedValue({ captureId: 1, status: "Queued" });
    await POST(upload(pdf()), params);

    const uploadInput = uploadDocument.mock.calls[0][0] as { contentSha256: string };
    expect(uploadInput.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(queueDocumentForExtraction).toHaveBeenCalledWith("co_1", 11, uploadInput.contentSha256);
  });

  it("uses the shared Document Platform upload, not a second storage path", async () => {
    const { POST } = await import("./route");
    uploadDocument.mockResolvedValue({ id: 11 });
    queueDocumentForExtraction.mockResolvedValue({ captureId: 1, status: "Queued" });
    await POST(upload(pdf()), params);
    const input = uploadDocument.mock.calls[0][0] as { companyId: string; entityType: string; uploadedBy: string };
    expect(input.companyId).toBe("co_1");
    expect(input.entityType).toBe("Supplier");
    // The uploader is the session's, never a request field.
    expect(input.uploadedBy).toBe("reviewer@example.test");
  });
});
