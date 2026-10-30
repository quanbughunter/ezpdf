# 09 · Web app trên iPhone (bản 0.6.1)

Trên iPhone và iPad, ezPDF chạy dưới dạng **web app**. Đó là bản web, được thêm vào màn hình chính, mở như một app và chạy được khi không có mạng. Bản này dùng chung mã với bản trình duyệt.

## Địa chỉ

**https://quanbughunter.github.io/ezpdf/**

Mỗi lần push lên nhánh `main`, CI (`.github/workflows/build.yml`) chạy:
1. Job `web` dựng bản web và chạy toàn bộ bộ kiểm trên chính bản dựng đó.
2. Nếu job `web` đạt, job `pages` đưa đúng bản đó lên GitHub Pages.

Job `web` đỏ thì trang không đổi, vẫn là bản trước.

Cài đặt một lần trên GitHub:
1. Repo ezpdf → Settings → General → Danger Zone → **Change visibility → Public**. GitHub Pages miễn phí chỉ dùng được với repo công khai.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push một lần, hoặc vào tab Actions → build → Re-run. Xong job `pages` là trang có địa chỉ ở trên.

Khi repo công khai, mọi người xem được mã nguồn, các tệp mẫu và lịch sử commit, gồm cả email ghi trong commit. Tài liệu của người dùng không bao giờ nằm trong repo hay trên trang: app chỉ xử lý tệp trên máy đang dùng.

## Cài lên iPhone

1. Mở địa chỉ trên bằng **Safari**.
2. Bấm nút Chia sẻ (ô vuông có mũi tên) → **Thêm vào MH chính** → Thêm.
3. Từ giờ mở ezPDF bằng biểu tượng trên màn hình chính. App chạy toàn màn hình và không cần mạng.

**Cập nhật.** Bản mới được tải về ngầm. Nó chỉ thay bản cũ sau khi đóng hẳn app: vuốt app ra khỏi danh sách đa nhiệm rồi mở lại.

Cần iOS 16.4 trở lên.

## Làm được gì trên iPhone

| Việc | Trên iPhone |
|---|---|
| Mở PDF | Nút **Chọn tệp PDF** mở app Tệp (iCloud Drive, Trên iPhone, Tải về…). |
| Quét tài liệu | Mở camera để chụp, hoặc chọn ảnh có sẵn. |
| Ghi chú, tô sáng, ảnh, chữ ký, sửa chữ có sẵn | Như trên Android. Chạm để chọn, một ngón để cuộn, hai ngón để phóng. |
| Bản nháp | Tự lưu trong app. App xin iOS giữ dữ liệu lâu dài (persistent storage, có từ iOS 17), để Safari không xóa bản nháp sau một thời gian không dùng. Có quyết định cuối cùng vẫn là iOS, nên làm xong vẫn nên Xuất PDF. |
| Xuất PDF | Safari hỏi tải về, tệp vào thư mục Tải về trong app Tệp. |
| Chia sẻ | Bảng chia sẻ của iOS: Zalo, Telegram, Mail, Tin nhắn, AirDrop, Lưu vào Tệp… |
| In | Mở bảng chia sẻ với tệp PDF. Chọn **In** để in qua AirPrint: in thẳng tệp PDF nên chữ sắc như bản gốc. Ở web app trên màn hình chính, `window.print()` từng không chạy ổn trên iOS, nên app không dùng nó trên iPhone. |

## Giới hạn so với app thật

- **Không mở thẳng từ app khác được.** iOS không cho web app nhận tệp, nên “Mở bằng ezPDF” từ Zalo, Mail hay Tệp không có. Cách làm: trong app kia chọn Lưu vào Tệp, rồi mở trong ezPDF bằng Chọn tệp PDF.
- **Tệp rất lớn** (hàng chục MB, hàng trăm trang) có thể làm iOS đóng app, vì Safari giới hạn bộ nhớ cho mỗi trang web chặt hơn Android.
- Bộ kiểm tự động chạy trên Chromium, có giả lập iPhone cho phần In (`npm run e2e:share`). **Safari thật trên iPhone chưa được kiểm**: cần thử bằng danh sách dưới đây.

## Đã kiểm

- `npm run e2e:share`: **36/36** trên dev server và trên bản build production. Hai điểm mới:
  - Giả lập Safari iPhone: bấm In thì tệp PDF đúng tên vào bảng chia sẻ, kèm lời dặn chọn “In”, và không gọi `window.print()`.
  - Web app xin trình duyệt giữ bản nháp.
- Bản build đặt dưới đường dẫn con `/ezpdf/`, đúng như trên GitHub Pages: trang mở và mở được tài liệu. Service worker nhận phạm vi `/ezpdf/`. Ngắt mạng rồi tải lại, app vẫn mở. Không có lỗi trên trang.
- Các bộ còn lại không đổi, đều đạt:

| Bộ | Dev | Production |
|---|---|---|
| `e2e` | 56/56 | 56/56 |
| `e2e:m3` | 50/50 | 49/49 |
| `e2e:m4` | 14/14 | 22/22 |
| `e2e:edit` | 24/24 | 24/24 |
| `e2e:scan` | 24/24 | 16/16 |

## Tự kiểm trên iPhone

1. Mở trang bằng Safari, rồi Thêm vào MH chính. Mở từ biểu tượng, bật chế độ máy bay: app vẫn mở được.
2. Chọn một PDF từ app Tệp. Thêm một ô chữ tiếng Việt, tô sáng một dòng, ký.
3. Đóng hẳn app rồi mở lại. Danh sách Bản nháp còn tài liệu vừa sửa.
4. **Chia sẻ** → Zalo hoặc Telegram. Người nhận thấy đủ chú thích.
5. **⋮ → In tài liệu**: bảng chia sẻ mở ra, chọn In. Màn hình in của iOS hiện tài liệu; chọn máy in AirPrint hoặc chụm hai ngón trên ảnh xem trước để ra PDF.
6. **Xuất PDF**: tệp có trong Tệp → Tải về.
7. **Quét tài liệu** bằng camera, rồi Tạo PDF.
