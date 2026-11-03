#!/usr/bin/env python3
"""
Rebuild public/fonts/metric/: free fonts with the letter widths of Word's usual
fonts, for devices that do not have them (see public/fonts/NOTICE.md and
src/app/word/word-fonts.css).

  python3 scripts/make_metric_fonts.py [path/to/texgyrepagella-regular.otf]

- Tinos, Arimo, Carlito: the Latin, Latin Extended, Vietnamese, Cyrillic,
  Cyrillic Extended and Greek files of @fontsource/{tinos,arimo,carlito} 5.3.0,
  copied unchanged (npm pack, so nothing is added to package.json).
- ezPDF Pagella: TeX Gyre Pagella 2.501 (Debian/Ubuntu: fonts-texgyre) subset to
  Latin and Vietnamese, renamed as the GUST Font License asks of a changed font.

Needs fonttools and brotli (pip install fonttools brotli).
"""
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'fonts', 'metric')
SUBSETS = ('latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek')
STYLES = [('400', 'normal'), ('700', 'normal'), ('400', 'italic'), ('700', 'italic')]
PAGELLA = {'regular': ('400', 'normal', 'Regular'), 'bold': ('700', 'normal', 'Bold'),
           'italic': ('400', 'italic', 'Italic'), 'bolditalic': ('700', 'italic', 'Bold Italic')}
# Latin, Latin-1, Latin Extended-A/B, spacing and combining marks, Vietnamese, punctuation, currency, a few symbols
PAGELLA_RANGES = [(0x20, 0x7E), (0xA0, 0x24F), (0x2B0, 0x36F), (0x1E00, 0x1EFF), (0x2000, 0x206F),
                  (0x20A0, 0x20C0), (0x2100, 0x2122), (0x2190, 0x2193), (0x2212, 0x2215), (0xFB00, 0xFB04)]


def fontsource(tmp):
    for name in ('tinos', 'arimo', 'carlito'):
        subprocess.run(['npm', 'pack', f'@fontsource/{name}@5.3.0', '--silent'], cwd=tmp, check=True, stdout=subprocess.DEVNULL)
        with tarfile.open(os.path.join(tmp, f'fontsource-{name}-5.3.0.tgz')) as t:
            t.extractall(os.path.join(tmp, name), filter='data')
        files = os.path.join(tmp, name, 'package', 'files')
        for sub in SUBSETS:
            for w, st in STYLES:
                shutil.copy(os.path.join(files, f'{name}-{sub}-{w}-{st}.woff2'), OUT)
        shutil.copy(os.path.join(tmp, name, 'package', 'LICENSE'), os.path.join(OUT, f'OFL-{name}.txt'))


def pagella(regular):
    unicodes = [c for a, b in PAGELLA_RANGES for c in range(a, b + 1)]
    for key, (w, st, sub) in PAGELLA.items():
        f = TTFont(regular.replace('regular', key), recalcTimestamp=False)
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['kern', 'liga', 'mark', 'mkmk', 'ccmp', 'locl']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        s = subset.Subsetter(opts)
        s.populate(unicodes=unicodes)
        s.subset(f)
        for rec in f['name'].names:
            if rec.nameID in (1, 16):
                rec.string = 'ezPDF Pagella'
            elif rec.nameID == 4:
                rec.string = f'ezPDF Pagella {sub}'
            elif rec.nameID == 6:
                rec.string = 'ezPDFPagella-' + sub.replace(' ', '')
            elif rec.nameID == 3:
                rec.string = f'ezPDF Pagella {sub} (subset of TeX Gyre Pagella 2.501)'
        if 'CFF ' in f:
            f['CFF '].cff.fontNames = ['ezPDFPagella-' + sub.replace(' ', '')]
        subset.save_font(f, os.path.join(OUT, f'ezpagella-{w}-{st}.woff2'), opts)
    lic = os.path.join(os.path.dirname(regular), '..', '..', '..', '..', 'doc', 'fonts', 'tex-gyre', 'GUST-FONT-LICENSE.txt')
    if os.path.exists(lic):
        shutil.copy(lic, os.path.join(OUT, 'GUST-FONT-LICENSE.txt'))


def main():
    regular = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrepagella-regular.otf'
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        fontsource(tmp)
    pagella(regular)
    print('wrote', len(os.listdir(OUT)), 'files to', OUT)


if __name__ == '__main__':
    main()
