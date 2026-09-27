import { useEffect, useMemo, useRef, useState } from "react";
import type { Credit, Highlight, Player, RoomState } from "../../../shared/src/index";
import { useI18n } from "../i18n";
import { buildSummary, GAME_NAME_KEYS, shareSummary } from "../share";
import { Avatar } from "./Avatar";
import { IconShare } from "./icons";

/** A row of avatars for the people who voted for, wrote or picked something. */
export function CreditRow({ credits, label }: { credits: Credit[]; label: string }) {
  if (credits.length === 0) return null;
  const names = credits.map((credit) => credit.name).join(", ");
  return (
    <span className="credit-row" role="img" aria-label={label} title={names}>
      {credits.map((credit, index) => (
        <Avatar key={`${credit.name}-${index}`} id={credit.avatar} className="credit-avatar" />
      ))}
    </span>
  );
}

/** The standout answers of a finished game. */
export function Highlights({ highlights }: { highlights: Highlight[] | null }) {
  const { t } = useI18n();
  if (!highlights || highlights.length === 0) return null;
  return (
    <section className="highlights" aria-labelledby="highlights-title">
      <h2 id="highlights-title" className="highlights-title">
        {t("highlightsTitle")}
      </h2>
      <ol className="highlights-list">
        {highlights.map((highlight, index) => (
          <li key={index} className="highlight pop-in" style={{ animationDelay: `${index * 0.12}s` }}>
            <span className="highlight-prompt">{highlight.prompt}</span>
            <span className="highlight-text">“{highlight.text}”</span>
            <span className="highlight-meta">
              {highlight.authors.map((author) => author.name).join(", ")} ·{" "}
              {highlight.kind === "lie"
                ? t("bluffFoolCount", { n: highlight.votes })
                : t("highlightVotes", { n: highlight.votes })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Totals across every game this room has finished; shown from the second one. */
export function SessionStandings({
  players,
  gamesPlayed,
}: {
  players: Player[];
  gamesPlayed: number;
}) {
  const { t } = useI18n();
  const ranked = useMemo(
    () =>
      [...players].sort((a, b) => b.sessionScore - a.sessionScore || b.wins - a.wins),
    [players]
  );
  if (gamesPlayed < 2) return null;
  return (
    <section className="session-standings" aria-labelledby="session-title">
      <h2 id="session-title" className="highlights-title">
        {t("sessionStandings")} <small>· {t("gamesPlayed", { n: gamesPlayed })}</small>
      </h2>
      <ol className="session-list">
        {ranked.map((player) => (
          <li key={player.id} className="session-row">
            <span className="score-name">
              <Avatar id={player.avatar} /> {player.name}
            </span>
            <span className="session-wins">{t("winsCount", { n: player.wins })}</span>
            <span className="score-pts">{player.sessionScore}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Share a text recap of the game just finished. */
export function ShareButton({ state, className = "btn ghost" }: { state: RoomState; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const share = async () => {
    const game = state.gameType ? t(GAME_NAME_KEYS[state.gameType]) : "";
    const outcome = await shareSummary(
      t("shareTitle", { game }),
      buildSummary(state, t, window.location.origin)
    );
    if (outcome === "copied") {
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    }
  };

  return (
    <button type="button" className={`${className} share-btn`} onClick={() => void share()}>
      <IconShare /> {copied ? t("shareCopied") : t("shareResults")}
    </button>
  );
}
