// src/types/app-config.d.ts
export {};

declare global {
  interface AppConfig {
    API_BASE?: string;
    SENTRY_DSN?: string;
    SENTRY_ENV?: string;
    SENTRY_RELEASE?: string;
    SENTRY_DIST?: string;
    SENTRY_ENABLE_REPLAYS?: '0' | '1' | boolean; // optional
  }

  interface Window {
    __APP_CONFIG__?: AppConfig;
  }
}
