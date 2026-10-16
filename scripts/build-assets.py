#!/usr/bin/env python3
"""Rebuilds public/assets/ from the approved source image library and installed fonts (web size, long side 1280 px).

The public repo ships the resulting web-size images (CC BY-NC 4.0, see LICENSE-images), not the source library. The manifest of what each page shows lives in src/domain/characters.ts (file names + alt text only).
  TASTECAST_LIBRARY  default /workspace/out/characters/v5/library   (<slug>/01-reference.png … 07-*.png, turnaround.png)
  TASTECAST_FONTS    default /usr/share/fonts/truetype/sand-box/google (Fraunces, DM Sans; both SIL OFL)
"""
import os, shutil, sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
lib = Path(os.environ.get('TASTECAST_LIBRARY', '/workspace/out/characters/v5/library'))
fonts = Path(os.environ.get('TASTECAST_FONTS', '/usr/share/fonts/truetype/sand-box/google'))
out = root / 'public' / 'assets'
if not lib.is_dir():
    sys.exit(f'Image library not found: {lib}')
n = 0
for d in sorted(p for p in lib.iterdir() if p.is_dir()):
    dst = out / 'characters' / d.name
    dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(d.glob('*.png')):
        im = Image.open(f).convert('RGB')
        long = 1280  # web size, also the public-repo cap
        im.thumbnail((long, long), Image.LANCZOS)
        im.save(dst / (f.stem + '.jpg'), 'JPEG', quality=84, optimize=True, progressive=True)
        n += 1
fd = out / 'fonts'; fd.mkdir(parents=True, exist_ok=True)
for fam, files in {'Fraunces': ['Fraunces-VariableFont_SOFT,WONK,opsz,wght.ttf', 'Fraunces-Italic-VariableFont_SOFT,WONK,opsz,wght.ttf'], 'DM Sans': ['DMSans-VariableFont_opsz,wght.ttf']}.items():
    for f in files:
        src = fonts / fam / f
        if src.exists():
            shutil.copy(src, fd / f.replace(',', '_'))
        else:
            print(f'font missing (CSS falls back to Georgia/system sans): {src}')
print(f'{n} images -> {out / "characters"}; fonts -> {fd}')
