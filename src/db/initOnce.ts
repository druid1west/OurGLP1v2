// src/db/initOnce.ts
let initPromise: Promise<void> | null = null;
let inited = false;

export function initDbOnce(initDb: () => Promise<void>): Promise<void> {
  if (inited) return Promise.resolve();
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    await initDb();
    inited = true;
  })().finally(() => {
    initPromise = null;
  });
  
  return initPromise;
}

export function isDbInitialized(): boolean {
  return inited;
}