#!/usr/bin/env python3
"""
Test pages for OCR (tests/fixtures/ocr/), made from known text so the tests
can tell exactly what OCR got right:

  page.png    an A4 page "scanned" at 200 dpi, grey: a two-column official
              heading, a title, paragraphs, a ruled table with merged cells
              (one spanning two rows, one spanning two columns), a picture,
              a footer under a rule; turned 0.4 degrees, blurred, a little noise
  page.jpg    the same page as a JPEG (quality 82), 200 dpi in its JFIF header
  scan.pdf    the JPEG as a one-page scanned PDF (no text in it)
  pages.tif   a two-page TIFF (black and white, CCITT G4): the page, and a
              second page with text only
  expected.json  what is on them

  python3 scripts/make_ocr_fixtures.py [out-dir]

Needs Pillow and the Liberation Serif fonts (Debian/Ubuntu: fonts-liberation),
which have the letter widths of Times New Roman.
"""
import json
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'ocr')
DPI = 200
W, H = round(8.27 * DPI), round(11.69 * DPI)
FONTS = '/usr/share/fonts/truetype/liberation/'


def font(size_pt, bold=False, italic=False):
    name = 'LiberationSerif-' + ('BoldItalic' if bold and italic else 'Bold' if bold else 'Italic' if italic else 'Regular') + '.ttf'
    return ImageFont.truetype(FONTS + name, round(size_pt / 72 * DPI))


def px(inches):
    return round(inches * DPI)


LEFT, RIGHT = px(1.0), W - px(0.8)
expected = {'dpi': DPI, 'lines': [], 'table': None}


def text_at(d, x, y, s, f, anchor='ls'):
    d.text((x, y), s, font=f, fill=0, anchor=anchor)
    expected['lines'].append(s)


def justify(d, y, words, f, x0, x1, last):
    if last:
        d.text((x0, y), ' '.join(words), font=f, fill=0, anchor='ls')
        return
    widths = [d.textlength(w, font=f) for w in words]
    gap = (x1 - x0 - sum(widths)) / max(1, len(words) - 1)
    x = x0
    for w, ww in zip(words, widths):
        d.text((x, y), w, font=f, fill=0, anchor='ls')
        x += ww + gap


def paragraph(d, y, text, f, indent, pitch):
    """a justified paragraph with a first-line indent; returns the y after it"""
    words = text.split()
    lines, cur = [], []
    first = True
    for w in words:
        width = RIGHT - LEFT - (indent if first and not lines else 0)
        if d.textlength(' '.join(cur + [w]), font=f) > width and cur:
            lines.append(cur)
            cur = []
        cur.append(w)
    lines.append(cur)
    for i, ln in enumerate(lines):
        x0 = LEFT + (indent if i == 0 else 0)
        justify(d, y, ln, f, x0, RIGHT, i == len(lines) - 1)
        expected['lines'].append(' '.join(ln))
        y += pitch
    return y


def page_one():
    im = Image.new('L', (W, H), 255)
    d = ImageDraw.Draw(im)
    f13, f13b, f13i = font(13), font(13, True), font(13, False, True)
    pitch = px(13 / 72 * 1.5)
    # the two-column heading of an official paper
    mid_l, mid_r = (LEFT + W // 2) // 2 - px(0.3), (W // 2 + RIGHT) // 2 + px(0.1)
    y = px(0.9)
    text_at(d, mid_l, y, 'CÔNG TY CỔ PHẦN ABC', font(12, True), 'ms')
    text_at(d, mid_r, y, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', font(12, True), 'ms')
    y += pitch
    text_at(d, mid_l, y, 'Số: 15/2024/BC', font(12), 'ms')
    text_at(d, mid_r, y, 'Độc lập - Tự do - Hạnh phúc', font(13, True), 'ms')
    y += pitch * 2
    text_at(d, W // 2, y, 'BÁO CÁO KẾT QUẢ QUAN TRẮC MÔI TRƯỜNG', font(14, True), 'ms')
    y += pitch
    text_at(d, W // 2, y, '(Đợt 2 năm 2024)', f13i, 'ms')
    y += pitch * 1.6
    y = paragraph(d, y, 'Thực hiện kế hoạch bảo vệ môi trường của cơ sở, công ty đã phối hợp với đơn vị tư vấn tiến hành lấy mẫu và phân tích chất lượng nước thải, khí thải tại các vị trí đã đăng ký. Kết quả cho thấy các chỉ tiêu đều nằm trong giới hạn cho phép của quy chuẩn hiện hành.', f13, px(0.5), pitch)
    y += px(0.12)
    text_at(d, LEFT, y, '1. Kết quả quan trắc nước thải', f13b)
    y += pitch
    # the table: STT | Chỉ tiêu | Đơn vị | Kết quả | Giới hạn
    cols = [LEFT, LEFT + px(0.6), LEFT + px(2.9), LEFT + px(3.9), LEFT + px(5.0), RIGHT]
    rows = [y, y + px(0.42)] + [y + px(0.42) + px(0.36) * k for k in range(1, 6)]
    head = ['STT', 'Chỉ tiêu', 'Đơn vị', 'Kết quả', 'Giới hạn']
    body = [
        ['1', 'pH', '-', '7,2', '5,5 - 9'],
        ['2', 'BOD5', 'mg/l', '18', '50'],
        ['3', 'COD', 'mg/l', '42', None],  # under the 50 above: a cell spanning two rows
        ['4', 'Tổng chất rắn lơ lửng', 'mg/l', '25', '100'],
        [None, 'Kết luận: đạt quy chuẩn', None, None, None],  # a cell spanning columns 2-5
    ]
    lw = 2
    for x in cols:
        d.line([(x, rows[0]), (x, rows[-1])], fill=0, width=lw)
    for k, yy in enumerate(rows):
        d.line([(cols[0], yy), (cols[-1], yy)], fill=0, width=lw)
    # cut the lines where cells are merged (paint them out)
    d.line([(cols[4] + 2, rows[3]), (cols[5] - 2, rows[3])], fill=255, width=lw + 2)  # Giới hạn of rows 2-3 merged
    for c in (2, 3, 4):
        d.line([(cols[c], rows[5] + 2), (cols[c], rows[6] - 2)], fill=255, width=lw + 2)  # last row, columns 2-5 merged
    fc = font(12)
    cells = []

    def put(r, c, s, bold=False, c1=None, r1=None, align='center'):
        c1 = c1 or c + 1
        r1 = r1 or r + 1
        f = font(12, bold)
        cy = (rows[r] + rows[r1]) / 2 + px(0.06)
        x = (cols[c] + cols[c1]) / 2 if align == 'center' else cols[c] + px(0.08)
        d.text((x, cy), s, font=f, fill=0, anchor='ms' if align == 'center' else 'ls')
        cells.append({'r0': r, 'c0': c, 'r1': r1, 'c1': c1, 'text': s})

    for c, s in enumerate(head):
        put(0, c, s, True)
    for r, row in enumerate(body, start=1):
        for c, s in enumerate(row):
            if s is None:
                continue
            if r == 2 and c == 4:
                put(r, c, s, r1=4)
            elif r == 5 and c == 1:
                put(r, c, s, c1=5, align='left')
            else:
                put(r, c, s, align='left' if c == 1 else 'center')
    expected['table'] = {'rows': len(rows) - 1, 'cols': len(cols) - 1, 'cells': cells}
    y = rows[-1] + pitch
    y = paragraph(d, y, 'Ghi chú: mẫu được lấy vào ngày 12 tháng 6 năm 2024 tại hố ga cuối trước khi xả ra hệ thống thoát nước chung của khu công nghiệp.', f13i, px(0.5), pitch)
    # a picture: a small coloured drawing, on its own line
    y += px(0.2)
    box = (LEFT + px(0.2), int(y), LEFT + px(1.6), int(y + px(1.1)))
    d.rectangle(box, outline=60, width=4)
    d.ellipse((box[0] + px(0.15), box[1] + px(0.15), box[0] + px(0.75), box[1] + px(0.75)), fill=120)
    d.polygon([(box[0] + px(0.7), box[3] - px(0.1)), (box[2] - px(0.1), box[3] - px(0.1)), (box[2] - px(0.4), box[1] + px(0.3))], fill=40)
    expected['picture'] = [b / DPI for b in box]
    # the footer under a rule
    d.line([(LEFT, H - px(0.85)), (RIGHT, H - px(0.85))], fill=0, width=2)
    text_at(d, LEFT, H - px(0.6), 'Công ty Cổ phần ABC - Báo cáo quan trắc', font(11, False, True))
    text_at(d, RIGHT, H - px(0.6), '1', font(11), 'rs')
    return im


def page_two():
    im = Image.new('L', (W, H), 255)
    d = ImageDraw.Draw(im)
    f13 = font(13)
    pitch = px(13 / 72 * 1.5)
    y = px(1.2)
    text_at(d, LEFT, y, '2. Kết quả quan trắc khí thải', font(13, True))
    y += pitch
    y = paragraph(d, y, 'Khí thải sau hệ thống xử lý được lấy mẫu tại ống khói số 01 và số 02. Nồng độ bụi tổng, khí SO2 và khí NOx đều thấp hơn giới hạn của quy chuẩn kỹ thuật quốc gia về khí thải công nghiệp.', f13, px(0.5), pitch)
    y = paragraph(d, y, 'Công ty sẽ tiếp tục duy trì việc vận hành thường xuyên các công trình xử lý chất thải và thực hiện quan trắc định kỳ theo đúng giấy phép môi trường đã được cấp.', f13, px(0.5), pitch)
    return im


def scan(im, angle, seed):
    """what a scanner makes of a page: turned a little, soft, grey paper, specks"""
    rnd = random.Random(seed)
    im = im.rotate(angle, resample=Image.BICUBIC, fillcolor=255)
    im = im.filter(ImageFilter.GaussianBlur(0.7))
    px_ = im.load()
    for _ in range(1500):
        x, y = rnd.randrange(W), rnd.randrange(H)
        px_[x, y] = max(0, px_[x, y] - rnd.randrange(60, 140))
    return im.point(lambda v: 18 + v * 0.93)


os.makedirs(OUT, exist_ok=True)
one = scan(page_one(), 0.4, 1)
lines_one = expected['lines'][:]
expected['lines'] = []
two_clean = page_two()
lines_two = expected['lines'][:]
two = scan(two_clean, -0.3, 2)
one.save(os.path.join(OUT, 'page.png'), dpi=(DPI, DPI), optimize=True)
one.convert('RGB').save(os.path.join(OUT, 'page.jpg'), quality=82, dpi=(DPI, DPI))
Image.open(os.path.join(OUT, 'page.jpg')).save(os.path.join(OUT, 'scan.pdf'), resolution=DPI)
bw = [p.point(lambda v: 255 if v > 150 else 0).convert('1') for p in (one, two)]
bw[0].save(os.path.join(OUT, 'pages.tif'), compression='group4', dpi=(DPI, DPI), save_all=True, append_images=bw[1:])
expected['lines'] = lines_one
expected['page2'] = lines_two
with open(os.path.join(OUT, 'expected.json'), 'w', encoding='utf-8') as fh:
    json.dump(expected, fh, ensure_ascii=False, indent=1)
for n in sorted(os.listdir(OUT)):
    print(n, os.path.getsize(os.path.join(OUT, n)))
