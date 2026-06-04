'use client'
import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Top-level error boundary for the Flogination dashboard.
 * Catches unhandled render errors in any child view and displays a recovery UI
 * instead of crashing the entire app.
 *
 * @example
 * <ErrorBoundary>
 *   {renderView()}
 * </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center flex-col gap-4 p-8">
          <span className="material-symbols-outlined text-[48px] text-error">error</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Something went wrong</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant text-center max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-container text-on-primary-container rounded font-body-sm"
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
