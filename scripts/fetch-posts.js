#!/usr/bin/env node
'use strict';
/*
 * fetch-posts.js — Lấy bài đã đăng của TẤT CẢ Page trong bảng 14.1 về bảng "14.2",
 * kèm số liệu tương tác tách theo từng loại cảm xúc (LIKE/LOVE/HAHA/WOW/SAD/ANGRY/CARE).
 *
 *   node scripts/fetch-posts.js            chỉ thêm bài mới
 *   node scripts/fetch-posts.js --update   làm mới số liệu của cả bài đã có (share/cmt/reaction thay đổi theo thời gian)
 *   node scripts/fetch-posts.js --dry-run  chỉ in, không ghi Base
 *
 * Biến: POSTS_PER_PAGE (mặc định 50 bài/Page, 0 = lấy hết), POSTS_THUMBNAIL=false để bỏ qua tải ảnh bìa (chạy nhanh hơn).
 */
const L = require('./lib/lark');
const FB = require('./lib/fb');

const DRY = process.argv.includes('--dry-run');
const UPDATE = process.argv.includes('--update');
const HINT = process.env.TABLE_POSTS || '14.2';
const PAGES_HINT = process.env.TABLE_PAGES || '14.1';
const PER_PAGE = parseInt(process.env.POSTS_PER_PAGE || '50', 10);
const THUMB = process.env.POSTS_THUMBNAIL !== 'false';

const n = v => (v == null || isNaN(v) ? 0 : Number(v));
const rc = (p, k) => n(p[k] && p[k].summary && p[k].summary.total_count);

(async () => {
  const info = await FB.checkToken();
  FB.requireScopes(info, ['pages_show_list', 'pages_read_engagement']);

  const tk = DRY ? null : await L.token();

  // Nguồn Page: đọc từ bảng 14.1 để dùng đúng token đã lưu; nếu bảng trống thì hỏi thẳng Facebook.
  let pages = [], pageRecByFbId = new Map();
  if (!DRY) {
    const pagesTable = await L.resolveTable(tk, PAGES_HINT);
    const recs = await L.listRecords(tk, pagesTable, undefined, ['ID', 'Fanpage', 'access_token']);
    for (const r of recs) {
      const id = L.plain(r.fields['ID']).trim();
      const token = L.plain(r.fields['access_token']).trim();
      if (!id) continue;
      pageRecByFbId.set(id, r.record_id);
      if (token) pages.push({ id, name: L.plain(r.fields['Fanpage']).trim(), access_token: token });
    }
    L.log(`Bảng 14.1 có ${pages.length} Page kèm token.`);
  }
  if (!pages.length) {
    L.log('→ Lấy Page trực tiếp từ Facebook (bảng 14.1 chưa có token — nên chạy action fetch-pages trước).');
    pages = await FB.pages();
  }

  const all = [];
  for (const pg of pages) {
    const posts = await FB.posts(pg.id, pg.access_token, PER_PAGE);
    L.log(`  ${pg.name || pg.id}: ${posts.length} bài`);
    posts.forEach(p => all.push({ ...p, _pageId: pg.id, _pageName: pg.name || '' }));
  }
  L.log(`Tổng ${all.length} bài.`);
  if (DRY) {
    all.slice(0, 10).forEach(p => L.log(`  ${p.id} | ${p.created_time} | react=${rc(p, 'reactions')} cmt=${rc(p, 'comments')} share=${n(p.shares && p.shares.count)}`));
    return;
  }

  const table = await L.resolveTable(tk, HINT);
  const meta = await L.getFields(tk, table);

  const existing = await L.listRecords(tk, table, undefined, ['Post-ID']);
  const byId = new Map();
  for (const r of existing) {
    const id = L.plain(r.fields['Post-ID']).trim();
    if (id) byId.set(id, r.record_id);
  }

  const row = (p, thumbToken) => {
    const react = rc(p, 'reactions');
    const cmt = rc(p, 'comments');
    const share = n(p.shares && p.shares.count);
    const pageRec = pageRecByFbId.get(p._pageId);
    return L.buildFields(meta, {
      'Post-ID': p.id,
      'Page': pageRec ? [pageRec] : undefined,
      'Fanpage': p._pageName,
      'Nội dung': p.message || '',
      'Link post': p.permalink_url,
      'Thumbnail': thumbToken ? [thumbToken] : undefined,
      'Lượt share': share,
      'Lượt bình luận': cmt,
      'Số tương tác': react + cmt + share,
      'LIKE': rc(p, 'r_like'), 'LOVE': rc(p, 'r_love'), 'HAHA': rc(p, 'r_haha'), 'WOW': rc(p, 'r_wow'),
      'SAD': rc(p, 'r_sad'), 'ANGRY': rc(p, 'r_angry'), 'CARE': rc(p, 'r_care'),
      'Ngày đăng': p.created_time ? new Date(p.created_time).getTime() : undefined,
    });
  };

  const isNew = p => !byId.has(p.id);
  const targets = UPDATE ? all : all.filter(isNew);

  // Ảnh bìa: chỉ tải cho bài MỚI (bài cũ đã có ảnh rồi) và chỉ khi bảng thật sự có cột Thumbnail.
  const thumbs = new Map();
  if (THUMB && meta.has('Thumbnail')) {
    const need = targets.filter(p => isNew(p) && p.full_picture);
    L.log(`Tải ${need.length} ảnh bìa lên Lark…`);
    let done = 0;
    const worker = async queue => {
      for (const p of queue) {
        try { thumbs.set(p.id, await L.uploadFromUrl(tk, p.full_picture, `${p.id}.jpg`, undefined, table)); }
        catch (e) { L.log(`  ! ảnh bìa ${p.id} lỗi: ${String(e.message || e).slice(0, 80)}`); }
        if (++done % 20 === 0) L.log(`  … ${done}/${need.length}`);
      }
    };
    const lanes = Array.from({ length: 4 }, (_, i) => need.filter((_, k) => k % 4 === i));
    await Promise.all(lanes.map(worker));
  }

  const toCreate = [], toUpdate = [];
  for (const p of targets) {
    const fields = row(p, thumbs.get(p.id));
    const hit = byId.get(p.id);
    if (hit) toUpdate.push({ record_id: hit, fields });
    else toCreate.push({ fields });
  }

  const added = await L.batchCreate(tk, table, toCreate);
  const updated = await L.batchUpdate(tk, table, toUpdate);
  L.log(`Xong. Thêm ${added} bài, cập nhật ${updated}, bỏ qua ${all.length - added - updated}.`);
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
