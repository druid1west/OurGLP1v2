// src/types/globals.d.ts
export {};

// Keep your existing DebugTimeBlock + debugDayPage
declare global {
  interface DebugTimeBlock {
    label: string;
    isFasting: boolean;
    isCurrent: boolean;
    isInjectionTime?: boolean;
  }

  interface Window {
    // === Your existing debug surface ===
    debugDayPage?: {
      fastSchedule: string;
      fastStartHHMM: string;
      timeBlocks: DebugTimeBlock[];
      refreshFastingData: () => Promise<void>;
    };

    // === Auth mirror (single source of truth) ===
    // Minimal, stable shape so native/web can read it.
    __AUTH?: {
      user: { id: string | null; email: string | null } | null;
    };

    // Legacy fallbacks (optional)
    __APP_USER?: { id: string | null } | null;
    __USER?: { id: string | null } | null;

    // === Dev SQLite helpers (dbp) ===
    dbp?: {
      printOverview: () => Promise<void>;
      repairDay: (dateStr: string) => Promise<number>;
      repairRange: (lastNDays?: number) => Promise<void>;
      findStuck: () => Promise<void>;
    };

    // Capacitor plugin typing (so no `any`)
    Capacitor?: {
      Plugins?: {
        CapacitorSQLite?: {
          query(args: {
            database: string;
            statement: string;
            values?: ReadonlyArray<string | number | null>;
          }): Promise<{ values?: Record<string, unknown>[] }>;
          run(args: {
            database: string;
            statement: string;
            values?: ReadonlyArray<string | number | null>;
          }): Promise<unknown>;
        };
      };
    };
  }
}

