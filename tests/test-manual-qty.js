/* ============================================================
   v2.7.3 — จำนวนในการกรอกมือ
   ============================================================

   ช่อง "จำนวน" มีอยู่แล้วตั้งแต่รุ่นก่อน และ saveManual() เรียก
   writeScan(key, qty, 'manual', reason) ซึ่ง "บวกเพิ่ม" อยู่แล้วโดยธรรมชาติ
   (writeScan เขียนแถวใหม่เสมอ ไม่เคยลบหรือทับของเดิม ตามกฎบ้าน)

   v2.7.3 จึงเพิ่มแค่สองอย่าง:
   1. ค่าเริ่มต้นเป็น 1 — เดิมช่องว่างเปล่า ต้องพิมพ์ 1 เองทุกครั้ง
   2. ช่องจำนวนเป็นของ staff — scanner ล็อกไว้ที่ 1 แก้ไม่ได้
      (คนที่เพิ่มยอดทีละสิบชิ้นโดยไม่ต้องยิงจริง = จุดที่ทุจริตง่ายที่สุด)

   เทสนี้ยืนยันทั้งของใหม่ และยืนยันว่าเงื่อนไข "บวกเพิ่ม" ยังจริงอยู่
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
    window.__toasts = []; window.__writes = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'gen' + (++n); }; })();
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
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 100 };
      /* A1 ยิงไว้แล้ว 2 ชิ้น — ใช้พิสูจน์ว่ากรอกมือแล้วต้องบวกเพิ่ม ไม่ใช่ทับ */
      state.counts = { A1: 2 };
      state.scanQty = { A1: 2 }; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.cycleData = null;
      buildScanIndex();
      window.__toasts = []; window.__writes = [];
      openManual();
      pickManual('A1');
    };

    window.__rec = function () {
      const w = window.__writes[0];
      if (!w) return null;
      const k = Object.keys(w.patch)[0];
      return w.patch[k];
    };
  });

  /* ---------- 1. ⭐ บวกเพิ่ม ไม่ใช่เขียนทับ ---------- */
  console.log('\n[1] ⭐ ยอดเดิม 2 → กรอกมือ 10 → ต้องได้ 12');
  const r1 = await page.evaluate(() => {
    window.__seed('counter');
    const before = state.counts.A1;
    $('manualQty').value = '10';
    $('manualReason').value = 'ป้ายบาร์โค้ดขาด';
    saveManual();
    const rec = window.__rec();
    return {
      before: before, after: state.counts.A1,
      manualQty: state.manualQty.A1,
      writes: window.__writes.length,
      delta: rec && rec.delta, mode: rec && rec.mode, reason: rec && rec.reason,
      user: rec && rec.user, hasTs: !!(rec && rec.ts),
      path: window.__writes[0] && window.__writes[0].path,
      toast: (window.__toasts[0] || {}).m
    };
  });
  check('⭐ ยอดเดิม 2 + กรอกมือ 10 = 12 (บวก ไม่ใช่ทับ)',
        r1.before === 2 && r1.after === 12, r1);
  check('เขียนแถวใหม่ delta +10 แถวเดียว ไม่แตะของเดิม',
        r1.writes === 1 && r1.delta === 10, r1);
  check('แยกเป็นยอดกรอกมือ 10 ชิ้น (ไม่ปนกับยอดยิง)', r1.manualQty === 10, r1.manualQty);
  check('mode = manual · ลงที่ rounds/R1',
        r1.mode === 'manual' && r1.path === 'rounds/R1', r1);
  check('เก็บเหตุผล + ใครกรอก + เมื่อไหร่',
        r1.reason === 'ป้ายบาร์โค้ดขาด' && r1.user === 'สมชาย' && r1.hasTs === true, r1);
  check('บอกยอดที่บันทึกใน toast', /= 10/.test(r1.toast || ''), r1.toast);

  /* ---------- 2. กรอกซ้ำก็บวกทบไปเรื่อย ---------- */
  console.log('\n[2] กรอกมือซ้ำ ต้องบวกทบ ไม่ใช่แทนที่ค่าเดิม');
  const r2 = await page.evaluate(() => {
    window.__seed('counter');
    $('manualQty').value = '10'; $('manualReason').value = 'ครั้งที่ 1'; saveManual();
    const first = state.counts.A1;
    openManual(); pickManual('A1');
    $('manualQty').value = '5'; $('manualReason').value = 'ครั้งที่ 2'; saveManual();
    return { first: first, second: state.counts.A1, manual: state.manualQty.A1,
             writes: window.__writes.length };
  });
  check('2 → +10 = 12 → +5 = 17 (ไม่ใช่ 5)',
        r2.first === 12 && r2.second === 17, r2);
  check('ยอดกรอกมือสะสม 15 · เขียน 2 แถว เก็บครบเป็นประวัติ',
        r2.manual === 15 && r2.writes === 2, r2);

  /* ---------- 3. ค่าเริ่มต้น = 1 ---------- */
  console.log('\n[3] ค่าเริ่มต้นของช่องจำนวน');
  const r3 = await page.evaluate(() => {
    window.__seed('counter');
    const val = $('manualQty').value;
    /* กดบันทึกเลยโดยไม่แตะช่องจำนวน — ต้องได้ 1 ชิ้น */
    $('manualReason').value = 'นับได้ 1 ชิ้น';
    saveManual();
    return { val: val, placeholder: $('manualQty').placeholder,
             after: state.counts.A1, delta: (window.__rec() || {}).delta };
  });
  check('เปิดฟอร์มมาแล้วช่องจำนวนเป็น 1 ไม่ใช่ว่าง', r3.val === '1', r3.val);
  check('placeholder เป็น 1 ไม่ใช่ 0', r3.placeholder === '1', r3.placeholder);
  check('กดบันทึกเลยได้ +1 (backward compatible)',
        r3.delta === 1 && r3.after === 3, r3);

  /* ---------- 4. สิทธิ์ — scanner ล็อกที่ 1 ---------- */
  console.log('\n[4] สิทธิ์ — scanner ล็อกจำนวนไว้ที่ 1');
  const r4 = await page.evaluate(() => {
    const out = {};
    ['admin', 'counter', 'scanner'].forEach(function (role) {
      window.__seed(role);
      out[role] = {
        readOnly: $('manualQty').readOnly,
        value: $('manualQty').value,
        hint: $('manualQtyHint').style.display !== 'none',
        label: $('manualQtyLabel').textContent,
        title: $('manualQty').title
      };
    });
    return out;
  });
  check('admin แก้จำนวนได้', r4.admin.readOnly === false && r4.admin.hint === false, r4.admin);
  check('counter แก้จำนวนได้', r4.counter.readOnly === false && r4.counter.hint === false, r4.counter);
  check('scanner ช่องจำนวนถูกล็อก แก้ไม่ได้', r4.scanner.readOnly === true, r4.scanner);
  check('scanner เห็นค่า 1 อยู่ในช่อง (ไม่ใช่ซ่อนทิ้ง)', r4.scanner.value === '1', r4.scanner);
  check('scanner มีป้ายบอกว่าล็อกไว้ที่ 1',
        /ล็อกไว้ที่ 1/.test(r4.scanner.label) && r4.scanner.hint === true, r4.scanner);
  check('ชี้เมาส์ค้างบอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(r4.scanner.title || ''), r4.scanner.title);

  /* ---------- 5. scanner แก้ DOM เองก็ยังได้แค่ 1 ---------- */
  console.log('\n[5] scanner ฝืนแก้ค่าเอง ต้องยังได้แค่ 1');
  const r5 = await page.evaluate(() => {
    window.__seed('scanner');
    /* จำลองคนแก้ DOM ผ่าน devtools แล้วกดบันทึก */
    $('manualQty').readOnly = false;
    $('manualQty').value = '999';
    $('manualReason').value = 'ลองโกง';
    saveManual();
    const rec = window.__rec();
    return { after: state.counts.A1, delta: rec && rec.delta, writes: window.__writes.length,
             toast: (window.__toasts[0] || {}).m, bad: (window.__toasts[0] || {}).bad };
  });
  check('เขียนแค่ +1 ไม่ใช่ +999', r5.delta === 1 && r5.after === 3, r5);
  check('ยังบันทึกให้ 1 แถว ไม่ใช่ปฏิเสธทั้งใบ', r5.writes === 1, r5.writes);
  check('บอกผู้ใช้ว่าบันทึกให้ 1 ชิ้น',
        /ครั้งละ 1 ชิ้น/.test(r5.toast || '') && r5.bad === true, r5);

  /* ---------- 6. กติกาเดิมที่ต้องไม่หาย ---------- */
  console.log('\n[6] กติกาเดิมของกรอกมือต้องไม่หาย');
  const r6 = await page.evaluate(() => {
    const out = {};
    /* ไม่ใส่เหตุผล = ไม่บันทึก */
    window.__seed('counter');
    $('manualQty').value = '5'; $('manualReason').value = '';
    saveManual();
    out.noReason = { writes: window.__writes.length, counts: state.counts.A1,
                     toast: (window.__toasts[0] || {}).m };

    /* จำนวนไม่ถูกต้อง */
    window.__seed('counter');
    $('manualQty').value = '0'; $('manualReason').value = 'x';
    saveManual();
    out.zero = { writes: window.__writes.length, toast: (window.__toasts[0] || {}).m };

    window.__seed('counter');
    $('manualQty').value = 'abc'; $('manualReason').value = 'x';
    saveManual();
    out.text = { writes: window.__writes.length };

    window.__seed('counter');
    $('manualQty').value = '-5'; $('manualReason').value = 'x';
    saveManual();
    out.neg = { writes: window.__writes.length, counts: state.counts.A1 };

    /* Job ปิดแล้ว */
    window.__seed('counter');
    state.roundIndex.R1.status = 'closed';
    $('manualQty').value = '5'; $('manualReason').value = 'x';
    saveManual();
    out.closed = { writes: window.__writes.length, toast: (window.__toasts[0] || {}).m };
    state.roundIndex.R1.status = 'counting';
    return out;
  });
  check('ไม่ใส่เหตุผล = ไม่บันทึก + บอกให้ใส่',
        r6.noReason.writes === 0 && r6.noReason.counts === 2 &&
        /เหตุผล/.test(r6.noReason.toast || ''), r6.noReason);
  check('จำนวน 0 = ไม่บันทึก', r6.zero.writes === 0 &&
        /มากกว่า 0/.test(r6.zero.toast || ''), r6.zero);
  check('จำนวนเป็นตัวหนังสือ = ไม่บันทึก', r6.text.writes === 0, r6.text);
  check('จำนวนติดลบ = ไม่บันทึก (หักยอดต้องทำที่หน้าสรุป)',
        r6.neg.writes === 0 && r6.neg.counts === 2, r6.neg);
  check('Job ปิดแล้ว = ไม่บันทึก',
        r6.closed.writes === 0 && /ปิดแล้ว/.test(r6.closed.toast || ''), r6.closed);

  /* ---------- 7. รวมกับยอดยิงถูกต้องในหน้าสรุป ---------- */
  console.log('\n[7] ยอดกรอกมือต้องไปโผล่ในหน้าสรุปถูกช่อง');
  const r7 = await page.evaluate(() => {
    window.__seed('counter');
    $('manualQty').value = '10'; $('manualReason').value = 'ป้ายขาด';
    saveManual();
    const row = summaryData().rows.filter(function (r) { return r.key === 'A1'; })[0];
    return { act: row.act, scanQty: row.scanQty, manualQty: row.manualQty, diff: row.diff };
  });
  check('จำนวนจริง 12 = ยิง 2 + กรอกมือ 10', r7.act === 12, r7);
  check('แยกช่องถูก — จากการยิง 2 · จากการกรอกมือ 10',
        r7.scanQty === 2 && r7.manualQty === 10, r7);
  check('ผลต่างคิดจากยอดรวม (12 − 100 = −88)', r7.diff === -88, r7.diff);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
