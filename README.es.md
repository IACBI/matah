<div align="center">

# 🎉 Quibble

### El divertido juego de fiesta para jugar con amigos

*Abre la pantalla del anfitrión en una TV, coged los móviles, y que empiece el caos.*

[English](README.md) · [Türkçe](README.tr.md) · [Deutsch](README.de.md) · **Español**

<br/>

[![▶ Jugar demo en vivo](https://img.shields.io/badge/▶_Jugar_demo_en_vivo-f6bd45?style=for-the-badge&logoColor=black)](https://quibble-0rjn.onrender.com)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB&style=flat-square)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white&style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white&style=flat-square)
![Licencia: MIT](https://img.shields.io/badge/Licencia-MIT-f6bd45?style=flat-square)

<br/>

<img src="docs/screenshots/home.png" width="49%" alt="Pantalla de inicio" />
<img src="docs/screenshots/lobby.png" width="49%" alt="Sala" />
<img src="docs/screenshots/trivia.png" width="49%" alt="Ronda de trivia" />
<img src="docs/screenshots/scoreboard.png" width="49%" alt="Marcador" />

</div>

---

## 🎮 ¿Qué es Quibble?

Quibble es un **juego de fiesta multijugador en tiempo real, al estilo Jackbox**.
Una pantalla — una TV o portátil — actúa como **pantalla del anfitrión** y muestra
un código de sala de 4 letras. Los demás **se unen desde el móvil**, y el juego se
desarrolla en todos los dispositivos a la vez.

Incluye **dos modos de juego**, y el motor está hecho para añadir más con facilidad:

| Modo | Cómo funciona |
|------|---------------|
| ✍️ **Quiplash** | Todos reciben una pregunta graciosa, escriben la respuesta más ingeniosa, y la sala vota en duelos. Más votos gana la ronda. |
| 🧠 **Trivia** | Preguntas de opción múltiple donde responder **correcto y rápido** suma más — con bonus por **rachas** de aciertos. |

> **▶ Pruébalo ahora:** **<https://quibble-0rjn.onrender.com>**
> *(Alojado en un plan gratuito — la primera petición tras un rato puede tardar ~50 s en despertar.)*

---

## ✨ Destacados

- ⚡ **Multijugador en tiempo real** con Socket.IO, con reconexión automática
- 🎲 **Plataforma multi-juego** — una arquitectura `GameEngine` limpia y extensible
- 🌍 **4 idiomas** — Türkçe, English, Deutsch, Español (interfaz *y* contenido de preguntas)
- 🔊 **Efectos de sonido** sintetizados con la Web Audio API (cero archivos de audio)
- 🎬 **Transiciones animadas** + un final con confeti en canvas
- 🔒 **Pensado en seguridad** — Helmet/CSP, validación de entrada, rate limiting por socket
- 🚀 **Pensado en rendimiento** — gzip, división de chunks de vendor, fuentes autoalojadas

---

## 🕹️ Cómo se juega

1. En una **TV o portátil**, abre la app y pulsa **Iniciar juego nuevo** → aparece un código de sala.
2. En cada **móvil** (misma Wi-Fi o la URL en vivo), toca **Unirse a una sala** e introduce tu nombre + el código.
3. Cuando se hayan unido **al menos 3 jugadores**, el anfitrión elige un modo y empieza.
4. Responde, vota, mira subir los puntos — ¡y que llueva confeti sobre el ganador! 🎊

---

## 🛠️ Tecnología

Un monorepo de TypeScript (npm workspaces) con tres paquetes:

```
quibble/
├─ shared/   → tipos y contratos de eventos Socket.IO compartidos por ambos lados
├─ server/   → servidor de juego Express + Socket.IO (salas en memoria + motores)
└─ client/   → interfaz React + Vite (pantalla del anfitrión + control del jugador)
```

**Servidor:** Node · Express · Socket.IO  ·  **Cliente:** React · Vite  ·  **Compartido:** eventos tipados de extremo a extremo

---

## 🚀 Primeros pasos

```bash
npm install      # instala todos los workspaces
npm run dev      # servidor en :3001, cliente en :5173
```

Abre `http://localhost:5173` en tu ordenador para hospedar, y la dirección LAN que
aparece en la terminal en los móviles para unirte.

### Comandos útiles

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Ejecuta servidor + cliente en modo watch |
| `npm run build` | Compila el bundle de cliente de producción |
| `npm start` | Servidor de producción (también sirve el cliente compilado) |
| `npm run typecheck` | Comprueba tipos en cada workspace |
| `npm run test:e2e` | Juega ambos modos de extremo a extremo |

---

## ☁️ Despliegue

Toda la app se despliega como un único servicio — en producción el servidor Node
sirve el cliente compilado desde el mismo origen.

- **Render (gratis, un clic):** sube a GitHub, luego **New → Blueprint** y elige el repo. `render.yaml` hace el resto.
- **Docker:** `docker build -t quibble . && docker run -p 3001:3001 quibble`
- **Manual:** `npm install && npm run build && NODE_ENV=production npm start`

---

## 📁 Estructura del proyecto

```
quibble/
├─ shared/src/index.ts        # tipos compartidos + contratos de socket
├─ server/src/
│  ├─ index.ts                # servidor Socket.IO, seguridad, estáticos en prod
│  ├─ room.ts                 # sala: miembros, máquina de fases/temporizador, puntos
│  ├─ engine.ts               # interfaz GameEngine
│  ├─ engines/                # quiplash.ts · trivia.ts
│  ├─ content/                # prompts.ts · trivia.ts (contenido en 4 idiomas)
│  └─ rateLimiter.ts          # token bucket por socket
└─ client/src/
   ├─ views/                  # Home · HostScreen · PlayerScreen
   ├─ components/             # Controls (idioma/sonido) · Confetti
   ├─ i18n/                   # traducciones + provider
   └─ sound.ts                # efectos de sonido sintetizados
```

---

<div align="center">

Hecho con ❤️ y TypeScript · Bajo licencia [MIT](LICENSE)

</div>
