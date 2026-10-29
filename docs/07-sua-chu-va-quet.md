# 07 · Cử chỉ hai ngón, sửa chữ có sẵn, quét tài liệu (bản 0.5.0)

Đợt này làm ba việc sau lần thử trên Samsung Galaxy S24 Ultra:

1. Chụm hai ngón để phóng to không còn bị hiểu thành chọn chữ.
2. **Sửa chữ có sẵn trong PDF**, theo đúng ràng buộc ban đầu: chữ cũ được **xóa khỏi nội dung trang** và chữ mới được viết vào đó. Không phủ nền rồi viết đè.
3. **Quét giấy tờ thành PDF:** chụp hoặc chọn ảnh, app tự tìm mép giấy, người dùng kéo 4 góc nếu cần, app làm phẳng và làm sáng ảnh với màu tự nhiên.

## Tóm tắt nghiệm thu

| Việc | Trạng thái |
|---|---|
| Chụm hai ngón không chọn chữ | **Đạt.** Khi chụm hay vuốt một ngón trên chữ, không còn vùng chọn hay khung chữ nhật nào xuất hiện. Phóng to vẫn chạy. Ô chữ và ảnh vẫn chạm để chọn, kéo để di chuyển được. |
| Sửa chữ có sẵn | **Đạt, có giới hạn đã nêu.** Sửa từng dòng. Bộ kiểm độc lập (Poppler, MuPDF, qpdf) xác nhận: chữ cũ không còn trong tệp, chữ mới đọc được và hiện ra, phần còn lại của trang **không đổi một điểm ảnh nào**. |
| Quét tài liệu | **Đạt trên ảnh thử tổng hợp.** 7 ảnh chụp giả lập (5 kiểu bàn, bóng đổ đậm, ảnh lưu nằm ngang): góc giấy lệch ≤ 0,2 % đường chéo, tỉ lệ A4 tìm lại đúng, giấy trắng đều. **Chưa thử với camera của điện thoại thật.** |

## 1. Chụm hai ngón bị hiểu thành chọn chữ

**Nguyên nhân.** Ở chế độ Chọn, ngón đặt xuống đầu tiên của cú chụm được plugin chọn chữ của EmbedPDF coi là một cú kéo chuột. Plugin vừa tô sáng chữ vừa vẽ khung chọn, nên lúc phóng to vừa giật vừa hiện vùng chọn thừa.

**Sửa** (`src/app/viewer/touch-guard.ts`). Một lớp chặn sự kiện cảm ứng đặt ở gốc trình xem. Bút và chuột không bị ảnh hưởng.
- Khi có từ hai ngón trên màn hình, mọi sự kiện chạm đều không tới các plugin của trang. Cử chỉ phóng to vẫn nhận đủ, vì nó đọc sự kiện chạm riêng.
- Ở chế độ Chọn, một ngón kéo trên trang chỉ để cuộn. Riêng ô chữ, ảnh và tay nắm đổi cỡ vẫn nhận cú kéo như cũ.
- Cách chọn chữ bằng ngón tay sẽ làm sau, kiểu chạm giữ rồi kéo. Hiện tại trên điện thoại chỉ chọn chữ được bằng công cụ Tô sáng. Chuột và bút vẫn chọn chữ như trước.

**Kiểm** (`e2e:m4`, phần điện thoại, mô phỏng cảm ứng thật qua CDP):
- Cuộn một ngón và chụm hai ngón qua vùng chữ: **0** vùng chọn, **0** khung. Trước khi sửa: 1 khung khi chụm, 2 vùng chọn khi vuốt.
- Chụm vẫn phóng to: trang rộng từ 380 lên 1196 px.
- Chạm chọn được ô chữ, kéo thì ô di chuyển.

Lượt kiểm này còn lộ ra một lỗi nhỏ, đã sửa: với công cụ Thêm chữ, vuốt thẳng đứng tạo ra ô chữ rộng 0, không nhìn thấy và không chọn được. Giờ ô vẽ ra luôn có ít nhất cỡ của ô tạo bằng một lần chạm.

## 2. Sửa chữ có sẵn

### Cách dùng

1. Bấm nút **Sửa chữ có sẵn** (biểu tượng con trỏ chữ trong ô, phím **E**). Trên điện thoại, nút này nằm ở thanh dưới. Mỗi dòng sửa được có một khung nét đứt.
2. Chạm vào một dòng. Thanh sửa hiện **phía trên trang**: nó đẩy trang xuống chứ không che dòng đang sửa, và dòng luôn nằm trên bàn phím ảo.
3. Trong lúc gõ, thanh sửa nói trước **phần nào của dòng sẽ được viết lại** và bằng phông nào. Phần không đổi (ví dụ nhãn in đậm “Автор:” trước tên) giữ nguyên trong tệp. Nếu phông của phần đổi vẽ được mọi chữ thì giữ phông gốc. Nếu không, thanh liệt kê đúng những chữ phông gốc thiếu (ví dụ: *thiếu “u” “ồ”*) và báo phần đó sẽ dùng phông ezSans.
4. Bấm **Lưu dòng** (Enter). Trang được cập nhật tại chỗ: giữ nguyên mức phóng, chỗ đang đọc và góc xoay trang. Nháp tự lưu như mọi thay đổi khác. Nút **Hoàn tác / Làm lại** dùng được cho thao tác sửa chữ.

Có hai loại dòng app từ chối sửa. Khi chạm vào, app nói rõ lý do:
- **Chữ ẩn của bản quét đã nhận dạng chữ (OCR).** Sửa lớp chữ ẩn này không làm thay đổi hình trên trang.
- **Chữ nằm trong khối đồ họa gộp (Form XObject).**

### Cách làm, và vì sao đây là sửa thật

Mỗi trang PDF là một danh sách đối tượng: chữ, đường kẻ, ảnh. Phần sửa chữ (`src/engine/text-edit.ts`) chạy bằng PDFium trong worker riêng của ezPDF:

1. **Gom dòng.** Các đối tượng chữ cùng đường chân chữ và đứng gần nhau được gom thành một dòng. Hai cột cách xa nhau là hai dòng riêng, ví dụ “Người giao” và “Người nhận”.
2. **Chỉ thay phần đã đổi** (từ bản 0.5.1). So dòng cũ với dòng mới theo từng đối tượng chữ. Các đối tượng ở đầu và cuối dòng mà chữ không đổi thì **để nguyên trong tệp**, kể cả phông của chúng. Chỉ các đối tượng ở giữa bị thay. Dấu cách nằm ở đầu hay cuối phần bị thay được giữ lại, để chữ mới không dính vào nhãn bên cạnh.
3. **Bỏ chữ cũ.** Lấy các đối tượng đó ra khỏi trang (`FPDFPage_RemoveObject`). Chữ cũ không còn trong nội dung trang.
4. **Đặt chữ mới.** Tạo đối tượng chữ mới, đặt **đúng vị trí cũ trong thứ tự vẽ** (`FPDFPage_InsertObjectAtIndex`), giữ nguyên ma trận vị trí, cỡ chữ, màu và chế độ vẽ của phần bị thay. Phần phía sau trên cùng dòng được dời theo độ dài mới: “1 250 **руб.**” thành “12 500 **руб.**”, chữ “руб.” dịch sang phải, không bị đè.
5. **Ghi và kiểm.** Ghi lại nội dung trang (`FPDFPage_GenerateContent`), rồi đọc lại chữ của các đối tượng mới. Không khớp thì hủy thay đổi.
6. **Không làm hỏng trang khi lỗi.** Mọi bước đều có đường lui: lỗi ở bất cứ đâu thì các đối tượng cũ được đặt lại đúng chỗ, trang giữ nguyên.

Sau đó trình xem mở lại tài liệu từ tệp vừa ghi, nên tìm kiếm, chọn chữ và tệp xuất đều thấy chữ mới.

### Khi nào giữ được phông gốc

Phông nhúng trong PDF thường chỉ chứa những chữ đã dùng (subset). Vì vậy app giữ phông gốc khi đủ cả ba điều kiện:
- mỗi chữ mới **đã được vẽ bằng chính phông đó ở trên trang**;
- PDFium tìm được hình chữ (glyph) trong phông;
- đọc lại đúng chữ đã gõ.

Riêng phông chuẩn không nhúng, như Helvetica hay Times, thì chữ nào thuộc bảng chữ Latin chuẩn (WinAnsi) cũng giữ được phông, kể cả € ½ ×.

Không đủ điều kiện thì phần đổi dùng **ezSans** (nhúng vào tệp; có chữ Latin, tiếng Việt, và từ bản 0.5.1 có thêm **chữ Kirin (tiếng Nga) và chữ Hy Lạp**). Khi đã phải đổi phông, ezSans lấy **trọn đoạn liền nhau cùng phông** với phần đổi, để không có từ nào nửa phông này nửa phông kia. Các đoạn khác phông (nhãn đậm) vẫn giữ nguyên. Phần đậm dùng ezSans đậm. Dòng nghiêng dùng ezSans nghiêng 12°. Phông ezSans chỉ nhúng một lần cho mỗi lượt sửa. Phông gốc không có dấu cách, như tệp của LaTeX, vẫn giữ được: mỗi từ thành một đối tượng riêng, khoảng cách giữa các từ tính theo độ rộng của phông.

### Kiểm chứng

Tệp mẫu `tests/fixtures/edit-text.pdf` (`scripts/make_edit_fixture.cjs`) có 7 trang. Mỗi trang là một kiểu chương trình tạo PDF hay gặp:

| Trang | Tạo bằng | Kiểu phông | Sửa thử | Kết quả |
|---|---|---|---|---|
| 1 | Chromium (Skia) | CID TrueType subset, Identity-H | 5 dòng: thường, tiêu đề đậm, nghiêng, chữ đỏ, cột phải | Giữ phông gốc 3 dòng. Tiêu đề và dòng nghiêng dùng ezSans (phông gốc thiếu chữ) |
| 2 | LibreOffice | TrueType subset, bảng mã riêng | 2 dòng | 1 giữ phông, 1 ezSans |
| 3 | ReportLab | Helvetica chuẩn, không nhúng | 3 dòng, có “€ ½ ×” và tiếng Việt | Giữ phông cho chữ Latin, ezSans cho tiếng Việt |
| 4 | pdfLaTeX | Type 1 subset, không có dấu cách | “Tuesday” → “Thursday” | Giữ phông CMR12, mỗi từ một đối tượng |
| 5 | ReportLab, trang có /Rotate 90 | TrueType subset | 1 dòng | Đúng chỗ trên trang xoay |
| 6 | ReportLab | chữ ẩn (OCR), chữ trong Form XObject | | Không cho sửa, nói lý do |
| 7 | Chromium (Skia) | Biểu mẫu tiếng Nga: nhãn đậm, giá trị thường (hai phông trên một dòng) | Bỏ “ -” sau tên; đổi mã có chữ Kirin phông gốc thiếu; đổi số trước “**руб.**”; một dòng thường | Nhãn đậm giữ nguyên. Chỉ phần đổi được viết lại; giữ phông gốc khi đủ chữ, nếu không thì dùng ezSans có chữ Kirin. “руб.” dời theo số dài hơn |

Có thêm 2 tệp mã hóa: AES-256 và RC4, chỉ có mật khẩu chủ. Sau khi sửa, cả hai vẫn mã hóa và vẫn đọc đúng.

| Bộ kiểm | Kết quả |
|---|---|
| `tests/text-edit-probe.ts` (PDFium WASM như trong app, chạy trên Node) | **64/64**: tìm dòng, sửa, phông được chọn đúng như dự kiến, đọc lại khớp. Từ chối có lý do: dòng rỗng, dòng đã đổi, chữ không phông nào có (漢字), chữ ẩn |
| `scripts/verify_text_edit.py` (không dùng PDFium) | **72/72**: qpdf không báo lỗi; Poppler và MuPDF **đọc thấy dòng mới và không còn thấy dòng cũ**; MuPDF và Poppler đều **vẽ ra** chữ mới; phông thay thế có nhúng; **ngoài vùng hai dòng cũ và mới, ảnh trang trước và sau trùng khít từng điểm ảnh** (MuPDF, 144 dpi) |
| `npm run e2e:edit` (Chromium, toàn bộ luồng trong app) | **24/24**, kể cả: chữ mới vào engine của trình xem; giữ góc xoay, mức phóng, chỗ đang đọc; hoàn tác, làm lại; nháp còn sau khi tải lại trang; dòng tiếng Nga có nhãn đậm (chỉ phần đổi được viết lại, thanh sửa báo đúng phần đó); tệp xuất qua cùng bộ kiểm độc lập ở trên (21/21); điện thoại: thanh sửa không che dòng, sửa bằng chạm |
| Tốc độ (Chromium trên máy phát triển) | Tệp 300 trang: bật công cụ 0,4 giây, lưu một dòng 0,4 giây. Tệp quét 51 MB: 0,9 giây và 2,7 giây. Trên điện thoại có thể chậm hơn vài lần |

### Giới hạn (bản đầu, cải tiến sau)

1. **Từng dòng một, không dàn lại đoạn văn.** Dòng mới dài hơn sẽ chạy quá lề phải hoặc đè lên chữ bên cạnh. Dòng ngắn hơn để lại khoảng trống. Dòng căn phải hay căn giữa vẫn bắt đầu ở mép trái cũ.
2. **Mất khoảng cách chữ và từ của bản gốc** (Tc, Tw, Tz, kerning), vì dòng được viết lại bằng một chuỗi liền. Thường không thấy rõ; dòng căn đều hai bên sẽ hơi khác.
3. **Phần sửa trải qua nhiều kiểu chữ** (ví dụ sửa cả nhãn đậm lẫn giá trị thường trong một lần) sẽ thành **một kiểu**: kiểu của phần chiếm nhiều chữ nhất. Sửa riêng từng phần thì mỗi phần giữ kiểu của nó.
4. **Phông thay thế là chữ không chân (ezSans),** nét to hơn Liberation hay Arial một chút. Dòng gốc chữ có chân (Times) mà thiếu chữ thì nhìn khác hẳn. Muốn khắc phục cần một phông có chân đủ tiếng Việt và tiếng Nga, nhúng theo subset. Chữ Trung, Nhật, Hàn, Ả Rập chưa có phông thay thế: nếu phông gốc thiếu chữ đó thì app từ chối và nói rõ.
5. **Chưa sửa được:** chữ xoay hoặc nghiêng theo góc, chữ trong Form XObject, chữ ẩn của OCR, chữ vẽ bằng nét (đường vector), chữ là ảnh trong bản quét. Bản quét cần OCR, chưa có.
6. **Bản quét 51 MB:** mỗi lần lưu dòng phải ghi lại cả tệp và mở lại. Mỗi bước hoàn tác giữ một bản tệp trong bộ nhớ, tối đa 20 bản hoặc 300 MB.
7. Trên điện thoại, chọn chữ bằng ngón tay tạm thời không có (xem mục 1).

### Bản 0.5.1: dòng tiếng Nga không sửa được (thử trên S24 Ultra, 29/10)

**Hiện tượng.** Dòng “**Автор:** Нгуен Дык Зуи -” (nhãn đậm, tên chữ thường, phông Inter nhúng dạng subset). Chỉ xóa “ -” ở cuối, app vẫn báo phông gốc thiếu “А” rồi từ chối: “Phông gốc và phông thay thế đều chưa có ký tự: А в т о р…”.

**Nguyên nhân.** Hai lỗi chồng lên nhau:
1. App viết lại **cả dòng** bằng phông của phần chữ thường. Chữ “А” hoa chỉ có trong nhãn đậm “Автор:”, nên bộ chữ đã nhúng của Inter thường không có nó. Phông gốc vẫn nằm trong tệp, chỉ là thiếu chữ đó.
2. Phông thay thế ezSans khi đó **chỉ có chữ Latin và tiếng Việt**, không có chữ Kirin nào.

**Sửa.**
1. Chỉ viết lại phần đã đổi (xem “Cách làm” ở trên). Trường hợp này chỉ có “ -” bị bỏ; nhãn và tên giữ nguyên đối tượng, phông gốc vẫn dùng được.
2. ezSans thêm chữ Kirin (304 ký tự, cả ё, №, ₽) và chữ Hy Lạp, lấy từ cùng bộ Noto Sans (`scripts/make_fonts.py`). Mỗi tệp phông từ 34 KB lên 68 KB. Độ rộng của mọi chữ cũ giữ nguyên, nên ô chữ tiếng Việt hiển thị y như trước. Nhờ vậy:
   - Ô **Thêm chữ** gõ tiếng Nga cũng xuất ra đủ dấu;
   - PDF dùng phông tiếng Nga không nhúng trong tệp cũng hiển thị được khi không có mạng.

Trang 7 của tệp mẫu dựng lại đúng trường hợp này. Trước khi sửa: app từ chối. Sau khi sửa: đạt cả ở bộ kiểm engine, bộ kiểm độc lập và `e2e:edit`. Ảnh trước/sau: `docs/bang-chung/m5-sua-chu-tieng-nga.png`.

## 3. Quét tài liệu

### Cách dùng

- Mở: nút **Quét tài liệu** ở màn hình trống, hoặc biểu tượng quét trên thanh trên.
- **Chụp ảnh** (điện thoại): mở camera sau. **Chọn ảnh có sẵn**: chọn một hoặc nhiều ảnh.
- **Một ảnh:** vào màn căn góc. App đã đặt 4 góc lên mép giấy tìm được. Kéo góc nào chưa khớp. Trong lúc kéo, một kính lúp hiện phần ảnh dưới ngón tay. Bàn phím: phím mũi tên dịch góc đang chọn. Nhiều ảnh: xử lý luôn rồi vào màn xem.
- **Màn xem:** dải ảnh nhỏ các trang, nút **+** để thêm trang. Mỗi trang có **Xoay**, **Căn lại góc**, **Xóa trang** và công tắc **Làm sáng** (mặc định bật; tắt thì giữ ánh sáng và màu như ảnh chụp).
- **Tạo PDF:** mở bản quét thành tài liệu mới, tên “Bản quét 29-10-2026 15.30.pdf”. Nháp lưu ngay. Từ đây dùng mọi công cụ như với PDF khác: thêm chữ, ký, xuất.

Ảnh chỉ được xử lý trên máy, trong một worker riêng (`src/scan/`). Bản kiểm xác nhận không có request nào ra ngoài.

### Cách làm

| Bước | Cách làm |
|---|---|
| Tìm tờ giấy (`detect.ts`) | Trên ảnh thu nhỏ còn 400 px, mỗi điểm ảnh được chấm điểm theo độ sáng trừ độ đậm màu: giấy sáng và ít màu. Có hai cách tách tờ giấy: (a) một ngưỡng chung (Otsu); (b) **loang từ giữa ảnh**, dừng ở chỗ độ sáng đổi gắt theo bất kỳ hướng nào. Bóng đổ đổi chậm nên loang qua được; mép giấy đổi gắt nên chặn lại. Vùng tìm được được lấp lỗ do chữ, rồi lấy bao lồi. Chọn 4 điểm bao diện tích lớn nhất, sau đó khớp từng cạnh bằng một đường thẳng qua mép thật, để góc gấp hay bị che vẫn đặt đúng chỗ. Trong hai cách, giữ kết quả có **cạnh yếu nhất vẫn rõ nhất** |
| Tỉ lệ thật của tờ giấy (`geometry.ts`) | Ảnh chụp nghiêng làm cạnh xa trông ngắn hơn. Tỉ lệ thật được tính từ hình học phối cảnh của camera (Zhang & He, 2007). Gần tỉ lệ A4 (sai dưới 3 %) thì lấy đúng A4. Ảnh chụp gần như thẳng thì dùng độ dài cạnh |
| Làm phẳng (`process.ts`) | Phép biến đổi phối cảnh từ 4 góc, nội suy song tuyến tính. Cạnh dài nhất tối đa 2400 px, khoảng 200 dpi cho khổ A4, và không phóng to quá 1,25 lần ảnh gốc |
| Làm sáng | Ước lượng ánh sáng rọi lên giấy từ chính tờ giấy: lọc lấy giá trị sáng nhất để xóa chữ, rồi làm mờ. Sau đó chia ảnh cho ánh sáng đó, **riêng từng kênh màu**. Kết quả: giấy trắng đều, mất bóng đổ và ám màu đèn, mực giữ màu riêng (con dấu đỏ vẫn đỏ, chữ ký xanh vẫn xanh). Thêm một đường cong nhẹ cho mực đậm hơn, độ bão hòa tăng 8 %. **Không có bước ngưỡng nào**, nên ảnh và con dấu trên giấy vẫn tự nhiên. Vùng tối lớn (ảnh, ô đen) bị giới hạn mức tăng sáng để không bị bạc màu |
| PDF (`jpeg-pdf.ts`) | Mỗi trang là một ảnh JPEG chất lượng 85, nhúng nguyên (DCTDecode), không nén lại lần hai. Khổ trang: cạnh ngắn theo A4 (595 pt), cạnh dài theo tỉ lệ tờ giấy (đúng 842 pt nếu là A4) |
| Ảnh lưu nằm ngang | Ảnh có cờ EXIF hướng xoay được giải mã theo đúng hướng hiện trên màn hình |

### Kiểm chứng

Ảnh thử `tests/fixtures/scan/` (`scripts/make_scan_fixtures.py`) được tạo như sau:
- Một tài liệu có chữ tiếng Việt, bảng, con dấu đỏ và chữ ký xanh.
- Chụp qua **mô hình camera lỗ kim**: tờ A4 nghiêng 2–28°.
- Đặt trên nhiều nền bàn, ánh sáng không đều, ám màu vàng, có nhiễu, mờ nhẹ và nén JPEG.

Vì biết trước 4 góc và tài liệu gốc, có thể đo chính xác kết quả:

| Ảnh | Góc lệch | Tỉ lệ | Khớp bản gốc | Giấy: trước → sau | Mực | Dấu đỏ (R−G) |
|---|---|---|---|---|---|---|
| bàn gỗ tối, nghiêng 18° | 0,2 % | A4 | 0,88 | 218 ± 17 → 244 ± 2 | 92 → 82 | 86 |
| bàn xám, nghiêng 28° | 0,2 % | A4 | 0,96 | 218 ± 17 → 244 ± 2 | 91 → 81 | 95 |
| bàn màu be (tương phản thấp) | 0,2 % | A4 | 0,97 | 217 ± 19 → 244 ± 2 | 82 → 71 | 117 |
| khăn ca rô sặc sỡ | 0,2 % | A4 | 0,94 | 217 ± 17 → 244 ± 1 | 92 → 83 | 102 |
| bóng đổ đậm che nửa trang | 0,1 % | A4 | 0,94 | 209 ± 93 → 236 ± 26 | 82 → 77 | 119 |
| ảnh lưu nằm ngang (EXIF 6) | 0,1 % | A4 | 0,97 | 218 ± 17 → 244 ± 2 | 91 → 81 | 106 |
| chụp thẳng từ trên xuống | 0,2 % | A4 | 0,96 | 217 ± 20 → 244 ± 2 | 80 → 69 | 122 |

Cách đọc các cột:
- **Góc lệch:** khoảng cách lớn nhất giữa góc tìm được và góc thật, tính theo % đường chéo ảnh.
- **Khớp bản gốc:** tương quan với tài liệu gốc, chịu được vài điểm ảnh lệch; 1 là trùng khít.
- **Giấy:** độ sáng trung vị của các vùng giấy trắng, ± chênh lệch giữa chỗ sáng và chỗ tối.
- **Mực:** độ sáng của 3 % điểm tối nhất trong khối chữ, trước và sau khi làm sáng (số nhỏ hơn là chữ đậm hơn).

Trên máy phát triển, tìm mép mất 0,1–0,2 giây mỗi ảnh, xử lý một trang 0,2–0,3 giây.

| Bộ kiểm | Kết quả |
|---|---|
| `npm run e2e:scan` (Chromium, dev server) | **24/24**: 7 ảnh như bảng trên, chạy qua đúng worker của app. PDF: qpdf không báo lỗi, 7 ảnh JPEG nhúng nguyên, trang A4, MuPDF và Poppler vẽ được. Luồng trong app: góc đặt sẵn lệch 0,21 %; kéo góc có kính lúp; phím mũi tên dịch góc; bật/tắt Làm sáng; xoay; xóa; hỏi lại trước khi đóng; Tạo PDF mở tài liệu mới với nháp lưu ngay; nút quét trên thanh trên mở được lượt quét mới; xuất ra 2 trang (trang xoay thành khổ ngang); điện thoại: nút Chụp ảnh mở camera sau; không request ra ngoài, không lỗi |

### Trên Android

- **Chụp ảnh.** Nút này dùng `<input capture>`. Capacitor chuyển sang **app camera của máy**, nên ezPDF **không cần quyền CAMERA**.
- **Cho Android 11+ thấy app camera.** `AndroidManifest.xml` có thêm mục `<queries>` cho `IMAGE_CAPTURE`; thiếu mục này, Android 11 trở lên không cho ezPDF thấy app camera.
- **Dọn ảnh chụp.** App camera lưu ảnh chụp vào thư mục riêng của ezPDF. Đó là ảnh giấy tờ, nên plugin `EzFiles` có thêm lệnh `clearCaptures`, xóa các ảnh này mỗi khi đóng màn quét và khi mở app.

### Giới hạn

1. **Chưa thử với camera thật.** Ảnh thử là ảnh tổng hợp. Ảnh thật có thể khó hơn: giấy trên bàn trắng, giấy cong hoặc gấp, có tay cầm trong ảnh, chụp thiếu một góc. Khi đó app đề xuất cả ảnh và nhắc người dùng kéo góc.
2. **Giấy cong không được làm phẳng.** Chỉ sửa phối cảnh của mặt phẳng; trang sách cong vẫn cong.
3. **Chưa có OCR,** nên bản quét chưa tìm được chữ và chưa sửa chữ được.
4. Chưa có ảnh xem trước trực tiếp từ camera với khung bắt mép như CamScanner. Hiện tại camera chụp xong mới tìm mép.
5. Ảnh lớn được giải mã tối đa 3200 px cạnh dài để đỡ tốn bộ nhớ, đủ cho khoảng 200 dpi ở khổ A4.

## 4. Kiểm thử toàn bộ, bản 0.5.0

Mọi bộ kiểm cũ chạy lại sau các thay đổi này bằng `scripts/regress.sh` (dev) và `scripts/regress.sh preview` (bản build production). Chi tiết từng điểm kiểm: `docs/bang-chung/m5-e2e.json`.

| Bộ kiểm | Dev server | Bản production |
|---|---|---|
| `e2e` (mốc 1–2) | 56/56 | 56/56 |
| `e2e:m3` | 50/50 | 49/49 (không có trang kiểm pdf.js) |
| `e2e:m4` | 14/14 (thêm 3 điểm về cảm ứng) | 22/22 (service worker giữ đủ 19 tệp, kể cả worker quét và phông đậm; chạy offline) |
| `e2e:edit` | 24/24 | 24/24 |
| `e2e:scan` | 24/24 | 16/16 (phần đo engine chạy bằng trang kiểm chỉ có ở dev) |
| `test:edit` | 64/64 + 72/72 kiểm độc lập | |
| `test:layout`, `test:engine`, `verify`, `test:m3`, `test:storage` | 14/14, PASS, PASS ×3, PASS, 25/25 | |
| `scripts/smoke-desktop.cjs` (bản desktop thật trên Linux) | 18/18 | |
| `scripts/check_android_java.sh` | Plugin (thêm `clearCaptures`) biên dịch được | |

Đổi trong các bộ kiểm cũ:
- **Thanh dưới trên điện thoại** không còn nút phóng to và thu nhỏ: hai ngón đã thay việc này, và nhờ đó còn chỗ cho nút Sửa chữ. `e2e:m4` giờ thu nhỏ bằng cách chụm hai ngón lại và kiểm kết quả.
- **Kiểm “không có nút chết”** của `e2e` và `e2e:m3` ghi rằng ba nút mới (Sửa chữ, Quét ở thanh trên, Quét ở màn trống) được hai bộ kiểm mới bấm thử.
- **Lỗi nhỏ đã sửa:** số trang trên điện thoại hiện “1/0” cho tới lần cuộn đầu tiên; giờ lấy tổng số trang từ tài liệu.
- **Kiểm “không có lỗi trang” lúc đạt lúc trượt** (bản 0.5.1). Một lượt trên bản production báo `ERR_FILE_NOT_FOUND`, hai lượt chạy lại thì không. Nguyên nhân có khả năng nhất: lớp vẽ trang của EmbedPDF thu hồi ảnh tạm (`blob:`) của lần vẽ cũ khi có lần vẽ mới, trong lúc thẻ ảnh cũ chưa tải xong. Trang vẫn hiện đúng, nhưng Chrome ghi một dòng lỗi; máy chậm như máy CI dễ gặp hơn. Đây có thể là lý do job web đỏ ở lượt CI #4. Các bộ kiểm giờ bỏ qua đúng loại lỗi này (chỉ với địa chỉ `blob:`), và ghi kèm địa chỉ tài nguyên cùng bước kiểm cho mọi lỗi khác, để lần sau lỗi tự chỉ ra nguồn gốc.

## 5. Thử trên S24 Ultra

Cài APK mới đè lên bản cũ được: cùng khóa ký, nháp vẫn còn.

1. **Hai ngón:** mở một PDF nhiều chữ, chụm và mở rộng nhiều lần trên vùng chữ. Không được có vùng tô xanh hay khung chữ nhật. Phóng to phải mượt.
2. **Một ngón:** vuốt trên chữ thì cuộn, không chọn chữ.
3. **Đối tượng:** chạm vào một ô chữ đã thêm thì ô được chọn; kéo thì ô di chuyển.
4. **Sửa chữ:** chạm nút Sửa chữ ở thanh dưới, chạm một dòng. Thanh sửa hiện ở trên, dòng không bị bàn phím che. Đổi vài chữ rồi Lưu dòng. Thử một chữ có dấu chưa có trên trang để thấy lời báo đổi phông. Hoàn tác.
5. **Xuất:** xuất tệp vừa sửa, mở bằng app PDF khác (Google Drive, Adobe). Dòng mới phải hiện đúng. Tìm chữ cũ phải không thấy.
6. **Quét:** chạm biểu tượng quét. Chụp ảnh một tờ giấy đặt trên bàn. Kiểm 4 góc; kéo một góc để thấy kính lúp. Bấm Xong. Chụp thêm 1–2 trang bằng nút +. Thử tắt Làm sáng. Tạo PDF, rồi xuất.
7. **Ảnh có sẵn:** quét bằng ảnh đã có trong thư viện, kể cả ảnh chụp dọc và ngang.
8. Ghi lại những ảnh mà app tìm sai mép (gửi kèm nếu được): đó là dữ liệu để chỉnh bước tìm mép.
