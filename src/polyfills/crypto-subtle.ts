// src/polyfills/crypto-subtle.ts
// Minimal crypto.subtle.digest('SHA-256', ...) polyfill using @noble/hashes.
// Type-safe (no `any`), no global redeclarations, safe for Android/iOS WebView.

import { sha256 } from '@noble/hashes/sha256.js'; // or '@noble/hashes/sha256' if your toolchain prefers

// ---- helpers ---------------------------------------------------------------

function toUint8(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
  return new Uint8Array(data as ArrayBufferLike); // ArrayBuffer or SharedArrayBuffer
}

async function digest(alg: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
  const name =
    typeof alg === 'string'
      ? alg.toUpperCase()
      : String((alg as { name?: string })?.name ?? '').toUpperCase();

  if (name !== 'SHA-256') {
    throw new Error(`crypto.subtle.digest polyfill only supports SHA-256 (got ${name || 'unknown'})`);
  }

  const out = sha256(toUint8(data)); // Uint8Array
  // Return a tight ArrayBuffer that satisfies TS (no SharedArrayBuffer)
  const copy = new Uint8Array(out);
  return copy.buffer;
}

// Narrow type guards so we can stay type-safe
type SubtleLike = { digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer> };

function hasObject<T extends object = object>(x: unknown): x is T {
  return typeof x === 'object' && x !== null;
}

function hasDigest(x: unknown): x is SubtleLike {
  return hasObject(x) && typeof (x as { digest?: unknown }).digest === 'function';
}

// ---- install polyfill without redeclaring global types ---------------------

// Work with globalThis through a type-safe index signature
const root: Record<string, unknown> = globalThis as unknown as Record<string, unknown>;

// Ensure `crypto` exists and is an object
if (!('crypto' in root) || !hasObject(root.crypto)) {
  Reflect.set(root, 'crypto', {} as Record<string, unknown>);
}

// Access the crypto object as a generic record
const cryptoRecord = root.crypto as Record<string, unknown>;

// Read current subtle
const currentSubtle: unknown = Reflect.get(cryptoRecord, 'subtle');

// If missing or lacks a working digest, install our minimal subtle
if (!hasDigest(currentSubtle)) {
  const subtle: SubtleLike = { digest };
  Reflect.set(cryptoRecord, 'subtle', subtle);
}

