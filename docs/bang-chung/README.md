# Bằng chứng

## Mốc 1

| Tệp | Là gì |
|---|---|
| `truoc-sau-freetext.png` | Cùng một hộp chữ, Poppler render. Trên: tệp do EmbedPDF 2.15.1 tự lưu, dấu bị mất (G1). Dưới: tệp sau bước xuất của ezPDF |
| `mau-da-xuat-tu-trinh-duyet.pdf` | Tệp xuất thật từ luồng e2e trong Chromium: highlight, hộp chữ tiếng Việt ở trang 1 (đã mở lại và di chuyển), hộp chữ trên trang `/Rotate 90`. **Mở bằng Acrobat, Edge, Foxit hay viewer bất kỳ để tự kiểm** |
| `mau-ma-hoa-aes256.pdf` | Kết quả engine-proof trên tệp có mật khẩu chủ sở hữu AES-256. Mã hóa vẫn còn, chữ Việt hiển thị đúng |
| `poppler-trang1.png`, `mupdf-trang2-xoay90.png` | Render độc lập của tệp engine-proof |
| `pdfjs-trang1.png`, `pdfjs-trang2-xoay90.png` | pdf.js (engine của Firefox) render `mau-da-xuat-tu-trinh-duyet.pdf` |
| `app-mo-lai-file-da-xuat.png` | ezPDF mở lại tệp đã xuất; annotation hiện từ appearance có phông nhúng |
| `app-xoay-hien-thi.png` | ezPDF khi xoay hiển thị 90°, hộp chữ đi theo trang |
| `e2e-results.json` | 32 điểm kiểm và chi tiết từng điểm |

## Mốc 2

| Tệp | Là gì |
|---|---|
| `m2-man-hinh-chinh.png` | Giao diện đầy đủ sau khi xuất: ô chữ đỏ cỡ 16 căn giữa nền vàng, ô tự giãn 7 dòng, tô sáng xanh, ghi chú dán |
| `m2-o-chu-trang-xoay.png` | Ô chữ trên trang `/Rotate 90`: chữ đứng thẳng, ô đã tự giãn, cột thuộc tính bên phải |
| `m2-tai-lieu-300-trang.png` | Tài liệu 300 trang sau khi tìm “Hải Phòng” và nhảy trang |
| `m2-dien-thoai.png` | Bố cục điện thoại 390 px: công cụ ở thanh dưới, dải gợi ý |
| `m2-pdfjs-trang1.png` | pdf.js render tệp xuất của luồng e2e |
| `m2-mau-da-xuat.pdf` | Tệp xuất thật của luồng e2e (đã mở lại và sửa lần 2). Mở bằng viewer bất kỳ để tự kiểm |
| `m2-e2e-results.json` | 56 điểm kiểm và chi tiết |

## Mốc 3

| Tệp | Là gì |
|---|---|
| `m3-man-hinh-chinh.png` | Ô chữ, ảnh JPEG, chữ ký lấy từ ảnh chụp đã xóa nền (dòng “Người ký” vẫn thấy xuyên qua). Thumbnail trang 1 hiện cả ba. Thanh trên ghi “Nháp đã lưu … · chưa xuất” |
| `m3-chu-ky-tu-anh.png` | Hộp thoại chữ ký, tab “Từ ảnh chụp”: nền giấy xám có góc bị bóng đã được xóa, xem trước trên nền ca-rô |
| `m3-xoay-trang.png` | Trang 2 (`/Rotate 90` trong tệp gốc) được xoay về đứng thẳng bằng Shift R. Thumbnail đổi theo |
| `m3-ban-nhap.png` | Sau khi tải lại trang: danh sách bản nháp trên máy |
| `m3-dien-thoai-chu-ky.png` | Điện thoại 390 px: ký bằng ngón tay, 11 công cụ ở thanh dưới vừa màn hình |
| `m3-g10-anh-bi-cat.png` | Lỗi G10 của EmbedPDF (khi chưa vá): ảnh được engine tự đặt đứng thẳng trên trang `/Rotate 90` bị cắt mất nửa trên (MuPDF render) |
| `m3-mau-da-xuat.pdf` | Tệp xuất thật của e2e mốc 3, xuất từ bản nháp đã mở lại: 2 ảnh PNG trong suốt (trang 1, trang 4 `/Rotate 270`), 1 JPEG (trang 2 `/Rotate 90`), 3 chữ ký (ký tay, dùng lại từ chữ ký đã lưu, từ ảnh chụp), ô chữ và tô sáng ở trang 3, trang 1 đã xoay 90°. Mở bằng viewer bất kỳ để tự kiểm |
| `m3-pdfjs-trang1.png` | pdf.js render trang 1 của tệp đó (trang đã xoay 90°) |
| `m3-e2e-results.json` | 50 điểm kiểm của `e2e:m3` và chi tiết |
| `m3-kiem-anh.txt` | Toàn bộ kết quả lấy mẫu màu trên Poppler, MuPDF, pdf.js |

## Mốc 4

| Tệp | Là gì |
|---|---|
| `m4-desktop-mo-bang-duong-dan.png` | Bản desktop thật (Tauri, chạy trên Linux) khởi động với đường dẫn tệp `Hợp đồng mẫu.pdf`, giống khi chọn “Mở bằng ezPDF” |
| `m4-desktop-danh-sach-nhap.png` | Bản desktop mở lại sau khi tắt: danh sách nháp, dòng cuối nói nháp nằm trong thư mục dữ liệu của ezPDF |
| `m4-desktop-hop-thoai-mo.png`, `m4-desktop-hop-thoai-luu.png` | Hộp thoại Mở và Lưu của hệ điều hành (GTK trên Linux; trên Windows là hộp thoại của Windows), chụp cả màn hình |
| `m4-desktop-xuat-qua-hop-thoai.pdf` | Tệp bản desktop ghi ra đúng chỗ đã chọn trong hộp thoại Lưu (trang 1 xoay 90°) |
| `m4-web-offline.png` | Web app đã cài, mạng tắt: mở PDF, thêm chữ tiếng Việt, nháp đã lưu, đã xuất |
| `m4-mau-xuat-offline.pdf` | Tệp xuất lúc offline |
| `m4-bieu-tuong.png` | Biểu tượng ezPDF (bản thường và bản maskable cho Android/PWA) |
| `m4-smoke-desktop.json` | Kết quả smoke test bản desktop |
| `m4-e2e-web.json` | Kết quả `e2e:m4` trên dev server và trên bản build production |
| `m4-tep-50mb.json` | Thời gian từng bước và bộ nhớ khi mở, sửa, lưu nháp và xuất tệp 51 MB trên màn hình điện thoại, CPU chậm 4× |
| `m4-luu-tru.txt` | Kết quả kiểm lớp lưu trữ dạng tệp, có cả trường hợp app tắt giữa lúc ghi |
