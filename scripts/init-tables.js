#!/usr/bin/env node
'use strict';
/*
 * init-tables.js — Tạo bộ 5 bảng mẫu module Facebook vào Lark Base được chỉ định.
 *
 *   node scripts/init-tables.js            tạo bảng còn thiếu + thêm cột còn thiếu vào bảng đã có
 *   node scripts/init-tables.js --dry-run  chỉ in ra sẽ làm gì, không đụng vào Base
 *
 * Chạy lại bao nhiêu lần cũng an toàn:
 *   - Bảng đã có (khớp tiền tố "14.1"…) → KHÔNG tạo lại, chỉ bổ sung cột còn THIẾU TÊN.
 *   - Cột đã tồn tại → giữ nguyên, không bao giờ đổi kiểu (tránh làm hỏng bảng khách đang dùng).
 *
 * Biến môi trường: LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_ID (bắt buộc), LARK_DOMAIN (tuỳ chọn).
 */
const L = require('./lib/lark');

const DRY = process.argv.includes('--dry-run');
const T = { TEXT: 1, NUM: 2, SELECT: 3, DATE: 5, URL: 15, FILE: 17, LINK: 18, FORMULA: 20 };

const num = (formatter = '1,000') => ({ type: T.NUM, property: { formatter } });
const money = () => ({ type: T.NUM, ui_type: 'Currency', property: { currency_code: 'VND', formatter: '0' } });
// Lark chỉ nhận một số chuỗi định dạng ngày cố định — 'dd/MM/yyyy HH:mm' KHÔNG hợp lệ.
const date = (f = 'yyyy/MM/dd HH:mm') => ({ type: T.DATE, property: { date_formatter: f, auto_fill: false } });
const select = (...names) => ({ type: T.SELECT, property: { options: names.map(name => ({ name })) } });
const formula = (expr, formatter) => ({ type: T.FORMULA, property: { formula_expression: expr, ...(formatter ? { formatter } : {}) } });
// multiple: true → 1 dòng chọn được NHIỀU Page (đăng 1 bài lên nhiều Fanpage cùng lúc).
// '@14.1' là chỗ giữ tạm, lúc chạy sẽ thay bằng table_id thật của bảng 14.1.
const link = to => ({ type: T.LINK, property: { table_id: '@' + to, multiple: true } });

// Thứ tự khai báo = thứ tự tạo cột. Công thức phải đứng SAU cột mà nó tham chiếu.
const SPECS = [
  {
    key: '14.1',
    name: '14.1 Lấy danh sách pages',
    desc: 'Danh sách Fanpage + access_token riêng của từng Page (nguồn token cho việc đăng bài)',
    fields: {
      'Fanpage': { type: T.TEXT },
      'ID': { type: T.TEXT },
      'access_token': { type: T.TEXT },
      'Category': { type: T.TEXT },
      'Follower': num(),
      'Avatar': { type: T.URL },
    },
  },
  {
    key: '14.2',
    name: '14.2 Lấy danh sách bài viết',
    desc: 'Bài đã đăng của mọi Page + số liệu tương tác tách theo từng loại cảm xúc',
    fields: {
      'Post-ID': { type: T.TEXT },
      'Page': link('14.1'),
      'Fanpage': { type: T.TEXT },
      'Nội dung': { type: T.TEXT },
      'Link post': { type: T.URL },
      'Thumbnail': { type: T.FILE },
      'Lượt share': num(),
      'Lượt bình luận': num(),
      'Số tương tác': num(),
      'LIKE': num(), 'LOVE': num(), 'HAHA': num(), 'WOW': num(), 'SAD': num(), 'ANGRY': num(), 'CARE': num(),
      'Ngày đăng': date(),
      'Tháng': formula('"Tháng "&MONTH([Ngày đăng])&"/"&YEAR([Ngày đăng])'),
    },
  },
  {
    key: '14.3',
    name: '14.3 Đăng bài tự động',
    desc: 'Mỗi dòng = 1 bài chờ đăng. Đổi cột "Đăng" thành "Đăng ngay" để automation bắn bài lên Facebook',
    fields: {
      'STT': { type: T.TEXT },
      'Page': link('14.1'),
      'Loại': select('Hình ảnh', 'Video'),
      'Nội dung': { type: T.TEXT },
      'Comment ebook': { type: T.TEXT },
      'Ảnh/video': { type: T.FILE },
      'Lịch đăng bài': date(),
      'Đăng': select('Đăng ngay'),
      'Trạng thái': select('Thành công', 'Thất bại'),
      'Log': { type: T.TEXT },
      // Chữ chứ KHÔNG phải URL: 1 dòng đăng lên nhiều Page thì có nhiều link, mà cột URL
      // chỉ ôm được đúng 1 link. Cột chữ chứa mọi link trong MỘT cột, mỗi Page 1 dòng.
      'Link bài đăng': { type: T.TEXT },
      // Automation của Lark cần gửi record_id sang GitHub. Có sẵn cột này thì luôn chọn được
      // trong trình chọn biến, khỏi phụ thuộc vào việc Lark có lộ "Record ID" hay không.
      'Record ID': formula('RECORD_ID()'),
    },
  },
  {
    key: '14.4',
    name: '14.4 Ads Account list',
    desc: 'Danh sách tài khoản quảng cáo + tổng chi tiêu (đã tính sẵn VAT)',
    fields: {
      'Account ID': { type: T.TEXT },
      'Tên tài khoản': { type: T.TEXT },
      'Tổng chi tiêu': num(),
      'VAT': formula('[Tổng chi tiêu]*0.1', '1,000'),
      'Chi tiêu (VAT)': formula('[Tổng chi tiêu]*1.1', '1,000'),
      'Loại tiền tệ': select('VND', 'USD'),
      'Trạng thái TK': select('Đang hoạt động', 'Tạm dừng'),
      'Ngày tạo': date('dd/MM/yyyy'),
    },
  },
  {
    key: '14.5',
    name: '14.5 Facebook ads - Thống kê theo ngày',
    desc: 'Mỗi dòng = 1 quảng cáo × 1 ngày. Nền cho báo cáo chi phí / tin nhắn / chuyển đổi',
    fields: {
      'ID Quảng Cáo': { type: T.TEXT },
      'Account ID': { type: T.TEXT },
      'Tên tài khoản': { type: T.TEXT },
      'ID Chiến Dịch': { type: T.TEXT },
      'Tên Chiến Dịch': { type: T.TEXT },
      'Tên Nhóm Quảng Cáo': { type: T.TEXT },
      'Tên Quảng Cáo': { type: T.TEXT },
      'Tổng chi phí': money(),
      'CPM': money(),
      'CPC': money(),
      'CTR': num('0.00'),
      'Tần Suất': num('0.0'),
      'Số Mess': num(),
      'Số lần hiển thị': num(),
      'Số lần nhấp': num(),
      'Số người tiếp cận': num(),
      'Follow hoặc Like': num('0'),
      'Lượt mua': num('0'),
      'Giá trị chuyển đổi từ lượt mua': num('0'),
      'Page engagement': num('0'),
      'Ngày bắt đầu': date('dd/MM/yyyy'),
      'Ngày kết thúc': date('dd/MM/yyyy'),
      'Cost per Page engagement': formula('IF([Page engagement],[Tổng chi phí]/[Page engagement],0)', '1,000'),
      'Cost per Follow': formula('IF([Follow hoặc Like],[Tổng chi phí]/[Follow hoặc Like],0)', '1,000'),
      'Cost per new messaging contact': formula('IF([Số Mess],[Tổng chi phí]/[Số Mess],0)', '1,000'),
      'Tháng': formula('"Tháng "&MONTH([Ngày bắt đầu])'),
      'Năm': formula('"Năm "&YEAR([Ngày bắt đầu])'),
    },
  },
];

// Lời nhắc cho cột sai kiểu ở Base cũ — nói rõ mất gì để admin tự quyết có sửa tay hay không.
const TYPE_NOTE = {
  '14.3/Link bài đăng': 'kiểu URL chỉ giữ được 1 link. Đổi tay sang Văn bản để thấy link của MỌI Page (Log vẫn có đủ).',
};

const BASE = process.env.LARK_BASE_ID || process.env.LARK_APP_TOKEN || '';

(async () => {
  if (!BASE) throw new Error('Thiếu LARK_BASE_ID — đặt ở GitHub Variables (Settings → Secrets and variables → Actions → Variables).');
  const tk = await L.token();
  const existing = await L.listTables(tk, BASE);
  L.log(`Base ${BASE} đang có ${existing.length} bảng: ${existing.map(t => t.name).join(' | ') || '(trống)'}`);

  const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const findTable = key => existing.find(t => norm(t.name).startsWith(norm(key)));
  const resolved = {}; // '14.1' → table_id (để link field trỏ đúng)

  for (const spec of SPECS) {
    const hit = findTable(spec.key);

    // ---- Bảng chưa có: tạo mới với các cột KHÔNG phải công thức/liên kết ----
    if (!hit) {
      const simple = [], deferred = [];
      for (const [name, f] of Object.entries(spec.fields)) {
        const isDeferred = f.type === T.FORMULA || f.type === T.LINK;
        (isDeferred ? deferred : simple).push([name, f]);
      }
      if (DRY) {
        L.log(`[DRY] TẠO bảng "${spec.name}" (${Object.keys(spec.fields).length} cột)`);
        resolved[spec.key] = 'tblDRYRUN';
        continue;
      }
      const d = await L.api(`/open-apis/bitable/v1/apps/${BASE}/tables`, {
        method: 'POST',
        body: JSON.stringify({
          table: {
            name: spec.name,
            default_view_name: 'Bảng',
            fields: simple.map(([field_name, f]) => ({ field_name, type: f.type, ...(f.ui_type ? { ui_type: f.ui_type } : {}), ...(f.property ? { property: f.property } : {}) })),
          },
        }),
      }, tk);
      const tid = d.table_id;
      resolved[spec.key] = tid;
      L.log(`✔ TẠO bảng "${spec.name}" → ${tid} (${simple.length} cột)`);
      // Công thức + liên kết phải thêm sau: chúng tham chiếu cột/bảng vừa tạo xong.
      for (const [name, f] of deferred) await addField(tk, tid, name, f, resolved);
      continue;
    }

    // ---- Bảng đã có: chỉ bổ sung cột còn THIẾU TÊN, không sửa cột đang có ----
    resolved[spec.key] = hit.table_id;
    const meta = await L.getFields(tk, hit.table_id, BASE);

    // Cột có sẵn nhưng SAI KIỂU so với mẫu: chỉ báo, KHÔNG tự đổi (đổi kiểu có thể mất dữ liệu
    // của khách đang dùng). Engine vẫn chạy được vì buildFields ghi theo kiểu cột thật.
    for (const [name, f] of Object.entries(spec.fields)) {
      const cur = meta.get(name);
      if (cur && f.type !== cur.type) L.log(`  ! cột "${name}" đang là kiểu ${cur.type}, mẫu mới là ${f.type}${TYPE_NOTE[`${spec.key}/${name}`] ? ' — ' + TYPE_NOTE[`${spec.key}/${name}`] : ''}`);
    }

    const missing = Object.entries(spec.fields).filter(([name]) => !meta.has(name));
    if (!missing.length) { L.log(`= Bảng "${hit.name}" đã đủ cột — giữ nguyên.`); continue; }
    L.log(`~ Bảng "${hit.name}" thiếu ${missing.length} cột: ${missing.map(([n]) => n).join(', ')}`);
    if (DRY) continue;
    for (const [name, f] of missing) await addField(tk, hit.table_id, name, f, resolved);
  }

  L.log('\nXONG. Bảng của module Facebook:');
  for (const spec of SPECS) L.log(`  ${spec.key} → ${resolved[spec.key] || '(chưa tạo)'}  ${spec.name}`);
  L.log('\nCác engine tự tìm bảng theo TÊN, nên không cần copy table_id đi đâu cả.');
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });

async function addField(tk, tableId, name, f, resolved) {
  const body = { field_name: name, type: f.type };
  if (f.ui_type) body.ui_type = f.ui_type;
  if (f.property) {
    body.property = { ...f.property };
    // link('14.1') để tạm '@14.1' — giờ mới biết table_id thật để thay vào.
    if (typeof body.property.table_id === 'string' && body.property.table_id.startsWith('@')) {
      const key = body.property.table_id.slice(1);
      if (!resolved[key]) { L.log(`  ! bỏ qua cột liên kết "${name}": chưa có bảng ${key}`); return; }
      body.property.table_id = resolved[key];
    }
  }
  try {
    await L.api(`/open-apis/bitable/v1/apps/${process.env.LARK_BASE_ID || process.env.LARK_APP_TOKEN}/tables/${tableId}/fields`,
      { method: 'POST', body: JSON.stringify(body) }, tk);
    L.log(`  + cột "${name}"`);
  } catch (e) {
    L.log(`  ! không thêm được cột "${name}": ${String(e.message || e).slice(0, 120)}`);
  }
}
