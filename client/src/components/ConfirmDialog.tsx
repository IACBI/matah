import { useEffect, useRef, type JSX } from "react";
import { useI18n } from "../i18n";

/**
 * A styled confirmation, replacing window.confirm.
 *
 * The native dialog is unstyled on a TV, blocks the main thread while the
 * socket buffers, and can be suppressed entirely on iOS.
 */
export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      // Keep focus inside: the screen behind is inert but still tabbable.
      const focusable = panel.current.querySelectorAll<HTMLElement>("button");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    // Dismissal is Escape or the cancel button. A click-to-close backdrop
    // would need its own keyboard path to be usable, and both buttons are
    // already one tab away.
    <div className="confirm-backdrop">
      <div
        ref={panel}
        className="confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
      >
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button
            ref={confirmButton}
            type="button"
            className="btn primary"
            onClick={onConfirm}
          >
            {t("confirmYes")}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t("confirmNo")}
          </button>
        </div>
      </div>
    </div>
  );
}
