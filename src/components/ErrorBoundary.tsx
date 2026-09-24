// A render error used to unmount the whole tree and leave a black screen, which is the worst
// possible failure in front of an audience: no message, no recovery, no clue what broke.
// This keeps the app standing, names the error, and lets the page be retried.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept deliberately: during a live demo the console is the only forensic trail we have.
    console.error('Render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center bg-solstice-cream p-6">
        <div className="panel max-w-lg p-6">
          <h1 className="font-display text-2xl text-solstice-ink">Something broke on this screen</h1>
          <p className="mt-2 text-sm text-solstice-slate">
            The rest of the application is still running. This is the error, verbatim:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-solstice-sand/40 p-3 text-xs text-solstice-ink">
            {error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <a href="/admin" className="btn-ghost">
              Back to admin
            </a>
          </div>
        </div>
      </div>
    )
  }
}
