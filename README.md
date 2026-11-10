# ezPDF

Ứng dụng đọc và chỉnh PDF (và sửa nhẹ tệp Word) chạy trên trình duyệt, desktop và Android. Mọi xử lý diễn ra trên thiết bị: tài liệu không bao giờ bị tải lên đâu cả.

**Trạng thái: bản 0.8.8.** Đã chạy trên điện thoại Android thật (Galaxy S24 Ultra) và trên Windows. Web app (cả trên iPhone): **https://quanbughunter.github.io/ezpdf/**. Bộ cài Windows và APK Android của mỗi phiên bản: **https://github.com/quanbughunter/ezpdf/releases/latest**. Tính năng: thumbnail, tìm kiếm, ô chữ tiếng Việt khớp tệp xuất, tô sáng, ghi chú dán, ảnh, chữ ký, xoay trang lưu vào tệp, bản nháp tự lưu, xuất PDF mới, và:

- **Tệp Word** (bản 0.8.0, hình vẽ và công thức từ 0.8.1, ảnh mọi định dạng, phóng to, phông và cỡ chữ từ 0.8.2, chia trang và điểm dừng tab từ 0.8.3, điện thoại đọc trước và phông đúng độ rộng từ 0.8.4, hình nổi có chữ chạy quanh và mũ góc MathType từ 0.8.5, ngoặc MathType vẽ giống nhau trên mọi máy và bảng thông tin tệp từ 0.8.6): mở `.docx` ngay trên máy, sửa chữ, đậm/nghiêng/gạch chân, đổi phông và cỡ chữ, thêm và xóa đoạn, sửa chữ trong bảng, rồi lưu ra `… (ezPDF).docx`. Chia trang như Word (đầu trang, chân trang, số trang trên từng tờ), tab dừng đúng điểm dừng; điện thoại mở tệp để đọc (chạm không bật bàn phím, chạm hai lần để phóng, **Sửa** khi cần sửa), cả trang thu nhỏ vừa màn hình; phông Times New Roman, Arial, Calibri, Palatino Linotype giữ đúng độ rộng chữ cả trên máy không có chúng. Phóng to, thu nhỏ bằng nút, Ctrl + lăn chuột hay hai ngón. Ảnh mọi định dạng (cả TIFF, EPS, PICT), hình vẽ, hộp chữ, nhóm hình, công thức Word và MathType, biểu đồ, SmartArt, chú thích cuối trang hiện đúng như hình; chữ quanh công thức sửa được. Phần không sửa được ghi lại y như cũ; đoạn theo dõi thay đổi, ô điều khiển nội dung chỉ xem. Nút ⓘ hiện thông tin tệp (tên, đường dẫn trên Android, dung lượng, tác giả, ngày tạo…), có nút chép. Xem `docs/11-word.md`.
- **Bộ công cụ** (bản 0.7.0, tên cũ “Sắp xếp trang”; từ 0.8.0 nằm cạnh nút Chia sẻ): thêm trang từ PDF khác, từ ảnh quét hay trang trắng; kéo thả để đổi chỗ (trên điện thoại: giữ rồi kéo); xoay, xóa; trích các trang chọn ra tệp mới; tách tài liệu thành nhiều tệp. Áp dụng một lần, hoàn tác được. Quét xong có thể **Thêm vào tài liệu này**. Xem `docs/10-sap-xep-trang.md`.
- **Kéo trang bằng chuột** (bản 0.6.0, phím P, giữ Space để kéo tạm): mặc định trên máy có chuột. Trên điện thoại, một ngón cuộn trang như trước.
- **Chia sẻ** (bản 0.6.0): gửi đúng tệp “Xuất PDF” qua Zalo, Telegram, thư… Windows: chép tệp để dán (Ctrl V), cửa sổ chia sẻ của Windows, hiện tệp trong thư mục. Android và trình duyệt: bảng chia sẻ của hệ điều hành.
- **In** (bản 0.6.0, Ctrl P): Android in thẳng tệp PDF qua dịch vụ in của máy; Windows và trình duyệt in ảnh trang 300 dpi qua hộp thoại in. Xem `docs/08-keo-trang-chia-se-in.md`.
- **Số phiên bản** (bản 0.8.8): dòng “ezPDF phiên bản 0.8.8” ở cuối màn hình đầu tiên khi vào app (mọi bản); bản Windows còn có trên thanh tiêu đề cửa sổ. Số lấy từ `package.json` (`vite.config.ts` → `src/app/app-version.tsx`), trùng với số của release.
- **Xuất thành ảnh** (bản 0.8.7; Windows: nút cạnh In, điện thoại: ⋮): các trang thành ảnh PNG, JPEG, TIFF (nén LZW, mỗi trang một tệp hoặc cả tài liệu trong một tệp) hay WebP, 72–600 dpi, ảnh xám, tất cả hoặc một số trang; ảnh có đủ chữ đã thêm, chữ ký, phần đã sửa. Windows lưu vào thư mục chọn trong hộp thoại (không ghi đè, có nút Mở thư mục); Android lưu vào Ảnh › ezPDF (TIFF vào Tải xuống › ezPDF); iPhone và trình duyệt: Lưu hình ảnh qua bảng chia sẻ, hoặc tải về. Xem `docs/12-xuat-anh.md`.

- **Sửa chữ có sẵn trong PDF** (bản 0.5.0, phím E): sửa từng dòng, và chỉ phần đã đổi bị viết lại (nhãn đậm đứng trước vẫn giữ nguyên). Chữ cũ được xóa khỏi nội dung trang rồi viết chữ mới vào, không phủ đè. Giữ phông gốc khi phông đó vẽ được mọi chữ mới; nếu không thì dùng phông ezSans (Latin, tiếng Việt, tiếng Nga, Hy Lạp) và báo trước. Xem `docs/07-sua-chu-va-quet.md`.
- **Quét tài liệu** (bản 0.5.0): chụp hoặc chọn ảnh giấy tờ. App tìm mép giấy, kể cả tờ nằm đè lên tờ khác (bản 0.6.2); người dùng kéo 4 góc nếu cần (có kính lúp). App làm phẳng và làm sáng ảnh với màu tự nhiên, rồi tạo PDF. Xử lý hoàn toàn trên máy.

Mốc 4 đóng gói cùng một mã nguồn thành 3 bản:

- **Web app cài được (PWA):** chạy offline sau lần mở đầu, đăng ký làm trình mở PDF khi cài trên Chrome/Edge máy tính. Đây cũng là bản cho iPhone và iPad: mở bằng Safari rồi Thêm vào MH chính (bản 0.6.1; 0.6.2 sửa thanh công cụ bị mờ và bước quét trên iPhone; xem `docs/09-web-app-iphone.md`).
- **Desktop (Tauri 2):** hộp thoại Mở/Lưu của hệ điều hành, “Mở bằng ezPDF” khi bấm chuột phải vào tệp PDF hay Word, một cửa sổ duy nhất, bản nháp nằm trong thư mục của ứng dụng.
- **Android (Capacitor 8):** chọn và lưu tệp qua Storage Access Framework, nhận PDF và tệp Word khi người dùng mở bằng hoặc chia sẻ sang ezPDF, bản nháp nằm trong bộ nhớ riêng của ứng dụng.

Xem `docs/06-ket-qua-moc-4.md`.

## Chạy

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # web app (PWA) trong dist/; `npm run preview` để thử, kể cả offline
```

### Bản desktop (Windows)

Cần Node 22, Rust (rustup) và Visual Studio Build Tools có gói “Desktop development with C++”. WebView2 có sẵn trên Windows 10/11.

```bash
npm ci
npx tauri dev        # chạy thử với dev server
npx tauri build      # bộ cài: src-tauri/target/release/bundle/msi/*.msi và nsis/*-setup.exe
```

Bộ cài đăng ký ezPDF vào mục “Mở bằng” của tệp PDF. `scripts/build-windows-cross.sh` dựng bản chạy thử (không có bộ cài) từ Linux.

### Bản Android

Cần Android Studio (có sẵn JDK 21 và Android SDK).

```bash
npm ci
npm run build:android   # build web ở chế độ android rồi chép vào android/
npx cap open android    # mở trong Android Studio → Run; hoặc: cd android && ./gradlew assembleDebug
```

APK debug nằm ở `android/app/build/outputs/apk/debug/app-debug.apk`.

### Tự động trên GitHub

`.github/workflows/build.yml` chạy toàn bộ kiểm thử web, dựng bộ cài Windows và APK Android trên máy của GitHub, mỗi lần push. Trên nhánh `main`, bản web đã qua kiểm thử được đưa lên GitHub Pages (https://quanbughunter.github.io/ezpdf/). Lần đầu cần: repo công khai, và Settings → Pages → Source: GitHub Actions. Từ bản 0.8.6, sau mỗi lần push lên `main`, CI còn mở các tệp thử trên máy ảo Android (APK vừa dựng, màn hình như Galaxy S24 Ultra) và trên Safari của máy ảo iPhone 15 Pro Max, chụp màn hình. Từ bản 0.8.7, máy ảo còn xuất các trang thành ảnh, và trên Android liệt kê tệp ảnh mà máy thấy trong Ảnh › ezPDF và Tải xuống › ezPDF. Ảnh hiện trên trang Summary của lần chạy và ở nhánh `screens` (https://github.com/quanbughunter/ezpdf/tree/screens). Các job chụp này không làm đỏ lần build.

**Release.** Khi một lần push lên `main` mang phiên bản mới (trường `version` của `package.json`, đổi cùng lúc với `tauri.conf.json`, `Cargo.toml` và `versionName` của Android), và các job web, windows, android đều xanh, job `release` tạo release `vX.Y.Z` trên trang Releases với ba tệp mang số phiên bản: `ezPDF-X.Y.Z-android.apk`, `ezPDF-X.Y.Z-windows-setup.exe`, `ezPDF-X.Y.Z-windows.msi`. Phần giới thiệu lấy từ dòng của phiên bản đó trong `docs/03-ke-hoach-cac-moc.md` (`scripts/release-notes.cjs`), GitHub thêm danh sách commit. Push sau đó mà không đổi phiên bản thì release giữ nguyên. Muốn dựng lại release của cùng phiên bản: xóa release và tag đó trên GitHub, rồi bấm Re-run jobs (hoặc Actions → build → Run workflow trên `main`). Artifact của từng lần chạy cũng mang tên có phiên bản (`ezPDF-X.Y.Z-android`, `ezPDF-X.Y.Z-windows`).

## Kiểm thử

```bash
npm run test:layout  # ngắt dòng, chân chữ, căn lề, giãn ô khi xoay (14 điểm)
npm run test:engine  # headless: 3 tệp (thường, AES-256, RC4) × 4 kiểu trang × chữ Việt + highlight + chữ ký → xuất → đọc lại
npm run verify       # kiểm các tệp xuất của test:engine bằng qpdf, Poppler, MuPDF
npm run test:m3      # headless: ảnh PNG/JPG trên 4 kiểu trang, đổi cỡ, xóa-tạo lại, đổi góc xoay trang → Poppler + MuPDF
npm run e2e          # Chromium thật, mốc 1–2: màn hình = tệp ở 11 mức zoom, 300 trang, điện thoại, không nút chết, không request ra ngoài
npm run e2e:m3       # Chromium thật, mốc 3: ảnh, chữ ký, xoay trang, bản nháp, kiểm tệp xuất bằng Poppler, MuPDF, pdf.js
                     # (chạy test:m3 trước thì e2e:m3 kiểm luôn các tệp của nó bằng pdf.js)
npm run e2e:all      # mọi bộ e2e trên dev server
npm run e2e:preview  # bộ mốc 1–2 trên bản build (sau `npm run build && npm run preview`); e2e:m3:preview tương tự
npm run test:storage # lớp lưu trữ dạng tệp (desktop, Android) trên đĩa thật, kể cả khi app tắt giữa lúc ghi
npm run e2e:m4       # lớp lưu trữ trong trình duyệt (IndexedDB, Capacitor Filesystem), nháp của mốc 3, "Mở bằng"
npm run e2e:m4:preview  # trên bản build: cài được, chạy offline, CSP chặn request ra ngoài, "Mở bằng"
npm run test:edit    # sửa chữ có sẵn: 6 kiểu PDF (Chromium, LibreOffice, Helvetica, LaTeX, trang xoay, chữ ẩn/Form)
                     # + tệp mã hóa → kiểm độc lập bằng qpdf, Poppler, MuPDF (chữ cũ hết, phần còn lại không đổi điểm ảnh nào)
npm run e2e:edit     # sửa chữ trong app: thanh sửa, báo phông, giữ góc xoay/mức phóng, hoàn tác, nháp, xuất, điện thoại
npm run e2e:scan     # quét: 7 ảnh chụp giả lập (góc, tỉ lệ A4, độ sáng giấy, màu dấu), PDF, luồng trong app, camera trên điện thoại
npm run e2e:share    # bàn tay (kéo trang, Space, chú thích vẫn chọn/kéo được), chia sẻ (tệp = tệp xuất), in (trang in so với
                     # tệp xuất bằng MuPDF: số trang, khổ, chiều, 300 dpi, hình), hủy in, điện thoại, iPhone (in qua AirPrint)
                     # + xuất thành ảnh: PNG, JPEG, TIFF, WebP so với MuPDF vẽ tệp xuất (kích thước, dpi, xám, LZW), dừng giữa chừng
npm run test:images  # bộ ghi TIFF đọc lại bằng libtiff và tifffile, dpi trong PNG/JPEG, hạ dpi cho khổ lớn, tên tệp ảnh
scripts/regress.sh [preview]     # mọi bộ e2e lần lượt (dev, hoặc bản build trên :4173)
node scripts/smoke-desktop.cjs   # bản desktop thật (Linux, WebDriver): mở bằng đối số, nháp trong thư mục app,
                                 # quyền tệp, một cửa sổ, hộp thoại Mở/Lưu, chia sẻ qua vỏ Rust,
                                 # xuất ảnh vào thư mục chọn trong hộp thoại
node scripts/perf-big.cjs        # tệp 50 MB trên màn hình điện thoại, CPU chậm 4× (cần `make_big_fixture.py` trước)
bash scripts/check_android_java.sh  # biên dịch plugin Android với android.jar
npm run fixtures     # tạo lại tệp mẫu (sample.pdf, long-300.pdf, ảnh, edit-text.pdf, ảnh quét giả lập)
python3 scripts/make_fonts.py    # dựng lại phông ezPDF Sans VN từ Noto Sans (Latin, Việt, Kirin, Hy Lạp)
```

Script kiểm thử cần: Node 22+, Python 3 với `pymupdf`, `pikepdf`, `Pillow`, `numpy`, `scipy`, `python-docx`, `tifffile` và `imagecodecs`, `qpdf`, `poppler-utils`, Playwright với Chromium. Tạo lại `edit-text.pdf` cần thêm LibreOffice, ReportLab và pdfLaTeX.

## Cấu trúc

```
src/
  app/                 UI (React)
    App.tsx              engine + plugin + cấu hình công cụ
    Workspace.tsx        bố cục 3 cột / điện thoại, phím tắt, trạng thái trống-lỗi-đang mở
    top-bar.tsx          thanh công cụ (desktop) và thanh dưới (điện thoại)
    side-panels.tsx      thumbnail + tìm kiếm
    properties-panel.tsx thuộc tính theo đối tượng đang chọn
    tool-hint.tsx        dải gợi ý công cụ
    thumb-overlay.tsx    vẽ annotation lên thumbnail
    page-rotation.ts     xoay trang (G7): đổi góc trong store, ghi /Rotate khi xuất
    draft-list.tsx       danh sách bản nháp ở màn hình trống
    use-document-session.ts  mở tệp, bản nháp tự lưu, cờ "chưa xuất", xuất, mở lại sau khi sửa chữ (giữ góc nhìn), hoàn tác bằng bản chụp
    text-edit.tsx        công cụ Sửa chữ có sẵn: khung các dòng trên trang, thanh sửa, báo phông
    output-actions.tsx   nút Chia sẻ (menu trên Windows), In, menu ⋮ trên điện thoại, thông báo, tiến độ in
    print/print-pages.ts in trong trình duyệt và desktop: ảnh trang 300 dpi, mỗi khổ một trang CSS, window.print
    to-images/           Xuất thành ảnh: hộp thoại (ImagesDialog.tsx), tạo ảnh từng trang (to-images.ts), định dạng, dpi, tên tệp (plan.ts)
    scan/ScanDialog.tsx  màn quét: căn 4 góc (kính lúp), xem trang, Tạo PDF
    images/              ảnh và chữ ký: chuẩn bị ảnh, đặt lên trang, hộp thoại chữ ký, vá lỗi stamp (G10–G12)
    storage/             bản nháp (tệp gốc + trạng thái), chữ ký đã lưu, qua lớp lưu trữ của nền tảng
  platform/            phần khác nhau giữa 3 nền tảng, sau một interface (types.ts)
    web.ts               ô chọn tệp, tải về, launchQueue của PWA, Web Share, in qua bảng chia sẻ trên iPhone, xin giữ bản nháp
    tauri.ts             hộp thoại hệ thống, tệp từ dòng lệnh / "Mở bằng", lưu nháp trước khi đóng cửa sổ, chia sẻ qua vỏ Rust, ảnh vào thư mục chọn
    android.ts           plugin EzFiles: Storage Access Framework, tệp được mở bằng / chia sẻ sang, chia sẻ đi, in, ảnh vào MediaStore
    storage/             StorageBackend + 3 adapter: idb.ts (web), tauri-fs.ts, capacitor-fs.ts (chung file-tree.ts)
    viewer/Viewer.tsx    trang ảo hoá, các lớp render/tìm/chọn chữ/annotation
    viewer/free-text.tsx ô chữ: vẽ bằng bộ ngắt dòng của bước xuất, sửa, tự giãn
    viewer/touch-guard.ts  cảm ứng: chụm hai ngón chỉ để phóng, một ngón chỉ để cuộn ở chế độ Chọn
    viewer/hand.ts       bàn tay: chế độ kéo trang, công cụ nghỉ (bàn tay / chọn), giữ Space để kéo
  scan/                quét: detect.ts (tìm tờ giấy), geometry.ts (phối cảnh, tỉ lệ thật), process.ts (làm phẳng, làm sáng),
                       jpeg-pdf.ts (PDF từ JPEG), scan.worker.ts
  components/ui/       component shadcn/ui (chép vào, sửa được)
  engine/
    text-layout.ts     ngắt dòng + vị trí dòng, dùng chung cho màn hình và bước xuất
    geometry.ts        giãn ô giữ nguyên mép trên, kể cả khi ô bị xoay
    config.ts          WASM và phông tự host, không dùng CDN
    vn-freetext-export.ts  bước xuất: vẽ lại appearance FreeText bằng phông tiếng Việt nhúng, ghi /Rotate
    appearance-pdf.ts      dựng trang PDF nguồn chứa bản vẽ + phông CID nhúng
    pdf-incremental.ts     đọc xref + incremental update (bổ sung /Fields của AcroForm)
    font-metrics.ts        metric TrueType + ngắt dòng
    export.worker.ts       PDFium thứ hai trong Web Worker: bước xuất, phiên sửa chữ có sẵn, dựng ảnh trang để in và để xuất ảnh
    tiff-write.ts          bộ ghi TIFF (LZW, predictor, nhiều trang); image-meta.ts: dpi trong PNG và JPEG
    text-edit.ts           sửa chữ có sẵn: gom dòng, thay đối tượng chữ, chọn phông, đọc lại để kiểm
public/fonts/          ezPDF Sans VN (subset Noto Sans: Latin, Việt, Kirin, Hy Lạp; SIL OFL 1.1, đã đổi tên); metric/: Tinos, Arimo, Carlito (OFL), ezPDF Pagella (GUST) cùng độ rộng chữ với phông của Word
public/icons/, manifest.webmanifest   biểu tượng và manifest của web app
build/                 plugin Vite: service worker (danh sách tệp của bản build), CSP cho bản web
src-tauri/             vỏ desktop: lib.rs (tệp từ dòng lệnh, một cửa sổ), share.rs (bộ nhớ tạm, cửa sổ chia sẻ Windows,
                       hiện tệp trong thư mục), tauri.conf.json, capabilities/
android/               dự án Capacitor: EzFilesPlugin.java (tệp, chia sẻ, in, lưu ảnh), AndroidManifest (mở bằng / chia sẻ, tắt sao lưu)
branding/              SVG gốc của biểu tượng
tests/                 engine-proof.ts, m3-engine-probe.ts, storage-*, fixtures, trang pdf.js để kiểm độc lập
scripts/               e2e*.cjs, smoke-desktop.cjs, perf-big.cjs, verify_*.py, inspect_export.py, make_*.py
docs/                  đánh giá engine, kết quả mốc 1–4, sửa chữ và quét (07), kéo trang, chia sẻ, in (08), web app trên iPhone (09),
                       sắp xếp trang (10), tệp Word (11), xuất thành ảnh (12), kế hoạch, bằng chứng
```

## Nguyên tắc kiến trúc

- **Một nguồn trạng thái:** annotation state và history của EmbedPDF. UI chỉ đọc state và gọi lệnh, không giữ bản sao riêng.
- **Hệ tọa độ trang PDF:** annotation lưu theo point, gốc trên-trái của trang chưa xoay (`normalizeRotation: true`). Zoom và xoay chỉ là phép biến đổi khi hiển thị.
- **Tệp gốc giữ nguyên:** “Xuất PDF” luôn tạo tệp mới `… (ezPDF).pdf`. Bản nháp (tệp gốc + trạng thái) tự lưu trên máy, tách hẳn khỏi tệp xuất.
- **Một mã nguồn, ba vỏ:** mọi khác biệt giữa web, desktop và Android nằm trong `src/platform/`. Phần còn lại của app không biết mình đang chạy ở đâu.
- **Không gửi gì ra ngoài:** bản web và desktop có Content-Security-Policy chỉ cho nói chuyện với chính app. Bản desktop chỉ được đọc/ghi thư mục nháp của nó và đúng tệp người dùng chọn. Bản Android tắt sao lưu đám mây cho dữ liệu của app.
- **Không làm giả:** nút nào chưa chạy được đến cuối luồng thì không xuất hiện.
- `@embedpdf/*` được **ghim đúng 2.15.1**. Trước khi nâng cấp, xem `docs/01-danh-gia-engine.md` mục 4.
