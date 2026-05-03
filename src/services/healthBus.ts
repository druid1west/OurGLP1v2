// src/services/healthBus.ts
/* Typed cross-tab and in-tab health change bus. */

export type HealthEventKind =
  | "protein"
  | "hydration"
  | "exercise"
  | "mood"
  | "bowel"
  | "blood_pressure"
  | "blood_sugar"
  | "sleep"
  | "fasting"
  | "bulk"              // e.g., imports
  | "unknown";

export type HealthEvent = Readonly<{
  kind: HealthEventKind;
  at: number;           // Date.now()
  source?: "local" | "remote";
}>;

const CHANNEL_NAME = "health:changes:v1";

type Handler = (e: HealthEvent) => void;

const hasBC = typeof window !== "undefined" && "BroadcastChannel" in window;
const bc = hasBC ? new BroadcastChannel(CHANNEL_NAME) : null;

const listeners = new Set<Handler>();

if (bc) {
  bc.addEventListener("message", (evt: MessageEvent<HealthEvent>) => {
    const data = evt.data;
    if (!data || typeof data !== "object") return;
    for (const h of listeners) h({ ...data, source: "remote" });
  });
}

export function emitHealthChanged(kind: HealthEventKind): void {
  const evt: HealthEvent = { kind, at: Date.now(), source: "local" };
  // in-tab
  for (const h of listeners) h(evt);
  // cross-tab
  if (bc) bc.postMessage(evt);
  // window fallback
  window.dispatchEvent(
    new CustomEvent<HealthEvent>("health:changed", { detail: evt })
  );
}

export function onHealthChange(handler: Handler): void {
  listeners.add(handler);
  // also listen to window fallback
  const winHandler = (e: Event) => {
    const detail = (e as CustomEvent<HealthEvent>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener("health:changed", winHandler as EventListener);
  // store a remover on the handler function
  (handler as unknown as { __off?: () => void }).__off = () => {
    window.removeEventListener("health:changed", winHandler as EventListener);
    listeners.delete(handler);
  };
}

export function offHealthChange(handler: Handler): void {
  const off = (handler as unknown as { __off?: () => void }).__off;
  if (typeof off === "function") off();
  else listeners.delete(handler);
}