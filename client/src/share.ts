import type { GameType, RoomState } from "../../shared/src/index";
import type { TKey } from "./i18n/translations";

type Translate = (key: TKey, params?: Record<string, string | number>) => string;

export const GAME_NAME_KEYS: Record<GameType, TKey> = {
  quiplash: "gameQuiplash",
  trivia: "gameTrivia",
  bluff: "gameBluff",
};

const MEDALS = ["🥇", "🥈", "🥉"];
const SHARED_HIGHLIGHTS = 2;

/** A plain-text recap of a finished game, for a share sheet or the clipboard. */
export function buildSummary(state: RoomState, t: Translate, origin: string): string {
  const game = state.gameType ? t(GAME_NAME_KEYS[state.gameType]) : "";
  const lines = [t("shareTitle", { game })];
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  ranked.forEach((player, index) => {
    lines.push(`${MEDALS[index] ?? `${index + 1}.`} ${player.name} — ${player.score}`);
  });
  const highlights = (state.highlights ?? []).slice(0, SHARED_HIGHLIGHTS);
  if (highlights.length > 0) lines.push("");
  for (const highlight of highlights) {
    const authors = highlight.authors.map((author) => author.name).join(", ");
    lines.push(`“${highlight.text}” — ${authors}`);
  }
  lines.push("", t("shareInvite", { url: origin }));
  return lines.join("\n");
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/**
 * Hand the recap to the platform share sheet where there is one (phones), and
 * fall back to the clipboard everywhere else.
 */
export async function shareSummary(title: string, text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (error) {
      // Closing the sheet is a choice, not a failure to paper over.
      if ((error as { name?: string } | null)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
