'use strict';
/*
 * lark.js — lớp lõi dùng chung cho mọi engine Facebook → Lark Base.
 *
 * Hai việc quan trọng nhất ở đây:
 *  1) resolveTable(): tìm bảng theo TÊN (vd "14.1") chứ không bắt người dùng đi copy table_id.
 *  2) buildFields(): ghi giá trị THEO ĐÚNG KIỂU CỘT thật của bảng, và bỏ qua cột không tồn tại.
 *     Nhờ vậy một engine chạy được trên cả bảng mẫu mới lẫn bảng cũ của khách (dù họ đổi kiểu cột).
 */
const fs = require('fs');
const path = require('path');

const DOMAIN = (process.env.LARK_DOMAIN || 'https://open.larksuite.com').replace(/\/+$/, '');
const APP_ID = process.env.LARK_APP_ID || '';
const APP_SECRET = process.env.LARK_APP_SECRET || '';
const BASE_ID = process.env.LARK_BASE_ID || process.env.LARK_APP_TOKEN || '';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Kiểu cột Lark chỉ đọc — không bao giờ ghi vào (ghi sẽ lỗi cả lô).
const READONLY = new Set([19, 20, 23, 1001, 1002, 1003, 1004, 1005]);

/** Đọc giá trị cell về dạng chuỗi thuần, bất kể Lark trả kiểu gì. */
const plain = v => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(x => (x && (x.text || x.name)) || '').join('');
  return v.text || v.name || v.link || String(v);
};

async function api(url, opt = {}, tk) {
  const r = await fetch(DOMAIN + url, {
    ...opt,
    headers: {
      Authorization: 'Bearer ' + tk,
      'Content-Type': 'application/json; charset=utf-8',
      ...(opt.headers || {}),
    },
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Lark ${url} → ${j.code}: ${j.msg || JSON.stringify(j)}`);
  return j.data;
}

async function token() {
  if (!APP_ID || !APP_SECRET) throw new Error('Thiếu LARK_APP_ID / LARK_APP_SECRET');
  const r = await fetch(DOMAIN + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('Lark token: ' + JSON.stringify(j));
  return j.tenant_access_token;
}

async function listTables(tk, base = BASE_ID) {
  const d = await api(`/open-apis/bitable/v1/apps/${base}/tables?page_size=100`, {}, tk);
  return d.items || [];
}

/**
 * Tìm table_id từ "gợi ý": có thể là table_id sẵn (tbl...), hoặc tiền tố tên bảng ("14.1").
 * So khớp bỏ dấu cách thừa nên "14.5  Facebook ads" vẫn khớp "14.5".
 */
async function resolveTable(tk, hint, base = BASE_ID) {
  if (!hint) throw new Error('Thiếu gợi ý bảng (table_id hoặc tiền tố tên như "14.1")');
  if (/^tbl\w+$/.test(hint)) return hint;
  const tables = await listTables(tk, base);
  const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const h = norm(hint);
  const hit =
    tables.find(t => norm(t.name) === h) ||
    tables.find(t => norm(t.name).startsWith(h)) ||
    tables.find(t => norm(t.name).includes(h));
  if (!hit) {
    throw new Error(
      `Không thấy bảng khớp "${hint}" trong base ${base}.\n` +
      `   Bảng đang có: ${tables.map(t => t.name).join(' | ') || '(trống)'}\n` +
      `   → Chạy action "init-tables" để tạo bộ bảng mẫu.`
    );
  }
  return hit.table_id;
}

/** Map tên cột → {id, type} của bảng thật. */
async function getFields(tk, tableId, base = BASE_ID) {
  const d = await api(`/open-apis/bitable/v1/apps/${base}/tables/${tableId}/fields?page_size=200`, {}, tk);
  const meta = new Map();
  for (const f of d.items || []) meta.set(f.field_name, { id: f.field_id, type: f.type, ui: f.ui_type });
  return meta;
}

/** Ép 1 giá trị về đúng định dạng mà kiểu cột đó chấp nhận. Trả undefined = bỏ qua cột. */
function coerce(type, v) {
  if (v == null || v === '') return undefined;
  switch (type) {
    case 1: return String(v);                                            // Text
    case 2: {                                                            // Number / Currency
      const n = Number(v);
      return isFinite(n) ? n : undefined;
    }
    case 3: return String(v);                                            // SingleSelect (Lark tự thêm option mới)
    case 4: return Array.isArray(v) ? v.map(String) : [String(v)];       // MultiSelect
    case 5: {                                                            // DateTime → epoch ms
      if (typeof v === 'number') return v;
      const t = new Date(v).getTime();
      return isNaN(t) ? undefined : t;
    }
    case 7: return Boolean(v);                                           // Checkbox
    case 15:                                                             // Url
      return typeof v === 'object' ? v : { link: String(v), text: String(v) };
    case 17:                                                             // Attachment
      return (Array.isArray(v) ? v : [v]).map(x => (typeof x === 'string' ? { file_token: x } : x));
    case 18: case 21:                                                    // Link (1 chiều / 2 chiều)
      return (Array.isArray(v) ? v : [v]).map(String);
    default: return String(v);
  }
}

/**
 * Ghép object {tên cột: giá trị} thành payload fields hợp lệ:
 * bỏ cột không có trong bảng, bỏ cột chỉ đọc, ép kiểu đúng.
 */
function buildFields(meta, obj) {
  const out = {};
  for (const [name, val] of Object.entries(obj)) {
    const f = meta.get(name);
    if (!f || READONLY.has(f.type)) continue;
    const c = coerce(f.type, val);
    if (c !== undefined) out[name] = c;
  }
  return out;
}

async function listRecords(tk, tableId, base = BASE_ID, fieldNames) {
  let items = [], pt = '';
  const fn = fieldNames ? '&field_names=' + encodeURIComponent(JSON.stringify(fieldNames)) : '';
  do {
    const d = await api(
      `/open-apis/bitable/v1/apps/${base}/tables/${tableId}/records?page_size=500${fn}` + (pt ? '&page_token=' + pt : ''),
      {}, tk);
    items = items.concat(d.items || []);
    pt = d.has_more ? d.page_token : '';
  } while (pt);
  return items;
}

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, n + i)); return o; };

async function batchCreate(tk, tableId, records, base = BASE_ID) {
  let n = 0;
  for (const c of chunk(records, 500)) {
    const d = await api(`/open-apis/bitable/v1/apps/${base}/tables/${tableId}/records/batch_create`,
      { method: 'POST', body: JSON.stringify({ records: c }) }, tk);
    n += (d.records || []).length;
  }
  return n;
}

async function batchUpdate(tk, tableId, records, base = BASE_ID) {
  let n = 0;
  for (const c of chunk(records, 500)) {
    const d = await api(`/open-apis/bitable/v1/apps/${base}/tables/${tableId}/records/batch_update`,
      { method: 'POST', body: JSON.stringify({ records: c }) }, tk);
    n += (d.records || []).length;
  }
  return n;
}

async function updateRecord(tk, tableId, recordId, fields, base = BASE_ID) {
  return api(`/open-apis/bitable/v1/apps/${base}/tables/${tableId}/records/${recordId}`,
    { method: 'PUT', body: JSON.stringify({ fields }) }, tk);
}

/** Số revision của 1 bảng — Base bật QUYỀN NÂNG CAO thì tải file bắt buộc phải kèm số này. */
async function tableRevision(tk, tableId, base = BASE_ID) {
  try {
    const tables = await listTables(tk, base);
    const t = tables.find(x => x.table_id === tableId);
    if (t && t.revision != null) return t.revision;
  } catch { /* không lấy được thì thôi, vẫn thử các cách còn lại */ }
  try {
    const d = await api(`/open-apis/bitable/v1/apps/${base}`, {}, tk);
    return d.app && d.app.revision;
  } catch { return undefined; }
}

/**
 * Tải file đính kèm của Lark về đĩa (dùng khi đăng bài: lấy ảnh/video từ Base ra).
 *
 * Base bật QUYỀN NÂNG CAO (advanced permission) thì endpoint download BẮT BUỘC có
 * extra = {"bitablePerm":{"tableId":…,"rev":…}} — thiếu là trả JSON lỗi thay vì file.
 * Base thường thì không cần. Nên thử lần lượt từ đầy đủ nhất xuống, cách nào ra file thì lấy.
 */
async function downloadMedia(tk, fileToken, outPath, tableId, base = BASE_ID) {
  const rev = await tableRevision(tk, tableId, base);
  const extras = [
    rev != null ? { bitablePerm: { tableId, rev } } : null,  // Base bật quyền nâng cao
    { bitablePerm: { tableId } },                            // Base thường
    null,                                                    // không kèm gì
  ].filter(e => e !== undefined);

  const errs = [];
  for (const ex of extras) {
    const qs = ex ? '?extra=' + encodeURIComponent(JSON.stringify(ex)) : '';
    const r = await fetch(`${DOMAIN}/open-apis/drive/v1/medias/${fileToken}/download${qs}`,
      { headers: { Authorization: 'Bearer ' + tk } });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && !ct.includes('json')) {
      const b = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(outPath, b);
      return b.length;
    }
    errs.push(`${ex ? 'extra=' + JSON.stringify(ex) : 'không extra'} → ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  throw new Error(
    `Không tải được file ${fileToken} từ Lark.\n` +
    `   Base bật quyền nâng cao thì app phải là CỘNG TÁC VIÊN có quyền Chỉnh sửa của Base đó.\n` +
    `   Đã thử: ${errs.join(' | ')}`
  );
}

/**
 * Tải ảnh từ URL ngoài (vd thumbnail FB) rồi upload vào Lark, trả file_token để ghi vào cột đính kèm.
 * Truyền tableId để có đường lùi cho Base bật quyền nâng cao (lần 2 gửi kèm extra).
 */
async function uploadFromUrl(tk, url, fileName, base = BASE_ID, tableId) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('tải ảnh nguồn lỗi ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());

  const send = async extra => {
    const fd = new FormData();
    fd.set('file_name', fileName);
    fd.set('parent_type', 'bitable_image');
    fd.set('parent_node', base);
    fd.set('size', String(buf.length));
    if (extra) fd.set('extra', JSON.stringify(extra));
    fd.set('file', new Blob([buf]), fileName);
    const up = await fetch(DOMAIN + '/open-apis/drive/v1/medias/upload_all', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tk }, body: fd,
    });
    return up.json();
  };

  let j = await send(null);
  if (j.code !== 0 && tableId) {
    const rev = await tableRevision(tk, tableId, base);
    j = await send({ bitablePerm: { tableId, ...(rev != null ? { rev } : {}) } });
  }
  if (j.code !== 0) throw new Error('upload lên Lark lỗi: ' + JSON.stringify(j).slice(0, 160));
  return j.data.file_token;
}

module.exports = {
  DOMAIN, APP_ID, BASE_ID, log, plain, chunk, READONLY,
  api, token, listTables, resolveTable, getFields, coerce, buildFields,
  listRecords, batchCreate, batchUpdate, updateRecord,
  tableRevision, downloadMedia, uploadFromUrl,
};
