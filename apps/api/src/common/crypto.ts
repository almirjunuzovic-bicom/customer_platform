/**
 * At-rest encryption for source credentials (API keys/tokens) stored in
 * `sources.credentials_encrypted` - these are real secrets for real
 * infrastructure (SERVERware today, AWS/Proxmox later), never stored
 * plaintext in MySQL. AES-256-GCM: authenticated, so a tampered/corrupted
 * blob fails loudly on decrypt instead of silently returning garbage.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const b64 = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set (generate with: openssl rand -base64 32)");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/** Encrypts an arbitrary JSON-serializable value. Output: base64(iv || authTag || ciphertext). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptJson<T>(blob: string): T {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
