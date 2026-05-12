import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  countdown: number
}

const AUTO_RELOAD_SECONDS = 3

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, countdown: AUTO_RELOAD_SECONDS }
  private timer?: ReturnType<typeof setInterval>

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, countdown: AUTO_RELOAD_SECONDS }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.timer = setInterval(() => {
      this.setState(s => {
        if (s.countdown <= 1) {
          window.location.reload()
          return s
        }
        return { ...s, countdown: s.countdown - 1 }
      })
    }, 1000)
  }

  componentWillUnmount() {
    if (this.timer) clearInterval(this.timer)
  }

  handleReloadNow = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <div className="max-w-sm w-full bg-white border border-neutral-100 rounded-lg shadow-sm p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-50 mx-auto mb-3 flex items-center justify-center text-amber-600 text-lg">!</div>
          <h2 className="font-serif text-base font-medium text-neutral-800 mb-1">Mất kết nối tạm thời</h2>
          <p className="text-xs text-neutral-500 mb-4">
            Trang sẽ tự tải lại trong <span className="font-semibold text-primary-700">{this.state.countdown}</span>s…
          </p>
          <button
            onClick={this.handleReloadNow}
            className="w-full bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium py-2 rounded transition-colors"
          >
            Tải lại ngay
          </button>
        </div>
      </div>
    )
  }
}
