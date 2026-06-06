<div align="center">

# 🎉 Quibble

### Arkadaşlarınla oynanan komik parti oyunu

*Host ekranını TV'de aç, telefonları kap, ve kaos başlasın.*

[English](README.md) · **Türkçe** · [Deutsch](README.de.md) · [Español](README.es.md)

<br/>

[![▶ Canlı Demoyu Oyna](https://img.shields.io/badge/▶_Canlı_Demoyu_Oyna-f6bd45?style=for-the-badge&logoColor=black)](https://quibble-0rjn.onrender.com)

[![CI](https://github.com/IACBI/quibble/actions/workflows/ci.yml/badge.svg)](https://github.com/IACBI/quibble/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white&style=flat-square)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB&style=flat-square)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white&style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white&style=flat-square)
![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-f6bd45?style=flat-square)

<br/>

<img src="docs/screenshots/home.png" width="49%" alt="Giriş ekranı" />
<img src="docs/screenshots/lobby.png" width="49%" alt="Lobi" />
<img src="docs/screenshots/trivia.png" width="49%" alt="Bilgi yarışması turu" />
<img src="docs/screenshots/scoreboard.png" width="49%" alt="Skor tablosu" />

</div>

---

## 🎮 Quibble nedir?

Quibble, **Jackbox tarzı, gerçek zamanlı çok oyunculu bir parti oyunudur**. Bir
ekran — TV veya laptop — **host ekranı** olur ve 4 harfli bir oda kodu gösterir.
Herkes **telefonundan katılır** ve oyun tüm cihazlarda aynı anda akar.

İçinde **iki oyun modu** gelir ve motor, yenilerini eklemek kolay olacak şekilde tasarlandı:

| Mod | Nasıl oynanır |
|-----|---------------|
| ✍️ **Quiplash** | Herkese komik bir soru gelir, en esprili cevabı yazar, sonra oda ikili düellolarda oylar. En çok oyu alan turu kazanır. |
| 🧠 **Bilgi Yarışması** | Çoktan seçmeli sorular; **doğru ve hızlı** cevaplamak en çok puanı kazandırır — üst üste doğrularda **seri bonusu** ile. |

> **▶ Hemen dene:** **<https://quibble-0rjn.onrender.com>**
> *(Ücretsiz sunucuda barınıyor — bir süre sonraki ilk istek uyanmak için ~50 sn sürebilir.)*

---

## ✨ Öne çıkanlar

- ⚡ **Gerçek zamanlı çok oyunculu** (Socket.IO), otomatik yeniden bağlanma ile
- 🎲 **Çoklu oyun platformu** — temiz, genişletilebilir `GameEngine` mimarisi
- 🌍 **4 dil** — Türkçe, English, Deutsch, Español (hem arayüz *hem* soru içeriği)
- 🔊 **Ses efektleri** Web Audio API ile sentezlenmiş (sıfır ses dosyası)
- 🎬 **Animasyonlu geçişler** + canvas konfeti finali
- 🔒 **Güvenlik odaklı** — Helmet/CSP, girdi doğrulama, soket başına rate limiting
- 🚀 **Performans odaklı** — gzip, vendor chunk ayrımı, kendi-barındırılan fontlar

---

## 🕹️ Nasıl oynanır

1. **TV veya laptopta** uygulamayı aç ve **Yeni Oyun Başlat**'a bas → oda kodu çıkar.
2. Her **telefonda** (aynı Wi-Fi ya da doğrudan canlı URL) **Odaya Katıl**'a dokun, ismini ve kodu gir.
3. **En az 3 oyuncu** katılınca host bir mod seçip başlatır.
4. Cevapla, oyla, puanların yükselişini izle — ve kazananın üstüne konfeti yağsın! 🎊

---

## 🛠️ Teknoloji

Üç paketli bir TypeScript monorepo (npm workspaces):

```
quibble/
├─ shared/   → her iki tarafın paylaştığı tipler & Socket.IO olay sözleşmeleri
├─ server/   → Express + Socket.IO oyun sunucusu (bellekte odalar + motorlar)
└─ client/   → React + Vite arayüzü (host ekranı + oyuncu kumandası)
```

**Sunucu:** Node · Express · Socket.IO  ·  **İstemci:** React · Vite  ·  **Ortak:** uçtan uca tipli olaylar

---

## 🚀 Başlangıç

```bash
npm install      # tüm workspace'leri kur
npm run dev      # sunucu :3001, istemci :5173
```

Host olmak için bilgisayarında `http://localhost:5173`'ü, katılmak için
terminalde gösterilen LAN adresini telefonlarda aç.

### Faydalı komutlar

| Komut | Ne yapar |
|-------|----------|
| `npm run dev` | Sunucu + istemciyi izleme modunda çalıştırır |
| `npm run build` | Production istemci bundle'ını üretir |
| `npm start` | Production sunucusu (build edilmiş istemciyi de sunar) |
| `npm run typecheck` | Her workspace'i tip kontrolünden geçirir |
| `npm run test:e2e` | İki modu da uçtan uca oynar |

---

## ☁️ Deploy

Tüm uygulama tek bir servis olarak deploy edilir — production'da Node sunucusu
build edilmiş istemciyi aynı origin'den sunar.

- **Render (ücretsiz, tek tık):** GitHub'a push et, **New → Blueprint** ile repoyu seç. Gerisini `render.yaml` halleder.
- **Docker:** `docker build -t quibble . && docker run -p 3001:3001 quibble`
- **Manuel:** `npm install && npm run build && NODE_ENV=production npm start`

---

## 📁 Proje yapısı

```
quibble/
├─ shared/src/index.ts        # ortak tipler + soket sözleşmeleri
├─ server/src/
│  ├─ index.ts                # Socket.IO sunucusu, güvenlik, prod statik sunum
│  ├─ room.ts                 # oda: üyelik, faz/timer makinesi, skor
│  ├─ engine.ts               # GameEngine arayüzü
│  ├─ engines/                # quiplash.ts · trivia.ts
│  ├─ content/                # prompts.ts · trivia.ts (4 dilde içerik)
│  └─ rateLimiter.ts          # soket başına token bucket
└─ client/src/
   ├─ views/                  # Home · HostScreen · PlayerScreen
   ├─ components/             # Controls (dil/ses) · Confetti
   ├─ i18n/                   # çeviriler + provider
   └─ sound.ts                # sentezlenmiş ses efektleri
```

---

<div align="center">

❤️ ve TypeScript ile yapıldı · [MIT](LICENSE) lisansı altında

</div>
