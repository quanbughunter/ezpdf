# 03 · Kế hoạch theo mốc

Mỗi mốc chỉ coi là xong khi bộ kiểm của mốc đó chạy xanh. Bộ kiểm luôn gồm e2e trong trình duyệt và kiểm tệp xuất bằng ít nhất một viewer không dùng PDFium. Nút nào chưa chạy thì không đưa vào bản nghiệm thu.

| Mốc | Nội dung | Nghiệm thu |
|---|---|---|
| **M1 · Chứng minh engine** ✅ | Mở, chữ tiếng Việt, highlight, xuất, mở lại; bộ xuất có phông nhúng; e2e + kiểm độc lập | 32/32 e2e; Poppler, MuPDF, pdf.js đọc đúng |
| **M2 · Khung giao diện đầy đủ** ✅ | Toolbar trên, thumbnail trái, trang giữa, panel thuộc tính phải; ô chữ tự giãn, hiển thị bằng chính bộ ngắt dòng của bước xuất; tìm kiếm, ghi chú dán, xóa, phím tắt, bố cục điện thoại | 56/56 e2e (dev và production); màn hình khớp tệp qua 11 mức zoom, MuPDF lệch ≤ 0,02 pt; tài liệu 300 trang; không có nút chết (xem `04-ket-qua-moc-2.md`) |
| **M3 · Ảnh, chữ ký, xoay trang, nháp** ✅ | Thêm ảnh (PNG/JPG), vẽ hoặc nhập ảnh chữ ký, xóa nền giấy của ảnh chữ ký (xử lý trên máy); xoay trang lưu vào tệp (`FPDFPage_SetRotation` ở bước xuất); lưu nháp tự động bằng IndexedDB (tệp gốc + trạng thái), tách hẳn khỏi “Xuất PDF”; thumbnail vẽ chồng annotation | Ảnh trong suốt và xoay trang khớp ở Poppler, MuPDF, pdf.js; mở lại nháp sau khi tải lại trang; e2e mốc 3 và bộ mốc 1–2 đều xanh (xem `05-ket-qua-moc-3.md`) |
| **M4 · Đóng gói 3 nền tảng** 🟡 | PWA (cài được, chạy offline); desktop bằng Tauri 2 (hộp thoại mở/lưu gốc, mở tệp bằng chuột phải); Android bằng Capacitor 8 (Storage Access Framework, chia sẻ tệp vào app). Lớp lưu trữ gồm 3 adapter, dùng chung một interface | Cùng bộ e2e chạy trên bản web; smoke test trên Windows và một máy Android thật; tệp 50 MB mở được trên Android tầm trung. **Đã đạt:** e2e web (dev + production, kể cả offline), smoke test bản desktop thật trên Linux, plugin Android biên dịch được. **Còn chờ:** thử trên Windows và điện thoại Android thật, đo tệp 50 MB trên máy thật (xem `06-ket-qua-moc-4.md`) |
| **M5 · Đánh giá riêng: redaction, sửa chữ có sẵn, OCR** | Redaction: thử `redactTextInRects`/`applyRedaction`, kiểm rằng chữ, ảnh và vector dưới vùng che **bị xóa thật** (pdftotext, trích ảnh, so pixel). Sửa chữ có sẵn: PDFium 2.x không hỗ trợ, cần đánh giá EmbedPDF 3.x hoặc engine khác. OCR: tesseract.js (WASM, có gói `vie`) chạy trên máy, thêm lớp chữ ẩn | Báo cáo riêng trước khi đưa vào app. Không phủ nền rồi thêm chữ để gọi là “sửa”. Tính năng nào không vượt bài kiểm thì không phát hành |
| **M6 · Hiệu năng và ổn định** | Tránh chép từng byte khi save; xuất chạy cùng worker (custom runner) để khỏi phải parse lần hai; gom phông dùng chung; phông subset theo đúng glyph đã dùng; giới hạn bộ nhớ trên Android | Tệp 200 MB xuất được trên desktop; Android không bị đóng vì hết bộ nhớ với tệp 50 MB |

Phụ thuộc: M2 → M3 → M4. M5 và M6 có thể chạy song song sau M2.
