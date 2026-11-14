# 14 · Bỏ tô sáng có sẵn trong PDF (bản 0.9.1)

Yêu cầu (14/11, kèm ảnh chụp bản Windows 0.9.0 đang mở kịch bản điều hành Đại hội xuất từ Google Docs): công cụ sửa chưa cho bỏ phần chữ đang được tô vàng.

## Tóm tắt nghiệm thu

| Việc | Trạng thái |
|---|---|
| Bỏ tô sáng có sẵn trong tệp | **Đạt.** Trong công cụ **Sửa chữ có sẵn** (phím E), chạm vào một dòng đang được tô: thanh sửa có thêm hàng **Bỏ tô sáng**. Bấm một lần là bỏ cả đoạn tô liền nhau. Dải màu bị **xóa khỏi nội dung trang**, không phủ trắng lên trên. Chữ giữ nguyên. Bộ kiểm độc lập (MuPDF, Poppler, qpdf) xác nhận: dải màu không còn trong danh sách hình vẽ của trang, không có hình mới nào vẽ đè lên, chữ đọc ra y hệt và vẫn đậm như cũ, ngoài các dải đã bỏ thì trang không đổi |
| Tô sáng dạng ghi chú (Acrobat, Foxit, ezPDF) | **Đạt.** Cùng nút đó. Ghi chú tô sáng bị gỡ khỏi trang |
| Ô trong một hàng bảng thành dòng riêng | **Đạt** (sửa kèm, lỗi thấy trong cùng ảnh chụp). Trước đây “6 · Báo cáo số lượng · Đ/c Nguyễn Thị Hường…” bị gộp thành một dòng chạy qua ba ô; sửa chữ ở ô trước làm chữ ở ô sau bị dịch theo. Giờ đường kẻ dọc của bảng ngắt dòng |
| Thử trên tệp Google Docs thật của bạn | **Chưa.** Tôi chưa đọc được tệp trong ảnh. Tệp mẫu dùng Chromium, cùng bộ vẽ Skia với Google Docs, nên dải màu được lưu y như vậy. Cách tự kiểm ở cuối tài liệu |

## Cách dùng

1. Bấm **Sửa chữ có sẵn** (phím **E**). Trên điện thoại, nút này nằm ở thanh dưới.
2. Chạm vào một dòng đang được tô màu. Thanh sửa hiện như cũ, thêm một hàng có ô màu:
   - một dòng: “Dòng này đang được tô màu.”
   - nhiều dòng: “Đoạn được tô gồm 3 dòng (“Báo cáo số lượng” … “Đại hội”). Bỏ tô sáng sẽ bỏ cả 3 dòng.”
3. Bấm **Bỏ tô sáng**. Trang cập nhật tại chỗ, giữ mức phóng và chỗ đang đọc. App báo “Đã bỏ tô sáng ở 3 dòng, chữ giữ nguyên.” **Hoàn tác** lấy lại màu tô. Nháp tự lưu, tệp xuất không còn màu tô.

Ảnh thanh sửa trên tệp mẫu: `docs/bang-chung/m14-bo-to-sang.png`.

Nếu bạn đã gõ sửa chữ trong ô mà chưa lưu, nút Bỏ tô sáng tạm khóa, để phần đang gõ không bị mất. Lưu hoặc hủy trước, rồi bỏ tô.

Dòng không có màu tô thì không có hàng này. Nếu bấm qua đường khác vẫn đến một dòng như vậy, app báo “Dòng này không có màu tô nào để bỏ.”

## Vì sao trước đây không bỏ được

Google Docs, Word, LibreOffice và Chrome **không lưu tô sáng thành tô sáng**. Khi xuất PDF, chúng vẽ một hình chữ nhật màu vào nội dung trang, mỗi dòng một hình, ngay trước chữ. Trong tệp Google Docs, phần “Báo cáo số lượng đoàn viên có mặt tại Đại hội” là ba hình chữ nhật vàng nằm dưới ba dòng chữ. Với PDF, đó chỉ là hình vẽ, không phải thuộc tính của chữ. Công cụ Chọn chỉ chọn được ghi chú (annotation), còn công cụ Sửa chữ chỉ đổi chữ, nên trước đây không có cách nào chạm tới các hình này.

Tô sáng tạo bằng Acrobat, Foxit hoặc công cụ **Tô sáng chữ** của ezPDF thì khác: đó là một ghi chú nằm trên trang. Loại này vẫn chọn rồi xóa được bằng phím Delete, và nay cũng bỏ được bằng nút Bỏ tô sáng.

## Cách làm, và vì sao đây là bỏ thật

Phần engine (`src/engine/marks.ts` và `removeMarks` trong `src/engine/text-edit.ts`) chạy bằng PDFium trong worker của ezPDF, như phần sửa chữ.

1. **Đọc hình vẽ của trang.** Mỗi đối tượng hình (path) được tách thành hình chữ nhật, đoạn thẳng hoặc hình khác. Hình chữ nhật mảnh (dưới 2 pt) và nét kẻ thẳng là **đường kẻ** (viền bảng). Hình chữ nhật tô kín, không viền, là ứng viên dải màu.
2. **Quyết định cái nào là dải tô sáng.** Một hình chữ nhật là dải tô sáng của một dòng khi đủ cả các điều kiện sau:
   - có màu (không phải trắng);
   - chỉ nằm dưới chữ của **một dòng**. Hình lan sang dòng khác là nền khung hoặc nền ô;
   - cao cỡ dòng chữ (từ 0,55 đến 2,6 lần cỡ chữ) và không thò quá chữ 0,6 em;
   - **vẽ trước chữ** (nằm dưới), hoặc vẽ sau nhưng trong suốt (tô sáng đã bị “dàn phẳng”). Hình đục vẽ đè lên chữ thì **không bao giờ** được đề nghị, vì bỏ nó có thể làm lộ phần bị che (ví dụ ô đen che thông tin);
   - chữ trên đó màu tối. Chữ trắng trên nền đậm (tiêu đề bảng) cần cái nền ấy;
   - hai cạnh trái phải không nằm trên đường kẻ dọc. Nằm trên thì đó là nền của ô bảng.
3. **Gom đoạn.** Các dải cùng màu nối nhau dòng sau dòng, giữa chúng không có đường kẻ, thì thuộc một đoạn. Bấm ở dòng nào của đoạn cũng bỏ cả đoạn. Hai ô cùng tô vàng nằm trên dưới nhau, cách bằng đường kẻ, là hai đoạn riêng.
4. **Bỏ.** Lấy các hình chữ nhật đó ra khỏi trang (`FPDFPage_RemoveObject`), ghi lại nội dung trang (`FPDFPage_GenerateContent`). Ghi chú tô sáng nằm trên dòng thì gỡ khỏi trang (`FPDFPage_RemoveAnnot`). Có lỗi ở bước nào thì các hình được đặt lại đúng chỗ cũ.
5. **Kiểm ngay.** Đọc lại toàn bộ chữ của trang, phải y hệt trước khi bỏ; không khớp thì báo lỗi và không ghi gì.

**Không có gì được vẽ thêm.** Không phủ trắng, không vẽ lại chữ.

### Ô của một hàng bảng thành dòng riêng

Công cụ sửa gom các đối tượng chữ cùng đường chân chữ, đứng gần nhau, thành một dòng. Trong bảng của Google Docs, “6”, “Báo cáo số lượng” và “Đ/c Nguyễn Thị Hường: Kính thưa Đại hội!” cách nhau chưa tới ba lần cỡ chữ nên bị gộp (khung xanh trong ảnh chụp chạy qua ba ô). Hậu quả: sửa “6” thành “16” thì phần chữ ở hai ô sau bị dịch sang phải theo. Giờ engine đọc đường kẻ dọc của bảng (cùng bước 1 ở trên) và ngắt dòng tại đó. Mỗi ô là một dòng; sửa ô này không làm ô kia xê dịch.

## Kiểm chứng

Tệp mẫu `tests/fixtures/highlight.pdf` (`scripts/make_highlight_fixture.py`) có 3 trang:

| Trang | Tạo bằng | Có gì |
|---|---|---|
| 1 | Chromium (Skia, bộ vẽ Google Docs dùng khi xuất PDF) | Bảng chương trình như kịch bản Đại hội: tiêu đề nền xanh đậm chữ trắng; ô “Báo cáo số lượng đoàn viên có mặt tại Đại hội” chữ đậm tô vàng ba dòng; ô nền xám; cụm tô xanh giữa dòng; chữ “Thư ký” tô vàng ở hai ô trên dưới; đoạn văn có phần tô vàng hai dòng; một dòng không tô; một từ tô riêng ở dòng sau đó |
| 2 | LibreOffice (từ tệp .docx có tô sáng và tô nền) | Đoạn tô vàng hai dòng, chữ tô xanh trong ô, ô nền xám, cụm chữ tô nền cam (shading) |
| 3 | Vẽ trực tiếp (PyMuPDF) | Ghi chú tô sáng; ô đen đục che một từ; dải vàng trong suốt vẽ đè lên dòng (tô sáng đã dàn phẳng); chữ trắng trên dải đậm; khung xanh nhạt sau ba dòng; gạch chân bằng thanh mảnh |

| Bộ kiểm | Kết quả |
|---|---|
| `tests/unmark-probe.ts` (PDFium WASM như trong app, chạy trên Node) | **35/35.** Đề nghị bỏ tô đúng 13 dòng, mỗi đoạn đúng số dòng: 3, 2, 1… Không đề nghị trên 11 dòng: tiêu đề chữ trắng, ô nền xám (Chromium và LibreOffice), ô đen che chữ, khung nền ba dòng, gạch chân. Hai ô “Thư ký” là hai đoạn. Bỏ từ dòng giữa thì cả đoạn ba dòng mất màu, các màu tô khác còn nguyên. Ghi chú tô sáng bị gỡ. Dòng không tô bị từ chối có lý do. Ô của một hàng bảng là các dòng riêng; sửa “6” thành “16” không làm ô bên cạnh xê dịch (lệch 0,00 pt) |
| `scripts/verify_unmark.py` (không dùng PDFium) | **30/30** trên ba tệp kết quả. qpdf không báo lỗi. Poppler và MuPDF đọc ra **đúng từng chữ như tệp gốc**, mọi trang. Mọi điểm ảnh thay đổi đều nằm trên dải màu đã bỏ. Không còn điểm ảnh màu tô nào ở đó (MuPDF và Poppler). Chữ trên dải vẫn đậm như cũ. Danh sách hình vẽ của MuPDF không còn hình màu tô ở đó và **không có hình mới nào phủ lên**. Các màu tô và khung không bỏ: không đổi. Trang không bỏ gì: không đổi. Số ghi chú tô sáng đúng |
| Thử ngược bộ kiểm | Một tệp giả “bỏ tô” bằng cách vẽ hình trắng đè lên từng dải vàng: bộ kiểm **báo hỏng** (hình trắng mới phủ lên dải; dải vàng vẫn còn trong danh sách hình vẽ). Nghĩa là bộ kiểm phân biệt được bỏ thật với phủ nền |
| `npm run e2e:edit` (Chromium, toàn bộ luồng trong app) | **34/34**, trong đó 10 điểm mới: hàng bảng tách ô; thanh sửa đề nghị bỏ tô và nêu đoạn 3 dòng; không đề nghị trên dòng thường, tiêu đề chữ trắng, ô xám; khóa nút khi đang gõ dở; bỏ cả đoạn, báo kết quả, màu tô khác còn; trình xem vẽ lại trang không còn dải vàng; hoàn tác, làm lại; ghi chú tô sáng; tệp xuất qua bộ kiểm độc lập ở trên (14/14); điện thoại: hàng Bỏ tô sáng vừa màn hình, chạm là bỏ |

Một điểm nhỏ về số liệu: PDFium ghi màu lại bằng số thực 32 bit (0,85 thành 0,85000002). Khi vẽ, màu phẳng có thể lệch 1/255. Mắt không thấy được, nên bộ kiểm coi lệch từ 3/255 trở xuống là không đổi.

## Giới hạn

1. **Bỏ theo đoạn, chưa bỏ được một phần đoạn.** Bấm ở dòng nào cũng bỏ cả đoạn tô liền nhau. Muốn giữ màu ở một dòng thì bỏ cả đoạn rồi dùng công cụ **Tô sáng chữ** tô lại dòng đó (thành ghi chú).
2. **Chỉ dòng sửa được mới mở thanh sửa.** Tô sáng nằm dưới chữ xoay hoặc nghiêng, chữ trong khối đồ họa gộp (Form XObject), hay lớp chữ ẩn của bản quét thì chưa bỏ được.
3. **Nền ô bảng không có viền và vừa khít một dòng chữ** có thể bị coi là tô sáng. Bảng có viền thì không bị.
4. **Tô sáng làm bằng hình khác hình chữ nhật** (bo góc, nét bút vẽ tay) chưa được nhận ra.
5. Mỗi lần bỏ tô, app ghi lại cả tệp rồi mở lại, như sửa chữ (xem `07-sua-chu-va-quet.md`, mục Giới hạn 6).

## Tự kiểm trên tệp của bạn

1. Cài bản 0.9.1, mở tệp kịch bản Đại hội.
2. Bấm **E**, chạm vào dòng “Báo cáo số lượng”. Thanh sửa phải có hàng ô vàng, ghi đoạn gồm 3 dòng, từ “Báo cáo số lượng” đến “tại Đại hội”.
3. Bấm **Bỏ tô sáng**. Ba dòng hết vàng, chữ đậm vẫn còn. Khung của dòng chỉ bao ô “Báo cáo số lượng”, không chạy sang ô “Đ/c Nguyễn Thị Hường”.
4. Bấm **Hoàn tác** thì màu vàng quay lại, **Làm lại** thì mất. Xuất PDF rồi mở bằng Edge hoặc Chrome: không còn vàng, chọn và tìm chữ vẫn được.

Nếu bước 2 không có hàng Bỏ tô sáng, gửi tôi tệp đó (hoặc chép vào thư mục `mau de test`; thư mục này không lên GitHub) để tôi xem dải màu được lưu thế nào.
