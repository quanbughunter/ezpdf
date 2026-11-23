# 15 · Bộ lọc màu khi quét, in không còn ngày giờ và địa chỉ (bản 0.9.6)

Theo yêu cầu:

> “nếu in ra thì trên giấy tự động xuất hiện thêm ngày giờ ở góc trên trái, tên file ở góc trên phải và tauri.local.host ở góc dưới trái. sửa giúp tôi lỗi này nhé.”

> “nâng cấp thêm tính năng scan: thêm bộ lọc màu. bộ lọc màu mà tự động bỏ được hết các vệt do ánh sáng, lem nhuốc, v.v. chỉ còn nội dung sạch thôi … lọc xong thì phải còn nội dung trên một nền giấy trắng tinh tươm, con dấu và màu sắc trên nội dung gốc giữ nguyên chứ không bị đổi sang màu khác.”

## 1. In: bỏ ngày giờ, tên tệp, `tauri.localhost`

**Nguyên nhân.** Bản Windows chạy trong WebView2. Nút In dựng ảnh từng trang rồi gọi `window.print()`, và WebView2 mở ô **xem trước khi in** của nó (giống Edge). Ô này bật sẵn **Đầu trang và chân trang**, nên in lên mỗi tờ: ngày giờ (trên trái), tiêu đề trang, tức tên tệp (trên phải), địa chỉ trang `tauri.localhost` (dưới trái), số trang (dưới phải). Trang in của ezPDF đã đặt lề 0 (`@page { margin: 0 }`). Trong Chrome thì như vậy là đủ để tắt đầu và chân trang, nhưng WebView2 vẫn in.

**Cách sửa.** Bản Windows không gọi `window.print()` nữa. Nó gọi lệnh `print_page` (`src-tauri/src/lib.rs`), lệnh này mở **hộp thoại In của chính Windows** bằng `ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)` của WebView2. Đường in này không thêm đầu hay chân trang. Có người báo lỗi với Microsoft về đúng hành vi này: hộp thoại hệ thống *không* in đầu, chân trang, còn ô xem trước thì có ([WebView2Feedback #4367](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4367)). Nếu lệnh không chạy được (WebView2 quá cũ, thiếu `ICoreWebView2_16`), app quay về `window.print()` như trước.

- Người dùng thấy hộp thoại In quen thuộc của Windows: máy in, số bản, trang cần in, nút **Tùy chọn** (Preferences) của máy in. Không còn ô xem trước trang.
- Trang ngang vẫn in ngang: Chromium tự xoay trang ngang theo khổ giấy.
- Trình duyệt không đổi: Chrome và Edge không in đầu, chân trang khi lề bằng 0. Android in thẳng tệp PDF (vector) qua dịch vụ in của máy, không qua đường này.

**Kiểm.** Đây là API riêng của Windows. Máy kiểm thử tự động chạy Linux, nên mã Windows chỉ được biên dịch khi CI dựng bản cài. Trên Linux, `cargo check` và `cargo test` của phần còn lại đều qua. Kiểm tay trên Windows: mở một PDF, bấm **In** (Ctrl P). Hộp thoại In của Windows hiện ra. In ra giấy hoặc chọn *Microsoft Print to PDF*: không có ngày giờ, tên tệp hay địa chỉ.

## 2. Bộ lọc màu khi quét

Sau khi quét, ở màn xem trang, dưới các nút Xoay, Căn lại góc, Xóa trang có một dải **bộ lọc**:

| Bộ lọc | Cho ra |
|---|---|
| **Gốc** | Ảnh như lúc chụp, chỉ cắt theo mép giấy và nắn thẳng |
| **Làm sáng** | Cách làm cũ (trước 0.9.6 là công tắc Làm sáng): bỏ bóng và ám màu đèn, giấy vẫn tự nhiên, không ngưỡng |
| **Màu sạch** (mặc định) | Nền trắng tinh: bỏ bóng, vệt sáng, vết bẩn, thớ giấy. Con dấu, chữ màu, bút dạ, ảnh giữ màu |
| **Xám** | Như Màu sạch, thành các sắc xám |
| **Đen trắng** | Như Màu sạch, rồi chỉ còn đen và trắng, như bản photo. Con dấu cũng thành đen |

- Dòng dưới dải bộ lọc nói bộ lọc đang chọn làm gì.
- Đổi bộ lọc ở một trang thì hiện nút **Dùng cho cả N trang**.
- Bộ lọc chọn sau cùng được nhớ trên máy này: ảnh chụp thêm lấy bộ lọc đó.
- Đổi bộ lọc hay xoay trang không phải đọc lại ảnh chụp: worker quét giữ 3 trang đã cắt gần nhất.

### Màu sạch làm gì

Không có thư viện nào làm sẵn việc này mà chạy được trên máy, trong trình duyệt và trên điện thoại. ezPDF tự viết, trong `src/scan/filters.ts`. Mã chạy trong worker quét, ảnh không rời máy. Có hai bước.

**Bước 1: tìm ánh sáng rọi lên tờ giấy.** Làm trên một bản nhỏ của trang, cạnh dài 480 điểm ảnh, từng kênh màu:

1. **Xóa chữ.** Một phép *đóng* (lọc lấy sáng nhất, rồi lấy tối nhất, bán kính 0,7 % trang) xóa các nét mảnh. Mép của bóng đổ giữ đúng chỗ, kể cả bóng sắc do nắng.
2. **Xóa các mảng hẹp.** Lấy trung vị trên 4 % trang. Bước này bỏ mọi mảng hẹp hơn chừng đó: dòng chữ, hàng bảng, nét bút dạ, chữ ký. Mép bóng vẫn sắc.
3. **Loại cái được in ra.** Phần còn lại chỉ được coi là ánh sáng khi nó trông như giấy dưới một thứ ánh sáng khác. So với màu giấy chung của trang, nó phải tối đi gần như đều ở cả ba kênh (bóng hơi xanh vẫn được, vì độ lệch màu cho phép tăng theo độ tối) và không gần đen. Mảng tô màu nhạt, bút dạ vàng, ảnh màu không qua được. Riêng **mảng được in rộng** được tìm theo hình: một vùng tối hơn giấy xung quanh dưới 90 %, *mép sắc ở mọi phía* và không chạm mép trang. Đó là ảnh đen trắng, ô tô đậm, chữ cỡ rất to. Bóng thì hoặc tràn vào từ mép trang, hoặc mờ dần. Vùng sáng nằm trong một mảng in (nền sáng của ảnh) cũng thuộc mảng in. Dưới các mảng này, ánh sáng được lấy từ giấy xung quanh.
4. Ở những chỗ đã chắc là giấy, ánh sáng lấy từ bước 1 (sắc nhất). Nhờ vậy mép bóng do nắng, vết chì, nếp gấp cũng được chia đi.

**Bước 2: mực trên nền trắng.** Mỗi điểm ảnh được chia cho ánh sáng tại chỗ đó, từng kênh. Giấy thành 1, mực là phần tối đi trong kênh hút mạnh nhất.

- **Ngưỡng giấy** lấy theo độ lấm tấm của chính giấy trên trang (trung vị cộng 5 lần độ trải, trong khoảng 0,12–0,24). Mọi thứ nhạt hơn ngưỡng thành trắng tuyệt đối: vết bẩn, vết chì nhạt, thớ giấy, phần còn sót của vệt sáng.
- **Vết có màu** (mảng tô nhạt, bút dạ) được coi là mực sớm hơn hẳn vết xám. Điều kiện là vết đó rõ màu so với độ đậm của nó. Nhờ vậy ô tô xanh nhạt còn mà vết bẩn xám thì đi.
- **Đậm mực.** Mực từ ngưỡng đến “mực đậm của trang” được kéo về đậm hẳn: chữ đen thành đen, chữ phai trên giấy cũ cũng đậm lại. Cả ba kênh nhân cùng một hệ số, nên **sắc màu giữ nguyên**: dấu đỏ vẫn đỏ, mực xanh vẫn xanh.
- **Bụi.** Chấm nhỏ đứng một mình (không có mực nào trong vòng khoảng 1/200 trang) được xóa. Dấu và chấm câu luôn có chữ ở gần, nên không bị xóa.

**Xám** đổi kết quả Màu sạch sang sắc xám. **Đen trắng** lấy ngưỡng trên sắc xám đó (dưới 150 thành đen).

## 3. Kiểm chứng

**Bộ thử mới `npm run test:scan-filter`** (chạy trên CI): `scripts/make_scan_filter_fixtures.py` vẽ một biên bản A4 có đủ thứ bộ lọc phải giữ. Đó là chữ in đen, tiêu đề đậm, con dấu đỏ đè lên chữ ký xanh và lên chữ, mực xanh dương, mực xanh lá, một dòng bút dạ vàng, ô tô xám nhạt, ô tô xanh nhạt, một ảnh màu, một ảnh thẻ đen trắng, ô xám đậm chữ trắng, một ghi chú bút chì nhạt. Kèm theo là bản đồ từng điểm ảnh thuộc phần nào. Trang được “chụp” trong 6 hoàn cảnh: đèn vàng tối dần về một góc; bóng tay mờ; nắng xiên với mép bóng sắc, phần bóng chỉ còn 1/3 độ sáng; vệt sáng xiên và đốm lóa; vết chì, vòng cà phê, vân tay, bụi, nếp gấp; giấy cũ ngả vàng, chữ phai. `tests/scan-filter-test.ts` chạy cả 5 bộ lọc như worker chạy, còn `scripts/verify_scan_filters.py` so với bản gốc.

Giấy trắng tinh (mọi kênh ≥ 245) trên phần giấy cách nét in từ 5 điểm ảnh trở lên:

| Hoàn cảnh | Gốc | Làm sáng | **Màu sạch** | Xám | Đen trắng | Màu sạch: chỗ bẩn còn lại |
|---|---|---|---|---|---|---|
| Đèn vàng, tối dần | 0,00 % | 9,18 % | **99,96 %** | 100,00 % | 100,00 % | 0,00 % |
| Bóng tay mờ | 0,00 % | 21,73 % | **99,94 %** | 99,99 % | 100,00 % | 0,01 % |
| Nắng, mép bóng sắc | 0,00 % | 21,76 % | **99,91 %** | 99,95 % | 100,00 % | 0,03 % |
| Vệt sáng, đốm lóa | 0,79 % | 12,51 % | **99,98 %** | 100,00 % | 100,00 % | 0,00 % |
| Vết bẩn, nếp gấp | 0,00 % | 37,55 % | **99,56 %** | 99,58 % | 100,00 % | 0,35 % |
| Giấy cũ, chữ phai | 0,00 % | 13,31 % | **99,99 %** | 100,00 % | 100,00 % | 0,00 % |

Với **Màu sạch**, ở cả 6 hoàn cảnh: chữ in và tiêu đề đen (L\* ≤ 35). Con dấu, chữ ký, mực xanh dương, xanh lá, bút dạ giữ sắc (lệch dưới 12–18°). Nét mảnh không nhạt màu hơn chính ảnh chụp (ảnh JPEG của điện thoại đã làm nét màu mảnh nhạt đi). Bút dạ vàng còn vàng. Ô xanh nhạt còn thấy và còn xanh. Ảnh màu và ảnh đen trắng giữ màu (ΔE trung bình ≤ 25). Ô xám đậm vẫn đậm. Bút chì vẫn thấy. **Xám** đúng là xám, **Đen trắng** chỉ có đen và trắng. Kết quả: **161/161** điểm đạt.

Màu sạch, từng phần (L\* của chữ in trên bản gốc là 16; “còn thấy” là độ khác giấy trắng so với bản gốc):

| Hoàn cảnh | Chữ in L\* | Dấu đỏ: lệch sắc | Chữ ký xanh: lệch sắc | Bút dạ vàng: lệch sắc | Ô xanh nhạt còn thấy | Ảnh màu ΔE | Ảnh đen trắng ΔE | Bút chì còn thấy |
|---|---|---|---|---|---|---|---|---|
| Đèn vàng, tối dần | 27 | 1,4° | 0,6° | 0,1° | 107 % | 7 | 1 | 84 % |
| Bóng tay mờ | 27 | 0,2° | 0,2° | 0,2° | 114 % | 6 | 22 | 82 % |
| Nắng, mép bóng sắc | 27 | 2,0° | 0,3° | 0,2° | 126 % | 9 | 13 | 81 % |
| Vệt sáng, đốm lóa | 27 | 0,6° | 0,5° | 1,4° | 100 % | 4 | 6 | 82 % |
| Vết bẩn, nếp gấp | 26 | 0,6° | 0,2° | 0,7° | 114 % | 8 | 3 | 82 % |
| Giấy cũ, chữ phai | 30 | 0,0° | 1,7° | 0,3° | 114 % | 6 | 3 | 69 % |

Ảnh trước và sau: `docs/bang-chung/m15-bo-loc-quet.png` (trên: ảnh chụp; dưới: Màu sạch).

**`npm run e2e:scan`** (Chromium thật) **28/28** điểm. 9 ảnh chụp giả lập qua đúng worker của app với Màu sạch: giấy 255±0 ở cả 9 ảnh, kể cả ảnh có bóng đậm (trước đây 209±93); mực đậm hơn ảnh; dấu đỏ còn đỏ. Trong app: Màu sạch được chọn sẵn và có dòng mô tả; Gốc cho ánh sáng như ảnh; quay lại Màu sạch cho đúng trang cũ; Xám ra xám; **Dùng cho cả 3 trang**; ảnh thêm sau lấy bộ lọc chọn sau cùng.

**In:** `e2e:share` (trình duyệt) vẫn đạt; phần Windows như mục 1.

## 4. Giới hạn

- Ô tô **xám rất nhạt** (khoảng 10 % xám) thành trắng. Bộ lọc không phân biệt được nó với một mảng bóng nhạt, và đã chọn cho giấy trắng tinh.
- **Vết bẩn có màu rõ**, như vòng cà phê, còn mờ mờ. Vết có màu được giữ để giữ bút dạ và ô tô màu nhạt.
- Ảnh hay mảng in **nằm sát mép một bóng mềm** có thể bị nhạt phần nền sáng của nó.
- Chỗ **lóa trắng hẳn** (ảnh chụp đã mất thông tin) không lấy lại được chữ.
- Nét màu rất mảnh bị JPEG của điện thoại làm nhạt màu; bộ lọc giữ được sắc nhưng không làm nó rực như bản gốc.
- Thời gian: khoảng 0,4–0,8 giây một trang trên máy tính, điện thoại chậm hơn vài lần.
- Hộp thoại In của Windows không có ô xem trước trang như hộp thoại của Edge.
