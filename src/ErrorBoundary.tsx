// src/ErrorBoundary.tsx
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { logger } from './utils/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
   // Minimal, PII-safe logging
    const firstStackLine =
      typeof error.stack === 'string'
        ? error.stack.split('\n').slice(0, 2).join(' | ')
        : undefined;
    const firstComponentLine =
      typeof errorInfo?.componentStack === 'string'
        ? errorInfo.componentStack.split('\n').filter(Boolean)[0]
        : undefined;

    logger.error('[ErrorBoundary]', {
      msg: error?.message ?? String(error),
      stack: firstStackLine,
      where: firstComponentLine,
    });

    // Optional: send to Sentry if present (keeps payload minimal)
    try {
      // Lazy import; tolerate module not exporting captureException
    
      import('@/telemetry/sentry').then((mod) => {
        type SentryLike = {
          captureException?: (e: unknown, ctx?: { extra?: Record<string, unknown> }) => void;
        };
        const s = mod as unknown as SentryLike;
        s.captureException?.(error, {
          extra: { where: firstComponentLine, stack_head: firstStackLine },
        });
      });
    } catch {
      /* ignore */
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
          <h2 style={{ margin: 0, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ marginTop: 0 }}>
            An unexpected error occurred. You can try reloading the app.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #d0d7de',
              background: '#f6f8fa',
              cursor: 'pointer'
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
export default ErrorBoundary;