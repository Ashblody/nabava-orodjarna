# Windows obvestila (toast) — Nabava Orodjarna

Ko je Chrome/Edge zaprt, ta spremljevalec še vedno preverja LAN strežnik
in prikaže **Windows toast** ob novih zahtevah.

## Kaj potrebuješ

- LAN strežnik teče (npr. na Oro455): `http://192.168.1.124:8787/`
- Ta mapa `notifier\` na vsakem PC-ju, kjer želiš toaste
- Windows 10/11 (WinRT toast, **brez** BurntToast)

## Hitri zagon

1. Po želji uredi `notifier-config.json`:
   - `apiUrl` — privzeto `http://192.168.1.124:8787/api/data`
     (na gostitelju lahko tudi `http://127.0.0.1:8787/api/data`)
   - `pollSeconds` — privzeto `30`
   - `role` — `vodja` (samo nove/odprte zahteve) ali `all` (vse nove zahteve)
2. Dvakrat klikni **`start-notifier.bat`** (vidno okno) ali
   **`start-notifier-hidden.vbs`** (brez okna).

Stanje se shrani v:

`%LOCALAPPDATA%\NabavaOrodjarna\notifier-state.json`

## Task Scheduler (ob prijavi)

**Pomembno:** uporabi **UNC pot** (npr. `\\OROxxx\NabavaOrodjarna\notifier\...`),
ne `S:\...` — ob logonu črka diska pogosto še ni mapirana.

1. Task Scheduler → Create Task
2. Trigger: *At log on* (tvoj uporabnik)
3. Action: Start a program
   - Program: `wscript.exe`
   - Arguments: `"\\STREZNIK\NabavaOrodjarna\notifier\start-notifier-hidden.vbs"`
4. Settings: dovoli zagon na bateriji, ne ustavi ob preklopu na baterijo

Lokalna kopija mape `notifier\` (npr. v `%LOCALAPPDATA%\NabavaOrodjarna\notifier\`)
prav tako deluje, če ne želiš UNC.

## Brskalniška obvestila (ko je stran odprta)

V aplikaciji: gumb **Vklopi obvestila** (Notification API).
Deluje, ko je zavihek odprt (tudi v ozadju). Za toaste ob zaprtem brskalniku
uporabi ta Windows notifier.

## Odpravljanje težav

| Težava | Kaj preveriti |
|--------|----------------|
| Ni toastov | Strežnik na :8787, IP v `apiUrl`, požarni zid |
| Stara stanja | Izbriši `%LOCALAPPDATA%\NabavaOrodjarna\notifier-state.json` |
| Dvojni toast | Samo en notifier na PC |
| S: ne deluje ob logonu | UNC pot v Task Schedulerju |
