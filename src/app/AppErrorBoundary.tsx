import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps one failing subtree from taking the whole application with it.
 *
 * R3F's `<Canvas>` can throw when WebGL is unavailable because of GPU, driver,
 * or browser settings. Reporting that failure keeps the page from becoming blank.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[zatom] uncaught error:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const webgl = /webgl|context|canvas/i.test(`${error.message} ${error.name}`)
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32, background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'ui-monospace, monospace',
      }}>
        <div style={{ maxWidth: 760 }}>
          <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>zatom stopped</h1>
          {webgl && (
            <p style={{ color: 'var(--status-amber)', margin: '0 0 12px', lineHeight: 1.6 }}>
              This looks like a WebGL failure. The 3D viewport needs it — check that
              hardware acceleration is enabled in the browser, and that the machine has a
              working GPU driver.
            </p>
          )}
          <pre style={{
            whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: 'var(--status-red)', margin: 0,
          }}>{error.stack || String(error)}</pre>
        </div>
      </div>
    )
  }
}
