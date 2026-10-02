#!/usr/bin/env bash
# Sestavi nabava-obvestila-pack.zip. Zahteva: bun (build:lan), zip, NODE_ZIP (Windows x64 Node zip; ni v gitu).
# Uporaba: NODE_ZIP=/workspace/node-win-x64.zip deploy/lan/build-pack.sh [izhod.zip]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$REPO/nabava-obvestila-pack.zip}"
NODE_ZIP="${NODE_ZIP:?nastavi NODE_ZIP na node-v*-win-x64.zip}"
STAGE="$(mktemp -d)/nabava-obvestila-pack"
mkdir -p "$STAGE/paket/streznik/node" "$STAGE/paket/obvestila"

(cd "$REPO" && bun run build:lan)
cp -r "$REPO/dist" "$STAGE/paket/streznik/dist"
mkdir -p "$STAGE/paket/streznik/server"
cp "$REPO"/server/*.js "$STAGE/paket/streznik/server/"
cp "$REPO/package.json" "$STAGE/paket/streznik/package.json"
cp "$REPO"/deploy/lan/streznik/*.ps1 "$STAGE/paket/streznik/"
cp "$REPO"/deploy/lan/notifier/*.ps1 "$STAGE/paket/obvestila/"
cp "$REPO"/deploy/lan/*.bat "$REPO/deploy/lan/KAKO-NAMESTIM.txt" "$STAGE/"

T="$(mktemp -d)"
unzip -q "$NODE_ZIP" '*/node.exe' -d "$T"
cp "$T"/*/node.exe "$STAGE/paket/streznik/node/node.exe"

V="$(node -p "require('$REPO/package.json').version")"
printf 'Nabava Orodjarna %s\r\nPaket zgrajen: %s\r\n' "$V" "$(date '+%Y-%m-%d %H:%M')" > "$STAGE/VERZIJA.txt"

# CRLF za .bat/.txt/.ps1 (vsi .ps1 imajo UTF-8 BOM), brez dvojnega CR
find "$STAGE" -type f \( -name '*.bat' -o -name '*.txt' -o -name '*.ps1' \) -print0 | while IFS= read -r -d '' f; do
  sed -i 's/\r$//; s/$/\r/' "$f"
done
# datoteke, ki jih pokvari neprimerno kodiranje: .txt z BOM
for f in "$STAGE"/KAKO-NAMESTIM.txt "$STAGE"/VERZIJA.txt; do
  head -c3 "$f" | grep -q $'\xef\xbb\xbf' || { printf '\xef\xbb\xbf' | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }
done

rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
  (cd "$(dirname "$STAGE")" && zip -qr -9 "$OUT" nabava-obvestila-pack)
else
  python3 - "$(dirname "$STAGE")" "$OUT" <<'PY'
import os, sys, zipfile
base, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for d, _, files in os.walk(os.path.join(base, 'nabava-obvestila-pack')):
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, base))
PY
fi
echo "OK: $OUT"; ls -la "$OUT"
