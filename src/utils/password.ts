// src/utils/password.ts
// Pure-TS PBKDF2 using @noble/hashes, no WebCrypto.
// Supports BOTH formats:
//   • Legacy:  "<saltB64>:<hashB64>"
//   • New:     "pbkdf2$sha256$<iterations>$<saltHex>$<hashHex>"

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils';

/* ----------------------------- Tunables ----------------------------- */
const ITERATIONS = 120_000; // good mobile baseline
const SALT_LEN = 16;        // 128-bit salt
const KEY_LEN = 32;         // 256-bit derived key
const PREFIX = 'pbkdf2$sha256';

/* ------------------------ Encoding helpers -------------------------- */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ----------------------- Constant-time compare ---------------------- */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------------------------- New format ---------------------------- */
// Stored: "pbkdf2$sha256$<iterations>$<saltHex>$<hashHex>"
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const dk = pbkdf2(sha256, plain, salt, { c: ITERATIONS, dkLen: KEY_LEN });
  return `${PREFIX}$${ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(dk)}`;
}

/**
 * Verify against either format.
 * Returns:
 *   - true  → verified (already new format)
 *   - { ok: true, upgradedHash } → verified legacy; caller can persist upgradedHash
 *   - false → not verified
 */
export async function verifyPassword(
  plain: string,
  stored: string
): Promise<boolean | { ok: true; upgradedHash: string }> {
  if (!stored) return false;

  // New format?
  if (stored.startsWith(`${PREFIX}$`)) {
    const parts = stored.split('$');
    if (parts.length !== 5) return false;
    const [_pfx, algo, iterStr, saltHex, hashHex] = parts;
    if (_pfx !== 'pbkdf2' || algo !== 'sha256') return false;

    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;

    const salt = hexToBytes(saltHex);
    const expected = hexToBytes(hashHex);
    const dk = pbkdf2(sha256, plain, salt, { c: iterations, dkLen: expected.length });
    return constantTimeEqual(dk, expected);
  }

  // Legacy format? "<saltB64>:<hashB64>"
  const [saltB64, hashB64] = stored.split(':');
  if (saltB64 && hashB64) {
    const salt = b64ToBytes(saltB64);
    const expected = b64ToBytes(hashB64);
    // Match legacy cost (200k iterations)
    const dk = pbkdf2(sha256, plain, salt, { c: 200_000, dkLen: expected.length });
    const ok = constantTimeEqual(dk, expected);
    if (!ok) return false;

    // Upgrade to new format on success
    const upgradedHash = await hashPassword(plain);
    return { ok: true as const, upgradedHash };
  }

  return false;
}


