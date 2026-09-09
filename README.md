# Nabava — Orodjarna

Notranja aplikacija za orodjarno (Andrej Habjan): nabava, zaloge, okvare strojev, servisi Okuma.

**Podatki so lokalni** (localStorage v brskalniku). Ni strežnika — sinhronizacija med telefoni/računalniki zahteva zaledje (kasneje). Prijava je izbira uporabnika (brez PIN-a).

## Živa stran

https://ashblody.github.io/nabava-orodjarna/

## Funkcije

- **Nabava** — zahteve z **nujnostjo** (Ni nujno / Normalno / Nujno), kategorije, fotografije, QR, dobavitelji, opravila
- **Podrobnosti zahteve** — tapni kartico; status lahko vodja prosto spremeni (tudi nazaj: Prejeto → Odprto/Naročeno)
- **Izvoz** — Excel (CSV UTF-8) in Word (.doc) za odprto/za naročilo ter zgodovino nabavljenega
- **Zaloge** — količina, min. količina, lokacija, QR, opozorilo nizke zaloge
- **Okvare** — prijava okvare stroja, foto, statusi (tudi nazaj), zgodovina
- **Servisi** — koledar/seznam servisov Okuma (vodja ureja)
- **Zgodovina** — pregled zahtev, okvar in servisov + izvoz
- **Prijava** — lokalni računi (tap na ime, brez PIN), vloga delavec/vodja, registracija spodaj
- **QR** — kamera / fotografija (jsQR) ali ročni vnos
- **Kako deluje** — kratek vodič na prvi strani

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
