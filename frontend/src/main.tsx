import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Top-level safety net: if anything throws outside of the Canvas error
// boundary, show a recoverable screen instead of silently white-screening.
class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          backgroundColor: '#081019',
          color: '#9CA3AF',
          fontFamily: 'sans-serif',
          textAlign: 'center',
          padding: '2rem',
          boxSizing: 'border-box',
        }}>
          <span style={{ fontSize: '2.5rem' }}>⚠️</span>
          <strong style={{ color: '#F87171', fontSize: '1.1rem' }}>
            The dashboard hit an unexpected error.
          </strong>
          <span style={{ fontSize: '0.85rem', maxWidth: '460px', lineHeight: 1.5 }}>
            Reload the page to restart the application. If this keeps happening,
            check that the backend server is running and that your browser
            has hardware acceleration enabled.
          </span>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '0.5rem',
              padding: '8px 18px',
              borderRadius: '6px',
              cursor: 'pointer',
              border: '1px solid #4B5563',
              color: '#081019',
              background: '#60A5FA',
              fontSize: '0.8rem',
            }}
          >
            Reload application
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
)
