# Nabava — Orodjarna

Notranja aplikacija za orodjarno (Andrej Habjan): nabava, zaloge, okvare strojev, servisi Okuma.

**Podatki so lokalni** (localStorage v brskalniku). Ni strežnika — sinhronizacija med telefoni/računalniki zahteva zaledje (kasneje). PIN je lahka lokalna zaščita (SHA-256), ne prava varnost.

## Živa stran

https://ashblody.github.io/nabava-orodjarna/

## Funkcije

- **Nabava** — zahteve, kategorije, fotografije, QR, dobavitelji (predlogi), opravila
- **Zaloge** — količina, min. količina, lokacija, QR, opozorilo nizke zaloge
- **Okvare** — prijava okvare stroja (Okuma, Genos, MB-*, …), foto, statusi, zgodovina
- **Servisi** — koledar/seznam servisov Okuma (vodja ureja)
- **Zgodovina** — pregled zahtev, okvar in servisov
- **Prijava** — lokalni računi (ime + PIN), vloga delavec/vodja, zapomnjen zadnji uporabnik
- **QR** — kamera / fotografija (jsQR) ali ročni vnos

## Lokalni zagon

Zahteve: Bun ali Node.js.

```bash
cd nabava-orodjarna
bun install
bun run dev
```

Odpri npr. http://localhost:5173/nabava-orodjarna/

```bash
bun run build
bun run preview
```

`base`: `/nabava-orodjarna/` · GitHub Pages veja `gh-pages`.

## Tehnologija

Vite + TypeScript, vanilla DOM, CSS, jsQR. Brez zaledja. PWA-prijazno (manifest).
