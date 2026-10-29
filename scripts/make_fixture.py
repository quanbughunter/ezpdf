import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pikepdf
pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
out = sys.argv[1]
tmp = out + '.tmp.pdf'
c = canvas.Canvas(tmp, pagesize=A4)
W, H = A4
for i, label in enumerate(['Trang 1 – bình thường', 'Trang 2 – Rotate 90', 'Trang 3 – CropBox lệch', 'Trang 4 – Rotate 270']):
    c.setFont('DejaVu', 20); c.drawString(72, H-90, label)
    c.setFont('DejaVu', 12)
    y = H-130
    for line in ['Tài liệu mẫu để kiểm tra ezPDF. Đoạn này dùng cho tìm kiếm và highlight.',
                 'Cộng hòa xã hội chủ nghĩa Việt Nam — Độc lập, Tự do, Hạnh phúc.',
                 'The quick brown fox jumps over the lazy dog. 0123456789',
                 'Người ký: ______________________']:
        c.drawString(72, y, line); y -= 22
    # grid marks every 100pt to help verify positions
    c.setStrokeColorRGB(0.8,0.8,0.8)
    for x in range(0, int(W), 100): c.line(x, 0, x, 10)
    for yy in range(0, int(H), 100): c.line(0, yy, 10, yy)
    c.showPage()
c.save()
pdf = pikepdf.open(tmp)
pdf.pages[1].Rotate = 90
pdf.pages[2].CropBox = [50, 100, 545, 800]
pdf.pages[3].Rotate = 270
pdf.save(out)
