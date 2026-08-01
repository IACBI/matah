// Smoke test for the host tools: kick a player, configurable game length
// (rounds / questions, with clamping), end-game-early, and host-only guards.
import { io } from "socket.io-client";

import { testUrl } from "./helpers/target.mjs";

const URL = await testUrl();
const log = (...a) => console.log(...a);
const conn = (testIp) => io(URL, {
  transports: ["websocket"],
  forceNew: true,
  extraHeaders: { Origin: URL, "X-Forwarded-For": testIp },
});
const ack = (s, e, ...a) => new Promise((resolve, reject) =>
  s.timeout(5000).emit(e, ...a, (error, result) => error ? reject(error) : resolve(result))
);

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

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  log(`✓ ${msg}`);
};

async function setup() {
  setup.sequence = (setup.sequence ?? 0) + 1;
  const testIp = `203.0.113.${setup.sequence}`;
  const host = conn(testIp);
  const ps = [conn(testIp), conn(testIp), conn(testIp)];
  const names = ["Ali", "Veli", "Ayşe"];
  const ids = [];
  let st = null;
  host.on("room:state", (s) => (st = s));
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
  return { host, ps, ids, code, get: () => st };
}
setup.sequence = 0;

async function testKick() {
  log("\n=== KICK ===");
  const { host, ps, ids, get } = await setup();

  // Non-host can't kick while the host screen is connected.
  const denied = await ack(ps[0], "player:kick", { playerId: ids[1], phaseId: get().phaseId });
  assert(!denied.ok && denied.error === "host_only", "non-host kick → host_only");

  // The kicked client receives room:kicked.
  let kicked = false;
  ps[1].on("room:kicked", () => (kicked = true));

  const res = await ack(host, "player:kick", { playerId: ids[1], phaseId: get().phaseId });
  assert(res.ok, "host kick accepted");
  await until(() => (kicked ? {} : null), () => true, 5000, "room:kicked event");
  log("✓ kicked client received room:kicked");
  await until(get, (s) => s.players.length === 2, 5000, "player removed from state");
  assert(
    !get().players.some((p) => p.id === ids[1]),
    "kicked player gone from roster"
  );

  [host, ...ps].forEach((s) => s.disconnect());
  log("✅ KICK GEÇTİ");
}

async function testConfigurableLength() {
  log("\n=== CONFIGURABLE LENGTH ===");

  // Quiplash with rounds: 1.
  {
    const { host, ps, get } = await setup();
    await ack(host, "game:start", { gameType: "quiplash", rounds: 1, phaseId: get().phaseId });
    await until(get, (s) => s.phase === "answering", 8000, "answering");
    assert(get().totalRounds === 1, "quiplash honors rounds: 1");
    [host, ...ps].forEach((s) => s.disconnect());
  }

  // Quiplash with an out-of-range value clamps to the max (5).
  {
    const { host, ps, get } = await setup();
    await ack(host, "game:start", { gameType: "quiplash", rounds: 999, phaseId: get().phaseId });
    await until(get, (s) => s.phase === "answering", 8000, "answering");
    assert(get().totalRounds === 5, "quiplash rounds clamped to max (5)");
    [host, ...ps].forEach((s) => s.disconnect());
  }

  // Trivia with questions: 3.
  {
    const { host, ps, get } = await setup();
    await ack(host, "game:start", { gameType: "trivia", rounds: 3, phaseId: get().phaseId });
    await until(get, (s) => s.phase === "answering", 8000, "answering");
    assert(get().trivia.totalQuestions === 3, "trivia honors questions: 3");
    [host, ...ps].forEach((s) => s.disconnect());
  }

  log("✅ CONFIGURABLE LENGTH GEÇTİ");
}

async function testEndGame() {
  log("\n=== END GAME EARLY ===");
  const { host, ps, get } = await setup();
  await ack(host, "game:start", { gameType: "trivia", rounds: 5, phaseId: get().phaseId });
  await until(get, (s) => s.phase === "answering", 8000, "answering");

  // Non-host can't end while the host is connected.
  const denied = await ack(ps[0], "game:end", { phaseId: get().phaseId });
  assert(!denied.ok && denied.error === "host_only", "non-host end → host_only");

  const res = await ack(host, "game:end", { phaseId: get().phaseId });
  assert(res.ok, "host end accepted");
  await until(get, (s) => s.phase === "scoreboard", 8000, "jumped to scoreboard");
  log("✓ end-game jumped straight to the scoreboard");

  [host, ...ps].forEach((s) => s.disconnect());
  log("✅ END GAME GEÇTİ");
}

try {
  await testKick();
  await testConfigurableLength();
  await testEndGame();
  log("\n✅ TÜM HOST ARAÇLARI TESTLERİ GEÇTİ");
  process.exit(0);
} catch (e) {
  console.error("\n❌ TEST BAŞARISIZ:", e.message);
  process.exit(1);
}
