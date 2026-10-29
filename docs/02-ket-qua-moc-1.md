# 02 · Kết quả mốc 1: chứng minh engine

## Đã chứng minh

Luồng mở PDF → thêm chữ tiếng Việt → highlight → xuất → mở lại bằng viewer độc lập chạy được, cả trong trình duyệt thật (Chromium) lẫn khi chạy headless.

| Bộ kiểm | Lệnh | Kết quả |
|---|---|---|
| Engine-proof headless: 3 tệp (thường, mật khẩu chủ sở hữu AES-256, RC4-128) × 4 kiểu trang (thường, `/Rotate 90`, CropBox lệch, `/Rotate 270`) × FreeText + Highlight trên chữ thật + chữ ký PNG | `npm run test:engine` | 36/36 annotation đọc lại đúng loại, nội dung, rect (sai số < 0,05 pt), góc xoay, dữ liệu riêng. Tệp mã hóa vẫn giữ nguyên mã hóa |
| Kiểm độc lập các tệp engine-proof (qpdf, Poppler, MuPDF) | `npm run verify` | PASS cả 3 tệp: phông nhúng, MuPDF đọc đúng chữ Việt từ appearance của cả 12 FreeText, Poppler không báo lỗi |
| Chấp nhận trên trình duyệt (Playwright + Chromium) | `npm run e2e` | **32/32 PASS** |

Các điểm `npm run e2e` kiểm tra:

- Màn hình trống hiện ra trước khi mở tệp, sau đó mở tệp và render trang.
- Kéo để tạo hộp chữ, gõ tiếng Việt. Rect trong không gian trang khớp vùng đã kéo (±1,5 pt, đúng bằng sai số làm tròn của chuột).
- Highlight tạo từ vùng chọn chữ và nằm đúng dòng chữ.
- Ctrl+Z / Ctrl+Y: 2 → 1 → 2 annotation.
- Hộp chữ giữ đúng vị trí trên trang ở 6 mức zoom (128–188 %, sai số ≤ 0,4 % khổ trang) và khi xoay hiển thị 90°.
- Trên trang `/Rotate 90`, hộp chữ tự quay ngược để vẫn đứng thẳng khi đọc. Sau khi xuất, ma trận appearance là `[0 1 -1 0]`.
- Xuất ra tệp mới `… (ezPDF).pdf`, tệp gốc không bị đụng tới. Dấu “có thay đổi chưa xuất” tắt sau khi xuất.
- Mở lại tệp đã xuất: annotation trở lại thành đối tượng sửa được, di chuyển được. Xuất lần hai vẫn đúng chữ và đúng vị trí mới.
- Ba viewer không dùng PDFium đều đọc đúng: Poppler (render không lỗi), MuPDF (đọc ra chữ Việt đúng từng ký tự), pdf.js (thấy FreeText có appearance, nội dung đúng).
- Không có request nào ra khỏi origin của app, không có request nào khác GET: không có gì bị tải lên.
- Không có lỗi trang.

Tệp bằng chứng nằm trong `docs/bang-chung/`: tệp đã xuất để bạn tự mở bằng Acrobat, Edge hay Foxit, kèm ảnh render từ Poppler, MuPDF, pdf.js và ảnh chụp app.

## Số đo

| Việc | Kết quả |
|---|---|
| Mở PDF 120 trang ảnh, 72 MB (headless) | 131 ms |
| `saveAsCopy` của EmbedPDF với tệp đó | 1,5–1,6 giây (chép từng byte, xem G6) |
| Bước xuất của ezPDF với 10 hộp chữ (vẽ lại appearance, PDFium ghi lại tệp) | 451 ms |
| Mỗi hộp chữ thêm vào tệp | khoảng 20 KB (mỗi hộp mang một bản phông subset 34 KB, nén lại còn khoảng 20 KB) |
| Bản build production | JS chính 1,6 MB (gzip 359 KB), WASM 4,6 MB (gzip 2,2 MB), worker xuất 170 KB |

## Giới hạn hiện tại (nói rõ trước khi mở rộng)

1. **Ngắt dòng khi đang gõ có thể lệch một từ** so với tệp xuất, trong trường hợp dòng chữ sát mép hộp (< 0,5 pt). Trình duyệt làm tròn độ rộng glyph khác nhau theo mức zoom và nền tảng. Tệp xuất thì luôn ổn định vì dùng metric của phông. Mốc 2 sẽ vẽ hộp chữ đã chốt bằng chính bộ ngắt dòng của bước xuất.
2. **Hộp chữ không tự giãn khi gõ dài** (hành vi mặc định của EmbedPDF): chữ thừa bị cắt và người dùng phải kéo to hộp. Mốc 2 sẽ tự tăng chiều cao.
3. Phông khi xuất mới có **một kiểu (Regular)** và chỉ phủ Latin + tiếng Việt. Ký tự ngoài phạm vi này được liệt kê trong cảnh báo sau khi xuất, chứ không bị bỏ lặng lẽ.
4. Mỗi hộp chữ nhúng một bản phông riêng, khoảng 20 KB mỗi hộp. Có thể gom lại về sau.
5. Chỉ FreeText do ezPDF tạo hoặc sửa (đánh dấu `ez` trong `EPDFCustom`) mới được vẽ lại khi xuất. FreeText của ứng dụng khác giữ nguyên appearance gốc.
6. Tệp có mật khẩu mới chỉ báo lỗi, chưa có ô nhập mật khẩu.
7. Phông dự phòng khi render PDF không nhúng phông chỉ có Latin/Việt. Tài liệu CJK, Ả Rập hay Do Thái không nhúng phông sẽ thiếu glyph cho đến khi bổ sung gói phông (tải về máy, không gọi CDN).
8. Xuất PDF hiện tải tệp qua trình duyệt. Bản desktop và Android cần hộp thoại lưu tệp gốc của hệ điều hành (mốc 4).
9. Nhóm package `@embedpdf/*` phải ghim đúng 2.15.1 vì các sửa lỗi G1–G3 dựa trên hành vi của bản này.

## Chưa làm trong mốc 1 (để không có nút giả)

Thumbnail, tìm kiếm, ghi chú dán, thêm ảnh/chữ ký từ giao diện, panel thuộc tính, lưu nháp. Engine đã có API cho các phần này (ảnh chữ ký đã chạy trong engine-proof), nhưng giao diện thuộc mốc 2–3.
