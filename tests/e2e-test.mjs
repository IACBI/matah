// End-to-end smoke test of both game modes.
// Event-driven: instead of fixed sleeps, it waits for specific room-state
// conditions, which makes it deterministic and resilient to latency.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const log = (...a) => console.log(...a);
const conn = () => io(URL, { transports: ["websocket"], forceNew: true });
const ack = (s, e, ...a) => new Promise((r) => s.emit(e, ...a, (x) => r(x)));

/** Resolves once `pred(state)` is true, or rejects after `ms`. */
function until(getState, pred, ms = 15000, label = "condition") {
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

const DONE = ["scoreboard", "gameover"];

async function setup(language) {
  const host = conn();
  const ps = [conn(), conn(), conn()];
  const names = ["Ali", "Veli", "Ayşe"];
  const ids = [];
  let st = null;
  const assignments = {};
  host.on("room:state", (s) => (st = s));
  ps.forEach((p, i) => p.on("player:assignment", (a) => (assignments[ids[i]] = a)));

  await new Promise((r) => (host.connected ? r() : host.once("connect", r)));
  await Promise.all(
    ps.map((p) => new Promise((r) => (p.connected ? r() : p.once("connect", r))))
  );
  const code = (await ack(host, "room:create", { language })).data.code;
  for (const [i, p] of ps.entries())
    ids[i] = (await ack(p, "room:join", { code, name: names[i] })).data.playerId;
  await until(() => st, (s) => s.players.length === 3, 8000, "3 players");
  return { host, ps, ids, code, get: () => st, assignments };
}

async function playQuiplash() {
  log("\n=== QUIPLASH ===");
  const { host, ps, ids, code, get, assignments } = await setup("tr");
  log("✓ Oda:", code);
  await ack(host, "game:start", { gameType: "quiplash" });
  await until(get, (s) => s.phase !== "lobby", 8000, "game start");

  // Dedup per (player, matchup): every matchup has two authors, and both must
  // answer or the matchup gets skipped at voting time (needs 2 answers).
  const submitted = new Set();
  while (!DONE.includes(get().phase)) {
    const phase = get().phase;
    if (phase === "answering") {
      await until(get, () => ids.every((id) => assignments[id]), 8000, "assignments");
      for (const [i, p] of ps.entries())
        for (const pr of assignments[ids[i]].prompts) {
          const key = `${ids[i]}:${pr.matchupId}`;
          if (!submitted.has(key)) {
            submitted.add(key);
            await ack(p, "answer:submit", { matchupId: pr.matchupId, text: `${i}-${Math.random().toString(36).slice(2, 6)}` });
          }
        }
      await until(get, (s) => s.phase !== "answering", 70000, "leave answering");
    } else if (phase === "voting") {
      const m = get().quiplash.activeMatchup;
      const authors = m.answers.map((a) => a.playerId);
      for (const [i, p] of ps.entries())
        if (!authors.includes(ids[i]))
          await ack(p, "vote:submit", { matchupId: m.id, answerPlayerId: m.answers[0].playerId });
      await until(get, (s) => s.phase !== "voting" || s.quiplash?.activeMatchup?.id !== m.id, 30000, "next matchup");
    } else if (phase === "results") {
      await ack(host, "game:next");
      await until(get, (s) => s.phase !== "results", 15000, "leave results");
    } else {
      await new Promise((r) => setTimeout(r, 40)); // yield on transient phases
    }
  }
  const st = get();
  log("✅ Quiplash bitti, faz:", st.phase);
  [...st.players].sort((a, b) => b.score - a.score).forEach((p, i) => log(`   ${i + 1}. ${p.name}: ${p.score}`));
  [host, ...ps].forEach((s) => s.close());
  return DONE.includes(st.phase);
}

async function playTrivia() {
  log("\n=== TRIVIA ===");
  const { host, ps, ids, code, get } = await setup("en");
  log("✓ Oda:", code);
  await ack(host, "game:start", { gameType: "trivia" });
  await until(get, (s) => s.phase !== "lobby", 8000, "game start");

  const answered = new Set();
  while (!DONE.includes(get().phase)) {
    const phase = get().phase;
    if (phase === "answering") {
      const q = get().trivia.question;
      if (q && !answered.has(q.id)) {
        answered.add(q.id);
        for (const [i, p] of ps.entries())
          await ack(p, "trivia:answer", { questionId: q.id, optionIndex: i % q.options.length });
      }
      await until(get, (s) => s.phase !== "answering", 25000, "leave question");
    } else if (phase === "results") {
      await ack(host, "game:next");
      await until(get, (s) => s.phase !== "results", 15000, "leave results");
    } else {
      await new Promise((r) => setTimeout(r, 40)); // yield on transient phases
    }
  }
  const st = get();
  log("✅ Trivia bitti, faz:", st.phase);
  [...st.players].sort((a, b) => b.score - a.score).forEach((p, i) => log(`   ${i + 1}. ${p.name}: ${p.score}`));
  [host, ...ps].forEach((s) => s.close());
  return DONE.includes(st.phase);
}

try {
  const q = await playQuiplash();
  const t = await playTrivia();
  log(`\n${q && t ? "✅ TÜM TESTLER GEÇTİ" : "❌ BAZI TESTLER BAŞARISIZ"}`);
  process.exit(q && t ? 0 : 1);
} catch (e) {
  log("\n❌ HATA:", e.message);
  process.exit(1);
}
