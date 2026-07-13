#!/usr/bin/env bash
# =============================================================================
#  KHỞI TẠO TOÀN BỘ MODULE FACEBOOK ⇄ LARK BASE
#
#  Cách dùng:  điền 4 giá trị bên dưới → chạy:  bash khoi-tao.sh
#  Cần: Node 18 trở lên. Không cần npm install.
# =============================================================================

# ---------- ĐIỀN 4 GIÁ TRỊ NÀY ----------
export LARK_APP_ID="cli_xxxxxxxxxxxx"
export LARK_APP_SECRET="xxxxxxxxxxxxxxxx"
export LARK_BASE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxx"
export FB_USER_TOKEN="EAAxxxxxxxxxxxx"
# ----------------------------------------

# Tuỳ chọn — để nguyên là chạy đúng
export LARK_DOMAIN="https://open.larksuite.com"   # Trung Quốc: https://open.feishu.cn
POSTS_PER_PAGE_INIT=50                            # số bài lấy mỗi Page lần đầu (0 = lấy hết)
ADS_RANGE_INIT=maximum                            # lần đầu kéo toàn bộ lịch sử quảng cáo

set -e
cd "$(dirname "$0")"

for v in LARK_APP_ID LARK_APP_SECRET LARK_BASE_ID FB_USER_TOKEN; do
  case "${!v}" in *xxx*|"") echo "✖ Chưa điền $v ở đầu file khoi-tao.sh"; exit 1;; esac
done

step() { echo; echo "════ $1 ════"; }

step "1/5  Tạo 5 bảng mẫu vào Base"
node scripts/init-tables.js

step "2/5  Lấy Fanpage + token  → bảng 14.1   (phải chạy trước mọi thứ)"
node scripts/fetch-pages.js

step "3/5  Lấy tài khoản quảng cáo → bảng 14.4"
node scripts/fetch-adaccounts.js

step "4/5  Lấy số liệu quảng cáo theo ngày → bảng 14.5"
DATE_PRESET=$ADS_RANGE_INIT node scripts/fetch-ads-insights.js

step "5/5  Lấy bài viết + tương tác → bảng 14.2"
POSTS_PER_PAGE=$POSTS_PER_PAGE_INIT node scripts/fetch-posts.js

cat <<EOF

═══════════════════════════════════════════════════════
XONG. Mở Lark Base kiểm tra 5 bảng 14.1 → 14.5.

Chạy lại file này bao nhiêu lần cũng được: bảng đã có thì
không tạo lại, dòng đã có thì cập nhật số liệu, không tạo trùng.

Còn 1 việc làm tay: dựng automation "Đăng bài" trong Lark Base
→ xem LARK-AUTOMATION.md
═══════════════════════════════════════════════════════
EOF
