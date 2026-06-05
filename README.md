# 🎉 Quibble

Jackbox tarzı, gerçek zamanlı, çok oyunculu bir **parti oyunu platformu**. Host
ekranı (TV/laptop) odayı açar, oyuncular telefonlarından bir oda koduyla katılır.

İki oyun modu:
- **Quiplash** — Herkese komik bir soru gelir, cevaplar yazılır, oyuncular
  birbirlerinin cevaplarını oylar. En çok oyu alan puanı kapar.
- **Bilgi Yarışması (Trivia)** — Çoktan seçmeli sorular; doğru ve hızlı
  cevaplayan en çok puanı alır, üst üste doğrularda **seri bonusu** kazanır.

## ✨ Özellikler
- ⚡ **Gerçek zamanlı** çok oyunculu (Socket.IO)
- 🎮 **Çoklu oyun modu** — genişletilebilir motor mimarisi (`GameEngine`)
- 🌍 **4 dil** — Türkçe, English, Deutsch, Español (UI + soru içeriği)
- 🔊 **Ses efektleri** — Web Audio API ile sentezlenmiş (asset gerektirmez)
- 🎬 **Animasyonlu geçişler** + kazanan ekranında konfeti
- 🔁 **Otomatik yeniden bağlanma** (sayfa yenilense bile oturum korunur)
- 🔒 **Güvenlik** — Helmet (CSP), girdi doğrulama, soket başına rate limiting,
  payload boyut sınırı
- 🚀 **Performans** — gzip sıkıştırma, vendor chunk ayrımı, `prefers-reduced-motion`

## 📸 Ekran Görüntüleri
> "Gece Yarısı Oyun Show'u" teması — sıcak zemin, imza altın, karakterli tipografi.

| Giriş | Lobi |
|-------|------|
| ![Giriş](docs/screenshots/home.png) | ![Lobi](docs/screenshots/lobby.png) |

| Bilgi Yarışması | Skor Tablosu |
|-----------------|--------------|
| ![Trivia](docs/screenshots/trivia.png) | ![Skor](docs/screenshots/scoreboard.png) |

## Teknoloji
- **Server:** Node + Express + Socket.IO (TypeScript), bellekte oda durumu
- **Client:** React + Vite (TypeScript)
- **Shared:** Server ve client'ın ortak kullandığı tipler & olay sözleşmeleri

## Kurulum & Geliştirme
```bash
npm install
npm run dev
```
- Server: http://localhost:3001
- Client: http://localhost:5173 (terminaldeki LAN adresinden telefonla gir)

### Nasıl oynanır
1. Laptop/TV'de `http://localhost:5173` aç → **Yeni Oyun Başlat** → oda kodu çıkar.
2. Telefonlardan aynı Wi-Fi üzerinden `http://<LAN-IP>:5173` aç → **Odaya Katıl**.
3. En az 3 oyuncu katılınca host bir oyun seçip **Başlat**'a basar.
4. Oyna, oyla, puanları izle. Kazanan belli olunca konfeti yağar! 🎊

## Komutlar
| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Server + client'ı geliştirme modunda başlatır |
| `npm run build` | Production client bundle'ı üretir |
| `npm start` | Production sunucusu (client'ı aynı origin'den sunar) |
| `npm run typecheck` | Tüm workspace'leri tip kontrolünden geçirir |
| `npm run test:e2e` | İki oyun modunu uçtan uca test eder |

## 🚀 Deploy
Tek servis olarak deploy edilir — production'da Node sunucusu hem API/WebSocket'i
hem de build edilmiş client'ı aynı origin'den sunar.

**Render.com (ücretsiz, tek tık):** Repo'yu GitHub'a push edip Render'da
**New → Blueprint** ile `render.yaml`'ı seç. Hazır.

**Docker:**
```bash
docker build -t quibble .
docker run -p 3001:3001 quibble
```

**Manuel:**
```bash
npm install && npm run build
NODE_ENV=production npm start
```

## Yapı
```
quibble/
├─ shared/                # ortak tipler & socket olay sözleşmeleri
├─ server/
│  └─ src/
│     ├─ index.ts         # Socket.IO sunucusu + güvenlik + prod statik sunum
│     ├─ room.ts          # oda: üyelik, faz/timer makinesi, skor
│     ├─ engine.ts        # GameEngine arayüzü
│     ├─ engines/         # quiplash.ts, trivia.ts
│     ├─ content/         # prompts.ts, trivia.ts (4 dilde içerik)
│     └─ rateLimiter.ts   # soket başına token bucket
└─ client/
   └─ src/
      ├─ App.tsx          # rol/oturum yönlendirme
      ├─ views/           # Home, HostScreen, PlayerScreen
      ├─ components/      # Controls (dil/ses), Confetti
      ├─ i18n/            # çoklu dil
      └─ sound.ts         # sentezlenmiş ses efektleri
```
