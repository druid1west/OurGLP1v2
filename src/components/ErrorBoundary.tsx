// src/components/ErrorBoundary.tsx
import React from 'react';
import { captureException } from '../telemetry/sentry';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: Error };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    const err = error instanceof Error ? error : new Error(String(error));
    return { hasError: true, error: err };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
  // Report to Sentry (make sure initSentry runs in App.tsx)
  try {
    captureException(error, { extra: { componentStack: info.componentStack } });
  } catch (e) {
    // Only warn in dev; avoids "empty block" and keeps prod quiet
    if (import.meta.env.DEV) {
     
      console.warn('[ErrorBoundary] captureException failed', e);
    }
  }

  // Keep a console breadcrumb in dev
 
  console.error('[ErrorBoundary]', error, info);
}

handleReload = () => {
  // Hard reload to recover from bad state
  location.reload();
};

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, maxWidth: 640, margin: '8vh auto', fontFamily: 'system-ui' }}>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#555', marginBottom: 16 }}>
            Sorry about that. You can try reloading the app.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #0d9488',
              background: '#0d9488',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Reload app
          </button>

          {/* Optional: show details in dev builds */}
          {import.meta.env.DEV && this.state.error && (
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16, color: '#a00' }}>
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
