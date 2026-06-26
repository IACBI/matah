import { useState } from "react";
import { AVATARS, ROOM_CODE_LENGTH } from "../../../shared/src/index";
import { emitAck } from "../socket";
import type { Role } from "../App";
import { useI18n } from "../i18n";
import { errorKey, type TKey } from "../i18n/translations";
import { TopBar } from "../components/Controls";
import { playSfx } from "../sound";

interface Props {
  connected: boolean;
  onEnter: (role: Role, code: string, playerId: string) => void;
  /** A translation key for a one-off notice (e.g. after being kicked). */
  notice?: string;
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
    const res = await emitAck<{ code: string; playerId: string }>(
      "room:create",
      { language: lang }
    );
    setBusy(false);
    if (res.ok && res.data) onEnter("host", res.data.code, res.data.playerId);
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
    const res = await emitAck<{
      code: string;
      playerId: string;
      isAudience: boolean;
    }>("room:join", {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      avatar,
    });
    setBusy(false);
    if (res.ok && res.data) {
      playSfx("join");
      onEnter("player", res.data.code, res.data.playerId);
    } else setError(t(errorKey(res.error)));
  };

  return (
    <div className="screen home fade-in">
      <TopBar />
      <div className="logo">
        <span className="logo-q">Q</span>uibble
      </div>
      <p className="tagline">{t("tagline")}</p>

      {!connected && <div className="badge warn">{t("connecting")}</div>}

      {notice && (
        <button
          className="badge warn notice"
          role="status"
          onClick={onDismissNotice}
        >
          {t(notice as TKey)} ✕
        </button>
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
        <div className="card stack pop-in">
          <input
            className="input"
            placeholder={t("yourName")}
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input code-input"
            placeholder={t("roomCode")}
            value={code}
            maxLength={4}
            inputMode="text"
            autoCapitalize="characters"
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, "")
                  .slice(0, ROOM_CODE_LENGTH)
              )
            }
          />
          <div className="avatar-picker">
            <span className="avatar-label">{t("chooseAvatar")}</span>
            <div className="avatar-grid" role="radiogroup" aria-label={t("chooseAvatar")}>
              {AVATARS.map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={a === avatar}
                  className={`avatar-opt ${a === avatar ? "active" : ""}`}
                  onClick={() => {
                    setAvatar(a);
                    playSfx("click");
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn primary big"
            onClick={joinGame}
            disabled={busy || !connected}
          >
            {t("joinBtn")}
          </button>
          <button className="btn link" onClick={() => setMode("choose")}>
            {t("back")}
          </button>
        </div>
      )}

      {error && <div className="badge error shake">{error}</div>}
    </div>
  );
}
