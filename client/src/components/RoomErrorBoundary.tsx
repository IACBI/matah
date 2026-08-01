import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../i18n";

interface Props {
  code: string;
  onLeave: () => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

function Fallback({ code, onLeave }: { code: string; onLeave: () => void }) {
  const { t } = useI18n();
  return (
    <main className="screen center">
      <div className="restore-card" role="alert">
        <div className="badge error">{t("renderFailed")}</div>
        {/* Keep the code visible: the fastest recovery is rejoining the room
            that is still running on everyone else's screen. */}
        <p className="restore-detail">
          {t("roomLabel")}: <strong className="code">{code}</strong>
        </p>
        <div className="restore-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => window.location.reload()}
          >
            {t("retry")}
          </button>
          <button type="button" className="btn ghost" onClick={onLeave}>
            {t("leaveRoom")}
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Stops a render error from leaving a blank TV mid-party.
 *
 * The room screens read deeply into optional server state; a shape they do not
 * expect should cost one recoverable screen, not the whole game.
 */
export class RoomErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("room screen crashed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <Fallback code={this.props.code} onLeave={this.props.onLeave} />;
  }
}
