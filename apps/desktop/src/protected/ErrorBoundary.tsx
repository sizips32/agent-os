import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Root error boundary. A render exception must not leave a blank window: the main process may
 * still own a running request, so the fallback says not to resend and offers a remount.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Intentionally not logged or stored: error text can carry request content.
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="agent-error" style={{ margin: 32 }}>
        <span>
          화면을 표시하지 못했습니다. 실행 중이던 요청은 계속될 수 있으니 같은 요청을 다시 보내지 말고, 다시 불러온 뒤
          활동 기록이나 기존 Hermes 세션에서 결과를 확인하세요.
        </span>
        <button onClick={() => this.setState({ failed: false })}>다시 불러오기</button>
      </div>
    )
  }
}
