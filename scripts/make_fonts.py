"""Rebuild ezPDF Sans VN (public/fonts/ezSansVN-{Regular,Bold}.ttf) from Noto Sans.

Usage: python3 scripts/make_fonts.py

Source: node_modules/@embedpdf/fonts-latin/fonts/NotoSans-{Regular,Bold}.ttf
(SIL OFL 1.1). Kept: Latin, Latin Extended, Vietnamese, Greek, Cyrillic
(with the Supplement block), the punctuation and symbols the first subset had,
plus № and ₽. Shaping tables (GSUB, GPOS, GDEF) are dropped, as before: the
app lays out text itself, one glyph per character.

"Noto Sans" is a Reserved Font Name, so the family keeps the name
"ezPDF Sans VN" (the name table of the previous build is carried over).
The file names stay the same so nothing else has to change.
"""
import os
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'node_modules/@embedpdf/fonts-latin/fonts')
OUT = os.path.join(ROOT, 'public/fonts')

EXTRA = (
    list(range(0x0370, 0x0400))  # Greek and Coptic
    + list(range(0x0400, 0x0530))  # Cyrillic + Cyrillic Supplement
    + [0x2116, 0x20BD]  # № ₽
)

for weight in ('Regular', 'Bold'):
    dst = os.path.join(OUT, f'ezSansVN-{weight}.ttf')
    previous = TTFont(dst)
    keep = set(previous.getBestCmap()) | set(EXTRA)
    src = TTFont(os.path.join(SRC, f'NotoSans-{weight}.ttf'))
    keep &= set(src.getBestCmap())
    opts = subset.Options()
    opts.layout_features = []
    opts.drop_tables += ['GSUB', 'GPOS', 'GDEF']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=keep)
    sub.subset(src)
    src['name'] = previous['name']  # renamed family (OFL Reserved Font Name)
    src.save(dst)
    cm = TTFont(dst).getBestCmap()
    cyr = sum(1 for c in cm if 0x400 <= c < 0x530)
    print(f'{os.path.basename(dst)}: {len(cm)} characters ({cyr} Cyrillic), {os.path.getsize(dst) // 1024} KB')
sys.exit(0)
