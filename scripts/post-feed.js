#!/usr/bin/env node
'use strict';
/*
 * post-feed.js — Đăng bài từ bảng "14.3" lên Facebook Page.
 *   Loại = "Hình ảnh" → đăng bài feed kèm ảnh (nhiều ảnh được).
 *   Loại = "Video"    → đăng REEL (upload phân mảnh, không giới hạn dung lượng qua Anycross).
 *
 *   node scripts/post-feed.js            đăng mọi dòng đủ điều kiện
 *   node scripts/post-feed.js --dry-run  liệt kê dòng sẽ đăng, không đăng thật
 *
 * Điều kiện 1 dòng được đăng: Trạng thái ≠ "Thành công" + chọn được Page + có file Ảnh/video
 *   + (Lịch đăng bài trống hoặc đã tới giờ).
 * Đặt RECORD_ID = đăng ĐÚNG dòng đó NGAY (bỏ qua kiểm tra lịch) — dùng cho nút bấm trong Lark Base.
 *
 * Token Facebook lấy TỪ bảng 14.1 theo từng Page, nên đăng được nhiều Page khác nhau.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const L = require('./lib/lark');
const FB = require('./lib/fb');

const DRY = process.argv.includes('--dry-run');
const HINT = process.env.TABLE_DANGBAI || '14.3';
const PAGES_HINT = process.env.TABLE_PAGES || '14.1';
const RECORD_ID = (process.env.RECORD_ID || '').trim();
const RESPECT_SCHEDULE = process.env.RESPECT_SCHEDULE !== 'false';
const CHUNK = Math.max(1, parseInt(process.env.REEL_CHUNK_MB || '8', 10)) * 1024 * 1024;
const RETRY = Math.max(1, parseInt(process.env.REEL_UPLOAD_RETRY || '5', 10));

const DONE = 'Thành công', FAIL = 'Thất bại';
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const isVid = a => /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(a.name || '') || /^video/i.test(a.type || '');
const isImg = a => /\.(jpe?g|png|gif|webp|bmp)$/i.test(a.name || '') || /^image/i.test(a.type || '');

// Ô liên kết: API trả [{record_ids:[…]}] khi list, {record_ids:[…]} khi đọc 1 dòng — gom cả hai dạng.
const linkIds = cell => {
  if (!cell) return [];
  const arr = Array.isArray(cell) ? cell : [cell];
  const out = [];
  for (const el of arr) {
    if (!el) continue;
    if (Array.isArray(el.record_ids)) out.push(...el.record_ids);
    else if (el.record_id) out.push(el.record_id);
    else if (typeof el === 'string') out.push(el);
  }
  return out.filter(Boolean);
};

const scheduleMs = cell => {
  if (cell == null) return null;
  if (typeof cell === 'number') return cell;
  const t = L.plain(cell).trim();
  if (!t) return null;
  const m = t.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  const d = new Date(t);
  return isNaN(d) ? null : d.getTime();
};

// ---------- Facebook: đăng ----------
async function postPhotos(pageId, token, files, caption) {
  const fbids = [];
  for (const f of files) {
    const fd = new FormData();
    fd.set('access_token', token);
    fd.set('published', 'false');
    fd.set('source', new Blob([fs.readFileSync(f.path)]), f.name || 'photo.jpg');
    const j = await FB.call(`${FB.GRAPH}/${pageId}/photos`, { method: 'POST', body: fd });
    if (!j.id) throw new Error('upload ảnh không trả về id');
    fbids.push(j.id);
  }
  const body = new URLSearchParams();
  body.set('access_token', token);
  if (caption) body.set('message', caption);
  fbids.forEach((id, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
  const post = await FB.call(`${FB.GRAPH}/${pageId}/feed`, { method: 'POST', body });
  return { objectId: post.id, permalink: `https://www.facebook.com/${post.id}` };
}

// Upload phân mảnh: đọc file theo chunk (không nạp cả video vào RAM), retry đúng chunk bị lỗi,
// và tôn trọng offset server trả về để resume — video nặng vẫn lên được.
async function uploadResumable(uploadUrl, token, filePath) {
  const total = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    while (offset < total) {
      const len = Math.min(CHUNK, total - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await fetch(uploadUrl, {
            method: 'POST',
            headers: { Authorization: `OAuth ${token}`, offset: String(offset), file_size: String(total) },
            body: buf,
          });
          const t = await r.text();
          let j; try { j = JSON.parse(t); } catch { j = {}; }
          if (!r.ok || j.error) throw new Error(`rupload ${r.status}: ${JSON.stringify(j.error || t).slice(0, 160)}`);
          offset = typeof j.offset === 'number' ? j.offset : offset + len;
          break;
        } catch (e) {
          if (attempt >= RETRY) throw new Error(`upload chunk @${offset} hỏng sau ${attempt} lần: ${String(e.message || e).slice(0, 160)}`);
          L.log(`     … chunk @${offset} lỗi (lần ${attempt}), thử lại`);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
      L.log(`     ↑ ${Math.min(offset, total)}/${total} bytes (${Math.round(offset / total * 100)}%)`);
    }
  } finally { fs.closeSync(fd); }
}

// Reel: 3 pha start → upload → finish. Video phải MP4 dọc 9:16, dài 3–90 giây.
async function postReel(pageId, token, file, caption) {
  const start = await FB.call(`${FB.GRAPH}/${pageId}/video_reels?upload_phase=start&access_token=${encodeURIComponent(token)}`, { method: 'POST' });
  if (!start.video_id || !start.upload_url) throw new Error('Reel start thiếu video_id/upload_url');
  await uploadResumable(start.upload_url, token, file.path);
  await FB.call(`${FB.GRAPH}/${pageId}/video_reels`, {
    method: 'POST',
    body: new URLSearchParams({ upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: caption || '', access_token: token }),
  });
  let permalink = '';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 6000));
    try {
      const st = await FB.get(start.video_id, { fields: 'status,permalink_url' }, token);
      if (st.permalink_url) permalink = st.permalink_url;
      const phase = st.status && (st.status.video_status || (st.status.processing_phase && st.status.processing_phase.status));
      if (phase === 'ready' || phase === 'PUBLISHED') break;
      if (phase === 'error') throw new Error('Facebook xử lý Reel lỗi: ' + JSON.stringify(st.status));
    } catch { /* đang xử lý, chờ tiếp */ }
  }
  if (permalink.startsWith('/')) permalink = 'https://www.facebook.com' + permalink;
  return { objectId: start.video_id, permalink: permalink || `https://www.facebook.com/${start.video_id}` };
}

const postComment = (token, objectId, message) =>
  FB.call(`${FB.GRAPH}/${objectId}/comments`, { method: 'POST', body: new URLSearchParams({ message, access_token: token }) });

// ---------- Chạy ----------
(async () => {
  const tk = await L.token();
  const table = await L.resolveTable(tk, HINT);
  const pagesTable = await L.resolveTable(tk, PAGES_HINT);
  const meta = await L.getFields(tk, table);

  // Bảng 14.1: tra Page theo record_id (cột liên kết) HOẶC theo ID/tên (cột chữ).
  const pageRecs = await L.listRecords(tk, pagesTable);
  const byRec = new Map(), byKey = new Map();
  for (const r of pageRecs) {
    const p = {
      fbId: L.plain(r.fields['ID']).trim(),
      token: L.plain(r.fields['access_token']).trim(),
      name: L.plain(r.fields['Fanpage']).trim(),
    };
    byRec.set(r.record_id, p);
    if (p.fbId) byKey.set(p.fbId.toLowerCase(), p);
    if (p.name) byKey.set(p.name.toLowerCase(), p);
  }
  if (!pageRecs.length) throw new Error('Bảng 14.1 chưa có Page nào → chạy action "fetch-pages" trước.');

  const pageField = [...meta.entries()].find(([, f]) => f.type === 18 || f.type === 21)?.[0]
    || [...meta.keys()].find(n => /page/i.test(n));
  L.log(`Cột chọn Page = "${pageField}" (${meta.get(pageField)?.type === 18 || meta.get(pageField)?.type === 21 ? 'liên kết' : 'chữ'}).`);

  let rows = await L.listRecords(tk, table);
  if (RECORD_ID) {
    rows = rows.filter(r => r.record_id === RECORD_ID);
    L.log(`Chỉ đăng dòng ${RECORD_ID} (khớp ${rows.length} dòng).`);
  }

  const nowMs = Date.now();
  let ok = 0, err = 0, wait = 0, skip = 0;

  for (const r of rows) {
    const id = r.record_id, f = r.fields;
    if (L.plain(f['Trạng thái']) === DONE) { skip++; continue; }

    // Page: ưu tiên ô liên kết, không có thì khớp theo chữ (ID hoặc tên Page).
    const cell = f[pageField];
    const recId = linkIds(cell)[0];
    const pg = recId ? byRec.get(recId) : byKey.get(L.plain(cell).trim().toLowerCase());

    const atts = Array.isArray(f['Ảnh/video']) ? f['Ảnh/video'] : [];
    if (!pg || atts.length === 0) { skip++; continue; }
    if (!pg.fbId || !pg.token) {
      L.log(`  ✖ ${id}: Page "${pg.name || '?'}" thiếu ID/access_token ở bảng 14.1`);
      if (!DRY) await L.updateRecord(tk, table, id, L.buildFields(meta, { 'Trạng thái': FAIL, 'Log': `${now()} - Page thiếu ID/token` }));
      err++; continue;
    }
    // Bấm nút đăng 1 dòng = đăng ngay, không xét lịch.
    if (RESPECT_SCHEDULE && !RECORD_ID) {
      const s = scheduleMs(f['Lịch đăng bài']);
      if (s && s > nowMs) { L.log(`  ⏳ ${id}: hẹn ${new Date(s).toISOString().slice(0, 16)}`); wait++; continue; }
    }

    const caption = L.plain(f['Nội dung']);
    const loai = L.plain(f['Loại']);
    const kind = /video|reel/i.test(loai) ? 'reel'
      : /ảnh|hình|image|photo/i.test(loai) ? 'image'
        : (atts.some(isVid) ? 'reel' : 'image');
    const files = kind === 'reel' ? [atts.find(isVid) || atts[0]] : atts.filter(a => isImg(a) || !isVid(a));

    L.log(`  >> ${id} | ${pg.name} | ${kind} | ${files.length} file | "${caption.slice(0, 40).replace(/\n/g, ' ')}"`);
    if (DRY) continue;

    const tmp = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const p = path.join(os.tmpdir(), `fb_${id}_${i}_${(files[i].name || 'media').replace(/[^\w.]/g, '')}`);
        await L.downloadMedia(tk, files[i].file_token, p, table);
        files[i].path = p; tmp.push(p);
      }
      const res = kind === 'reel'
        ? await postReel(pg.fbId, pg.token, files[0], caption)
        : await postPhotos(pg.fbId, pg.token, files, caption);

      // Comment tự động (thả link ebook) — lỗi comment không được làm hỏng bài đã đăng.
      let note = '';
      const cmt = L.plain(f['Comment ebook']).trim();
      if (cmt) {
        try { await postComment(pg.token, res.objectId, cmt); note = ' +comment'; }
        catch (e) { note = ' (comment lỗi)'; L.log(`     ! comment lỗi: ${String(e.message || e).slice(0, 100)}`); }
      }
      await L.updateRecord(tk, table, id, {
        ...L.buildFields(meta, { 'Trạng thái': DONE, 'Link bài đăng': res.permalink, 'Log': `${now()} - OK - ${res.objectId}${note}` }),
        ...(meta.has('Đăng') ? { 'Đăng': null } : {}),   // hạ cờ để automation không bắn lại dòng này
      });
      L.log(`     ✔ ĐÃ ĐĂNG: ${res.permalink}`);
      ok++;
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      L.log(`     ✖ LỖI: ${msg}`);
      try {
        await L.updateRecord(tk, table, id, {
          ...L.buildFields(meta, { 'Trạng thái': FAIL, 'Log': `${now()} - LỖI - ${msg}` }),
          ...(meta.has('Đăng') ? { 'Đăng': null } : {}),
        });
      } catch { /* ghi log lỗi thất bại thì thôi, đã in ra console */ }
      err++;
    } finally {
      tmp.forEach(p => { try { fs.unlinkSync(p); } catch { } });
    }
  }
  L.log(`Xong. Đăng ${ok}, lỗi ${err}, chờ giờ ${wait}, bỏ qua ${skip}.`);
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
