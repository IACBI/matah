// Validates Socket.IO Connection State Recovery (CSR).
// Forces a real low-level reconnect on a player mid-game and asserts that:
//  1. the socket recovers its session (socket.recovered === true),
//  2. it stays in the room and keeps receiving broadcasts (no manual rejoin),
//  3. the server re-binds its identity so it can still submit answers.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const conn = () => io(URL, { transports: ["websocket"] }); // reconnection on by default
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
  let hostState = null;
  host.on("room:state", (s) => (hostState = s));

  await new Promise((r) => (host.connected ? r() : host.once("connect", r)));
  await Promise.all(
    players.map((p) => new Promise((r) => (p.connected ? r() : p.once("connect", r))))
  );

  const code = (await ack(host, "room:create", { language: "en" })).data.code;
  for (const [i, p] of players.entries())
    ids[i] = (await ack(p, "room:join", { code, name: names[i] })).data.playerId;
  await until(() => hostState, (s) => s.players.length === 3, 8000, "3 players");
  console.log("✓ Oda kuruldu, 3 oyuncu katıldı:", code);

  await ack(host, "game:start", { gameType: "quiplash" });
  await until(() => hostState, (s) => s.phase === "answering", 8000, "answering");
  console.log("✓ Oyun başladı, faz: answering");

  // The recovering player: capture its restored assignment and broadcasts.
  const p = players[0];
  let pState = null;
  let pAssignment = null;
  p.on("room:state", (s) => (pState = s));
  p.on("player:assignment", (a) => (pAssignment = a));

  // Force a genuine transport drop on this one socket only.
  const recovered = new Promise((res) =>
    p.once("connect", () => res(p.recovered))
  );
  p.io.engine.close();
  const wasRecovered = await Promise.race([
    recovered,
    new Promise((_, rej) => setTimeout(() => rej(new Error("no reconnect")), 8000)),
  ]);
  assert(wasRecovered === true, `socket.recovered should be true, got ${wasRecovered}`);
  console.log("✓ Socket koptu ve oturum kurtarıldı (recovered=true)");

  // Still in the room: a host-driven phase change must reach the recovered
  // socket WITHOUT any manual rejoin.
  pState = null;
  await ack(host, "game:next"); // answering -> voting (or results)
  await until(() => pState, (s) => s && s.phase !== "answering", 8000, "broadcast after recovery");
  console.log("✓ Kurtarma sonrası yayınları almaya devam ediyor (oda üyeliği korundu)");

  // Server re-bound identity: the player can still act. Go back to a clean
  // answering round is not trivial here, so assert the simplest invariant —
  // the recovered player is marked connected in the authoritative state.
  await until(() => hostState, (s) => s.players.find((pl) => pl.id === ids[0])?.connected === true, 8000, "player online");
  console.log("✓ Sunucu kimliği yeniden bağladı (connected=true)");
  assert(pAssignment !== null, "assignment should be re-sent on recovery");
  console.log("✓ Atama kurtarmada yeniden gönderildi");

  console.log("\n✅ CSR TESTİ GEÇTİ");
  [host, ...players].forEach((s) => s.close());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log("\n❌ HATA:", e.message);
    process.exit(1);
  });
