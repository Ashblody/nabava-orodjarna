# Nabava Orodjarna — LAN (deljeni način)

Aplikacija teče na enem Windows računalniku (npr. Oro455) in je dostopna vsem na Wi‑Fi / LAN.
Podatki so v datoteki `data\\db.json` (ne v brskalniku).

## Predpogoji

- Mapa na omrežnem disku, npr. `S:\\NabavaOrodjarna` (ali lokalna kopija).
- **Portable Node.js** (brez namestitve) v:
  ```
  runtime\\node\\node.exe
  ```
  Priporočeno: uradni Windows x64 zip z [nodejs.org](https://nodejs.org/)
  (npr. `node-v20.x.x-win-x64`) — vsebino razširi v `runtime\\node\\`, da obstaja `node.exe`.

**Ne commitaj / ne kopiraj Node binark v git.** Samo na strežniški PC.

## Struktura mape

```
NabavaOrodjarna\\
  start.bat
  NAVODILA-LAN.md
  README.md
  dist\\              ← zgrajena aplikacija (base /)
  server\\index.js
  package.json       ← type: module (za node)
  data\\              ← tukaj nastane db.json
  runtime\\node\\node.exe
```

## Zagon

1. Na PC-ju, ki bo gostil (npr. Oro455), odpri mapo.
2. Dvakrat klikni **`start.bat`**.
3. V brskalniku (tem PC-ju ali telefonih v omrežju) odpri:
   - `http://192.168.1.124:8787/`
     (zamenjaj z IP gostitelja, če je drugačen)
4. Windows požarni zid lahko prvič vpraša — dovoli **zasebno omrežje** za Node na vratih **8787**.

## Posodobitev aplikacije

1. Ustavi strežnik (Ctrl+C v oknu start.bat).
2. Zamenjaj mapo `dist\\` z novo zgradbo (`build:lan`).
3. Po potrebi posodobi `server\\`.
4. **Ne briši** `data\\` — tam so zahteve in uporabniki.
5. Spet zaženi `start.bat`.
6. V aplikaciji: gumb **Preveri posodobitev** (primerja vgrajeno različico z `/version.json`).

## Selitev iz lokalnega brskalnika

Če je strežnik prazen, aplikacija enkrat prenese podatke iz `localStorage`
naprave, ki se prva poveže. Nato je vir resnice strežnik.

Prijava (seansa) ostane lokalna v brskalniku; seznami uporabnikov/zahtev so deljeni.

## Odpravljanje težav

| Težava | Kaj preveriti |
|--------|----------------|
| start.bat javi manjkajoč Node | `runtime\\node\\node.exe` |
| Telefon ne odpre strani | isti Wi‑Fi, IP gostitelja, vrata 8787, požarni zid |
| Podatki se ne shranjujejo | obstaja `data\\`, pravice pisanja na S: |
| Stara različica v brskalniku | trda osvežitev / Preveri posodobitev |

## Razvijalci

```bash
bun run build:lan
bun run server   # lokalno, potrebuje dist/
```

Privzeti port: `8787`. Podatki: `NABAVA_DATA_DIR` (privzeto `./data`).

## Windows toast obvestila (Chrome zaprt)

Glej mapo `notifier\` in `notifier\NAVODILA-OBVESTILA.md`.

Kratko: na vsakem PC-ju zaženi `notifier\start-notifier-hidden.vbs`
(ali Task Scheduler ob prijavi z **UNC** potjo). Privzeti API:
`http://192.168.1.124:8787/api/data`.

V brskalniku (ko je stran odprta): gumb **Vklopi obvestila**.
