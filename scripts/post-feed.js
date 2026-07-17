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
 * ĐĂNG 1 BÀI LÊN NHIỀU PAGE: cột Page chọn bao nhiêu Page thì đăng lên bấy nhiêu, mỗi Page dùng
 * token riêng lấy từ bảng 14.1. Media chỉ tải về 1 lần rồi dùng lại cho mọi Page.
 * Page nào đã đăng xong được đánh dấu "✔ <pageId>" trong Log; chạy lại thì bỏ qua Page đó,
 * chỉ đăng nốt Page còn thiếu → đăng hỏng nửa chừng vẫn chạy lại an toàn, không đăng trùng.
 * Cột "Link bài đăng" gộp link của MỌI Page vào một chỗ, mỗi Page một dòng "Tên Page: link".
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

    // MỘT DÒNG CÓ THỂ CHỌN NHIỀU PAGE → đăng lần lượt lên từng Page.
    // Ô liên kết nhiều: lấy hết record_ids. Ô chữ: tách theo dấu phẩy / xuống dòng.
    // Page chọn rồi mà tra KHÔNG ra ở 14.1 thì gom vào "unknown" để báo lỗi — tuyệt đối không
    // lặng lẽ bỏ đi: bỏ đi thì dòng vẫn báo "Thành công" trong khi khách tưởng đã đăng đủ Page.
    const cell = f[pageField];
    const recIds = linkIds(cell);
    const targets = [], unknown = [];
    const keys = recIds.length ? recIds : L.plain(cell).split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    for (const k of keys) {
      const pg = recIds.length ? byRec.get(k) : byKey.get(k.toLowerCase());
      if (!pg) unknown.push(k);
      else if (!targets.some(t => t.fbId === pg.fbId)) targets.push(pg);   // chọn trùng Page thì chỉ đăng 1 lần
    }

    const atts = Array.isArray(f['Ảnh/video']) ? f['Ảnh/video'] : [];
    // Chưa chọn Page hoặc chưa đính file = dòng soạn dở → im lặng bỏ qua (không phải lỗi).
    if (atts.length === 0 || (!targets.length && !unknown.length)) { skip++; continue; }

    // Bấm nút đăng 1 dòng = đăng ngay, không xét lịch.
    if (RESPECT_SCHEDULE && !RECORD_ID) {
      const s = scheduleMs(f['Lịch đăng bài']);
      if (s && s > nowMs) { L.log(`  ⏳ ${id}: hẹn ${new Date(s).toISOString().slice(0, 16)}`); wait++; continue; }
    }

    // Page nào ĐÃ đăng thành công ở lần chạy trước thì bỏ qua — Log giữ dấu "✔ <pageId> <tên>: <link>".
    // Nhờ vậy dòng đăng hỏng nửa chừng, chạy lại chỉ đăng nốt Page còn thiếu, không đăng trùng.
    // Đọc luôn LINK cũ ra: Page bị bỏ qua lần này vẫn phải có mặt ở cột "Link bài đăng",
    // nếu không thì chạy lại sẽ ghi đè cột đó bằng mỗi link của Page vừa đăng nốt.
    const oldLog = L.plain(f['Log']);
    const alreadyDone = new Set([...oldLog.matchAll(/✔ (\d+)/g)].map(m => m[1]));
    const oldLinks = new Map();
    for (const m of oldLog.matchAll(/✔ (\d+) (.+?): (https?:\/\/\S+)/g)) oldLinks.set(m[1], { name: m[2].trim(), url: m[3] });

    const caption = L.plain(f['Nội dung']);
    const cmt = L.plain(f['Comment ebook']).trim();
    const loai = L.plain(f['Loại']);
    const kind = /video|reel/i.test(loai) ? 'reel'
      : /ảnh|hình|image|photo/i.test(loai) ? 'image'
        : (atts.some(isVid) ? 'reel' : 'image');
    const files = kind === 'reel' ? [atts.find(isVid) || atts[0]] : atts.filter(a => isImg(a) || !isVid(a));

    L.log(`  >> ${id} | ${targets.length} Page (${targets.map(p => p.name).join(', ')})${unknown.length ? ` | ✖ ${unknown.length} Page không tra được` : ''} | ${kind} | ${files.length} file | "${caption.slice(0, 40).replace(/\n/g, ' ')}"`);
    if (DRY) {
      targets.forEach(p => L.log(`     [DRY] sẽ đăng lên ${p.name}${alreadyDone.has(p.fbId) ? ' (đã đăng rồi — bỏ qua)' : ''}`));
      unknown.forEach(u => L.log(`     [DRY] ✖ ${u}: không thấy ở bảng 14.1 → chạy fetch-pages`));
      continue;
    }

    const tmp = [];
    const lines = [];        // dòng log của lần chạy này
    const links = new Map(); // fbId → {name, url}: link của MỌI Page, gộp cả lần chạy trước
    let okPages = 0, failPages = 0;

    // Page tra không ra tính là LỖI của dòng → dòng không thể "Thành công" khi còn thiếu Page.
    for (const u of unknown) {
      lines.push(`✖ ${u}: không thấy ở bảng 14.1 → chạy action fetch-pages rồi đăng lại`);
      L.log(`     ✖ ${u}: không có trong bảng 14.1`);
      failPages++;
    }

    try {
      // Tải media MỘT LẦN rồi dùng lại cho mọi Page.
      for (let i = 0; i < files.length && targets.length; i++) {
        const p = path.join(os.tmpdir(), `fb_${id}_${i}_${(files[i].name || 'media').replace(/[^\w.]/g, '')}`);
        await L.downloadMedia(tk, files[i].file_token, p, table);
        files[i].path = p; tmp.push(p);
      }

      for (const pg of targets) {
        if (alreadyDone.has(pg.fbId)) {
          const prev = oldLinks.get(pg.fbId);
          if (prev) links.set(pg.fbId, { name: pg.name || prev.name, url: prev.url });
          L.log(`     = ${pg.name}: đã đăng lần trước, bỏ qua`);
          okPages++; continue;
        }
        if (!pg.fbId || !pg.token) {
          L.log(`     ✖ ${pg.name}: thiếu ID/access_token ở bảng 14.1`);
          lines.push(`✖ ${pg.name}: thiếu ID/token`); failPages++; continue;
        }
        try {
          const res = kind === 'reel'
            ? await postReel(pg.fbId, pg.token, files[0], caption)
            : await postPhotos(pg.fbId, pg.token, files, caption);

          // Comment tự động — lỗi comment không được làm hỏng bài đã đăng.
          let note = '';
          if (cmt) {
            try { await postComment(pg.token, res.objectId, cmt); note = ' +cmt'; }
            catch (e) { note = ' (cmt lỗi)'; L.log(`     ! comment lỗi ở ${pg.name}: ${String(e.message || e).slice(0, 80)}`); }
          }
          links.set(pg.fbId, { name: pg.name, url: res.permalink });
          lines.push(`✔ ${pg.fbId} ${pg.name}: ${res.permalink}${note}`);
          L.log(`     ✔ ${pg.name}: ${res.permalink}`);
          okPages++;
        } catch (e) {
          const msg = String(e.message || e).slice(0, 160);
          lines.push(`✖ ${pg.name}: ${msg}`);
          L.log(`     ✖ ${pg.name}: ${msg}`);
          failPages++;
        }
      }
    } catch (e) {
      // Lỗi trước khi đăng được Page nào (thường là tải media hỏng).
      const msg = String(e.message || e).slice(0, 250);
      lines.push(`✖ ${msg}`);
      L.log(`     ✖ LỖI: ${msg}`);
      failPages++;
    } finally {
      tmp.forEach(p => { try { fs.unlinkSync(p); } catch { } });
    }

    // Chỉ "Thành công" khi MỌI Page đều xong — còn Page nào hỏng thì để Thất bại
    // để chạy lại đăng nốt (Page đã xong sẽ tự bị bỏ qua nhờ dấu ✔ trong Log).
    const total = targets.length + unknown.length;
    const all = failPages === 0 && okPages === total;
    const log = `${now()} - ${okPages}/${total} Page\n` + lines.join('\n');

    // MỘT cột "Link bài đăng" chứa link của TẤT CẢ Page — mỗi Page 1 dòng "Tên Page: link".
    // Base cũ để cột này kiểu URL thì chỉ nhét được 1 link → ghi link đầu, và nói rõ còn bao nhiêu
    // Page nữa để không ai tưởng là chỉ đăng được 1 Page (link đủ vẫn nằm ở Log).
    const list = [...links.values()];
    const linkValue = !list.length ? undefined
      : meta.get('Link bài đăng')?.type === 15
        ? { link: list[0].url, text: list.length > 1 ? `${list[0].name} +${list.length - 1} Page (xem Log)` : list[0].name }
        : list.map(x => `${x.name}: ${x.url}`).join('\n');

    await L.updateRecord(tk, table, id, {
      ...L.buildFields(meta, {
        'Trạng thái': all ? DONE : FAIL,
        'Log': (oldLog ? oldLog + '\n---\n' : '') + log,
        'Link bài đăng': linkValue,
      }),
      // Hạ cờ "Đăng ngay" để automation không bắn lại. Chỉ làm khi "Đăng" là cột CHỌN —
      // nếu là nút bấm (Button, type 3001) thì đó là cột chỉ đọc, ghi vào sẽ lỗi cả lô.
      ...(meta.get('Đăng') && meta.get('Đăng').type === 3 ? { 'Đăng': null } : {}),
    });
    if (all) ok++; else err++;
  }
  L.log(`Xong. Dòng đăng đủ: ${ok}, dòng có lỗi: ${err}, chờ giờ: ${wait}, bỏ qua: ${skip}.`);
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
