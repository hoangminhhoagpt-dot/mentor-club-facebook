#!/usr/bin/env node
'use strict';
/*
 * fetch-pages.js — Lấy danh sách Fanpage (kèm access_token riêng của từng Page) về bảng "14.1".
 *
 *   node scripts/fetch-pages.js            thêm Page mới, không đụng Page đã có
 *   node scripts/fetch-pages.js --update   ghi đè lại token + thông tin (token Page có thể đổi)
 *   node scripts/fetch-pages.js --dry-run  chỉ in ra, không ghi Base
 *
 * Đây là engine PHẢI chạy ĐẦU TIÊN: mọi việc đăng bài đều lấy token Page từ bảng này.
 */
const L = require('./lib/lark');
const FB = require('./lib/fb');

const DRY = process.argv.includes('--dry-run');
const UPDATE = process.argv.includes('--update');
const HINT = process.env.TABLE_PAGES || '14.1';

(async () => {
  const info = await FB.checkToken();
  FB.requireScopes(info, ['pages_show_list']);
  L.log(`Token FB hợp lệ (quyền truy cập dữ liệu tới ${info.dataAccessExpires}).`);

  const pages = await FB.pages();
  L.log(`Facebook trả về ${pages.length} Page.`);
  if (!pages.length) L.log('! Không có Page nào — kiểm tra tài khoản FB có quản trị Page không.');
  if (DRY) {
    pages.forEach(p => L.log(`  ${p.id} | ${p.name} | ${p.category || '-'} | follower=${p.followers_count ?? p.fan_count ?? '-'}`));
    return;
  }

  const tk = await L.token();
  const table = await L.resolveTable(tk, HINT);
  const meta = await L.getFields(tk, table);
  L.log(`Bảng đích ${table} — cột: ${[...meta.keys()].join(' | ')}`);

  const existing = await L.listRecords(tk, table, undefined, ['ID']);
  const byId = new Map();
  for (const r of existing) {
    const id = L.plain(r.fields['ID']).trim();
    if (id) byId.set(id, r.record_id);
  }

  const row = p => L.buildFields(meta, {
    'Fanpage': p.name,
    'ID': p.id,
    'access_token': p.access_token,
    'Category': p.category,
    'Follower': p.followers_count ?? p.fan_count,
    'Avatar': p.picture && p.picture.data && p.picture.data.url,
  });

  const toCreate = [], toUpdate = [];
  for (const p of pages) {
    const hit = byId.get(p.id);
    if (hit) { if (UPDATE) toUpdate.push({ record_id: hit, fields: row(p) }); }
    else toCreate.push({ fields: row(p) });
  }

  const added = await L.batchCreate(tk, table, toCreate);
  const updated = await L.batchUpdate(tk, table, toUpdate);
  L.log(`Xong. Thêm ${added} Page, cập nhật ${updated}, bỏ qua ${pages.length - added - updated}.`);
  if (!UPDATE && pages.length - added > 0) L.log('  (Muốn làm mới token của Page đã có → chạy lại với mode "--update".)');
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
