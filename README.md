<div align="center">

# 🎉 Matah

### The hilarious party game you play with friends

*Open the host screen on a TV, grab your phones, and let the chaos begin.*

**🇬🇧 English** · [🇹🇷 Türkçe](#tr-trke) · [🇩🇪 Deutsch](#de-deutsch) · [🇪🇸 Español](#es-espaol) · [🇫🇷 Français](#fr-franais) · [🇮🇹 Italiano](#it-italiano) · [🇵🇹 Português](#pt-portugus) · [🇷🇺 Русский](#ru-ru) · [🇸🇦 العربية](#ar-ar) · [🇨🇳 中文](#zh-zh) · [🇯🇵 日本語](#ja-ja) · [🇰🇷 한국어](#ko-ko) · [🇮🇳 हिन्दी](#hi-hi) · [🇳🇱 Nederlands](#nl-nederlands)

<br/>

[![▶ Play Live Demo](https://img.shields.io/badge/▶_Play_Live_Demo-f6bd45?style=for-the-badge&logoColor=black)](https://quibble-0rjn.onrender.com)

[![CI](https://github.com/IACBI/matah/actions/workflows/ci.yml/badge.svg)](https://github.com/IACBI/matah/actions/workflows/ci.yml)
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

## 🎮 What is Matah?

Matah is a **Jackbox-style, real-time multiplayer party game**. One screen — a
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
- 🌍 **14 languages** — Türkçe, English, Deutsch, Español, Français, Italiano, Português, Русский, العربية, 中文, 日本語, 한국어, हिन्दी, Nederlands (UI *and* question content)
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
matah/
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
- **Docker:** `docker build -t matah . && docker run -p 3001:3001 matah`
- **Manual:** `npm install && npm run build && NODE_ENV=production npm start`

---

## 📁 Project layout

```
matah/
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

---

## 🌍 Other languages

*Core sections are translated below; deeper technical/deploy sections stay in English.*

<a id="tr-trke"></a>
<details>
<summary><b>🇹🇷 Türkçe</b></summary>

### 🎉 Matah
*Arkadaşlarınla oynadığın çılgın parti oyunu.*

**Matah nedir?** Jackbox tarzı, **gerçek zamanlı çok oyunculu** bir parti oyunu. Bir ekran — TV ya da laptop — **host ekranı** olur ve 4 harfli bir oda kodu gösterir. Herkes **telefonundan katılır** ve oyun tüm cihazlarda aynı anda akar. **İki oyun modu** ile gelir ve motoru yeni mod eklemeyi kolaylaştıracak şekilde tasarlanmıştır:

| Mod | Nasıl işler |
|------|--------------|
| ✍️ **Quiplash** | Herkese komik bir soru gelir; en esprili cevabı yaz, sonra oda ikili düellolarla oylar. En çok oyu alan turu kazanır. |
| 🧠 **Bilgi Yarışması** | Çoktan seçmeli sorular; **doğru ve hızlı** cevaplamak en çok puanı kazandırır — üst üste doğrularda **seri bonusu** vardır. |

**Öne çıkanlar**
- ⚡ **Gerçek zamanlı çok oyunculu** — Socket.IO üzerinde, otomatik yeniden bağlanmayla
- 🎲 **Çoklu oyun platformu** — temiz, genişletilebilir bir `GameEngine` mimarisi
- 🌍 **14 dil** — arayüz *ve* soru içeriği
- 🔊 **Ses efektleri** — Web Audio API ile sentezlenir (sıfır ses dosyası)
- 🎬 **Animasyonlu geçişler** + canvas konfeti finali
- 🔒 **Güvenlik odaklı** — Helmet/CSP, girdi doğrulama, soket başına hız sınırı
- 🚀 **Performans odaklı** — gzip, vendor chunk ayrımı, kendi sunulan fontlar

**Nasıl oynanır**
1. **TV veya laptopta** uygulamayı aç ve **Yeni Oyun Başlat**'a bas — bir oda kodu belirir.
2. Her **telefonda** (aynı Wi-Fi ya da canlı URL) **Odaya Katıl**'a dokun, adını + kodu gir.
3. **En az 3 oyuncu** katılınca host bir mod seçip başlatır.
4. Cevapla, oyla, puanların yükselişini izle — ve konfetiler kazananın üstüne yağsın! 🎊

</details>

<a id="de-deutsch"></a>
<details>
<summary><b>🇩🇪 Deutsch</b></summary>

### 🎉 Matah
*Das urkomische Partyspiel für Freunde.*

**Was ist Matah?** Ein **Echtzeit-Multiplayer-Partyspiel** im Jackbox-Stil. Ein Bildschirm — ein TV oder Laptop — ist die **Host-Anzeige** und zeigt einen 4-stelligen Raumcode. Alle anderen **treten per Handy bei**, und das Spiel läuft gleichzeitig auf allen Geräten. Es bringt **zwei Spielmodi** mit, und die Engine ist so gebaut, dass weitere leicht hinzukommen:

| Modus | So funktioniert es |
|------|--------------|
| ✍️ **Quiplash** | Alle bekommen eine lustige Frage, schreiben die witzigste Antwort, dann stimmt der Raum im Duell ab. Die meisten Stimmen gewinnen die Runde. |
| 🧠 **Quiz** | Multiple-Choice-Fragen, bei denen **richtiges und schnelles** Antworten am meisten Punkte bringt — mit Bonus für **Antwort-Serien**. |

**Highlights**
- ⚡ **Echtzeit-Multiplayer** über Socket.IO, mit automatischem Reconnect
- 🎲 **Multi-Game-Plattform** — eine saubere, erweiterbare `GameEngine`-Architektur
- 🌍 **14 Sprachen** — Oberfläche *und* Frageninhalte
- 🔊 **Soundeffekte** mit der Web Audio API synthetisiert (keine Audiodateien)
- 🎬 **Animierte Übergänge** + ein Canvas-Konfetti-Finale
- 🔒 **Sicherheitsbewusst** — Helmet/CSP, Eingabevalidierung, Rate-Limit pro Socket
- 🚀 **Performance-bewusst** — gzip, Vendor-Chunk-Splitting, selbst gehostete Fonts

**So wird gespielt**
1. Öffne die App auf einem **TV oder Laptop** und drücke **Neues Spiel starten** — ein Raumcode erscheint.
2. Tippe auf jedem **Handy** (gleiches WLAN oder die Live-URL) auf **Raum beitreten** und gib deinen Namen + den Code ein.
3. Sobald **mindestens 3 Spieler** beigetreten sind, wählt der Host einen Modus und startet.
4. Antworte, stimme ab, sieh die Punkte steigen — und lass Konfetti auf den Gewinner regnen! 🎊

</details>

<a id="es-espaol"></a>
<details>
<summary><b>🇪🇸 Español</b></summary>

### 🎉 Matah
*El divertidísimo juego de fiesta para jugar con amigos.*

**¿Qué es Matah?** Un **juego de fiesta multijugador en tiempo real** al estilo Jackbox. Una pantalla — una TV o portátil — es la **pantalla del anfitrión** y muestra un código de sala de 4 letras. Los demás **se unen desde el móvil** y el juego transcurre en todos los dispositivos a la vez. Incluye **dos modos de juego** y el motor está hecho para añadir más fácilmente:

| Modo | Cómo funciona |
|------|--------------|
| ✍️ **Quiplash** | Todos reciben una pregunta graciosa, escriben la respuesta más ingeniosa y la sala vota mano a mano. Más votos gana la ronda. |
| 🧠 **Trivia** | Preguntas tipo test donde responder **bien y rápido** da más puntos — con bonus por **rachas** de aciertos. |

**Lo más destacado**
- ⚡ **Multijugador en tiempo real** sobre Socket.IO, con reconexión automática
- 🎲 **Plataforma multijuego** — una arquitectura `GameEngine` limpia y extensible
- 🌍 **14 idiomas** — interfaz *y* contenido de las preguntas
- 🔊 **Efectos de sonido** sintetizados con la Web Audio API (cero archivos de audio)
- 🎬 **Transiciones animadas** + un final de confeti en canvas
- 🔒 **Pensado en seguridad** — Helmet/CSP, validación de entradas, límite por socket
- 🚀 **Pensado en rendimiento** — gzip, división de chunks de vendor, fuentes propias

**Cómo jugar**
1. En una **TV o portátil**, abre la app y pulsa **Iniciar juego nuevo** — aparece un código de sala.
2. En cada **móvil** (misma Wi-Fi o la URL en vivo), toca **Unirse a una sala** e introduce tu nombre + el código.
3. Cuando se unan **al menos 3 jugadores**, el anfitrión elige un modo y empieza.
4. Responde, vota, mira subir las puntuaciones — ¡y que caiga el confeti sobre el ganador! 🎊

</details>

<a id="fr-franais"></a>
<details>
<summary><b>🇫🇷 Français</b></summary>

### 🎉 Matah
*Le jeu de soirée hilarant à jouer entre amis.*

**C'est quoi Matah ?** Un **jeu de soirée multijoueur en temps réel**, façon Jackbox. Un écran — une TV ou un ordi — sert d'**affichage hôte** et montre un code de salon à 4 lettres. Tous les autres **rejoignent depuis leur téléphone** et la partie se joue sur tous les appareils en même temps. Il propose **deux modes de jeu**, et le moteur est conçu pour en ajouter facilement :

| Mode | Comment ça marche |
|------|--------------|
| ✍️ **Quiplash** | Chacun reçoit une question drôle, écrit la réponse la plus spirituelle, puis le salon vote en duel. Le plus de votes remporte la manche. |
| 🧠 **Quiz** | Questions à choix multiples où répondre **juste et vite** rapporte le plus — avec un bonus pour les **séries** de bonnes réponses. |

**Points forts**
- ⚡ **Multijoueur en temps réel** via Socket.IO, avec reconnexion automatique
- 🎲 **Plateforme multi-jeux** — une architecture `GameEngine` propre et extensible
- 🌍 **14 langues** — interface *et* contenu des questions
- 🔊 **Effets sonores** synthétisés avec la Web Audio API (aucun fichier audio)
- 🎬 **Transitions animées** + un final de confettis en canvas
- 🔒 **Soucieux de la sécurité** — Helmet/CSP, validation des entrées, limite par socket
- 🚀 **Soucieux des performances** — gzip, découpage des chunks vendor, polices auto-hébergées

**Comment jouer**
1. Sur une **TV ou un ordi**, ouvre l'appli et appuie sur **Lancer une partie** — un code de salon apparaît.
2. Sur chaque **téléphone** (même Wi-Fi ou l'URL en ligne), touche **Rejoindre un salon** et saisis ton prénom + le code.
3. Une fois qu'**au moins 3 joueurs** ont rejoint, l'hôte choisit un mode et lance la partie.
4. Réponds, vote, regarde les scores grimper — et que les confettis pleuvent sur le gagnant ! 🎊

</details>

<a id="it-italiano"></a>
<details>
<summary><b>🇮🇹 Italiano</b></summary>

### 🎉 Matah
*Il divertentissimo party game da giocare con gli amici.*

**Cos'è Matah?** Un **party game multigiocatore in tempo reale** in stile Jackbox. Uno schermo — una TV o un portatile — è il **display dell'host** e mostra un codice stanza di 4 lettere. Tutti gli altri **si uniscono dal telefono** e si gioca su tutti i dispositivi contemporaneamente. Include **due modalità di gioco** e il motore è pensato per aggiungerne facilmente altre:

| Modalità | Come funziona |
|------|--------------|
| ✍️ **Quiplash** | Tutti ricevono una domanda divertente, scrivono la risposta più arguta, poi la stanza vota testa a testa. Più voti vince il round. |
| 🧠 **Quiz** | Domande a scelta multipla in cui rispondere **in modo corretto e veloce** fa più punti — con bonus per le **serie** di risposte esatte. |

**In evidenza**
- ⚡ **Multigiocatore in tempo reale** su Socket.IO, con riconnessione automatica
- 🎲 **Piattaforma multi-gioco** — un'architettura `GameEngine` pulita ed estensibile
- 🌍 **14 lingue** — interfaccia *e* contenuto delle domande
- 🔊 **Effetti sonori** sintetizzati con la Web Audio API (zero file audio)
- 🎬 **Transizioni animate** + un finale di coriandoli su canvas
- 🔒 **Attento alla sicurezza** — Helmet/CSP, validazione input, rate limit per socket
- 🚀 **Attento alle prestazioni** — gzip, splitting dei chunk vendor, font self-hosted

**Come si gioca**
1. Su una **TV o un portatile**, apri l'app e premi **Inizia una nuova partita** — appare un codice stanza.
2. Su ogni **telefono** (stessa Wi-Fi o l'URL live), tocca **Entra in una stanza** e inserisci il tuo nome + il codice.
3. Quando si uniscono **almeno 3 giocatori**, l'host sceglie una modalità e inizia.
4. Rispondi, vota, guarda i punteggi salire — e lascia che i coriandoli piovano sul vincitore! 🎊

</details>

<a id="pt-portugus"></a>
<details>
<summary><b>🇵🇹 Português</b></summary>

### 🎉 Matah
*O jogo de festa hilariante que jogas com amigos.*

**O que é o Matah?** Um **jogo de festa multijogador em tempo real**, ao estilo Jackbox. Um ecrã — uma TV ou portátil — é o **ecrã do anfitrião** e mostra um código de sala de 4 letras. Toda a gente **entra a partir do telemóvel** e o jogo decorre em todos os dispositivos ao mesmo tempo. Vem com **dois modos de jogo** e o motor foi feito para acrescentar mais com facilidade:

| Modo | Como funciona |
|------|--------------|
| ✍️ **Quiplash** | Todos recebem uma pergunta engraçada, escrevem a resposta mais espirituosa e depois a sala vota frente a frente. Mais votos vence a ronda. |
| 🧠 **Perguntas e Respostas** | Perguntas de escolha múltipla em que responder **certo e depressa** pontua mais — com bónus por **sequências** de acertos. |

**Destaques**
- ⚡ **Multijogador em tempo real** sobre Socket.IO, com reconexão automática
- 🎲 **Plataforma multi-jogo** — uma arquitetura `GameEngine` limpa e extensível
- 🌍 **14 idiomas** — interface *e* conteúdo das perguntas
- 🔊 **Efeitos sonoros** sintetizados com a Web Audio API (zero ficheiros de áudio)
- 🎬 **Transições animadas** + um final de confetes em canvas
- 🔒 **Atento à segurança** — Helmet/CSP, validação de entradas, limite por socket
- 🚀 **Atento ao desempenho** — gzip, divisão de chunks de vendor, fontes próprias

**Como jogar**
1. Numa **TV ou portátil**, abre a aplicação e carrega em **Iniciar Novo Jogo** — aparece um código de sala.
2. Em cada **telemóvel** (mesma Wi-Fi ou o URL ao vivo), toca em **Entrar numa Sala** e introduz o teu nome + o código.
3. Assim que **pelo menos 3 jogadores** tiverem entrado, o anfitrião escolhe um modo e começa.
4. Responde, vota, vê as pontuações a subir — e deixa cair os confetes sobre o vencedor! 🎊

</details>

<a id="ru-ru"></a>
<details>
<summary><b>🇷🇺 Русский</b></summary>

### 🎉 Matah
*Уморительная вечериночная игра для компании друзей.*

**Что такое Matah?** **Многопользовательская вечериночная игра в реальном времени** в стиле Jackbox. Один экран — телевизор или ноутбук — служит **дисплеем ведущего** и показывает код комнаты из 4 букв. Все остальные **подключаются с телефонов**, и игра идёт сразу на всех устройствах. В игре **два режима**, а движок устроен так, чтобы легко добавлять новые:

| Режим | Как это работает |
|------|--------------|
| ✍️ **Quiplash** | Каждому достаётся смешное задание, нужно придумать самый остроумный ответ, затем комната голосует в дуэлях. Больше всего голосов — победа в раунде. |
| 🧠 **Викторина** | Вопросы с вариантами ответов, где **правильный и быстрый** ответ приносит больше всего очков — с бонусом за **серии** верных ответов. |

**Ключевые особенности**
- ⚡ **Мультиплеер в реальном времени** через Socket.IO, с автоматическим переподключением
- 🎲 **Платформа для нескольких игр** — чистая, расширяемая архитектура `GameEngine`
- 🌍 **14 языков** — интерфейс *и* содержание вопросов
- 🔊 **Звуковые эффекты** синтезируются через Web Audio API (без аудиофайлов)
- 🎬 **Анимированные переходы** + финал с конфетти на canvas
- 🔒 **С заботой о безопасности** — Helmet/CSP, валидация ввода, лимит на сокет
- 🚀 **С заботой о производительности** — gzip, разделение vendor-чанков, свои шрифты

**Как играть**
1. На **телевизоре или ноутбуке** откройте приложение и нажмите **Начать новую игру** — появится код комнаты.
2. На каждом **телефоне** (та же Wi-Fi или живой URL) нажмите **Войти в комнату** и введите имя + код.
3. Как только наберётся **хотя бы 3 игрока**, ведущий выбирает режим и начинает.
4. Отвечайте, голосуйте, следите за ростом очков — и пусть на победителя прольётся конфетти! 🎊

</details>

<a id="ar-ar"></a>
<details>
<summary><b>🇸🇦 العربية</b></summary>

<div dir="rtl">

### 🎉 Matah
*لعبة الحفلات المضحكة التي تلعبها مع أصدقائك.*

**ما هي Matah؟** **لعبة حفلات جماعية فورية** على غرار Jackbox. تكون إحدى الشاشات — تلفاز أو حاسوب محمول — هي **شاشة المضيف** وتعرض رمز غرفة من 4 أحرف. ينضم الجميع الآخرون **من هواتفهم**، وتجري اللعبة على كل الأجهزة في آنٍ واحد. تأتي بـ**نمطَي لعب**، وقد صُمّم محرّكها لإضافة المزيد بسهولة:

| النمط | كيف يعمل |
|------|--------------|
| ✍️ **Quiplash** | يحصل الجميع على سؤال مضحك، فيكتب كلٌّ أذكى إجابة، ثم تصوّت الغرفة في مواجهات مباشرة. صاحب أكثر الأصوات يفوز بالجولة. |
| 🧠 **أسئلة وأجوبة** | أسئلة متعددة الخيارات حيث تمنحك الإجابة **الصحيحة والسريعة** أعلى النقاط — مع مكافأة لـ**سلاسل** الإجابات الصحيحة. |

**أبرز المزايا**
- ⚡ **لعب جماعي فوري** عبر Socket.IO، مع إعادة اتصال تلقائية
- 🎲 **منصّة متعددة الألعاب** — بنية `GameEngine` نظيفة وقابلة للتوسيع
- 🌍 **14 لغة** — الواجهة *ومحتوى* الأسئلة
- 🔊 **مؤثرات صوتية** مُولّدة عبر Web Audio API (دون أي ملفات صوتية)
- 🎬 **انتقالات متحركة** + خاتمة قصاصات ورقية على canvas
- 🔒 **واعٍ بالأمان** — Helmet/CSP، والتحقق من المدخلات، وحدّ معدّل لكل socket
- 🚀 **واعٍ بالأداء** — gzip، وتقسيم حزم vendor، وخطوط مُستضافة ذاتيًا

**كيف تلعب**
1. على **تلفاز أو حاسوب محمول**، افتح التطبيق واضغط على **ابدأ لعبة جديدة** — يظهر رمز الغرفة.
2. على كل **هاتف** (نفس شبكة Wi-Fi أو الرابط المباشر)، اضغط على **انضم إلى غرفة** وأدخل اسمك + الرمز.
3. بمجرد انضمام **3 لاعبين على الأقل**، يختار المضيف نمطًا ويبدأ.
4. أجب، وصوّت، وشاهد النقاط تتصاعد — ودع الزينة تتساقط على الفائز! 🎊

</div>

</details>

<a id="zh-zh"></a>
<details>
<summary><b>🇨🇳 中文</b></summary>

### 🎉 Matah
*和朋友一起玩的爆笑派对游戏。*

**Matah 是什么？** 一款 Jackbox 风格的**实时多人派对游戏**。一块屏幕——电视或笔记本——作为**主持显示屏**，展示一个 4 位的房间码。其他所有人**用手机加入**，游戏在所有设备上同时进行。内置**两种游戏模式**，引擎也便于轻松扩展更多模式：

| 模式 | 玩法 |
|------|--------------|
| ✍️ **Quiplash** | 每个人都会拿到一道搞笑题目，写下最机智的答案，然后全房间一对一投票。得票最多者赢得本回合。 |
| 🧠 **知识问答** | 选择题模式，答得**又对又快**得分最高——连续答对还有**连击奖励**。 |

**亮点**
- ⚡ **实时多人** —— 基于 Socket.IO，支持自动重连
- 🎲 **多游戏平台** —— 简洁、可扩展的 `GameEngine` 架构
- 🌍 **14 种语言** —— 界面*和*题目内容
- 🔊 **音效** —— 用 Web Audio API 合成（零音频文件）
- 🎬 **动画过渡** + canvas 彩纸庆祝结尾
- 🔒 **注重安全** —— Helmet/CSP、输入校验、按 socket 限流
- 🚀 **注重性能** —— gzip、第三方代码分块、自托管字体

**怎么玩**
1. 在**电视或笔记本**上打开应用，点击 **开始新游戏**——房间码就会出现。
2. 在每部**手机**上（同一 Wi-Fi 或在线 URL）点击 **加入房间**，输入你的名字和房间码。
3. **至少 3 名玩家**加入后，房主选择一个模式并开始。
4. 作答、投票、看着分数节节攀升——再让彩纸为赢家洒落吧！🎊

</details>

<a id="ja-ja"></a>
<details>
<summary><b>🇯🇵 日本語</b></summary>

### 🎉 Matah
*友達とワイワイ盛り上がる爆笑パーティーゲーム。*

**Matah ってなに？** Jackbox スタイルの**リアルタイム・マルチプレイヤー・パーティーゲーム**。テレビやノートPCの画面1つが**ホスト表示**になり、4文字のルームコードを表示します。ほかのみんなは**スマホから参加**し、全員の端末で同時にプレイ。**2つのゲームモード**を搭載し、エンジンはモードを簡単に追加できる設計です：

| モード | 遊び方 |
|------|--------------|
| ✍️ **Quiplash** | 全員に面白いお題が配られ、一番ウィットの効いた回答を書き、ルームのみんなで一騎打ちの投票。最多票がそのラウンドの勝者です。 |
| 🧠 **クイズ** | 多肢選択式の問題で、**正しく素早く**答えるほど高得点 — 連続正解には**ストリークボーナス**も。 |

**ハイライト**
- ⚡ **リアルタイム・マルチプレイヤー** — Socket.IO 上で、自動再接続つき
- 🎲 **マルチゲーム基盤** — クリーンで拡張しやすい `GameEngine` アーキテクチャ
- 🌍 **14言語** — UI *と*問題コンテンツ
- 🔊 **効果音** — Web Audio API で合成（音声ファイルはゼロ）
- 🎬 **アニメーション遷移** + canvas の紙吹雪フィナーレ
- 🔒 **セキュリティ重視** — Helmet/CSP、入力バリデーション、ソケット単位のレート制限
- 🚀 **パフォーマンス重視** — gzip、vendor チャンク分割、セルフホストのフォント

**遊び方**
1. **テレビやノートPC**でアプリを開いて **新しいゲームを始める** をタップ — ルームコードが表示されます。
2. それぞれの**スマホ**で（同じ Wi-Fi かライブURL）**ルームに参加** をタップし、名前とコードを入力。
3. プレイヤーが**3人以上**集まったら、ホストがモードを選んでスタート。
4. 答えて、投票して、スコアがぐんぐん上がるのを見守ろう — 勝者には紙吹雪を降らせちゃおう！🎊

</details>

<a id="ko-ko"></a>
<details>
<summary><b>🇰🇷 한국어</b></summary>

### 🎉 Matah
*친구들과 함께 즐기는 폭소 파티 게임.*

**Matah가 뭐냐고요?** Jackbox 스타일의 **실시간 멀티플레이어 파티 게임**이에요. 화면 하나 — TV나 노트북 — 가 4자리 방 코드를 보여 주는 **호스트 화면**이 되고, 나머지 사람들은 **휴대폰으로 참가**해 모든 기기에서 동시에 즐겨요. **두 가지 게임 모드**가 있고, 엔진은 모드를 쉽게 추가할 수 있도록 설계됐어요:

| 모드 | 방식 |
|------|--------------|
| ✍️ **Quiplash** | 모두에게 웃긴 문제가 주어지면 가장 재치 있는 답을 쓰고, 방 전체가 일대일로 투표해요. 표를 가장 많이 받은 사람이 라운드 승리. |
| 🧠 **퀴즈** | 객관식 문제로, **빠르고 정확하게** 맞힐수록 점수가 높아요 — 연속 정답에는 **연속 보너스**까지. |

**하이라이트**
- ⚡ **실시간 멀티플레이어** — Socket.IO 기반, 자동 재접속
- 🎲 **멀티 게임 플랫폼** — 깔끔하고 확장 가능한 `GameEngine` 아키텍처
- 🌍 **14개 언어** — UI *와* 문제 콘텐츠
- 🔊 **사운드 효과** — Web Audio API로 합성 (오디오 파일 0개)
- 🎬 **애니메이션 전환** + canvas 색종이 피날레
- 🔒 **보안 중심** — Helmet/CSP, 입력 검증, 소켓별 속도 제한
- 🚀 **성능 중심** — gzip, vendor 청크 분리, 자체 호스팅 폰트

**플레이 방법**
1. **TV나 노트북**에서 앱을 열고 **새 게임 시작**을 누르면 방 코드가 나와요.
2. 각자 **휴대폰**에서(같은 Wi-Fi 또는 라이브 URL) **방 참가하기**를 누르고 이름과 코드를 입력하세요.
3. **최소 3명**이 모이면 방장이 모드를 골라 시작해요.
4. 답하고, 투표하고, 점수가 올라가는 걸 지켜보세요 — 그리고 우승자에게 색종이가 쏟아지게 하세요! 🎊

</details>

<a id="hi-hi"></a>
<details>
<summary><b>🇮🇳 हिन्दी</b></summary>

### 🎉 Matah
*दोस्तों के साथ खेलने वाला धमाकेदार पार्टी गेम।*

**Matah क्या है?** Jackbox-स्टाइल का **रियल-टाइम मल्टीप्लेयर पार्टी गेम**। एक स्क्रीन — TV या लैपटॉप — **होस्ट डिस्प्ले** होती है जिस पर 4 अक्षरों का रूम कोड दिखता है। बाकी सब **अपने फ़ोन से जुड़ते हैं** और खेल सभी डिवाइस पर एक साथ चलता है। इसमें **दो गेम मोड** हैं, और इंजन इस तरह बना है कि और मोड आसानी से जोड़े जा सकें:

| मोड | कैसे चलता है |
|------|--------------|
| ✍️ **Quiplash** | सबको एक मज़ेदार सवाल मिलता है, सबसे चुटीला जवाब लिखें, फिर पूरा रूम आमने-सामने वोट करता है। सबसे ज़्यादा वोट राउंड जीतते हैं। |
| 🧠 **क्विज़** | बहुविकल्पीय सवाल, जहाँ **सही और तेज़** जवाब देने पर सबसे ज़्यादा अंक मिलते हैं — लगातार सही जवाबों पर **स्ट्रिक बोनस** भी। |

**मुख्य बातें**
- ⚡ **रियल-टाइम मल्टीप्लेयर** — Socket.IO पर, अपने-आप दोबारा कनेक्ट
- 🎲 **मल्टी-गेम प्लेटफ़ॉर्म** — साफ़, विस्तार-योग्य `GameEngine` आर्किटेक्चर
- 🌍 **14 भाषाएँ** — इंटरफ़ेस *और* सवालों की सामग्री
- 🔊 **साउंड इफ़ेक्ट** — Web Audio API से सिंथेसाइज़ (शून्य ऑडियो फ़ाइल)
- 🎬 **एनिमेटेड ट्रांज़िशन** + canvas कॉन्फ़ेटी फ़िनाले
- 🔒 **सुरक्षा-सजग** — Helmet/CSP, इनपुट वैलिडेशन, प्रति-socket रेट लिमिट
- 🚀 **परफ़ॉर्मेंस-सजग** — gzip, vendor चंक स्प्लिटिंग, सेल्फ़-होस्टेड फ़ॉन्ट

**कैसे खेलें**
1. **TV या लैपटॉप** पर ऐप खोलें और **नया गेम शुरू करें** दबाएँ — एक रूम कोड दिखेगा।
2. हर **फ़ोन** पर (वही Wi-Fi या लाइव URL) **रूम में शामिल हों** टैप करें और अपना नाम + कोड डालें।
3. **कम से कम 3 खिलाड़ियों** के जुड़ते ही, होस्ट एक मोड चुनकर शुरू करता है।
4. जवाब दें, वोट करें, स्कोर बढ़ते देखें — और जीतने वाले पर कॉन्फ़ेटी की बारिश होने दें! 🎊

</details>

<a id="nl-nederlands"></a>
<details>
<summary><b>🇳🇱 Nederlands</b></summary>

### 🎉 Matah
*Het hilarische partyspel dat je met vrienden speelt.*

**Wat is Matah?** Een **real-time multiplayer partyspel** in Jackbox-stijl. Eén scherm — een tv of laptop — is het **hostscherm** en toont een ruimtecode van 4 letters. Iedereen **sluit aan vanaf de telefoon** en het spel speelt zich op alle apparaten tegelijk af. Het komt met **twee spelmodi**, en de engine is gebouwd om er makkelijk meer toe te voegen:

| Modus | Hoe het werkt |
|------|--------------|
| ✍️ **Quiplash** | Iedereen krijgt een grappige opdracht, schrijft het geestigste antwoord en de ruimte stemt één-tegen-één. De meeste stemmen wint de ronde. |
| 🧠 **Quiz** | Meerkeuzevragen waarbij **goed én snel** antwoorden het meest oplevert — met een bonus voor **reeksen** goede antwoorden. |

**Hoogtepunten**
- ⚡ **Real-time multiplayer** via Socket.IO, met automatische herverbinding
- 🎲 **Multi-game-platform** — een nette, uitbreidbare `GameEngine`-architectuur
- 🌍 **14 talen** — interface *en* vraaginhoud
- 🔊 **Geluidseffecten** gesynthetiseerd met de Web Audio API (nul audiobestanden)
- 🎬 **Geanimeerde overgangen** + een confetti-finale op canvas
- 🔒 **Veiligheidsbewust** — Helmet/CSP, invoervalidatie, rate limiting per socket
- 🚀 **Prestatiegericht** — gzip, vendor-chunksplitsing, zelf-gehoste fonts

**Hoe speel je het**
1. Open de app op een **tv of laptop** en druk op **Nieuw spel starten** — er verschijnt een ruimtecode.
2. Tik op elke **telefoon** (zelfde wifi of de live-URL) op **Deelnemen aan een ruimte** en voer je naam + de code in.
3. Zodra **minstens 3 spelers** zijn aangesloten, kiest de host een modus en begint.
4. Antwoord, stem, zie de scores stijgen — en laat de confetti op de winnaar neerdalen! 🎊

</details>
