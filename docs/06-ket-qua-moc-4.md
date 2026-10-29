# 06 · Kết quả mốc 4: đóng gói 3 nền tảng

Một mã nguồn, ba bản: web app cài được (PWA), desktop (Tauri 2), Android (Capacitor 8). Mọi khác biệt giữa ba bản nằm trong `src/platform/`. Phần còn lại của app (engine, công cụ, giao diện) giống hệt nhau.

## Tóm tắt nghiệm thu

| Tiêu chí của mốc 4 | Trạng thái |
|---|---|
| Cùng bộ e2e chạy trên bản web | **Đạt.** Bộ mốc 1–2, mốc 3 và bộ mới của mốc 4 xanh trên dev server và trên bản build production (bản này giờ có service worker và CSP). Số liệu ở bảng kiểm thử. |
| Smoke test trên Windows | **Chưa làm được ở đây.** Môi trường phát triển là Linux và không tải được bộ công cụ MSVC. Đã chạy smoke test trên **bản desktop thật chạy Linux** (cùng mã Rust, cùng plugin, chỉ khác WebView), 18/18. Đã dựng được một bản **chạy thử cho Windows** (`ezPDF.exe` không cần cài, cross-compile từ Linux), nhưng chưa chạy được ở đây. Bộ cài chính thức dựng bằng CI hoặc `npx tauri build` trên máy Windows. Danh sách thử tay ở cuối tài liệu. |
| Smoke test trên một máy Android thật | **Chưa làm được ở đây.** Không có Android SDK, và Gradle không tải được thư viện Android (maven.google.com bị chặn trong môi trường này). Plugin Java đã biên dịch với `android.jar` thật. APK được dựng bằng Android Studio hoặc CI. Danh sách thử tay ở cuối tài liệu. |
| Tệp 50 MB mở được trên Android tầm trung | **Mới đo thay thế.** Trên Chromium với màn hình điện thoại và CPU chậm 4×, tệp quét 51 MB (36 trang) mở và hiện trang đầu sau 2,4 giây. Lúc xuất, bộ nhớ của trình duyệt lên tới khoảng 1,7 GB, nên đây là rủi ro chính trên điện thoại 4 GB RAM. Phải đo trên máy thật. |

## Đã làm

| Phần | Nội dung |
|---|---|
| Lớp lưu trữ | Một interface `StorageBackend` (`list`, `get`, `read`, `put`, `remove`). Mỗi mục là một bản ghi JSON nhỏ cộng các phần nhị phân: tệp gốc, bản nháp, ảnh chữ ký. Có 3 adapter. **Web:** IndexedDB, giữ nguyên cấu trúc của mốc 3, nên nháp và chữ ký cũ vẫn mở được. **Desktop:** tệp trong thư mục dữ liệu cục bộ của app (`%LOCALAPPDATA%\app.ezpdf.desktop\store`), không đi theo hồ sơ roaming. **Android:** tệp trong bộ nhớ riêng của app. |
| Ghi an toàn | Hai adapter dạng tệp dùng chung `file-tree.ts`. Mỗi lần lưu ghi phần dữ liệu vào tệp mới trước, rồi mới ghi tệp mô tả (meta), không đổi tên và không ghi đè. Xong mới dọn bản cũ. Nếu app tắt giữa chừng, bản trước vẫn đọc được: tệp meta ghi dở hoặc thiếu phần dữ liệu thì bị bỏ qua. |
| Lớp nền tảng | Một interface `Platform` gồm: mở tệp (hộp thoại hệ thống, hoặc ô chọn tệp của trang), lưu tệp xuất (tải về, hộp thoại Lưu, hoặc SAF), nhận tệp từ ngoài (“Mở bằng”, chia sẻ, dòng lệnh) và báo sắp đóng cửa sổ. |
| Web app cài được | Có manifest (tên, màu, biểu tượng thường và biểu tượng maskable), có service worker. Service worker giữ **mọi tệp của bản build** (app, WASM của PDFium, phông, worker xuất), nên sau lần mở đầu app chạy hoàn toàn offline. Nó chỉ trả lời request GET cùng origin từ bộ đệm và không gửi gì đi. Khi cài trên Chrome hoặc Edge máy tính, app đăng ký làm trình mở PDF (`file_handlers` và `launchQueue`). Bản mới chỉ được dùng khi mọi tab ezPDF đã đóng, để một trang không chạy lẫn hai phiên bản. |
| Chặn gửi ra ngoài | Bản web có Content-Security-Policy `connect-src 'self' blob: data:`. Trình duyệt tự chặn mọi request tới site khác, kể cả khi có mã lạ lọt vào trang. Bản desktop có CSP tương tự trong `tauri.conf.json`. |
| Desktop | Dùng hộp thoại Mở/Lưu của hệ điều hành. Bộ cài đăng ký ezPDF vào mục **Mở bằng** của tệp `.pdf`; đường dẫn tệp đến qua dòng lệnh. Chỉ có một cửa sổ: mở thêm một PDF thì PDF đó đi vào cửa sổ đang mở. Trước khi cửa sổ đóng, app lưu nốt bản nháp (chờ tối đa 15 giây). Kéo thả tệp vẫn chạy. |
| Quyền của bản desktop | Trang web bên trong app chỉ đọc/ghi được thư mục `store` của nó, cộng **đúng** tệp người dùng chọn trong hộp thoại hoặc mở bằng chuột phải. Mọi đường dẫn khác bị từ chối ở tầng Rust. |
| Android | ezPDF có plugin Java riêng (`EzFilesPlugin`), nên app không cần quyền bộ nhớ. Mở tệp bằng `ACTION_OPEN_DOCUMENT`, chỉ hiện PDF. Lưu bằng `ACTION_CREATE_DOCUMENT`: người dùng chọn chỗ lưu, kể cả Drive. App nhận PDF khi người dùng **Mở bằng** (`ACTION_VIEW`) hoặc **Chia sẻ** (`ACTION_SEND`) sang ezPDF. Tệp được đọc qua máy chủ nội bộ của WebView theo dạng luồng, không chuyển thành base64. |
| Riêng tư trên Android | Tắt sao lưu lên đám mây và chuyển sang máy mới cho dữ liệu của app (`allowBackup="false"` và `data_extraction_rules.xml`). Nháp và chữ ký không theo bản sao lưu Google lên mạng. |
| Lời nhắc theo nền tảng | Màn hình trống và danh sách nháp nói đúng theo bản đang chạy. Ví dụ bản desktop nhắc bấm chuột phải để mở, và cho biết nháp nằm trong “thư mục dữ liệu của ezPDF”; di chuột vào sẽ thấy đường dẫn. |
| Biểu tượng | Một bản vẽ gốc (`branding/*.svg`) sinh ra biểu tượng cho web, Windows (`.ico`), Android (adaptive, tròn, vuông) và màn hình chờ. |
| CI | `.github/workflows/build.yml`: chạy toàn bộ kiểm thử web, dựng `.msi` và `-setup.exe` trên Windows, dựng APK debug trên Ubuntu. **Lượt #3 trên GitHub (29/10) xanh cả 3 job.** Bộ kiểm web cũng đạt trên máy của GitHub. Ba lỗi của hai lượt đầu đã sửa: bước `setup-android@v3` hỏng với cmdline-tools 16; WiX không ghi được chữ tiếng Việt vì mã trang 1252, nên mô tả bộ cài chuyển sang tiếng Anh; một bước của bộ kiểm mốc 3 không chờ hộp thoại chữ ký đóng. |

## Kết quả kiểm thử

| Bộ kiểm | Kết quả |
|---|---|
| `npm run e2e` (mốc 1–2), Chromium | **56/56** trên dev server, **56/56** trên bản production |
| `npm run e2e:m3` (mốc 3) | **50/50** trên dev server, **49/49** trên bản production (bản build không có trang kiểm pdf.js) |
| `npm run e2e:m4`, dev server | **11/11** (gồm 4 điểm kiểm cảm ứng trên điện thoại): hợp đồng lưu trữ trên IndexedDB 9/9; mã adapter Android chạy trên Filesystem của Capacitor (bản web) 9/9, có ghi 7 MB theo khối; nháp và chữ ký của mốc 3 vẫn mở được 4/4; “Mở bằng” qua `launchQueue`; không request ra ngoài, không lỗi |
| `npm run e2e:m4:preview`, bản production | **19/19** (gồm 4 điểm kiểm cảm ứng): manifest và biểu tượng đúng cỡ; Chromium không báo lỗi cài đặt; service worker giữ đủ 18 tệp của bản build. Khi **tắt mạng**: app khởi động, mở PDF, thêm chữ tiếng Việt, lưu nháp, xuất tệp (MuPDF đọc lại thấy đúng chữ). CSP chặn một lệnh POST tới site khác. Không có vi phạm CSP nào khi dùng bình thường |
| `npm run test:storage` | **25/25**: lớp lưu trữ dạng tệp trên bộ nhớ và **trên đĩa thật** (tệp 12 MB). Có cả trường hợp app tắt giữa lúc ghi: meta ghi dở, meta trỏ tới tệp đã mất, thư mục nháp không có meta |
| `scripts/smoke-desktop.cjs`, bản desktop thật trên Linux | **18/18** (chi tiết bên dưới) |
| `cargo test` (phần Rust) | 1/1: chỉ nhận đối số là tệp PDF có thật |
| `scripts/check_android_java.sh` | `EzFilesPlugin` và `MainActivity` biên dịch được với `android.jar` |
| `scripts/build-windows-cross.sh` | Dựng được `ezPDF.exe` 64-bit cho Windows. Tệp chỉ cần DLL hệ thống và `WebView2Loader.dll` đi kèm. **Chưa chạy trên Windows** |
| `test:layout`, `test:engine`, `verify`, `test:m3` | 14/14, PASS, PASS ×3, 54/54: các mốc trước không bị ảnh hưởng |

### Smoke test bản desktop (Linux, WebDriver)

`scripts/smoke-desktop.cjs` chạy **chính tệp chạy của app** (không phải trình duyệt) qua `tauri-driver` và WebKitWebDriver, trên màn hình ảo:

1. Chạy app với đường dẫn `Hợp đồng mẫu.pdf` (tên có dấu và có dấu cách), giống khi chọn “Mở bằng ezPDF”: tệp mở ra.
2. Xoay một trang: bản nháp được ghi thành tệp trong thư mục của app. Tệp gốc lưu kèm nháp giống tệp đã mở đến từng byte. Tệp đã mở không bị đụng tới.
3. Trang web bên trong app thử đọc một PDF không được cấp, đọc `/etc/hostname`, và ghi ra `/tmp`: cả ba bị Rust từ chối (“forbidden path”). Cùng lệnh ghi đó vào thư mục `store` thì được, tức là bị từ chối vì phạm vi quyền chứ không phải vì gọi sai. Gửi dữ liệu tới site khác bị CSP chặn.
4. Tắt rồi mở lại app: nháp có trong danh sách và mở lại đúng trang đã xoay. Màn hình trống nhắc “bấm chuột phải… Mở bằng ezPDF”. Dòng cuối danh sách nói nháp nằm trong “thư mục dữ liệu của ezPDF”; di chuột vào sẽ thấy đường dẫn.
5. Khi app đang mở, chạy app lần nữa với tài liệu 300 trang: tiến trình thứ hai thoát ngay, tài liệu mở trong cửa sổ cũ sau khoảng 0,4 giây.
6. Hộp thoại **Mở** của hệ điều hành (điều khiển bằng xdotool): PDF được chọn mở ra. Hộp thoại **Lưu**: tệp xuất được ghi đúng chỗ đã chọn và có trang đã xoay (`/Rotate 90`). App báo tệp đã lưu ở đâu. Ảnh chụp cả màn hình có hộp thoại nằm trong `bang-chung/`.
7. Đóng cửa sổ (như bấm nút X) chỉ 0,15 giây sau khi sửa, lúc nháp còn đang chờ lưu: app lưu nháp xong rồi mới đóng, trong khoảng 0,3 giây.

Bản Windows dùng WebView2 thay cho WebKitGTK. Phần Rust (đối số dòng lệnh, một cửa sổ, quyền tệp) giống hệt, nhưng cơ chế một cửa sổ trên Windows khác Linux (Linux đi qua D-Bus). Vì vậy vẫn phải thử tay trên Windows.

### Tệp 50 MB (thay cho máy Android tầm trung)

Tệp `out/big-50mb.pdf`: 51,4 MB, 36 trang A4, mỗi trang là một ảnh quét JPEG 300 dpi (`scripts/make_big_fixture.py`). Chạy trên bản production, màn hình 412×915 điểm, mật độ 2,625, CPU chậm 4×.

| Bước | Thời gian | Bộ nhớ trình duyệt |
|---|---|---|
| Trước khi mở | | 483 MB |
| Chọn tệp → bố cục trang sẵn sàng | 1,9 s | 739 MB |
| → trang đầu hiện | 2,4 s | 720 MB |
| Cuộn tới trang cuối → trang cuối hiện | 3,7 s | 1 104 MB |
| Sửa một chỗ → nháp đã lưu (gồm 7,4 s chờ theo cỡ tệp; lưu thật khoảng 2,3 s) | 9,7 s | 1 426 MB |
| Tải lại trang → mở lại nháp, trang đầu hiện | 1,8 s | 926 MB |
| Xuất ra tệp 51,4 MB | 5,2 s | **1 716 MB** |
| Mã hóa base64 cả tệp theo khối 3 MB (phần JS của đường lưu trên Android) | 1,1 s | |

Không có lỗi trang. Thời gian đều ổn. Đáng lo là bộ nhớ khi lưu nháp và khi xuất (xem mục Giới hạn). Con số này đo cả tiến trình trình duyệt trên máy tính, không phải WebView trên điện thoại. Kết quả trên máy thật có thể khác.

## Những gì cần máy thật

### Windows

Để thử nhanh: giải nén `out/windows-portable/ezPDF-0.4.0-windows-x64-chay-thu.zip` và chạy `ezPDF.exe`. Tệp chưa ký số nên SmartScreen sẽ hỏi: chọn “More info” rồi “Run anyway”. Bản này không đăng ký “Mở bằng”; ở bước 2, chọn “Choose another app” rồi trỏ tới `ezPDF.exe`. Bộ cài đầy đủ lấy từ CI (artifact `ezpdf-windows`) hoặc dựng trên máy Windows: `npm ci && npx tauri build`.

1. Cài, mở ezPDF từ Start. Màn hình trống phải nhắc “bấm chuột phải vào một tệp PDF và chọn Mở bằng ezPDF”.
2. Trong Explorer, bấm chuột phải một PDF có tên tiếng Việt và dấu cách, chọn **Mở bằng → ezPDF**: tệp mở ra.
3. Khi ezPDF đang mở, làm lại bước 2 với một PDF khác: PDF đó phải mở trong **cùng cửa sổ**, không sinh cửa sổ thứ hai.
4. Bấm nút mở (Ctrl O): hộp thoại của Windows hiện ra, chỉ lọc PDF.
5. Thêm chữ tiếng Việt và một chữ ký, rồi đóng cửa sổ **ngay** sau khi sửa. Mở lại ezPDF: bản nháp có thay đổi cuối cùng. Thư mục `%LOCALAPPDATA%\app.ezpdf.desktop\store\drafts` có thư mục của nháp đó.
6. Bấm Xuất PDF (Ctrl S): hộp thoại Lưu của Windows gợi ý tên `… (ezPDF).pdf`. Tệp xuất mở được trong Edge hoặc Acrobat, chữ tiếng Việt đủ dấu.
7. Tắt Wi-Fi rồi làm lại các bước trên.

### Android

Lấy APK từ CI (artifact `ezpdf-android-debug`), hoặc dựng bằng Android Studio sau `npm run build:android`.

1. Cài APK (cho phép cài từ nguồn ngoài), mở ezPDF.
2. Bấm Chọn tệp PDF: trình chọn tệp của hệ thống hiện ra, chỉ có PDF. Chọn một tệp trong Tải xuống, rồi một tệp trên Drive.
3. Từ ứng dụng Tệp, Zalo hoặc Gmail, mở một PDF và chọn ezPDF: tệp mở ra.
4. Chia sẻ một PDF sang ezPDF: tệp mở ra.
5. Thêm chữ và ký bằng ngón tay, về màn hình chính, vuốt tắt app, mở lại: bản nháp còn đủ.
6. Bấm Xuất PDF: hộp thoại “Lưu vào” của hệ thống. Lưu vào Tải xuống, rồi mở bằng một app PDF khác.
7. Dùng tệp 50 MB (`python3 scripts/make_big_fixture.py out/big-50mb.pdf`, hoặc một bản quét thật). Mở, cuộn tới trang cuối, sửa một chỗ, chờ báo “Nháp đã lưu”, rồi xuất. Ghi lại thời gian từng bước, tên máy, RAM và phiên bản Android.
8. Bật chế độ máy bay rồi làm lại bước 2, 5 và 6.

## Lần thử đầu trên điện thoại thật (Samsung Galaxy S24 Ultra, 29/10)

APK dựng bằng CI đã cài và mở được, PDF hiển thị đúng. Lần thử này phát hiện ba lỗi, đều đã sửa trong bản 0.4.1:

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| Thanh công cụ trên bị thanh trạng thái (sóng, pin) che, nên không bấm được Xuất, Đóng… | Trang khai báo `viewport-fit=cover`. Với WebView từ bản 140, Capacitor 8 khi đó để app vẽ tràn ra sau thanh trạng thái | Bỏ `viewport-fit=cover`, để Capacitor tự chừa chỗ cho thanh trạng thái và thanh cử chỉ. Biểu tượng thanh trạng thái màu tối, nền cùng màu thanh công cụ |
| Không cuộn được khi đặt tay lên trang (chỉ cuộn được ở lề xám), không phóng to/thu nhỏ bằng hai ngón | Chế độ mặc định của EmbedPDF nhận mọi cú chạm trên trang (`touch-action: none`) và chưa bật cử chỉ phóng to | Ở chế độ Chọn, một ngón cuộn trang. Hai ngón phóng to/thu nhỏ tài liệu (`ZoomGestureWrapper`), không phóng cả app. Khi đang dùng công cụ vẽ (chữ, tô sáng…) hoặc kéo một đối tượng, cú chạm vẫn thuộc về công cụ |
| Không rõ nút xoay áp dụng cho trang nào | Nút xoay “trang hiện tại”, nhưng trên điện thoại không có số trang trên màn hình | Thanh trên hiện “2/300”. Bấm xoay thì dải gợi ý báo “Đã xoay trang 2 sang phải”. Trên máy tính, chú thích của nút cũng ghi số trang |

`e2e:m4` có thêm 4 điểm kiểm trên màn hình điện thoại có cảm ứng: vuốt một ngón trên trang thì cuộn; hai ngón thì phóng to tài liệu mà không phóng app; với công cụ chữ, kéo trên trang tạo ô chữ; số trang hiển thị đúng là trang bị xoay. Từ bản này, APK debug ký bằng một khóa cố định (`android/app/ezpdf-debug.keystore`, chỉ dùng để thử), nên bản sau cài đè được lên bản trước mà không mất nháp.

## Giới hạn và rủi ro còn lại

1. **Chưa thử trên Windows và Android thật.** Đây là phần còn thiếu của tiêu chí nghiệm thu. Mã cho hai nền tảng đã viết xong và đã kiểm được tới mức môi trường này cho phép: bản desktop chạy thật trên Linux; plugin Android biên dịch với `android.jar`, chữ ký hàm của Capacitor chép từ mã nguồn thật (`tests/android-stubs/`). Riêng plugin Android chưa chạy lần nào.
2. **Bộ nhớ với tệp lớn.** Lúc xuất tệp 51 MB, trình duyệt chiếm khoảng 1,7 GB. Nguyên nhân: tệp được giữ nhiều bản cùng lúc. Có bản lưu của engine (chép từng byte, G6), bản PDFium thứ hai trong worker xuất, và tệp kết quả. Trên điện thoại 4 GB RAM, WebView có thể bị hệ điều hành đóng. Mốc 6 đã có việc này: bỏ chép từng byte và cho bước xuất chạy chung worker.
3. **Lưu trên Android tốn thêm thời gian.** Cầu nối của Capacitor chỉ chở JSON, nên khi ghi nháp hay ghi tệp xuất, dữ liệu đi dưới dạng base64 theo khối 3 MB. Ở phía JS, mã hóa 51 MB mất khoảng 1,2 giây trên CPU chậm 4×; phía Java giải mã thêm một lượt. Đọc thì không bị, vì đi qua máy chủ nội bộ của WebView.
4. **Bản Android chưa bật CSP**, vì chưa kiểm được cầu nối của Capacitor khi có CSP. App vẫn khai báo quyền INTERNET như mẫu của Capacitor. ezPDF không gọi mạng, nhưng trên Android điều này mới được bảo đảm bằng mã, chưa được trình duyệt cưỡng chế như ở bản web và desktop.
5. **Trên Linux**, cơ chế một cửa sổ cần D-Bus phiên. Máy để bàn Linux thông thường đều có.
6. **Web app:** nháp vẫn nằm trong trình duyệt, nên có thể mất khi xóa dữ liệu trang web. Trên iPhone/iPad không có “Mở bằng” cho web app. Bản mới chỉ có hiệu lực khi đã đóng mọi tab ezPDF.
7. **Bản desktop chưa ký số**, nên Windows SmartScreen sẽ cảnh báo “ứng dụng không rõ nguồn” khi cài. Cần chứng thư ký mã trước khi phát hành rộng.
8. Các giới hạn của mốc 1–3 vẫn còn (xem `05-ket-qua-moc-3.md`).
