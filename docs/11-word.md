# 11 · Đọc và sửa nhẹ tệp Word (.docx) (bản 0.8.2)

Mở tệp Word ngay trên máy, sửa nhẹ rồi lưu ra một tệp Word mới. Tài liệu không rời thiết bị. Tính năng dùng chung một mã cho Windows, web (cả iPhone) và Android.

Nguyên tắc: **phần nào không sửa thì ghi lại y như cũ.** Đoạn văn, bảng hay ảnh mà người dùng không động tới được ghi lại đúng XML gốc. Đoạn đã sửa vẫn giữ kiểu đoạn, danh sách, khoảng cách, và phông, cỡ, màu của từng đoạn chữ. Chỉ chữ, đậm/nghiêng/gạch chân, phông và cỡ chữ là đổi theo người dùng. Mọi phần khác của tệp (kiểu chữ, đánh số, đầu trang, chân trang, ảnh, chú thích, cài đặt…) được chép lại từng byte.

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
| Phông chữ, cỡ chữ (bản 0.8.2) | Chọn chữ rồi chọn phông trong ô **Phông chữ** và cỡ trong ô **Cỡ chữ** (gõ số, ví dụ `13` hay `10,5`, rồi Enter; hoặc mở danh sách). Chưa chọn chữ thì phông, cỡ áp cho chữ gõ tiếp. Hai ô luôn hiện phông và cỡ ở chỗ con trỏ. Danh sách phông: các phông tài liệu dùng trước, rồi các phông thông dụng có đủ dấu tiếng Việt; phông máy này không có vẫn chọn được (ghi rõ “không có trên máy này”), Word trên máy có phông đó sẽ hiện đúng. |
| Phóng to, thu nhỏ (bản 0.8.2) | Máy tính: nút **− / % / +** trên thanh, Ctrl + lăn chuột (hoặc chụm hai ngón trên bàn di chuột), Ctrl + / Ctrl − / Ctrl 0. Điện thoại: chụm hoặc mở hai ngón trên trang, hoặc chạm vào số % để chọn mức. Từ 25 % đến 400 %, có mục **Vừa chiều rộng**. Trang được phóng to cả khối như Word, chữ không chạy lại dòng; vẫn bấm, chọn, gõ bình thường ở mọi mức. |
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
- Ảnh mọi định dạng tệp Word có thể chứa (bản 0.8.2, xem phần **Ảnh mọi định dạng** dưới). Ảnh nằm trên đường chân chữ như trong Word.
- Hình vẽ, công thức toán, biểu đồ, SmartArt, chú thích cuối trang: xem phần **Hình vẽ, công thức, biểu đồ** ngay dưới.
- Đầu trang và chân trang hiện mờ, chỉ để xem.
- Trường (số trang…) hiện giá trị đã lưu trong tệp; ngắt trang hiện nhãn “ngắt trang”.

## Hình vẽ, công thức, biểu đồ (bản 0.8.1)

Từ bản 0.8.1, những phần trước đây chỉ hiện nhãn “Hộp chữ”, “Hình vẽ”, “Hình (WMF)” giờ hiện ra đúng như hình. ezPDF **vẽ lại chúng từ chính dữ liệu trong tệp**, trên máy, không gửi đi đâu. Bản vẽ chỉ để xem: XML gốc của chúng được giữ nguyên và ghi lại y như cũ khi lưu.

| Nội dung trong tệp | ezPDF hiện thế nào |
|---|---|
| **Hình vẽ** (Insert → Shapes): hình chữ nhật, tròn, thoi, mũi tên, sao, đủ bộ hình lưu đồ (flowchart), hình tự vẽ | Vẽ thành SVG: đúng hình, màu (cả màu của theme và các biến thể sáng/tối), viền, nét đứt, đầu mũi tên, xoay, lật |
| **Hộp chữ** (Text Box), chữ trong hình | Chữ hiện trong hình, đúng vùng chữ của từng loại hình (giữa hình tròn, giữa hình thoi, trong thân mũi tên), đúng phông, cỡ, màu, căn lề |
| **Nhóm hình** (Group), **khung vẽ** (Drawing Canvas), đường nối có mũi tên | Cả nhóm thành một hình, các hình con đúng chỗ và đúng tỷ lệ |
| Hình kiểu cũ (VML, Word 2003 và bản dự phòng Word ghi kèm) | Vẽ được nhóm, chữ nhật, chữ nhật bo góc, hình tròn, đường thẳng, đường gấp khúc, hộp chữ, ảnh, WordArt đơn giản |
| **Công thức Word** (Insert → Equation) | Hiện thành công thức thật (MathML, trình duyệt tự dàn): phân số, chỉ số trên/dưới, căn, ∑ ∫ ∏ có cận, ngoặc co giãn, ma trận, hệ phương trình, hàm, giới hạn, dấu mũ, gạch trên… Công thức đứng riêng dòng được căn như trong tệp. **Chữ quanh công thức sửa được**: đoạn có công thức không còn bị khóa |
| **Công thức MathType, Equation 3.0** (đối tượng OLE) | Hiện ảnh xem trước mà MathType lưu trong tệp (WMF hoặc EMF), vẽ lại bằng bộ đọc metafile riêng của ezPDF: chữ nghiêng, đậm, đúng vị trí từng ký tự; ký tự phông Symbol (π, α, ∑, ≤…) được đổi sang Unicode nên điện thoại không có phông Symbol vẫn đọc đúng. Công thức được hạ xuống đúng đường chân chữ như Word |
| **Biểu đồ** (Insert → Chart) | Vẽ lại từ số liệu Word lưu kèm biểu đồ: cột, thanh (nhóm, chồng, 100 %), đường, vùng, tròn, vành khuyên, phân tán; tiêu đề, chú giải, trục, nhãn danh mục |
| **SmartArt** | Vẽ từ bản vẽ SmartArt mà Word lưu sẵn trong tệp |
| **Chú thích cuối trang, cuối tài liệu** (Footnote, Endnote) | Số chú thích trong bài như cũ; nội dung chú thích hiện sau phần thân bài, có vạch ngăn, đánh số khớp với số trong bài |

Hình nổi (floating) được đặt trên một dòng riêng, căn trái, giữa hay phải như trong tệp (hoặc lùi vào theo khoảng cách trong tệp), thay vì chồng lên chữ. Màn hình hẹp thì cả hình (kể cả chữ trong hình) thu nhỏ theo trang.

Công thức Word cần một phông toán. Máy có sẵn Cambria Math (Windows) hay STIX Two Math (iPhone, Mac) thì dùng phông đó. Máy không có (nhiều điện thoại Android) thì app dùng phông STIX Two Math đi kèm (giấy phép SIL OFL, khoảng 400 KB), chỉ tải khi trang có công thức.

## Ảnh mọi định dạng, phóng to, phông và cỡ chữ (bản 0.8.2)

Theo yêu cầu: ảnh TIFF trong tệp Word không hiện trên bản Windows; cả ba bản chưa phóng to được; cần chọn phông và cỡ chữ khi sửa.

**Ảnh.** Trình duyệt trong cả ba bản (WebView2 của Windows, WebView của Android, Chrome, Edge) không đọc TIFF; chỉ Safari đọc. Từ bản 0.8.2, ezPDF tự nhận ra mỗi ảnh là gì **theo nội dung**, không theo tên tệp (ảnh PNG đặt tên `.jpg`, TIFF đặt tên `.png` vẫn hiện đúng), rồi đổi sang dạng trình duyệt hiện được, ngay trên máy:

| Ảnh trong tệp | ezPDF hiện thế nào |
|---|---|
| PNG, JPEG, GIF, BMP, WebP, SVG, ICO | Hiện như cũ. SVG hiện qua địa chỉ `data:` để không bao giờ chạy được mã trong đó |
| **TIFF** (ảnh quét, ảnh từ máy ảnh, Photoshop): không nén, LZW, PackBits, Deflate, CCITT G3/G4 (bản quét đen trắng), JPEG; dải hoặc ô; đen trắng, xám, bảng màu, RGB, CMYK; nhiều trang | Giải mã thành PNG (trang đầu, như Word hiện), thu về tối đa 2400 điểm ảnh cạnh dài |
| EPS | Ảnh xem trước lưu trong tệp: TIFF hay WMF (EPS kiểu DOS, cái Word hiện) hoặc ảnh EPSI |
| WMF, EMF, cả bản nén `.wmz`, `.emz` | Vẽ lại thành SVG (bản 0.8.1) |
| PICT của Mac | Ảnh JPEG nằm trong tệp |
| AVIF, HEIC, JPEG XR | Hiện nếu trình duyệt của máy đọc được (app hỏi trình duyệt trước khi mở) |
| Định dạng khác, ảnh hỏng | Nhãn “Hình (TÊN ĐỊNH DẠNG)” đúng chỗ ảnh, không bao giờ là ảnh vỡ |

Ảnh luôn được ghi lại nguyên byte khi lưu: ezPDF chỉ đổi định dạng để hiện, không đổi ảnh trong tệp.

TIFF và EPS được giải mã trong một luồng riêng (Web Worker), nên ảnh lớn không làm đứng màn hình. Ảnh quét A4 300 dpi mất khoảng 0,4 giây. Một ảnh quá 12 giây thì luồng đó bị dừng, ảnh hiện nhãn, ảnh sau dùng luồng mới. Cả tài liệu có hạn 45 giây cho việc này.

Bộ giải mã TIFF là UTIF.js (MIT, của Photopea; cùng pako, MIT và Zlib; khoảng 100 KB, chỉ tải khi tệp có TIFF hay EPS). UTIF tin tệp hoàn toàn, nên trước khi đưa tệp cho nó, ezPDF kiểm và làm an toàn một bản sao: chuỗi trang không được vòng lại hay chạy ra ngoài tệp; UTIF không được đi vào thư mục con (EXIF, ghi chú hãng máy, DNG); mọi giá trị phải nằm trong tệp; cỡ ảnh, số dải, số ô, số bit phải khớp nhau và trong hạn (tối đa 36 triệu điểm ảnh, đủ cho bản quét A4 600 dpi); mỗi khúc JPEG không được lớn hơn dải của nó. LZW và Deflate do ezPDF tự giải, không bao giờ quá cỡ của dải (bộ LZW của UTIF chạy mãi khi dải bị cụt).

**Phóng to.** Trang được phóng to cả khối bằng CSS (`transform: scale`), như Word: dòng chữ giữ nguyên chỗ xuống dòng. Mức 100 % là chữ đúng cỡ thật. Ở 100 %, trang rộng bằng khổ giấy, hoặc bằng màn hình nếu màn hình hẹp hơn (lề co lại, chữ chạy lại dòng như trước). Phóng bằng chuột hay hai ngón thì điểm dưới con trỏ hay giữa hai ngón đứng yên. Bản Windows trước đây không phóng được vì WebView2 của app tắt phóng to của trình duyệt; giờ màn Word tự lo việc này trên cả ba bản.

**Phông và cỡ chữ.** Chọn phông thì đoạn chữ được ghi `w:rFonts` với cùng một phông cho mọi loại chữ (Latin, Đông Á, chữ phức tạp), bỏ phông theo theme của đoạn đó, nếu không Word sẽ vẫn dùng phông theme. Chọn cỡ thì ghi `w:sz` và `w:szCs` (nửa điểm: 10,5 pt là 21). Các phần tử được chèn đúng thứ tự Word yêu cầu; màu, đậm, gạch chân và mọi thuộc tính khác của đoạn chữ giữ nguyên. Tên phông chỉ nhận chữ, số và vài dấu (`. _ - + & ( )`): tên khác bị từ chối, không ghi gì. Sao chép, dán trong tài liệu giữ phông và cỡ.

## Những phần chỉ xem

Một số nội dung ezPDF hiện ra nhưng không cho sửa, vì sửa sẽ dễ làm hỏng tệp. Chúng có nền xám nhạt, chữ **Chỉ xem**, và được ghi lại y nguyên khi lưu. Thanh vàng đầu màn nói có bao nhiêu đoạn như vậy và vì sao.

- Đoạn có **theo dõi thay đổi** (Track Changes): chữ chèn thêm hiện gạch dưới màu xanh, chữ bị xóa hiện gạch ngang màu đỏ.
- **Ô điều khiển nội dung** (Content Control), ví dụ mục lục tự động.
- Liên kết có cấu trúc phức tạp, trường dữ liệu đặc biệt, chữ viết từ phải sang trái.

Từ bản 0.8.1, đoạn có **công thức toán** và đoạn có **thẻ thông minh** (smart tag của Word 2003–2007, ví dụ quanh ngày tháng, địa danh) không còn bị khóa. Đoạn có thẻ thông minh mà người dùng sửa thì được ghi lại không còn thẻ đó, như Word 2010 trở đi vẫn làm; đoạn không sửa giữ nguyên.

Bấm vào một đoạn chỉ xem thì cả đoạn được chọn. Gõ hay dán không đè lên nó. Muốn bỏ hẳn đoạn đó thì bấm **Xóa đoạn** (hoặc Backspace/Delete).

## Cách làm

Mã nằm trong `src/word/` (đọc, ghi, lệnh sửa) và `src/app/word/WordScreen.tsx` (màn hình).

- **Đọc** (`package.ts`, `read.ts`): giải nén tệp bằng fflate (MIT). Tìm phần nội dung chính qua quan hệ của gói, đọc `document.xml`, kiểu chữ (`styles.xml`), đánh số (`numbering.xml`), theme (phông và bảng màu), ảnh, đầu trang, chân trang, chú thích. Nội dung thành một tài liệu ProseMirror (MIT). Mỗi đoạn, bảng, ảnh, hình, công thức nhớ chỉ số của phần XML gốc của nó.
- **Vẽ** (bản 0.8.1, mã viết riêng cho ezPDF, không thêm thư viện):
  - `drawing.ts`: hình DrawingML (hình đơn, nhóm, khung vẽ, khung vẽ khóa, SmartArt) và VML → SVG. Toạ độ theo px (EMU / 9525), chữ trong hình dàn bằng chính bộ dựng đoạn của trang (`foreignObject`).
  - `chart.ts`: biểu đồ → SVG từ số liệu lưu sẵn.
  - `omml.ts`: Office Math → MathML.
  - `metafile.ts`: WMF, EMF (cả `.wmz`, `.emz`) → SVG; phát lại các lệnh GDI mà Office và MathType dùng. Kết quả được hiện như một ảnh (`<img>`), nên không chạy được gì trong trang.
  - Mọi giá trị lấy từ tệp đi vào bản vẽ đều được kiểm: số phải là số, màu do ezPDF tính ra, tên phông chỉ gồm chữ và số, chữ luôn được mã hoá (escape). Tệp hỏng hay cố tình độc hại thì phần đó hiện nhãn, không làm hỏng trang. Ảnh liên kết ra ngoài không bao giờ được tải.
- **Ảnh** (bản 0.8.2):
  - `images.ts`: nhận định dạng theo các byte đầu (PNG, JPEG, GIF, BMP, WebP, AVIF, HEIC, TIFF, SVG, ICO, WMF, EMF, gzip, EPS, PICT, JPEG XR); tách ảnh xem trước của EPS, ảnh JPEG trong PICT; thu nhỏ ảnh; mã hoá PNG (fflate).
  - `tiff.ts`: UTIF.js 3.1.0 (ghim đúng bản, vì có sửa một chỗ trong bộ JPEG của nó: JPEG trong TIFF lưu kiểu RGB bị UTIF đổi màu hai lần) cùng các bước làm an toàn ở trên.
  - `raster.ts`, `raster.worker.ts`, `app/word/raster-client.ts`: TIFF, EPS → PNG trong Web Worker, có hạn giờ. Trên Node (bộ kiểm) thì giải mã thẳng.
  - `read.ts`: TIFF, EPS được giải mã hết trước khi đọc nội dung; mỗi ảnh chỉ đổi một lần dù được dùng nhiều chỗ; hạn mức giải nén `.wmz/.emz` tính cả lần bị từ chối.
- **Phóng to** (`WordScreen.tsx`): trang nằm trong một khung có cỡ bằng trang đã phóng, trang bên trong được `scale`. Ctrl + lăn chuột, chụm hai ngón (sự kiện chạm, chặn phóng to của trình duyệt bằng `touch-action: pan-x pan-y`), phím tắt. ProseMirror tính đúng vị trí con trỏ khi trang bị phóng.
- **Sửa** (`commands.ts`): Enter, Shift+Enter, B/I/U, phông và cỡ chữ (`setFont`, `setSize`, hai dấu định dạng `font`, `size` mới trong `schema.ts`), Xóa đoạn. Có hai lớp chặn:
  - không thay đổi nào được thêm, tách hay đổi hình dạng một bảng;
  - gõ hay dán không đè lên đoạn chỉ xem.
- **Ghi** (`write.ts`):
  - Đoạn hay bảng giống hệt lúc đọc được ghi bằng chính XML gốc.
  - Đoạn đã sửa được dựng lại từ `w:pPr` gốc và `w:rPr` gốc của từng đoạn chữ; chỉ bật, tắt đậm, nghiêng, gạch chân, thay phông (`w:rFonts`) và cỡ (`w:sz`, `w:szCs`) khi người dùng đổi, theo đúng thứ tự phần tử Word yêu cầu.
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

Bản 0.8.1 thêm `word-draw.docx` (`scripts/make_word_drawings.py`, viết XML đúng như Word ghi), gom những gì được vẽ: lưu đồ là một nhóm hình có chữ và mũi tên nối, đặt nổi giữa trang, kèm bản VML dự phòng; một hình có chữ nằm giữa câu; khung vẽ có hình tròn, đường mũi tên và ảnh; nhóm hình VML có hộp chữ; công thức Word trong câu (phân số) và công thức riêng dòng (∑ có cận, căn, ma trận); công thức MathType (OLE, ảnh WMF có chữ nghiêng, ký tự phông Symbol, vạch phân số); ảnh EMF; biểu đồ cột hai chuỗi; SmartArt; một chú thích cuối trang và một chú thích cuối tài liệu. LibreOffice mở tệp này và vẽ đủ các phần.

Bản 0.8.2 thêm `word-images.docx` (`scripts/make_word_images.py`, ảnh do Pillow tạo, kèm ảnh gốc để so từng điểm ảnh trong `tests/fixtures/word-images/`): 26 ảnh gồm 10 loại TIFF (không nén, LZW, PackBits, CCITT G4, JPEG kiểu RGB, JPEG kiểu YCbCr, Deflate, bảng màu, CMYK, hai trang), EPS có ảnh xem trước TIFF, EPS có ảnh EPSI, PICT, PNG trong suốt, JPEG, GIF, BMP, WebP, ICO, SVG, AVIF, PNG đặt tên `.jpg`, TIFF đặt tên `.png`, WMZ, và hai tệp HEIC, JPEG XR không trình duyệt nào ở đây đọc được.

Mọi tệp ezPDF lưu đều được **đọc lại bằng chương trình khác**: python-docx (`scripts/verify_word.py`) và LibreOffice (mở rồi xuất ra chữ).

**Thử trên tệp Word thật** (bản 0.8.1). Ngoài các tệp mẫu, bộ đọc được chạy trên 1.666 tệp `.docx` thật mà hai dự án lớn dùng để kiểm thử: 130 tệp của Apache POI và 1.536 tệp của LibreOffice (thư mục kiểm thử nhập/xuất OOXML), do Word, LibreOffice và nhiều chương trình khác tạo, kể cả tệp hỏng cố ý.
- 1.634 tệp mở được. 32 tệp còn lại bị từ chối kèm lý do rõ ràng: có mật khẩu, chuẩn Strict, tệp mẫu, gói zip hoặc XML hỏng.
- Vẽ được 685 hình (nhóm, khung vẽ, hộp chữ, VML, biểu đồ, SmartArt) và 146 công thức.
- Trên 130 tệp của POI, bản 0.8.0 hiện 47 nhãn thay cho hình ở 14 tệp; bản 0.8.1 không còn nhãn nào. Trên cả 1.666 tệp chỉ còn nhãn ở 10 tệp, đều chính đáng: ảnh TIFF, ảnh liên kết ra ngoài, ảnh không có trong tệp, SmartArt không có bản vẽ lưu sẵn.
- Lưu khi không sửa: `document.xml` của mọi tệp mở được đều khớp bản gốc (chỉ khác khoảng trắng giữa các phần tử và chú thích XML, Word bỏ qua những thứ này).
- Tệp lớn nhất (15 MB XML, khoảng 16.000 đoạn) mở trong khoảng 8,5 giây trên Chromium; gần hết thời gian là bộ đọc XML của trình duyệt.
- Bản 0.8.2 chạy lại cả bộ: vẫn 1.634 tệp mở được, 32 tệp từ chối như cũ, lưu không sửa vẫn khớp bản gốc. Năm ảnh TIFF thật (ảnh chụp, biểu tượng) trong 4 tệp của LibreOffice trước hiện nhãn, giờ hiện ra; số ảnh hiện được tăng từ 281 lên 286. Nhãn còn lại chỉ là ảnh liên kết ra ngoài, ảnh không có trong tệp và SmartArt không có bản vẽ lưu sẵn.
- Lượt này tìm ra và sửa: hộp chữ không có lề trong mặc định, chữ trong hình tròn, hình thoi, mũi tên phải nằm trong vùng chữ riêng của hình, khung vẽ khóa (locked canvas), lệnh `PatBlt` của WMF, biểu đồ bề mặt, `w:pict` rỗng hiện nhãn thừa. Đoạn có thẻ thông minh (20 đoạn trong bộ POI) giờ sửa được.

| Bộ kiểm | Kết quả |
|---|---|
| `npm run test:word` (đọc/ghi trên Node, `tests/word-probe.ts`) | **97/97** (bản 0.8.1: 81). Chi tiết ngay dưới bảng. |
| `npm run e2e:word` (Chromium, cả luồng trong app) | **44/44** trên dev server và **44/44** trên bản build production (bản 0.8.1: 36). Chi tiết ngay dưới bảng. |
| `scripts/smoke-desktop.cjs` (bản desktop thật, WebKitGTK, cùng nhân với Safari) | **29/29** (bản 0.8.1: 26). Bước mới của 0.8.2: `word-images.docx` mở như “Mở bằng”, đủ 10 loại TIFF, EPS, PICT, WMZ hiện ra; nút + (110 %), Ctrl + bằng phím thật (125 %), Ctrl 0 (100 %), trang phóng đúng tỷ lệ; chọn Arial bằng chuột thật và gõ cỡ 20 cho một đoạn chữ, thanh công cụ hiện đúng. Bản 0.8.1: Bước Word: tệp `.docx` đưa vào app như “Mở bằng”, gõ bằng phím thật, làm đậm, lưu qua hộp thoại lưu của hệ thống; python-docx đọc đúng; tệp gốc không đổi. Bước mới của 0.8.1: `word-draw.docx` mở cùng cách, 6 hình, chữ trong lưu đồ, 2 công thức MathML có kích thước, ảnh WMF và EMF, chú thích đều được WebKitGTK dàn đúng. Lần chạy đầu dừng ở bước sau đó vì WebDriver không mở được phiên mới kịp; hai lần chạy lại đều đạt 26/26. |

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
- Bản 0.8.1, trên `word-draw.docx`:
  - nhận ra đủ 12 thứ được vẽ, không đoạn nào bị khóa;
  - lưu đồ: nổi, căn giữa, 4 hình đúng chữ, 3 đầu mũi tên, màu theme; hình trong câu; khung vẽ có ảnh; nhóm VML; phân số; công thức riêng dòng có ∑, √, ma trận;
  - MathType WMF: chữ x nghiêng trên π (đổi từ phông Symbol), vạch phân số, “= 1” đúng vị trí từng ký tự; EMF có chữ tiếng Việt đậm; biểu đồ; SmartArt; chú thích 1 và i;
  - lưu không sửa: `document.xml` giữ nguyên; sửa chữ quanh công thức, tách đoạn rồi lưu: mọi công thức, nhóm hình, khung vẽ, VML, OLE, biểu đồ, SmartArt, dấu chú thích ghi lại y nguyên, đọc lại được;
  - tệp cố tình độc hại (chữ chứa thẻ `<script>`, `<img onerror>`, màu và tên hình chứa mã, tên phông trong WMF chứa thẻ): không có thẻ, mã, trình xử lý sự kiện hay địa chỉ ngoài nào lọt ra; chữ hiện đúng là chữ;
  - mọi hình bị cắt ở lề nhỏ quanh khung;
  - 8 bước kiểm cho các ca của lượt rà soát 0.8.1 (dưới).
- Bản 0.8.2:
  - `word-images.docx`: đủ 26 ảnh; không có trình duyệt để hỏi thì 23 ảnh hiện, AVIF, HEIC, JPEG XR thành nhãn; có trình duyệt đọc AVIF thì AVIF hiện, chỉ ba định dạng đó được hỏi; TIFF, EPS, PICT thành PNG hay JPEG; WMZ thành SVG;
  - so từng điểm ảnh với ảnh gốc (Pillow): ảnh không mất dữ liệu khớp tuyệt đối (CMYK lệch dưới 0,01/255 do làm tròn khi đổi màu), ảnh có JPEG lệch dưới 3/255;
  - 11 kiểu TIFF mà Pillow không ghi được, do tifffile tạo (`tests/fixtures/tiff/`, `scripts/make_tiff_cases.py`): ô (tile) có bộ dự đoán (predictor) với LZW và Deflate, ô không nén, 16 bit thứ tự byte lớn, bảng màu 1 bit và 4 bit, xám 4 bit, kênh trong suốt, CMYK 16 bit: giải mã khớp tuyệt đối từng điểm ảnh; TIFF xếp mẫu theo từng mặt phẳng bị từ chối (hiện nhãn); TIFF 2400×2400 xếp ô có bộ dự đoán giải mã trong khoảng 0,25 giây;
  - TIFF độc hại: 40 tỷ điểm ảnh, tệp cụt, rác, một tỷ dải, một dải khai 4 GB đều bị từ chối trong vài phần nghìn giây; chuỗi trang vòng, thẻ chữ khai 2 GB, EXIF trỏ về chính nó, LZW không có mã kết thúc đều xong ngay, không treo; tài liệu có ảnh như vậy vẫn mở, ảnh đó hiện nhãn “Hình (TIFF)”;
  - phông và cỡ: `w:rFonts` cùng một phông cho bốn loại chữ, bỏ phông theme và `w:hint`, `w:sz` và `w:szCs` đúng nửa điểm (10,5 pt → 21), màu giữ nguyên, đúng thứ tự; tên phông độc hại bị từ chối; danh sách phông của tài liệu không có phông ký hiệu hay phông Đông Á; python-docx đọc lại đúng phông và cỡ.

`e2e:word` kiểm:
- Hiển thị: số danh sách, bảng, ảnh, đầu trang, chân trang, đoạn chỉ xem.
- Bấm và gõ; B/I/U từ nút và phím tắt; Xóa đoạn; Enter trong danh sách; ô bảng; Shift+Enter.
- Gõ tiếng Việt qua bộ gõ (composition); hoàn tác, làm lại từng bước.
- Đoạn chỉ xem không bị gõ đè.
- Sao chép, dán trong tài liệu (ngắt trang, ảnh); dán từ trang web.
- Lưu ra `word-a (ezPDF).docx`: python-docx kiểm 12 điểm, ảnh dán có số hiệu riêng, LibreOffice mở được.
- Đóng khi chưa lưu thì app hỏi; mở Word chồng lên PDF rồi quay lại; mở PDF từ màn Word; tệp `.doc` cũ được giải thích.
- Điện thoại 390 px: hai thanh vừa màn hình (hàng hai có phông, cỡ, B, I, U), bảng vừa trang, chạm rồi gõ, làm đậm; hai ngón mở ra gấp ba khoảng cách thì trang phóng lên 300 %.
- Bản 0.8.2: chọn Arial cho một đoạn từ danh sách, gõ cỡ 18 cho đoạn khác, chọn cỡ 24 khi chưa chọn chữ rồi gõ tiếp; thanh hiện đúng phông, cỡ ở con trỏ; sao chép, dán giữ phông; python-docx đọc ra Arial cho cả bốn loại chữ, 18 pt, 24 pt. `word-images.docx`: 24/26 ảnh hiện (cả AVIF), màu đúng ở bốn ô màu của từng ảnh, HEIC và JPEG XR thành nhãn có tên; TIFF được giải mã trong Web Worker, ảnh quá hạn giờ làm dừng worker và ảnh sau có worker mới. Phóng to: 100 % lúc đầu, + ra 110 %, menu 150 %, trang lớn đúng tỷ lệ; ở 150 % bấm vào một chữ thì con trỏ đến đúng chữ đó; Ctrl + lăn chuột lùi một nấc (182 %), điểm dưới con trỏ đứng yên; Ctrl 0, Ctrl +, Ctrl −.
- Bản 0.8.1, `word-draw.docx`: 6 hình SVG có kích thước thật, lưu đồ căn giữa, chữ trong hình được dàn; 2 công thức MathML; ảnh WMF và EMF giải mã được; chú thích hiện sau bài; không đoạn nào bị khóa. Gõ cạnh công thức, sao chép rồi dán một công thức (ra công thức, không ra chữ), lưu: tệp có đủ 3 công thức, nhóm hình, khung vẽ, VML, OLE, biểu đồ, SmartArt, dấu chú thích. Clipboard giả mạo mang mã của tài liệu không đưa được ảnh từ ngoài hay mã hình vào. Điện thoại: mọi hình, ảnh, công thức vừa trang.
- Không gửi gì ra ngoài.

Cả bản 0.8.2 đều đạt (`e2e:m4` bản production có kiểm Content-Security-Policy: phông toán, hình vẽ, ảnh và worker giải mã ảnh không vi phạm):

| Bộ | Dev | Production |
|---|---|---|
| `e2e` | 57/57 | 57/57 |
| `e2e:m3` | 50/50 | 49/49 |
| `e2e:m4` | 14/14 | 22/22 |
| `e2e:edit` | 24/24 | 24/24 |
| `e2e:scan` | 26/26 | 16/16 |
| `e2e:share` | 36/36 | 36/36 |
| `e2e:pages` | 28/28 | 28/28 |
| `e2e:word` | 44/44 | 44/44 |

Cùng đạt:
- `typecheck`, `test:layout`, `test:engine`, `verify`, `test:m3`, `test:storage`, `test:edit`, `test:pages`, `test:word`;
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

### Rà soát bản 0.8.1

Một lượt rà soát riêng đọc toàn bộ mã vẽ mới (`drawing.ts`, `chart.ts`, `metafile.ts`, `omml.ts` và phần nối vào `read.ts`, `schema.ts`), không xem cách làm. Trọng tâm: dữ liệu trong tệp giờ đi vào trang dưới dạng SVG và MathML, nên phải chắc rằng một tệp cố tình độc hại không chạy được gì, không tải được gì từ ngoài, không treo được app.

Kết luận về bảo mật: **không có đường nào để tệp chèn thẻ, mã script, trình xử lý sự kiện hay địa chỉ bên ngoài.** Mọi giá trị từ tệp đi vào thuộc tính MathML, SVG, CSS đều là số, màu do ezPDF tính ra, hoặc chữ đã mã hoá.

Lượt rà soát nêu 11 điểm về độ bền và độ đúng. Mỗi điểm nặng được tái hiện bằng một tệp dựng sẵn, sửa, rồi giữ lại thành bước kiểm trong `test:word` (bước kiểm được thử lại trên mã chưa sửa để chắc nó bắt được lỗi):

1. **Căn lồng trong chỉ số căn làm việc tăng gấp đôi ở mỗi tầng.** 22 tầng mất 14 giây. Giờ mỗi phần được chuyển một lần: 40 tầng mất khoảng 0,1 giây.
2. **SmartArt có thể tự vẽ lại chính nó** qua một hộp chữ trỏ ngược về nó. Giờ SmartArt không chứa được SmartArt khác, bản vẽ SmartArt chỉ đọc một lần, và cả tài liệu có một hạn mức vẽ; quá mức thì phần còn lại hiện nhãn.
3. **Bản ghi WMF/EMF khai số điểm lớn hơn chính nó** (một bản ghi 28 byte khai một triệu điểm): app treo hơn 100 giây. Giờ không đọc gì vượt khỏi bản ghi, và đường vẽ trong `BeginPath … EndPath` cũng tính vào giới hạn 8 MB. Tệp đó giờ xong trong vài phần trăm giây.
4. **Biểu đồ chồng nhiều chuỗi, nhiều điểm trống** sinh ra hàng triệu ký tự SVG. Giờ có giới hạn số chuỗi, số điểm, cỡ SVG; điểm trống không vẽ.
5. **Hình có thể vẽ tràn xa khỏi khung của nó.** Giờ mỗi hình được cắt ở một lề nhỏ quanh khung: đủ cho nét viền, đầu mũi tên, chữ tràn như Word, không đủ để phủ lên phần khác của trang.
6. **Công thức lồng sâu bất thường** làm cả tài liệu không mở được. Giờ công thức đó hiện nhãn “Công thức”, tài liệu vẫn mở.
7. **Số chú thích cuối trang** bị trùng khi chú thích nằm trong hộp chữ, hoặc nhảy số khi một đoạn hoá thành chỉ xem giữa chừng. Giờ số được đếm chung cho cả tài liệu và trả lại khi đoạn hoá chỉ xem.
8. Chuỗi chữ rất dài trong WMF/EMF làm cả hình hỏng trên Safari (giới hạn số đối số của JavaScriptCore). Giờ chuỗi được dựng từng khúc.
9. Giới hạn giải nén `.wmz/.emz` giờ tính cho cả tài liệu, không chỉ từng hình.
10. **Nhóm hình bị lật** làm chữ trong các hộp chữ của nhóm lật ngược. Giờ hình lật, chữ thì không, như Word. Cả nhóm lật ở cấp ngoài cùng (trước đây bị bỏ qua) cũng được lật đúng.
11. Một trang web biết mã ngẫu nhiên của tài liệu đang mở có thể đặt vào clipboard một ảnh trỏ ra ngoài; dán vào thì app tải ảnh đó (có từ bản 0.8.0). Giờ ảnh dán chỉ nhận địa chỉ ảnh do chính ezPDF tạo, còn hình và công thức luôn lấy từ bản trong tài liệu, không bao giờ từ clipboard. `e2e:word` có bước kiểm riêng.

### Rà soát bản 0.8.2

Một lượt rà soát riêng đọc mã ảnh, phông chữ và phóng to mới, không xem cách làm, chạy thử bằng tệp dựng sẵn; sau khi sửa, lượt thứ hai kiểm lại chỗ sửa và tự chạy giải mã trên tệp do libtiff và tifffile tạo. Kết luận về phông chữ: **không có đường chèn CSS hay XML**: tên phông được lọc, nằm trong chuỗi CSS có ngoặc, thuộc tính XML do bộ ghi mã hoá, dữ liệu dán phải mang mã ngẫu nhiên của tài liệu. Bộ ghi đúng thứ tự, đúng nửa điểm.

Những điểm nêu ra và cách sửa (mỗi điểm nặng có bước kiểm trong `test:word`):

1. **TIFF độc hại có thể làm treo hay tràn bộ nhớ** qua những đường UTIF đi mà lớp kiểm ban đầu không thấy: thư mục con (EXIF, ghi chú hãng máy, DNG), số lượng giá trị khai quá lớn, Deflate không giới hạn, khúc JPEG lớn hơn ảnh, ô quá lớn, số bit bất thường. Giờ có lớp làm an toàn (phần **Ảnh** ở trên), LZW và Deflate do ezPDF tự giải trong giới hạn của dải, và việc giải mã chạy trong Web Worker có hạn giờ.
2. Ảnh 64 triệu điểm ảnh giải trên luồng giao diện thì đứng màn hình vài giây: giờ giải trong worker, hạn 36 triệu điểm ảnh.
3. Hạn mức giải nén `.wmz/.emz` chỉ tính khi thành công, và một ảnh dùng nhiều chỗ bị giải mã lại mỗi chỗ: giờ tính cả lần thất bại, mỗi ảnh chỉ đổi một lần.
4. Ảnh EPSI giải chậm từng điểm ảnh: giờ đọc mã hex bằng bảng tra, hạn 4 triệu điểm ảnh.
5. Ảnh SVG thành địa chỉ `blob:` cùng nguồn với app: mở “ảnh trong thẻ mới” thì trình duyệt coi nó là một trang của app. Giờ SVG dùng địa chỉ `data:`.
6. Phóng to bằng lăn chuột nhanh có thể làm điểm dưới con trỏ trôi (tính theo mức chưa vẽ xong): giờ tính theo mức đang hiện. Ctrl + lăn chuột trên thanh công cụ trước đây phóng cả app (trình duyệt): giờ phóng trang.
7. Nhận nhầm ảnh TGA là ICO; bỏ sót SVG bắt đầu bằng `<!DOCTYPE` hay có chú thích dài; TIFF thiếu thẻ màu; tên phông phải lọc bớt ký tự vẫn được đưa vào danh sách; chữ chỉ số trên/dưới có cỡ đã chọn hiện to hơn Word. Đã sửa cả.
8. Lượt kiểm lại: **TIFF xếp ô có bộ dự đoán giải sai và rất chậm** (UTIF áp bộ dự đoán theo chiều rộng cả ảnh, không theo ô: ảnh 4800×4800 mất 55 giây). Giờ thứ tự byte và bộ dự đoán do ezPDF làm theo đúng cỡ dải hay ô.
9. Lượt kiểm lại: dòng ảnh quét CCITT hỏng có thể dài mãi trong bộ nhớ: giờ dòng dài hơn trang bị từ chối. Đóng màn Word lúc đang mở tệp thì worker vẫn chạy tiếp: giờ dừng ngay. Ảnh không được phần nào dùng tới không còn được giải mã. JPEG khai chiều cao qua dấu DNL không được giải lần hai. Bố cục màu UTIF đổi sai (bảng màu dưới 8 bit, xám 4 bit, CMYK 16 bit, mẫu theo mặt phẳng) giờ do ezPDF đổi, hoặc hiện nhãn.

Còn lại một điểm nhỏ, ghi ở phần Giới hạn: trên điện thoại, nếu một ngón đã kéo trang trước khi ngón thứ hai chạm thì trang có thể vừa phóng vừa trượt một chút.

## Giới hạn

- Sửa nhẹ: đổi được phông và cỡ chữ (bản 0.8.2); chưa đổi màu, căn lề, kiểu đoạn; chưa thêm hay bớt hàng, cột bảng; chưa chèn ảnh; chưa thêm chú thích (comment) hay theo dõi thay đổi.
- Phông chữ: phông máy đang dùng không có thì ezPDF hiện bằng phông thay thế; tệp vẫn ghi đúng tên phông đã chọn. Chưa đổi được phông, cỡ của chữ trong hộp chữ, hình vẽ.
- Phóng to là phóng cả trang, không chạy lại dòng: trên điện thoại, phóng lớn thì phải kéo ngang để đọc hết dòng. Mức phóng không được nhớ khi mở tệp khác. Trên điện thoại, nếu một ngón đã bắt đầu kéo trang trước khi ngón thứ hai chạm, trang có thể vừa phóng vừa trượt một chút.
- Không chia trang: tài liệu hiện như một trang dài (ngắt trang hiện nhãn). Đầu trang, chân trang chỉ hiện bản mặc định của section cuối.
- Hiển thị gần giống Word, không giống từng điểm ảnh: không có điểm dừng tab, định dạng có điều kiện của kiểu bảng (hàng tiêu đề đậm…) chưa áp dụng.
- Hình vẽ, công thức, biểu đồ (bản 0.8.1):
  - **Chỉ xem, chưa sửa được trong ezPDF**: chữ trong hộp chữ và trong hình, bản thân công thức, biểu đồ. Chữ quanh chúng sửa được; có thể xóa, sao chép, dán cả hình hay công thức như một khối. Khi lưu, chúng được ghi lại y nguyên.
  - Hình nổi được đặt trên dòng riêng (căn như trong tệp), không nằm đè hay để chữ chạy quanh như Word. Hình đặt sau chữ làm nền cũng hiện thành một khối riêng.
  - Bóng đổ, phát sáng, 3D, phản chiếu của hình chưa vẽ; tô chuyển màu (gradient) vẽ bằng màu đầu tiên.
  - Biểu đồ vẽ từ số liệu lưu sẵn, dạng phẳng: chưa có nhãn số liệu, biểu đồ 3D vẽ thành 2D, biểu đồ bề mặt vẽ thành các đường. Biểu đồ kiểu mới của Word 2016 (thác nước, sunburst…) hiện bản dự phòng Word lưu kèm.
  - SmartArt chỉ hiện được khi tệp có bản vẽ lưu sẵn (Word luôn lưu; vài chương trình khác thì không).
  - Ảnh xem trước WMF/EMF: chưa áp vùng cắt (clipping); ảnh EMF chỉ có lệnh EMF+ (không có bản GDI kèm theo) hiện nhãn. MathType vẽ bằng phông MT Extra cho vài ký hiệu hiếm; máy không có phông này (ngoài Windows có Office) có thể hiện sai các ký hiệu đó.
  - Ảnh liên kết ra ngoài không bao giờ được tải, nên hiện nhãn “Hình (liên kết ngoài)”.
- Ảnh (bản 0.8.2):
  - HEIC và JPEG XR chỉ hiện trên trình duyệt đọc được chúng (HEIC: Safari; JPEG XR: hầu như không còn trình duyệt nào). Nơi khác hiện nhãn có tên định dạng.
  - TIFF hơn 36 triệu điểm ảnh, TIFF nén kiểu ít gặp (JBIG, JPEG 2000, kiểu riêng của máy ảnh), JPEG kiểu cũ (nén 6) không chứa trọn một tệp JPEG, TIFF 32 bit số thực, YCbCr không nén, mẫu xếp theo từng mặt phẳng hiện nhãn “Hình (TIFF)”.
  - Tệp có nhiều ảnh TIFF, EPS: tài liệu hiện ra sau khi các ảnh này giải mã xong (thường dưới một giây mỗi ảnh; tối đa 45 giây cho cả tài liệu, quá thì ảnh còn lại hiện nhãn).
  - EPS không có ảnh xem trước hiện nhãn (ezPDF không chạy PostScript). PICT chỉ hiện khi có ảnh JPEG bên trong.
  - Ảnh TIFF, EPS hiện ở tối đa 2400 điểm ảnh cạnh dài; ảnh trong tệp lưu ra vẫn nguyên bản.
- Nội dung trong ô điều khiển nội dung và theo dõi thay đổi: chỉ xem.
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
6. Bản 0.8.2: mở tệp Word có ảnh TIFF (ảnh quét, ảnh dán từ máy quét) trên Windows, Android và web: ảnh phải hiện.
7. Phóng to: trên Windows, Ctrl + lăn chuột và nút − / + ; trên điện thoại, chụm và mở hai ngón. Phóng lớn rồi bấm vào một chữ và gõ: chữ phải vào đúng chỗ.
8. Chọn một câu, đổi phông (ví dụ Arial) và cỡ (ví dụ 16), lưu, mở bằng Word: câu đó phải đúng phông, đúng cỡ.
