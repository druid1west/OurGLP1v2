// Capture uncaught JS errors + unhandled promise rejections early in boot
import { logger, setLogLevel } from '../utils/logger';

(function initGlobalErrorHandlers(): void {
  // Ensure log level is sane (dev=debug, prod=warn) unless overridden
  setLogLevel(import.meta.env.DEV ? 'debug' : 'warn');

  // Helpful context (shows once in logs)
  logger.info('[GLOBAL] Error handlers armed', {
    env: {
      mode: import.meta.env.MODE,
      dev: import.meta.env.DEV,
      prod: import.meta.env.PROD,
    },
    agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  });

  // All uncaught synchronous errors (render, eval, 3rd-party)
  window.addEventListener('error', (ev: ErrorEvent) => {
    logger.error('[GLOBAL] Uncaught error', {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      stack: ev.error instanceof Error ? ev.error.stack : undefined,
    });
  });

  // All unhandled promise rejections (async/await that throw)
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r = ev.reason;
    logger.error('[GLOBAL] Unhandled promise rejection', {
      name: r instanceof Error ? r.name : undefined,
      message: r instanceof Error ? r.message : String(r),
      stack: r instanceof Error ? r.stack : undefined,
      // Anything else the lib put on the object:
      details: r && typeof r === 'object' ? r : undefined,
    });
  });
})();
