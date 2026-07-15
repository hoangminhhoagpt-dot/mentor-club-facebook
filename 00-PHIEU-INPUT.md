# 00 — PHIẾU INPUT (điền xong là chạy) — Facebook ⇄ Lark

> **Ô I của ITTO**: chuẩn bị TRƯỚC khi bấm chạy. Chi tiết: `README.md`, `TRIEN-KHAI.md`,
> `ACTIONS.md`, `LARK-AUTOMATION.md`. Soát hợp đồng: `node check-itto.mjs`.

| # | Việc | Điền / xác nhận | Xong? |
|---|---|---|---|
| 1 | **App Lark** + quyền `bitable:app` + thêm app vào Base | LARK_APP_ID `cli_…`, LARK_BASE_ID `…` | ☐ |
| 2 | **FB User Token** (quyền pages_show_list, pages_read_engagement, pages_manage_posts, ads_read) | FB_USER_TOKEN | ☐ |
| 3 | **5 bảng**: `init-tables.js` (event `init-tables`) tạo Pages/Posts/Đăng bài/Ads-Account/Ads-Daily | TABLE_PAGES/​POSTS/​DANGBAI/​ADS_ACCOUNT/​ADS_DAILY (`tbl…`) | ☐ |
| 4 | **Ad Account** (nếu kéo quảng cáo) | AD_ACCOUNT_ID `act_…` | ☐ |
| 5 | **Nạp GitHub** — 2 Secret + các Variable | ✅ / ❌ | ☐ |
| 6 | **Preflight**: `node check-itto.mjs` → XANH | ✅ / ❌ | ☐ |
| 7 | **Nối nút/lịch** Lark (tick đăng cho 14.3; lịch kéo số liệu) — `LARK-AUTOMATION.md` | ✅ / ❌ | ☐ |

**Secrets (2):** `LARK_APP_SECRET` · `FB_USER_TOKEN`
**Variables:** `LARK_APP_ID` · `LARK_DOMAIN` · `LARK_BASE_ID` · `TABLE_PAGES` · `TABLE_POSTS` · `TABLE_DANGBAI` · `TABLE_ADS_ACCOUNT` · `TABLE_ADS_DAILY` · `AD_ACCOUNT_ID`

**event_type (6):** `init-tables` · `fetch-pages` · `fetch-posts` · `fetch-adaccounts` · `fetch-ads-insights` · `dang-bai` (đăng, kèm `record_id`).

> 1 repo phục vụ nhiều base: truyền `base_id`/`table_*` qua `client_payload` — không sửa code.
