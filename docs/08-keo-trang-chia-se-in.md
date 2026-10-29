# 08 · Kéo trang bằng chuột, chia sẻ, in (bản 0.6.0)

Đợt này làm ba việc sau lần thử bản 0.5.1 trên Windows và Galaxy S24 Ultra:

1. Trên Windows, **mặc định là kéo trang bằng chuột** (công cụ bàn tay), như các trình đọc PDF quen thuộc. Trước đây chỉ cuộn được bằng con lăn. Điện thoại giữ nguyên.
2. **Chia sẻ tệp** cho người khác: Zalo, Telegram, thư điện tử…
3. **In** ra máy in.

## Tóm tắt nghiệm thu

| Việc | Trạng thái |
|---|---|
| Kéo trang bằng chuột | **Đạt.** Kéo trang thì trang cuộn đúng bằng quãng kéo, theo cả hai chiều. Ô chữ, ảnh, ghi chú vẫn bấm chọn và kéo di chuyển được mà không phải đổi công cụ. Giữ phím Space thì kéo được trang ở mọi công cụ. |
| Chia sẻ | **Đạt trong trình duyệt** (thử tự động). Tệp gửi đi trùng từng byte với tệp “Xuất PDF”. **Windows và Android:** mã đã biên dịch cho đúng hệ, phần dùng chung đã chạy thật trên bản desktop Linux. **Cửa sổ chia sẻ của Windows, bộ nhớ tạm của Windows và bảng chia sẻ Android chưa thử trên máy thật**: xem danh sách tự kiểm ở cuối. |
| In | **Đạt trong trình duyệt** (thử tự động): mỗi trang PDF thành một trang in đúng khổ, đúng chiều, ở 300 dpi, giống tệp xuất khi so bằng một engine khác (MuPDF). **Android** in qua dịch vụ in của máy, chưa thử trên máy thật. |

## 1. Kéo trang bằng chuột

**Cách dùng.**
- Nút **bàn tay** (phím **P**) là công cụ mặc định trên máy có chuột. Kéo trang hay lề xám để cuộn.
- Muốn chọn chữ để chép thì bấm nút **mũi tên** (phím **V**, nay tên là “Chọn chữ và đối tượng”).
- **Giữ Space** thì kéo trang được ở bất cứ công cụ nào, kể cả khi đang tô sáng hay thêm chữ. Nhả Space là về lại công cụ cũ. Chỉ gõ Space (không kéo) thì vẫn lật xuống một màn hình, Shift Space lật lên.
- **Esc** từ một công cụ vẽ (thêm chữ, tô sáng) đưa về công cụ đang dùng làm mặc định, bàn tay hoặc mũi tên.
- Với bàn tay, ô chữ, ảnh, chữ ký, ghi chú vẫn **bấm để chọn, kéo để di chuyển, kéo góc để đổi cỡ**. Kéo trang không làm mất đối tượng đang chọn. Bấm vào chỗ trống (không kéo) thì bỏ chọn, và kết thúc ô chữ đang gõ.

**Trên điện thoại** không có nút bàn tay: một ngón đã cuộn trang ở chế độ Chọn như trước, chạm vẫn để chọn.

**Cách làm** (`src/app/viewer/hand.ts`). EmbedPDF phân thao tác chuột theo “chế độ”. Chế độ Chọn có sẵn bật chọn chữ và khung chọn. ezPDF thêm một chế độ riêng cho bàn tay, trong đó chọn chữ và khung chọn không được bật. Một bộ nghe sự kiện ở gốc trình xem bắt cú bấm chuột trái hoặc bút trước các bộ nghe của trang, rồi cuộn khung xem đúng bằng quãng kéo. Các chú thích, lớp đặt ảnh và lớp sửa chữ có dấu `data-no-interaction` (cùng quy ước EmbedPDF dùng) nên bộ nghe bỏ qua chúng, và chúng giữ cách bấm, kéo của riêng mình. Nếu nút chuột được nhả ở nơi khác (chuyển cửa sổ giữa chừng), cú kéo dừng ở lần di chuột kế tiếp. Ngón tay không đi qua đường này: trang vẫn cuộn bằng cuộn gốc của trình duyệt.

Space không đổi nghĩa khi đang gõ chữ, khi đang mở menu hay hộp thoại, hoặc khi đang đứng ở một nút bằng bàn phím (Tab). Ở những chỗ đó, Space vẫn bấm nút như thường. Nút chỉ được bấm bằng chuột thì không giữ Space. Nếu trong lúc giữ Space người dùng chọn công cụ khác hay bấm Esc, lựa chọn đó được giữ khi nhả Space.

## 2. Chia sẻ

Nút **Chia sẻ** nằm cạnh nút In, ngay trước **Xuất PDF**. Tệp gửi đi **chính là tệp Xuất PDF** sẽ ghi, cùng một hàm dựng: ô chữ, tô sáng, ảnh, chữ ký, góc xoay trang và chữ đã sửa đều có trong đó. Tên tệp là tên tài liệu, ví dụ `Hợp đồng.pdf`, không thêm “(ezPDF)”. ezPDF không tự gửi tài liệu đi đâu. Tệp chỉ rời app khi người dùng chọn nơi nhận.

| Nơi chạy | Bấm Chia sẻ thì |
|---|---|
| **Windows** | Hiện menu ba cách. **Chép tệp để dán vào Zalo, Telegram, thư**: tệp được đặt vào bộ nhớ tạm của Windows như khi bấm Copy trong File Explorer, rồi người dùng bấm **Ctrl V** trong khung chat Zalo, Telegram hay thư Outlook. **Chia sẻ bằng Windows…**: cửa sổ chia sẻ của Windows (Outlook, Chia sẻ lân cận, Phone Link và các ứng dụng nhận tệp). **Hiện tệp trong thư mục**: File Explorer mở với tệp đã chọn sẵn, để kéo vào trình duyệt (ví dụ Gmail) hay ứng dụng khác. |
| **Android** | Bảng chia sẻ của Android: Zalo, Telegram, Gmail, Messenger, Bluetooth, Quick Share… Chính ezPDF không có trong danh sách. Ứng dụng nhận chỉ được quyền đọc đúng tệp này. |
| **Trình duyệt** | Chrome, Edge (Windows, Android) và Safari mở bảng chia sẻ của hệ điều hành. Trình duyệt chưa chia sẻ tệp được (Firefox trên máy tính) thì nút thành **Tải tệp về để gửi đi**: tệp được tải về, kèm lời dặn kéo tệp vào Zalo, Telegram hay thư. |

**Bản sao tạm.** Để ứng dụng khác đọc được, tệp phải nằm ở một chỗ trên máy:
- Windows: thư mục `%TEMP%\ezPDF-chia-se\`.
- Android: thư mục cache riêng của ezPDF.

Chỉ **3 bản gần nhất** được giữ, vì một thư đang soạn hay Bluetooth có thể đọc tệp đính kèm muộn, và dán Ctrl V có thể diễn ra sau. Bản cũ hơn bị xóa mỗi lần chia sẻ hay in. Trên Windows, bản quá một ngày bị xóa khi mở app. Bản nháp vẫn ở chỗ cũ, không liên quan.

**Mã:**
- `src/app/output-actions.tsx`: nút, menu, thông báo.
- `src/platform/*.ts`: phần riêng của từng nơi chạy.
- `src-tauri/src/share.rs`:
  - bộ nhớ tạm theo định dạng `CF_HDROP` kèm “Preferred DropEffect = Copy”;
  - cửa sổ chia sẻ qua `DataTransferManager` (`IDataTransferManagerInterop::ShowShareUIForWindow`);
  - `explorer /select,…` để hiện tệp trong thư mục;
  - làm sạch tên tệp: bỏ ký tự Windows cấm, tránh tên thiết bị như CON, giới hạn 120 ký tự.
- `EzFilesPlugin.java`: `openCacheWrite`, `shareFile` (FileProvider, `ACTION_SEND`), `printFile`.

Nếu trình duyệt từ chối chia sẻ vì việc chuẩn bị tệp lớn mất quá lâu sau cú bấm (trình duyệt chỉ cho chia sẻ ngay sau một lần bấm), app hiện dòng “… đã sẵn sàng” kèm nút **Chia sẻ**. Bấm nút đó thì chia sẻ ngay tệp đã chuẩn bị.

## 3. In

Nút **In** (máy in, **Ctrl P**). Trên điện thoại, nút In nằm trong menu **⋮** cùng với Đóng tài liệu, để thanh trên không rộng hơn màn hình. In cũng dùng đúng tệp Xuất PDF.

**Android: in thẳng tệp PDF.** App mở màn hình in của Android với chính tệp PDF, nên chữ và nét in sắc như bản gốc. Ở đó chọn máy in, số bản, trang cần in, khổ giấy, màu, hoặc **Lưu dưới dạng PDF**. Máy in hiện ra nhờ các dịch vụ in của điện thoại:
- máy in Wi-Fi cùng mạng: dịch vụ in mặc định của Android hoặc Samsung, chuẩn Mopria;
- máy in Bluetooth hay USB: ứng dụng hoặc plug-in của hãng (HP Smart, Canon PRINT, Epson…).

**Windows và trình duyệt: in ảnh trang.** WebView2 trên Windows và trình duyệt chỉ in được trang web, không nhận một tệp PDF để in. Vì vậy app dựng từng trang của tệp xuất bằng PDFium, gồm cả chú thích và góc xoay trang, thành ảnh **300 dpi**. Các ảnh này nằm trong một khối chỉ dùng khi in. Mỗi trang CSS có đúng khổ và chiều của trang PDF, nên trang ngang in ngang. Sau đó app mở hộp thoại in của Windows (hay của trình duyệt), có xem trước, để chọn máy in, số bản, trang cần in, khổ giấy, màu. Máy in nào đã cài trong Windows (Cài đặt → Bluetooth & thiết bị → Máy in & máy quét) đều có trong danh sách.
- Tài liệu dài thì độ phân giải giảm dần, để cả lượt in không quá khoảng 260 triệu điểm ảnh, nhưng không dưới 96 dpi. Ví dụ: tới khoảng 30 trang A4 vẫn ở 300 dpi, 100 trang ở khoảng 165 dpi, 200 trang ở khoảng 120 dpi. Hộp thoại in giữ ảnh của mọi trang, nên đây là giới hạn bộ nhớ.
- Trong lúc dựng trang có hộp tiến độ “Trang x/y” và nút **Hủy** (hoặc Esc). Đóng tài liệu hay mở tài liệu khác giữa chừng cũng hủy lượt in và lượt chia sẻ đang chuẩn bị, để không in hay gửi nhầm tài liệu đã rời.
- Giới hạn: chữ được in dưới dạng ảnh 300 dpi. Bản in giấy nhìn sắc, nhưng nếu chọn máy in “Microsoft Print to PDF” thì sẽ ra một PDF toàn ảnh. Muốn có tệp PDF thật thì dùng **Xuất PDF**.
- Lệnh in của chính trình duyệt (menu, hoặc Ctrl P khi chưa mở tài liệu) không in giao diện app ra giấy. Thay vào đó, trang in có một dòng nhắc dùng nút In của ezPDF.

**Mã:** `src/app/print/print-pages.ts`, phần dựng ảnh trong `src/engine/export.worker.ts` (`render-open`, `render-page`, `render-close`), quy tắc in trong `src/styles.css`.

## 4. Kiểm

Bộ kiểm mới `npm run e2e:share` (`scripts/e2e-share-print.cjs`) chạy trên Chromium thật: **34/34** điểm trên dev server, **34/34** trên bản build production.

- **Bàn tay.**
  - Máy có chuột mở tài liệu là ở bàn tay, con trỏ trên trang là bàn tay.
  - Kéo 300 px xuống, 150 px ngang thì trang cuộn đúng 300 và 150 px.
  - Ở chế độ Chọn, cùng cú kéo đó không cuộn.
  - Giữ Space kéo được từ chế độ Chọn và từ công cụ Tô sáng, không tạo vết tô; nhả ra thì về đúng công cụ cũ.
  - Esc từ công cụ vẽ về bàn tay.
  - Với bàn tay: bấm chỗ trống thì bỏ chọn, bấm ô chữ thì chọn được, kéo ô chữ thì ô dời đúng quãng kéo mà trang không cuộn. Kéo trang khi đang chọn ô chữ thì ô vẫn được chọn. Đang gõ một ô mới mà bấm ra trang thì ô được giữ, gõ xong.
  - Gõ Space (không kéo) lật xuống đúng 90 % chiều cao khung xem, Shift Space lật lại.
- **Chia sẻ.**
  - Tệp đưa cho bảng chia sẻ tên `sample.pdf`, **trùng từng byte** với tệp Xuất PDF, có ô chữ vừa thêm.
  - Đóng bảng chia sẻ không chọn gì thì không báo gì.
  - Khi trình duyệt đòi một cú bấm mới, nút “Chia sẻ” trên dải báo chia sẻ được tệp đã chuẩn bị.
  - Trình duyệt không có Web Share thì tải tệp về và dặn cách gửi.
- **In** (`scripts/verify_print.py`, so bằng MuPDF, engine khác PDFium):
  - Tệp mẫu 4 trang có trang thường, trang xoay 90°, trang khổ lạ 495×700 pt, trang xoay 270°. Ra đúng 4 trang in, mỗi trang đúng khổ và chiều của trang trong tệp xuất (sai lệch dưới 1 pt), ảnh trang 300 dpi.
  - Hình giống tệp xuất: tương quan 0,989–0,995. Khi lật ngược trang để đối chứng, tương quan còn −0,04. Hình so sánh: `bang-chung/m6-in-so-voi-tep-xuat.png`.
  - In xong thì khối in được gỡ, tiêu đề trang trở lại.
  - Ctrl P in tài liệu. Lệnh in của trình duyệt chỉ in ra dòng nhắc.
  - Tài liệu 300 trang: hộp tiến độ hiện “Trang x/300”, bấm Hủy thì không có gì được in.
- **Điện thoại:** không có nút bàn tay, chế độ Chọn bật sẵn. Nút Chia sẻ ở thanh trên. Menu ⋮ có In và Đóng tài liệu. Thanh trên vừa màn hình 412 px.

**Vỏ desktop thật** (`node scripts/smoke-desktop.cjs`, Tauri trên Linux qua WebDriver): **20/20**. Phần mới:
- Bấm Chia sẻ thì tệp xuất đi qua IPC tới vỏ Rust, được ghi thành `ezPDF-chia-se/<giờ>/Hợp đồng mẫu.pdf` (tên có dấu, có dấu cách, trang 1 đã xoay 90°), và thư mục đó được mở.
- Cách chia sẻ mà hệ đó không có thì bị từ chối kèm lời báo.

**Mã Rust:** `cargo test` 4/4, gồm làm sạch tên tệp, giải mã tên tệp, giữ 3 bản sao mới nhất và xóa bản quá hạn khi mở app. Phần riêng cho Windows (bộ nhớ tạm, cửa sổ chia sẻ, Explorer) biên dịch được cho đích Windows (`x86_64-pc-windows-gnu`). CI dựng bản cài bằng MSVC.

**Android:** `EzFilesPlugin.java` biên dịch được với `android.jar` (`scripts/check_android_java.sh`).

**Rà soát độc lập.** Một lượt rà mã riêng (không xem bộ kiểm) đã tìm ra 6 điểm, và cả 6 đã sửa trước khi giao:
- lượt in hay chia sẻ đang chuẩn bị vẫn chạy tiếp sau khi đóng tài liệu;
- tài liệu rất dài có thể hết bộ nhớ khi in;
- cú kéo bị kẹt nếu nút chuột được nhả ngoài cửa sổ;
- Space bấm lại nút vừa được bấm bằng chuột;
- Ctrl P lặp khi giữ phím;
- trên Android, chép tệp in chạy trên luồng giao diện.

**Hồi quy:** mọi bộ cũ vẫn đạt.

| Bộ | Dev | Production |
|---|---|---|
| `e2e` | 56/56 | 56/56 |
| `e2e:m3` | 50/50 | 49/49 |
| `e2e:m4` | 14/14 | 22/22 |
| `e2e:edit` | 24/24 | 24/24 |
| `e2e:scan` | 24/24 | 16/16 |

Ngoài ra: `test:layout`, `test:engine`, `verify`, `test:m3`, `test:storage` 25/25, `test:edit` đều đạt.

## 5. Tự kiểm trên máy thật

Các phần dưới đây dùng API riêng của Windows hoặc Android, máy kiểm thử tự động không chạy được:

**Windows** (bản cài từ CI; hoặc bản chạy thử dựng sẵn `out\ezPDF-0.6.0-chay-thu\ezPDF.exe`, chạy được không cần cài, nhớ đóng ezPDF đang mở trước):
1. Mở một PDF. Con trỏ trên trang là bàn tay, kéo trang thì trang cuộn. Bấm vào một ô chữ đã thêm thì ô được chọn, kéo thì ô di chuyển.
2. Chia sẻ → **Chép tệp để dán…** Mở Zalo PC hoặc Telegram Desktop, vào một cuộc trò chuyện, bấm Ctrl V. Tệp `Tên tài liệu.pdf` hiện ra để gửi. Cũng thử dán vào một thư mục trong File Explorer.
3. Chia sẻ → **Chia sẻ bằng Windows…** Cửa sổ chia sẻ hiện ra, tiêu đề là tên tệp.
4. Chia sẻ → **Hiện tệp trong thư mục.** File Explorer mở với tệp đã chọn sẵn.
5. **In** (Ctrl P). Hộp thoại in có xem trước, đủ trang, trang ngang hiện ngang. In thử một trang ra máy in.

**Android (APK từ CI):**
1. Bấm Chia sẻ. Bảng chia sẻ có Zalo, Telegram, Gmail và không có ezPDF. Gửi cho chính mình qua Zalo rồi mở tệp nhận được: có đủ chú thích.
2. Bấm **⋮ → In tài liệu.** Màn hình in của Android hiện tài liệu. Chọn **Lưu dưới dạng PDF** hoặc một máy in Wi-Fi.
