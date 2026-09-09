import type { Resend } from "resend";

/**
 * Phase 21C — fetches ONE attachment's real bytes from Resend, in the
 * two steps their Receiving/Attachments API requires: (1) get the
 * attachment's metadata (filename/size/content type + a short-lived
 * signed download URL) via the official SDK, (2) fetch the actual bytes
 * from that URL. The webhook payload itself never contains attachment
 * bytes or a size — this is why step 1 exists, and why a size check can
 * happen (see the service layer) BEFORE step 2 ever downloads anything.
 *
 * The signed `download_url` is treated as a secret for the length of
 * this call — never logged, never persisted. It naturally expires
 * (`expires_at`) and is discarded the moment this function returns.
 */

export class AttachmentFetchError extends Error {}

export type FetchedAttachmentMetadata = {
  attachmentId: string;
  filename: string | null;
  sizeBytes: number;
  contentType: string;
  contentDisposition: "inline" | "attachment";
  downloadUrl: string;
};

export async function fetchAttachmentMetadata(resend: Resend, emailId: string, attachmentId: string): Promise<FetchedAttachmentMetadata> {
  const { data, error } = await resend.emails.receiving.attachments.get({ emailId, id: attachmentId });
  if (error || !data) {
    throw new AttachmentFetchError(`Could not retrieve attachment metadata from Resend (${error?.message ?? "no data returned"}).`);
  }
  return {
    attachmentId: data.id,
    filename: data.filename ?? null,
    sizeBytes: data.size,
    contentType: data.content_type,
    contentDisposition: data.content_disposition,
    downloadUrl: data.download_url,
  };
}

/** Downloads the actual bytes from an already-fetched signed URL. Kept
 * as its own step (never called until after the caller has checked
 * `sizeBytes` against the allowed ceiling) so an oversized attachment
 * is rejected without ever pulling its content into memory. */
export async function downloadAttachmentBytes(downloadUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new AttachmentFetchError(`Could not download the attachment content (status ${response.status}).`);
  }
  return response.arrayBuffer();
}
