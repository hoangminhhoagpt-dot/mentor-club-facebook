# Cấu hình Automation trong Lark Base

Mọi automation đều làm **cùng một việc**: gửi 1 request HTTP sang GitHub. Chỉ khác `event_type` trong phần thân.

## Phần khai chung — dùng cho cả 5 automation

Trong Lark Base: **Tự động hoá (Automation) → Tạo mới → …chọn cò kích hoạt… → Thêm hành động → Gửi yêu cầu HTTP**

| Ô | Điền |
|---|---|
| **Phương thức (Method)** | `POST` |
| **URL** | `https://api.github.com/repos/<OWNER>/<REPO>/dispatches` |
| **Headers** | `Authorization` : `Bearer ghp_xxxxxxxx` (PAT scope `repo`)<br>`Accept` : `application/vnd.github+json`<br>`Content-Type` : `application/json` |
| **Body** | JSON — xem từng automation bên dưới |

Thay `<OWNER>/<REPO>` bằng repo fork của bạn, ví dụ `hoangminhhoagpt-dot/mentor-club-facebook`.

> GitHub trả về **204 No Content** (thân rỗng). Lark có thể hiện "phản hồi trống" — **đó là thành công**, không phải lỗi.

---

## 1. Đăng bài — bấm là đăng ⭐ (làm cái này trước)

Đây là automation duy nhất **bắt buộc** phải có. Bốn cái sau chỉ để tự động đồng bộ.

**Cò kích hoạt:** *Khi bản ghi khớp điều kiện*
- Bảng: **14.3 Đăng bài tự động**
- Điều kiện: **`Đăng`** *là* **`Đăng ngay`**

**Hành động:** Gửi yêu cầu HTTP (khai như phần chung), Body:

```json
{
  "event_type": "dang-bai",
  "client_payload": { "record_id": "<<chèn biến Record ID>>" }
}
```

> Chỗ `<<chèn biến Record ID>>`: **xoá đi rồi bấm nút chèn biến** của Lark (biểu tượng `+` hoặc `@` trong ô Body) → chọn bảng 14.3 → chọn cột **`Record ID`**. Cột này đã được `init-tables` tạo sẵn (công thức `RECORD_ID()`), nên luôn chọn được. Nhớ giữ nguyên **hai dấu nháy kép** bao quanh biến.

**Cách dùng hằng ngày:**
1. Thêm 1 dòng ở bảng 14.3: chọn **Page**, chọn **Loại**, gõ **Nội dung**, kéo file vào **Ảnh/video**.
2. Đổi cột **`Đăng`** → **`Đăng ngay`**.
3. Khoảng 30–60 giây sau, dòng đó tự có **Trạng thái = Thành công** và **Link bài đăng**. Cột `Đăng` tự hạ về trống để không đăng lại lần nữa.

Nếu **Trạng thái = Thất bại**, đọc cột **`Log`** — lỗi ghi bằng tiếng Việt, nói rõ thiếu gì.

---

## 2. Đăng theo lịch hẹn

Muốn hẹn giờ đăng thay vì bấm tay: điền cột **`Lịch đăng bài`**, rồi dựng automation chạy định kỳ.

**Cò kích hoạt:** *Theo lịch (Scheduled)* → mỗi **30 phút**
**Body:**

```json
{"event_type":"dang-bai","client_payload":{}}
```

Không truyền `record_id` thì hệ thống quét cả bảng và **chỉ đăng dòng đã tới giờ**. Dòng chưa tới giờ được bỏ qua, dòng `Thành công` không đăng lại.

---

## 3. Đồng bộ bài viết + tương tác (hằng ngày)

**Cò kích hoạt:** *Theo lịch* → mỗi ngày, ví dụ **7:00 sáng**

```json
{"event_type":"fetch-posts","client_payload":{"posts_per_page":50}}
```

Bài đã có trong bảng thì **số like/share/comment tự được cập nhật lại**, bài mới thì thêm dòng — đó là hành vi mặc định, không cần cờ gì thêm.

---

## 4. Đồng bộ số liệu quảng cáo (hằng ngày)

**Cò kích hoạt:** *Theo lịch* → mỗi ngày, ví dụ **7:30 sáng**

```json
{"event_type":"fetch-ads-insights","client_payload":{"date_preset":"last_7d"}}
```

Lấy 7 ngày gần nhất là đủ: Facebook chốt số liệu trễ vài ngày, nên quét lại 7 ngày sẽ tự sửa các con số chưa chốt. Chạy lại **không tạo dòng trùng** (khoá = quảng cáo × ngày).

Lần **đầu tiên** muốn kéo về toàn bộ lịch sử thì chạy tay một lần với `{"date_preset":"maximum"}`.

---

## 5. Làm mới tài khoản quảng cáo + token Page (hằng tuần)

**Cò kích hoạt:** *Theo lịch* → mỗi tuần

```json
{"event_type":"fetch-adaccounts","client_payload":{}}
```

Thêm 1 automation nữa (hoặc 1 hành động HTTP thứ hai trong cùng automation) để làm mới token Page:

```json
{"event_type":"fetch-pages","client_payload":{}}
```

---

## Kiểm tra khi automation "chạy mà không thấy gì"

Đi theo đúng thứ tự này, dừng ở chỗ sai đầu tiên:

1. **Tab Actions trên GitHub có run mới không?**
   - **Không có run nào** → repo fork **chưa bật Actions**. Vào tab Actions bấm nút xanh *"I understand my workflows, go ahead and enable them"*. Đây là lỗi hay gặp nhất: Lark báo gửi thành công (204) nhưng GitHub im lặng không chạy.
   - **Có run, màu đỏ** → bấm vào xem log, lỗi viết bằng tiếng Việt.
   - **Có run, màu xanh, mà Base không đổi** → sai `LARK_BASE_ID`, hoặc app Lark chưa được thêm vào Base với quyền **Chỉnh sửa**.

2. **Lark báo 401 / 403** → PAT sai hoặc thiếu scope `repo`. Tạo lại PAT.

3. **Lark báo 422** → sai `event_type` (gõ nhầm tên action) hoặc thân JSON không hợp lệ.

4. **Bài đăng lên nhưng thiếu ảnh** → Base bật **quyền nâng cao (advanced permission)**. Vào Base → **⋯ → Quyền nâng cao** → thêm app Lark của bạn vào nhóm có quyền **Chỉnh sửa**, hoặc tắt quyền nâng cao cho bảng 14.3.
