import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import QuickTerminalApp from './QuickTerminalApp'
import './styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

const isQuickMode = new URLSearchParams(window.location.search).get('mode') === 'quick'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[renderer] uncaught:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#0a0a0b',
            color: '#f5f5f2',
            padding: '24px',
            fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace',
            overflow: 'auto'
          }}
        >
          <div style={{ color: '#ff4d5d', fontWeight: 600, marginBottom: 12 }}>
            renderer crashed
          </div>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#c5c5c0' }}>
            {this.state.error.message}
          </pre>
          {this.state.error.stack ? (
            <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#888884', marginTop: 8 }}>
              {this.state.error.stack}
            </pre>
          ) : null}
          <div style={{ marginTop: 16, color: '#54544f', fontSize: 11 }}>
            open devtools (Ctrl+Shift+I) for full stack ·{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: '#ff6b4d',
                color: '#fff',
                border: 0,
                padding: '4px 10px',
                fontFamily: 'inherit',
                fontSize: 11,
                cursor: 'pointer'
              }}
            >
              reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function PreloadCheck({ children }: { children: ReactNode }): ReactNode {
  if (typeof window === 'undefined' || !window.api) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#0a0a0b',
          color: '#f5f5f2',
          padding: '24px',
          fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ color: '#ff4d5d', fontWeight: 600, marginBottom: 8 }}>
            preload bridge not available
          </div>
          <div style={{ fontSize: 12, color: '#c5c5c0', lineHeight: 1.6 }}>
            window.api is undefined. The preload script either failed to load or
            never ran. Check the main process console for an error around{' '}
            <code style={{ background: '#17171a', padding: '0 4px' }}>
              webPreferences.preload
            </code>{' '}
            and confirm <code style={{ background: '#17171a', padding: '0 4px' }}>
              out/preload/index.js
            </code>{' '}
            exists.
          </div>
        </div>
      </div>
    )
  }
  return children
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <PreloadCheck>{isQuickMode ? <QuickTerminalApp /> : <App />}</PreloadCheck>
    </ErrorBoundary>
  </StrictMode>
)
