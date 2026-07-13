#!/usr/bin/env node
'use strict';
/*
 * fetch-adaccounts.js — Lấy danh sách tài khoản quảng cáo + tổng chi tiêu về bảng "14.4".
 *
 *   node scripts/fetch-adaccounts.js            thêm tài khoản mới
 *   node scripts/fetch-adaccounts.js --update   làm mới tổng chi tiêu của tài khoản đã có (nên chạy định kỳ)
 *   node scripts/fetch-adaccounts.js --dry-run  chỉ in, không ghi Base
 *
 * Lưu ý tiền tệ: Facebook trả amount_spent theo ĐƠN VỊ NHỎ NHẤT (VND không có số lẻ nên = đồng).
 * Cột VAT / Chi tiêu (VAT) trong bảng là CÔNG THỨC — tự tính, engine không ghi vào.
 */
const L = require('./lib/lark');
const FB = require('./lib/fb');

const DRY = process.argv.includes('--dry-run');
const UPDATE = process.argv.includes('--update');
const HINT = process.env.TABLE_ADS_ACCOUNT || '14.4';
const STATUS = { 1: 'Đang hoạt động', 2: 'Tạm dừng', 3: 'Tạm dừng', 7: 'Tạm dừng', 9: 'Tạm dừng', 101: 'Tạm dừng' };

(async () => {
  const info = await FB.checkToken();
  FB.requireScopes(info, ['ads_read']);

  const accs = await FB.adAccounts();
  L.log(`Facebook trả về ${accs.length} tài khoản quảng cáo.`);
  if (DRY) {
    accs.forEach(a => L.log(`  ${a.account_id} | ${a.name} | ${a.currency} | đã tiêu ${a.amount_spent}`));
    return;
  }

  const tk = await L.token();
  const table = await L.resolveTable(tk, HINT);
  const meta = await L.getFields(tk, table);

  const existing = await L.listRecords(tk, table, undefined, ['Account ID']);
  const byId = new Map();
  for (const r of existing) {
    const id = L.plain(r.fields['Account ID']).trim();
    if (id) byId.set(id, r.record_id);
  }

  const row = a => L.buildFields(meta, {
    'Account ID': a.account_id,
    'Tên tài khoản': a.name,
    'Tổng chi tiêu': Number(a.amount_spent || 0),
    'Loại tiền tệ': a.currency,
    'Trạng thái TK': STATUS[a.account_status] || 'Tạm dừng',
    'Ngày tạo': a.created_time ? new Date(a.created_time).getTime() : undefined,
  });

  const toCreate = [], toUpdate = [];
  for (const a of accs) {
    const hit = byId.get(a.account_id);
    if (hit) { if (UPDATE) toUpdate.push({ record_id: hit, fields: row(a) }); }
    else toCreate.push({ fields: row(a) });
  }

  const added = await L.batchCreate(tk, table, toCreate);
  const updated = await L.batchUpdate(tk, table, toUpdate);
  L.log(`Xong. Thêm ${added}, cập nhật ${updated}, bỏ qua ${accs.length - added - updated}.`);
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
