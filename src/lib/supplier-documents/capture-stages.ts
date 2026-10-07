/**
 * SD-2 — how a supplier invoice capture is presented: which stage of the
 * Invoice Capture workspace it belongs to, and what its status is called.
 *
 * Client-safe (no server imports). The capture's own `status` is the
 * database's; the stage is derived, because "Approved" and "Posted" are
 * facts about the Draft purchase document the capture became — the bill's
 * own workflow decides them, not the capture.
 */
import type { CaptureStatus } from "@/server/supplier-invoice-capture/types";

export type CaptureStage = "inbox" | "processing" | "needs-review" | "approved" | "posted" | "rejected";

export const CAPTURE_STAGES: { key: CaptureStage; label: string; description: string }[] = [
  { key: "inbox", label: "Inbox", description: "Received and waiting to be read or entered by hand, including duplicates and documents that could not be read." },
  { key: "processing", label: "Processing", description: "Being read automatically." },
  { key: "needs-review", label: "Needs Review", description: "Read and checked. A person must confirm the supplier, figures and lines." },
  { key: "approved", label: "Approved", description: "Approved by a reviewer and created as a draft bill or credit note, not yet posted." },
  { key: "posted", label: "Posted", description: "The bill or credit note has been posted to the ledger through the purchasing workflow." },
  { key: "rejected", label: "Rejected", description: "Rejected by a reviewer. The original document and its history are kept." },
];

/** Which stage a capture is in. `billPostingStatus` is the posting status of
 * the purchase document it became, when it has become one. */
export function captureStage(status: CaptureStatus, billPostingStatus: string | null): CaptureStage {
  switch (status) {
    case "Extracting":
      return "processing";
    case "NeedsReview":
      return "needs-review";
    case "Converted":
      return billPostingStatus === "Posted" ? "posted" : "approved";
    case "Cancelled":
      return "rejected";
    default:
      // Uploaded, Queued, ManualEntry, Failed, Duplicate: received, not yet reviewable.
      return "inbox";
  }
}

export const STATUS_LABEL: Record<CaptureStatus, string> = {
  Uploaded: "Received",
  Queued: "Waiting to be read",
  Extracting: "Being read",
  ManualEntry: "Being entered by hand",
  NeedsReview: "Needs review",
  Converted: "Approved",
  Duplicate: "Duplicate",
  Failed: "Could not be read",
  Cancelled: "Rejected",
};

export type BadgeTone = "good" | "warn" | "info" | "danger" | "muted" | "critical";

export const STATUS_TONE: Record<CaptureStatus, BadgeTone> = {
  Uploaded: "muted",
  Queued: "info",
  Extracting: "info",
  ManualEntry: "warn",
  NeedsReview: "warn",
  Converted: "good",
  Duplicate: "danger",
  Failed: "danger",
  Cancelled: "muted",
};

/** What a converted capture's purchase document is called, and how its own
 * posting status reads. */
export function billStatusLabel(postingStatus: string | null): string {
  switch (postingStatus) {
    case "Draft":
      return "Draft";
    case "Submitted":
      return "Submitted for approval";
    case "Approved":
      return "Approved, not yet posted";
    case "Posted":
      return "Posted";
    case "Cancelled":
      return "Cancelled";
    default:
      return "—";
  }
}

export function isCreditNote(documentType: string | null | undefined): boolean {
  return (documentType ?? "").trim().toLowerCase() === "credit note";
}

/** "Invoice" or "Credit note" — what the reviewer is looking at. */
export function documentKindLabel(documentType: string | null | undefined): string {
  if (isCreditNote(documentType)) return "Credit note";
  const type = (documentType ?? "").trim();
  if (!type || type.toLowerCase() === "invoice") return "Invoice";
  return type;
}

/** One row of the Invoice Capture inbox, as the page hands it to the client. */
export type InboxRow = {
  id: number;
  status: CaptureStatus;
  stage: CaptureStage;
  documentType: string | null;
  supplierName: string | null;
  supplierConfirmed: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number | null;
  validationStatus: string;
  duplicateStatus: string;
  manualEntry: boolean;
  filename: string | null;
  receivedAt: string;
  billId: number | null;
  billPostingStatus: string | null;
};

/** Who may do what on this screen. Computed server-side from the user's own
 * Purchasing permissions; the API and the database enforce every one of them
 * independently — this only decides which controls are offered. */
export type CapturePermissions = {
  view: boolean;
  upload: boolean;
  edit: boolean;
  reject: boolean;
  /** Purchasing:Create AND Purchasing:Approve — conversion also checks the
   * reviewer's approval limit against the document's amount. */
  approve: boolean;
};
