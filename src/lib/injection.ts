// src/lib/injection.ts
export async function postInjectionTaken(takenAtISO?: string) {
  const body = takenAtISO ? { taken_at: takenAtISO } : {};
  const res = await fetch('/api/user/injection/taken', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to mark injection'));
  // let listeners refresh (DayPage, Weekly Summary, etc.)
  window.dispatchEvent(new Event('injection:marked'));
  return res.json();
}
