import React, { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <section className="banner bad" role="alert" style={{ margin: "24px 0", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: "2px" }} />
            <div style={{ flex: 1 }}>
              <strong style={{ display: "block", marginBottom: "6px", fontSize: "15px" }}>
                {this.props.fallbackTitle ?? "页面渲染出错 (Render Error)"}
              </strong>
              <p style={{ margin: "0 0 12px 0", fontSize: "13px", opacity: 0.9 }}>
                {this.state.error?.message || "发生了未预期的错误"}
              </p>
              <button
                type="button"
                className="action secondary"
                onClick={this.handleRetry}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <RotateCcw size={14} />
                <span>重试 / Retry</span>
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
