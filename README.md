# Nabava — Orodjarna

Notranji prototip aplikacije za nabavo v orodjarni (Andrej Habjan).
Podatki se shranjujejo lokalno v brskalniku (localStorage) - ni streznika in ni pravih gesel.

## Odpiranje lokalno

Zahteve: Bun ali Node.js.

    cd nabava-orodjarna
    bun install
    bun run dev

Odpri URL (npr. http://localhost:5173/nabava-orodjarna/).

    bun run build
    bun run preview

## GitHub Pages

https://ashblody.github.io/nabava-orodjarna/

base: /nabava-orodjarna/ ; veja gh-pages.

## Vloge

- Vodja nabave: zahteve, statusi, dobavitelj, opravila
- Delavec: postaja, nova zahteva, fotografija

## Tehnologija

Vite + TypeScript, vanilla DOM, CSS. Brez zaledja.
