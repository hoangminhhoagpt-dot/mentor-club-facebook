# =============================================================================
#  KHỞI TẠO TOÀN BỘ MODULE FACEBOOK <-> LARK BASE   (Windows / PowerShell)
#
#  Cách dùng:  điền 4 giá trị bên dưới → chuột phải file → Run with PowerShell
#              hoặc mở PowerShell tại thư mục này rồi gõ:   .\khoi-tao.ps1
#  Cần: Node 18 trở lên. Không cần npm install.
# =============================================================================

# ---------- ĐIỀN 4 GIÁ TRỊ NÀY ----------
$env:LARK_APP_ID     = "cli_xxxxxxxxxxxx"
$env:LARK_APP_SECRET = "xxxxxxxxxxxxxxxx"
$env:LARK_BASE_ID    = "xxxxxxxxxxxxxxxxxxxxxxxxxx"
$env:FB_USER_TOKEN   = "EAAxxxxxxxxxxxx"
# ----------------------------------------

# Tuỳ chọn — để nguyên là chạy đúng
$env:LARK_DOMAIN = "https://open.larksuite.com"   # Trung Quốc: https://open.feishu.cn
$PostsPerPageInit = "50"          # số bài lấy mỗi Page lần đầu (0 = lấy hết)
$AdsRangeInit     = "maximum"     # lần đầu kéo toàn bộ lịch sử quảng cáo

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

foreach ($v in "LARK_APP_ID","LARK_APP_SECRET","LARK_BASE_ID","FB_USER_TOKEN") {
  $val = [Environment]::GetEnvironmentVariable($v)
  if (-not $val -or $val -like "*xxx*") {
    Write-Host "✖ Chưa điền $v ở đầu file khoi-tao.ps1" -ForegroundColor Red
    exit 1
  }
}

function Step($t) { Write-Host ""; Write-Host "════ $t ════" -ForegroundColor Cyan }
function Run($file) {
  node $file
  if ($LASTEXITCODE -ne 0) { Write-Host "✖ Lỗi ở $file — đọc thông báo phía trên." -ForegroundColor Red; exit 1 }
}

Step "1/5  Tạo 5 bảng mẫu vào Base"
Run "scripts/init-tables.js"

Step "2/5  Lấy Fanpage + token  -> bảng 14.1   (phải chạy trước mọi thứ)"
Run "scripts/fetch-pages.js"

Step "3/5  Lấy tài khoản quảng cáo -> bảng 14.4"
Run "scripts/fetch-adaccounts.js"

Step "4/5  Lấy số liệu quảng cáo theo ngày -> bảng 14.5"
$env:DATE_PRESET = $AdsRangeInit
Run "scripts/fetch-ads-insights.js"

Step "5/5  Lấy bài viết + tương tác -> bảng 14.2"
$env:POSTS_PER_PAGE = $PostsPerPageInit
Run "scripts/fetch-posts.js"

Write-Host @"

═══════════════════════════════════════════════════════
XONG. Mở Lark Base kiểm tra 5 bảng 14.1 -> 14.5.

Chạy lại file này bao nhiêu lần cũng được: bảng đã có thì
không tạo lại, dòng đã có thì cập nhật số liệu, không tạo trùng.

Còn 1 việc làm tay: dựng automation "Đăng bài" trong Lark Base
-> xem LARK-AUTOMATION.md
═══════════════════════════════════════════════════════
"@ -ForegroundColor Green
