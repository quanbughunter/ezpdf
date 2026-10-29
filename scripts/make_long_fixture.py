#!/usr/bin/env python3
"""300-page fixture for thumbnail/search/scroll checks.

"Hải Phòng" appears exactly on pages 7, 150 and 299 (once each), so a search
must return 3 hits on those pages. Usage: python3 scripts/make_long_fixture.py out.pdf
"""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
out = sys.argv[1]
W, H = A4
c = canvas.Canvas(out, pagesize=A4)
c.setTitle('ezPDF 300 trang')
for n in range(1, 301):
    c.setFont('DejaVu', 28)
    c.drawString(72, H - 100, f'Trang {n}')
    c.setFont('DejaVu', 12)
    y = H - 140
    lines = [
        f'Đây là trang số {n} của tài liệu kiểm thử ba trăm trang.',
        'Nội dung lặp lại để kiểm tra hình thu nhỏ, cuộn và tìm kiếm.',
    ]
    if n in (7, 150, 299):
        lines.append(f'Từ khóa đặc biệt: Hải Phòng (trang {n}).')
    for line in lines:
        c.drawString(72, y, line)
        y -= 20
    # a big page number so thumbnails are distinguishable
    c.setFont('DejaVu', 120)
    c.setFillGray(0.85)
    c.drawCentredString(W / 2, H / 2 - 60, str(n))
    c.setFillGray(0)
    c.showPage()
c.save()
