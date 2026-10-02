# Nabava — Orodjarna

Notranja aplikacija za orodjarno (Andrej Habjan): nabava, servisi Okuma, zgodovina.

**Dva načina:**
- **GitHub Pages / lokalno** — podatki v `localStorage` brskalnika.
- **LAN deljeno** — majhen Node strežnik (`server/`) na `0.0.0.0:8787`, skupni `data/db.json`.

Prijava (seansa) ostane lokalna; AppData gre na strežnik, če `/api/data` deluje.

## Živa stran

https://ashblody.github.io/nabava-orodjarna/

## Funkcije

- **Nabava** — zahteve z **nujnostjo**, kategorije (vključno **Navojni svedri**), fotografije, QR, dobavitelji, opravila
- **Podrobnosti zahteve** — status lahko vodja prosto spremeni
- **Izvoz** — Excel (CSV UTF-8) in Word (.doc)
- **Servisi** — koledar/seznam servisov Okuma
- **Zgodovina** — pregled + izvoz
- **Prijava** — lokalni računi (tap na ime, brez PIN)
- **QR** — kamera / fotografija (jsQR) ali ročni vnos
- **Preveri posodobitev** — primerja vgrajeni `APP_VERSION` z `/version.json`
- **Obvestila** — in-app badge (novo/odprto), brskalniška Notification API,
  Windows tray obvestila s toastom in zvokom (`deploy/lan/notifier/`) ko je Chrome zaprt

## Lokalni zagon

```bash
cd nabava-orodjarna
bun install
bun run dev
```

Odpri npr. http://localhost:5173/nabava-orodjarna/

```bash
bun run build          # GitHub Pages (base /nabava-orodjarna/)
bun run build:lan      # LAN (base /)
bun run server         # streze dist/ + /api/data na :8787
```

## LAN na delavnici

Vse na enem PC-ju (Oro455, `192.168.1.124`), podatki lokalno. Glej `deploy/lan/NAVODILA-LAN.md`
in `deploy/lan/KAKO-NAMESTIM.txt`. Kratko:

1. `deploy/lan/build-pack.sh` sestavi `nabava-obvestila-pack.zip` (aplikacija + portable Node + skripte).
2. Na Oro455: dvoklik `NAMESTI-STREZNIK.bat` (samodejni zagon ob prijavi, skrito).
3. Na vsakem PC-ju: dvoklik `NAMESTI-OBVESTILA.bat`, izbereš svoje ime (tray ikona + Windows obvestila + zvok).
4. Aplikacija: `http://192.168.1.124:8787/`.

Podatki: `data/db.json` + dnevne kopije v `data/backups` (zadnjih 14), neobvezno še v omrežno mapo.
Testi: `bun run test`.

## Tehnologija

Vite + TypeScript, vanilla DOM, CSS, jsQR. LAN streznik: cisti Node (`node:http`), brez dodatnih odvisnosti.
