# Nabava Orodjarna — LAN (en strežnik, vse lokalno)

Aplikacija in **podatki** so na enem računalniku (Oro455, `192.168.1.124`), v mapi
`C:\NabavaOrodjarna` (`data\db.json`, kopije v `data\backups`). Brez omrežne mape za podatke.
Ostali PC-ji uporabljajo samo brskalnik + (neobvezno) obvestila.

**Za uporabnika:** `deploy/lan/KAKO-NAMESTIM.txt` (3 koraki na PC).

## Paket (`nabava-obvestila-pack.zip`)

Sestavi ga `deploy/lan/build-pack.sh` (potrebuje `bun`, `NODE_ZIP` = Windows x64 Node zip).

```
KAKO-NAMESTIM.txt
NAMESTI-STREZNIK.bat   ← samo na Oro455 (enkrat)
NAMESTI-OBVESTILA.bat  ← vsak PC (enkrat, brez admina)
ODSTRANI-OBVESTILA.bat / ODSTRANI-STREZNIK.bat
paket\streznik\  (dist, server, node\node.exe, start-streznik.ps1, namesti-/odstrani-streznik.ps1)
paket\obvestila\ (nabava-obvestila.ps1, namesti-/odstrani-obvestila.ps1)
```

## Strežnik (`NAMESTI-STREZNIK.bat`)

- kopira aplikacijo + portable Node v `C:\NabavaOrodjarna` (če ni pravic: `%LOCALAPPDATA%\NabavaOrodjarnaStreznik`),
- **podatkov ne prepiše**; če `data\db.json` še ne obstaja, ga prevzame iz tekočega starega strežnika (`127.0.0.1:8787`)
  ali iz najdene datoteke (original ostane),
- samodejni zagon ob prijavi: Task Scheduler (`schtasks`, XML, skrito, brez časovne omejitve), sicer mapa Startup;
  `start-streznik.ps1` je idempotenten (port 8787 zaseden → izhod), nadzornik ponovno zažene `node`, zapisi v `streznik.log`,
  `streznik-napake.log`, `zagon.log`,
- požarni zid (`NabavaOrodjarna-8787`) samo če je zagnan kot skrbnik, sicer izpiše navodilo,
- ob prvi namestitvi vpraša za **neobvezno omrežno mapo** za dnevno kopijo (privzeto
  `\\192.168.1.50\Skupno\NabavaOrodjarna\backup`, prazno = izklopljeno). Shranjeno v `backup-share.txt`
  → `NABAVA_BACKUP_SHARE`. Če mapa ni dosegljiva, strežnik vseeno dela (opozorilo v logu).

## Varnost podatkov (`server/store.js`)

- `data/backups/db-YYYY-MM-DD_HHMMSS.json` ob zagonu + dnevno (zadnjih 14; enake se ne podvajajo),
- pokvarjen `db.json` → `db.corrupt-<čas>.json` (nikoli prepisan), aplikacija dobi prazno bazo,
- `db.prev.json` = predhodna veljavna različica pred vsakim PUT,
- API (`GET/PUT /api/data`) in oblika `db.json` nespremenjena. Testi: `bun run test` (`node --test`).

## Klepet (v1.3.0, `server/chat.js`, `src/chat.ts`)

- Zavihek **Klepet** (samo v LAN načinu): kanali Splošno, Plani, Nujno, Razno + zasebni 1:1 (seznam oseb iz `db.json` users[]).
  Delavec izbere ime enkrat (obstoječa prijava, shranjena v brskalniku).
- Sporočila v živo prek **SSE** (`GET /api/chat/events?user=ID`, ob izpadu `Last-Event-ID` ponovi zamujeno).
- Oznaka stroja (Okuma …), kljukica »opravljeno« na sporočilu, iskanje (brez šumnikov), neprebrano + značka na zavihku, zvok.
- **Shramba (ločeno od `db.json`, ki ga klepet samo bere):** `data/chat/messages.jsonl` (dodajalni dnevnik, ena vrstica = en dogodek),
  `data/chat/reads.json` (preberi-stanje). Brez SQLite. Ob zagonu se jsonl prebere v pomnilnik; pokvarjena vrstica se preskoči.
- API: `GET /api/chat/bootstrap|history|search|events`, `POST /api/chat/messages|done|read`, `GET /api/users`.
- **Za notifier:** `GET /api/notify/poll?user=ID&since=SEQ` → `{seq, items:[{seq,title,body,machine,nujno,url,…}]}`.
  Prvi klic brez `since` vrne samo trenutni `seq` (nato si ga notifier zapomni). Notifier 1.2.2 tega še ne uporablja.
- Identiteta ni preverjena z geslom (kot v celotni aplikaciji): zasebni pogovori so zasebni v aplikaciji, ne kriptografsko.
- Testi: `server/test/chat.test.js`; brskalniški preizkus: `node deploy/lan/tests/smoke-chat.mjs` (puppeteer-core + Chrome, glej glavo datoteke).
- **Posodobitev strežnika na Oro455:** razširi nov ZIP, dvoklik `NAMESTI-STREZNIK.bat` (podatki in kopije ostanejo; ustavi star strežnik, zamenja dist+server, znova zažene).

## Obvestila (tray)

`nabava-obvestila.ps1`: ikona v opravilni vrstici (Odpri / Utišaj 1 h / Preizkusni toast / Izhod), poizvedba
`GET /api/data` na 30 s, pravila kot v aplikaciji (vodja: nove zahteve; delavec: njegove zahteve »Naročeno/Prejeto«),
WinRT toast z registriranim AUMID `Nabava.Orodjarna.Obvestila` (HKCU, brez admina) + zvok `ms-winsoundevent`,
klik odpre aplikacijo (`activationType="protocol"`), rezerva: AUMID PowerShell → balloon + zvok (SoundPlayer).
Zapis: `%LOCALAPPDATA%\NabavaOrodjarna\notifier.log`. Nastavitve: `%LOCALAPPDATA%\NabavaOrodjarna\notifier\config.json`
(`serverUrl`, `userId`, `pollSeconds`, `toastAppId: "powershell"` če lasten AUMID ne deluje).

## Razvijalci

```bash
bun run build:lan
bun run server                       # lokalno, potrebuje dist/
bun run test                         # strežnik
pwsh -File deploy/lan/tests/test-notifier.ps1   # pravila obvestil
```
