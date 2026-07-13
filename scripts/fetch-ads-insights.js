#!/usr/bin/env node
'use strict';
/*
 * fetch-ads-insights.js — Lấy số liệu quảng cáo THEO NGÀY về bảng "14.5".
 * Mỗi dòng = 1 quảng cáo × 1 ngày (khoá chống trùng = ID Quảng Cáo + Ngày bắt đầu).
 *
 *   node scripts/fetch-ads-insights.js            thêm dòng mới, cập nhật dòng đã có (số liệu FB chốt trễ vài ngày)
 *   node scripts/fetch-ads-insights.js --dry-run  chỉ in, không ghi Base
 *
 * Biến:
 *   DATE_PRESET  today | yesterday | last_7d | last_30d (mặc định) | last_90d | this_month | last_month | maximum
 *   SINCE, UNTIL 'YYYY-MM-DD' — nếu đặt cả hai thì dùng khoảng này, bỏ qua DATE_PRESET.
 *   AD_ACCOUNT_ID — chỉ lấy 1 tài khoản (vd act_123... hoặc 123...). Bỏ trống = lấy MỌI tài khoản.
 */
const L = require('./lib/lark');
const FB = require('./lib/fb');

const DRY = process.argv.includes('--dry-run');
const HINT = process.env.TABLE_ADS_DAILY || '14.5';
const DATE_PRESET = process.env.DATE_PRESET || 'last_30d';
const SINCE = (process.env.SINCE || '').trim();
const UNTIL = (process.env.UNTIL || '').trim();
const ONLY = (process.env.AD_ACCOUNT_ID || '').trim();

const n = v => (v == null || isNaN(v) ? 0 : Number(v));
// Ghi ngày ở 12:00 UTC: dù Base đặt múi giờ nào thì ngày hiển thị vẫn đúng, không lệch 1 ngày.
const dayMs = d => (d ? Date.parse(d + 'T12:00:00Z') : undefined);
const dayOf = ms => new Date(Number(ms)).toISOString().slice(0, 10);

(async () => {
  const info = await FB.checkToken();
  FB.requireScopes(info, ['ads_read']);

  let accs = await FB.adAccounts();
  if (ONLY) {
    const want = ONLY.replace(/^act_/, '');
    accs = accs.filter(a => a.account_id === want);
    if (!accs.length) throw new Error(`Không thấy tài khoản quảng cáo "${ONLY}" trong danh sách token này quản lý.`);
  }
  const range = SINCE && UNTIL ? `${SINCE} → ${UNTIL}` : DATE_PRESET;
  L.log(`Lấy số liệu ${accs.length} tài khoản, khoảng: ${range}`);

  const rows = [];
  for (const a of accs) {
    const data = await FB.insights(a.id, { datePreset: DATE_PRESET, since: SINCE, until: UNTIL });
    L.log(`  ${a.name}: ${data.length} dòng (ad × ngày)`);
    rows.push(...data);
  }
  L.log(`Tổng ${rows.length} dòng.`);
  if (!rows.length) {
    L.log('! Không có dòng nào. Thường là do khoảng thời gian không có quảng cáo chạy → thử DATE_PRESET=maximum.');
    return;
  }
  if (DRY) {
    rows.slice(0, 5).forEach(r => L.log(`  ${r.date_start} | ${r.ad_name} | chi=${r.spend} | hiển thị=${r.impressions} | mess=${FB.sumActions(r.actions, FB.ACTION.mess)}`));
    return;
  }

  const tk = await L.token();
  const table = await L.resolveTable(tk, HINT);
  const meta = await L.getFields(tk, table);

  // Chống trùng theo cặp (quảng cáo, ngày) — cùng 1 ad chạy nhiều ngày là nhiều dòng khác nhau.
  const existing = await L.listRecords(tk, table, undefined, ['ID Quảng Cáo', 'Ngày bắt đầu']);
  const seen = new Map();
  for (const r of existing) {
    const id = L.plain(r.fields['ID Quảng Cáo']).trim();
    const d = r.fields['Ngày bắt đầu'];
    if (id && d) seen.set(`${id}|${dayOf(d)}`, r.record_id);
  }

  const row = r => L.buildFields(meta, {
    'ID Quảng Cáo': r.ad_id,
    'Account ID': r.account_id,
    'Tên tài khoản': r.account_name,
    'ID Chiến Dịch': r.campaign_id,
    'Tên Chiến Dịch': r.campaign_name,
    'Tên Nhóm Quảng Cáo': r.adset_name,
    'Tên Quảng Cáo': r.ad_name,
    'Tổng chi phí': n(r.spend),
    'CPM': n(r.cpm),
    'CPC': n(r.cpc),
    'CTR': n(r.ctr),
    'Tần Suất': n(r.frequency),
    'Số Mess': FB.sumActions(r.actions, FB.ACTION.mess),
    'Số lần hiển thị': n(r.impressions),
    'Số lần nhấp': n(r.clicks),
    'Số người tiếp cận': n(r.reach),
    'Follow hoặc Like': FB.sumActions(r.actions, FB.ACTION.follow),
    'Lượt mua': FB.sumActions(r.actions, FB.ACTION.purchase),
    'Giá trị chuyển đổi từ lượt mua': FB.sumActions(r.action_values, FB.ACTION.purchase),
    'Page engagement': FB.sumActions(r.actions, FB.ACTION.pageEngagement),
    'Ngày bắt đầu': dayMs(r.date_start),
    'Ngày kết thúc': dayMs(r.date_stop),
  });

  const toCreate = [], toUpdate = [];
  for (const r of rows) {
    const key = `${r.ad_id}|${r.date_start}`;
    const hit = seen.get(key);
    // Luôn cập nhật dòng đã có: FB chốt số liệu trễ, chạy lại là số liệu mới nhất.
    if (hit) toUpdate.push({ record_id: hit, fields: row(r) });
    else toCreate.push({ fields: row(r) });
  }

  const added = await L.batchCreate(tk, table, toCreate);
  const updated = await L.batchUpdate(tk, table, toUpdate);
  L.log(`Xong. Thêm ${added} dòng, cập nhật ${updated} dòng.`);
})().catch(e => { console.error('\n✖ ' + (e.message || e)); process.exit(1); });
