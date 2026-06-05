import { useState } from "react";
import { emitAck } from "../socket";
import type { Role } from "../App";
import { useI18n } from "../i18n";
import { errorKey } from "../i18n/translations";
import { TopBar } from "../components/Controls";
import { playSfx } from "../sound";

interface Props {
  connected: boolean;
  onEnter: (role: Role, code: string, playerId: string) => void;
}

export function Home({ connected, onEnter }: Props) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"choose" | "join">("choose");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
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
    const res = await emitAck<{ code: string; playerId: string }>("room:join", {
      code: code.trim().toUpperCase(),
      name: name.trim(),
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
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
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
