/* ============================================================
   v2.7.2 — นำเข้ายอดนับจากไฟล์ Excel แทนการยิงสด
   ============================================================

   ใช้กับของที่นับใส่กระดาษมาก่อนแล้วค่อยคีย์เข้าระบบทีเดียว

   หลักที่ห้ามพลาด — ยอดที่นำเข้า "บวกเพิ่ม" จากยอดเดิมเสมอ ไม่ใช่เขียนทับ
   SKU ที่ยิงไว้ 2 แล้วนำเข้า 10 ต้องได้ 12 ไม่ใช่ 10
   (writeScan เขียนแถวใหม่เสมอ ไม่เคยลบของเดิม ตามกฎบ้าน)

   เส้นแบ่งอื่นที่ต้องไม่พลาด:
   - รหัสไม่มีใน Master → นับเข้าไปเป็น unknown เหมือนยิงเจอของไม่รู้จัก
   - แถวเสีย (ไม่มีรหัส / จำนวนไม่ใช่ตัวเลข > 0) → ข้าม ไม่ล้มทั้งไฟล์
   - scanner (เด็กหน้าร้าน) → ไม่เห็นปุ่ม และเรียกฟังก์ชันตรง ๆ ก็ไม่ผ่าน
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
    window.__toasts = []; window.__writes = []; window.__asks = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'gen' + (++n); }; })();
    window.renderDoc = function () {};
    hideLogin();

    window.__seed = function (role, answer) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role, branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job'; state.page = 'scan';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10,
              barcode: '8850000000011' },
        B2: { code: 'B2', name: 'สินค้า B', category: 'ห', type: 'product', costPrice: 10 },
        C3: { code: 'C3', name: 'สินค้า C', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 100, B2: 50, C3: 10 };
      /* A1 ยิงไว้แล้ว 2 ชิ้น — ใช้พิสูจน์ว่านำเข้าแล้วต้องบวกเพิ่ม ไม่ใช่ทับ */
      state.counts = { A1: 2 };
      state.scanQty = { A1: 2 }; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.cycleData = null;
      buildScanIndex();
      window.__toasts = []; window.__writes = []; window.__asks = [];
      window.ask = function (t, b, ok, opts) {
        window.__asks.push({ t: t, b: b, ok: ok, opts: opts || {} });
        return Promise.resolve(answer === undefined ? true : answer);
      };
      renderScanTotals();
    };

    /* สร้างไฟล์ .xlsx จริงด้วย buildXlsx ตัวเดียวกับที่แอปใช้ปล่อยไฟล์ออกไป
       แล้วป้อนกลับเข้า handleScanImport — วนครบวงจรจริง ไม่ได้ mock ตัว parser */
    window.__file = function (rows, name) {
      const blob = buildXlsx([{ name: 'นำเข้ายอดนับ', rows: rows, widths: [24, 14] }]);
      return new File([blob], name || 'count.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };

    /* เรคอร์ด scan ที่ถูกเขียนออกไปจริง — อ่านจากคิวเขียน ไม่ใช่จาก state */
    window.__scanRecs = function () {
      const out = [];
      window.__writes.forEach(function (w) {
        Object.keys(w.patch).forEach(function (k) {
          if (k.indexOf('scans/') === 0) out.push(w.patch[k]);
        });
      });
      return out;
    };
  });

  /* ---------- 1. อ่านไฟล์ + นับตัวเลขให้พรีวิว ---------- */
  console.log('\n[1] อ่านไฟล์และนับตัวเลขสำหรับพรีวิว');
  const r1 = await page.evaluate(async () => {
    window.__seed('counter');
    /* หัวตารางไม่ได้อยู่แถวแรก + มีแถวเสียปนมา เหมือนไฟล์จริงที่คนทำเอง */
    const rows = [
      ['ใบนับสต๊อก สาขาทดสอบ'],
      [],
      ['รหัสสินค้า', 'จำนวน'],
      ['A1', 10],
      ['B2', 5],
      ['A1', 3],                 // รหัสซ้ำ — ต้องรวมเป็น 13
      ['', 9],                   // ไม่มีรหัส — ข้าม
      ['C3', 'abc'],             // จำนวนไม่ใช่ตัวเลข — ข้าม
      ['C3', 0],                 // ศูนย์ — ข้าม
      ['C3', -4],                // ติดลบ — ข้าม
      ['ZZZ9', 7]                // ไม่มีใน Master — unknown
    ];
    const parsed = await parseXlsx(await window.__file(rows).arrayBuffer());
    const res = parseScanImportFile(parsed);
    return {
      items: res.items.map(function (i) {
        return { key: i.key, code: i.code, qty: i.qty, known: i.known };
      }),
      stat: {
        rows: res.stat.rows, pieces: res.stat.pieces, skus: res.stat.skus,
        skipped: res.stat.skipped, dup: res.stat.dupCodes,
        noCode: res.stat.noCode.length, badQty: res.stat.badQty.length,
        unknown: res.stat.unknownItems.map(function (i) { return i.code; })
      }
    };
  });
  check('รวมรหัสซ้ำในไฟล์เป็นแถวเดียว (A1 = 10 + 3 = 13)',
        r1.items.filter(function (i) { return i.key === 'A1'; })[0].qty === 13, r1.items);
  check('ได้ 3 SKU ไม่ซ้ำ', r1.stat.skus === 3, r1.stat);
  check('รวมชิ้น 25 (13 + 5 + 7)', r1.stat.pieces === 25, r1.stat);
  check('นับแถวที่ใช้ได้ 4 แถว', r1.stat.rows === 4, r1.stat);
  check('รายงานรหัสซ้ำ 1 แถว', r1.stat.dup === 1, r1.stat);
  check('ข้ามแถวเสีย 4 แถว (ไม่มีรหัส 1 · จำนวนไม่ถูก 3)',
        r1.stat.skipped === 4 && r1.stat.noCode === 1 && r1.stat.badQty === 3, r1.stat);
  check('ตรวจเจอรหัสที่ไม่มีใน Master',
        JSON.stringify(r1.stat.unknown) === JSON.stringify(['ZZZ9']), r1.stat.unknown);
  check('สินค้าที่มีใน Master ติดธง known',
        r1.items.filter(function (i) { return i.known; }).length === 2, r1.items);

  /* ---------- 2. ⭐ บวกเพิ่ม ไม่ใช่เขียนทับ ---------- */
  console.log('\n[2] ⭐ ยอดที่นำเข้าต้องบวกเพิ่มจากยอดเดิม');
  const r2 = await page.evaluate(async () => {
    window.__seed('counter');
    const before = state.counts.A1;
    await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['A1', 10]]));
    const recs = window.__scanRecs();
    return {
      before: before, after: state.counts.A1,
      recCount: recs.length, delta: recs[0] && recs[0].delta,
      mode: recs[0] && recs[0].mode, reason: recs[0] && recs[0].reason,
      user: recs[0] && recs[0].user, hasTs: !!(recs[0] && recs[0].ts),
      path: window.__writes[0] && window.__writes[0].path
    };
  });
  check('⭐ ยอดเดิม 2 + นำเข้า 10 = 12 (บวก ไม่ใช่ทับ)',
        r2.before === 2 && r2.after === 12, r2);
  check('เขียนเป็น scan แถวใหม่ delta +10 ไม่ได้แตะแถวเดิม',
        r2.recCount === 1 && r2.delta === 10, r2);
  check('ลงที่ rounds/R1 · mode = scan', r2.path === 'rounds/R1' && r2.mode === 'scan', r2);
  check('บันทึกชื่อไฟล์ไว้ในเหตุผล ตรวจย้อนหลังได้',
        /^นำเข้า Excel: count\.xlsx /.test(r2.reason || ''), r2.reason);
  check('บันทึกว่าใครนำเข้าและเมื่อไหร่', r2.user === 'สมชาย' && r2.hasTs === true, r2);

  /* ---------- 3. อัปไฟล์เดิมซ้ำ = เบิ้ล (พฤติกรรมที่เตือนไว้) ---------- */
  console.log('\n[3] อัปไฟล์เดิมซ้ำ ต้องเบิ้ลจริงตามที่เตือน');
  const r3 = await page.evaluate(async () => {
    window.__seed('counter');
    await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['A1', 10]]));
    const once = state.counts.A1;
    await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['A1', 10]]));
    const twice = state.counts.A1;
    const body = (window.__asks[0] || {}).b || '';
    return { once: once, twice: twice, body: body,
             danger: ((window.__asks[0] || {}).opts || {}).danger };
  });
  check('อัปครั้งเดียว 12 · อัปซ้ำเป็น 22', r3.once === 12 && r3.twice === 22, r3);
  check('พรีวิวเตือนว่าบวกเพิ่ม ไม่ได้เขียนทับ',
        /บวกเพิ่ม/.test(r3.body) && /ไม่ได้เขียนทับ/.test(r3.body), r3.body);
  check('พรีวิวเตือนเรื่องอัปซ้ำแล้วเบิ้ล', /ยอดเบิ้ล/.test(r3.body), r3.body);
  check('กล่องยืนยันเป็นแบบ danger', r3.danger === true, r3.danger);

  /* ---------- 4. พรีวิวบอกตัวเลขครบก่อนเขียน ---------- */
  console.log('\n[4] พรีวิวต้องบอกตัวเลขครบ และยังไม่เขียนอะไร');
  const r4 = await page.evaluate(async () => {
    window.__seed('counter', false);                 // กดยกเลิกในกล่องยืนยัน
    const ok = await handleScanImport(window.__file([
      ['รหัสสินค้า', 'จำนวน'], ['A1', 10], ['B2', 5], ['ZZZ9', 7]
    ]));
    const a = window.__asks[0] || {};
    return { ok: ok, title: a.t, body: a.b || '', writes: window.__writes.length,
             counts: state.counts.A1, toast: (window.__toasts[0] || {}).m };
  });
  check('บอกจำนวนแถว / รวมชิ้น / SKU ไม่ซ้ำ',
        /แถวที่นำเข้าได้ 3 แถว/.test(r4.body) &&
        /รวม 22 ชิ้น/.test(r4.body) && /3 SKU \(ไม่ซ้ำ\)/.test(r4.body), r4.body);
  check('ลิสต์รหัสที่ไม่มีใน Master ให้เห็น',
        /ไม่มีใน Master 1 รายการ/.test(r4.body) && /· ZZZ9 × 7/.test(r4.body), r4.body);
  check('บอกชื่อไฟล์ในพรีวิว', /ไฟล์: count\.xlsx/.test(r4.body), r4.body);
  check('หัวกล่องบอกยอดรวมที่กำลังจะเขียน',
        /ยืนยันนำเข้ายอดนับ 22 ชิ้น\?/.test(r4.title || ''), r4.title);
  check('กดยกเลิกแล้วไม่เขียนอะไรเลย',
        r4.ok === false && r4.writes === 0 && r4.counts === 2, r4);
  check('บอกผู้ใช้ว่ายกเลิกแล้ว ยังไม่ได้บันทึก', /ยังไม่ได้บันทึก/.test(r4.toast || ''), r4.toast);

  /* ---------- 5. รหัสไม่มีใน Master → unknown ---------- */
  console.log('\n[5] รหัสไม่มีใน Master ต้องเข้าเป็น unknown เหมือนยิงเจอ');
  const r5 = await page.evaluate(async () => {
    window.__seed('counter');
    await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['ZZZ9', 7]]));
    const rec = window.__scanRecs()[0] || {};
    const u = state.unknownKeys.ZZZ9 || {};
    return { unknown: rec.unknown, raw: rec.raw, delta: rec.delta,
             counts: state.counts.ZZZ9, uQty: u.qty, uValue: u.value,
             pending: unknownPending() };
  });
  check('ติดธง unknown + เก็บรหัสดิบไว้',
        r5.unknown === true && r5.raw === 'ZZZ9', r5);
  check('ยอดเข้าไปนับปกติ 7 ชิ้น', r5.delta === 7 && r5.counts === 7, r5);
  check('โผล่ในรายการบาร์โค้ดที่ต้องจัดการ',
        r5.uQty === 7 && r5.uValue === 'ZZZ9' && r5.pending === 1, r5);

  /* ---------- 6. หาสินค้าด้วยบาร์โค้ดก็ได้ ---------- */
  console.log('\n[6] ไฟล์ที่กรอกเป็นบาร์โค้ดแทนรหัส');
  const r6 = await page.evaluate(async () => {
    window.__seed('counter');
    await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['8850000000011', 4]]));
    const rec = window.__scanRecs()[0] || {};
    return { counts: state.counts.A1, code: rec.code, unknown: !!rec.unknown };
  });
  check('บาร์โค้ดของ A1 ถูกจับเข้าสินค้าตัวเดิม ไม่กลายเป็น unknown',
        r6.counts === 6 && r6.code === 'A1' && r6.unknown === false, r6);

  /* ---------- 7. ไฟล์ผิดรูป ---------- */
  console.log('\n[7] ไฟล์ที่ใช้ไม่ได้ ต้องบอกเป็นภาษาคน');
  const r7 = await page.evaluate(async () => {
    window.__seed('counter');
    const out = {};
    /* ไม่มีคอลัมน์จำนวน */
    await handleScanImport(window.__file([['รหัสสินค้า', 'ชื่อสินค้า'], ['A1', 'x']]));
    out.missing = (window.__asks[0] || {}).b || '';
    out.missingWrites = window.__writes.length;

    /* มีหัวตารางครบแต่ไม่มีแถวใช้ได้เลย */
    window.__seed('counter');
    await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['', ''], ['A1', 'abc']]));
    out.empty = (window.__asks[0] || {}).t || '';
    out.emptyWrites = window.__writes.length;
    return out;
  });
  check('ขาดคอลัมน์ → บอกว่าต้องมีคอลัมน์อะไร + ชี้ไปที่ Template',
        /จำนวน/.test(r7.missing) && /Template/.test(r7.missing) && r7.missingWrites === 0, r7);
  check('ไม่มีแถวใช้ได้ → บอกตรง ๆ ไม่เขียนอะไร',
        r7.empty === 'ไม่มีแถวไหนนำเข้าได้' && r7.emptyWrites === 0, r7);

  /* ---------- 8. สิทธิ์ ---------- */
  console.log('\n[8] สิทธิ์ — scanner ต้องไม่เห็นและใช้ไม่ได้');
  const r8 = await page.evaluate(async () => {
    const out = {};
    ['admin', 'counter', 'scanner'].forEach(function (role) {
      window.__seed(role);
      out[role] = {
        shown: $('btnScanImport').style.display !== 'none',
        disabled: $('btnScanImport').disabled,
        tplShown: $('btnScanImportTpl').style.display !== 'none'
      };
    });

    /* เรียกฟังก์ชันตรง ๆ ด้วยสิทธิ์ scanner */
    window.__seed('scanner');
    const ok = await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['A1', 10]]));
    out.scannerCall = { ok: ok, writes: window.__writes.length, counts: state.counts.A1,
                        asks: window.__asks.length, toast: (window.__toasts[0] || {}).m };

    window.__seed('scanner');
    downloadScanImportTemplate();
    out.tplToast = (window.__toasts[0] || {}).m;

    /* Job ปิดแล้ว — staff ก็นำเข้าไม่ได้ */
    window.__seed('admin');
    state.roundIndex.R1.status = 'closed';
    const ok2 = await handleScanImport(window.__file([['รหัสสินค้า', 'จำนวน'], ['A1', 10]]));
    out.closed = { ok: ok2, writes: window.__writes.length,
                   toast: (window.__toasts[0] || {}).m };
    state.roundIndex.R1.status = 'counting';
    return out;
  });
  check('admin เห็นทั้งสองปุ่ม', r8.admin.shown && r8.admin.tplShown && !r8.admin.disabled, r8.admin);
  check('counter เห็นทั้งสองปุ่ม', r8.counter.shown && r8.counter.tplShown && !r8.counter.disabled, r8.counter);
  check('scanner ไม่เห็นปุ่มเลย และปุ่มถูกล็อกซ้ำ',
        !r8.scanner.shown && !r8.scanner.tplShown && r8.scanner.disabled === true, r8.scanner);
  check('scanner เรียกฟังก์ชันตรง ๆ ก็ไม่ผ่าน ไม่เขียนอะไร',
        r8.scannerCall.ok === false && r8.scannerCall.writes === 0 &&
        r8.scannerCall.counts === 2, r8.scannerCall);
  check('ไม่แม้แต่จะเปิดกล่องพรีวิว', r8.scannerCall.asks === 0, r8.scannerCall);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(r8.scannerCall.toast || ''), r8.scannerCall.toast);
  check('scanner โหลด Template ตรง ๆ ก็ไม่ได้', /สิทธิ์/.test(r8.tplToast || ''), r8.tplToast);
  check('Job ปิดแล้ว staff ก็นำเข้าไม่ได้',
        r8.closed.ok === false && r8.closed.writes === 0 && /ปิดแล้ว/.test(r8.closed.toast || ''),
        r8.closed);

  /* ---------- 9. ไม่แตะ Master ---------- */
  console.log('\n[9] นำเข้ายอดนับต้องไม่แตะ Master หรือยอดระบบ');
  const r9 = await page.evaluate(async () => {
    window.__seed('counter');
    const sysBefore = JSON.stringify(state.systemQty);
    const prodBefore = JSON.stringify(Object.keys(state.products).sort());
    await handleScanImport(window.__file([
      ['รหัสสินค้า', 'จำนวน'], ['A1', 10], ['ZZZ9', 7]
    ]));
    const paths = window.__writes.map(function (w) { return w.path; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    return { sysSame: sysBefore === JSON.stringify(state.systemQty),
             prodSame: prodBefore === JSON.stringify(Object.keys(state.products).sort()),
             paths: paths };
  });
  check('ยอดระบบไม่ถูกแตะ', r9.sysSame === true, r9.sysSame);
  check('Master ไม่ถูกเพิ่มสินค้าใหม่ (unknown ยังไม่ใช่สินค้า)', r9.prodSame === true, r9.prodSame);
  check('เขียนลงที่เดียวคือ rounds/R1',
        JSON.stringify(r9.paths) === JSON.stringify(['rounds/R1']), r9.paths);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
