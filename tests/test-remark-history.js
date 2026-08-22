/* ============================================================
   v2.7.6 — แก้หมายเหตุจากหน้าเอกสารต้องมีประวัติเหมือนหน้ายิง
   ============================================================

   v2.7.4 ทำให้หน้ายิงเขียนแถวประวัติ (scan record delta 0) คู่ไปกับ reasons
   แต่หน้าเอกสาร (saveReason) ยังเขียนทับ reasons ตรง ๆ ใครแก้ทับใครก็หายไปเลย
   v2.7.6 ปิดช่องนี้ — แต่ปิดได้เท่าที่ Database Rules ยอมเท่านั้น

   ข้อจำกัดที่ต้องทดสอบให้ชัด:
     rounds/{id}/reasons  Rules ยอมเมื่อ status != 'closed'   (counting + reviewing)
     rounds/{id}/scans    Rules ยอมเมื่อ status == 'counting' เท่านั้น
   ถ้าฝืนเขียน scan ตอน reviewing ฐานปฏิเสธถาวร และ flushQueue() ไม่ shift แถวที่
   ส่งไม่ผ่าน → คิวค้างหัวแถวตลอดกาล บล็อกทุก write ที่ตามมาทั้งแอป
   จึงต้องเขียนประวัติเฉพาะตอน counting และห้ามเขียนตอน reviewing เด็ดขาด
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate(() => {
    window.__toasts = []; window.__writes = []; window.__updates = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function (path, patch) {
      window.__updates.push({ path: path, patch: patch });
      return Promise.resolve();
    };
    window.db.newKey = (function () { let n = 0; return function () { return 'gen' + (++n); }; })();
    window.__realRenderDoc = window.renderDoc;
    window.renderDoc = function () {};
    hideLogin();

    window.__seed = function (role, status) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role || 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: status || 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job'; state.page = 'doc';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 10 };
      state.counts = { A1: 8 }; state.scanQty = { A1: 8 }; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.reasons = {}; state.remarkTs = {}; state.activeKey = null;
      state.cycleData = null; state.company = { name: 'บ.ทดสอบ', address: 'ที่อยู่' };
      state.docScope = 'job'; state.docScopeTouched = true; state.itemTab = 'items';
      buildScanIndex();
      window.__toasts = []; window.__writes = []; window.__updates = [];
    };

    window.__recs = function () {
      const out = [];
      window.__writes.forEach(function (w) {
        Object.keys(w.patch).forEach(function (k) {
          if (k.indexOf('scans/') === 0) out.push(w.patch[k]);
        });
      });
      return out;
    };
  });

  /* ---------- 1. ขั้นนับ — ต้องมีประวัติ ---------- */
  console.log('\n[1] ขั้นนับ (counting) — แก้จากหน้าเอกสารต้องได้ประวัติ');
  const r1 = await page.evaluate(async () => {
    window.__seed('admin', 'counting');
    await saveReason('A1', 'ของชำรุด');
    const rec = window.__recs()[0] || {};
    return {
      recs: window.__recs().length,
      mode: rec.mode, delta: rec.delta, text: rec.reason,
      user: rec.user, hasTs: !!rec.ts, code: rec.code,
      scanPath: (window.__writes[0] || {}).path,
      reason: state.reasons.A1,
      updates: window.__updates.length,
      updPatch: (window.__updates[0] || {}).patch,
      counts: state.counts.A1
    };
  });
  check('เขียนแถวประวัติ 1 แถว mode = remark',
        r1.recs === 1 && r1.mode === 'remark', r1);
  check('delta = 0 — ยอดนับไม่ขยับ', r1.delta === 0 && r1.counts === 8, r1);
  check('เก็บข้อความ + ใครแก้ + เมื่อไหร่',
        r1.text === 'ของชำรุด' && r1.user === 'สมชาย' && r1.hasTs === true &&
        r1.code === 'A1', r1);
  check('ประวัติลงที่ rounds/R1/scans (append-only)', r1.scanPath === 'rounds/R1', r1);
  check('ยังเขียน reasons/A1 คู่กันเหมือนเดิม',
        r1.updates === 1 && r1.updPatch['reasons/A1'] === 'ของชำรุด' &&
        r1.reason === 'ของชำรุด', r1);

  /* ---------- 2. แก้ทับ / ลบ ---------- */
  console.log('\n[2] แก้ทับและลบ — ของเดิมต้องยังอยู่ในประวัติ');
  const r2 = await page.evaluate(async () => {
    window.__seed('admin', 'counting');
    await saveReason('A1', 'ครั้งที่ 1');
    await saveReason('A1', 'ครั้งที่ 2');
    await saveReason('A1', '');
    const recs = window.__recs();
    return {
      count: recs.length,
      texts: recs.map(function (r) { return r.reason === undefined ? '(ลบ)' : r.reason; }),
      labels: recs.map(function (r) { return scanModeLabel(r); }),
      finalReason: 'A1' in state.reasons,
      lastPatch: window.__updates[window.__updates.length - 1].patch
    };
  });
  check('ได้ประวัติครบ 3 แถว (เขียน · แก้ทับ · ลบ)', r2.count === 3, r2.count);
  check('ของเดิมไม่ถูกลบ ไล่ย้อนได้ทุกครั้งที่แก้',
        JSON.stringify(r2.texts) === JSON.stringify(['ครั้งที่ 1', 'ครั้งที่ 2', '(ลบ)']), r2.texts);
  check('ป้ายในประวัติอ่านออกว่าแถวไหนใส่ แถวไหนลบ',
        JSON.stringify(r2.labels) ===
        JSON.stringify(['ใส่หมายเหตุ', 'ใส่หมายเหตุ', 'ลบหมายเหตุ']), r2.labels);
  check('ค่าสุดท้ายถูกล้างออกจริง',
        r2.finalReason === false && r2.lastPatch['reasons/A1'] === null, r2);

  /* ---------- 3. ⚠ ขั้นตรวจสอบ — ห้ามเขียน scan เด็ดขาด ---------- */
  console.log('\n[3] ⚠ ขั้นตรวจสอบ (reviewing) — แก้ได้ แต่ห้ามเขียน scan (คิวจะค้าง)');
  const r3 = await page.evaluate(async () => {
    window.__seed('admin', 'reviewing');
    const canWriteHist = remarkHistoryWritable();
    await saveReason('A1', 'แก้ตอนตรวจสอบ');
    return {
      canWriteHist: canWriteHist,
      scanWrites: window.__recs().length,
      queueWrites: window.__writes.length,
      updates: window.__updates.length,
      updPatch: (window.__updates[0] || {}).patch,
      reason: state.reasons.A1
    };
  });
  check('รู้ว่าเขียนประวัติไม่ได้ในสถานะนี้', r3.canWriteHist === false, r3.canWriteHist);
  check('⚠ ไม่เขียน scan แม้แต่แถวเดียว (ไม่งั้นคิวค้างทั้งแอป)',
        r3.scanWrites === 0 && r3.queueWrites === 0, r3);
  check('แต่ยังแก้หมายเหตุได้ตามปกติ — Rules ยอมให้เขียน reasons ตอน reviewing',
        r3.updates === 1 && r3.updPatch['reasons/A1'] === 'แก้ตอนตรวจสอบ' &&
        r3.reason === 'แก้ตอนตรวจสอบ', r3);

  /* ---------- 4. รอบปิดแล้ว ---------- */
  console.log('\n[4] รอบปิดแล้ว — แก้ไม่ได้ทั้งสองอย่าง');
  const r4 = await page.evaluate(async () => {
    window.__seed('admin', 'closed');
    await saveReason('A1', 'รอบปิดแล้วยังแก้');
    return { scanWrites: window.__recs().length, updates: window.__updates.length,
             reason: state.reasons.A1, toast: (window.__toasts[0] || {}).m };
  });
  check('ไม่เขียนอะไรเลยทั้ง scan และ reasons',
        r4.scanWrites === 0 && r4.updates === 0 && r4.reason === undefined, r4);
  check('บอกว่ารอบปิดแล้ว', /ปิดแล้ว/.test(r4.toast || ''), r4.toast);

  /* ---------- 5. ค่าเท่าเดิม ---------- */
  console.log('\n[5] ค่าเท่าเดิม — ห้ามได้ประวัติซ้ำจากการกดออกจากช่องเฉย ๆ');
  const r5 = await page.evaluate(async () => {
    window.__seed('admin', 'counting');
    await saveReason('A1', 'เหมือนเดิม');
    window.__writes = []; window.__updates = [];
    await saveReason('A1', 'เหมือนเดิม');
    await saveReason('A1', '   เหมือนเดิม   ');
    return { scanWrites: window.__recs().length, updates: window.__updates.length,
             reason: state.reasons.A1 };
  });
  check('กดซ้ำแล้วไม่เขียนอะไรเลย',
        r5.scanWrites === 0 && r5.updates === 0, r5);
  check('ช่องว่างหน้าหลังไม่นับเป็นการเปลี่ยนค่า', r5.reason === 'เหมือนเดิม', r5.reason);

  /* ---------- 6. หน้าเอกสารกับหน้ายิง ได้ประวัติแบบเดียวกัน ---------- */
  console.log('\n[6] สองทางต้องได้ประวัติหน้าตาเหมือนกัน');
  const r6 = await page.evaluate(async () => {
    window.__seed('counter', 'counting');
    await saveReason('A1', 'จากหน้าเอกสาร');
    const fromDoc = window.__recs()[0];

    window.__seed('counter', 'counting');
    state.page = 'scan';
    showScanHit('A1');
    await saveRemark('A1', 'จากหน้ายิง');
    const fromScan = window.__recs()[0];

    function shape(r) {
      return { mode: r.mode, delta: r.delta, hasCode: !!r.code,
               hasUser: !!r.user, hasTs: !!r.ts, hasZone: !!r.zone };
    }
    return { doc: shape(fromDoc), scan: shape(fromScan),
             docText: fromDoc.reason, scanText: fromScan.reason };
  });
  check('เรคอร์ดจากสองทางมีรูปร่างเหมือนกันเป๊ะ',
        JSON.stringify(r6.doc) === JSON.stringify(r6.scan), r6);
  check('ทั้งคู่เป็น mode remark · delta 0 · มีคน/เวลา/โซนครบ',
        r6.doc.mode === 'remark' && r6.doc.delta === 0 &&
        r6.doc.hasUser && r6.doc.hasTs && r6.doc.hasZone, r6.doc);
  check('ข้อความบันทึกถูกต้องทั้งสองทาง',
        r6.docText === 'จากหน้าเอกสาร' && r6.scanText === 'จากหน้ายิง', r6);

  /* ---------- 7. โผล่ในชีทประวัติของ Excel ---------- */
  console.log('\n[7] แถวที่แก้จากหน้าเอกสารต้องโผล่ในชีทประวัติ');
  const r7 = await page.evaluate(async () => {
    window.__seed('admin', 'counting');
    await saveReason('A1', 'ของชำรุด 2 ชิ้น');

    const realBuild = window.buildXlsx;
    let sheets = null;
    window.buildXlsx = function (s) { sheets = s; return realBuild(s); };
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function () { return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};
    await exportExcel();
    window.buildXlsx = realBuild;
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;

    const hist = sheets.filter(function (s) { return s.name === 'ประวัติการนับ'; })[0];
    const head = hist.rows[1];
    const rows = hist.rows.slice(2);
    const mi = head.indexOf('วิธีนับ'), ri = head.indexOf('เหตุผล'), qi = head.indexOf('จำนวน');
    const remarkRow = rows.filter(function (r) { return r[mi] === 'ใส่หมายเหตุ'; })[0];
    return { has: !!remarkRow, text: remarkRow && remarkRow[ri], qty: remarkRow && remarkRow[qi] };
  });
  check('แถวหมายเหตุโผล่ในชีทประวัติ', r7.has === true, r7);
  check('เก็บข้อความไว้ในช่องเหตุผล · จำนวน 0 ไม่รบกวนยอด',
        r7.text === 'ของชำรุด 2 ชิ้น' && r7.qty === 0, r7);

  /* ---------- 8. ป้ายเตือนบนช่องในเอกสาร ---------- */
  console.log('\n[8] ช่องในเอกสารต้องบอกตรง ๆ ว่าช่วงไหนไม่มีประวัติ');
  const r8 = await page.evaluate(() => {
    function titleOf() {
      window.__realRenderDoc();
      const row = document.querySelector('#docItemTables [data-code="A1"]');
      const input = row.querySelector('[data-reason]');
      return { title: input.title, readOnly: input.readOnly };
    }
    window.__seed('admin', 'counting');
    const counting = titleOf();
    window.__seed('admin', 'reviewing');
    const reviewing = titleOf();
    return { counting: counting, reviewing: reviewing };
  });
  check('ขั้นนับ — ไม่มีป้ายเตือน แก้ได้ปกติ',
        r8.counting.title === '' && r8.counting.readOnly === false, r8.counting);
  check('ขั้นตรวจสอบ — ยังแก้ได้ แต่บอกว่าเก็บประวัติไม่ได้',
        r8.reviewing.readOnly === false &&
        /เก็บประวัติการแก้ไม่ได้/.test(r8.reviewing.title || ''), r8.reviewing);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
