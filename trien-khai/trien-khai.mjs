#!/usr/bin/env node
/*
 * trien-khai.mjs — Triển khai 1 lệnh cho 1 khách / học viên mới.
 *
 *   1. cp khach.config.example.json khach.config.json   (rồi điền)
 *   2. node trien-khai.mjs
 *
 * Script sẽ: fork repo nguồn → set Variables → set Secrets → nhắc bật Actions
 *            → kiểm chứng Actions đã bật thật chưa → chạy init-tables + fetch-pages
 *            → in sẵn cấu hình automation cho Lark.
 *
 * Secrets phải mã hoá sealed box (chuẩn của GitHub). Có libsodium-wrappers thì script tự set;
 * không có thì script in ra để bạn dán tay 30 giây — không chặn quy trình.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const die = m => { console.error('\n✖ ' + m + '\n'); process.exit(1); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SOURCE = 'hoangminhhoagpt-dot/mentor-club-facebook';

// ---------- 1. Đọc config ----------
const cfgPath = path.join(__dirname, 'khach.config.json');
if (!fs.existsSync(cfgPath)) die('Chưa có khach.config.json — copy từ khach.config.example.json rồi điền.');
const C = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

for (const k of ['GITHUB_PAT', 'LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_BASE_ID', 'FB_USER_TOKEN'])
  if (!C[k] || /^\(|xxx/i.test(String(C[k]))) die(`Thiếu hoặc chưa điền trường "${k}" trong khach.config.json`);

const PAT = C.GITHUB_PAT.trim();
const H = { Authorization: `Bearer ${PAT}`, Accept: 'application/vnd.github+json', 'User-Agent': 'trien-khai-fb', 'Content-Type': 'application/json' };
const gh = async (url, opt = {}) => {
  const r = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = {}; }
  return { status: r.status, j };
};

// ---------- 2. Xác định tài khoản + repo đích ----------
const me = await gh('/user');
if (me.status !== 200) die(`PAT không hợp lệ (${me.status}). Cần PAT classic có scope "repo".`);
const OWNER = me.j.login;
const REPO = (C.REPO_NAME || 'mentor-club-facebook').trim();
const SLUG = `${OWNER}/${REPO}`;
console.log(`\n== TRIỂN KHAI MODULE FACEBOOK → ${SLUG} ==\n`);

// ---------- 3. Fork ----------
let repo = await gh(`/repos/${SLUG}`);
if (repo.status === 200) {
  console.log(`[1/6] Repo đã có sẵn: ${SLUG}`);
} else {
  console.log(`[1/6] Fork ${SOURCE} …`);
  const f = await gh(`/repos/${SOURCE}/forks`, { method: 'POST', body: JSON.stringify({ name: REPO }) });
  if (f.status !== 202 && f.status !== 200) die(`Fork lỗi ${f.status}: ${f.j.message || ''}`);
  for (let i = 0; i < 20; i++) {           // fork chạy nền, chờ GitHub dựng xong
    await sleep(3000);
    repo = await gh(`/repos/${SLUG}`);
    if (repo.status === 200) break;
    process.stdout.write('  … đang fork\r');
  }
  if (repo.status !== 200) die('Fork xong nhưng chưa thấy repo — chờ 1 phút rồi chạy lại script.');
  console.log(`  ✔ đã fork → ${SLUG}`);
}

// ---------- 4. Variables (không cần mã hoá) ----------
console.log('\n[2/6] Đặt Variables…');
const VARS = {
  LARK_APP_ID: C.LARK_APP_ID,
  LARK_BASE_ID: C.LARK_BASE_ID,
  ...(C.LARK_DOMAIN ? { LARK_DOMAIN: C.LARK_DOMAIN } : {}),
  ...(C.AD_ACCOUNT_ID ? { AD_ACCOUNT_ID: C.AD_ACCOUNT_ID } : {}),
};
for (const [name, value] of Object.entries(VARS)) {
  let r = await gh(`/repos/${SLUG}/actions/variables/${name}`, { method: 'PATCH', body: JSON.stringify({ name, value: String(value) }) });
  if (r.status === 404) r = await gh(`/repos/${SLUG}/actions/variables`, { method: 'POST', body: JSON.stringify({ name, value: String(value) }) });
  console.log(`  ${r.status === 204 || r.status === 201 ? '✔' : '✖'} ${name} (${r.status})`);
}

// ---------- 5. Secrets (sealed box) ----------
console.log('\n[3/6] Đặt Secrets…');
const SECRETS = { LARK_APP_SECRET: C.LARK_APP_SECRET, FB_USER_TOKEN: C.FB_USER_TOKEN };
let sodium = null;
try { sodium = (await import('libsodium-wrappers')).default; await sodium.ready; } catch { /* không có thì dán tay */ }

if (sodium) {
  const pk = await gh(`/repos/${SLUG}/actions/secrets/public-key`);
  if (pk.status !== 200) die(`Lấy public-key lỗi ${pk.status}`);
  const key = sodium.from_base64(pk.j.key, sodium.base64_variants.ORIGINAL);
  for (const [name, val] of Object.entries(SECRETS)) {
    const enc = sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(String(val)), key), sodium.base64_variants.ORIGINAL);
    const r = await gh(`/repos/${SLUG}/actions/secrets/${name}`, { method: 'PUT', body: JSON.stringify({ encrypted_value: enc, key_id: pk.j.key_id }) });
    console.log(`  ${r.status === 201 || r.status === 204 ? '✔' : '✖'} ${name} (${r.status})`);
  }
} else {
  console.log('  ! Không có libsodium-wrappers → dán tay 2 Secret này (30 giây):');
  console.log(`    Mở: https://github.com/${SLUG}/settings/secrets/actions`);
  for (const [name, val] of Object.entries(SECRETS)) console.log(`      ${name} = ${val}`);
  console.log('    (Muốn script tự set: chạy "npm install libsodium-wrappers" trong thư mục trien-khai/)');
}

// ---------- 6. Bật Actions (nút bấm tay — không có API) ----------
console.log('\n[4/6] Bật Actions trên bản fork');
console.log(`  → Mở: https://github.com/${SLUG}/actions`);
console.log('  → Bấm nút xanh "I understand my workflows, go ahead and enable them"');
console.log('\n  ⚠ Chưa bấm thì mọi lệnh gọi HTTP trả 204 (như thành công) nhưng GitHub KHÔNG chạy gì.');
console.log('  Script sẽ tự kiểm chứng bằng cách bắn thử 1 lệnh rồi đếm số run.\n');

const dispatch = (event, payload = {}) =>
  gh(`/repos/${SLUG}/dispatches`, { method: 'POST', body: JSON.stringify({ event_type: event, client_payload: payload }) });
const countRuns = async () => (await gh(`/repos/${SLUG}/actions/runs?per_page=1`)).j.total_count || 0;

console.log('[5/6] Kiểm chứng Actions đã bật thật chưa…');
let enabled = false;
for (let i = 1; i <= 10; i++) {
  const before = await countRuns();
  await dispatch('init-tables');
  await sleep(6000);
  if (await countRuns() > before) { enabled = true; break; }
  process.stdout.write(`  … chưa thấy run nào — bấm nút Enable rồi chờ (lần ${i}/10)\r`);
  await sleep(9000);
}
if (!enabled) die(`Actions vẫn chưa bật. Vào https://github.com/${SLUG}/actions bấm nút Enable rồi chạy lại script.`);
console.log('  ✔ Actions đã bật — init-tables đang chạy, 5 bảng sắp hiện trong Base.');

// ---------- 7. Chạy nốt fetch-pages ----------
console.log('\n[6/6] Chạy fetch-pages (lấy Page + token về bảng 14.1)…');
await sleep(25000);                 // chờ init-tables tạo xong bảng rồi mới đổ Page vào
await dispatch('fetch-pages');
console.log('  ✔ đã bắn lệnh.');

// ---------- Kết ----------
console.log(`
────────────────────────────────────────────────────────
XONG. Kiểm tra:
  Actions : https://github.com/${SLUG}/actions
  Base    : https://open.larksuite.com/base/${C.LARK_BASE_ID}

Còn 1 việc cuối — dựng automation "Đăng bài" trong Lark Base:

  Cò kích hoạt : Khi bản ghi khớp điều kiện → bảng 14.3 → [Đăng] là [Đăng ngay]
  Hành động    : Gửi yêu cầu HTTP
    Method  POST
    URL     https://api.github.com/repos/${SLUG}/dispatches
    Headers Authorization: Bearer <PAT>
            Accept: application/vnd.github+json
            Content-Type: application/json
    Body    {"event_type":"dang-bai","client_payload":{"record_id":"<chèn biến cột Record ID>"}}

  Chi tiết + 4 automation đồng bộ theo lịch: xem LARK-AUTOMATION.md

⚠ Bảo mật: khach.config.json chứa token — đã nằm trong .gitignore, đừng commit.
────────────────────────────────────────────────────────
`);
