<div align="center">

# 🎉 Quibble

### The hilarious party game you play with friends

*Open the host screen on a TV, grab your phones, and let the chaos begin.*

**English** · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · [Español](README.es.md)

<br/>

[![▶ Play Live Demo](https://img.shields.io/badge/▶_Play_Live_Demo-f6bd45?style=for-the-badge&logoColor=black)](https://quibble-0rjn.onrender.com)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB&style=flat-square)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white&style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white&style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-f6bd45?style=flat-square)

<br/>

<img src="docs/screenshots/home.png" width="49%" alt="Home screen" />
<img src="docs/screenshots/lobby.png" width="49%" alt="Lobby" />
<img src="docs/screenshots/trivia.png" width="49%" alt="Trivia round" />
<img src="docs/screenshots/scoreboard.png" width="49%" alt="Scoreboard" />

</div>

---

## 🎮 What is Quibble?

Quibble is a **Jackbox-style, real-time multiplayer party game**. One screen — a
TV or laptop — acts as the **host display** and shows a 4-letter room code.
Everyone else **joins from their phone**, and the game plays out across all the
devices at once.

It ships with **two game modes**, and the engine is built to make adding more easy:

| Mode | How it works |
|------|--------------|
| ✍️ **Quiplash** | Everyone gets a funny prompt, writes the wittiest answer, then the room votes head-to-head. Most votes wins the round. |
| 🧠 **Trivia** | Multiple-choice questions where answering **correctly and fast** scores the most — with a bonus for answer **streaks**. |

> **▶ Try it now:** **<https://quibble-0rjn.onrender.com>**
> *(Hosted on a free tier — the first request after a while may take ~50s to wake up.)*

---

## ✨ Highlights

- ⚡ **Real-time multiplayer** over Socket.IO, with automatic reconnect
- 🎲 **Multi-game platform** — a clean, extensible `GameEngine` architecture
- 🌍 **4 languages** — Türkçe, English, Deutsch, Español (UI *and* question content)
- 🔊 **Sound effects** synthesized with the Web Audio API (zero audio assets)
- 🎬 **Animated transitions** + a canvas confetti finale
- 🔒 **Security-minded** — Helmet/CSP, input validation, per-socket rate limiting
- 🚀 **Performance-minded** — gzip, vendor chunk splitting, self-hosted fonts

---

## 🕹️ How to play

1. On a **TV or laptop**, open the app and hit **Start New Game** → a room code appears.
2. On each **phone** (same Wi-Fi, or just the live URL), tap **Join a Room** and enter your name + the code.
3. Once **at least 3 players** have joined, the host picks a mode and starts.
4. Answer, vote, watch the scores climb — and let the confetti rain on the winner! 🎊

---

## 🛠️ Tech stack

A TypeScript monorepo (npm workspaces) with three packages:

```
quibble/
├─ shared/   → types & Socket.IO event contracts shared by both sides
├─ server/   → Express + Socket.IO game server (in-memory rooms + engines)
└─ client/   → React + Vite interface (host display + player controller)
```

**Server:** Node · Express · Socket.IO  ·  **Client:** React · Vite  ·  **Shared:** end-to-end typed events

---

## 🚀 Getting started

```bash
npm install      # install all workspaces
npm run dev      # server on :3001, client on :5173
```

Open `http://localhost:5173` on your computer to host, and the LAN address shown
in the terminal on your phones to join.

### Useful scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Run server + client in watch mode |
| `npm run build` | Build the production client bundle |
| `npm start` | Production server (also serves the built client) |
| `npm run typecheck` | Type-check every workspace |
| `npm run test:e2e` | Play through both modes end-to-end |

---

## ☁️ Deploy

One service deploys the whole app — in production the Node server serves the
built client from the same origin.

- **Render (free, one click):** push to GitHub, then **New → Blueprint** and pick the repo. `render.yaml` does the rest.
- **Docker:** `docker build -t quibble . && docker run -p 3001:3001 quibble`
- **Manual:** `npm install && npm run build && NODE_ENV=production npm start`

---

## 📁 Project layout

```
quibble/
├─ shared/src/index.ts        # shared types + socket contracts
├─ server/src/
│  ├─ index.ts                # Socket.IO server, security, prod static serving
│  ├─ room.ts                 # room: membership, phase/timer machine, scoring
│  ├─ engine.ts               # GameEngine interface
│  ├─ engines/                # quiplash.ts · trivia.ts
│  ├─ content/                # prompts.ts · trivia.ts (content in 4 languages)
│  └─ rateLimiter.ts          # per-socket token bucket
└─ client/src/
   ├─ views/                  # Home · HostScreen · PlayerScreen
   ├─ components/             # Controls (language/sound) · Confetti
   ├─ i18n/                   # translations + provider
   └─ sound.ts                # synthesized sound effects
```

---

<div align="center">

Built with ❤️ and TypeScript · Licensed under [MIT](LICENSE)

</div>
