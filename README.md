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

<a id="tr-trke"></a>
<details>
<summary><b>🇹🇷 Türkçe</b></summary>

### 🎉 Matah
*Arkadaşlarınla oynadığın çılgın parti oyunu.*

**Matah nedir?** Jackbox tarzı, gerçek zamanlı çok oyunculu bir parti oyunu. Bir ekran — TV veya laptop — 4 harfli oda kodunu gösteren host ekranıdır; herkes telefonundan katılır ve tüm cihazlarda aynı anda oynanır.

**Oyun modları:** ✍️ **Quiplash** — komik bir soruya en esprili cevabı yaz, sonra oda ikili düellolarla oylar. 🧠 **Bilgi Yarışması** — çoktan seçmeli sorular; doğru ve hızlı cevap en çok puanı kazandırır.

**Nasıl oynanır:**
1. TV veya laptopta uygulamayı aç ve **Yeni Oyun Başlat**'a bas — bir oda kodu belirir.
2. Her telefonda **Odaya Katıl**'a dokun, adını + kodu gir.
3. En az 3 oyuncu katılınca host bir mod seçip başlatır.
4. Cevapla, oyla, puanların yükselişini izle — ve konfetiler kazananın üstüne yağsın!

</details>

<a id="de-deutsch"></a>
<details>
<summary><b>🇩🇪 Deutsch</b></summary>

### 🎉 Matah
*Das urkomische Partyspiel für Freunde.*

**Was ist Matah?** Ein Echtzeit-Multiplayer-Partyspiel im Jackbox-Stil. Ein Bildschirm — ein TV oder Laptop — ist die Host-Anzeige mit einem 4-stelligen Raumcode; alle anderen treten per Handy bei und spielen gleichzeitig auf allen Geräten.

**Spielmodi:** ✍️ **Quiplash** — schreibe die witzigste Antwort auf eine lustige Frage, dann stimmt der Raum im Duell ab. 🧠 **Quiz** — Multiple-Choice-Fragen, bei denen schnelles und richtiges Antworten am meisten Punkte bringt.

**So wird gespielt:**
1. Öffne die App auf einem TV oder Laptop und drücke **Neues Spiel starten** — ein Raumcode erscheint.
2. Tippe auf jedem Handy auf **Raum beitreten** und gib deinen Namen + den Code ein.
3. Sobald mindestens 3 Spieler beigetreten sind, wählt der Host einen Modus und startet.
4. Antworte, stimme ab, sieh die Punkte steigen — und lass Konfetti auf den Gewinner regnen!

</details>

<a id="es-espaol"></a>
<details>
<summary><b>🇪🇸 Español</b></summary>

### 🎉 Matah
*El divertidísimo juego de fiesta para jugar con amigos.*

**¿Qué es Matah?** Un juego de fiesta multijugador en tiempo real al estilo Jackbox. Una pantalla — una TV o portátil — es la pantalla del anfitrión que muestra un código de sala de 4 letras; los demás se unen desde el móvil y juegan en todos los dispositivos a la vez.

**Modos de juego:** ✍️ **Quiplash** — escribe la respuesta más ingeniosa a una pregunta graciosa y la sala vota mano a mano. 🧠 **Trivia** — preguntas tipo test donde responder bien y rápido da más puntos.

**Cómo jugar:**
1. En una TV o portátil, abre la app y pulsa **Iniciar juego nuevo** — aparece un código de sala.
2. En cada móvil, toca **Unirse a una sala** e introduce tu nombre + el código.
3. Cuando se unan al menos 3 jugadores, el anfitrión elige un modo y empieza.
4. Responde, vota, mira subir las puntuaciones — ¡y que caiga el confeti sobre el ganador!

</details>

<a id="fr-franais"></a>
<details>
<summary><b>🇫🇷 Français</b></summary>

### 🎉 Matah
*Le jeu de soirée hilarant à jouer entre amis.*

**C'est quoi Matah ?** Un jeu de soirée multijoueur en temps réel, façon Jackbox. Un écran — une TV ou un ordi — sert d'affichage hôte montrant un code de salon à 4 lettres ; tous les autres rejoignent depuis leur téléphone et jouent sur tous les appareils en même temps.

**Modes de jeu :** ✍️ **Quiplash** — écris la réponse la plus spirituelle à une question drôle, puis le salon vote en duel. 🧠 **Quiz** — des questions à choix multiples où répondre correctement et vite rapporte le plus de points.

**Comment jouer :**
1. Sur une TV ou un ordi, ouvre l'appli et appuie sur **Lancer une partie** — un code de salon apparaît.
2. Sur chaque téléphone, touche **Rejoindre un salon** et saisis ton prénom + le code.
3. Une fois qu'au moins 3 joueurs ont rejoint, l'hôte choisit un mode et lance la partie.
4. Réponds, vote, regarde les scores grimper — et que les confettis pleuvent sur le gagnant !

</details>

<a id="it-italiano"></a>
<details>
<summary><b>🇮🇹 Italiano</b></summary>

### 🎉 Matah
*Il divertentissimo party game da giocare con gli amici.*

**Cos'è Matah?** Un party game multigiocatore in tempo reale in stile Jackbox. Uno schermo — una TV o un portatile — è il display dell'host che mostra un codice stanza di 4 lettere; tutti gli altri si uniscono dal telefono e giocano su tutti i dispositivi contemporaneamente.

**Modalità di gioco:** ✍️ **Quiplash** — scrivi la risposta più arguta a un prompt divertente, poi la stanza vota testa a testa. 🧠 **Quiz** — domande a scelta multipla in cui rispondere in modo corretto e veloce fa più punti.

**Come si gioca:**
1. Su una TV o un portatile, apri l'app e premi **Inizia una nuova partita** — appare un codice stanza.
2. Su ogni telefono, tocca **Entra in una stanza** e inserisci il tuo nome + il codice.
3. Quando almeno 3 giocatori si sono uniti, l'host sceglie una modalità e inizia.
4. Rispondi, vota, guarda i punteggi salire — e lascia che i coriandoli piovano sul vincitore!

</details>

<a id="pt-portugus"></a>
<details>
<summary><b>🇵🇹 Português</b></summary>

### 🎉 Matah
*O jogo de festa hilariante que jogas com amigos.*

**O que é o Matah?** Um jogo de festa multijogador em tempo real, ao estilo Jackbox. Um ecrã — uma TV ou portátil — é o ecrã do anfitrião que mostra um código de sala de 4 letras; toda a gente entra a partir do telemóvel e joga em todos os dispositivos ao mesmo tempo.

**Modos de jogo:** ✍️ **Quiplash** — escreve a resposta mais espirituosa a uma pergunta engraçada e depois a sala vota frente a frente. 🧠 **Perguntas e Respostas** — perguntas de escolha múltipla em que responder certo e depressa pontua mais.

**Como jogar:**
1. Numa TV ou portátil, abre a aplicação e carrega em **Iniciar Novo Jogo** — aparece um código de sala.
2. Em cada telemóvel, toca em **Entrar numa Sala** e introduz o teu nome + o código.
3. Assim que pelo menos 3 jogadores tiverem entrado, o anfitrião escolhe um modo e começa.
4. Responde, vota, vê as pontuações a subir — e deixa cair os confettis sobre o vencedor!

</details>

<a id="ru-ru"></a>
<details>
<summary><b>🇷🇺 Русский</b></summary>

### 🎉 Matah
*Уморительная вечериночная игра для компании друзей.*

**Что такое Matah?** Многопользовательская вечериночная игра в реальном времени в стиле Jackbox. Один экран — телевизор или ноутбук — служит дисплеем ведущего и показывает код комнаты из 4 букв; все остальные подключаются со своих телефонов и играют сразу на всех устройствах.

**Режимы игры:** ✍️ **Quiplash** — придумайте самый остроумный ответ на смешное задание, а затем комната голосует в дуэлях. 🧠 **Викторина** — вопросы с вариантами ответов, где больше всего очков приносит быстрый и правильный ответ.

**Как играть:**
1. На телевизоре или ноутбуке откройте приложение и нажмите **Начать новую игру** — появится код комнаты.
2. На каждом телефоне нажмите **Войти в комнату** и введите своё имя и код.
3. Как только наберётся хотя бы 3 игрока, ведущий выбирает режим и начинает игру.
4. Отвечайте, голосуйте, следите за ростом очков — и пусть на победителя прольётся конфетти!

</details>

<a id="ar-ar"></a>
<details>
<summary><b>🇸🇦 العربية</b></summary>

<div dir="rtl">

### 🎉 Matah
*لعبة الحفلات المضحكة التي تلعبها مع أصدقائك.*

**ما هي Matah؟** لعبة حفلات جماعية فورية على غرار Jackbox. تكون إحدى الشاشات — تلفاز أو حاسوب محمول — هي شاشة المضيف التي تعرض رمز غرفة مكوّنًا من 4 أحرف؛ ينضم الجميع الآخرون من هواتفهم ويلعبون عبر كل الأجهزة في آنٍ واحد.

**أنماط اللعب:** ✍️ **Quiplash** — اكتب أذكى إجابة لسؤال مضحك، ثم تصوّت الغرفة في مواجهات مباشرة. 🧠 **أسئلة وأجوبة** — أسئلة متعددة الخيارات حيث تمنحك الإجابة الصحيحة والسريعة أعلى النقاط.

**كيف تلعب:**
1. على تلفاز أو حاسوب محمول، افتح التطبيق واضغط على **ابدأ لعبة جديدة** — يظهر رمز الغرفة.
2. على كل هاتف، اضغط على **انضم إلى غرفة** وأدخل اسمك + الرمز.
3. بمجرد انضمام 3 لاعبين على الأقل، يختار المضيف نمطًا ويبدأ.
4. أجب، وصوّت، وشاهد النقاط تتصاعد — ودع الزينة تتساقط على الفائز!

</div>

</details>

<a id="zh-zh"></a>
<details>
<summary><b>🇨🇳 中文</b></summary>

### 🎉 Matah
*和朋友一起玩的爆笑派对游戏。*

**Matah 是什么？** 一款 Jackbox 风格的实时多人派对游戏。一块屏幕——电视或笔记本——作为主持显示屏，展示一个 4 位的房间码；其他所有人用手机加入，在各自的设备上同时游玩。

**游戏模式：** ✍️ **Quiplash**——为搞笑的题目写出最机智的答案，然后由全房间一对一投票。🧠 **知识问答**——选择题模式，答得又对又快得分最高。

**怎么玩：**
1. 在电视或笔记本上打开应用，点击 **开始新游戏**——房间码就会出现。
2. 在每部手机上点击 **加入房间**，输入你的名字和房间码。
3. 至少有 3 名玩家加入后，房主选择一个模式并开始。
4. 作答、投票、看着分数节节攀升——再让彩纸为赢家洒落吧！

</details>

<a id="ja-ja"></a>
<details>
<summary><b>🇯🇵 日本語</b></summary>

### 🎉 Matah
*友達とワイワイ盛り上がる爆笑パーティーゲーム。*

**Matah ってなに？** Jackbox スタイルのリアルタイム・マルチプレイヤー・パーティーゲーム。テレビやノートPCの画面1つがホスト表示になり、4文字のルームコードを表示します。ほかのみんなはスマホから参加し、全員の端末で同時にプレイできます。

**ゲームモード：** ✍️ **Quiplash** — 面白いお題に一番ウィットの効いた回答を書いて、ルームのみんなで一騎打ちの投票。 🧠 **クイズ** — 多肢選択式の問題で、正しく素早く答えるほど高得点。

**遊び方：**
1. テレビやノートPCでアプリを開いて **新しいゲームを始める** をタップ — ルームコードが表示されます。
2. それぞれのスマホで **ルームに参加** をタップして、名前とコードを入力。
3. プレイヤーが3人以上集まったら、ホストがモードを選んでスタート。
4. 答えて、投票して、スコアがぐんぐん上がるのを見守ろう — 勝者には紙吹雪を降らせちゃおう！

</details>

<a id="ko-ko"></a>
<details>
<summary><b>🇰🇷 한국어</b></summary>

### 🎉 Matah
*친구들과 함께 즐기는 폭소 파티 게임.*

**Matah가 뭐냐고요?** Jackbox 스타일의 실시간 멀티플레이어 파티 게임이에요. 화면 하나 — TV나 노트북 — 가 4자리 방 코드를 보여 주는 호스트 화면이 되고, 나머지 사람들은 휴대폰으로 참가해 모든 기기에서 동시에 즐겨요.

**게임 모드:** ✍️ **Quiplash** — 웃긴 문제에 가장 재치 있는 답을 쓰고, 방 전체가 일대일로 투표해요. 🧠 **퀴즈** — 객관식 문제로, 빠르고 정확하게 맞힐수록 점수가 높아요.

**플레이 방법:**
1. TV나 노트북에서 앱을 열고 **새 게임 시작**을 누르면 방 코드가 나와요.
2. 각자 휴대폰에서 **방 참가하기**를 누르고 이름과 코드를 입력하세요.
3. 최소 3명이 모이면 방장이 모드를 골라 시작해요.
4. 답하고, 투표하고, 점수가 올라가는 걸 지켜보세요 — 그리고 우승자에게 색종이가 쏟아지게 하세요!

</details>

<a id="hi-hi"></a>
<details>
<summary><b>🇮🇳 हिन्दी</b></summary>

### 🎉 Matah
*दोस्तों के साथ खेलने वाला धमाकेदार पार्टी गेम।*

**Matah क्या है?** Jackbox-स्टाइल का रियल-टाइम मल्टीप्लेयर पार्टी गेम। एक स्क्रीन — TV या लैपटॉप — होस्ट डिस्प्ले होती है जिस पर 4 अक्षरों का रूम कोड दिखता है; बाकी सब अपने फ़ोन से जुड़ते हैं और सभी डिवाइस पर एक साथ खेलते हैं।

**गेम मोड:** ✍️ **Quiplash** — किसी मज़ेदार सवाल का सबसे चुटीला जवाब लिखें, फिर पूरा रूम आमने-सामने वोट करता है। 🧠 **क्विज़** — बहुविकल्पीय सवाल, जहाँ सही और तेज़ जवाब देने पर सबसे ज़्यादा अंक मिलते हैं।

**कैसे खेलें:**
1. TV या लैपटॉप पर ऐप खोलें और **नया गेम शुरू करें** दबाएँ — एक रूम कोड दिखेगा।
2. हर फ़ोन पर **रूम में शामिल हों** टैप करें और अपना नाम + कोड डालें।
3. कम से कम 3 खिलाड़ियों के जुड़ते ही, होस्ट एक मोड चुनकर गेम शुरू करता है।
4. जवाब दें, वोट करें, स्कोर बढ़ते देखें — और जीतने वाले पर कॉन्फ़ेटी की बारिश होने दें!

</details>

<a id="nl-nederlands"></a>
<details>
<summary><b>🇳🇱 Nederlands</b></summary>

### 🎉 Matah
*Het hilarische partyspel dat je met vrienden speelt.*

**Wat is Matah?** Een real-time multiplayer partyspel in Jackbox-stijl. Eén scherm — een tv of laptop — is het hostscherm dat een ruimtecode van 4 letters toont; iedereen sluit aan vanaf hun telefoon en speelt tegelijk op alle apparaten.

**Spelmodi:** ✍️ **Quiplash** — schrijf het geestigste antwoord op een grappige opdracht en de ruimte stemt in één-tegen-één duels. 🧠 **Quiz** — meerkeuzevragen waarbij goed én snel antwoorden het meest oplevert.

**Hoe speel je het:**
1. Open de app op een tv of laptop en druk op **Nieuw spel starten** — er verschijnt een ruimtecode.
2. Tik op elke telefoon op **Deelnemen aan een ruimte** en voer je naam + de code in.
3. Zodra minstens 3 spelers zijn aangesloten, kiest de host een modus en begint.
4. Antwoord, stem, zie de scores stijgen — en laat de confetti op de winnaar neerdalen!

</details>

