import { useState } from "react";
import {
  AVATARS,
  MAX_NAME_LEN,
  ROOM_CODE_LENGTH,
  type SessionResult,
} from "../../../shared/src/index";
import { emitAck } from "../socket";
import type { Role } from "../App";
import { useI18n } from "../i18n";
import { errorKey, type TKey } from "../i18n/translations";
import { TopBar } from "../components/Controls";
import { Avatar } from "../components/Avatar";
import { IconClose } from "../components/icons";
import { playSfx } from "../sound";

interface Props {
  connected: boolean;
  onEnter: (role: Exclude<Role, "home">, session: SessionResult) => void;
  /** A translation key for a one-off notice (e.g. after being kicked). */
  notice?: TKey;
  onDismissNotice?: () => void;
}

/** A ?code=XXXX in the URL (e.g. from the host-screen QR) prefills the join form. */
function codeFromUrl(): string {
  const raw = new URLSearchParams(window.location.search).get("code") ?? "";
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function Home({ connected, onEnter, notice, onDismissNotice }: Props) {
  const { t, lang } = useI18n();
  const initialCode = codeFromUrl();
  const [mode, setMode] = useState<"choose" | "join">(
    initialCode ? "join" : "choose"
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [avatar, setAvatar] = useState<string>(
    () => AVATARS[Math.floor(Math.random() * AVATARS.length)]
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const hostGame = async () => {
    setBusy(true);
    setError("");
    playSfx("click");
    const res = await emitAck<SessionResult>("room:create", { language: lang });
    setBusy(false);
    if (res.ok) onEnter("host", res.data);
    else setError(t(errorKey(res.error)));
  };

  const joinGame = async () => {
    if (!name.trim() || code.trim().length < 4) {
      setError(t("needNameCode"));
      return;
    }
    setBusy(true);
    setError("");
    playSfx("click");
    const res = await emitAck<SessionResult>("room:join", {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      avatar,
    });
    setBusy(false);
    if (res.ok) {
      playSfx("join");
      onEnter("player", res.data);
    } else setError(t(errorKey(res.error)));
  };

  return (
    <main className="screen home fade-in">
      <TopBar />
      <div className="logo">
        <span className="logo-q">M</span>atah
      </div>
      <p className="tagline">{t("tagline")}</p>

      {!connected && (
        <div className="badge warn" role="status">
          {t("connecting")}
        </div>
      )}

      {notice && (
        <div className="badge warn notice" role="status">
          <span>{t(notice)}</span>
          <button
            className="notice-close"
            onClick={onDismissNotice}
            aria-label={t("dismiss")}
          >
            <IconClose />
          </button>
        </div>
      )}

      {mode === "choose" ? (
        <div className="card stack pop-in">
          <button
            className="btn primary big"
            onClick={hostGame}
            disabled={busy || !connected}
          >
            {t("hostNew")}
            <small>{t("hostNewSub")}</small>
          </button>
          <button
            className="btn ghost big"
            onClick={() => {
              setMode("join");
              playSfx("click");
            }}
            disabled={busy}
          >
            {t("join")}
            <small>{t("joinSub")}</small>
          </button>
        </div>
      ) : (
        <form
          className="card stack pop-in"
          onSubmit={(event) => {
            event.preventDefault();
            void joinGame();
          }}
          aria-busy={busy}
        >
          <label className="field-label" htmlFor="player-name">
            {t("yourName")}
          </label>
          <input
            id="player-name"
            name="name"
            className="input"
            placeholder={t("yourName")}
            value={name}
            maxLength={MAX_NAME_LEN}
            autoComplete="nickname"
            enterKeyHint="next"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label" htmlFor="room-code">
            {t("roomCode")}
          </label>
          <input
            id="room-code"
            name="roomCode"
            className="input code-input"
            placeholder={t("roomCode")}
            value={code}
            maxLength={ROOM_CODE_LENGTH}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, "")
                  .slice(0, ROOM_CODE_LENGTH)
              )
            }
          />
          <fieldset className="avatar-picker">
            <legend className="avatar-label">{t("chooseAvatar")}</legend>
            <div className="avatar-grid">
              {AVATARS.map((option, index) => (
                <label
                  key={option}
                  className={`avatar-opt ${option === avatar ? "active" : ""}`}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="avatar"
                    value={option}
                    checked={option === avatar}
                    aria-label={`${t("chooseAvatar")} ${index + 1}`}
                    onChange={() => {
                      setAvatar(option);
                      playSfx("click");
                    }}
                  />
                  <Avatar id={option} />
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            className="btn primary big"
            disabled={busy || !connected}
          >
            {t("joinBtn")}{busy ? "…" : ""}
          </button>
          <button
            type="button"
            className="btn link"
            onClick={() => {
              setMode("choose");
              setError("");
            }}
          >
            {t("back")}
          </button>
        </form>
      )}

      {error && (
        <div className="badge error shake" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
