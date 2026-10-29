# 05 · Kết quả mốc 3: ảnh, chữ ký, xoay trang, bản nháp

## Đã làm

| Phần | Nội dung |
|---|---|
| Ảnh | Nút **Ảnh** (phím I) mở hộp chọn tệp: PNG, JPG, và WebP, GIF, BMP nếu trình duyệt đọc được (các loại này được chuyển sang PNG). Một bản mờ của ảnh đi theo con trỏ, bấm vào trang để đặt; **Enter** đặt vào giữa trang đang xem. Cỡ mặc định theo 96 dpi, không quá khoảng 45 % trang. Kéo để di chuyển, kéo góc để đổi cỡ, tỉ lệ luôn giữ nguyên. |
| Giữ ảnh như gốc | JPEG được nhúng nguyên byte, không nén lại. Chỉ xử lý lại khi ảnh có xoay EXIF (điện thoại hay ghi kiểu này; trình duyệt tự xoay nhưng PDF thì không) hoặc cạnh dài hơn 3200 px. PNG giữ kênh trong suốt, kể cả trong suốt một phần. |
| Chữ ký | Nút **Chữ ký** (phím K). Có hai cách: **ký tay** bằng chuột, bút hoặc ngón tay (mực đen hoặc xanh, có nút Xóa nét), hoặc **từ ảnh chụp**: nền giấy được xóa ngay trên máy, có thanh “Mức xóa nền giấy” và ô xem trước trên nền ca-rô. Có thể lưu chữ ký để dùng lại (tối đa 12, chỉ trong trình duyệt này) và xóa chữ ký đã lưu. |
| Xoay trang | Nút xoay giờ **xoay trang thật và lưu vào tệp** (`/Rotate`), thay cho nút “xoay hiển thị” của mốc 2. Có xoay trang này sang phải/trái (R, Shift R) và xoay mọi trang. Hoàn tác được. Chữ, ảnh, tô sáng đã thêm xoay theo trang như khi xoay tờ giấy. |
| Bản nháp | Tự lưu khoảng 1,2 giây sau mỗi thay đổi (tệp lớn chờ lâu hơn), và lưu ngay khi rời tab. Một bản nháp gồm **tệp gốc, không bị sửa** và **trạng thái hiện tại**, cộng với góc xoay từng trang và trang đang xem. Thanh trên ghi rõ “Nháp đã lưu 20:38 · chưa xuất”. |
| Mở lại nháp | Sau khi tải lại trang, màn hình trống liệt kê các bản nháp (tên, giờ sửa, số trang, dung lượng, đã xuất hay chưa): mở, hoặc xóa có hỏi lại. Mở lại đúng tệp gốc thì app hỏi: Mở bản nháp / Mở tệp gốc / Hủy. Có nút Đóng tài liệu để về danh sách. |
| Nháp và xuất tách hẳn | Nháp chỉ nằm trên máy. “Xuất PDF” vẫn luôn tạo một tệp mới từ trạng thái hiện tại. Vì mọi thay đổi đã nằm trong nháp, mở tệp khác không còn phải hỏi. App chỉ hỏi khi nháp **không lưu được**, ví dụ trình duyệt chặn lưu dữ liệu. Khi đó thanh trên báo lỗi bằng màu đỏ. |
| Thumbnail | Thumbnail vẽ chồng mọi annotation: ô chữ (cùng bộ ngắt dòng với trang và tệp xuất), tô sáng, ghi chú, ảnh, chữ ký, annotation có sẵn trong tệp. Cập nhật ngay khi sửa và xoay theo trang. |
| Dấu từ phần mềm khác | Dấu (stamp) không có tên loại thì bị khóa vị trí, nhưng vẫn chọn và xóa được. Cột thuộc tính nói rõ lý do (G12). |

## Lỗi engine gặp thêm và cách xử lý

| # | Vấn đề (EmbedPDF 2.15.1) | Xử lý |
|---|---|---|
| G7 | Không có API xoay trang. Reducer của lõi bỏ qua `REFRESH_DOCUMENT` và `SET_PAGES` | Tài liệu mở với `normalizeRotation`, nên mọi lớp (trang, ô ghép, thumbnail, bố cục, annotation) lấy góc xoay từ đối tượng trang trong store. App thay đối tượng trang đó, rồi báo bằng hai action mà reducer có xử lý. Khi xuất, `FPDFPage_SetRotation` ghi đúng góc đó vào `/Rotate` |
| G10 | Ảnh trong stamp có xoay bị đặt vào khung bao rồi phóng “cover”, nên bị **méo và cắt** ở mọi viewer. Lỗi xảy ra cả khi xoay tay lẫn khi engine tự đặt ảnh đứng thẳng trên trang xoay 90/270. Ảnh bằng chứng: `bang-chung/m3-g10-anh-bi-cat.png` | Ảnh không bao giờ xoay ở dạng annotation. Trên trang đang xoay, app xoay **điểm ảnh** ngược lại trước khi đặt, nên ảnh hiện đứng thẳng ở mọi viewer. Tay cầm xoay bị tắt cho mọi stamp |
| G11 | Hoàn tác sau khi xóa ảnh thì ảnh quay lại nhưng **trống**: plugin tạo lại annotation mà không kèm dữ liệu ảnh | App giữ dữ liệu của từng stamp: byte gốc với ảnh tạo trong phiên, hoặc appearance xuất ra một trang PDF khi stamp được chọn. Đúng lúc hoàn tác tạo lại stamp, app đưa dữ liệu đó vào hàng chờ của plugin, trước khi commit tới engine |
| G12 | Stamp không có `/Name` (đọc ra Unknown) **mất hình** khi bị di chuyển hay đổi cỡ | Khóa vị trí loại stamp này. Stamp có tên lạ đọc ra Custom thì vẫn giữ hình khi sửa, nhưng `/Name` bị ghi lại thành `/Custom` |
| G13 | Ô chữ mở lại từ nháp hiển thị bằng appearance của PDFium, vốn **mất dấu tiếng Việt** (G1) | Ô chữ của ezPDF dùng một bản sao công cụ freeText với appearance tắt, nên luôn vẽ bằng bộ ngắt dòng của app. Ô chữ của phần mềm khác vẫn giữ appearance gốc cho tới khi được sửa |
| G14 | Đổi tài liệu khi con trỏ đang nằm trên trang: bộ xử lý con trỏ của trang cũ vẫn gắn cho tới khi React gỡ viewer, gặp tài liệu đã đóng thì báo lỗi “Interaction state not found”. Lỗi gặp 1 lần trong 3 lượt chạy bản production | Gỡ viewer trước, rồi mới đóng tài liệu cũ. Trong lúc chuyển, màn hình hiện “Đang mở tài liệu…” |

## Kết quả kiểm thử

| Bộ kiểm | Kết quả |
|---|---|
| `npm run test:m3`: engine thật trong Node, 4 kiểu trang (thường, `/Rotate 90`, CropBox lệch, `/Rotate 270`), PNG trong suốt và JPEG, đổi cỡ rồi di chuyển, xóa rồi tạo lại, xuất 2 lần (giữ nguyên và đổi góc xoay trang) | **54/54**: 18 kiểm dữ liệu khi mở lại, 36 kiểm điểm ảnh trên Poppler và MuPDF |
| `npm run e2e:m3`, Chromium, dev server | **50/50** |
| `npm run e2e:m3:preview`, bản build production | **49/49**, chạy 2 lần (bản build không có trang kiểm pdf.js nên bỏ bước đó) |
| `npm run e2e` (bộ của mốc 1–2, đã cập nhật cho xoay trang và bản nháp) | **56/56** (dev), **56/56** (production) |
| `npm run test:layout`, `test:engine`, `verify` | 14/14, PASS, PASS ×3 |

Các điểm kiểm quan trọng:

- **Ảnh hiển thị đúng ở 3 viewer.** Ở mỗi ảnh, bộ kiểm lấy màu tại 12–15 điểm: 4 góc phần tư, sát mép (để bắt méo hoặc cắt), và ngay ngoài khung. Nó so với vị trí ảnh **phải** xuất hiện, sau khi tính góc xoay của ảnh và của trang. Phần trong suốt hoàn toàn phải thấy nền trang. Phần trong suốt 50 % phải ra màu hòa đúng tỉ lệ. Tệp xuất từ e2e đạt trên Poppler, MuPDF và pdf.js. Tệp của bộ kiểm engine đạt trên cả 4 kiểu trang, cả khi đã đổi góc xoay trang.
- **Nền giấy của chữ ký chụp bị xóa thật.** Trong khung chữ ký xuất ra, phần lớn điểm lấy mẫu là màu trắng của trang (nền giấy gốc xám ngà, có góc bị bóng), và vẫn còn nét mực.
- **Xoay trang khớp.** `/Rotate` trong tệp xuất là 90, 90, 0, 270, đúng như trên màn hình. Cỡ trang mà MuPDF đọc ra đổi chiều đúng.
- **Nháp sau khi tải lại trang.** Đủ 9 annotation, góc xoay trang còn nguyên, chữ tiếng Việt vẫn đủ dấu, ảnh vẫn vẽ đúng.
- **Không có nút giả.** Mọi nút mới xuất hiện trên màn hình đều được bấm thật trong bộ kiểm, kể cả trên điện thoại.
- **Riêng tư.** Không có request nào ra ngoài origin, không có upload. Ảnh, chữ ký và nháp chỉ nằm trên máy.

Trong 3 lần chạy `npm run e2e` trên dev server mới khởi động, có 1 lần hỏng ngay bước đầu: cột trang và cột thuộc tính không hiện sau khi mở tệp. Cả hai lần chạy lại đều đạt 56/56, và bản production chưa lần nào hỏng. Dấu hiệu khớp với việc Vite tải lại trang ở lần nạp đầu, nên hai script e2e giờ nạp app một lần trước khi kiểm.

Ngoài ra, một bước kiểm cũ của mốc 2 (“công cụ trở về Chọn sau khi đặt chữ”) đọc nhầm thuộc tính `data-state` của tooltip nên lúc nào cũng đạt. Giờ nó đọc `aria-pressed` của nút và vẫn đạt.

## Giới hạn còn lại

1. Ảnh chỉ nằm thẳng theo trang, chưa xoay tự do được (G10).
2. Lịch sử hoàn tác không giữ qua lần tải lại trang. Nháp giữ kết quả, không giữ từng bước.
3. Nháp nằm trong trình duyệt, nên sẽ mất nếu xóa dữ liệu trang web, hoặc nếu trình duyệt tự dọn khi máy thiếu chỗ. Mỗi nháp chiếm khoảng gấp đôi dung lượng tệp. Bản desktop và Android (M4) sẽ lưu vào thư mục của ứng dụng.
4. Mỗi lần tự lưu dùng `saveAsCopy` của EmbedPDF, vốn chép từng byte (G6). Với tệp vài chục MB, mỗi lần lưu sẽ khựng khoảng 1 giây; thời gian chờ đã được giãn theo cỡ tệp. Mốc 6 sẽ sửa.
5. Dấu có tên riêng từ phần mềm khác bị đổi `/Name` thành `/Custom` khi di chuyển. Hình vẫn giữ nguyên.
6. Chữ ký ở đây là **hình ảnh chữ ký**, không phải chữ ký số có chứng thư.
7. Ảnh HEIC của iPhone chỉ dùng được nếu trình duyệt đọc được (Safari đọc được, Chrome thì không).
8. Các giới hạn của mốc 1–2 vẫn còn: phông chỉ có kiểu Regular, chưa nhập được mật khẩu, tìm kiếm phân biệt dấu.
