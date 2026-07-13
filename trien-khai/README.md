# Triển khai 1 lệnh (dùng khi làm cho nhiều học viên)

Dành cho người đã quen. Người mới nên đi theo [../TRIEN-KHAI.md](../TRIEN-KHAI.md).

```bash
cd trien-khai
npm install                                  # 1 lần duy nhất (để tự set Secrets)
cp khach.config.example.json khach.config.json
#   … điền 5 giá trị của khách …
node trien-khai.mjs
```

Script tự làm: fork repo → đặt Variables → đặt Secrets → **kiểm chứng Actions đã bật thật chưa**
→ chạy `init-tables` (tạo 5 bảng) → chạy `fetch-pages` → in sẵn cấu hình automation cho Lark.

Việc duy nhất phải làm tay: bấm nút **Enable workflows** ở tab Actions của bản fork
(GitHub không cho bật bằng API). Script sẽ chờ và tự kiểm tra cho bạn.

Bỏ qua `npm install` cũng chạy được — chỉ là 2 Secret sẽ được in ra để bạn dán tay.

⚠ `khach.config.json` chứa token của khách → đã nằm trong `.gitignore`, đừng commit.
