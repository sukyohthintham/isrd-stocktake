/* ============================================================
   v2.7.4 — หมายเหตุต่อ SKU ต่อรอบนับ (Remark)
   ============================================================

   ช่องนี้เล่าว่า "รอบนี้เจออะไร" เช่น ของชำรุด 2 ชิ้น · เจอที่หลังชั้น
   คนละเรื่องกับ products/{key}/note ซึ่งเป็นหมายเหตุถาวรติดตัวสินค้าข้ามทุกรอบ

   เก็บสองที่โดยตั้งใจ (เขียนคู่):
     scans (mode 'remark', delta 0)  = ประวัติ append-only แก้/ลบของเดิมไม่ได้ตาม Rules
     reasons/{key}                   = ช่องอ่านเร็วที่เอกสารกับ Excel ใช้อยู่แล้ว
   ทั้งสอง path มีใน Database Rules อยู่แล้ว — ไม่ได้เพิ่มโครงสร้าง Firebase ใหม่

   เส้นแบ่งที่ต้องไม่พลาด:
   - delta 0 → ห้ามกระทบยอดนับใด ๆ
   - ลบหมายเหตุ → แถวเดิมต้องยังอยู่ในประวัติ (กฎบ้าน ห้ามลบของเดิม)
   - scanner ไม่เห็นช่อง และเรียกฟังก์ชันตรง ๆ ก็ไม่ผ่าน
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

    window.__seed = function (role) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role, branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job'; state.page = 'scan';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10,
              note: 'หมายเหตุถาวรจาก Master' },
        B2: { code: 'B2', name: 'สินค้า B', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 10, B2: 5 };
      state.counts = { A1: 3, B2: 5 };
      state.scanQty = { A1: 3, B2: 5 }; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.reasons = {}; state.remarkTs = {}; state.activeKey = null;
      state.cycleData = null; state.company = { name: 'บ.ทดสอบ', address: 'ที่อยู่' };
      state.docScope = 'job'; state.docScopeTouched = true; state.itemTab = 'items';
      buildScanIndex();
      window.__toasts = []; window.__writes = []; window.__updates = [];
      showScanHit('A1');                    // จำลองว่ายิง A1 แล้ว การ์ดโชว์ A1 อยู่
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

  /* ---------- 1. เขียนหมายเหตุ ---------- */
  console.log('\n[1] ใส่หมายเหตุ — ต้องเขียนคู่ ทั้งประวัติและช่องอ่านเร็ว');
  const r1 = await page.evaluate(async () => {
    window.__seed('counter');
    const countsBefore = JSON.stringify(state.counts);
    await saveRemark('A1', 'ของชำรุด 2 ชิ้น อยู่หลังชั้น');
    const rec = window.__recs()[0] || {};
    return {
      countsBefore: countsBefore, countsAfter: JSON.stringify(state.counts),
      reason: state.reasons.A1,
      scanWrites: window.__recs().length,
      scanPath: (window.__writes[0] || {}).path,
      delta: rec.delta, mode: rec.mode, text: rec.reason,
      user: rec.user, hasTs: !!rec.ts, code: rec.code,
      updates: window.__updates.length,
      updPath: (window.__updates[0] || {}).path,
      updPatch: (window.__updates[0] || {}).patch,
      toast: (window.__toasts[0] || {}).m
    };
  });
  check('เขียน scan record 1 แถว mode = remark',
        r1.scanWrites === 1 && r1.mode === 'remark', r1);
  check('delta = 0 — ยอดนับไม่ขยับแม้แต่ตัวเดียว',
        r1.delta === 0 && r1.countsBefore === r1.countsAfter, r1);
  check('เก็บข้อความ + ใครใส่ + เมื่อไหร่ + รหัสสินค้า',
        r1.text === 'ของชำรุด 2 ชิ้น อยู่หลังชั้น' && r1.user === 'สมชาย' &&
        r1.hasTs === true && r1.code === 'A1', r1);
  check('ลงที่ rounds/R1/scans (append-only ตาม Rules)', r1.scanPath === 'rounds/R1', r1);
  check('เขียน reasons/A1 คู่กันไปด้วย 1 ครั้ง',
        r1.updates === 1 && r1.updPath === 'rounds/R1' &&
        r1.updPatch['reasons/A1'] === 'ของชำรุด 2 ชิ้น อยู่หลังชั้น', r1);
  check('state อ่านค่าได้ทันที ไม่ต้องรอ subscription',
        r1.reason === 'ของชำรุด 2 ชิ้น อยู่หลังชั้น', r1.reason);
  check('บอกผู้ใช้ว่าบันทึกแล้ว', /บันทึกหมายเหตุ A1 แล้ว/.test(r1.toast || ''), r1.toast);

  /* ---------- 2. แก้ทับ ---------- */
  console.log('\n[2] แก้หมายเหตุทับ — ของเดิมต้องยังอยู่ในประวัติ');
  const r2 = await page.evaluate(async () => {
    window.__seed('counter');
    await saveRemark('A1', 'ครั้งที่ 1');
    await saveRemark('A1', 'ครั้งที่ 2');
    const recs = window.__recs();
    return { reason: state.reasons.A1, recs: recs.map(function (r) { return r.reason; }),
             count: recs.length };
  });
  check('ค่าล่าสุดชนะ', r2.reason === 'ครั้งที่ 2', r2.reason);
  check('ประวัติเก็บครบ 2 แถว ของเดิมไม่ถูกลบ',
        r2.count === 2 && JSON.stringify(r2.recs) === JSON.stringify(['ครั้งที่ 1', 'ครั้งที่ 2']), r2);

  /* ---------- 3. ลบหมายเหตุ ---------- */
  console.log('\n[3] ลบหมายเหตุ — ต้องยังมีร่องรอยในประวัติ');
  const r3 = await page.evaluate(async () => {
    window.__seed('counter');
    await saveRemark('A1', 'จะลบทีหลัง');
    window.__writes = []; window.__updates = []; window.__toasts = [];
    await saveRemark('A1', '');
    const rec = window.__recs()[0] || {};
    return { reason: state.reasons.A1, has: 'A1' in state.reasons,
             recs: window.__recs().length, mode: rec.mode, delta: rec.delta,
             text: rec.reason, label: scanModeLabel(rec),
             updPatch: (window.__updates[0] || {}).patch,
             toast: (window.__toasts[0] || {}).m };
  });
  check('ค่าถูกล้างออกจาก state', r3.has === false && r3.reason === undefined, r3);
  check('เขียน reasons/A1 = null (ลบออกจากฐาน)',
        r3.updPatch['reasons/A1'] === null, r3.updPatch);
  check('ยังเขียนแถวประวัติไว้ 1 แถว ไม่ได้ลบเงียบ ๆ',
        r3.recs === 1 && r3.mode === 'remark' && r3.delta === 0, r3);
  check('แถวลบไม่มีข้อความ และป้ายในประวัติอ่านออกว่า "ลบหมายเหตุ"',
        r3.text === undefined && r3.label === 'ลบหมายเหตุ', r3);
  check('บอกผู้ใช้ว่าเอาออกแล้ว', /เอาหมายเหตุ A1 ออกแล้ว/.test(r3.toast || ''), r3.toast);

  /* ---------- 4. ค่าเท่าเดิม ---------- */
  console.log('\n[4] กดซ้ำโดยค่าไม่เปลี่ยน ต้องไม่เขียนอะไร');
  const r4 = await page.evaluate(async () => {
    window.__seed('counter');
    await saveRemark('A1', 'เหมือนเดิม');
    window.__writes = []; window.__updates = [];
    const again = await saveRemark('A1', 'เหมือนเดิม');
    const spaced = await saveRemark('A1', '   เหมือนเดิม   ');
    return { again: again, spaced: spaced,
             writes: window.__writes.length, updates: window.__updates.length };
  });
  check('ค่าเท่าเดิม → ไม่เขียนประวัติซ้ำ',
        r4.again === false && r4.writes === 0 && r4.updates === 0, r4);
  check('ช่องว่างหน้าหลังไม่นับเป็นการเปลี่ยนค่า', r4.spaced === false, r4.spaced);

  /* ---------- 5. ผูกกับ SKU ที่การ์ดโชว์อยู่ ---------- */
  console.log('\n[5] ช่องบนหน้ายิงผูกกับ SKU ที่ยิงล่าสุด');
  const r5 = await page.evaluate(async () => {
    window.__seed('counter');
    await saveRemark('A1', 'ของ A1');
    const atA1 = { active: state.activeKey,
                   shown: $('scanRemark').style.display !== 'none',
                   value: $('scanRemarkInput').value,
                   label: $('scanRemarkLabel').textContent };
    showScanHit('B2');                       // ยิงตัวถัดไป
    const atB2 = { active: state.activeKey, value: $('scanRemarkInput').value,
                   label: $('scanRemarkLabel').textContent };
    showScanHit('A1');                       // กลับมาที่ตัวเดิม
    const back = { value: $('scanRemarkInput').value };
    return { atA1: atA1, atB2: atB2, back: back };
  });
  check('ช่องโผล่และผูกกับ A1', r5.atA1.shown === true && r5.atA1.active === 'A1', r5.atA1);
  check('ป้ายบอกรหัสสินค้าที่กำลังใส่หมายเหตุ',
        /หมายเหตุของรอบนี้ — A1/.test(r5.atA1.label), r5.atA1.label);
  check('ยิงตัวถัดไป ช่องสลับตาม B2 และว่างเปล่า',
        r5.atB2.active === 'B2' && r5.atB2.value === '' &&
        /— B2/.test(r5.atB2.label), r5.atB2);
  check('กลับมาที่ A1 หมายเหตุเดิมโผล่กลับมา', r5.back.value === 'ของ A1', r5.back);

  /* ---------- 6. คนละช่องกับหมายเหตุถาวรของ Master ---------- */
  console.log('\n[6] ต้องไม่ทับหมายเหตุถาวรใน Master');
  const r6 = await page.evaluate(async () => {
    window.__seed('counter');
    await saveRemark('A1', 'ของรอบนี้');
    return { masterNote: state.products.A1.note,
             masterShown: $('slNoteText').textContent,
             roundRemark: state.reasons.A1,
             productPatch: window.__updates.filter(function (u) { return u.path === 'products'; }).length };
  });
  check('หมายเหตุถาวรใน Master ไม่ถูกแตะ',
        r6.masterNote === 'หมายเหตุถาวรจาก Master' && r6.productPatch === 0, r6);
  check('ทั้งสองช่องโชว์พร้อมกันได้ คนละข้อความ',
        r6.masterShown === 'หมายเหตุถาวรจาก Master' && r6.roundRemark === 'ของรอบนี้', r6);

  /* ---------- 7. โผล่ในเอกสารและ Excel ---------- */
  console.log('\n[7] ไปโผล่ในเอกสาร PDF และไฟล์ Excel');
  const r7 = await page.evaluate(async () => {
    window.__seed('admin');
    await saveRemark('A1', 'ของชำรุด 2 ชิ้น');

    /* --- เอกสาร --- */
    state.page = 'doc';
    window.__realRenderDoc();
    const table = document.querySelector('#docItemTables [data-doc-table]');
    const heads = Array.prototype.map.call(table.querySelectorAll('thead th'),
      function (th) { return th.textContent; });
    const rowA1 = document.querySelector('#docItemTables [data-code="A1"]');
    const printed = rowA1.querySelector('[data-reason-print]');
    const input = rowA1.querySelector('[data-reason]');

    /* --- Excel (ดัก buildXlsx อ่านแถวที่กำลังจะเขียนจริง) --- */
    const realBuild = window.buildXlsx;
    let sheets = null;
    window.buildXlsx = function (s) { sheets = s; return realBuild(s); };
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function () { return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};
    state.page = 'scan';
    await exportExcel();
    window.buildXlsx = realBuild;
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;

    const items = sheets.filter(function (s) { return s.name === 'รายสินค้า'; })[0];
    const head = items.rows[0];
    const a1 = items.rows.filter(function (r) { return r[0] === 'A1'; })[0];
    const hist = sheets.filter(function (s) { return s.name === 'ประวัติการนับ'; })[0];
    const histHead = hist.rows[1];
    const histRows = hist.rows.slice(2);

    return {
      docHeads: heads,
      docPrinted: printed.textContent,
      docInput: input.value,
      xlHead: head[head.length - 1],
      xlValue: a1[a1.length - 1],
      xlCols: head.length === a1.length,
      histModeCol: histHead.indexOf('วิธีนับ'),
      histModes: histRows.map(function (r) { return r[histHead.indexOf('วิธีนับ')]; })
    };
  });
  check('หัวคอลัมน์ในเอกสารเปลี่ยนเป็น "หมายเหตุ" แล้ว (ไม่ใช่ Reason)',
        r7.docHeads[r7.docHeads.length - 1] === 'หมายเหตุ' &&
        r7.docHeads.indexOf('Reason') < 0, r7.docHeads);
  check('ข้อความโผล่ในเอกสาร ทั้งช่องแก้และตัวที่พิมพ์ออกกระดาษ',
        r7.docPrinted === 'ของชำรุด 2 ชิ้น' && r7.docInput === 'ของชำรุด 2 ชิ้น', r7);
  check('Excel ชีท "รายสินค้า" มีคอลัมน์หมายเหตุ',
        r7.xlHead === 'หมายเหตุ' && r7.xlCols === true, r7);
  check('ค่าในไฟล์ตรงกับที่ใส่', r7.xlValue === 'ของชำรุด 2 ชิ้น', r7.xlValue);
  check('ประวัติแยกแถวหมายเหตุออกจากแถวยิง ไม่ป้ายว่า "ยิงบาร์โค้ด"',
        r7.histModes.indexOf('ใส่หมายเหตุ') >= 0 &&
        r7.histModes.indexOf('ยิงบาร์โค้ด') < 0, r7.histModes);

  /* ---------- 8. สิทธิ์ ---------- */
  /* v2.9.0 — scanner พิมพ์หมายเหตุ "ตอนยิง" ได้แล้ว (คนยืนหน้าชั้นคือคนที่เห็นของจริง)
     ส่วน viewer ยังต้องพิมพ์ไม่ได้ทั้งที่จอและตอนเรียกฟังก์ชันตรง ๆ */
  console.log('\n[8] สิทธิ์ — scanner พิมพ์ได้ · viewer ไม่ได้');
  const r8 = await page.evaluate(async () => {
    const out = {};
    ['admin', 'counter', 'scanner', 'viewer'].forEach(function (role) {
      window.__seed(role);
      out[role] = { shown: $('scanRemark').style.display !== 'none' };
    });

    /* scanner ต้องเขียนผ่านจริง ไม่ใช่แค่เห็นช่อง */
    window.__seed('scanner');
    const okScan = await saveRemark('A1', 'ของชำรุด 2 ชิ้น');
    out.scannerCall = { ok: okScan, writes: window.__writes.length,
                        updates: window.__updates.length,
                        reason: state.reasons.A1 };

    /* viewer เรียกฟังก์ชันตรง ๆ ต้องไม่ผ่าน และต้องไม่เขียนอะไรเลยสักที่ */
    window.__seed('viewer');
    const okView = await saveRemark('A1', 'คนดูอย่างเดียวแอบใส่');
    out.viewerCall = { ok: okView, writes: window.__writes.length,
                       updates: window.__updates.length,
                       reason: state.reasons.A1,
                       toast: (window.__toasts[0] || {}).m };

    /* Job ปิดแล้ว — staff ก็ใส่ไม่ได้ */
    window.__seed('admin');
    state.roundIndex.R1.status = 'closed';
    renderScanTotals();
    const disabled = $('scanRemarkInput').disabled;
    const ok2 = await saveRemark('A1', 'รอบปิดแล้วยังใส่');
    out.closed = { disabled: disabled, ok: ok2, writes: window.__writes.length,
                   toast: (window.__toasts[0] || {}).m };
    state.roundIndex.R1.status = 'counting';
    return out;
  });
  check('admin เห็นช่อง', r8.admin.shown === true, r8.admin);
  check('counter เห็นช่อง', r8.counter.shown === true, r8.counter);
  check('scanner เห็นช่องแล้ว (v2.9.0)', r8.scanner.shown === true, r8.scanner);
  check('viewer ไม่เห็นช่องเลย', r8.viewer.shown === false, r8.viewer);
  check('scanner เขียนหมายเหตุผ่านจริง เขียนครบทั้งสองที่',
        r8.scannerCall.ok === true && r8.scannerCall.writes === 1 &&
        r8.scannerCall.updates === 1 && r8.scannerCall.reason === 'ของชำรุด 2 ชิ้น',
        r8.scannerCall);
  /* __seed() ล้าง state.reasons ทุกครั้ง — viewer จึงต้องไม่มีค่าโผล่ขึ้นมาเลยสักตัว */
  check('viewer เรียกฟังก์ชันตรง ๆ ก็ไม่ผ่าน ไม่เขียนอะไรทั้งสองที่',
        r8.viewerCall.ok === false && r8.viewerCall.writes === 0 &&
        r8.viewerCall.updates === 0 && r8.viewerCall.reason === undefined,
        r8.viewerCall);
  check('viewer ได้ข้อความบอกว่าสิทธิ์ไม่พอ',
        /สิทธิ์/.test(r8.viewerCall.toast || ''), r8.viewerCall.toast);
  check('Job ปิดแล้ว ช่องถูกล็อกและเขียนไม่ได้',
        r8.closed.disabled === true && r8.closed.ok === false &&
        r8.closed.writes === 0 && /ปิดแล้ว/.test(r8.closed.toast || ''), r8.closed);

  /* ---------- 9. หมายเหตุที่คนอื่นแก้ วิ่งเข้ามาสด ๆ ---------- */
  console.log('\n[9] แถวหมายเหตุที่วิ่งเข้ามาจากคนอื่น');
  const r9 = await page.evaluate(() => {
    window.__seed('counter');
    state.reasons.A1 = 'ของเดิม';
    state.remarkTs.A1 = 1000;
    /* แถวใหม่กว่า → ชนะ */
    applyScanRecord('x1', { code: 'A1', zone: 'A', zoneName: 'A', delta: 0,
                            mode: 'remark', reason: 'คนอื่นแก้', user: 'สมหญิง', ts: 2000 });
    const newer = state.reasons.A1;
    /* แถวเก่ากว่ามาถึงทีหลัง → ต้องไม่ชนะ (กันลำดับข้อมูลสลับ) */
    applyScanRecord('x2', { code: 'A1', zone: 'A', zoneName: 'A', delta: 0,
                            mode: 'remark', reason: 'ของเก่ามาช้า', user: 'สมหญิง', ts: 1500 });
    const older = state.reasons.A1;
    /* แถวลบที่ใหม่สุด → ล้างค่า */
    applyScanRecord('x3', { code: 'A1', zone: 'A', zoneName: 'A', delta: 0,
                            mode: 'remark', user: 'สมหญิง', ts: 3000 });
    return { newer: newer, older: older, cleared: 'A1' in state.reasons,
             counts: state.counts.A1 };
  });
  check('แถวที่เวลาใหม่กว่าชนะ', r9.newer === 'คนอื่นแก้', r9.newer);
  check('แถวเก่ากว่ามาถึงทีหลังก็ไม่ทับของใหม่', r9.older === 'คนอื่นแก้', r9.older);
  check('แถวลบที่ใหม่สุดล้างค่าได้', r9.cleared === false, r9.cleared);
  check('ทั้งหมดนี้ยอดนับไม่ขยับ (delta 0)', r9.counts === 3, r9.counts);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
