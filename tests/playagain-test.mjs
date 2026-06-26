// Test: finish a game, host hits "Play Again", room returns to lobby with the
// same players (scores reset), and a new game can start. Also checks that a
// non-host player is NOT allowed to restart.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const log = (...a) => console.log(...a);
const conn = () => io(URL, { transports: ["websocket"], forceNew: true });
const ack = (s, e, ...a) => new Promise((r) => s.emit(e, ...a, (x) => r(x)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const host = conn();
const ps = [conn(), conn(), conn()];
const names = ["Ada", "Bora", "Can"];
const ids = [];
let st = null;
host.on("room:state", (s) => (st = s));

await new Promise((r) => host.on("connect", r));
await Promise.all(ps.map((p) => new Promise((r) => p.on("connect", r))));

const code = (await ack(host, "room:create", { language: "en" })).data.code;
for (const [i, p] of ps.entries())
  ids[i] = (await ack(p, "room:join", { code, name: names[i] })).data.playerId;
await wait(200);

// Play a quick trivia game to completion.
await ack(host, "game:start", { gameType: "trivia" });
await wait(300);
const answered = new Set();
let safety = 80;
while (st.phase !== "scoreboard" && st.phase !== "gameover" && safety-- > 0) {
  if (st.phase === "answering" && st.trivia?.question && !answered.has(st.trivia.question.id)) {
    answered.add(st.trivia.question.id);
    for (const [i, p] of ps.entries())
      await ack(p, "trivia:answer", { questionId: st.trivia.question.id, optionIndex: i % 4 });
  } else if (st.phase === "results") {
    await ack(host, "game:next");
  }
  await wait(150);
}
log("✓ İlk oyun bitti, faz:", st.phase);
const someScore = st.players.some((p) => p.score > 0);
log("  skorlar oluştu mu:", someScore);

// A non-host player must NOT be able to restart.
const bad = await ack(ps[0], "game:restart");
log(bad.ok ? "✗ oyuncu restart edebildi (HATA)" : "✓ oyuncu restart engellendi: " + bad.error);

// Host restarts -> back to lobby, same players, scores reset.
const good = await ack(host, "game:restart");
await wait(300);
const backToLobby = st.phase === "lobby";
const samePlayers = st.players.length === 3 && ids.every((id) => st.players.some((p) => p.id === id));
const scoresReset = st.players.every((p) => p.score === 0);
log("✓ host restart:", good.ok);
log("  lobiye döndü:", backToLobby, "| aynı oyuncular:", samePlayers, "| skorlar sıfır:", scoresReset);

// A fresh game can start again.
const restart = await ack(host, "game:start", { gameType: "quiplash" });
await wait(300);
const restarted = restart.ok && st.phase === "answering";
log("✓ yeni oyun başladı:", restarted, "| faz:", st.phase);

const pass = someScore && !bad.ok && good.ok && backToLobby && samePlayers && scoresReset && restarted;
log("\n" + (pass ? "✅ TEKRAR OYNA TESTİ GEÇTİ" : "❌ TEKRAR OYNA TESTİ BAŞARISIZ"));
[host, ...ps].forEach((s) => s.close());
process.exit(pass ? 0 : 1);
