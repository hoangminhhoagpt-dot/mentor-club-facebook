# Module Facebook ⇄ Lark Base

Bộ tự động hoá nối **Facebook** với **Lark Base**, chạy trên **GitHub Actions** — không cần server, không cần bật máy tính.

Mỗi việc là một **action gọi bằng HTTP**, nên Lark Base bấm nút là chạy.

| # | Action | Việc | Bảng |
|---|--------|------|------|
| 0 | `init-tables` | Tạo sẵn 5 bảng mẫu vào Base của bạn | tất cả |
| 1 | `fetch-pages` | Lấy danh sách Fanpage + token riêng từng Page | 14.1 |
| 2 | `fetch-posts` | Lấy bài đã đăng + lượt tương tác theo từng cảm xúc | 14.2 |
| 3 | `dang-bai` | Đăng bài ảnh / Reel lên Facebook | 14.3 |
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

## Khởi tạo nhanh nhất

Điền 4 giá trị vào đầu file rồi chạy — nó làm hết 5 bước (tạo bảng → Page → ads → số liệu ngày → bài viết):

\✖ Chưa điền LARK_APP_ID ở đầu file khoi-tao.sh
Bốn giá trị: , , , .
Chạy lại bao nhiêu lần cũng được — không tạo bảng trùng, không tạo dòng trùng.

## Bắt đầu

| Bạn muốn | Đọc file |
|---|---|
| Triển khai cho mình / cho khách (dưới 20 phút) | **[TRIEN-KHAI.md](TRIEN-KHAI.md)** |
| Xem chi tiết từng action + tham số | [ACTIONS.md](ACTIONS.md) |
| Cấu hình nút bấm & tự động hoá trong Lark Base | [LARK-AUTOMATION.md](LARK-AUTOMATION.md) |

## Nguyên tắc thiết kế

- **Không copy table_id.** Engine tự tìm bảng theo tên (`14.1`, `14.2`…). Bạn chỉ cần khai báo `LARK_BASE_ID`.
- **Ghi theo đúng kiểu cột thật.** Cột nào không có trong bảng thì bỏ qua, không làm hỏng cả lô. Nhờ vậy bộ này chạy được cả trên bảng mẫu mới lẫn bảng cũ mà khách đã tự sửa.
- **Chạy lại bao nhiêu lần cũng được.** Mọi engine đều chống trùng (Page theo ID, bài theo Post-ID, quảng cáo theo cặp *ad × ngày*).
- **Bí mật nằm trong GitHub Secrets**, không nằm trong code. Token hết hạn chỉ cần đổi Secret, không phải sửa gì.
