// src/utils/hash.ts
import { sha256 } from '@noble/hashes/sha256.js'; // or '@noble/hashes/sha256' if your bundler prefers
import { bytesToHex } from '@noble/hashes/utils';

export function sha256Hex(input: string): string {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256(data as Uint8Array));
}

export function sha256Bytes(input: string): Uint8Array {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return sha256(data as Uint8Array);
}
