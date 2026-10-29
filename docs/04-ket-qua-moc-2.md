# 04 · Kết quả mốc 2: khung giao diện đầy đủ

## Đã làm

| Phần | Nội dung |
|---|---|
| Bố cục | Thanh công cụ ở trên, cột trang/tìm kiếm bên trái, trang ở giữa, cột thuộc tính bên phải đổi theo đối tượng đang chọn. Hai cột ẩn/hiện được |
| Trên điện thoại (< 640 px) | Thanh trên chỉ giữ Mở, Xuất và hai nút cột. Công cụ chuyển xuống thanh dưới. Cột trang thành lớp phủ, tự đóng khi chọn trang. Không bị tràn ngang |
| Màu và chữ | Nền trung tính. Một màu nhấn xanh mực `#0B6E69` dùng cho công cụ đang bật, khung chọn, nút Xuất và viền focus. Vàng cam chỉ báo “chưa xuất”, đỏ chỉ dành cho xóa và lỗi. Một họ chữ duy nhất là ezPDF Sans VN, chính là phông được nhúng khi xuất |
| Trạng thái công cụ | Công cụ đang bật được tô màu nhấn. Một dải gợi ý ở đáy vùng trang nói công cụ đó làm gì và thoát bằng cách nào; khi đang sửa chữ, dải này đổi nội dung theo |
| Ô chữ | Vẽ trên màn hình bằng **chính bộ ngắt dòng của bước xuất** (`engine/text-layout.ts`): dòng, vị trí x và đường chân chữ giống hệt tệp xuất ở mọi mức zoom. **Ô tự cao thêm** khi chữ dài ra hoặc khi tăng cỡ chữ, kể cả ô nằm trên trang xoay. Bấm đúp để sửa; Esc hoặc Ctrl+Enter để xong |
| Thuộc tính | Ô chữ: cỡ chữ, màu, căn lề, nền. Tô sáng: màu và lời nhắn kèm. Ghi chú dán: nội dung và màu. Khi không chọn gì: thông tin tài liệu và bảng phím tắt. Có nút Xóa |
| Ghi chú dán | Công cụ mới (phím N). Ô nội dung tự focus để gõ ngay |
| Thumbnail | Ảo hóa (300 trang nhưng chỉ khoảng 8 ảnh nằm trong DOM). Đánh dấu trang đang xem và tự cuộn theo |
| Tìm kiếm | Panel kết quả nhóm theo trang, có ngữ cảnh. Có Enter / Shift+Enter, nút trước/sau, tùy chọn đúng hoa/thường và nguyên từ. Tô vùng khớp trên trang |
| Điều hướng | Nút trang trước/sau, ô nhập số trang, menu mức phóng (vừa chiều rộng, vừa trang, 50–300 %) |
| Phím tắt | V T H N, Esc, Delete, Ctrl+Z/Y, Ctrl+F, Ctrl +/−, Ctrl+O, Ctrl+S |
| Bảo vệ thay đổi | Mở tệp khác khi còn thay đổi chưa xuất thì app hỏi trước (“Bỏ thay đổi và mở” / “Giữ lại”). Đóng tab cũng có cảnh báo |
| Component | Lấy từ shadcn/ui (button, toggle, tabs, tooltip, dropdown-menu…), chép vào `src/components/ui` đúng như cách CLI làm. Icon dùng lucide |

## Kết quả kiểm thử

| Bộ kiểm | Kết quả |
|---|---|
| `npm run test:layout` (ngắt dòng, căn lề, chân chữ, giãn ô khi xoay 0/90/180/270/30°) | 14/14 |
| `npm run test:engine` + `npm run verify` (3 tệp, kể cả mã hóa AES-256 và RC4) | PASS |
| `npm run e2e`, Chromium, dev server | **56/56** |
| `npm run e2e:preview`, bản build production | **56/56** (riêng bước pdf.js bỏ qua vì bản build không chứa trang kiểm thử) |

Các điểm kiểm quan trọng nhất của mốc này:

- **Màn hình khớp tệp:** dòng chữ của hai ô chữ giống hệt nhau, vị trí lệch dưới 0,15 % khổ trang, qua 11 mức zoom (50 %–300 %, vừa trang, vừa chiều rộng, các nút +/−). MuPDF đọc tệp xuất ra **đúng các dòng đó**, đường chân chữ lệch **≤ 0,02 pt** so với màn hình. Cỡ 16 pt và màu đỏ giữ nguyên.
- **Ô tự giãn:** ô đặt bằng một cú bấm (180 × 22 pt) gõ đoạn dài thì cao lên 115,75 pt và hiện đủ 7 dòng. Ô trên trang `/Rotate 90` giãn đúng theo khung của chính nó.
- **Thuộc tính, ghi chú, xóa:** tô sáng (màu + lời nhắn) và ghi chú dán (màu + nội dung tiếng Việt) xuất ra đúng, MuPDF và pdf.js đều đọc được. Delete, Ctrl+Z, nút làm lại/hoàn tác và nút Xóa đều chạy.
- **Tài liệu 300 trang:** hiện trang đầu sau khoảng 1,1 giây. Tìm “Hải Phòng” ra đúng 3 kết quả ở trang 7, 150, 299. Bấm kết quả, trước/sau, bấm thumbnail, nhập số trang đều tới đúng trang.
- **Điện thoại 390 px:** không tràn ngang, nút Xuất nằm trong màn hình.
- **Không có nút giả:** mọi nút xuất hiện trên màn hình ở các trạng thái đã đi qua đều được một bước kiểm bấm thật, và đều có test id.
- **Riêng tư:** không có request nào ra ngoài origin, không có upload, không có lỗi trang.

## Lỗi engine gặp thêm trong mốc này

| # | Vấn đề (EmbedPDF 2.15.1) | Xử lý |
|---|---|---|
| G8 | Trạng thái “đang sửa ô chữ” là state riêng của lớp annotation. Nó chỉ được xóa ở cú bấm kế tiếp lên trang, nên cú bấm đó bị nuốt mất | Xong bằng Esc hoặc Ctrl+Enter thì app gắn lại lớp annotation của trang đó. Vùng chọn và ảnh appearance nằm trong plugin nên không mất gì |
| G9 | Khi một lượt tìm đang chạy bị lượt mới hủy, plugin ghi lỗi “Sibling task failed” và có thể xóa kết quả của lượt mới | Không bao giờ cho hai lượt tìm chồng nhau: ô tìm chờ 280 ms sau phím gõ cuối, lượt mới phải đợi lượt cũ chạy xong |

## Giới hạn còn lại

1. **Thumbnail chưa hiện annotation**, mới chỉ có nội dung gốc của trang. Thumbnail render bằng PDFium, mà appearance ô chữ của PDFium lại mất dấu tiếng Việt cho tới lúc xuất (G1). Muốn hiện annotation thì phải tự vẽ chồng lên thumbnail.
2. Trong lúc **đang gõ**, chỗ xuống dòng do textarea của trình duyệt quyết định. Ở trường hợp sát mép, nó có thể khác một từ so với lúc đã xong. Khi xong (Esc, Ctrl+Enter hoặc bấm ra ngoài), màn hình và tệp khớp tuyệt đối.
3. Ô chữ chỉ giãn chứ không tự co lại. Muốn thu nhỏ thì kéo góc.
4. Tìm kiếm phân biệt dấu (“viet” không ra “Việt”), vì lõi tìm của PDFium không có chế độ bỏ dấu.
5. Căn dọc giữa/dưới chỉ có tác dụng khi đã xong. Lúc đang gõ, chữ luôn bám trên.
6. Các giới hạn của mốc 1 vẫn còn: một kiểu phông Regular, mỗi ô chữ thêm khoảng 20 KB, chưa nhập mật khẩu, chưa lưu nháp, xuất tệp lớn còn chậm.
