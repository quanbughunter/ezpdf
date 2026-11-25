# 16 · Chép chữ đã bôi đen, bấm lại kết quả tìm kiếm (bản 0.9.8)

Theo báo lỗi trên bản Windows 0.9.6:

> “tìm ra rồi mà bấm vào thì lần đầu có bay đến đoạn chứa text đó, sau đó lỡ kéo trang đi chỗ khác thì bấm lại vào kết quả tìm kiếm nó lại không bay về text đó nữa. tiếp theo là việc tôi bôi đen text rồi ctrl c mà ctrl v ra chỗ khác ví dụ zalo hay word … thì không ra được text đã được copy.”

## Chép chữ

**Nguyên nhân.** Chữ trên trang PDF là hình do PDFium vẽ. Vùng bôi đen cũng do EmbedPDF tự vẽ thành các ô màu xanh, không phải chữ thật trong trang web. Vì thế khi bấm Ctrl C, trình duyệt không thấy chữ nào được chọn và không chép gì. EmbedPDF có hàm lấy chữ của vùng chọn, nhưng ezPDF chưa nối Ctrl C với hàm đó. Nói cách khác, Ctrl C trong ezPDF chưa hề đưa chữ vào bộ nhớ tạm.

**Cách sửa** (`src/app/viewer/copy-text.tsx`, gắn vào trình xem):

- Ngay khi bôi đen xong, chữ của vùng chọn được đọc từ PDFium và giữ sẵn, mỗi dòng một dòng, sang trang thì xuống dòng.
- Khi trang nhận lệnh chép (Ctrl C, hay Edit → Copy), chữ giữ sẵn được đặt vào bộ nhớ tạm ngay trong lệnh đó. Cách này trình duyệt nào và WebView nào cũng cho phép, kể cả WebView2 của bản Windows.
- Nếu bấm Ctrl C ngay khi vừa thả chuột, lúc chữ chưa đọc xong, thì chữ được đọc rồi ghi bằng Clipboard API.
- Một số trình duyệt (Safari) không gửi lệnh chép khi trang không có chữ thật nào được chọn. Khi đó Ctrl C cũng đi đường Clipboard API.
- Cạnh vùng bôi đen hiện nút **Sao chép**, ở trên vùng chọn nếu còn chỗ, không thì ở dưới. Chép xong có dòng báo “Đã chép N ký tự vào bộ nhớ tạm. Dán bằng Ctrl V.”
- Ô đang có chữ được bôi đen (ô tìm kiếm, ô nhập) thì Ctrl C vẫn chép chữ của ô như thường. Ô chỉ đang giữ con trỏ mà không có chữ bôi đen thì không tính.

Bôi đen chữ dùng công cụ chọn (phím V, mũi tên trên thanh công cụ). Ở công cụ bàn tay, kéo chuột là kéo trang.

## Bấm lại kết quả tìm kiếm

**Nguyên nhân.** Trang chỉ được cuộn tới kết quả khi *kết quả đang chọn đổi*. Bấm lại đúng kết quả đang chọn thì không có gì đổi, nên trang đứng yên. Bấm ↑ ↓ hay Enter khi chỉ có một kết quả cũng vậy.

**Cách sửa** (`src/app/side-panels.tsx`): mỗi lần bấm một kết quả, bấm ↑ ↓ hay Enter, trang luôn được cuộn tới kết quả đó, dù nó đang được chọn sẵn. ↑ ↓ đi vòng: từ kết quả cuối sang kết quả đầu và ngược lại. Lần tìm mới vẫn tự đưa tới kết quả đầu tiên như trước.

## Kiểm chứng

`npm run e2e` (Chromium thật) **61/61**, có 3 điểm mới:

- Bôi đen nửa dòng “Tài liệu mẫu để kiểm tra ezPDF. Đoạn …”, bấm Ctrl C: bộ nhớ tạm có đúng chữ đó, dấu tiếng Việt đủ. Bấm nút Sao chép cũng cho đúng chữ đó. Dòng báo hiện.
- Bôi đen chữ trong ô tìm kiếm rồi Ctrl C: chép chữ của ô, không phải chữ trên trang.
- Tìm “Hải Phòng” trong tệp 300 trang, bấm kết quả ở trang 150, chuyển sang trang 40, bấm lại đúng kết quả đó: trang về 150.

Đã thử thêm: tìm xong rồi bôi đen chữ trên trang khi ô tìm kiếm còn giữ con trỏ, Ctrl C vẫn chép chữ trên trang; ↑ ↓ đi vòng qua 3 kết quả.

## Giới hạn

- Chữ chép ra theo thứ tự PDFium đọc. Tệp xếp chữ lạ (nhiều cột, chữ trong bảng) có thể ra sai thứ tự, như ở các trình đọc PDF khác.
- Điện thoại chưa bôi đen chữ bằng ngón tay được (đã có từ trước), nên chưa chép chữ được trên điện thoại.
- Tệp cấm chép chữ (quyền CopyContents tắt) thì không chép được, giống Adobe Reader.
