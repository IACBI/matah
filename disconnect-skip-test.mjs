// Validates that a disconnected player does not stall a round.
// With three players, one drops mid-answering; once the two still-connected
// players answer, the phase must advance immediately instead of waiting out
// the full answer timer.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const conn = () => io(URL, { transports: ["websocket"], forceNew: true });
const ack = (s, e, ...a) => new Promise((r) => s.emit(e, ...a, (x) => r(x)));

function until(getState, pred, ms = 10000, label = "condition") {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const s = getState();
      if (s && pred(s)) {
        clearInterval(iv);
        resolve(s);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error(`timeout waiting for ${label} (phase=${s?.phase})`));
      }
    }, 40);
  });
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function main() {
  const host = conn();
  const players = [conn(), conn(), conn()];
  const names = ["Ali", "Veli", "Ayşe"];
  const ids = [];
  let st = null;
  const assignments = {};
  host.on("room:state", (s) => (st = s));
  players.forEach((p, i) =>
    p.on("player:assignment", (a) => (assignments[ids[i]] = a))
  );

  await new Promise((r) => host.on("connect", r));
  await Promise.all(players.map((p) => new Promise((r) => p.on("connect", r))));

  const code = (await ack(host, "room:create", { language: "en" })).data.code;
  for (const [i, p] of players.entries())
    ids[i] = (await ack(p, "room:join", { code, name: names[i] })).data.playerId;
  await until(() => st, (s) => s.players.length === 3, 8000, "3 players");
  console.log("✓ Oda kuruldu, 3 oyuncu katıldı:", code);

  await ack(host, "game:start", { gameType: "quiplash" });
  await until(() => st, (s) => s.phase === "answering", 8000, "answering");
  await until(() => st, () => ids.every((id) => assignments[id]), 8000, "assignments");
  console.log("✓ Oyun başladı, atamalar geldi");

  // Player 3 drops and stays gone (client-initiated, so no auto-reconnect).
  players[2].disconnect();
  await until(
    () => st,
    (s) => s.players.find((p) => p.id === ids[2])?.connected === false,
    8000,
    "player 3 offline"
  );
  console.log("✓ 3. oyuncu koptu (connected=false)");

  // The two connected players answer everything assigned to them.
  const submitted = new Set();
  const t0 = Date.now();
  for (const i of [0, 1]) {
    for (const pr of assignments[ids[i]].prompts) {
      const key = `${ids[i]}:${pr.matchupId}`;
      if (!submitted.has(key)) {
        submitted.add(key);
        await ack(players[i], "answer:submit", {
          matchupId: pr.matchupId,
          text: `${i}-${Math.random().toString(36).slice(2, 6)}`,
        });
      }
    }
  }

  // Must leave "answering" promptly — far under the 60s answer timer. If the
  // disconnected player still stalled the round, this would time out.
  await until(() => st, (s) => s.phase !== "answering", 8000, "advance after connected answers");
  const elapsed = Date.now() - t0;
  assert(elapsed < 8000, `advanced too slowly: ${elapsed}ms`);
  console.log(`✓ Kopuk oyuncu turu bekletmedi — ${elapsed}ms içinde ilerledi (faz: ${st.phase})`);

  console.log("\n✅ KOPUK OYUNCU ATLAMA TESTİ GEÇTİ");
  [host, ...players].forEach((s) => s.close());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log("\n❌ HATA:", e.message);
    process.exit(1);
  });
