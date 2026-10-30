# 11 · Đọc và sửa nhẹ tệp Word (.docx) (bản 0.8.0)

Mở tệp Word ngay trên máy, sửa nhẹ rồi lưu ra một tệp Word mới. Tài liệu không rời thiết bị. Tính năng dùng chung một mã cho Windows, web (cả iPhone) và Android.

Nguyên tắc: **phần nào không sửa thì ghi lại y như cũ.** Đoạn văn, bảng hay ảnh mà người dùng không động tới được ghi lại đúng XML gốc. Đoạn đã sửa vẫn giữ kiểu đoạn, danh sách, khoảng cách, và phông, cỡ, màu của từng đoạn chữ. Chỉ chữ và đậm/nghiêng/gạch chân là đổi theo người dùng. Mọi phần khác của tệp (kiểu chữ, đánh số, đầu trang, chân trang, ảnh, chú thích, cài đặt…) được chép lại từng byte.

## Mở tệp Word

| Nơi | Cách mở |
|---|---|
| Mọi bản | Nút **Mở tệp** (Ctrl O) trên thanh công cụ, hoặc **Chọn tệp** ở màn đầu: chọn được cả `.pdf` lẫn `.docx`. Kéo thả tệp vào cửa sổ. |
| Windows | Bấm chuột phải vào tệp `.docx` → Mở bằng → ezPDF (bộ cài đăng ký ezPDF trong danh sách “Mở bằng”, không giành mặc định của Word). |
| Android | Mở hoặc chia sẻ một tệp Word sang ezPDF từ ứng dụng khác (Files, Zalo, Gmail…). |
| Web app đã cài (Chrome, Edge máy tính) | Đăng ký mở được `.docx`, như với PDF. |

Tệp Word mở trên **màn Word**, phủ lên màn PDF. Đóng màn Word thì quay lại tài liệu PDF đang mở (nếu có). Mở một PDF trong lúc đang ở màn Word thì màn Word đóng lại; nếu còn thay đổi chưa lưu thì app hỏi trước.

Tệp `.doc` kiểu cũ (Word 97–2003) và tệp Word có mật khẩu chưa mở được: app nói rõ lý do và cách làm (mở bằng Word rồi lưu lại thành `.docx`).

## Làm được gì

| Việc | Cách làm |
|---|---|
| Sửa chữ | Bấm hoặc chạm vào chỗ cần sửa rồi gõ. Gõ tiếng Việt bằng bộ gõ (Unikey, Telex trên điện thoại) như bình thường. |
| Đậm, nghiêng, gạch chân | Chọn chữ rồi bấm **B / I / U** trên thanh, hoặc Ctrl B / Ctrl I / Ctrl U. Nút sáng lên khi chữ đang chọn có định dạng đó. |
| Thêm đoạn | Enter tách đoạn; đoạn mới giữ định dạng của đoạn đang ở. Enter ở cuối một mục danh sách tạo mục mới với số tiếp theo. Enter ở một mục danh sách trống thì ra khỏi danh sách. Enter ở cuối một tiêu đề cho đoạn thường. Shift+Enter xuống dòng trong cùng đoạn. |
| Xóa đoạn | Nút **Xóa đoạn** (thùng rác) xóa đoạn có con trỏ, hoặc mọi đoạn trong vùng đang chọn. Backspace/Delete để gộp hoặc xóa như mọi trình soạn thảo. |
| Sửa chữ trong bảng | Bấm vào ô rồi gõ; Enter thêm đoạn trong ô. Bảng giữ nguyên số hàng, số cột và các ô gộp. |
| Hoàn tác | ↶ / ↷ hoặc Ctrl Z / Ctrl Y. |
| Lưu | **Lưu tệp Word** (Ctrl S; trên điện thoại: **Lưu**). Tệp mới tên là `<tên gốc> (ezPDF).docx`; tệp gốc không bao giờ bị ghi đè. Trình duyệt: tải về. Windows, Android: hộp thoại lưu của hệ điều hành. |
| Chia sẻ | Nút chia sẻ gửi đúng tệp Word mới (như nút Lưu ghi ra), qua bảng chia sẻ của điện thoại hay các cách chia sẻ trên Windows. |

Trạng thái bên cạnh tên tệp: chấm cam **Chưa lưu** khi có thay đổi chưa lưu thành tệp, **Đã lưu** sau khi lưu. Đóng màn Word khi còn thay đổi chưa lưu thì app hỏi **Ở lại** hay **Bỏ thay đổi**. Trình duyệt cũng hỏi trước khi đóng thẻ.

## Hiển thị

- Trang theo đúng khổ và lề của tệp. Màn hình hẹp (điện thoại): trang co theo chiều rộng màn hình, lề co theo, chữ tự xuống dòng; bảng co vừa trang.
- Kiểu đoạn và kiểu chữ của tệp (Normal, Heading…), phông chữ của theme, cỡ, màu, tô nền, gạch ngang, chỉ số trên/dưới, căn lề, thụt lề, khoảng cách đoạn, viền đoạn.
- Danh sách: dấu đầu dòng và số được đếm lại sau mỗi lần sửa (1. 2. 3., a. b., i. ii., số nhiều cấp).
- Bảng: viền theo kiểu bảng (ví dụ “Table Grid”) và viền riêng của ô, ô gộp ngang và dọc, màu nền ô, chiều rộng cột.
- Ảnh trong dòng (PNG, JPG, GIF…). Ảnh EMF/WMF và hình vẽ hiện thành nhãn “Hình”; chúng vẫn nằm nguyên trong tệp khi lưu.
- Đầu trang và chân trang hiện mờ, chỉ để xem.
- Trường (số trang…) hiện giá trị đã lưu trong tệp; dấu chú thích cuối trang hiện số; ngắt trang hiện nhãn “ngắt trang”.

## Những phần chỉ xem

Một số nội dung ezPDF hiện ra nhưng không cho sửa, vì sửa sẽ dễ làm hỏng tệp. Chúng có nền xám nhạt, chữ **Chỉ xem**, và được ghi lại y nguyên khi lưu. Thanh vàng đầu màn nói có bao nhiêu đoạn như vậy và vì sao.

- Đoạn có **theo dõi thay đổi** (Track Changes): chữ chèn thêm hiện gạch dưới màu xanh, chữ bị xóa hiện gạch ngang màu đỏ.
- Đoạn có **công thức toán** (Equation).
- **Ô điều khiển nội dung** (Content Control), ví dụ mục lục tự động.
- Liên kết có cấu trúc phức tạp, thẻ thông minh, trường dữ liệu đặc biệt, chữ viết từ phải sang trái.

Bấm vào một đoạn chỉ xem thì cả đoạn được chọn. Gõ hay dán không đè lên nó. Muốn bỏ hẳn đoạn đó thì bấm **Xóa đoạn** (hoặc Backspace/Delete).

## Cách làm

Mã nằm trong `src/word/` (đọc, ghi, lệnh sửa) và `src/app/word/WordScreen.tsx` (màn hình).

- **Đọc** (`package.ts`, `read.ts`): giải nén tệp bằng fflate (MIT). Tìm phần nội dung chính qua quan hệ của gói, đọc `document.xml`, kiểu chữ (`styles.xml`), đánh số (`numbering.xml`), phông của theme, ảnh, đầu trang và chân trang. Nội dung thành một tài liệu ProseMirror (MIT). Mỗi đoạn, bảng, ảnh nhớ chỉ số của phần XML gốc của nó.
- **Sửa** (`commands.ts`): Enter, Shift+Enter, B/I/U, Xóa đoạn. Có hai lớp chặn:
  - không thay đổi nào được thêm, tách hay đổi hình dạng một bảng;
  - gõ hay dán không đè lên đoạn chỉ xem.
- **Ghi** (`write.ts`):
  - Đoạn hay bảng giống hệt lúc đọc được ghi bằng chính XML gốc.
  - Đoạn đã sửa được dựng lại từ `w:pPr` gốc và `w:rPr` gốc của từng đoạn chữ; chỉ bật, tắt đậm, nghiêng, gạch chân khi người dùng đổi, theo đúng thứ tự phần tử Word yêu cầu.
  - Bảng đã sửa giữ thuộc tính bảng, hàng, ô; chỉ nội dung ô được dựng lại.
  - Dấu trang (bookmark), mã trường, ảnh, liên kết đi theo đoạn của chúng. Ngắt section chỉ giữ ở một đoạn.
  - Chỉ `word/document.xml` được viết lại. Các phần khác của gói chép nguyên byte, đúng thứ tự cũ.
- Màn Word chỉ được tải khi mở một tệp Word, nên bản PDF không nặng thêm lúc khởi động.
- Nền tảng:
  - `pickFile` và `saveWord` trong `src/platform/`;
  - Android: chọn tệp nhận cả kiểu Word, “Mở bằng” và chia sẻ nhận `.docx`, chia sẻ đặt đúng kiểu tệp;
  - Windows: hộp thoại có bộ lọc Word, tham số dòng lệnh nhận `.docx`, liên kết tệp kiểu “Alternate”;
  - web app: `file_handlers` nhận `.docx`.

## Kiểm chứng

Ba tệp mẫu do ba chương trình khác nhau tạo (`scripts/make_word_fixtures.py`):
- `word-a.docx` (python-docx, dựa trên mẫu của Word): tiêu đề, chữ nhiều định dạng tiếng Việt, danh sách gạch đầu dòng và số, bảng có ô gộp ngang và dọc, ảnh, liên kết, dấu trang, tab, xuống dòng, ngắt trang, trường PAGE, đầu và chân trang, một đoạn theo dõi thay đổi, một công thức, một ô điều khiển nội dung;
- `word-lo.docx`: chính tệp đó lưu lại bằng LibreOffice;
- `word-pandoc.docx`: pandoc tạo từ Markdown (danh sách nhiều cấp, bảng, trích dẫn).

Thêm `word-b.docx` (python-docx), gom các ca khó khi lưu:
- ngắt section dọc → ngang;
- tiêu đề có dấu trang `_Toc`;
- lời bình (comment);
- ô bảng kết thúc bằng một dấu trang;
- chữ có hiệu ứng Word 2010;
- trường giữa câu;
- đoạn có dấu đoạn được chèn khi theo dõi thay đổi.

Mọi tệp ezPDF lưu đều được **đọc lại bằng chương trình khác**: python-docx (`scripts/verify_word.py`) và LibreOffice (mở rồi xuất ra chữ).

| Bộ kiểm | Kết quả |
|---|---|
| `npm run test:word` (đọc/ghi trên Node, `tests/word-probe.ts`) | **56/56**. Chi tiết ngay dưới bảng. |
| `npm run e2e:word` (Chromium, cả luồng trong app) | **28/28** trên dev server và **28/28** trên bản build production. Chi tiết ngay dưới bảng. |
| `scripts/smoke-desktop.cjs` (bản desktop thật, WebKitGTK, cùng nhân với Safari) | **25/25**. Bước mới: tệp `.docx` đưa vào app như “Mở bằng”, gõ bằng phím thật, làm đậm, lưu qua hộp thoại lưu của hệ thống; python-docx đọc đúng; tệp gốc không đổi. |

`test:word` kiểm:
- Đọc đúng cả ba tệp: khối, định dạng, danh sách `• • 1. 2. 3.`, bảng có ô gộp, ảnh đúng cỡ, liên kết, đầu trang, chân trang, 3 khối chỉ xem.
- Lưu khi không sửa: `document.xml` giống hệt, mọi phần khác giống từng byte và đúng thứ tự.
- Sửa bằng chính các lệnh của màn Word rồi lưu, python-docx thấy đúng:
  - xóa đoạn; đậm, bỏ nghiêng, bỏ gạch chân; gõ thêm; tách đoạn (vẫn căn giữa, vẫn Times New Roman);
  - Enter sau tiêu đề (ra đoạn Normal); mục danh sách mới số 4; ra khỏi danh sách;
  - sửa ô bảng (bảng vẫn 3×3); chèn chữ trong liên kết; sửa đoạn có dấu trang và đoạn có trường;
  - đoạn theo dõi thay đổi, công thức, ảnh, liên kết, dấu trang, trường PAGE vẫn còn trong tệp.
- Thuộc tính chữ đúng thứ tự Word yêu cầu; không trùng mã đoạn; ngắt section chỉ một.
- Các ca của lượt rà soát (dưới).

`e2e:word` kiểm:
- Hiển thị: số danh sách, bảng, ảnh, đầu trang, chân trang, đoạn chỉ xem.
- Bấm và gõ; B/I/U từ nút và phím tắt; Xóa đoạn; Enter trong danh sách; ô bảng; Shift+Enter.
- Gõ tiếng Việt qua bộ gõ (composition); hoàn tác, làm lại từng bước.
- Đoạn chỉ xem không bị gõ đè.
- Sao chép, dán trong tài liệu (ngắt trang, ảnh); dán từ trang web.
- Lưu ra `word-a (ezPDF).docx`: python-docx kiểm 12 điểm, ảnh dán có số hiệu riêng, LibreOffice mở được.
- Đóng khi chưa lưu thì app hỏi; mở Word chồng lên PDF rồi quay lại; mở PDF từ màn Word; tệp `.doc` cũ được giải thích.
- Điện thoại 390 px: thanh vừa màn hình, bảng vừa trang, chạm rồi gõ, làm đậm.
- Không gửi gì ra ngoài.

Cả bản 0.8.0 đều đạt:

| Bộ | Dev | Production |
|---|---|---|
| `e2e` | 57/57 | 57/57 |
| `e2e:m3` | 50/50 | 49/49 |
| `e2e:m4` | 14/14 | 22/22 |
| `e2e:edit` | 24/24 | 24/24 |
| `e2e:scan` | 26/26 | 16/16 |
| `e2e:share` | 36/36 | 36/36 |
| `e2e:pages` (Bộ công cụ, thêm kiểm vị trí nút) | 28/28 | 28/28 |
| `e2e:word` (mới) | 28/28 | 28/28 |

Cùng đạt:
- `test:layout`, `test:engine`, `verify`, `test:m3`, `test:storage`, `test:edit`, `test:pages`, `test:word`;
- `cargo test` (vỏ desktop nhận `.docx`, đặt tên tệp chia sẻ `.docx`);
- `scripts/check_android_java.sh` (Java Android biên dịch được).

## Rà soát mã độc lập

Một lượt rà soát riêng đọc toàn bộ mã Word mới, không xem cách làm ở trên. Mỗi lỗi đều được tái hiện bằng một kịch bản nhỏ. Đã sửa tất cả, trừ điểm 10 (sửa được một phần); mỗi lỗi chính có bước kiểm riêng trong `test:word` hoặc `e2e:word`.

1. **Sao chép, dán trong tài liệu làm hỏng các phần tử trong dòng.** Dấu chú thích cuối trang thành chữ “1”, nhãn “ngắt trang” thành chữ thật trong văn bản, ảnh và trường bị mất. Giờ sao chép trong cùng tài liệu giữ nguyên chính phần tử đó. Dán sang tệp khác thì bỏ đi, không biến nhãn thành chữ. Ảnh dán lần thứ hai được cấp số hiệu riêng (`wp:docPr`). Dấu trang, mốc lời bình, dấu chú thích không bị ghi hai lần.
2. **Xóa một bảng xong thì Hoàn tác không chạy nữa.** Lớp chặn bảng chặn luôn cả lệnh hoàn tác đưa bảng trở lại. Giờ lớp chặn so với các bảng gốc của tệp, nên Hoàn tác đưa bảng về được. “Xóa đoạn” khi vùng chọn trải qua hai ô của một bảng không xóa cả bảng nữa.
3. **Tệp `.docm` (có macro) và `.dotx` (tệp mẫu)** sẽ được lưu dưới tên `.docx` mà Word không mở. Giờ app từ chối mở và nói lý do.
4. **Ngắt section bị nhân đôi** khi bấm Enter ở cuối đoạn chứa nó. Giờ ngắt section chỉ được ghi một lần, ở đoạn gốc. Cuối mỗi section có nhãn “ngắt section”, để người dùng thấy trước khi xóa.
5. **Enter, Backspace, Delete làm mất dấu trang và mốc lời bình ở đầu hay cuối đoạn**, kể cả dấu `_Toc` mà Word đặt quanh mỗi tiêu đề cho mục lục. Giờ chúng là phần tử trong dòng, đi theo chữ như mọi ký tự. Enter ngay trước những phần tử vô hình ở cuối đoạn được coi là Enter ở cuối đoạn. Khi lưu, nửa còn lại của một cặp bị tách rời thì được bỏ đi: đầu dấu trang không còn cuối, trường còn `begin` mà mất `end`. Word không bao giờ gặp nửa cặp.
6. **Một lần Backspace xóa luôn đoạn chỉ xem** đứng trước. Giờ lần đầu chọn đoạn đó, lần sau mới xóa.
7. **Sửa một ô bảng làm đổi ô khác** (thêm dòng trống vào ô kết thúc bằng một dấu trang). Giờ ô không sửa giữ nguyên XML gốc.
8. **Thuộc tính chữ ghi sai thứ tự** khi đoạn chữ có hiệu ứng Word 2010 (`w14:`), ví dụ `w:u` đứng sau `w14:textOutline`. Giờ phần tử mới luôn đứng trước phần mở rộng.
9. **Bảo mật: màu và tên phông trong tệp có thể chèn CSS**, ví dụ phủ lên thanh công cụ hay tải ảnh từ trang khác. Giờ màu phải là 6 chữ số hex, tên phông chỉ gồm chữ, số và vài dấu. Bộ kiểm dùng một tệp cố ý chèn `position:fixed` và `url(...)`.
10. **Thay đổi chưa lưu có thể mất khi đóng app.** Bản desktop giờ hỏi trước khi đóng cửa sổ. Trên điện thoại chưa có cách giữ lại: xem phần Giới hạn.
11. **Chrome không chia sẻ được tệp .docx qua Web Share.** Trình duyệt nào không chia sẻ được tệp Word thì nút chia sẻ thành tải về.
12. Đoạn có dấu đoạn được chèn hay xóa khi theo dõi thay đổi giờ cũng chỉ xem.
13. Tệp không có tên từ Android được nhận ra là Word hay PDF theo nội dung, không theo tên.
14. Bước kiểm biên dịch Java Android cập nhật theo hàm Capacitor mới dùng.
15. Giới hạn tệp giải nén (chặn “zip bomb”), chữ ruby, danh sách dùng kiểu đánh số liên kết, chú thích cuối tài liệu đánh số riêng.

## Giới hạn

- Sửa nhẹ: chưa đổi phông, cỡ, màu, căn lề, kiểu đoạn; chưa thêm hay bớt hàng, cột bảng; chưa chèn ảnh; chưa thêm chú thích (comment) hay theo dõi thay đổi.
- Không chia trang: tài liệu hiện như một trang dài (ngắt trang hiện nhãn). Đầu trang, chân trang chỉ hiện bản mặc định của section cuối.
- Hiển thị gần giống Word, không giống từng điểm ảnh: không có điểm dừng tab, hình nổi (floating) hiện trong dòng, hộp chữ và hình vẽ chỉ có nhãn, định dạng có điều kiện của kiểu bảng (hàng tiêu đề đậm…) chưa áp dụng.
- Nội dung trong ô điều khiển nội dung, theo dõi thay đổi, công thức: chỉ xem.
- Chưa có bản nháp tự lưu cho tệp Word như với PDF: thay đổi chỉ an toàn sau khi bấm Lưu.
  - App hỏi trước khi đóng màn Word, khi đóng thẻ trình duyệt và khi đóng cửa sổ bản desktop.
  - Trên điện thoại (Android, web app iPhone), app bị tắt hẳn thì thay đổi chưa lưu bị mất.
  - Trên trình duyệt, nếu người dùng hủy lời hỏi tải về thì app vẫn coi là đã lưu.
- Chưa mở được `.doc` kiểu cũ, tệp có mật khẩu, tệp Strict Open XML.
- Chưa thử trên máy thật: Windows (WebView2), Android, iPhone (Safari). WebKit đã được thử qua bản desktop Linux (WebKitGTK).

## Tự kiểm

1. Mở một tệp Word của anh (Chọn tệp → `.docx`). Xem tiêu đề, danh sách, bảng, ảnh có hiện đúng không.
2. Sửa một câu, làm đậm một chữ, thêm một mục vào danh sách số, sửa một ô bảng, xóa một đoạn.
3. Bấm **Lưu tệp Word**, mở tệp `… (ezPDF).docx` bằng Word (hoặc Google Docs, WPS): các sửa đổi có đúng không, phần còn lại có giữ nguyên không.
4. Đóng màn Word khi chưa lưu: app phải hỏi lại.
5. Điện thoại: mở một tệp Word từ Zalo hay Files bằng “Mở bằng ezPDF”, chạm vào một đoạn, gõ tiếng Việt, bấm **Lưu**.
