# Nabava — Orodjarna

Notranja aplikacija za orodjarno (Andrej Habjan): nabava, servisi Okuma, zgodovina.

**Podatki so lokalni** (localStorage v brskalniku). Ni strežnika — sinhronizacija med telefoni/računalniki zahteva zaledje (kasneje). Prijava je izbira uporabnika (brez PIN-a).

## Živa stran

https://ashblody.github.io/nabava-orodjarna/

## Funkcije

- **Nabava** — zahteve z **nujnostjo** (Ni nujno / Normalno / Nujno), kategorije (vključno **Navojni svedri**), fotografije, QR, dobavitelji, opravila
- **Podrobnosti zahteve** — tapni kartico; status lahko vodja prosto spremeni (tudi nazaj)
- **Izvoz** — Excel (CSV UTF-8) in Word (.doc): odprto/za naročilo, vse zahteve, samo nabavljeno
- **Servisi** — koledar/seznam servisov Okuma (vodja ureja)
- **Zgodovina** — pregled zahtev in servisov + izvoz
- **Prijava** — lokalni računi (tap na ime, brez PIN), vloga delavec/vodja, registracija spodaj
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

`base`: `/nabava-orodjarna/` · GitHub Pages veja `gh-pages` (samo `dist`).

## Tehnologija

Vite + TypeScript, vanilla DOM, CSS, jsQR. Brez zaledja. PWA-prijazno (manifest).
