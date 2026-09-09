# Nabava — Orodjarna

Notranji prototip aplikacije za nabavo v orodjarni (Andrej Habjan).
Podatki: localStorage, brez streznika.

## Odpiranje lokalno

Zahteve: Bun ali Node.js.

cd nabava-orodjarna
bun install
bun run dev

Odpri URL ki ga izpise Vite (npr. http://localhost:5173/nabava-orodjarna/).

bun run build && bun run preview

## GitHub Pages

https://ashblody.github.io/nabava-orodjarna/

base v vite.config.ts: /nabava-orodjarna/
Pages: veja gh-pages (mapa /) ali main.

## Vloge

- Vodja nabave: zahteve, statusi, dobavitelj, opravila
- Delavec: postaja, nova zahteva, fotografija

## Tehnologija

Vite + TypeScript, vanilla DOM, CSS. Brez zaledja.
