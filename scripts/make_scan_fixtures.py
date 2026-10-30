"""Synthetic phone photos of a document, for the scan feature.

Usage: python3 scripts/make_scan_fixtures.py tests/fixtures/scan

Writes:
  doc.png              the flat document (ground truth), A4 at 150 dpi
  photo-*.jpg          the document photographed: perspective, a table
                       behind it, uneven light, a colour cast, noise, JPEG
  truth.json           per photo: the sheet's corners (0-1, as displayed),
                       the paper area to sample, notes

The photos cover: a dark wood table, a grey desk, a light beige table (low
contrast), a busy patterned cloth, a strong shadow across the page, a
photo stored sideways with EXIF Orientation 6 (as phones do), the page
lying on another sheet that shows along two sides, and a woven cloth with
pale squares.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures/scan'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# ---- the document --------------------------------------------------------------
W, H = 1240, 1754  # A4 at 150 dpi
doc = Image.new('RGB', (W, H), (255, 255, 255))
d = ImageDraw.Draw(doc)
d.text((W // 2, 150), 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', font=ImageFont.truetype(FONT_B, 34), fill=(0, 0, 0), anchor='mm')
d.text((W // 2, 200), 'Độc lập - Tự do - Hạnh phúc', font=ImageFont.truetype(FONT, 30), fill=(0, 0, 0), anchor='mm')
d.text((W // 2, 320), 'GIẤY XÁC NHẬN', font=ImageFont.truetype(FONT_B, 46), fill=(0, 0, 0), anchor='mm')
body = ImageFont.truetype(FONT, 28)
lines = [
    'Hôm nay, ngày 29 tháng 10 năm 2026, chúng tôi xác nhận',
    'ông Nguyễn Văn An đã hoàn thành khóa đào tạo nghiệp vụ',
    'kế toán doanh nghiệp tại trung tâm, với kết quả loại giỏi.',
    'Giấy này có giá trị để bổ sung hồ sơ xin việc và chỉ dùng',
    'trong phạm vi được ghi rõ ở trên, không dùng vào việc khác.',
]
y = 430
for t in lines:
    d.text((130, y), t, font=body, fill=(20, 20, 20))
    y += 52
# a table
for i in range(5):
    d.rectangle((130, 760 + i * 60, 1110, 820 + i * 60), outline=(0, 0, 0), width=2)
for i, t in enumerate(['Môn học', 'Lý thuyết', 'Thực hành', 'Tổng kết']):
    d.text((150, 778 + (i + 1) * 60 if i else 778), t, font=body, fill=(0, 0, 0))
d.line((620, 760, 620, 1060), fill=(0, 0, 0), width=2)
# red stamp and blue signature
cx, cy, r = 880, 1350, 120
d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(205, 30, 35), width=8)
d.ellipse((cx - r + 22, cy - r + 22, cx + r - 22, cy + r - 22), outline=(205, 30, 35), width=4)
d.text((cx, cy), 'ĐÃ DUYỆT', font=ImageFont.truetype(FONT_B, 34), fill=(205, 30, 35), anchor='mm')
pts = [(760 + t * 4, 1400 + 40 * np.sin(t / 9.0) + 15 * np.cos(t / 3.0)) for t in range(90)]
d.line(pts, fill=(25, 60, 170), width=5)
d.text((130, 1600), 'Người lập biểu', font=body, fill=(0, 0, 0))
doc.save(os.path.join(OUT, 'doc.png'))
docA = np.asarray(doc).astype(np.float32)

# ---- backgrounds -------------------------------------------------------------------
def wood(w, h):
    x = np.linspace(0, 1, w)[None, :]
    yy = np.linspace(0, 1, h)[:, None]
    grain = np.sin((x * 40 + np.sin(yy * 9) * 2) * np.pi) * 0.5 + 0.5
    base = np.stack([105 + 40 * grain, 70 + 25 * grain, 45 + 15 * grain], -1)
    return base + rng.normal(0, 6, (h, w, 3))

def grey_desk(w, h):
    return np.full((h, w, 3), (118, 120, 124), np.float32) + rng.normal(0, 9, (h, w, 3))

def beige(w, h):
    return np.full((h, w, 3), (214, 200, 178), np.float32) + rng.normal(0, 5, (h, w, 3))

def cloth(w, h):
    yy, xx = np.mgrid[0:h, 0:w]
    check = ((xx // 60 + yy // 60) % 2).astype(np.float32)[..., None]
    a = np.array([40, 90, 160], np.float32)
    b = np.array([200, 170, 60], np.float32)
    return a * check + b * (1 - check) + rng.normal(0, 8, (h, w, 3))

def perspective_coeffs(src, dst):
    """PIL wants the map from output (photo) pixels back to input (doc) pixels."""
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

def camera_quad(rx, ry, rz, dist, size=(1500, 2000), shift=(0, 0), f=1500.0):
    """Where an A4 sheet's corners land in a photo: a pinhole camera with its
    principal point at the image centre, the sheet turned by rx, ry, rz
    degrees and `dist` metres away (a phone's lens: f about 0.75 x the long side)."""
    w, h = size
    a, b = 0.105, 0.1485
    pts = np.array([[-a, -b, 0], [a, -b, 0], [a, b, 0], [-a, b, 0]], float)
    def rot(ax, deg):
        t = np.radians(deg); c, s_ = np.cos(t), np.sin(t)
        return {'x': np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]]), 'y': np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]]), 'z': np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])}[ax]
    R = rot('z', rz) @ rot('y', ry) @ rot('x', rx)
    cam = pts @ R.T + np.array([shift[0], shift[1], dist])
    return [(w / 2 + f * x / z, h / 2 + f * y / z) for x, y, z in cam]

def photo(name, bg, quad, size=(1500, 2000), light=None, cast=(1.06, 1.0, 0.86), blur=0.8, exif_rotate=False, note=''):
    w, h = size
    back = np.clip(bg(w, h), 0, 255).astype(np.float32)
    coeffs = perspective_coeffs([(0, 0), (W, 0), (W, H), (0, H)], quad)
    warped = doc.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(0, 0, 0))
    mask = Image.new('L', (W, H), 255).transform((w, h), Image.PERSPECTIVE, coeffs, Image.BILINEAR, fillcolor=0)
    m = np.asarray(mask).astype(np.float32)[..., None] / 255
    paper = np.asarray(warped).astype(np.float32) * 0.93  # paper is never pure white
    img = paper * m + back * (1 - m)
    # light: a gradient across the frame, darker where a hand or phone shades it
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    shade = light(xx / w, yy / h) if light else 0.85 + 0.15 * (1 - yy / h)
    img = img * shade[..., None] * np.array(cast, np.float32)
    img = img + rng.normal(0, 4, img.shape)
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    q = [(x / w, y / h) for x, y in quad]
    if exif_rotate:
        # stored sideways: the sensor's landscape frame, Orientation 6 = turn 90° clockwise to show
        stored = out.transpose(Image.ROTATE_90)
        exif = Image.Exif()
        exif[0x0112] = 6
        stored.save(os.path.join(OUT, name), quality=85, exif=exif.tobytes())
    else:
        out.save(os.path.join(OUT, name), quality=85)
    return {'file': name, 'quad': q, 'width': w, 'height': h, 'note': note}

truth = [
    photo('photo-wood.jpg', wood, camera_quad(18, -6, 3, 0.42), note='bàn gỗ tối, chụp nghiêng 18°'),
    photo('photo-desk.jpg', grey_desk, camera_quad(28, 8, -4, 0.40, shift=(0.01, 0.0)), note='bàn xám, chụp nghiêng 28°'),
    photo('photo-beige.jpg', beige, camera_quad(12, 4, 1, 0.37), note='bàn màu be sáng: tương phản thấp'),
    photo('photo-cloth.jpg', cloth, camera_quad(-15, -10, 6, 0.42), note='khăn ca rô sặc sỡ'),
    photo(
        'photo-shadow.jpg',
        grey_desk,
        camera_quad(20, 5, -2, 0.40),
        light=lambda x, y: 1.0 - 0.5 * np.clip((x - 0.35) * 2.2, 0, 1) * np.clip(1.3 - y, 0, 1),
        note='bóng đổ đậm che nửa trang',
    ),
    photo('photo-exif.jpg', wood, camera_quad(22, 0, -5, 0.41), exif_rotate=True, note='ảnh lưu nằm ngang, EXIF Orientation 6'),
    photo('photo-flat.jpg', grey_desk, camera_quad(2, 1, 0, 0.36), note='chụp thẳng từ trên xuống'),
]
# ---- a busy woven cloth, and a page lying on another one ---------------------------
def tapestry(w, h, turn=4.0):
    """Brown woven cloth with pale squares, like a sofa throw: straight
    lines everywhere, some of them nearly as light as paper."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.radians(turn)
    u = xx * np.cos(t) + yy * np.sin(t)
    v = -xx * np.sin(t) + yy * np.cos(t)
    c = 110.0
    iu, iv = np.floor(u / c), np.floor(v / c)
    fu, fv = u / c - iu, v / c - iv
    kind = ((iu * 7 + iv * 3) % 4).astype(np.int32)
    dark = np.array([62, 40, 30], np.float32)
    mid = np.array([118, 84, 60], np.float32)
    pale = np.array([205, 186, 156], np.float32)
    edge = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    weave = 0.5 + 0.5 * np.sin(u * 1.9) * np.sin(v * 1.9)
    img = np.empty((h, w, 3), np.float32)
    for k in range(4):
        m = kind == k
        if k == 0:  # pale square with a dark frame inside
            col = np.where(((edge > 0.12) & (edge < 0.2))[..., None], dark, pale)
        elif k == 1:  # dark with pale stripes
            col = np.where((np.sin(u * 0.45) > 0.55)[..., None], pale * 0.9, dark)
        elif k == 2:  # mid brown, hatched
            col = np.where((np.sin((u + v) * 0.5) > 0.6)[..., None], dark, mid)
        else:  # pale centre in a dark square
            col = np.where((edge > 0.28)[..., None], pale * 0.95, dark)
        img[m] = col[m]
    img = np.where((edge < 0.04)[..., None], dark * 0.8, img)
    img = img * (0.85 + 0.15 * weave)[..., None]
    return img + rng.normal(0, 10, (h, w, 3))

def photo_stack(name, bg, quad, under, size=(1500, 2000), cast=(1.04, 1.0, 0.92), blur=0.8, note=''):
    """The document lying on another sheet that shows along two sides, the
    top sheet's shadow falling on it. The truth is the top sheet."""
    from scipy.ndimage import distance_transform_edt
    w, h = size
    img = np.clip(bg(w, h), 0, 255).astype(np.float32)
    blank = Image.new('RGB', (W, H), (250, 250, 248))
    cu = perspective_coeffs([(0, 0), (W, 0), (W, H), (0, H)], under)
    mu = np.asarray(Image.new('L', (W, H), 255).transform((w, h), Image.PERSPECTIVE, cu, Image.BILINEAR, fillcolor=0)).astype(np.float32)[..., None] / 255
    paper_u = np.asarray(blank.transform((w, h), Image.PERSPECTIVE, cu, Image.BICUBIC, fillcolor=(0, 0, 0))).astype(np.float32) * 0.92
    img = paper_u * mu + img * (1 - mu)
    cf = perspective_coeffs([(0, 0), (W, 0), (W, H), (0, H)], quad)
    mf = np.asarray(Image.new('L', (W, H), 255).transform((w, h), Image.PERSPECTIVE, cf, Image.BILINEAR, fillcolor=0)).astype(np.float32)[..., None] / 255
    # the top sheet's shadow on the one under it: a few percent, fading out over ~2 % of the frame
    dist = distance_transform_edt(mf[..., 0] < 0.5)
    shadow = 1 - 0.06 * np.exp(-dist / 30.0)
    img = img * np.where(mu > 0.5, shadow[..., None], 1)
    paper_f = np.asarray(doc.transform((w, h), Image.PERSPECTIVE, cf, Image.BICUBIC, fillcolor=(0, 0, 0))).astype(np.float32) * 0.94
    img = paper_f * mf + img * (1 - mf)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    shade = 0.86 + 0.14 * (1 - yy / h) - 0.05 * (xx / w)
    img = img * shade[..., None] * np.array(cast, np.float32)
    img = img + rng.normal(0, 4, img.shape)
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    out.save(os.path.join(OUT, name), quality=85)
    return {'file': name, 'quad': [(x / w, y / h) for x, y in quad], 'width': w, 'height': h, 'note': note}

# appended after the others, so the photos above (and the random numbers they use) stay the same
truth += [
    photo_stack(
        'photo-stack.jpg',
        tapestry,
        camera_quad(10, -4, 2, 0.40, shift=(-0.006, 0.006)),
        camera_quad(10, -4, 4.5, 0.40, shift=(0.012, -0.012)),
        note='tờ trên tờ, tờ dưới lộ ra hai cạnh, khăn hoa văn',
    ),
    photo('photo-tapestry.jpg', tapestry, camera_quad(14, 5, -3, 0.39), note='khăn hoa văn có ô màu be sáng'),
]
json.dump({'doc': 'doc.png', 'docSize': [W, H], 'photos': truth}, open(os.path.join(OUT, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
print('wrote', OUT, [t['file'] for t in truth])
