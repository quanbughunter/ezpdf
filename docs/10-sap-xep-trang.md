# 10 · Sắp xếp trang: thêm, xóa, đổi chỗ, trích, tách (bản 0.7.0)

Tính năng này dùng chung một mã cho Windows, web (cả iPhone) và Android.

Tình huống gợi ra tính năng: quét xong một trang, quên bấm thêm trang mà bấm luôn Tạo PDF. Giờ có hai cách nối tiếp:
- **Quét tiếp vào tài liệu đang mở.** Khi đang mở tài liệu, màn quét có nút **Thêm vào tài liệu này**: các trang vừa quét được nối vào cuối tài liệu, và app chuyển ngay tới trang đầu tiên vừa thêm.
- **Ghép với tệp khác** trong màn Sắp xếp trang.

## Mở màn Sắp xếp trang

- **Máy tính:** nút lưới ô vuông trên thanh công cụ, cạnh nút quét.
- **Điện thoại:** menu ⋮ → **Sắp xếp trang**.

Màn này hiện mọi trang dưới dạng ảnh nhỏ, đúng chiều xoay như trong trình xem. Mọi thao tác chỉ là bản nháp trong màn này. Tài liệu chỉ đổi khi bấm **Áp dụng**. Đóng màn này khi còn thay đổi chưa áp dụng thì app hỏi lại trước.

| Thao tác | Cách làm |
|---|---|
| Chọn trang | Chạm hoặc bấm vào trang; chọn được nhiều trang. **Chọn tất cả / Bỏ chọn**. Ctrl A chọn tất cả. |
| Đổi chỗ | **Kéo thả.** Bằng chuột thì kéo luôn. Trên điện thoại, giữ trang một chút rồi kéo; vuốt nhanh chỉ cuộn danh sách. Một vạch màu xanh chỉ chỗ trang sẽ rơi xuống. Kéo một trang đang chọn thì cả nhóm trang đã chọn đi theo. Cũng có nút **Lên trước / Ra sau** (Alt ← / Alt →). |
| Xoay | **Xoay trái / Xoay phải** các trang đã chọn. |
| Xóa | **Xóa** (phím Delete) các trang đã chọn. Tài liệu phải còn ít nhất một trang. |
| Thêm trang | **Thêm trang ▾** → **Từ tệp PDF khác…** (chọn được nhiều tệp một lúc), **Quét hoặc chụp ảnh…**, hoặc **Trang trắng**. Trang trắng có cùng khổ với trang đứng trước nó. Trang mới vào ngay sau trang được chọn cuối cùng; nếu chưa chọn trang nào thì vào cuối. Dưới mỗi trang lấy từ tệp khác có ghi tên tệp và số trang gốc. |
| Hoàn tác trong màn | Nút **Hoàn tác** hoặc Ctrl Z. |
| Áp dụng | **Áp dụng**: tài liệu thành đúng như lưới đang thấy, rồi app chuyển tới trang đầu tiên có thay đổi. Cả lần sắp xếp là **một bước hoàn tác** (nút ↶ trên thanh công cụ). Bản nháp tự lưu thứ tự mới. |
| Trích ra tệp mới | Các trang đã chọn, theo thứ tự đang thấy, thành một tệp riêng, ví dụ `Hop dong (trang 2, 4).pdf`. Bấm **Lưu** để lưu tệp. Tài liệu đang mở không đổi. |
| Tách tệp | Tách cả tài liệu, theo thứ tự đang thấy, thành nhiều tệp: **Mỗi tệp n trang**, hoặc **Theo khoảng trang** (ví dụ `1-3, 4-6, 7-`; `7-` nghĩa là tới hết). App báo trước sẽ tạo bao nhiêu tệp và từ chối khoảng trang nằm ngoài tài liệu hoặc chồng lên nhau. Lưu từng tệp, hoặc **Lưu tất cả**. Tài liệu đang mở không đổi. |

**Lưu tất cả** lưu lần lượt từng tệp theo cách lưu của mỗi nền tảng:
- trình duyệt: tải về từng tệp; Chrome có thể hỏi một lần có cho tải nhiều tệp không;
- Windows và Android: mỗi tệp một hộp thoại lưu. Bấm Hủy ở một hộp thoại thì dừng ở tệp đó.

Khi màn Sắp xếp trang hay màn quét đang mở, các phím tắt của trình xem (R xoay trang, Delete xóa chú thích, Ctrl Z…) tạm tắt, để không đổi tài liệu ở phía sau.

## Cách làm

Tất cả chạy trong worker PDFium riêng của ezPDF, trên máy (`src/engine/page-ops.ts`). Tài liệu không rời thiết bị.

- **Ảnh nhỏ.** Khi mở màn Sắp xếp trang, tài liệu hiện tại (kèm chú thích) và mỗi tệp thêm vào được mở một lần trong worker. Ảnh nhỏ được vẽ không kèm góc xoay của trang; màn hình xoay ảnh theo góc đang chọn. Ảnh chỉ được vẽ khi trang sắp hiện ra, cái vừa cần thì vẽ trước.
- **Áp dụng: sửa ngay trên tài liệu đang mở.**
  - Trang không còn dùng thì xóa (`FPDFPage_Delete`).
  - Trang từ tệp khác thì chép vào (`FPDF_ImportPagesByIndex`). Một trang của chính tài liệu dùng hai lần thì lần thứ hai cũng là bản chép.
  - Trang trắng thì tạo mới (`FPDFPage_New`).
  - Rồi xếp tất cả theo đúng thứ tự (`FPDF_MovePages`) và ghi góc xoay (`/Rotate`).
  - Vì sửa trên chính tài liệu nên các phần chung của tệp được giữ: ô điền biểu mẫu (AcroForm), mục lục (bookmark), thông tin tệp. Mỗi trang mang theo chú thích của nó.
- **Trích và tách: tệp mới.** Tạo một tài liệu mới rồi chép vào đúng các trang cần. Nhờ vậy tệp chỉ chứa các trang đó và nhỏ gọn. Tệp mới còn được hoàn thiện như khi Xuất PDF: ô chữ tiếng Việt thêm trong ezPDF được vẽ bằng phông nhúng, nên app khác cũng đọc đúng.
- **Hoàn tác.** Ảnh chụp tài liệu dùng để hoàn tác mang theo góc xoay của từng trang. Góc xoay nằm trong trình xem cho tới khi xuất, và sau khi đổi chỗ thì cùng một số thứ tự đã là một trang khác. Vì vậy ↶ và ↷ luôn trả đúng trang với đúng góc.

## Kiểm chứng

Tệp mẫu do `scripts/make_page_fixtures.py` tạo:
- `pages-a.pdf`: 5 trang ghi to “A-1”…“A-5”. A-2 có ghi chú dán, A-3 lưu sẵn `/Rotate 90`, A-4 có một ô điền biểu mẫu, A-5 khổ ngang. Có mục lục trỏ tới trang 1 và trang 4.
- `pages-b.pdf`: 3 trang “B-1”…“B-3”, khổ Letter.

Mọi kết quả đều được đọc lại từ tệp bằng **MuPDF**, một thư viện PDF khác với PDFium, chứ không tin vào màn hình của app: thứ tự trang theo chữ đánh dấu, `/Rotate`, khổ trang, ghi chú; thêm `qpdf --check`.

| Bộ kiểm | Kết quả |
|---|---|
| `npm run test:pages` (PDFium WASM như trong app, chạy trên Node) | **20/20**, gồm: thứ tự theo kế hoạch; góc xoay; trang trắng A4; trang chép từ tệp khác giữ khổ Letter; ghi chú đi theo trang; trang có ô biểu mẫu chuyển lên đầu vẫn điền được; mục lục còn; tệp mới chỉ chứa các trang cần và nhỏ hơn tệp gốc; tách 3 tệp; từ chối kế hoạch sai (không còn trang, trang không có, tệp không có); đảo ngược 300 trang mất dưới 0,1 giây; qpdf không báo lỗi. |
| `npm run e2e:pages` (Chromium, cả luồng trong app) | **27/27** trên dev server và **27/27** trên bản build production. Chi tiết ngay dưới bảng. |

Bộ `e2e:pages` kiểm:
- Ảnh nhỏ đúng chiều xoay: cả trang xoay trong trình xem lẫn trang lưu sẵn 90°.
- Xóa; Lên trước; xoay; thêm từ tệp khác (đúng chỗ, ghi tên tệp); trang trắng (cùng khổ ngang với trang trước); kéo bằng chuột (có vạch chỉ chỗ thả); phím Delete; Hoàn tác trong màn.
- Áp dụng: thứ tự mới, góc xoay đã đặt trong trình xem vẫn đúng trang, ghi chú đi theo A-2. Tệp xuất đọc bằng MuPDF đúng thứ tự, `/Rotate` và khổ trang.
- ↶ trả 5 trang gốc, ↷ lại thứ tự mới. Tải lại trang rồi mở bản nháp: vẫn thứ tự mới.
- Trích (tên tệp theo số trang); tách mỗi 3 trang và **Lưu tất cả** (3 tệp đúng trang); tách theo khoảng (từ chối `9-`, nhận `2, 4-`). Tài liệu đang mở không đổi.
- Thoát khi còn thay đổi thì app hỏi lại. Phím tắt của trình xem tắt khi màn đang mở.
- Quét → **Thêm vào tài liệu này**: thành trang 9, app chuyển tới trang đó; ↶ gỡ ra. Quét ngay trong màn Sắp xếp trang.
- Đang bật công cụ sửa chữ mà sắp xếp trang, rồi sửa một dòng trên trang 1 mới: dòng được sửa, thứ tự mới vẫn giữ.
- Điện thoại: mục trong menu ⋮; chạm để chọn; mọi nút nằm trong màn hình; giữ rồi kéo bằng ngón tay đổi được chỗ, vuốt nhanh thì không; áp dụng xong A-5 thành trang 1.
- Không gửi gì ra ngoài, không có lỗi trên trang.

Thêm `scripts/smoke-desktop.cjs` (bản desktop thật, WebView WebKitGTK trên Linux, **22/22**). Bước mới chạy màn Sắp xếp trang trong vỏ desktop:
- vẽ được ảnh nhỏ;
- tách được tệp;
- áp dụng xong thì bản nháp có đúng thứ tự mới và giữ góc xoay;
- ↶ trả lại 4 trang ban đầu.

Toàn bộ bộ kiểm của bản 0.7.0 (đã gồm bước kiểm thêm sau lần chạy CI đầu tiên, xem dưới):

| Bộ | Dev | Production |
|---|---|---|
| `e2e` | 57/57 | 57/57 |
| `e2e:m3` | 50/50 | 49/49 |
| `e2e:m4` | 14/14 | 22/22 |
| `e2e:edit` | 24/24 | 24/24 |
| `e2e:scan` | 26/26 | 16/16 |
| `e2e:share` | 36/36 | 36/36 |
| `e2e:pages` (mới) | 27/27 | 27/27 |

Cùng đạt: `test:layout`, `test:engine`, `verify`, `test:m3`, `test:storage`, `test:edit`, `test:pages`.

## Rà soát mã độc lập

Một lượt rà soát riêng, không xem lại cách làm ở trên, đọc phần mã mới và tìm ra 9 điểm. Đã sửa cả 9:
1. **Sửa chữ có sẵn đang bật khi áp dụng sắp xếp trang.** Công cụ sửa chữ vẫn giữ bản sao cũ của tài liệu. Sửa một dòng sau đó sẽ đưa thứ tự trang về như cũ, và mất luôn bản đã sắp xếp. Giờ mỗi lần đổi trang, bản sao cũ bị bỏ. Bộ kiểm có thêm bước: bật công cụ sửa chữ, sắp xếp trang, rồi sửa một dòng trên trang 1 mới.
2. **Worker có thể đọc vùng nhớ đã giải phóng.** Lỗi xảy ra khi đóng màn Sắp xếp trang lúc một ảnh nhỏ đang được vẽ. Giờ trang được đóng xong rồi mới nén ảnh.
3. **Tệp trích hoặc tách chưa qua bước hoàn thiện** của Xuất PDF, nên ô chữ tiếng Việt có thể mất dấu trong app khác. Đã sửa.
4. **Bấm ↶ hai lần thật nhanh** có thể làm mất một bước hoàn tác. Giờ mỗi lần chỉ chạy một bước.
5. **Phím Esc:** khi đang đóng menu Thêm trang, Esc không còn đóng luôn cả màn. Esc cũng không có tác dụng khi app đang áp dụng hay đang đọc tệp. Đóng màn giữa lúc đang đọc tệp không còn để lại bản sao trong worker.
6. **Kéo thả:** kéo thật nhanh không còn bị kẹt; khi danh sách tự cuộn, chỗ thả được tính lại.
7. **Hoàn tác trong màn** đôi khi phải bấm hai lần mới có tác dụng. Đã sửa.
8. **Khoảng trang có dấu cách** (`1 - 3`) bị hiểu sai. Đã sửa, và có kiểm riêng (`tests/ranges.test.ts`).
9. Hai lỗi nhỏ ở hàng đợi vẽ ảnh nhỏ và ở bước nạp lại PDFium sau một lần nạp hỏng.

## Lần chạy CI đầu tiên của 0.7.0

CI đỏ ở `e2e:preview`, tức bộ `e2e` chạy trên bản build production. Cùng bộ đó trên dev server thì qua, và trên máy kiểm thì qua cả hai. Lỗi nằm ở app, không ở bộ kiểm.

- **Triệu chứng.** Bộ kiểm bấm “−” ở ô cỡ chữ rồi gõ 16, nhưng cỡ chữ thành 96, mức lớn nhất. Ô chữ to ra che chỗ bước sau định bấm, nên bước sau cũng hỏng theo.
- **Nguyên nhân.** Số trong ô được chép lại từ cỡ chữ thật bằng một bước chạy sau (`useEffect`). Bước chép này đến muộn một nhịp. Trên máy CI bận, nó đến đúng lúc bộ kiểm đã chọn hết chữ trong ô. Số bị thay, chữ hết được chọn, và “16” bị gõ nối vào số cũ thành “1516”, rồi bị giới hạn về 96.
- **Đã sửa** (`src/app/use-draft-text.ts`). Khi người dùng chưa gõ, ô hiện thẳng cỡ chữ thật. Khi họ gõ, ô giữ chữ họ gõ cho đến khi bấm Enter hay rời ô. Không còn bước chép đến muộn, và số mới cũng không đè lên chữ đang gõ.
- **Ô số trang** trên thanh công cụ viết cùng kiểu nên cũng được sửa. Trước đây, đang gõ số trang trong lúc trang còn trôi thì số đang gõ có thể bị thay.
- **Kiểm chứng.** Một kịch bản tái hiện đúng thứ tự trên: bấm “−”, chọn chữ trong ô, rồi gõ trước khi React chạy bước sau. Bản cũ ra 96, bản mới ra 16 cả 5 lần. Bước này giờ nằm trong bộ `e2e`, nên bộ có 57 bước.
- Giả lập CPU chậm (`CPU_SLOWDOWN=4` hay `6`, giờ có cả trong `e2e`) không làm lộ lỗi này, vì nó làm chậm đều mọi thứ trên trang, nên thứ tự các bước không đổi.

## Giới hạn

- **Mục lục trỏ tới trang đã xóa** vẫn còn trong tệp nhưng không còn đúng chỗ (MuPDF đưa về trang 1). Mục lục trỏ tới các trang còn lại vẫn theo đúng trang sau khi đổi chỗ.
- **Trích và tách** tạo tệp mới, nên ô điền biểu mẫu vẫn hiện nhưng không điền tiếp được trong tệp đó. Sắp xếp ngay trên tài liệu thì vẫn điền được.
- Xóa trang ngay trên tài liệu có thể để lại trong tệp những phần chỉ trang đã xóa dùng (ví dụ ảnh), nên tệp có thể không nhỏ đi bao nhiêu. Muốn tệp gọn thì dùng Trích ra tệp mới.
- Tệp có mật khẩu chưa thêm vào được.
- Chưa kiểm trên máy thật: Windows, Android, iPhone. Trên Windows và Android, Thêm từ tệp PDF dùng hộp thoại của hệ điều hành và chọn được một tệp mỗi lần.

## Tự kiểm

1. Mở một PDF nhiều trang → Sắp xếp trang. Kéo một trang sang chỗ khác, xoay một trang, xóa một trang, rồi Áp dụng. Thử ↶ rồi ↷.
2. Thêm trang → Từ tệp PDF khác, rồi Áp dụng và Xuất PDF. Mở tệp xuất bằng một app khác để xem thứ tự.
3. Chọn 2 trang → Trích ra tệp mới → Lưu.
4. Tách tệp → Mỗi tệp 1 trang → Lưu tất cả.
5. Quét một trang → Tạo PDF. Bấm quét lần nữa → quét thêm một trang → **Thêm vào tài liệu này**.
6. Trên điện thoại: giữ một trang chừng nửa giây rồi kéo.
