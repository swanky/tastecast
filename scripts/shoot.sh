#!/usr/bin/env bash
# Headless screenshots for the QA gate. Usage: scripts/shoot.sh <outdir>
set -euo pipefail
OUT=${1:-out/screens/m3}; BASE=${BASE:-http://localhost:8787}; mkdir -p "$OUT"
shot() { google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=$2 --virtual-time-budget=${4:-12000} --screenshot="$OUT/$1.png" "$BASE$3" 2>/dev/null; }
shot roster-1280 1280,4200 /
shot roster-390 390,7600 /
for s in itzel-robles ari-tseng ingrid-brekkhus; do shot "char-$s-1280" 1280,9800 "/c/$s"; done
shot char-ari-tseng-390 390,16000 /c/ari-tseng
shot brief-demo0-1280 1280,9000 "/brief?demo=0&confirm=1" 15000
shot brief-ingrid-request-1280 1280,9000 "/brief?character=ingrid-brekkhus&demo=1&confirm=1" 15000
shot brief-demo1-390 390,22000 "/brief?demo=1&confirm=1" 15000
python3 - "$OUT" <<'PY'
import sys, glob
from PIL import Image, ImageChops
for f in glob.glob(sys.argv[1] + '/*.png'):
    im = Image.open(f).convert('RGB')
    bg = Image.new('RGB', im.size, im.getpixel((im.width - 1, im.height - 1)))
    box = ImageChops.difference(im, bg).getbbox()
    if box and box[3] < im.height - 4: im.crop((0, 0, im.width, min(im.height, box[3] + 24))).save(f)
    print(f, Image.open(f).size)
PY
