/* ============================================================
   v2.13.0 — นำเข้า Excel: ชีต "เพิ่ม" + ชีต "ลบ" ในไฟล์เดียว
   ============================================================

   ของเดิม (v2.7.2) นำเข้าได้อย่างเดียวคือ "บวกเพิ่ม" ถ้าคีย์เกินต้องไปกดเอาออก
   ทีละตัวในหน้าสรุป ซึ่งรอบใหญ่ ๆ มีเป็นร้อยรายการ ทำมือไม่ไหว

   กลไกที่ยืมมา: removeOverScan เขียน writeScan(key, -qty) โดยหักไม่เกิน state.counts[key]
   (ยอดของ Job ใบที่เปิดอยู่) — ชีต "ลบ" คือการทำแบบเดียวกันทีละหลายรายการ

   เส้นที่ห้ามข้าม:
   [1] ลบ = เขียนแถวใหม่ delta ติดลบ ห้ามลบแถวเดิม (กฎบ้าน "ห้ามลบยอดที่นับไปแล้ว")
   [2] หักได้ไม่เกินยอดที่ Job ใบนี้นับไว้ — ห้ามทำให้ยอดติดลบ
   [3] ของที่ Job นี้ไม่ได้นับ = ลบไม่ได้ ต้องรายงาน ไม่ใช่เขียนมั่ว (เหมือน removeOverScan)
   [4] ไฟล์รุ่นเก่า (ชีตเดียว) ต้องยังใช้ได้เหมือนเดิม = "เพิ่ม" ทั้งใบ
   [5] สิทธิ์ adjustCount + canScan() คุมทั้งสองฝั่ง ทางเข้าเดียวกัน
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

    /* counts = ยอดที่ Job ใบนี้ยิงไว้แล้ว — ตัวคุมเพดานของฝั่ง "ลบ" */
    window.__seed = function (role, answer, counts) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role, branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job'; state.page = 'scan';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', type: 'product', costPrice: 10 },
        B2: { code: 'B2', name: 'สินค้า B', type: 'product', costPrice: 10 },
        C3: { code: 'C3', name: 'สินค้า C', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 100, B2: 100, C3: 100 };
      state.counts = counts || { A1: 10, B2: 4 };
      state.scanQty = JSON.parse(JSON.stringify(state.counts));
      state.manualQty = {};
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

    /* สร้างไฟล์ 2 ชีตด้วย buildXlsx ตัวเดียวกับที่แอปปล่อยออกไป แล้วป้อนกลับเข้า
       handleScanImport — วนครบวงจรจริงตั้งแต่ zip จนถึงคิวเขียน ไม่ได้ mock parser */
    window.__book = function (sheets, name) {
      const blob = buildXlsx(sheets.map(function (s) {
        return { name: s.name, rows: s.rows, widths: [24, 14] };
      }));
      return new File([blob], name || 'count.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
    window.__addRemove = function (add, remove, name) {
      return window.__book([
        { name: 'เพิ่ม', rows: [['รหัสสินค้า', 'จำนวน']].concat(add || []) },
        { name: 'ลบ',   rows: [['รหัสสินค้า', 'จำนวน']].concat(remove || []) }
      ], name);
    };

    window.__scanRecs = function () {
      const out = [];
      window.__writes.forEach(function (w) {
        Object.keys(w.patch).forEach(function (k) {
          if (k.indexOf('scans/') === 0) out.push(w.patch[k]);
        });
      });
      return out;
    };
    /* คีย์ทุกตัวที่ถูกเขียน — ใช้พิสูจน์ว่าไม่มีการลบแถวเดิม (ต้องไม่มี patch ที่เป็น null) */
    window.__patchKeys = function () {
      const out = [];
      window.__writes.forEach(function (w) {
        Object.keys(w.patch).forEach(function (k) { out.push({ k: k, isNull: w.patch[k] === null }); });
      });
      return out;
    };
  });

  /* ---------- [1] Template 2 ชีต ---------- */
  console.log('\n[1] Template ต้องมีชีต "เพิ่ม" และ "ลบ"');
  const tpl = await page.evaluate(async () => {
    window.__seed('counter');
    let captured = null;
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    /* ดักไว้ทั้ง URL และการกดลิงก์ — ปล่อยให้กดจริงเบราว์เซอร์จะพยายามโหลด blob
       แล้วพ่น error ลงคอนโซล ซึ่งจะไปดังที่ด่าน "ไม่มี error ในคอนโซล" ท้ายไฟล์ */
    URL.createObjectURL = function (b) { captured = b; return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () {};
    downloadScanImportTemplate();
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    const sheets = await parseXlsxSheets(await captured.arrayBuffer());
    return {
      names: sheets.map(function (s) { return s.name; }),
      /* v2.19.0 — ชีต "เพิ่ม" มีบรรทัดอธิบายอยู่เหนือหัวตารางแล้ว (เหมือนชีต "ลบ")
         จึงต้องหาแถวหัวด้วย findHeaderRow ตัวเดียวกับที่ตัวอ่านไฟล์ใช้ ไม่ใช่ชี้ rows[0] ตรง ๆ */
      addHead: sheets[0].rows[findHeaderRow(sheets[0].rows)],
      addNote: String((sheets[0].rows[0] || [])[0] || ''),
      removeRows: sheets[1].rows.map(function (r) { return r.join('|'); }),
      toast: (window.__toasts[0] || {}).m
    };
  });
  check('มี 2 ชีตชื่อ เพิ่ม / ลบ', tpl.names.join(',') === 'เพิ่ม,ลบ', tpl.names);
  check('ชีตเพิ่มมีหัว รหัสสินค้า | จำนวน | ประเภท | โซน (v2.19.0)',
        tpl.addHead.join('|') === 'รหัสสินค้า|จำนวน|ประเภท|โซน', tpl.addHead);
  check('ชีตเพิ่มอธิบายว่าประเภท/โซนเว้นว่างได้',
        /เว้นว่าง/.test(tpl.addNote) && /ประเภท/.test(tpl.addNote) && /โซน/.test(tpl.addNote),
        tpl.addNote);
  check('ชีตลบมีหัวเดียวกัน', tpl.removeRows.some(function (r) { return r === 'รหัสสินค้า|จำนวน'; }),
        tpl.removeRows);
  check('ชีตลบอธิบายว่าเว้นว่าง = เอาออกทั้งหมด',
        tpl.removeRows.some(function (r) { return /เว้นช่องจำนวนว่าง/.test(r); }), tpl.removeRows);
  check('บอกผู้ใช้ว่ามีสองชีตในไฟล์เดียว', /สองชีต|ชีต "เพิ่ม" กับชีต "ลบ"/.test(tpl.toast || ''),
        tpl.toast);

  /* ---------- [2] เพิ่มและลบในไฟล์เดียว ---------- */
  console.log('\n[2] ⭐ เพิ่ม + ลบ ในรอบยืนยันเดียว');
  const r2 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10, B2: 4 });
    await handleScanImport(window.__addRemove([['C3', 6]], [['A1', 3]]));
    return {
      counts: { A1: state.counts.A1, B2: state.counts.B2, C3: state.counts.C3 },
      recs: window.__scanRecs().map(function (r) {
        return { code: r.code, delta: r.delta, reason: r.reason };
      }),
      asks: window.__asks.length,
      paths: window.__writes.map(function (w) { return w.path; }),
      nulls: window.__patchKeys().filter(function (p) { return p.isNull; }).length
    };
  });
  check('ฝั่งเพิ่มบวกเข้าไป (C3 = 0 + 6)', r2.counts.C3 === 6, r2.counts);
  check('⭐ ฝั่งลบหักออก (A1 = 10 − 3 = 7)', r2.counts.A1 === 7, r2.counts);
  check('ของที่ไม่อยู่ในไฟล์ไม่ถูกแตะ (B2 ยัง 4)', r2.counts.B2 === 4, r2.counts);
  check('ยืนยันครั้งเดียวจบ ไม่ถามสองรอบ', r2.asks === 1, r2.asks);
  check('⭐ ลบ = เขียนแถวใหม่ delta ติดลบ',
        r2.recs.some(function (r) { return r.code === 'A1' && r.delta === -3; }), r2.recs);
  check('⭐ ไม่มีการลบแถวเดิม (ไม่มี patch ที่เป็น null)', r2.nulls === 0, r2.nulls);
  check('เขียนลงที่เดียวคือ rounds/R1',
        r2.paths.every(function (p) { return p === 'rounds/R1'; }), r2.paths);
  check('เหตุผลฝั่งเพิ่มบอกทิศทาง',
        r2.recs.some(function (r) { return r.delta > 0 && /^นำเข้าเพิ่ม Excel: count\.xlsx /.test(r.reason); }),
        r2.recs);
  check('เหตุผลฝั่งลบบอกทิศทาง แยกออกจากฝั่งเพิ่มได้',
        r2.recs.some(function (r) { return r.delta < 0 && /^นำเข้าลบ Excel: count\.xlsx /.test(r.reason); }),
        r2.recs);

  /* ---------- [3] เว้นจำนวนว่าง = เอาออกทั้งหมด ---------- */
  console.log('\n[3] ชีตลบ — เว้นช่องจำนวนว่าง = เอาออกทั้งหมดเท่าที่ Job นี้นับไว้');
  const r3 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10, B2: 4 });
    await handleScanImport(window.__addRemove([], [['A1', ''], ['B2', 2]]));
    return { counts: { A1: state.counts.A1, B2: state.counts.B2 },
             recs: window.__scanRecs().map(function (r) { return r.code + ':' + r.delta; }),
             body: (window.__asks[0] || {}).b };
  });
  check('⭐ เว้นว่าง = หักจนเหลือ 0 (A1 10 → 0)', r3.counts.A1 === 0, r3.counts);
  check('กรอกเลขไว้ = หักเท่าที่กรอก (B2 4 → 2)', r3.counts.B2 === 2, r3.counts);
  check('เขียน delta −10 ให้ A1', r3.recs.indexOf('A1:-10') >= 0, r3.recs);
  check('พรีวิวบอกว่ามีรายการที่เว้นว่างกี่รายการ',
        /เว้นช่องจำนวนว่างไว้ 1 รายการ/.test(r3.body || ''), r3.body);

  /* ---------- [4] เพดาน + ของที่ Job นี้ไม่ได้นับ ---------- */
  console.log('\n[4] ⭐ ห้ามหักเกินยอดที่ Job นี้นับไว้ / ห้ามหักของที่ไม่ได้นับ');
  const r4 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 3 });          // B2/C3 ไม่ได้นับใน Job นี้
    await handleScanImport(window.__addRemove([], [['A1', 99], ['B2', 5], ['C3', '']]));
    return { counts: { A1: state.counts.A1, B2: state.counts.B2, C3: state.counts.C3 },
             recs: window.__scanRecs().map(function (r) { return r.code + ':' + r.delta; }),
             body: (window.__asks[0] || {}).b,
             toast: (window.__toasts[0] || {}).m };
  });
  check('⭐ หักได้ไม่เกินที่นับไว้ (ขอ 99 แต่มี 3 → หัก 3)', r4.counts.A1 === 0, r4.counts);
  check('ไม่ทำให้ยอดติดลบ', r4.counts.A1 >= 0, r4.counts);
  check('เขียน delta −3 ไม่ใช่ −99', r4.recs.indexOf('A1:-3') >= 0 && r4.recs.indexOf('A1:-99') < 0,
        r4.recs);
  check('⭐ ของที่ Job นี้ไม่ได้นับ ไม่ถูกเขียนเลย',
        r4.recs.filter(function (r) { return /^B2|^C3/.test(r); }).length === 0, r4.recs);
  check('ยอดของที่ไม่ได้นับยังเป็น 0 ไม่ติดลบ',
        (r4.counts.B2 || 0) === 0 && (r4.counts.C3 || 0) === 0, r4.counts);
  check('พรีวิวเตือนว่าสั่งลบเกิน 1 รายการ',
        /สั่งลบเกินยอดที่ Job นี้นับไว้ 1 รายการ/.test(r4.body || ''), r4.body);
  check('พรีวิวเตือนว่าลบไม่ได้ 2 รายการ พร้อมบอกว่าให้ไปทำที่ Job อื่น',
        /ลบไม่ได้ 2 รายการ/.test(r4.body || '') && /Job อื่น/.test(r4.body || ''), r4.body);
  check('ลิสต์รหัสที่ลบไม่ได้ให้เห็น',
        /· B2/.test(r4.body || '') && /· C3/.test(r4.body || ''), r4.body);
  check('สรุปท้ายงานบอกจำนวนที่ลบไม่ได้', /ลบไม่ได้ 2 รายการ/.test(r4.toast || ''), r4.toast);

  /* ---------- [5] กล่องยืนยันต้องสรุปสองทิศ ---------- */
  console.log('\n[5] กล่องยืนยันบอกเพิ่ม/ลบ/สุทธิ');
  const r5 = await page.evaluate(async () => {
    window.__seed('counter', false, { A1: 10 });        // กดยกเลิก
    await handleScanImport(window.__addRemove([['C3', 6], ['B2', 4]], [['A1', 3]]));
    const a = window.__asks[0] || {};
    return { title: a.t, body: a.b, okLabel: a.ok, danger: (a.opts || {}).danger,
             writes: window.__writes.length, counts: state.counts.A1,
             toast: (window.__toasts[0] || {}).m };
  });
  check('หัวกล่องบอกทั้งสองทิศ', /ยืนยันนำเข้า: เพิ่ม 10 · ลบ 3 ชิ้น\?/.test(r5.title || ''), r5.title);
  check('บอกยอดเพิ่ม', /➕ เพิ่ม\s+10 ชิ้น · 2 SKU/.test(r5.body || ''), r5.body);
  check('บอกยอดลบ', /➖ ลบ\s+3 ชิ้น · 1 SKU/.test(r5.body || ''), r5.body);
  check('บอกยอดสุทธิ', /สุทธิ \+7 ชิ้น/.test(r5.body || ''), r5.body);
  check('ปุ่มยืนยันบอกสิ่งที่จะเกิด', /นำเข้า \(เพิ่ม 10 · ลบ 3 ชิ้น\)/.test(r5.okLabel || ''), r5.okLabel);
  check('เป็นกล่อง danger', r5.danger === true, r5.danger);
  check('ย้ำว่ายอดเดิมไม่ถูกลบทิ้ง', /ยอดเดิมไม่ถูกลบทิ้ง/.test(r5.body || ''), r5.body);
  check('กดยกเลิกแล้วไม่เขียนอะไรเลย', r5.writes === 0 && r5.counts === 10, r5);
  check('บอกว่ายกเลิกแล้ว', /ยังไม่ได้บันทึก/.test(r5.toast || ''), r5.toast);

  const r5b = await page.evaluate(async () => {
    window.__seed('counter', false, { A1: 10, B2: 4 });
    await handleScanImport(window.__addRemove([], [['A1', 3], ['B2', 4]]));
    return { title: (window.__asks[0] || {}).t, body: (window.__asks[0] || {}).b };
  });
  check('ลบอย่างเดียว — หัวกล่องบอกเฉพาะลบ', /ยืนยันนำเข้า: ลบ 7 ชิ้น\?/.test(r5b.title || ''),
        r5b.title);
  check('ลบอย่างเดียว — สุทธิติดลบ', /สุทธิ −7 ชิ้น/.test(r5b.body || ''), r5b.body);

  /* ---------- [6] ไฟล์รุ่นเก่ายังใช้ได้ ---------- */
  console.log('\n[6] ⭐ backward compat — ไฟล์ชีตเดียวยังใช้ได้เหมือนเดิม');
  const r6 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10 });
    const old = window.__book([{ name: 'นำเข้ายอดนับ',
      rows: [['รหัสสินค้า', 'จำนวน'], ['A1', 5], ['B2', 2]] }], 'old.xlsx');
    await handleScanImport(old);
    const afterOld = { A1: state.counts.A1, B2: state.counts.B2 };

    window.__seed('counter', true, { A1: 10 });
    const weird = window.__book([{ name: 'Sheet1',
      rows: [['รหัสสินค้า', 'จำนวน'], ['A1', 2]] }], 'weird.xlsx');
    await handleScanImport(weird);
    return { afterOld: afterOld, weird: state.counts.A1, body: (window.__asks[0] || {}).b };
  });
  check('ไฟล์ชีตเดียวชื่อเดิม = บวกเพิ่มเหมือนเดิม',
        r6.afterOld.A1 === 15 && r6.afterOld.B2 === 2, r6.afterOld);
  check('ชีตเดียวชื่ออะไรก็ได้ ก็ถือเป็น "เพิ่ม"', r6.weird === 12, r6.weird);
  check('พรีวิวบอกว่าอ่านเป็นรูปแบบเดิม', /ไฟล์รูปแบบเดิม \(ชีตเดียว\)/.test(r6.body || ''), r6.body);

  const r6b = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10 });
    const csv = new File(['รหัสสินค้า,จำนวน\nA1,4\n'], 'count.csv', { type: 'text/csv' });
    await handleScanImport(csv);
    return { A1: state.counts.A1, body: (window.__asks[0] || {}).b };
  });
  check('CSV ยังนำเข้าได้ (เพิ่มอย่างเดียว)', r6b.A1 === 14, r6b);

  /* ---------- [7] ชื่อชีตต้องเทียบแบบไม่สนช่องว่าง/ตัวพิมพ์ ---------- */
  console.log('\n[7] ชื่อชีตเทียบด้วย normText');
  const r7 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10 });
    const f = window.__book([
      { name: ' เพิ่ม ', rows: [['รหัสสินค้า', 'จำนวน'], ['C3', 3]] },
      { name: ' ลบ',     rows: [['รหัสสินค้า', 'จำนวน'], ['A1', 2]] }
    ], 'spaced.xlsx');
    await handleScanImport(f);
    return { A1: state.counts.A1, C3: state.counts.C3, body: (window.__asks[0] || {}).b };
  });
  check('ชื่อชีตมีช่องว่างนำ/ตาม ก็ยังจับถูก', r7.A1 === 8 && r7.C3 === 3, r7);
  check('ไม่ถูกมองเป็นไฟล์รูปแบบเดิม', !/ไฟล์รูปแบบเดิม/.test(r7.body || ''), r7.body);

  /* ---------- [8] รหัสซ้ำในชีตลบ ---------- */
  console.log('\n[8] รหัสซ้ำในชีตลบ — รวมยอด · เว้นว่างชนะเสมอ');
  const r8 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10, B2: 9 });
    await handleScanImport(window.__addRemove([], [['A1', 2], ['A1', 3], ['B2', 1], ['B2', '']]));
    return { A1: state.counts.A1, B2: state.counts.B2,
             recs: window.__scanRecs().map(function (r) { return r.code + ':' + r.delta; }) };
  });
  check('รหัสซ้ำรวมยอดเป็นแถวเดียว (2 + 3 = 5)', r8.A1 === 5 && r8.recs.indexOf('A1:-5') >= 0, r8);
  check('⭐ ปนเลขกับเว้นว่าง = เอาออกทั้งหมด', r8.B2 === 0 && r8.recs.indexOf('B2:-9') >= 0, r8);
  check('เขียนแถวเดียวต่อ SKU ไม่ใช่แถวละบรรทัดในไฟล์', r8.recs.length === 2, r8.recs);

  /* ---------- [9] ไม่มีอะไรทำได้เลย ---------- */
  console.log('\n[9] ไฟล์ที่ไม่มีอะไรทำได้');
  const r9 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 0 });
    await handleScanImport(window.__addRemove([], [['B2', 3]]));
    const a = window.__asks[0] || {};
    return { title: a.t, body: a.b, hideCancel: (a.opts || {}).hideCancel,
             writes: window.__writes.length };
  });
  check('บอกว่าไม่มีแถวไหนนำเข้าได้', /ไม่มีแถวไหนนำเข้าได้/.test(r9.title || ''), r9.title);
  check('อธิบายว่าของที่สั่งลบไม่ได้ถูกนับใน Job นี้',
        /Job ที่เปิดอยู่ไม่ได้นับไว้/.test(r9.body || ''), r9.body);
  check('เป็นกล่องแจ้งเฉย ๆ ไม่มีปุ่มยืนยัน', r9.hideCancel === true, r9.hideCancel);
  check('ไม่เขียนอะไรเลย', r9.writes === 0, r9.writes);

  /* ---------- [10] สิทธิ์คุมทั้งสองฝั่ง ---------- */
  console.log('\n[10] ⭐ สิทธิ์ adjustCount + สถานะ Job คุมทั้งเพิ่มและลบ');
  const r10 = await page.evaluate(async () => {
    const out = {};
    /* scanner ไม่มี adjustCount ตามแม่แบบ */
    window.__seed('scanner', true, { A1: 10 });
    await handleScanImport(window.__addRemove([['C3', 5]], [['A1', 3]]));
    out.scanner = { writes: window.__writes.length, asks: window.__asks.length,
                    A1: state.counts.A1, toast: (window.__toasts[0] || {}).m };

    /* Job ปิดแล้ว — staff ก็ทำไม่ได้ */
    window.__seed('counter', true, { A1: 10 });
    state.roundIndex.R1.status = 'closed';
    await handleScanImport(window.__addRemove([['C3', 5]], [['A1', 3]]));
    out.closed = { writes: window.__writes.length, asks: window.__asks.length,
                   A1: state.counts.A1, toast: (window.__toasts[0] || {}).m };

    /* custom ที่ติ๊ก adjustCount ให้ ต้องทำได้ ไม่ต้องเป็น counter */
    window.__seed('counter', true, { A1: 10 });
    state.me = { uid: 'u9', name: 'ลูกน้อง', role: 'custom', branches: [],
                 perms: { scan: true, adjustCount: true } };
    await handleScanImport(window.__addRemove([['C3', 5]], [['A1', 3]]));
    out.custom = { A1: state.counts.A1, C3: state.counts.C3 };
    return out;
  });
  check('scanner เรียกตรง ๆ ก็ไม่ผ่าน ไม่เขียนอะไร',
        r10.scanner.writes === 0 && r10.scanner.A1 === 10, r10.scanner);
  check('scanner ไม่แม้แต่จะเปิดกล่องยืนยัน', r10.scanner.asks === 0, r10.scanner);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์|ความสามารถ/.test(r10.scanner.toast || ''), r10.scanner.toast);
  check('Job ปิดแล้วนำเข้าไม่ได้ทั้งสองฝั่ง',
        r10.closed.writes === 0 && r10.closed.asks === 0 && r10.closed.A1 === 10, r10.closed);
  check('บอกเหตุผลว่ารอบปิดแล้ว', /นำเข้าไฟล์ไม่ได้/.test(r10.closed.toast || ''), r10.closed.toast);
  check('⭐ custom ที่ติ๊ก adjustCount ทำได้ทั้งเพิ่มและลบ',
        r10.custom.A1 === 7 && r10.custom.C3 === 5, r10.custom);

  /* ---------- [11] ไม่แตะของอื่น ---------- */
  console.log('\n[11] ต้องไม่แตะ Master / ยอดระบบ');
  const r11 = await page.evaluate(async () => {
    window.__seed('counter', true, { A1: 10 });
    const sysBefore = JSON.stringify(state.systemQty);
    const prodBefore = Object.keys(state.products).sort().join(',');
    await handleScanImport(window.__addRemove([['ZZZ9', 4]], [['A1', 2]]));
    return {
      sysSame: JSON.stringify(state.systemQty) === sysBefore,
      prodSame: Object.keys(state.products).sort().join(',') === prodBefore,
      paths: Array.from(new Set(window.__writes.map(function (w) { return w.path; }))),
      unknownRec: window.__scanRecs().filter(function (r) { return r.unknown; })
                    .map(function (r) { return r.code + ':' + r.delta; })
    };
  });
  check('ยอดระบบไม่ถูกแตะ', r11.sysSame === true, r11.sysSame);
  check('Master ไม่ถูกเพิ่มสินค้าใหม่', r11.prodSame === true, r11.prodSame);
  check('เขียนลงที่เดียวคือ rounds/R1', r11.paths.join(',') === 'rounds/R1', r11.paths);
  check('รหัสที่ไม่มีใน Master เข้าเป็น unknown ฝั่งเพิ่มเหมือนเดิม',
        r11.unknownRec.join(',') === 'ZZZ9:4', r11.unknownRec);

  console.log('\n--- console/page errors ---');
  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
