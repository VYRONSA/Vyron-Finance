/**
 * Phase 5L — deterministic file identity.
 *
 * SHA-256 over the stored bytes, via the Web Crypto API that both the Node
 * and Edge runtimes expose, so the same file always produces the same hash
 * wherever the upload is handled.
 *
 * This is an IDENTITY, not a fingerprint of content for any other purpose:
 * it answers "have we already captured exactly this file?" and nothing
 * else. It is stored on `documents.content_sha256` and compared before any
 * AI request, so an exact re-upload never costs a provider call.
 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `crypto.subtle` wants an ArrayBuffer; a Uint8Array view may be a slice
  // of a larger buffer, so the exact range is taken rather than the whole
  // underlying buffer.
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", view);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
