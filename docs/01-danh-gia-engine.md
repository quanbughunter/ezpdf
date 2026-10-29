# 01 · Đánh giá engine (kiểm tra ngày 28/10/2026)

## 1. Phiên bản và giấy phép

| Thành phần | Bản dùng | Kênh | Giấy phép | Vai trò trong ezPDF |
|---|---|---|---|---|
| EmbedPDF (`@embedpdf/*`) | **2.15.1** (ghim cứng) | npm `latest` | MIT (nhánh `v2`) | **Engine chính** |
| EmbedPDF 3.x | 3.0.0-next.17 | npm `next` | Apache-2.0 | Theo dõi, chưa dùng (chưa stable) |
| PDFium WASM (`@embedpdf/pdfium`) | 2.15.1 | npm | MIT + BSD-3 (PDFium) | Lõi đọc/vẽ/ghi PDF, chạy trong Web Worker |
| pdf.js (`pdfjs-dist`) | 6.4.299 | npm `latest` | Apache-2.0 | Chỉ dùng làm **viewer độc lập để kiểm thử** |
| MuPDF.js (`mupdf`) | 1.28.1 | npm | **AGPL-3.0** | Loại khỏi app (ràng buộc giấy phép); chỉ dùng PyMuPDF trong script kiểm thử |
| pdf-lib | 1.17.1 (2022) / fork `@cantoo/pdf-lib` 2.11.1 | npm | MIT | Không cần — bản gốc đã ngừng cập nhật |
| Stirling-PDF | `main` | GitHub | MIT lõi; `app/proprietary`, `app/saas`, `engine/` theo giấy phép riêng | Chỉ tham khảo luồng thao tác, **không chép mã** |
| shadcn/ui | `main` | GitHub | MIT | Mốc 2: component, bố cục panel |
| lucide (`lucide-react`) | 1.63.0 | npm | ISC | Icon |
| React / Vite / Tailwind | 19.3.1 / 8.3.5 / 4.3.3 | npm | MIT | Khung UI |
| Phông ezPDF Sans VN | subset từ Noto Sans | — | SIL OFL 1.1 | Đổi tên vì Noto Sans có Reserved Font Name |

Lưu ý: nhánh `main` của repo EmbedPDF hiện là 3.x (Apache-2.0, cấu trúc package khác hẳn). Bản stable trên npm vẫn là 2.x, mã nguồn ở nhánh `v2`.

## 2. Bảng tính năng ↔ API thực có

Ký hiệu: ✅ có và đã chạy thử · 🟡 có API nhưng còn lỗ hổng · ❌ không có

| Tính năng bản đầu | EmbedPDF 2.15.1 | pdf.js 6.4.299 | Kiểm chứng trong mốc 1 |
|---|---|---|---|
| Mở file local | ✅ `openDocumentBuffer` | ✅ | ✅ e2e |
| Render theo viewport, tác vụ nặng trong worker | ✅ scroll + render + tiling; PDFium chạy trong Web Worker | ✅ | ✅ e2e |
| Thumbnail | ✅ `plugin-thumbnail` | ✅ (trong viewer mẫu) | Mốc 2 |
| Tìm kiếm | ✅ `plugin-search`, `searchInPage` | ✅ | ✅ dùng để đặt highlight trong engine-proof |
| Chọn chữ | ✅ `plugin-selection` | ✅ text layer | ✅ (highlight tạo từ vùng chọn) |
| Zoom | ✅ `plugin-zoom` | ✅ | ✅ 6 mức zoom |
| Xoay hiển thị | ✅ `plugin-rotate` | ✅ | ✅ |
| Xoay trang lưu vào file | 🟡 WASM có `FPDFPage_SetRotation`, engine 2.x không mở ra | 🟡 | Mốc 3 (làm ở bước xuất) |
| Highlight | ✅ công cụ `highlight` | ✅ | ✅ |
| Ghi chú (sticky note) | ✅ công cụ `textComment` | ✅ | Mốc 2 |
| Thêm chữ tiếng Việt (FreeText) | 🟡 tạo được, nhưng **appearance chỉ dùng Helvetica/WinAnsi → mất dấu khi xuất** | 🟡 **không tạo appearance** khi có ký tự ngoài WinAnsi | ✅ sau khi ezPDF bổ sung bộ xuất riêng |
| Ảnh / ảnh chữ ký | ✅ Stamp từ PNG/JPEG, giữ kênh alpha | ✅ | ✅ engine-proof (PNG trong suốt) |
| Chọn, di chuyển, resize | ✅ | ✅ | ✅ di chuyển sau khi mở lại |
| Undo/redo | ✅ `plugin-history` | ✅ (trong editor) | ✅ |
| Xuất PDF | ✅ `saveAsCopy` | ✅ `saveDocument` | ✅ |
| Mở lại, sửa tiếp | ✅ đọc lại annotation, giữ cả dữ liệu riêng (`EPDFCustom`) | 🟡 | ✅ |
| Redaction thật (xóa nội dung) | 🟡 `redactTextInRects` / `applyRedaction` — phải kiểm riêng phần ảnh, vector | ❌ | Đánh giá riêng (mốc 5) |
| Sửa chữ có sẵn trong trang | ❌ (`insertText`/`replaceText` chỉ là annotation đề xuất sửa) | ❌ | Không làm giả |
| OCR | ❌ | ❌ | Cần engine riêng, đánh giá riêng |

## 3. Chọn engine chính: EmbedPDF 2.15.1

Lý do:

1. Gần như mọi tính năng bản đầu đã có sẵn dưới dạng plugin không kèm UI (headless). Nhờ vậy ezPDF tự dựng giao diện theo thiết kế riêng mà không phải sửa viewer có sẵn. Plugin có sẵn hook React.
2. Cùng một lõi PDFium dùng cho hiển thị, chỉnh sửa và ghi file, nên thứ người dùng thấy trên màn hình trùng với thứ được ghi ra.
3. Có sẵn history, annotation state và cơ chế commit: đây chính là **nguồn trạng thái chỉnh sửa duy nhất**, ezPDF không phải tự dựng lại.
4. PDFium chạy trong Web Worker. Mã chạy được trên trình duyệt, WebView Android và WebView desktop.
5. Giấy phép MIT ở bản 2.x, và Apache-2.0 nếu sau này lên 3.x.

pdf.js mạnh về hiển thị, nhưng phần editor gắn chặt vào viewer mẫu của nó. Khi lưu FreeText tiếng Việt, pdf.js trả về `null` cho appearance (mã `FreeTextAnnotation.createNewAppearanceStream`: `encoded.length > 1 → return null`). Vì vậy ezPDF chỉ dùng pdf.js làm viewer độc lập trong kiểm thử.

## 4. Khoảng trống của engine và cách xử lý

| # | Khoảng trống (EmbedPDF 2.15.1) | Bằng chứng | Xử lý trong ezPDF |
|---|---|---|---|
| G1 | Appearance của FreeText chỉ có phông chuẩn 14, mã hóa WinAnsi. Các ký tự ắ ặ ơ ư đ ế… **bị bỏ khỏi bản vẽ**: MuPDF đọc ra “Ting Vit có du”. `/Contents` vẫn giữ đúng chữ. | `out/sample/raw.pdf`, `GenerateFreeTextAP` trong PDFium fork | `vn-freetext-export.ts`: khi xuất, vẽ lại appearance bằng phông ezPDF Sans VN nhúng vào file (CIDFontType2, Identity-H, có ToUnicode, nén Flate) |
| G2 | `EPDFAnnot_SetAppearanceFromPage` ở bản 2.x chép nội dung trang nguồn vào AP/N nhưng chuyển resources xuống một form con (`/EPDFWRAP`). Bước sửa đi kèm (`UpdateAppearanceToRect`) chỉ nhận Stamp, nên với FreeText, AP/N tham chiếu tới phông không còn ở đó | Poppler: “Unknown font tag 'FXF1'” | `appearance-pdf.ts` dựng trang nguồn có nội dung chỉ là `q /EPDFWRAP Do Q`, phần vẽ nằm trong form tên `EPDFWRAP`. Nhờ vậy cả hai tầng sau khi chép đều hợp lệ, và **PDFium tự ghi toàn bộ, kể cả mã hóa** khi tệp có mật khẩu chủ sở hữu (đã thử AES-256 và RC4-128) |
| G3 | Bộ sinh appearance tạo `/AcroForm` mà thiếu `/Fields` (bắt buộc theo ISO 32000) | Poppler: “Can't get Fields array” | `pdf-incremental.ts`: thêm một incremental update chỉ bổ sung `/Fields []`. Các giá trị cũ được chép nguyên byte, giữ nguyên số đối tượng, nên vẫn an toàn với tệp mã hóa |
| G4 | Khi mở tài liệu với `normalizeRotation: false` (mặc định của engine), `convertPageRectToDeviceRect` chỉ đổi góc trên-trái nên rect đọc lại trên trang `/Rotate 90` bị lệch | spike: tạo (72,250,380×40), đọc lại (452,250,40×380) | Luôn mở bằng document-manager (`normalizeRotation: true`), rect đọc lại khớp tuyệt đối. Engine-proof kiểm cả 4 kiểu trang |
| G5 | Mặc định tải WASM và phông dự phòng từ jsDelivr, tức là app sẽ ra mạng khi mở file local | Hằng số `DEFAULT_PDFIUM_WASM_URL`, `cdnFontConfig` | Tự host WASM và phông (`engine/config.ts`); e2e khẳng định không có request ra ngoài |
| G6 | `saveAsCopy` chép byte-từng-byte bằng `getValue` | 72 MB → 1,6 giây | Chấp nhận ở bản đầu; tối ưu ở mốc 6 |
| G7 | Không có API lưu góc xoay trang vào file | — | Mốc 3: áp `FPDFPage_SetRotation` ở bước xuất |

Lưu ý: G1–G3 phụ thuộc đúng hành vi của bản 2.15.1, nên các package `@embedpdf/*` được ghim cứng. Khi nâng cấp phải chạy lại `npm run test:engine` và `npm run e2e`. Cách dựng trang nguồn ở G2 vẫn hợp lệ với kiểu wrapper mới của nhánh 3.x, vì form ngoài chỉ gọi `/EPDFWRAP`.
