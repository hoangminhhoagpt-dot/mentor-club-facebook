# Chi tiết 6 action

Mọi action gọi chung **một URL**, chỉ khác `event_type`:

```
POST https://api.github.com/repos/<OWNER>/<REPO>/dispatches

Headers:
  Authorization: Bearer <GITHUB_PAT>
  Accept:        application/vnd.github+json
  Content-Type:  application/json

Body:
  {"event_type":"<TÊN ACTION>","client_payload":{ ... }}
```

GitHub trả **204 No Content** = đã nhận lệnh. Kết quả xem ở tab **Actions**.
Không truyền `client_payload` thì hệ thống dùng cấu hình mặc định trong Variables — **đa số trường hợp cứ để `{}` là đúng**.

Tham số dùng chung cho mọi action:

| Tham số | Ý nghĩa |
|---|---|
| `mode` | `""` = **UPSERT** — mặc định: dòng đã có thì **cập nhật**, chưa có thì **tạo mới** · `"--skip-existing"` = chỉ thêm dòng mới, không đụng dòng cũ · `"--dry-run"` = chạy thử, không ghi Base |
| `base_id` | Ghi đè `LARK_BASE_ID` — dùng khi muốn bắn vào Base khác mà không sửa Variables |

---

## 0. `init-tables` — tạo 5 bảng mẫu

Tạo sẵn bảng 14.1 → 14.5 trong Base, **đủ cột, đủ công thức, đủ liên kết**. Chạy đầu tiên, một lần.

```json
{"event_type":"init-tables","client_payload":{}}
```

Chạy lại nhiều lần vẫn an toàn:
- Bảng **đã có** → không tạo lại, chỉ **bổ sung cột còn thiếu**.
- Cột đã có → **giữ nguyên, không đổi kiểu**. Nên nếu khách đã lỡ sửa bảng, chạy lại là "vá" chứ không phá.

Muốn xem trước mà chưa tạo thật: `{"mode":"--dry-run"}`.

---

## 1. `fetch-pages` — lấy Fanpage + token → bảng 14.1

**Phải chạy trước mọi thứ khác.** Mọi việc đăng bài đều lấy token Page từ bảng này.

```json
{"event_type":"fetch-pages","client_payload":{}}
```

| Cột ghi vào 14.1 | Nguồn |
|---|---|
| Fanpage, ID, access_token | `/me/accounts` |
| Category, Follower, Avatar | như trên |

**Chống trùng theo `ID` của Page. Mặc định upsert:** Page đã có → **cập nhật lại** `access_token`, follower, category; Page chưa có → **tạo dòng mới**.
Nhờ vậy khi đổi token Facebook, chỉ cần chạy lại action này là xong.

Muốn giữ nguyên dòng cũ và chỉ thêm Page mới: `{"mode":"--skip-existing"}`.

---

## 2. `fetch-posts` — lấy bài viết + tương tác → bảng 14.2

```json
{"event_type":"fetch-posts","client_payload":{"posts_per_page":50}}
```

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `posts_per_page` | `50` | Số bài lấy mỗi Page. `0` = lấy hết (Page nhiều bài sẽ chạy lâu) |
| `posts_thumbnail` | bật | `"false"` = bỏ qua tải ảnh bìa → chạy nhanh hơn nhiều |
| `mode` | — | `"--skip-existing"` = **không** cập nhật bài cũ, chỉ thêm bài mới (chạy nhanh hơn) |

Ghi: Post-ID, Page (liên kết sang 14.1), Nội dung, Link post, Thumbnail (ảnh tải thật lên Lark), Lượt share / bình luận / Số tương tác, và **7 loại cảm xúc tách riêng** (LIKE, LOVE, HAHA, WOW, SAD, ANGRY, CARE), Ngày đăng.

> **Chống trùng theo `Post-ID`, mặc định upsert:** bài đã có trong bảng → **cập nhật lại số liệu** (like/share/comment/reaction thay đổi liên tục); bài chưa có → **tạo dòng mới**. Cứ hẹn lịch chạy hằng ngày là bảng luôn đúng số, không cần cờ gì thêm.
>
> Ảnh bìa chỉ tải cho bài **mới** — bài cũ đã có ảnh rồi, khỏi tải lại cho nhanh.

---

## 3. `dang-bai` — đăng bài / Reel từ bảng 14.3

Đây là action gắn với **nút bấm trong Lark Base**.

```json
{"event_type":"dang-bai","client_payload":{"record_id":"recXXXXXXXX"}}
```

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `record_id` | — | Đăng **đúng dòng đó, ngay lập tức**, bỏ qua kiểm tra lịch. Đây là cách Lark bấm nút đăng 1 bài. |
| `respect_schedule` | bật | `"false"` = kệ lịch, đăng hết mọi dòng đủ điều kiện |
| `reel_chunk_mb` | `8` | Kích thước mảnh khi upload video. Mạng yếu thì hạ xuống `4` |
| `mode` | — | `"--dry-run"` = chỉ liệt kê dòng sẽ đăng |

**Cột `Loại` quyết định kiểu đăng:**

| `Loại` | Hành vi |
|---|---|
| `Hình ảnh` | Đăng bài feed kèm ảnh (nhiều ảnh trong 1 bài được) |
| `Video` | Đăng **REEL** — upload phân mảnh, video nặng vẫn lên được |

**Một dòng được đăng khi:** `Trạng thái` ≠ `Thành công` **và** chọn được Page **và** có file ở `Ảnh/video` **và** (`Lịch đăng bài` trống hoặc đã tới giờ).

Đăng xong hệ thống ghi ngược lại dòng đó: `Trạng thái`, `Link bài đăng`, `Log`.

Có nội dung ở cột `Comment ebook` thì tự động comment thêm vào bài vừa đăng (comment lỗi cũng không làm hỏng bài).

### Đăng 1 bài lên NHIỀU Page

Cột `Page` là cột **liên kết nhiều** sang bảng 14.1 — chọn bao nhiêu Page thì bài đăng lên bấy nhiêu, mỗi Page dùng **token riêng của nó**. Ảnh/video chỉ tải về **một lần** rồi dùng lại cho mọi Page.

Kết quả ghi vào `Log`, mỗi Page một dòng:

```
2026-07-13 02:57:55 - 2/2 Page
✔ 170332499501394 CLLC: https://www.facebook.com/170332499501394_122256833396128618 +cmt
✔ 446883538502198 John CVTI: https://www.facebook.com/446883538502198_122206719470507172 +cmt
```

- `Trạng thái = Thành công` **chỉ khi MỌI Page đều đăng xong**. Còn Page nào hỏng → `Thất bại`, và `Log` chỉ rõ Page nào hỏng vì sao.
- `Link bài đăng` gộp link của **TẤT CẢ Page vào một cột**, mỗi Page một dòng `Tên Page: link` — nhìn một ô là thấy hết, khỏi mở `Log`:

  ```
  CLLC: https://www.facebook.com/170332499501394_122256833396128618
  John CVTI: https://www.facebook.com/446883538502198_122206719470507172
  ```

  Muốn vậy cột này phải là kiểu **Văn bản** (bảng mẫu mới đã đúng). Base cũ để kiểu **URL** thì chỉ chứa được 1 link → engine ghi link Page đầu kèm chú thích `+N Page (xem Log)`. Đổi cột sang Văn bản là có đủ link ngay, không phải sửa code.
- **Chọn Page mà tra không ra ở 14.1** (Page mới, chưa `fetch-pages`) → dòng báo `Thất bại` và `Log` ghi rõ Page nào, **không lặng lẽ bỏ qua**. Trước đây Page kiểu này bị bỏ đi âm thầm mà dòng vẫn `Thành công`.
- **Chống đăng trùng theo từng Page:** Page đã đăng xong được đánh dấu `✔ <pageId>` trong `Log`. Chạy lại thì Page đó **bị bỏ qua**, chỉ đăng nốt Page còn thiếu. Nên nếu đăng 5 Page mà hỏng 2, cứ bấm lại — nó chỉ đăng 2 Page hỏng, không đăng lại 3 Page kia. Link của các Page đã xong vẫn được giữ nguyên trong `Link bài đăng`.

> Cột Page ở bảng cũ nếu là **cột chữ**: gõ tên Page (hoặc ID Page) cách nhau bằng **dấu phẩy** — engine vẫn hiểu là nhiều Page.

### Cột `Đăng`: nút bấm hay cột chọn?

| Cách làm | Cò kích hoạt automation | Ghi chú |
|---|---|---|
| **Nút bấm (Button)** — đẹp nhất | *Khi nhấn nút* | Phải **tạo tay trong Lark UI** (API không tạo được field Button). |
| **Cột chọn** `Đăng ngay` — mặc định | *Khi bản ghi khớp điều kiện* | `init-tables` tạo sẵn. Đăng xong hệ thống tự hạ cờ về trống. |

Cả hai cách engine đều hiểu, không phải đổi gì trong code.

> **Reel phải đúng chuẩn Facebook:** MP4, dọc 9:16, dài 3–90 giây. Sai chuẩn thì Facebook từ chối, `Log` sẽ ghi rõ lý do.

---

## 4. `fetch-adaccounts` — tài khoản quảng cáo → bảng 14.4

```json
{"event_type":"fetch-adaccounts","client_payload":{}}
```

Ghi: Account ID, Tên tài khoản, Tổng chi tiêu, Loại tiền tệ, Trạng thái TK, Ngày tạo.
Cột **VAT** và **Chi tiêu (VAT)** là **công thức** — Lark tự tính, engine không đụng vào.

**Chống trùng theo `Account ID`, mặc định upsert:** tài khoản đã có → **cập nhật lại tổng chi tiêu**; chưa có → **tạo mới**. Hẹn lịch chạy định kỳ là con số chi tiêu luôn mới.

---

## 5. `fetch-ads-insights` — số liệu quảng cáo theo ngày → bảng 14.5

Mỗi dòng = **1 quảng cáo × 1 ngày**.

```json
{"event_type":"fetch-ads-insights","client_payload":{"date_preset":"last_7d"}}
```

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `date_preset` | `last_30d` | `today` · `yesterday` · `last_7d` · `last_30d` · `last_90d` · `this_month` · `last_month` · `maximum` |
| `since` + `until` | — | Khoảng ngày cụ thể `"2025-06-01"` → `"2025-06-30"`. Đặt cả hai thì `date_preset` bị bỏ qua |
| `ad_account_id` | mọi tài khoản | Chỉ lấy 1 tài khoản, vd `"act_408954571096917"` |

Ghi: chi phí, CPM, CPC, CTR, tần suất, hiển thị, nhấp, tiếp cận, **số tin nhắn**, **follow/like**, **lượt mua**, **giá trị chuyển đổi**, **page engagement**, ngày bắt đầu/kết thúc.
Các cột **Cost per …**, **Tháng**, **Năm** là công thức — Lark tự tính.

**Chống trùng theo cặp (quảng cáo × ngày), và luôn cập nhật dòng cũ** — vì Facebook chốt số liệu trễ vài ngày, chạy lại là có số mới nhất.

> Chạy ra **0 dòng** = khoảng thời gian đó không có quảng cáo nào chạy. Thử `date_preset = maximum` để lấy toàn bộ lịch sử.

---

## Chạy thử ngay bằng curl

```bash
curl -i -X POST https://api.github.com/repos/<OWNER>/<REPO>/dispatches \
  -H "Authorization: Bearer <GITHUB_PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"fetch-pages","client_payload":{}}'
```

Nhận `HTTP/2 204` là xong. Mở tab **Actions** xem log.

## Chạy trên máy (không qua GitHub)

```bash
export LARK_APP_ID=cli_xxx
export LARK_APP_SECRET=xxx
export LARK_BASE_ID=xxx
export FB_USER_TOKEN=EAAxxx

node scripts/init-tables.js
node scripts/fetch-pages.js
node scripts/fetch-posts.js
node scripts/fetch-ads-insights.js          # DATE_PRESET=maximum node scripts/...
node scripts/post-feed.js --dry-run
```

Không cần `npm install` — bộ này **không dùng thư viện ngoài nào**, chỉ cần Node 18 trở lên.
