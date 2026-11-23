"""Pages for the scan filters ("Màu sạch", "Xám", "Đen trắng"): a coloured
document and the same page as a phone sees it, already cut to the sheet.

Usage: python3 scripts/make_scan_filter_fixtures.py tests/fixtures/scan-filter

Writes:
  truth.png        the flat document, A4 at 150 dpi
  labels.png       what each pixel of truth.png is (see LABELS), for the checks
  <case>.jpg       the page photographed under one kind of trouble
  cases.json       the cases, the labels and their colours in truth.png

The document holds what a scan filter must keep: black print, a bold title,
a red stamp over a blue signature and over print, blue and green ink, a
yellow highlighter stroke, a light grey and a pale blue table fill, a small
colour picture, a black-and-white ID photo, a dark grey box with white
lettering and a faint pencil note.

The troubles (each case adds noise, a slight blur and JPEG at 85):
  light     warm lamp, light falling off towards one corner
  shadow    a soft shadow (a hand or the phone) over a third of the page
  sun       a hard-edged patch of sunlight, the rest in the shade
  streaks   bright streaks of light across the page and a glare spot
  smudges   pencil smears, a coffee ring, fingerprints, dust, a crease
  aged      yellowed paper with its grain, low contrast, cool light
  passport  a second page (passport-truth.png): security paper with fine
            coloured lines, a colour photo with black hair and a dark suit,
            a red stamp over a blue signature, an MRZ; a soft shadow runs
            down the page right beside the photo (the case that burnt the
            hair to grey in 0.9.6's first try)
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures/scan-filter'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

W, H = 1240, 1754
LABELS = {
    'paper': 0,
    'print': 1,
    'title': 2,
    'stamp': 3,
    'signature': 4,
    'blue_ink': 5,
    'green_ink': 6,
    'highlight': 7,
    'grey_fill': 8,
    'blue_fill': 9,
    'picture': 10,
    'pencil': 11,
    'rule': 12,
    'photo_bw': 13,
    'dark_box': 14,
}
doc = Image.new('RGB', (W, H), (255, 255, 255))
lab = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(doc)
dl = ImageDraw.Draw(lab)


def text(xy, s, font, fill, label, anchor='la'):
    d.text(xy, s, font=font, fill=fill, anchor=anchor)
    # the label: the glyphs themselves
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).text(xy, s, font=font, fill=255, anchor=anchor)
    lab.paste(label, mask=m.point(lambda v: 255 if v > 128 else 0))


body = ImageFont.truetype(SERIF, 27)
text((W // 2, 120), 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', ImageFont.truetype(BOLD, 32), (0, 0, 0), LABELS['title'], 'mm')
text((W // 2, 166), 'Độc lập - Tự do - Hạnh phúc', ImageFont.truetype(SERIF, 28), (0, 0, 0), LABELS['print'], 'mm')
text((W // 2, 262), 'BIÊN BẢN NGHIỆM THU', ImageFont.truetype(BOLD, 50), (10, 10, 10), LABELS['title'], 'mm')
lines = [
    'Hôm nay, ngày 23 tháng 11 năm 2026, tại văn phòng công ty, hai bên',
    'đã cùng kiểm tra khối lượng công việc theo hợp đồng số 18/2026.',
    'Bên nhận xác nhận các hạng mục dưới đây đã hoàn thành đúng hạn,',
    'đạt chất lượng theo yêu cầu kỹ thuật đã thống nhất từ trước.',
]
y = 350
for t in lines:
    text((110, y), t, body, (25, 25, 25), LABELS['print'])
    y += 48
# yellow highlighter over the third line (multiply, as a marker does)
hl = (100, 350 + 2 * 48 - 6, 760, 350 + 2 * 48 + 34)
arr = np.asarray(doc).astype(np.float32)
x0, y0, x1, y1 = hl
arr[y0:y1, x0:x1] *= np.array([255, 236, 70], np.float32) / 255
doc = Image.fromarray(arr.astype(np.uint8))
d = ImageDraw.Draw(doc)
hm = np.zeros((H, W), bool)
hm[y0:y1, x0:x1] = True
la = np.asarray(lab).copy()
la[hm & (la == 0)] = LABELS['highlight']
lab = Image.fromarray(la)
dl = ImageDraw.Draw(lab)

# a table: a light grey header, a pale blue row, black rules
tx0, tx1, ty = 110, 1130, 590
rows = 5
for i in range(rows):
    fill = (226, 226, 226) if i == 0 else (214, 232, 250) if i == 3 else None
    if fill:
        d.rectangle((tx0, ty + i * 58, tx1, ty + (i + 1) * 58), fill=fill)
        dl.rectangle((tx0, ty + i * 58, tx1, ty + (i + 1) * 58), fill=LABELS['grey_fill'] if i == 0 else LABELS['blue_fill'])
cells = [
    ['Hạng mục', 'Khối lượng', 'Ghi chú'],
    ['Lắp đặt thiết bị', '12 bộ', 'Đạt'],
    ['Đi dây, đấu nối', '340 m', 'Đạt'],
    ['Chạy thử', '3 ngày', 'Đạt'],
    ['Bàn giao tài liệu', '1 bộ', 'Đủ'],
]
for i, row in enumerate(cells):
    for j, c in enumerate(row):
        f = ImageFont.truetype(BOLD, 25) if i == 0 else body
        text((tx0 + 18 + j * 360, ty + i * 58 + 14), c, f, (0, 0, 0), LABELS['title'] if i == 0 else LABELS['print'])
for i in range(rows + 1):
    d.line((tx0, ty + i * 58, tx1, ty + i * 58), fill=(0, 0, 0), width=2)
    dl.line((tx0, ty + i * 58, tx1, ty + i * 58), fill=LABELS['rule'], width=2)
for x in (tx0, tx0 + 360, tx0 + 720, tx1):
    d.line((x, ty, x, ty + rows * 58), fill=(0, 0, 0), width=2)
    dl.line((x, ty, x, ty + rows * 58), fill=LABELS['rule'], width=2)

# blue and green ink
hand = ImageFont.truetype(SANS, 30)
text((110, 930), 'Ý kiến bên nhận: đồng ý nghiệm thu, đề nghị thanh toán đợt 2.', hand, (28, 58, 175), LABELS['blue_ink'])
text((110, 985), 'Đã kiểm tra hồ sơ kèm theo (bút xanh lá).', hand, (20, 130, 60), LABELS['green_ink'])
# faint pencil note
pen = Image.new('L', (W, H), 0)
ImageDraw.Draw(pen).text((700, 1060), 'ghi chú: gọi lại thứ hai', font=ImageFont.truetype(SANS, 26), fill=255)
p = np.asarray(pen) > 128
arr = np.asarray(doc).copy()
arr[p] = (150, 150, 152)
doc = Image.fromarray(arr)
d = ImageDraw.Draw(doc)
la = np.asarray(lab).copy()
la[p] = LABELS['pencil']
lab = Image.fromarray(la)
dl = ImageDraw.Draw(lab)

# a small colour picture
pic = np.zeros((170, 240, 3), np.float32)
yy, xx = np.mgrid[0:170, 0:240].astype(np.float32)
pic[..., 0] = 60 + 150 * xx / 240
pic[..., 1] = 120 + 90 * np.sin(yy / 30)
pic[..., 2] = 200 - 120 * yy / 170
pic[(xx - 150) ** 2 + (yy - 80) ** 2 < 40 ** 2] = (240, 200, 40)
doc.paste(Image.fromarray(np.clip(pic, 0, 255).astype(np.uint8)), (110, 1060))
dl.rectangle((110, 1060, 110 + 239, 1060 + 169), fill=LABELS['picture'])
d.rectangle((110, 1060, 110 + 239, 1060 + 169), outline=(0, 0, 0), width=2)

# a black-and-white ID photo (a photocopy of one): a light ground, a face, dark hair and shoulders
yy, xx = np.mgrid[0:170, 0:128].astype(np.float32)
bw = np.full((170, 128), 205, np.float32) - 25 * yy / 170
face = ((xx - 64) / 34) ** 2 + ((yy - 70) / 44) ** 2
bw = np.where(face < 1, 168 - 40 * face + 18 * np.sin(xx / 6), bw)
hair = (((xx - 64) / 40) ** 2 + ((yy - 52) / 40) ** 2 < 1) & (yy < 48)
bw = np.where(hair, 55 + 15 * np.sin(xx / 3), bw)
bw = np.where(yy > 128 + 0.004 * (xx - 64) ** 2, 70, bw)
bw += rng.normal(0, 6, bw.shape)
doc.paste(Image.fromarray(np.clip(np.stack([bw] * 3, -1), 0, 255).astype(np.uint8)), (380, 1060))
dl.rectangle((380, 1060, 380 + 127, 1060 + 169), fill=LABELS['photo_bw'])
d.rectangle((380, 1060, 380 + 127, 1060 + 169), outline=(0, 0, 0), width=2)
# a dark grey box with white lettering, as forms have
d.rectangle((900, 40, 1150, 84), fill=(88, 88, 88))
dl.rectangle((900, 40, 1150, 84), fill=LABELS['dark_box'])
d.text((1025, 62), 'MẪU SỐ 01', font=ImageFont.truetype(BOLD, 24), fill=(255, 255, 255), anchor='mm')

# signature (blue) under a red stamp that also covers some print
text((620, 1290), 'ĐẠI DIỆN BÊN GIAO', ImageFont.truetype(BOLD, 26), (0, 0, 0), LABELS['title'])
pts = [(640 + t * 4.2, 1430 + 38 * np.sin(t / 8.0) + 14 * np.cos(t / 2.6)) for t in range(95)]
d.line(pts, fill=(25, 55, 165), width=5)
dl.line(pts, fill=LABELS['signature'], width=5)
cx, cy, r = 760, 1400, 118
red = (200, 28, 38)
st = Image.new('L', (W, H), 0)
ds = ImageDraw.Draw(st)
ds.ellipse((cx - r, cy - r, cx + r, cy + r), outline=255, width=8)
ds.ellipse((cx - r + 22, cy - r + 22, cx + r - 22, cy + r - 22), outline=255, width=4)
ds.text((cx, cy - 18), 'CÔNG TY', font=ImageFont.truetype(BOLD, 28), fill=255, anchor='mm')
ds.text((cx, cy + 22), 'ĐÃ DUYỆT', font=ImageFont.truetype(BOLD, 30), fill=255, anchor='mm')
# ink of a stamp: a little uneven, multiplied over what is below
s = np.asarray(st).astype(np.float32) / 255
s *= 0.85 + 0.15 * rng.random((H, W))
arr = np.asarray(doc).astype(np.float32)
tint = np.array(red, np.float32) / 255
arr = arr * (1 - s[..., None]) + arr * tint * s[..., None]
doc = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
la = np.asarray(lab).copy()
la[s > 0.5] = LABELS['stamp']
lab = Image.fromarray(la)
d = ImageDraw.Draw(doc)
text((110, 1600), 'Người lập biểu: Trần Thị Bình', body, (0, 0, 0), LABELS['print'])

doc.save(os.path.join(OUT, 'truth.png'))
lab.save(os.path.join(OUT, 'labels.png'))
truth = np.asarray(doc).astype(np.float32)

# ---- the troubles -----------------------------------------------------------------
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = xx / W, yy / H


def smooth_step(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def finish(name, img, note):
    img = img + rng.normal(0, 3.5, img.shape)
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    out.save(os.path.join(OUT, name + '.jpg'), quality=85)
    return {'name': name, 'file': name + '.jpg', 'note': note}


paper = truth * 0.94  # paper is never pure white
cases = []

light = (0.62 + 0.38 * smooth_step(1.2 - 0.8 * u - 0.6 * v))[..., None]
cases.append(finish('light', paper * light * np.array([1.07, 0.98, 0.82]), 'đèn vàng, sáng giảm dần về một góc'))

# a soft shadow: an ellipse's edge, blurred over ~8 % of the page
dist = np.sqrt(((u - 0.95) / 0.55) ** 2 + ((v - 0.75) / 0.6) ** 2)
shade = 1 - 0.55 * (1 - smooth_step((dist - 0.85) / 0.25))
cases.append(finish('shadow', paper * (0.95 * shade)[..., None] * np.array([1.02, 1.0, 0.95]), 'bóng tay mờ che một phần ba trang'))

# sunlight through a window: a hard edge (a penumbra of ~0.4 % of the page), shade elsewhere
edge = 0.55 * u + 0.35 * v - 0.52 + 0.03 * np.sin(v * 9)
sun = 0.34 + 0.66 * smooth_step(edge / 0.006 + 0.5)
cases.append(finish('sun', paper * sun[..., None] * np.array([1.0, 0.98, 0.92]) + (1 - sun[..., None]) * np.array([0, 4, 12]), 'nắng xiên qua cửa sổ, mép bóng sắc'))

# streaks of light: brighter bands (multiplied) and a glare spot (added: it washes the ink out)
band = np.zeros_like(u)
for c, wdt in ((0.28, 0.035), (0.47, 0.06), (0.71, 0.03)):
    band += smooth_step(1 - np.abs(u * 0.8 + v * 0.45 - c) / wdt)
gain = 0.72 * (1 + 0.38 * np.clip(band, 0, 1))
glare = 120 * np.exp(-(((u - 0.62) / 0.09) ** 2 + ((v - 0.36) / 0.06) ** 2))
cases.append(finish('streaks', paper * gain[..., None] + glare[..., None], 'vệt sáng xiên và một đốm lóa'))

# smudges: graphite smears, a coffee ring, fingerprints, dust, a fold
img = paper.copy() * 0.97
dirt = np.zeros((H, W), np.float32)
for _ in range(5):
    cx_, cy_ = rng.uniform(0.1, 0.9) * W, rng.uniform(0.1, 0.9) * H
    a, b = rng.uniform(60, 160), rng.uniform(12, 30)
    t = rng.uniform(0, np.pi)
    xr = (xx - cx_) * np.cos(t) + (yy - cy_) * np.sin(t)
    yr = -(xx - cx_) * np.sin(t) + (yy - cy_) * np.cos(t)
    dirt += 0.22 * np.exp(-((xr / a) ** 2 + (yr / b) ** 2))
for _ in range(4):  # fingerprints: faint grey ovals with ridges
    cx_, cy_ = rng.uniform(0.15, 0.85) * W, rng.uniform(0.15, 0.85) * H
    rr = np.sqrt(((xx - cx_) / 32) ** 2 + ((yy - cy_) / 42) ** 2)
    dirt += 0.12 * (rr < 1) * (0.5 + 0.5 * np.sin(rr * 25))
img *= (1 - np.clip(dirt, 0, 0.6))[..., None]
# coffee ring: a brown ring and a light brown inside
rr = np.sqrt((xx - 0.78 * W) ** 2 + (yy - 0.12 * H) ** 2)
ring = np.exp(-((rr - 105) / 5) ** 2) * 0.35 + (rr < 105) * 0.08
img *= 1 - ring[..., None] * np.array([0.25, 0.55, 0.95])
# dust: dark specks
for _ in range(160):
    x_, y_ = int(rng.uniform(0, W - 3)), int(rng.uniform(0, H - 3))
    img[y_:y_ + int(rng.integers(1, 3)), x_:x_ + int(rng.integers(1, 3))] *= rng.uniform(0.3, 0.7)
# a fold: a thin darker line with a lighter side
fold = 0.5 * W + (yy - 0.5 * H) * 0.02
img *= (1 - 0.1 * np.exp(-((xx - fold) / 2.5) ** 2) + 0.04 * np.exp(-((xx - fold - 6) / 5) ** 2))[..., None]
cases.append(finish('smudges', img * (0.9 + 0.08 * (1 - v))[..., None], 'vết chì, vòng cà phê, dấu vân tay, bụi, nếp gấp'))

# aged: yellow paper with grain, low contrast, cool light
grain = Image.fromarray((rng.normal(0, 1, (H // 4, W // 4)) * 40 + 128).clip(0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
g = (np.asarray(grain).astype(np.float32) - 128) / 128
aged_paper = np.array([238, 222, 180], np.float32) * (1 + 0.05 * g[..., None])
ink = truth / 255
img = aged_paper * (0.35 + 0.65 * ink)  # ink is faded: never darker than 35 % of the paper
cases.append(finish('aged', img * (0.8 + 0.15 * u)[..., None] * np.array([0.92, 0.98, 1.08]), 'giấy cũ ngả vàng, có thớ, chữ phai, ánh sáng lạnh'))

for c in cases:
    c['doc'] = 'report'

# ---- a passport's data page: security paper, a colour photo, a soft shadow beside it ----
# (made up: no real person, no real number)
P_LABELS = {
    'paper': 0,
    'print': 1,
    'stamp': 3,
    'signature': 4,
    'mrz': 19,
    'photo_face': 15,
    'photo_hair': 16,
    'photo_suit': 17,
    'photo_ground': 18,
}
waves = np.sin(xx / 7.0 + 5 * np.sin(yy / 60.0)) * np.sin(yy / 9.0 + 4 * np.sin(xx / 80.0))
lines = np.clip((np.abs(waves) - 0.85) / 0.15, 0, 1)
paper2 = np.array([236, 240, 226], np.float32) * (1 - 0.07 * lines[..., None] * np.array([0.5, 0.25, 0.6]))
doc = Image.fromarray(paper2.clip(0, 255).astype(np.uint8))
lab = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(doc)
dl = ImageDraw.Draw(lab)
small = ImageFont.truetype(SERIF, 24)
value = ImageFont.truetype(SERIF, 32)
text((W // 2, 110), 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', ImageFont.truetype(BOLD, 30), (20, 30, 25), P_LABELS['print'], 'mm')
text((90, 200), 'CƠ QUAN CẤP / ISSUING AUTHORITY', small, (40, 55, 45), P_LABELS['print'])
text((90, 240), 'CỤC QUẢN LÝ XUẤT NHẬP CẢNH', value, (10, 10, 10), P_LABELS['print'])
# signature under a red stamp
pts = [(560 + t * 4.0, 420 + 45 * np.sin(t / 7.0) + 12 * np.cos(t / 2.2)) for t in range(90)]
d.line(pts, fill=(30, 50, 160), width=5)
dl.line(pts, fill=P_LABELS['signature'], width=5)
st = Image.new('L', (W, H), 0)
ds = ImageDraw.Draw(st)
ds.ellipse((620, 300, 860, 540), outline=255, width=8)
ds.ellipse((645, 325, 835, 515), outline=255, width=4)
ds.text((740, 420), 'ĐÃ CẤP', font=ImageFont.truetype(BOLD, 30), fill=255, anchor='mm')
s_ = np.asarray(st).astype(np.float32) / 255 * (0.85 + 0.15 * rng.random((H, W)))
arr = np.asarray(doc).astype(np.float32)
arr = arr * (1 - s_[..., None]) + arr * (np.array([205, 30, 35], np.float32) / 255) * s_[..., None]
doc = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
la = np.asarray(lab).copy()
la[s_ > 0.5] = P_LABELS['stamp']
lab = Image.fromarray(la)
d = ImageDraw.Draw(doc)
dl = ImageDraw.Draw(lab)
d.line((60, 760, W - 60, 760), fill=(60, 70, 60), width=2)
text((90, 800), 'HỘ CHIẾU / PASSPORT', ImageFont.truetype(BOLD, 28), (20, 30, 25), P_LABELS['print'])
# the photo: a light ground, a face, black hair, a dark suit, a white collar, a red tie
px0, py0, pw_, ph_ = 90, 880, 300, 390
yy2, xx2 = np.mgrid[0:ph_, 0:pw_].astype(np.float32)
photo = np.zeros((ph_, pw_, 3), np.float32) + np.array([214, 219, 216], np.float32)
plab = np.full((ph_, pw_), P_LABELS['photo_ground'], np.uint8)
face = ((xx2 - 150) / 82) ** 2 + ((yy2 - 175) / 105) ** 2
skin = np.array([226, 182, 150], np.float32) * (1.02 - 0.12 * np.clip(face, 0, 1))[..., None]
photo = np.where((face < 1)[..., None], skin, photo)
plab[face < 1] = P_LABELS['photo_face']
hair = ((((xx2 - 150) / 98) ** 2 + ((yy2 - 150) / 112) ** 2) < 1) & ((yy2 < 120) | (((xx2 - 150) / 98) ** 2 + ((yy2 - 150) / 112) ** 2 > 0.72) & (yy2 < 200))
photo = np.where(hair[..., None], np.array([38, 32, 30], np.float32) + 6 * np.sin(xx2 / 3)[..., None], photo)
plab[hair] = P_LABELS['photo_hair']
suit = yy2 > 300 - 0.35 * np.abs(xx2 - 150) + 0.0
photo = np.where(suit[..., None], np.array([28, 30, 40], np.float32), photo)
plab[suit] = P_LABELS['photo_suit']
collar = suit & (np.abs(xx2 - 150) < (yy2 - 280) * 0.45) & (yy2 < 360)
photo = np.where(collar[..., None], np.array([238, 238, 236], np.float32), photo)
tie = suit & (np.abs(xx2 - 150) < 9) & (yy2 > 300)
photo = np.where(tie[..., None], np.array([170, 30, 40], np.float32), photo)
plab[collar | tie] = 0
photo += rng.normal(0, 4, photo.shape)
doc.paste(Image.fromarray(photo.clip(0, 255).astype(np.uint8)), (px0, py0))
la = np.asarray(lab).copy()
la[py0:py0 + ph_, px0:px0 + pw_] = plab
lab = Image.fromarray(la)
d = ImageDraw.Draw(doc)
dl = ImageDraw.Draw(lab)
fields = [('Họ và tên / Full name', 'NGUYỄN VĂN AN'), ('Quốc tịch / Nationality', 'VIỆT NAM'), ('Ngày sinh / Date of birth', '01/01/2000'),
          ('Nơi sinh / Place of birth', 'HẢI PHÒNG'), ('Ngày cấp / Date of issue', '01/06/2025'), ('Có giá trị đến / Date of expiry', '01/06/2035')]
for i, (k, v_) in enumerate(fields):
    text((440, 880 + i * 72), k, small, (50, 65, 55), P_LABELS['print'])
    text((440, 908 + i * 72), v_, value, (5, 5, 5), P_LABELS['print'])
mono = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 38)
text((80, 1420), 'P<VNMNGUYEN<<VAN<AN<<<<<<<<<<<<<<<<<<<<<<<<', mono, (0, 0, 0), P_LABELS['mrz'])
text((80, 1480), 'B1234567<0VNM0001011M3506011<<<<<<<<<<<<<04', mono, (0, 0, 0), P_LABELS['mrz'])
doc.save(os.path.join(OUT, 'passport-truth.png'))
lab.save(os.path.join(OUT, 'passport-labels.png'))
truth2 = np.asarray(doc).astype(np.float32)
# a soft shadow down the page, over the photo's right side (an arm, the phone), and a
# lamp falling off towards the bottom
band_x = 0.30 + 0.04 * v
shade2 = 1 - 0.38 * np.exp(-(((u - band_x) / 0.055) ** 2))
img = truth2 * 0.93 * shade2[..., None] * (0.88 + 0.12 * (1 - v))[..., None] * np.array([1.0, 0.99, 0.95])
c = finish('passport', img, 'trang hộ chiếu: giấy có hoa văn, ảnh màu tóc đen, bóng mờ chạy dọc qua mép ảnh')
c.update({'doc': 'passport', 'band': {'x0': 0.30, 'dx': 0.04, 'sigma': 0.055}})
cases.append(c)

json.dump({'truth': 'truth.png', 'labels': 'labels.png', 'size': [W, H], 'label_ids': LABELS,
           'docs': {'report': {'truth': 'truth.png', 'labels': 'labels.png', 'label_ids': LABELS},
                    'passport': {'truth': 'passport-truth.png', 'labels': 'passport-labels.png', 'label_ids': P_LABELS}},
           'cases': cases}, open(os.path.join(OUT, 'cases.json'), 'w'), ensure_ascii=False, indent=1)
print('wrote', len(cases), 'cases to', OUT)
