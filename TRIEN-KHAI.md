# Triển khai module Facebook — mục tiêu dưới 20 phút

Bạn sẽ đi qua 6 bước. Cột thời gian là ước lượng cho người làm lần đầu.

| Bước | Việc | Thời gian |
|---|---|---|
| 1 | Chuẩn bị 4 giá trị (2 của Lark, 1 của Facebook, 1 của GitHub) | 8 phút |
| 2 | Fork repo này | 1 phút |
| 3 | Bật Actions trên bản fork | 30 giây |
| 4 | Dán Secrets + Variables | 3 phút |
| 5 | Chạy `init-tables` → `fetch-pages` | 2 phút |
| 6 | Tạo automation trong Lark Base | 5 phút |

> **Làm hàng loạt cho nhiều học viên?** Bỏ qua bước 2–5, xem [trien-khai/README.md](trien-khai/README.md) — một lệnh làm hết, khoảng 3 phút.

---

## Bước 1 — Chuẩn bị 4 giá trị

### A. Lark App (2 giá trị: `LARK_APP_ID`, `LARK_APP_SECRET`)

1. Vào <https://open.larksuite.com/app> → **Create custom app**.
2. Tab **Credentials & Basic Info** → copy **App ID** và **App Secret**.
3. Tab **Permissions & Scopes** → thêm 4 quyền, rồi **Create version → Submit for release**:

   | Quyền | Để làm gì |
   |---|---|
   | `bitable:app` | Tạo bảng, đọc/ghi dữ liệu Base |
   | `drive:drive` | Tải ảnh bìa bài viết lên Base |
   | `base:record:retrieve` | Đọc bản ghi |
   | `base:table:create` | Tạo 5 bảng mẫu |

4. **Quan trọng:** mở Lark Base của bạn → nút **⋯ (góc trên phải)** → **Add-ons / Automation → …** → thêm app vừa tạo làm **cộng tác viên có quyền Chỉnh sửa**. Không làm bước này thì app đọc được nhưng **không ghi được**.

### B. Lark Base ID (`LARK_BASE_ID`)

Mở Base, nhìn thanh địa chỉ:

```
https://xxx.sg.larksuite.com/base/ZM8qbz78JaR16Es560sly6Bkgvg
                                  └──────── đây là LARK_BASE_ID ────────┘
```

### C. Facebook token (`FB_USER_TOKEN`)

1. Vào <https://developers.facebook.com/tools/explorer/>.
2. Chọn app của bạn → **User Token** → cấp các quyền:

   ```
   pages_show_list, pages_read_engagement, pages_manage_posts,
   pages_read_user_content, read_insights, ads_read, business_management
   ```

3. Bấm **Generate Access Token** → copy.
4. Đổi sang token **dài hạn** (bắt buộc — token mặc định chỉ sống 1–2 giờ):
   - Mở <https://developers.facebook.com/tools/debug/accesstoken/> → dán token → **Extend Access Token**.
   - Token dài hạn sống ~60 ngày; quyền truy cập dữ liệu ~90 ngày. Hết hạn thì chỉ cần **cập nhật lại Secret**, không phải sửa code.

### D. GitHub PAT (để Lark gọi được GitHub)

<https://github.com/settings/tokens> → **Generate new token (classic)** → tick scope **`repo`** → copy.
Token này chỉ dùng để **Lark Base bấm nút gọi GitHub**. Cất kỹ, coi như mật khẩu.

---

## Bước 2 — Fork repo

Mở <https://github.com/hoangminhhoagpt-dot/mentor-club-facebook> → **Fork** → chọn tài khoản của bạn.

## Bước 3 — Bật Actions ⚠️

Vào bản fork → tab **Actions** → bấm nút xanh **"I understand my workflows, go ahead and enable them"**.

> **Bỏ qua bước này là hỏng cả hệ thống, mà lại không có báo lỗi.** Repo fork chưa bật Actions thì lệnh gọi HTTP vẫn trả về **204 (như thành công)** nhưng GitHub **không chạy gì cả**. Bấm nút xong hãy đi tiếp.

## Bước 4 — Dán Secrets + Variables

Vào **Settings → Secrets and variables → Actions**.

**Tab Secrets** — bấm *New repository secret*, thêm 2 cái:

| Tên Secret | Giá trị | Bắt buộc |
|---|---|:---:|
| `LARK_APP_SECRET` | App Secret ở bước 1A | ✅ |
| `FB_USER_TOKEN` | Token Facebook dài hạn ở bước 1C | ✅ |

**Tab Variables** — bấm *New repository variable*:

| Tên Variable | Giá trị | Bắt buộc | Mặc định nếu bỏ trống |
|---|---|:---:|---|
| `LARK_APP_ID` | App ID ở bước 1A (`cli_...`) | ✅ | — |
| `LARK_BASE_ID` | Base ID ở bước 1B | ✅ | — |
| `LARK_DOMAIN` | `https://open.larksuite.com` (quốc tế) hoặc `https://open.feishu.cn` (Trung Quốc) | — | `https://open.larksuite.com` |
| `TABLE_PAGES` | Chỉ đặt nếu bạn **đổi tên bảng** khác `14.1` | — | tìm bảng tên bắt đầu bằng `14.1` |
| `TABLE_POSTS` | — | — | `14.2` |
| `TABLE_DANGBAI` | — | — | `14.3` |
| `TABLE_ADS_ACCOUNT` | — | — | `14.4` |
| `TABLE_ADS_DAILY` | — | — | `14.5` |
| `AD_ACCOUNT_ID` | Chỉ lấy 1 tài khoản quảng cáo (vd `act_408954571096917`) | — | lấy **mọi** tài khoản |

> 5 biến `TABLE_*` **để trống là tốt nhất**. Engine tự tìm bảng theo tên nên bạn không phải đi copy `table_id`.
> Chỉ đặt khi bạn cố tình đặt tên bảng khác — lúc đó điền `table_id` (`tbl...`) hoặc tên bảng.

## Bước 5 — Chạy 2 action đầu tiên

Vào tab **Actions** của bản fork:

1. Chọn **`init-tables`** → **Run workflow** → chờ ~20 giây.
   → Mở Lark Base, 5 bảng `14.1` → `14.5` đã hiện ra, đủ cột, đủ công thức.
2. Chọn **`fetch-pages`** → **Run workflow** → chờ ~20 giây.
   → Bảng **14.1** hiện danh sách Fanpage kèm `access_token` riêng của từng Page.

Nếu Actions báo đỏ, bấm vào dòng log — thông báo lỗi viết bằng tiếng Việt, chỉ thẳng thiếu gì.

Xong 2 bước này là hệ thống **đã sống**. Ba action còn lại chạy y hệt (Run workflow), hoặc để Lark bấm hộ ở bước 6.

## Bước 6 — Nối vào Lark Base

Xem **[LARK-AUTOMATION.md](LARK-AUTOMATION.md)** — có sẵn phần thân JSON để copy-paste. Chỉ cần dựng **1 automation "Đăng bài"** là dùng được ngay; 4 automation còn lại (đồng bộ theo lịch) làm sau cũng được.

---

## Bảng biến — bản tóm tắt để copy

```bash
# ---- GitHub Secrets (2) ----
LARK_APP_SECRET=            # App Secret của Lark app
FB_USER_TOKEN=              # Token Facebook dài hạn (user token, không phải page token)

# ---- GitHub Variables (2 bắt buộc) ----
LARK_APP_ID=cli_xxxxxxxxxxxx
LARK_BASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx

# ---- GitHub Variables (tuỳ chọn — bỏ trống là chạy đúng) ----
LARK_DOMAIN=https://open.larksuite.com
TABLE_PAGES=                # để trống → tự tìm bảng "14.1"
TABLE_POSTS=                # để trống → tự tìm bảng "14.2"
TABLE_DANGBAI=              # để trống → tự tìm bảng "14.3"
TABLE_ADS_ACCOUNT=          # để trống → tự tìm bảng "14.4"
TABLE_ADS_DAILY=            # để trống → tự tìm bảng "14.5"
AD_ACCOUNT_ID=              # để trống → lấy mọi tài khoản quảng cáo

# ---- Không lưu ở GitHub, chỉ dán vào Lark automation ----
GITHUB_PAT=ghp_xxxxxxxx     # PAT scope "repo" — để Lark gọi GitHub
```

---

## Gặp lỗi thì xem đây

| Hiện tượng | Nguyên nhân | Cách sửa |
|---|---|---|
| Gọi HTTP trả 204 nhưng Actions **không có run nào** | Repo fork **chưa bật Actions** | Làm lại Bước 3 |
| `Không thấy bảng khớp "14.1"` | Chưa chạy `init-tables`, hoặc sai `LARK_BASE_ID` | Chạy `init-tables`; kiểm tra lại Base ID |
| Lark trả code `91403` / `NOTEXIST` | App Lark **chưa được thêm vào Base** | Làm lại Bước 1A mục 4 |
| `FB_USER_TOKEN không hợp lệ / đã hết hạn` | Token Facebook hết hạn | Cấp token mới (Bước 1C) → cập nhật **Secret**, không cần sửa code |
| `FB_USER_TOKEN thiếu quyền: ads_read` | Token cấp thiếu scope | Cấp lại token có đủ quyền ở Bước 1C |
| Bảng 14.5 chạy xong mà **0 dòng** | Khoảng thời gian không có quảng cáo chạy | Chạy lại với `date_preset = maximum` |
| Reel đăng lỗi | Video không đúng chuẩn Reel | MP4, **dọc 9:16**, dài **3–90 giây** |
| Bài đăng 2 lần | Đã đăng xong nhưng xoá cột Trạng thái | Dòng có `Trạng thái = Thành công` sẽ **không** đăng lại. Muốn đăng lại phải xoá trạng thái — đó là cố ý. |
