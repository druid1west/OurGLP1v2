// src/services/authBus.ts
export type AuthChangedDetail = { userId: string | null };
const AUTH_EVENT = 'auth:changed';

const target = new EventTarget();

export function onAuthChanged(handler: (d: AuthChangedDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<AuthChangedDetail>).detail);
  target.addEventListener(AUTH_EVENT, listener);
  return () => target.removeEventListener(AUTH_EVENT, listener);
}

export function emitAuthChanged(userId: string | null): void {
  target.dispatchEvent(new CustomEvent<AuthChangedDetail>(AUTH_EVENT, { detail: { userId } }));
}
