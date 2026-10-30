"""Fixtures for page management (insert, delete, reorder, extract, split).

Usage: python3 scripts/make_page_fixtures.py tests/fixtures

Writes:
  pages-a.pdf  5 pages, each marked "A-1"… "A-5" in large type, so page
               order can be read back with any PDF reader. Page 2 carries a
               sticky note, page 3 is stored with /Rotate 90, page 4 holds a
               fillable text field (AcroForm), page 5 is landscape. Bookmarks
               point at pages 1 and 4.
  pages-b.pdf  3 pages "B-1"… "B-3" (Letter size): the "other PDF" to add.
"""
import os, sys
import pymupdf

OUT = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures'
os.makedirs(OUT, exist_ok=True)


def mark(page, text, sub):
    r = page.rect
    page.insert_text((60, 140), text, fontsize=72, fontname='helv')
    page.insert_text((60, 190), sub, fontsize=14, fontname='helv')
    page.draw_rect(pymupdf.Rect(40, 40, r.width - 40, r.height - 40), color=(0.1, 0.4, 0.4), width=2)


a = pymupdf.open()
for i in range(5):
    w, h = (842, 595) if i == 4 else (595, 842)
    p = a.new_page(width=w, height=h)
    mark(p, f'A-{i + 1}', f'Trang {i + 1} cua tep A')
a[1].add_text_annot((300, 300), 'Ghi chu tren A-2')
a[2].set_rotation(90)
widget = pymupdf.Widget()
widget.field_name = 'ho_ten'
widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
widget.rect = pymupdf.Rect(60, 260, 360, 290)
widget.field_value = 'Nguyen Van A'
a[3].add_widget(widget)
a.set_toc([[1, 'Mo dau', 1], [1, 'Bieu mau', 4]])
a.save(os.path.join(OUT, 'pages-a.pdf'), garbage=3, deflate=True)

b = pymupdf.open()
for i in range(3):
    p = b.new_page(width=612, height=792)
    mark(p, f'B-{i + 1}', f'Trang {i + 1} cua tep B')
b.save(os.path.join(OUT, 'pages-b.pdf'), garbage=3, deflate=True)
print('wrote', OUT)
