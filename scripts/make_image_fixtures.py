"""Fixtures with known geometry for M3 checks (run: npm run fixtures).

quadrants.png (RGBA 200x120): TL red, TR green, BL blue (all opaque);
BR: top half fully transparent (RGB black, so a lost alpha shows as black),
bottom half magenta at alpha 128 (soft alpha must blend, not go solid).
photo.jpg (RGB 200x120): TL red, TR green, BL blue, BR yellow.
quadrants-q1..3.png, photo-q1..3.jpg: the same turned clockwise by 90/180/270°.
signature-photo.jpg: a phone-photo-like signature, dark blue ink on
off-white, uneven paper with noise and a shadowed corner.
foreign-stamp.pdf: sample.pdf + two Stamps from "other software", each with
its own appearance: one without /Name (EmbedPDF reads it as Unknown and
would erase it on any edit, G12), one with a custom /Name /DaDuyet (read as
Custom; edits keep the appearance).
not-an-image.png: text bytes with a .png name.
"""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter
import pikepdf

out = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures'
W, H = 200, 120
im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
px = im.load()
for y in range(H):
    for x in range(W):
        left, top = x < W // 2, y < H // 2
        if left and top: px[x, y] = (220, 30, 30, 255)
        elif not left and top: px[x, y] = (30, 160, 60, 255)
        elif left and not top: px[x, y] = (30, 70, 200, 255)
        elif y < H * 3 // 4: px[x, y] = (0, 0, 0, 0)
        else: px[x, y] = (255, 0, 255, 128)
im.save(f'{out}/quadrants.png')

jp = Image.new('RGB', (W, H))
p2 = jp.load()
for y in range(H):
    for x in range(W):
        left, top = x < W // 2, y < H // 2
        p2[x, y] = (220, 30, 30) if left and top else (30, 160, 60) if top else (30, 70, 200) if left else (240, 200, 20)
jp.save(f'{out}/photo.jpg', quality=92)

# the same pictures turned clockwise by q quarter turns, as the app stores
# them on a page displayed rotated (used by tests/m3-engine-probe.ts)
for q in (1, 2, 3):
    im.rotate(-90 * q, expand=True).save(f'{out}/quadrants-q{q}.png')
    jp.rotate(-90 * q, expand=True).save(f'{out}/photo-q{q}.jpg', quality=92)

# signature photo
random.seed(7)
SW, SH = 900, 360
sig = Image.new('RGB', (SW, SH))
sp = sig.load()
for y in range(SH):
    for x in range(SW):
        shade = 242 - 10 * (x / SW) - 8 * (y / SH)  # uneven light
        if x > SW * 0.8 and y > SH * 0.7:
            shade -= 18 * ((x - SW * 0.8) / (SW * 0.2)) * ((y - SH * 0.7) / (SH * 0.3))  # shadowed corner
        n = random.gauss(0, 3)
        sp[x, y] = (int(shade + n + 2), int(shade + n), int(shade + n - 8))
ink = Image.new('L', (SW, SH), 0)
d = ImageDraw.Draw(ink)
pts = [(80 + t * 7, 200 - 70 * math.sin(t / 9) - 25 * math.sin(t / 3)) for t in range(0, 100)]
d.line(pts, fill=255, width=7, joint='curve')
d.line([(300, 90), (360, 280), (420, 120), (470, 260)], fill=255, width=6, joint='curve')
d.line([(560, 230), (820, 205)], fill=255, width=5)
ink = ink.filter(ImageFilter.GaussianBlur(1.2))
inkc = (28, 40, 110)
ip = ink.load()
for y in range(SH):
    for x in range(SW):
        a = ip[x, y] / 255
        if a:
            r, g, b = sp[x, y]
            sp[x, y] = (int(r * (1 - a) + inkc[0] * a), int(g * (1 - a) + inkc[1] * a), int(b * (1 - a) + inkc[2] * a))
sig.save(f'{out}/signature-photo.jpg', quality=85)

# foreign stamp (unknown /Name, own appearance)
pdf = pikepdf.open(f'{out}/sample.pdf')
def stamp_ap(rgb, label):
    ap = pikepdf.Stream(pdf, f'q {rgb} rg 0 0 150 60 re f 1 1 1 rg BT /F1 18 Tf 18 22 Td ({label}) Tj ET Q'.encode())
    ap.Type = pikepdf.Name.XObject
    ap.Subtype = pikepdf.Name.Form
    ap.BBox = [0, 0, 150, 60]
    ap.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica)))
    return ap
no_name = pdf.make_indirect(pikepdf.Dictionary(
    Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Stamp, Rect=[380, 560, 530, 620], F=4,
    NM=pikepdf.String('foreign-noname'), Contents=pikepdf.String('Dấu không tên'),
    AP=pikepdf.Dictionary(N=stamp_ap('0.13 0.55 0.25', 'APPROVED')),
))
custom = pdf.make_indirect(pikepdf.Dictionary(
    Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Stamp, Rect=[380, 460, 530, 520], F=4,
    Name=pikepdf.Name('/DaDuyet'), NM=pikepdf.String('foreign-custom'), Contents=pikepdf.String('Dấu tên riêng'),
    AP=pikepdf.Dictionary(N=stamp_ap('0.55 0.13 0.45', 'DA DUYET')),
))
pdf.pages[0].obj.Annots = pdf.make_indirect(pikepdf.Array([no_name, custom]))
pdf.save(f'{out}/foreign-stamp.pdf')

open(f'{out}/not-an-image.png', 'wb').write(b'this is not an image\n')
print('ok')
