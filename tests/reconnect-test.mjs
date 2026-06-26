// Focused test: a player drops mid-game and reconnects with a NEW socket,
// then must (a) receive their prompts again and (b) be able to submit.
import { io } from "socket.io-client";

const URL = process.env.TEST_URL ?? "http://localhost:3001";
const log = (...a) => console.log(...a);
const conn = () => io(URL, { transports: ["websocket"], forceNew: true });
const ack = (s, e, ...a) => new Promise((r) => s.emit(e, ...a, (x) => r(x)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const host = conn();
let p1 = conn();
const p2 = conn();
const p3 = conn();
let st = null;
let p1Assignment = null;

host.on("room:state", (s) => (st = s));
const bindAssign = (sock) =>
  sock.on("player:assignment", (a) => (p1Assignment = a));
bindAssign(p1);

await new Promise((r) => (host.connected ? r() : host.once("connect", r)));
await Promise.all(
  [p1, p2, p3].map((p) => new Promise((r) => (p.connected ? r() : p.once("connect", r))))
);

const code = (await ack(host, "room:create", { language: "tr" })).data.code;
const ids = [];
for (const [i, p] of [p1, p2, p3].entries()) {
  ids[i] = (await ack(p, "room:join", { code, name: ["Ada", "Bora", "Can"][i] }))
    .data.playerId;
}
const p1pid = ids[0];
await wait(200);
log("✓ Oda kuruldu, 3 oyuncu katıldı:", code);

await ack(host, "game:start", { gameType: "quiplash" });
await wait(400);
log("✓ Oyun başladı, faz:", st.phase);
log("  p1 ilk atama prompt sayısı:", p1Assignment?.prompts.length);

// --- p1 drops ---
p1.close();
await wait(400);
const offline = st.players.find((p) => p.id === p1pid)?.connected === false;
log(offline ? "✓ p1 koptu (connected=false görünüyor)" : "✗ p1 hâlâ bağlı görünüyor");

// --- p1 reconnects with a brand-new socket, same pid ---
p1Assignment = null;
p1 = conn();
bindAssign(p1);
await new Promise((r) => (p1.connected ? r() : p1.once("connect", r)));
const rj = await ack(p1, "room:rejoin", { code, playerId: p1pid });
log(rj.ok ? "✓ rejoin başarılı" : "✗ rejoin BAŞARISIZ: " + rj.error);
await wait(400);
log("  rejoin sonrası yeniden gelen atama prompt sayısı:", p1Assignment?.prompts.length);

// --- p1 tries to actually submit after reconnect ---
let p1Submitted = true;
for (const pr of p1Assignment?.prompts ?? []) {
  const r = await ack(p1, "answer:submit", {
    matchupId: pr.matchupId,
    text: "yeniden bağlandım ve oynuyorum",
  });
  if (!r.ok) p1Submitted = false;
}
log(
  p1Submitted && (p1Assignment?.prompts.length ?? 0) > 0
    ? "✓ p1 reconnect sonrası cevap GÖNDEREBİLDİ"
    : "✗ p1 reconnect sonrası cevap gönderemedi"
);
await wait(300);
const p1Flag = st.players.find((p) => p.id === p1pid);
log("  sunucuda p1: connected=" + p1Flag?.connected + " hasSubmitted=" + p1Flag?.hasSubmitted);

const pass =
  rj.ok && (p1Assignment?.prompts.length ?? 0) > 0 && p1Submitted;
log("\n" + (pass ? "✅ RECONNECT TESTİ GEÇTİ" : "❌ RECONNECT TESTİ BAŞARISIZ"));
[host, p1, p2, p3].forEach((s) => s.close());
process.exit(pass ? 0 : 1);
