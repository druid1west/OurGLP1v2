export const REMINDERS_CHANNEL = 'reminders';
export type ReminderEvent = { delta?: number; absolute?: number };

function post(evt: ReminderEvent) {
  if (typeof window === 'undefined') return;

  // Same-tab
  try {
    window.dispatchEvent(new CustomEvent('reminders:changed', { detail: evt }));
  } catch { return; }

  // Cross-tab
  if ('BroadcastChannel' in window) {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(REMINDERS_CHANNEL);
      bc.postMessage(evt);
    } catch { return; }
    finally { try { bc?.close(); } catch { void 0; } }
  }
}

export function emitReminderDelta(delta: number)   { post({ delta }); }
export function emitReminderAbsolute(absolute: number) { post({ absolute }); }
