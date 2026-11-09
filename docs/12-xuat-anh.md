# 12 · Xuất thành ảnh: PNG, JPEG, TIFF, WebP (bản 0.8.7)

Theo yêu cầu: “ở bản cho windows, tôi muốn phát triển thêm tính năng chuyển từ pdf sang ảnh các định dạng: png, jpeg, tiff…”. Yêu cầu nói đến bản Windows, nhưng tính năng làm cho cả ba bản (Windows, Android, web và iPhone), vì phần tạo ảnh là mã chung. Mỗi bản chỉ khác ở chỗ ảnh được lưu vào đâu.

## Tóm tắt nghiệm thu

| Việc | Trạng thái |
|---|---|
| Ảnh đúng như tệp xuất | **Đạt** (thử tự động). Mỗi ảnh được so với trang tương ứng của tệp “Xuất PDF” do một engine khác (MuPDF) vẽ: cùng kích thước điểm ảnh ở dpi đã chọn, khớp hình (chênh trung bình ≤ 10/255 với PNG, TIFF; ≤ 14 với JPEG, WebP), đúng chiều (trang xoay vẫn xoay). Ô chữ đã thêm có trong ảnh. |
| TIFF | **Đạt.** ezPDF có bộ ghi TIFF riêng (nén LZW, predictor 2, một hay nhiều trang). Tệp được đọc lại bằng hai bộ đọc độc lập là libtiff (qua Pillow) và tifffile, từng điểm ảnh trùng với ảnh gốc, kể cả 400 dải ảnh ngẫu nhiên chạm đúng các ngưỡng đổi độ rộng mã của LZW. |
| dpi ghi trong tệp | **Đạt.** PNG (khối `pHYs`), JPEG (đầu JFIF) và TIFF ghi đúng dpi đã chọn, nên Word hay máy in đặt ảnh đúng khổ giấy. WebP không có chỗ ghi dpi. |
| Windows | **Đạt trên bản desktop thật** chạy Linux (cùng mã Tauri, WebKitGTK, hộp thoại GTK): chọn thư mục trong hộp thoại hệ thống, 4 ảnh PNG được ghi vào đó, lần xuất thứ hai không ghi đè (thêm “(2)”), “Mở thư mục” mở đúng thư mục. **Hộp thoại chọn thư mục của Windows và File Explorer chưa thử trên máy thật**: xem danh sách tự kiểm. |
| Android | Mã Java đã biên dịch với `android.jar`. **Chạy thật trên máy ảo Android của CI** sau mỗi lần push: ảnh 7 và 8 trong trang Summary, kèm danh sách tệp mà Android thấy trong `Pictures/ezPDF` và `Download/ezPDF`. **Chưa thử trên S24 Ultra.** |
| iPhone và trình duyệt | **Đạt trong Chromium** (thử tự động): bảng chia sẻ nhận đủ các ảnh, tải về `.zip` khi nhiều ảnh. **Safari thật**: ảnh máy ảo iPhone của CI và danh sách tự kiểm. |

## Cách dùng

- **Windows (và trình duyệt trên máy tính):** nút **Xuất thành ảnh** (hình ảnh có mũi tên xuống) nằm giữa **In** và **Chia sẻ** trên thanh trên cùng.
- **Điện thoại:** nút **⋮** → **Xuất thành ảnh**.

Trong hộp thoại:

- **Định dạng:** PNG (nét, hợp trang chữ, bảng, công thức), JPEG (nhẹ, hợp trang có ảnh chụp), TIFF (không mất nét, hay dùng lưu hồ sơ), WebP. WebP chỉ hiện ở trình duyệt ghi được WebP (Chrome, Edge, bản Windows, bản Android). Safari không ghi được nên không có lựa chọn này trên iPhone.
- **Trang:** tất cả, trang đang xem, hoặc các trang gõ tay như `1-3, 5`. Gõ sai hay quá số trang thì có lời báo, và nút Xuất bị tắt.
- **Độ phân giải:** 72, 96, 150 (mặc định), 200, 300, 600 dpi, mỗi mức có gợi ý dùng vào việc gì. Ngay dưới là kích thước điểm ảnh của trang đầu, ví dụ “Trang 1: 1240 × 1754 điểm ảnh”.
- **Chất lượng** (JPEG, WebP): 50–100 %, mặc định 90 %.
- **Ảnh xám:** bỏ màu cho tệp nhẹ hơn. TIFF xám lưu một kênh, nhẹ khoảng một phần ba.
- **TIFF:** “Gộp mọi trang vào một tệp TIFF” (mặc định bật), hoặc mỗi trang một tệp.

Ảnh là các trang **đúng như đang thấy**: chữ đã thêm, tô sáng, chữ ký, ảnh đã đặt, chữ đã sửa, góc xoay trang. ezPDF tạo ảnh từ chính tệp mà “Xuất PDF” sẽ ghi. Ảnh được tạo ngay trên máy, không tải lên đâu cả.

**Tên tệp:** `Tên tài liệu - trang 03.png`. Số trang có thêm số 0 cho đủ độ dài, để các tệp xếp đúng thứ tự trong thư mục. Một tệp TIFF nhiều trang mang tên tài liệu (`Hồ sơ.tif`), hoặc kèm các trang đã chọn (`Hồ sơ - 1-3, 5.tif`). Ký tự Windows không cho phép trong tên tệp được đổi thành `_`.

## Ảnh được lưu vào đâu

| Nơi chạy | Ảnh đi đâu |
|---|---|
| **Windows** | Bấm Xuất thì hộp thoại chọn thư mục của Windows mở ra. Ảnh được ghi vào thư mục đã chọn, từng trang một. Tệp trùng tên không bị ghi đè: ảnh mới thành `… (2).png`. Xong có nút **Mở thư mục** (File Explorer mở với ảnh đầu tiên được chọn sẵn). App chỉ được ghi vào thư mục vừa chọn, không ghi ra chỗ khác. |
| **Android** | PNG, JPEG, WebP vào **Ảnh › ezPDF** (`Pictures/ezPDF`), xem được ngay trong Thư viện. TIFF vào **Tải xuống › ezPDF** (`Download/ezPDF`), mở bằng Tệp của tôi, vì Thư viện không hiện TIFF. Không cần xin quyền bộ nhớ. Ảnh đang ghi dở được Android ẩn đi. Nếu hủy hay lỗi giữa chừng, ảnh dở bị xóa. Cần Android 10 trở lên. |
| **iPhone, trình duyệt** | Trang web chỉ được trao tệp sau một lần chạm, nên ảnh được giữ lại khi tạo xong. Hộp thoại hiện **Lưu hoặc chia sẻ**: trên iPhone, chọn “Lưu hình ảnh” để đưa vào app Ảnh, hoặc gửi qua Zalo, thư. Nút **Tải về** tải một ảnh, hay một tệp `.zip` khi có nhiều ảnh. |

**Trang rất lớn.** Mỗi trang được vẽ và mã hóa riêng, xong trang này mới sang trang khác, nên tài liệu dài không làm đầy bộ nhớ. Một trang có tối đa khoảng 36 triệu điểm ảnh (A4 ở 600 dpi). Bản vẽ khổ A0 thì được tạo ở dpi thấp hơn, và hộp thoại báo rõ những trang nào bị hạ. Trên trình duyệt, ảnh giữ lại cho bảng chia sẻ có giới hạn: khoảng 400 MB trên điện thoại, 1,5 GB trên máy tính. Vượt mức đó thì app báo, và đề nghị chọn ít trang hơn hay độ phân giải thấp hơn.

Bấm **Dừng** lúc nào cũng được, và không có ảnh ghi dở nào được để lại. Trên Windows và Android, các ảnh đã ghi xong trước lúc dừng vẫn còn trong thư mục, như khi dừng một lần chép tệp. Trên trình duyệt, ảnh của lần xuất bị dừng không được giữ lại.

## Cách làm

- **Vẽ trang:** worker PDFium của phần xuất (`src/engine/export.worker.ts`) vẽ trang của tệp đã dựng, có chú thích (`FPDF_ANNOT`), lên `OffscreenCanvas` ở dpi đã chọn. Đây cũng là đường vẽ của phần In.
- **PNG, JPEG, WebP:** do canvas mã hóa (`convertToBlob`). Nếu trình duyệt trả về định dạng khác với định dạng đã xin, app báo lỗi chứ không đặt sai đuôi tệp. Sau đó dpi được ghi vào tệp (`src/engine/image-meta.ts`): khối `pHYs` có CRC cho PNG, mật độ trong đầu JFIF cho JPEG.
- **TIFF:** canvas không ghi được TIFF, nên ezPDF tự viết (`src/engine/tiff-write.ts`). Bộ ghi làm theo đúng cách của libtiff:
  - nén LZW, mã rộng thêm một bit khi bảng đầy đến ngưỡng;
  - mã CLEAR khi bảng đạt 4094 mục;
  - predictor ngang 2 (lưu hiệu giữa hai điểm ảnh cạnh nhau) để nén tốt;
  - dải ảnh khoảng 64 KB;
  - nhiều trang nối bằng chuỗi IFD, mỗi trang có số thứ tự trang (`PageNumber`);
  - RGB 8 bit, hoặc xám một kênh;
  - dpi trong `XResolution` và `YResolution`.
- **Lưu:** mỗi bản có một “nơi nhận ảnh” (`openImageSink` trong `src/platform/`):
  - desktop: hộp thoại chọn thư mục của plugin dialog, plugin fs ghi tệp, lệnh Rust `reveal_file` mở Explorer;
  - Android: `openMediaWrite` trong `EzFilesPlugin.java`, ghi qua MediaStore với `RELATIVE_PATH` và `IS_PENDING`;
  - trình duyệt: giữ các `File` cho Web Share, `.zip` không nén dựng bằng fflate.

## Kiểm thử

- `npm run test:images` (11 điểm, chạy cả trên CI):
  - TIFF đọc lại bằng Pillow (libtiff) và tifffile: RGB, xám, nhiều trang, 400 dải LZW ngẫu nhiên, bộ mã hóa dùng lại nhiều lần;
  - dpi trong PNG và JPEG;
  - hạ dpi cho khổ A0;
  - tên tệp.
- `npm run e2e:share`, phần “pictures”:
  - PNG trang 1–2 ở 96 dpi tải về một `.zip`, và qua bảng chia sẻ;
  - JPEG xám chất lượng 70 ở 150 dpi;
  - TIFF mọi trang trong một tệp;
  - TIFF xám một trang;
  - WebP;
  - khoảng trang sai;
  - 300 trang, bấm Dừng giữa chừng;
  - điện thoại: mở từ ⋮, hộp thoại nằm gọn trong màn hình;
  - trình duyệt không có Web Share;
  - thanh trên cùng vẫn vừa cửa sổ 1280 px.

  Mọi ảnh được `scripts/verify_page_images.py` kiểm: định dạng, LZW kèm predictor, số trang, kích thước ở dpi, dpi trong tệp, xám, và hình so với MuPDF.
- `node scripts/smoke-desktop.cjs`, bước 6f, trên bản desktop thật:
  - hộp thoại chọn thư mục GTK được điều khiển bằng xdotool;
  - app báo đang chờ chọn thư mục;
  - 4 ảnh PNG, trang 1 đã xoay nằm ngang;
  - lần thứ hai thành `(2)`, ảnh cũ không đổi;
  - “Mở thư mục” mở đúng thư mục.
- **CI, máy ảo:** `scripts/device-shots.cjs` thêm ảnh 6–8 trên APK (Android) và Safari (iPhone):
  - hộp thoại;
  - PNG mọi trang;
  - một TIFF nhiều trang.

  Trên Android, trang Summary liệt kê tệp trong `/sdcard/Pictures/ezPDF` và `/sdcard/Download/ezPDF`, cùng các dòng MediaStore trả về.

**Sửa kèm.** Nút mới làm thanh trên cùng tràn ở cửa sổ 1280 px, cỡ mặc định của bản Windows: “Xuất PDF” bị đẩy ra ngoài mép, và chữ “Đã xuất” chồng lên nút tìm. Nay chữ “Bộ công cụ” chỉ hiện từ 1440 px trở lên. Hẹp hơn thì nút chỉ có biểu tượng, và tên hiện khi rê chuột vào.

## Giới hạn

- Ảnh là ảnh điểm (raster). Chữ trong ảnh không chọn hay tìm được nữa.
- WebP không ghi dpi. Safari không tạo được WebP.
- TIFF không có nén JPEG hay CCITT (fax), chỉ LZW. Ảnh đen trắng một bit chưa có.
- Android 7–9: chưa lưu được ảnh. Cần Android 10 trở lên.
- Trên trình duyệt, ảnh được giữ trong bộ nhớ đến khi giao đi, nên có giới hạn dung lượng (xem trên). Bản Windows và Android ghi từng ảnh xuống đĩa nên không có giới hạn này.

## Tự kiểm trên máy thật

**Windows**
1. Mở một PDF, thêm một ô chữ, xoay một trang. Bấm **Xuất thành ảnh** → PNG → Tất cả → 150 dpi → **Xuất**.
2. Hộp thoại chọn thư mục của Windows mở ra. Chọn một thư mục, ví dụ trên Desktop. Mong đợi: các ảnh `Tên - trang 1.png`… có trong thư mục, có ô chữ, trang xoay nằm đúng chiều.
3. Bấm **Mở thư mục**. Mong đợi: File Explorer mở với ảnh đầu tiên được chọn sẵn.
4. Xuất lại vào cùng thư mục. Mong đợi: thêm các tệp `… (2).png`, tệp cũ còn nguyên.
5. Chọn TIFF, bật “Gộp mọi trang”, rồi mở tệp `.tif` bằng Windows Photos hay IrfanView. Mong đợi: lật được qua đủ các trang.
6. Bấm Xuất rồi bấm Cancel trong hộp thoại. Mong đợi: quay lại hộp thoại tùy chọn, không có ảnh nào được tạo.

**Android (S24 Ultra)**
1. ⋮ → **Xuất thành ảnh** → PNG → **Xuất**. Mong đợi: báo “Đã lưu … vào Ảnh › ezPDF”. Mở Thư viện thấy album ezPDF.
2. Xuất TIFF. Mong đợi: tệp nằm trong Tệp của tôi › Tải xuống › ezPDF.

**iPhone (Safari, web app)**
1. ⋮ → **Xuất thành ảnh** → PNG → Trang đang xem → **Xuất** → **Lưu hoặc chia sẻ** → “Lưu hình ảnh”. Mong đợi: ảnh có trong app Ảnh.
2. Nhiều trang → **Tải về (.zip)**. Mong đợi: tệp `.zip` có trong app Tệp › Tải về.
