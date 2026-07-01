import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Top-level error boundary — never show a blank white screen. If any render
// throws (including on mobile Safari, which we can't always reproduce), show
// the actual error so it can be reported instead of failing silently.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info)
  }
  render() {
    if (this.state.error) {
      const msg = (this.state.error && (this.state.error.stack || this.state.error.message)) || String(this.state.error)
      return (
        <div style={{ minHeight: '100vh', background: '#F8FAFC', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: 520, margin: '40px auto', background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 8px 30px rgba(15,23,42,0.1)' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#2563EB', letterSpacing: '-0.04em' }}>SNAP</div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', margin: '16px 0 8px' }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, margin: '0 0 16px' }}>
              The page hit an error while loading. Please try reloading, or send this detail to your coordinator:
            </p>
            <pre style={{ fontSize: 11, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 16, padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
