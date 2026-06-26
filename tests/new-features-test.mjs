// Smoke test for the new features: audience join, audience voting,
// safety answers, host takeover, trivia final-question double points,
// reactions, and disconnect fast-forward.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const log = (...a) => console.log(...a);
const conn = () => io(URL, { transports: ["websocket"], forceNew: true });
const ack = (s, e, ...a) => new Promise((r) => s.emit(e, ...a, (x) => r(x)));

function until(getState, pred, ms = 30000, label = "condition") {
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
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  log(`✓ ${msg}`);
};

async function setup() {
  const host = conn();
  const ps = [conn(), conn(), conn()];
  const names = ["Ali", "Veli", "Ayşe"];
  const ids = [];
  let st = null;
  const assignments = {};
  host.on("room:state", (s) => (st = s));
  ps.forEach((p, i) =>
    p.on("player:assignment", (a) => (assignments[ids[i]] = a))
  );
  await new Promise((r) => (host.connected ? r() : host.once("connect", r)));
  await Promise.all(
    ps.map((p) => new Promise((r) => (p.connected ? r() : p.once("connect", r))))
  );
  const code = (await ack(host, "room:create", { language: "tr" })).data.code;
  for (const [i, p] of ps.entries())
    ids[i] = (
      await ack(p, "room:join", { code, name: names[i], avatar: "fox" })
    ).data.playerId;
  await until(() => st, (s) => s.players.length === 3, 8000, "3 players");
  return { host, ps, ids, code, get: () => st, assignments };
}

async function testAudienceAndSafety() {
  log("\n=== AUDIENCE + SAFETY + REACTIONS (quiplash) ===");
  const { host, ps, ids, code, get, assignments } = await setup();

  assert(get().players.every((p) => p.avatar === "fox"), "avatars stored");
  assert(get().hostConnected === true, "hostConnected broadcast");

  await ack(host, "game:start", { gameType: "quiplash" });
  await until(get, (s) => s.phase === "answering", 8000, "answering");

  // Late joiner becomes audience.
  const aud = conn();
  await new Promise((r) => (aud.connected ? r() : aud.once("connect", r)));
  const audRes = await ack(aud, "room:join", { code, name: "Seyirci" });
  assert(audRes.ok && audRes.data.isAudience === true, "late join → audience");
  await until(get, (s) => s.audience.length === 1, 5000, "audience in state");
  assert(get().players.length === 3, "audience not among players");

  // Audience reaction is broadcast.
  let reaction = null;
  host.on("room:reaction", (r) => (reaction = r));
  const rRes = await ack(aud, "reaction:send", { emoji: "fire" });
  assert(rRes.ok, "reaction accepted");
  await until(() => reaction, (r) => r.emoji === "fire", 5000, "reaction broadcast");
  log("✓ reaction broadcast received");
  const badR = await ack(aud, "reaction:send", { emoji: "kaboom" });
  assert(!badR.ok, "unknown reaction emoji rejected");

  // Only player 0 answers; players 1-2 stay silent → safety answers on timeout.
  // Instead of waiting 60s, simulate: p1 and p2 disconnect → fast-forward.
  for (const p of assignments[ids[0]]?.prompts ?? []) {
    await ack(ps[0], "answer:submit", { matchupId: p.matchupId, text: "harika cevap" });
  }
  ps[1].disconnect();
  ps[2].disconnect();
  // Disconnect fast-forward: with only p0 connected and submitted, voting begins.
  await until(get, (s) => s.phase === "voting", 8000, "voting after disconnects");
  log("✓ disconnect fast-forward to voting (no 60s stall)");

  const m = get().quiplash.activeMatchup;
  assert(m && m.answers.length === 2, "safety answer filled missing slot");

  // Audience can vote.
  const target = m.answers.find((a) => a.playerId !== ids[0]) ?? m.answers[0];
  const vRes = await ack(aud, "vote:submit", {
    matchupId: m.id,
    answerPlayerId: target.playerId,
  });
  assert(vRes.ok, "audience vote accepted");

  // Host takeover: host disconnects → p0 may control.
  host.disconnect();
  const nextRes = await until(
    () => null,
    () => false,
    1
  ).catch(() => null); // just a tick
  let st2 = null;
  ps[0].on("room:state", (s) => (st2 = s));
  const ctl = await ack(ps[0], "game:restart");
  assert(ctl.ok, "player takeover when host gone (restart)");
  await until(() => st2, (s) => s.phase === "lobby", 5000, "back to lobby");
  assert(st2.players.length === 4, "audience promoted to player in lobby");

  [aud, ...ps].forEach((s) => s.disconnect());
  log("✅ AUDIENCE + SAFETY + TAKEOVER GEÇTİ");
}

async function testTriviaFinalDouble() {
  log("\n=== TRIVIA FINAL x2 ===");
  const { host, ps, ids, get } = await setup();
  await ack(host, "game:start", { gameType: "trivia" });

  const pointsByQuestion = [];
  while (true) {
    await until(get, (s) => s.phase === "answering" || s.phase === "scoreboard" || s.phase === "gameover", 30000, "answering");
    if (get().phase !== "answering") break;
    const q = get().trivia.question;
    // Spread answers over options 0..2 so someone is usually correct.
    for (const [i, p] of ps.entries())
      await ack(p, "trivia:answer", {
        questionId: q.id,
        optionIndex: Math.min(i, q.options.length - 1),
      });
    await until(get, (s) => s.phase === "results", 25000, "results");
    const best = get().trivia.reveal.pointsThisRound[0];
    pointsByQuestion.push({ points: best?.points ?? 0 });
    await ack(host, "game:next");
  }
  log("  en yüksek puanlar:", pointsByQuestion.map((p) => p.points).join(", "));
  const last = pointsByQuestion[pointsByQuestion.length - 1];
  if (last.points > 0) {
    // Base is 500 (+speed/streak); doubled final must be at least 1000.
    assert(last.points >= 1000, `final question doubled (got ${last.points})`);
  } else {
    log("  (son soruda kimse doğru cevaplamadı, çarpan kıyaslanamadı)");
  }
  [host, ...ps].forEach((s) => s.disconnect());
  log("✅ TRIVIA FINAL x2 GEÇTİ");
}

try {
  await testAudienceAndSafety();
  await testTriviaFinalDouble();
  log("\n✅ TÜM YENİ ÖZELLİK TESTLERİ GEÇTİ");
  process.exit(0);
} catch (e) {
  console.error("\n❌ TEST BAŞARISIZ:", e.message);
  process.exit(1);
}
