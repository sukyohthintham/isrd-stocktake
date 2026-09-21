/* ============================================================
   v2.16.4 — ชุดข้อมูลตัวอย่างของโหมดทดสอบ
   ============================================================

   ชุด seed มีไว้ให้เปิดไฟล์ดับเบิลคลิกแล้วลองของได้ทันทีโดยไม่แตะ production
   ถ้าตัวเลขในชุดนี้เพี้ยนไปเงียบ ๆ คนที่เอาไปลองจะเข้าใจฟีเจอร์ผิดทั้งดุ้น
   ไฟล์นี้จึงตรึงเลขทุกตัวที่ชุดตัวอย่างต้องให้ได้ ไม่ใช่แค่เช็คว่า "มีข้อมูล"

   สิ่งที่ต้องคุม:
   [1] ลงครั้งเดียว · reload แล้วไม่ทับ ไม่เพิ่ม
   [2] ครอบครบ 4 สถานะของรายงานโชว์/สต็อก + มีของข้ามใบให้ลองปรับยอด
   [3] มี Not Product ปนไว้ 1 ตัว — หน้าสรุปต้องนับ แต่รายงานโชว์/สต็อกต้องตัด
       (รูปร่างแถวเหมือนตัวที่ต้องจบที่ "ยังไม่ระบุ" เป๊ะ ต่างกันที่ประเภทอย่างเดียว)
   [4] ปุ่ม Export Excel ต้องได้ 4 ชีทจริง และไม่มี Not Product ปนสักช่อง
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

  /* เริ่มจากเครื่องเปล่าเสมอ ไม่งั้นได้ผลของ seed ที่ค้างจากรอบก่อน */
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1500));

  /* ---------- [1] ลงชุดตัวอย่างให้เองตอนเปิดไฟล์ ---------- */
  console.log('\n[1] ลงชุดตัวอย่างเองตอนเปิดไฟล์');
  const r1 = await page.evaluate(() => {
    const snap = db.localSnapshot() || {};
    const rounds = snap.rounds || {};
    return {
      preview: PREVIEW_MODE,
      branches: Object.keys(snap.branches || {}),
      products: Object.keys(snap.products || {}).length,
      jobs: Object.keys(snap.roundIndex || {}).sort(),
      scansStock: Object.keys((rounds['RP-STOCK'] || {}).scans || {}).length,
      scansShow: Object.keys((rounds['RP-SHOW'] || {}).scans || {}).length,
      marker: !!(snap.settings && snap.settings.previewSeeded),
      cycle: !!(snap.cycles && snap.cycles['CYC-PREVIEW']),
      bag: (snap.products || {}).PKBAG01 || null
    };
  });
  check('อยู่ในโหมดทดสอบจริง', r1.preview === true, r1.preview);
  check('ได้ 1 สาขา', r1.branches.join(',') === 'POP08', r1.branches);
  check('ได้ 8 SKU', r1.products === 8, r1.products);
  check('ได้ 2 Job ในรอบเดียวกัน', r1.jobs.join(',') === 'RP-SHOW,RP-STOCK', r1.jobs);
  check('มีรอบนับ CYC-PREVIEW', r1.cycle === true, r1.cycle);
  check('แถว scan ครบ (STOCK 7 · SHOW 4)', r1.scansStock === 7 && r1.scansShow === 4, r1);
  check('ปักธงว่าลงแล้ว', r1.marker === true, r1.marker);
  check('⭐ มี Not Product ปนไว้ 1 ตัวในทะเบียน',
        !!r1.bag && r1.bag.type === 'notProduct' && r1.bag.name === 'ถุงกระดาษหูหิ้ว', r1.bag);

  /* ---------- [2] reload ต้องไม่ลงซ้ำ ---------- */
  console.log('\n[2] เปิดซ้ำต้องไม่ลงทับ ไม่เพิ่มยอด');
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  const r2 = await page.evaluate(() => {
    const snap = db.localSnapshot() || {};
    return { products: Object.keys(snap.products || {}).length,
             jobs: Object.keys(snap.roundIndex || {}).length,
             scans: Object.keys(snap.rounds['RP-STOCK'].scans).length };
  });
  check('⭐ เปิดใหม่แล้วข้อมูลเท่าเดิมเป๊ะ',
        r2.products === 8 && r2.jobs === 2 && r2.scans === 7, r2);

  /* ---------- ตั้งสถานะให้เหมือนเปิดใช้งานจริง ---------- */
  await page.evaluate(async () => {
    hideLogin();
    state.me = { uid: 'u1', name: 'ทดสอบ', role: 'admin', branches: [] };
    state.counter = 'ทดสอบ';
    state.branches = await db.get('branches');
    state.products = await db.get('products');
    state.roundIndex = await db.get('roundIndex');
    state.cycles = await db.get('cycles');
    state.roundId = 'RP-STOCK'; state.cycleId = 'CYC-PREVIEW';
    state.systemQty = await db.get('cycles/CYC-PREVIEW/systemQty');
    const scans = await db.get('rounds/RP-STOCK/scans');
    state.scanLog = Object.keys(scans || {}).map(k => ({ id: k, rec: scans[k] }));
    state.counts = {}; state.scanQty = {}; state.manualQty = {};
    state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
    state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
    state.unknown = {}; state.unknownKeys = {}; state.manualLog = [];
    state.undoStack = []; state.appliedScanIds = Object.create(null);
    state.cycleData = null; state.priceField = 'sellPrice';
    state.page = 'summary'; state.summaryTab = 'sd';
    buildScanIndex();
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  });

  /* ---------- [3] ยอดรวมทั้งรอบ ---------- */
  console.log('\n[3] ยอดรวมทั้งรอบ (2 ใบ)');
  const r3 = await page.evaluate(async () => {
    const cd = await ensureCycleData();
    const g = cd.data.groups;
    return { act: g.total.actQty, sys: g.total.sysQty,
             npAct: g.notProduct.actQty, npSys: g.notProduct.sysQty,
             prodAct: g.product.actQty,
             jobs: cd.raw.jobs.length };
  });
  check('รวมครบทั้ง 2 ใบ', r3.jobs === 2, r3.jobs);
  check('ยอดรวมรอบ จริง 47 / ระบบ 50', r3.act === 47 && r3.sys === 50, r3);
  check('⭐ หน้าสรุป "นับ" Not Product ไว้ในกลุ่มของมัน (12 ชิ้น)',
        r3.npAct === 12 && r3.npSys === 12, r3);
  check('ของที่เป็นสินค้าจริงรวมได้ 35 ชิ้น', r3.prodAct === 35, r3.prodAct);

  /* ---------- [4] รายงานโชว์/สต็อก ---------- */
  console.log('\n[4] ⭐ รายงานโชว์/สต็อก — ครบ 4 สถานะ และตัด Not Product');
  const r4 = await page.evaluate(() => {
    const rep = stockDisplayReport();
    const by = {};
    rep.rows.forEach(function (r) { (by[r.status] = by[r.status] || []).push(r.code); });
    Object.keys(by).forEach(function (k) { by[k].sort(); });
    return { total: rep.total, counts: rep.counts, pct: rep.pct, by: by,
             codes: rep.rows.map(function (r) { return r.code; }).sort() };
  });
  check('เหลือ 7 SKU (ตัดถุงกระดาษออก)', r4.total === 7, r4.total);
  check('⭐ ไม่มี PKBAG01 ในรายงาน', r4.codes.indexOf('PKBAG01') < 0, r4.codes);
  check('ครอบครบทั้ง 4 สถานะ',
        r4.counts.stock_no_display === 3 && r4.counts.display_no_stock === 1 &&
        r4.counts.both === 2 && r4.counts.uncategorized === 1, r4.counts);
  check('มีของข้ามใบให้ลองปรับยอด (NTBG001 · SOSALE1 อยู่ทั้งสองฝั่ง)',
        r4.by.both.join(',') === 'NTBG001,SOSALE1', r4.by.both);
  check('⭐ ตัดตามประเภท ไม่ใช่ตามรูปแถว — NTAC001 รูปร่างเหมือนกันแต่เป็นสินค้า ต้องยังอยู่',
        r4.by.uncategorized.join(',') === 'NTAC001', r4.by.uncategorized);
  check('มีทั้งของที่มีแต่สต็อกและมีแต่โชว์',
        r4.by.stock_no_display.join(',') === 'NTOV001,NTOV002,NTSH001' &&
        r4.by.display_no_stock.join(',') === 'NTBG002', r4.by);
  check('% รวมกันได้ 100 พอดี',
        Math.round((r4.pct.stock_no_display + r4.pct.display_no_stock +
                    r4.pct.both + r4.pct.uncategorized) * 10) / 10 === 100, r4.pct);

  /* ---------- [5] หน้าจอ + ไฟล์ Excel ---------- */
  console.log('\n[5] การ์ด · โดนัท · ไฟล์ Excel 4 ชีท');
  const r5 = await page.evaluate(() => {
    renderStockDisplay();
    let sheets = null, fileName = null;
    const realBuild = window.buildXlsx, realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.buildXlsx = function (x) { sheets = x; return realBuild(x); };
    URL.createObjectURL = function () { return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    exportStockDisplayExcel();
    window.buildXlsx = realBuild; URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    const cards = {};
    document.querySelectorAll('[data-sdcard]').forEach(function (c) {
      cards[c.getAttribute('data-sdcard')] = c.querySelector('[data-sdnum]').textContent;
    });
    return {
      cards: cards,
      donuts: document.querySelectorAll('#sdDonut [data-sddonut]').length,
      rows: document.querySelectorAll('#sdBody [data-sdrow]').length,
      sheets: sheets.map(function (s) { return s.name + ':' + (s.rows.length - 1); }),
      dump: JSON.stringify(sheets),
      fileName: fileName
    };
  });
  check('การ์ด 4 ใบตรงกับรายงาน',
        r5.cards.stock_no_display === '3' && r5.cards.display_no_stock === '1' &&
        r5.cards.both === '2' && r5.cards.uncategorized === '1', r5.cards);
  check('โดนัทขึ้นครบ 4 วง', r5.donuts === 4, r5.donuts);
  check('ตารางมี 3 แถว (เฉพาะกลุ่มมีสต็อกไม่มีโชว์)', r5.rows === 3, r5.rows);
  check('⭐ Excel ได้ 4 ชีทพร้อมข้อมูลจริง',
        r5.sheets.join(' · ') ===
        'สรุป:9 · มีสต็อกไม่มีโชว์:3 · มีโชว์ไม่มีสต็อก:1 · ทั้งหมด-จำแนก:7', r5.sheets);
  check('⭐ ไม่มีถุงกระดาษปนในไฟล์เลยสักช่อง',
        r5.dump.indexOf('PKBAG01') < 0 && r5.dump.indexOf('ถุงกระดาษ') < 0,
        r5.dump.slice(0, 160));
  check('ชื่อไฟล์บอก Job + วันที่เป็นตัวเลข',
        /^stock-no-display-PRV-STOCK-25\d{6}\.xlsx$/.test(r5.fileName || ''), r5.fileName);

  /* ---------- [6] ลงใหม่ด้วยมือ ---------- */
  console.log('\n[6] __seedPreview(true) ลงทับได้');
  const r6 = await page.evaluate(() => {
    const ok = window.__seedPreview(true);
    const snap = db.localSnapshot() || {};
    return { ok: ok, scans: Object.keys(snap.rounds['RP-STOCK'].scans).length,
             products: Object.keys(snap.products || {}).length,
             toast: (window.__toasts[window.__toasts.length - 1] || {}).m };
  });
  check('สั่งลงใหม่ได้จาก Console', r6.ok === true, r6.ok);
  check('ลงทับแล้วยอดยังเท่าเดิม ไม่บวกซ้ำ', r6.scans === 7 && r6.products === 8, r6);
  check('บอกให้รีเฟรชหน้า', /รีเฟรช/.test(r6.toast || ''), r6.toast);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
