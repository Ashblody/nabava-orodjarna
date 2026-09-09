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

Glej `deploy/lan/NAVODILA-LAN.md`. Kratko:

1. Pripravi pack (`dist/`, `server/`, `start.bat`, prazna `data/`).
2. Namesti **portable Node** v `runtime\\node\\node.exe` (ne v git).
3. Zazeni `start.bat` na PC-ju z IP (npr. 192.168.1.50).
4. Odpri `http://192.168.1.50:8787/`.

## Tehnologija

Vite + TypeScript, vanilla DOM, CSS, jsQR. LAN streznik: cisti Node (`node:http`), brez dodatnih odvisnosti.
