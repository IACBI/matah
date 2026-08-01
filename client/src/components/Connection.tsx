import type { JSX } from "react";
import type { Link } from "../App";
import { useI18n } from "../i18n";
import type { TKey } from "../i18n/translations";
import { IconClose } from "./icons";

/**
 * The full-screen state for a cold start: the app has a stored session but has
 * not rendered a room yet, so there is nothing to layer an overlay over.
 */
export function RestoreScreen({
  link,
  notice,
  onRetry,
  onLeave,
}: {
  link: Link;
  notice?: TKey;
  onRetry: () => void;
  onLeave: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const stuck = link === "unreachable";
  return (
    <main className="screen center" aria-busy={!stuck}>
      <div className="restore-card">
        <div className={`badge ${stuck ? "error" : "warn"}`} role="status">
          {stuck ? t("serverUnreachable") : t("restoringSession")}
        </div>
        {notice ? <p className="restore-detail">{t(notice)}</p> : null}
        {stuck ? (
          <div className="restore-actions">
            <button type="button" className="btn primary" onClick={onRetry}>
              {t("retry")}
            </button>
            <button type="button" className="btn ghost" onClick={onLeave}>
              {t("leaveRoom")}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * An in-room problem worth interrupting for.
 *
 * Home renders its own notices; without this, a rejoin failure inside a room
 * set a message nothing was listening for, leaving the player on stale state
 * with no explanation and no way to retry.
 */
export function RoomNotice({
  notice,
  onRetry,
  onDismiss,
}: {
  notice: TKey;
  onRetry: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="room-notice" role="alert">
      <span>{t(notice)}</span>
      <button type="button" className="btn tiny" onClick={onRetry}>
        {t("retry")}
      </button>
      <button
        type="button"
        className="notice-close"
        onClick={onDismiss}
        aria-label={t("dismiss")}
      >
        <IconClose />
      </button>
    </div>
  );
}
