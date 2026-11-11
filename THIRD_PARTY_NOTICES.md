# Thành phần của bên thứ ba đi kèm ứng dụng

Danh sách đầy đủ các thư viện nằm trong `package.json` và `src-tauri/Cargo.toml`. Phông chữ đi kèm có giấy phép riêng ở `public/fonts/NOTICE.md`.

## Nhận dạng chữ (OCR, bản desktop từ 0.9.0)

Các tệp sau được chép nguyên vẹn vào `dist/ocr/` của bản desktop (`build/ocr-assets.ts`):

| Tệp | Từ | Giấy phép |
|---|---|---|
| `worker.min.js` | tesseract.js 7.0.0 (https://github.com/naptha/tesseract.js) | Apache-2.0 |
| `tesseract-core-simd-lstm.js`, `.wasm`; `tesseract-core-lstm.js`, `.wasm` | tesseract.js-core 7 (https://github.com/naptha/tesseract.js-core): Tesseract 5 (Apache-2.0) và Leptonica (giấy phép kiểu BSD) dịch sang WebAssembly | Apache-2.0 |
| `vie.traineddata.gz` | Mô hình tiếng Việt của tessdata_best (https://github.com/tesseract-ocr/tessdata_best), bản số nguyên, qua gói `@tesseract.js-data/vie` 1.0.0 | Apache-2.0 (mô hình); MIT (gói npm) |

Văn bản giấy phép Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0

Bề rộng chữ Times New Roman dùng để tính cỡ chữ (`src/ocr/times.ts`) là số đo lấy từ phông Liberation Serif (SIL Open Font License 1.1), phông có cùng số đo với Times New Roman. Ứng dụng không mang theo tệp phông này.
