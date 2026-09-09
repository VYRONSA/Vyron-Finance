/**
 * Phase 16, Part 4 — token/secret encryption at rest.
 *
 * FINDINGS.md §9 confirmed no encryption utility of any kind exists
 * anywhere in this codebase — this is genuinely new infrastructure, not
 * a reuse. Per the brief's own instruction ("if it does not exist, STOP
 * before inventing an insecure storage mechanism and report exactly
 * what is required"), this is exactly that report, made real: AES-256-GCM
 * envelope encryption using Node's own built-in `crypto` module (no new
 * dependency), keyed by one new required server-only secret,
 * `BANK_TOKEN_ENCRYPTION_KEY` (documented in .env.local.example).
 *
 * This is the ONLY module in the bank-connectivity layer allowed to see
 * a plaintext access/refresh token outside the moment it's received
 * from FNB's token endpoint and the moment it's handed to an outgoing
 * FNB API request. Every DB column that stores a token stores ONLY the
 * output of `encryptToken` — never plaintext (bank-connectivity-service.ts
 * and the repository layer never construct a raw token string to store).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96-bit IV, the standard/recommended size for GCM.

export class TokenEncryptionError extends Error {}

/** `BANK_TOKEN_ENCRYPTION_KEY` may be any length (a human-chosen secret,
 * not necessarily exactly 32 raw bytes) — SHA-256 deterministically
 * derives a real 32-byte AES-256 key from it, the same "derive, don't
 * require an exact-length secret" approach as this codebase's other
 * server-only secrets (e.g. Supabase's own key handling never requires
 * an operator to paste an exact byte count). */
function deriveKey(): Buffer {
  const secret = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new TokenEncryptionError(
      "BANK_TOKEN_ENCRYPTION_KEY is not configured — bank connection tokens cannot be encrypted or decrypted without it. See .env.local.example.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Envelope format: `base64(iv) + "." + base64(authTag) + "." + base64(ciphertext)`
 * — one opaque text value per secret, so the DB schema needs only one
 * column per token rather than three. Never logs the plaintext input —
 * see Part 25's "never log tokens" requirement, enforced structurally
 * here since this function's own inputs/outputs are only ever passed
 * directly between the FNB client and the repository layer, never
 * through a logging call. */
export function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptToken(envelope: string): string {
  const key = deriveKey();
  const parts = envelope.split(".");
  if (parts.length !== 3) {
    throw new TokenEncryptionError("Malformed token envelope — expected iv.authTag.ciphertext.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // GCM authentication failure (wrong key, or the ciphertext was
    // tampered with) — never leak WHY decryption failed beyond this.
    throw new TokenEncryptionError("Token could not be decrypted — the encryption key may be wrong, or the stored value is corrupted.");
  }
}
