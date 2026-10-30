# 09 · Web app trên iPhone (bản 0.6.1 → 0.7.0)

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

## Sửa thêm trong 0.6.1: trang bị kéo về chỗ cũ

Lần chạy CI đầu tiên của 0.6.1 bị đỏ ở `e2e:edit`. Lỗi nằm ở app, không ở bộ kiểm.
- Sau khi lưu một dòng sửa, app mở lại tài liệu rồi đưa trang về đúng chỗ đang đọc. Bước này làm hơi chậm, vì phải chờ khung xem có kích thước.
- Trên máy chậm (máy CI, hoặc điện thoại), nếu người dùng đã kịp sang trang khác thì bước đưa về này kéo họ ngược lại chỗ cũ.
- Bộ kiểm cũng có lỗi riêng: nó chỉ chờ ô số trang hiện đúng số vừa gõ, chứ không chờ trang đó thực sự hiện ra.

Đã sửa:
- **App** (`use-document-session.ts`): nếu trong lúc chờ người dùng đã cuộn, gõ phím hay chạm, chỗ họ đang đứng được giữ nguyên.
- **Bộ kiểm:** chuyển trang thì chờ đến khi trang đó nằm giữa khung xem. `CPU_SLOWDOWN=4 node scripts/e2e-edit.cjs` chạy với CPU chậm 4 lần, để giả lập máy chậm. Bộ này đạt 24/24 ở tốc độ thường, chậm 4 lần và chậm 6 lần.

## Bản 0.6.2: thanh công cụ và quét trên iPhone

Thử trên iPhone 15 Pro Max (30/10) thấy hai lỗi:
- thanh công cụ sát mép trên và bị mờ;
- quét: chụp xong load lâu, không thấy bước căn góc đúng, bấm tiếp thì ra cả ảnh.

### Thanh công cụ

Trong web app trên màn hình chính, iOS làm mờ vài điểm ảnh trên cùng của trang, ngay dưới thanh trạng thái. Thanh công cụ nằm đúng chỗ đó.

Đã sửa (`src/styles.css`): chỉ khi là Safari iOS (`-webkit-touch-callout`) chạy ở chế độ web app (`display-mode: standalone`), cả app lùi xuống 16 px. Dải trống phía trên cùng màu với thanh công cụ, nên phần mờ rơi vào dải đó chứ không đè lên nút. Màn quét cũng lùi theo.

Trình duyệt máy tính, Android và Safari thường không đổi. Đã kiểm ở cỡ màn iPhone 15 Pro Max: thanh công cụ xuống đúng 16 px và trang không bị cuộn thừa.

### Quét: ba nguyên nhân

1. **Load lâu.** Ảnh được giải mã trong worker bằng `createImageBitmap` kèm lệnh thu nhỏ. Safari bỏ qua lệnh thu nhỏ, nên ảnh 12–24 megapixel đi nguyên cỡ vào bước tìm mép.
2. **Ảnh nằm ngang.** Safari không xoay ảnh theo EXIF ở bước đó, trong khi ảnh hiện trên màn hình thì đã xoay.
3. **Ra cả ảnh: bộ tìm mép thua.** Đây là nguyên nhân chính. Trong ảnh thử, tờ đơn nằm đè lên một tờ khác. Tờ dưới lộ ra ở mép trên và mép phải. Nền là khăn hoa văn có ô màu be gần như giấy. Bước tìm mép cũ lấy đường viền của vùng sáng, nên thấy hai tờ như một khối không phải tứ giác, và trả về cả ảnh. Chạy lại ảnh đó trên Chromium cũng ra đúng như vậy, nên lỗi không riêng của Safari.

### Đã sửa

- **Giải mã ảnh trên trang** (`scan-client.ts`): dùng đúng bộ giải mã của thẻ `<img>` hiện ảnh, nên chiều xoay EXIF khớp với ảnh đang kéo góc, và mở được cả HEIC. Ảnh được thu nhỏ theo từng nửa một trước khi vào worker: 512 px để tìm mép, tối đa 3200 px để cắt trang.
- **Cách tìm thứ hai: bốn cạnh thẳng** (`src/scan/edges.ts`):
  - Tìm các đường thẳng bằng biến đổi Hough. Ứng viên là mép giấy với nền, và trong vùng giấy là bậc sáng giữa hai tờ giấy: tờ trên đổ một vệt bóng nhạt lên tờ dưới.
  - Chữ và đường kẻ in trên giấy bị loại: phía tối của chữ là mực, chữ thì lổn nhổn theo chiều dọc mép, đường kẻ thì hai bên đều trắng như nhau.
  - Mỗi bộ bốn đường tạo thành một tứ giác. Tứ giác hợp lệ khi mỗi cạnh bám mép ít nhất 60 % chiều dài và giấy phủ ít nhất 85 % diện tích bên trong.
  - Điểm của tứ giác tính theo diện tích, độ sát của các cạnh với mép thật, và bị trừ khi một góc nằm ngoài giấy hoặc dọc một cạnh có dải của tờ khác.
  - Giấy hơi cong vẫn tìm được: cạnh được phép lệch 2 % khỏi đường thẳng, và dây cung của đường viền cũng được thử.
- **Chọn kết quả:** cách cũ (theo đường viền) vẫn được dùng khi cả hai cách cho cùng một tứ giác, hoặc khi đường viền không chứa dải của tờ khác. Cách mới quyết định khi đường viền yếu, hoặc khi có dải của tờ khác dọc một cạnh.
- **Ảnh cháy sáng:** nếu ảnh cháy sáng làm mất vệt bóng giữa hai tờ, app vẫn đặt 4 góc ở chỗ gần đúng nhất làm điểm xuất phát, nhưng báo “Không thấy rõ mép giấy” để người dùng kiểm lại.
- **Tỉ lệ trang** (`geometry.ts`): khi chỉ nghiêng máy theo một chiều, không đo được tiêu cự từ ảnh. Trước đây, nhích một góc 2 px có thể làm tỉ lệ nhảy từ 0,76 sang 0,41. Giờ app dùng tiêu cự của camera chính điện thoại (26 mm tương đương). Dưới các xê dịch 3 px, tỉ lệ A4 lệch tối đa 0,01.
- Màn căn góc hiện “Đang tìm mép giấy…” trong lúc chờ.

### Kiểm chứng

- **Hai ảnh tổng hợp mới** trong `tests/fixtures/scan`:
  - `photo-stack.jpg`: tờ trên tờ, tờ dưới lộ hai cạnh, có bóng của tờ trên, khăn hoa văn.
  - `photo-tapestry.jpg`: khăn hoa văn có ô màu be.
  - Bảy ảnh cũ giữ nguyên từng byte.
- **`npm run e2e:scan`: 26/26** (trước là 24/24).
  - `photo-stack`: góc lệch 0,1 % đường chéo, đúng tờ trên, ra A4.
  - `photo-tapestry`: góc lệch 0,1 %.
  - Ảnh lưu nằm ngang (EXIF) giờ ra A4 ổn định.
- **Ảnh thật bạn gửi** chỉ dùng trên máy phát triển, không đưa vào repo vì repo đang công khai. App bắt đúng tờ trên, gồm cả mép dưới cong, trong mọi trường hợp đã thử:
  - ảnh thu nhỏ bằng 4 cách khác nhau, có cả cách thu nhỏ của chính Chromium;
  - lật ngang, lật dọc, xoay 90°;
  - làm mờ, tối đi, ám vàng, thêm nhiễu, nén JPEG mạnh.
  - Riêng khi làm sáng thêm 12 % đến mức giấy cháy trắng, vệt bóng giữa hai tờ mất hẳn: app đặt góc theo cả hai tờ và báo “Không thấy rõ mép giấy”.
- **Không có giấy** (chỉ có khăn, bàn, gỗ) và **trang phủ kín khung ảnh**: app không bịa ra tứ giác, mà đề xuất cả ảnh.
- **Thời gian tìm mép** trên máy phát triển: 0,1–0,3 giây mỗi ảnh.

**Chưa kiểm:** camera thật của iPhone. Hãy thử lại đúng cảnh đã chụp: hai tờ chồng nhau trên khăn.

## Bản 0.7.0: thanh công cụ vẫn mờ, sửa lần hai

Sau bản 0.6.2, phần quét trên iPhone đã chạy tốt, nhưng thanh công cụ vẫn bị mờ ở phía trên. Đẩy thanh công cụ xuống 16 px không giúp được gì.

**Nguyên nhân.** Safari 26 tự tô dải dưới thanh trạng thái dựa vào nội dung trang:
- Nếu trang có một thanh **cố định** (`position: fixed` hoặc `sticky`), rộng hết màn hình và **chạm sát mép trên**, Safari tô dải đó bằng đúng màu của thanh, màu đặc.
- Nếu không có thanh như vậy, Safari phủ một lớp mép mềm, làm mờ phần trên cùng của trang. Thanh công cụ của ezPDF không cố định, nên bị mờ.

**Đã sửa** (`src/app/top-bar.tsx`, `src/styles.css`):
- Thanh công cụ giờ là thanh `sticky` ở sát mép trên. Trang không có gì để cuộn qua thanh này, nên trên mọi nền tảng nó vẫn đứng yên như cũ.
- Trên web app iPhone, khoảng lùi 16 px nằm bên trong thanh công cụ (thanh cao hơn ở phía trên), chứ không còn là khoảng trống phía trên thanh. Nhờ vậy thanh vẫn chạm mép trên và nút cách xa thanh trạng thái hơn.
- Màn quét và màn Sắp xếp trang vốn đã là lớp phủ cố định chạm mép trên.

**Đã kiểm** ở cỡ màn iPhone 15 Pro Max:
- Bình thường: thanh công cụ ở sát mép trên, cao 48 px như trước.
- Khi giả lập web app iPhone: thanh vẫn sát mép trên, cao 64 px.
- Trang không bị cuộn thừa trong cả hai trường hợp.

Việc Safari thật tô màu đặc thay vì làm mờ thì chỉ kiểm được trên iPhone. Cách Safari 26 chọn màu mép trên được mô tả ở [README của bleedblend](https://cdn.jsdelivr.net/npm/bleedblend@2.3.0/README.md) và [WebKit bug 305546](https://bugs.webkit.org/show_bug.cgi?id=305546).

## Tự kiểm trên iPhone

1. Mở trang bằng Safari, rồi Thêm vào MH chính. Thanh công cụ không còn bị mờ: dải dưới thanh trạng thái cùng màu trắng với thanh công cụ. Mở từ biểu tượng, bật chế độ máy bay: app vẫn mở được.
2. Chọn một PDF từ app Tệp. Thêm một ô chữ tiếng Việt, tô sáng một dòng, ký.
3. Đóng hẳn app rồi mở lại. Danh sách Bản nháp còn tài liệu vừa sửa.
4. **Chia sẻ** → Zalo hoặc Telegram. Người nhận thấy đủ chú thích.
5. **⋮ → In tài liệu**: bảng chia sẻ mở ra, chọn In. Màn hình in của iOS hiện tài liệu; chọn máy in AirPrint hoặc chụm hai ngón trên ảnh xem trước để ra PDF.
6. **Xuất PDF**: tệp có trong Tệp → Tải về.
7. **Quét tài liệu** bằng camera, rồi Tạo PDF. Thử cả hai tờ chồng lên nhau trên khăn: 4 góc phải nằm trên tờ trên cùng.
