# Module Facebook ⇄ Lark Base

Bộ tự động hoá nối **Facebook** với **Lark Base**, chạy trên **GitHub Actions** — không cần server, không cần bật máy tính.

Mỗi việc là một **action gọi bằng HTTP**, nên Lark Base bấm nút là chạy.

| # | Action | Việc | Bảng |
|---|--------|------|------|
| 0 | `init-tables` | Tạo sẵn 5 bảng mẫu vào Base của bạn | tất cả |
| 1 | `fetch-pages` | Lấy danh sách Fanpage + token riêng từng Page | 14.1 |
| 2 | `fetch-posts` | Lấy bài đã đăng + lượt tương tác theo từng cảm xúc | 14.2 |
| 3 | `dang-bai` | Đăng bài ảnh / Reel / video có ảnh bìa lên Facebook | 14.3 |
| 4 | `fetch-adaccounts` | Lấy tài khoản quảng cáo + tổng chi tiêu | 14.4 |
| 5 | `fetch-ads-insights` | Lấy số liệu quảng cáo theo từng ngày | 14.5 |

## Khởi tạo nhanh nhất — 1 lệnh

Điền 4 giá trị vào đầu file rồi chạy. Script làm hết 5 bước: tạo bảng → lấy Page → tài khoản ads → số liệu ads theo ngày → bài viết.

```bash
git clone https://github.com/hoangminhhoagpt-dot/mentor-club-facebook
cd mentor-club-facebook
```

```powershell
# Windows — mở khoi-tao.ps1, điền 4 giá trị, rồi:
.\khoi-tao.ps1
```

```bash
# macOS / Linux — mở khoi-tao.sh, điền 4 giá trị, rồi:
bash khoi-tao.sh
```

Bốn giá trị cần điền: `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_ID`, `FB_USER_TOKEN`.
Chạy lại bao nhiêu lần cũng được — **không tạo bảng trùng, không tạo dòng trùng**.

Muốn chạy trên đám mây (Lark bấm nút là đăng, không cần bật máy) thì đọc [TRIEN-KHAI.md](TRIEN-KHAI.md).

## Bắt đầu

| Bạn muốn | Đọc file |
|---|---|
| Triển khai cho mình / cho khách (dưới 20 phút) | **[TRIEN-KHAI.md](TRIEN-KHAI.md)** |
| Xem chi tiết từng action + tham số | [ACTIONS.md](ACTIONS.md) |
| Cấu hình nút bấm & tự động hoá trong Lark Base | [LARK-AUTOMATION.md](LARK-AUTOMATION.md) |

## Cột đã thêm về sau (Base dựng trước ngày này phải thêm tay)

`init-tables` tạo sẵn đủ cột cho Base mới. Base dựng **trước** mốc dưới đây thì mở bảng, thêm tay đúng tên cột —
engine tự dò, thiếu cột thì bỏ qua chứ không lỗi.

| Ngày | Bảng | Cột / lựa chọn cần thêm | Kiểu | Để làm gì |
|---|---|---|---|---|
| 08/09/2026 | `14.3 Đăng bài tự động` | **`Ảnh bìa`** | Tệp đính kèm | Ảnh bìa (thumbnail) của video |
| 08/09/2026 | `14.3 Đăng bài tự động` | thêm lựa chọn **`Video có bìa`** vào cột `Loại` | Lựa chọn đơn | Chọn kiểu này thì đăng **video lên tường kèm bìa** thay vì Reel |

Chạy lại action `init-tables` sẽ **tự thêm cột `Ảnh bìa`** (nó chỉ thêm cột còn thiếu, không đụng dữ liệu và cột sẵn có).
Nhưng **lựa chọn `Video có bìa` thì phải thêm tay** — `init-tables` không sửa cột đã tồn tại, mà `Loại` thì bảng nào cũng có rồi.
Đặt tên lựa chọn khác cũng được, miễn trong tên có chữ *bìa* (hoặc *thumb* / *cover*) — engine dò theo chữ đó.

Chi tiết cách dùng ảnh bìa (kích thước, vì sao Reel khác video thường) xem [ACTIONS.md](ACTIONS.md#ảnh-bìa-thumbnail-cho-video).

## Nguyên tắc thiết kế

- **Không copy table_id.** Engine tự tìm bảng theo tên (`14.1`, `14.2`…). Bạn chỉ cần khai báo `LARK_BASE_ID`.
- **Ghi theo đúng kiểu cột thật.** Cột nào không có trong bảng thì bỏ qua, không làm hỏng cả lô. Nhờ vậy bộ này chạy được cả trên bảng mẫu mới lẫn bảng cũ mà khách đã tự sửa.
- **Chạy lại bao nhiêu lần cũng được.** Mọi engine đều chống trùng (Page theo ID, bài theo Post-ID, quảng cáo theo cặp *ad × ngày*).
- **Bí mật nằm trong GitHub Secrets**, không nằm trong code. Token hết hạn chỉ cần đổi Secret, không phải sửa gì.
