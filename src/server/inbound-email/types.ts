/**
 * Phase 21C — Inbound Bank Statement Email processing. Shared types for
 * the webhook -> recipient resolution -> attachment retrieval ->
 * existing Import Centre pipeline flow.
 *
 * Phase 21F adds `InboundEmailMessage` — the provider-neutral
 * representation an inbound email is normalized into before it reaches
 * `inbound-bank-statement-email-service.ts`. Resend today
 * (`resend-adapter.ts`), a future Virtualmin/raw-MIME source later,
 * produce this same shape; the service itself never imports a
 * provider-specific type. Deliberately excludes `companyId` — company
 * resolution stays a separate, explicit security step performed by the
 * service from `to`, never folded into the representation itself.
 */

/** A single attachment, normalized to a shape neither provider-specific
 * API shape leaks through. `filename`/`contentType`/`contentDisposition`
 * are always known up front (from the provider's own envelope/headers,
 * no network call). `getMetadata`/`getBytes` are lazy so a filtered-out
 * or oversized attachment never triggers unnecessary work — mirrors
 * Resend's existing two-step Receiving/Attachments API exactly, and costs
 * a future in-memory provider (e.g. a parsed raw MIME message) nothing,
 * since both can simply resolve immediately from already-held data. */
export type NormalizedInboundAttachment = {
  filename: string;
  contentType: string;
  contentDisposition: "inline" | "attachment";
  /** Resolves the real size (and, if the provider can refine it, a more
   * authoritative filename) without downloading the content. Callers
   * must call this and check `sizeBytes` against the allowed ceiling
   * before ever calling `getBytes()`. */
  getMetadata: () => Promise<{ sizeBytes: number; filename: string }>;
  /** Resolves the actual attachment bytes. */
  getBytes: () => Promise<ArrayBuffer>;
};

/** The provider-neutral inbound email representation. No accounting
 * fields, no `companyId` — this is purely "what arrived," resolved by
 * the service into a tenant via `to` only. */
export type InboundEmailMessage = {
  /** e.g. "resend" — identifies which adapter produced this message, and
   * is stored as-is in the webhook-events idempotency table. */
  provider: string;
  /** The stable idempotency key for THIS delivery (Resend: the
   * `svix-id` header — a future raw-MIME source would use its
   * `Message-ID` header or another provider-stable identifier). Never
   * the same as `messageId` in general — one email can be redelivered
   * under a new `providerEventId` while its `Message-ID` stays fixed. */
  providerEventId: string;
  /** The RFC822 `Message-ID` header, when available. */
  messageId: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  /** ISO 8601 — when the provider says the message was received. */
  receivedAt: string;
  /** Raw header key/value pairs, when the provider can supply them.
   * Not consumed by any current logic — carried through for future
   * audit/debugging use. */
  headers?: Record<string, string>;
  /** The raw RFC822/MIME source, when the provider can supply it
   * (e.g. a future raw-MIME source). Resend's webhook never provides
   * this, so its adapter always omits it. */
  rawMessage?: string;
  attachments: NormalizedInboundAttachment[];
};

/** Every distinct way a webhook delivery can end, without treating any
 * of them as a fabricated success. `rejected` = a permanent business
 * reason (retrying the identical event will never succeed — Resend
 * should not keep retrying). `failed` = a transient infrastructure
 * problem (retrying may succeed — Resend's own retry schedule should
 * get another chance). */
export type InboundProcessingOutcomeStatus = "processed" | "already-processed" | "rejected" | "failed";

export type InboundProcessingOutcome = {
  status: InboundProcessingOutcomeStatus;
  reason: string;
  companyId: string | null;
  /** Present only on `status: "processed"` — the real result from the
   * existing import pipeline, never fabricated figures. */
  result?: {
    filename: string;
    importedCount: number;
    duplicateCount: number;
    exceptionCount: number;
  };
};
