// End-to-end smoke test of both game modes against the running server.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const log = (...a) => console.log(...a);
const conn = () => io(URL, { transports: ["websocket"] });
const ack = (sock, ev, ...args) =>
  new Promise((res) => sock.emit(ev, ...args, (r) => res(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function playQuiplash() {
  log("\n=== QUIPLASH ===");
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

  const code = (await ack(host, "room:create", { language: "tr" })).data.code;
  log("✓ Oda:", code);
  for (let i = 0; i < players.length; i++) {
    const r = await ack(players[i], "room:join", { code, name: names[i] });
    ids[i] = r.data.playerId;
  }
  await wait(200);

  const started = await ack(host, "game:start", { gameType: "quiplash" });
  if (!started.ok) throw new Error("start: " + started.error);
  await wait(300);

  let safety = 80;
  while (st.phase !== "scoreboard" && st.phase !== "gameover" && safety-- > 0) {
    if (st.phase === "answering") {
      for (let i = 0; i < players.length; i++) {
        for (const pr of assignments[ids[i]]?.prompts ?? []) {
          await ack(players[i], "answer:submit", {
            matchupId: pr.matchupId,
            text: `${names[i]}: ${Math.random().toString(36).slice(2, 6)}`,
          });
        }
      }
    } else if (st.phase === "voting") {
      const m = st.quiplash?.activeMatchup;
      if (m) {
        const authors = m.answers.map((a) => a.playerId);
        for (let i = 0; i < players.length; i++) {
          if (!authors.includes(ids[i])) {
            await ack(players[i], "vote:submit", {
              matchupId: m.id,
              answerPlayerId: m.answers[0].playerId,
            });
          }
        }
      }
    } else if (st.phase === "results") {
      await ack(host, "game:next");
    }
    await wait(200);
  }
  const ok = st.phase === "scoreboard" || st.phase === "gameover";
  log(ok ? "✅ Quiplash bitti" : "❌ Quiplash takıldı @ " + st.phase);
  [...st.players]
    .sort((a, b) => b.score - a.score)
    .forEach((p, i) => log(`   ${i + 1}. ${p.name}: ${p.score}`));
  host.close();
  players.forEach((p) => p.close());
  return ok;
}

async function playTrivia() {
  log("\n=== TRIVIA ===");
  const host = conn();
  const players = [conn(), conn(), conn()];
  const names = ["Mehmet", "Zeynep", "Can"];
  const ids = [];
  let st = null;

  host.on("room:state", (s) => (st = s));
  await new Promise((r) => host.on("connect", r));
  await Promise.all(players.map((p) => new Promise((r) => p.on("connect", r))));

  const code = (await ack(host, "room:create", { language: "en" })).data.code;
  log("✓ Oda:", code);
  for (let i = 0; i < players.length; i++) {
    const r = await ack(players[i], "room:join", { code, name: names[i] });
    ids[i] = r.data.playerId;
  }
  await wait(200);
  const started = await ack(host, "game:start", { gameType: "trivia" });
  if (!started.ok) throw new Error("start: " + started.error);
  await wait(300);

  let safety = 120;
  const answeredFor = new Set();
  while (st.phase !== "scoreboard" && st.phase !== "gameover" && safety-- > 0) {
    if (st.phase === "answering" && st.trivia?.question) {
      const q = st.trivia.question;
      if (!answeredFor.has(q.id)) {
        answeredFor.add(q.id);
        for (let i = 0; i < players.length; i++) {
          await ack(players[i], "trivia:answer", {
            questionId: q.id,
            optionIndex: i % q.options.length, // mix of right/wrong
          });
        }
      }
    } else if (st.phase === "results") {
      await ack(host, "game:next"); // skip the 7s reveal timer
    }
    await wait(200);
  }
  const ok = st.phase === "scoreboard" || st.phase === "gameover";
  log(ok ? "✅ Trivia bitti" : "❌ Trivia takıldı @ " + st.phase);
  [...st.players]
    .sort((a, b) => b.score - a.score)
    .forEach((p, i) => log(`   ${i + 1}. ${p.name}: ${p.score}`));
  host.close();
  players.forEach((p) => p.close());
  return ok;
}

const q = await playQuiplash();
const tr = await playTrivia();
log(`\n${q && tr ? "✅ TÜM TESTLER GEÇTİ" : "❌ BAZI TESTLER BAŞARISIZ"}`);
process.exit(q && tr ? 0 : 1);
