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
    window.__products = []; window.__asks = [];
    window.db.update = function (path, patch) {
      if (path !== 'settings') window.__products.push({ path: path, patch: patch });
      return Promise.resolve();
    };
    window.requireAdmin = function () { return true; };
    window.ask = function (t, b, ok) { window.__asks.push({ t: t, b: b, ok: ok }); return Promise.resolve(true); };
    window.toast = function () {};

    window.__seed = function () {
      state.customStatuses = [];
      state.products = {
        P1: { code: 'P1', name: 'ก', category: 'ห', type: 'product', typeSource: 'manual',
              needsReview: false, status: 'Normal', statusSource: 'manual', sellPrice: 100 },
        P2: { code: 'P2', name: 'ข', category: 'ห', type: 'product', typeSource: 'manual',
              needsReview: false, status: 'Normal', statusSource: 'manual', sellPrice: 0 },
        P3: { code: 'P3', name: 'ค', category: 'ห', type: 'product', typeSource: 'manual',
              needsReview: false, status: 'Normal', statusSource: 'manual',
              sellPrice: 250, priceSource: 'manual' },
        P4: { code: 'P4', name: 'ง', category: 'ห', type: 'product', typeSource: 'manual',
              needsReview: false, status: 'Normal', statusSource: 'manual', sellPrice: 90 },
        P5: { code: 'P5', name: 'จ', category: 'ห', type: 'product', typeSource: 'manual',
              needsReview: false, status: 'Normal', statusSource: 'manual', sellPrice: 10 }
      };
      state.masterFilter = 'all'; state.systemQty = {}; state.counts = {};
      window.__products = []; window.__asks = [];
    };
    window.__seed();
  });

  /* ---------- 1. Template ---------- */
  console.log('\n[1] Template มีคอลัมน์ราคาขาย');
  const r1 = await page.evaluate(() => {
    window.__seed();
    let captured = null, fileName = null;
    const realBuild = window.buildXlsx;
    window.buildXlsx = function (sheets) { captured = sheets; return new Blob(['x']); };
    const realCreate = document.createElement.bind(document);
    document.createElement = function (tag) {
      const el = realCreate(tag);
      if (tag === 'a') { el.click = function () { fileName = el.download; }; }
      return el;
    };
    try { downloadTypeTemplate(); } finally {
      window.buildXlsx = realBuild; document.createElement = realCreate;
    }
    const rows = captured[0].rows;
    const byCode = {};
    rows.slice(1).forEach(function (r) { byCode[r[0]] = r[5]; });
    return { header: rows[0], widths: captured[0].widths, fileName: fileName, byCode: byCode };
  });
  check('หัวตาราง 6 คอลัมน์ ปิดท้ายด้วย "ราคาขาย"',
        JSON.stringify(r1.header) === JSON.stringify(
          ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ประเภท', 'สถานะ', 'ราคาขาย']), r1.header);
  check('ความกว้างคอลัมน์ [18,44,24,16,20,14]',
        JSON.stringify(r1.widths) === JSON.stringify([18, 44, 24, 16, 20, 14]), r1.widths);
  check('ชื่อไฟล์ ISRD-Master-Type-Status-Price-Template.xlsx',
        r1.fileName === 'ISRD-Master-Type-Status-Price-Template.xlsx', r1.fileName);
  check('เติมราคาปัจจุบันมาให้ (เป็นตัวเลข ไม่ใช่ข้อความ)',
        r1.byCode.P1 === 100 && r1.byCode.P3 === 250, r1.byCode);
  check('สินค้าที่ยังไม่มีราคา เติม 0', r1.byCode.P2 === 0, r1.byCode.P2);

  /* ---------- 2. parseTypeFile อ่านราคา ---------- */
  console.log('\n[2] parseTypeFile — คอลัมน์ราคาขาย');
  const r2 = await page.evaluate(() => {
    window.__seed();
    return parseTypeFile({ rows: [
      ['รหัสสินค้า', 'ประเภท', 'สถานะ', 'ราคาขาย'],
      ['P1', 'Product', 'Normal', '199.50'],      // เปลี่ยนราคา
      ['P2', 'Product', 'Normal', '1,250'],       // มี comma ต้องอ่านออก
      ['P3', 'Product', 'Normal', '250'],         // เท่าเดิม + manual แล้ว → ข้าม
      ['P4', 'Product', 'Normal', ''],            // ว่าง → ไม่แตะ
      ['P5', 'Product', 'Normal', '-5']           // ติดลบ → กรอกผิด
    ] });
  });
  check('hasPriceColumn = true', r2.stat.hasPriceColumn === true, r2.stat.hasPriceColumn);
  check('P1 ราคาใหม่ 199.5', r2.priceUpdates.P1 === 199.5, r2.priceUpdates.P1);
  check('P2 อ่านตัวเลขที่มี comma ได้', r2.priceUpdates.P2 === 1250, r2.priceUpdates.P2);
  check('P3 เท่าเดิม + manual → ข้าม', r2.priceUpdates.P3 === undefined, r2.priceUpdates.P3);
  check('P4 ช่องว่าง → ไม่แตะของเดิม', r2.priceUpdates.P4 === undefined, r2.priceUpdates.P4);
  check('P5 ราคาติดลบ → ไม่เขียน', r2.priceUpdates.P5 === undefined, r2.priceUpdates.P5);
  check('stat.priceUpdated = 2', r2.stat.priceUpdated === 2, r2.stat.priceUpdated);
  check('stat.priceBlank = 1', r2.stat.priceBlank === 1, r2.stat.priceBlank);
  check('stat.priceSame = 1', r2.stat.priceSame === 1, r2.stat.priceSame);
  check('stat.priceBad = 1 พร้อมตัวอย่าง',
        r2.stat.priceBad === 1 && r2.stat.priceBadValues[0] === '-5', r2.stat);

  /* ราคา 0 ต้องเขียนได้ (ตั้งใจล้างราคา) */
  const r2b = await page.evaluate(() => {
    window.__seed();
    return parseTypeFile({ rows: [
      ['รหัสสินค้า', 'ประเภท', 'ราคาขาย'],
      ['P1', 'Product', '0']
    ] }).priceUpdates;
  });
  check('ราคา 0 เขียนได้ (ตั้งใจล้างราคา ไม่ใช่ช่องว่าง)', r2b.P1 === 0, r2b);

  /* ---------- 3. ไฟล์รุ่นเก่าไม่มีคอลัมน์ราคา ---------- */
  console.log('\n[3] ไฟล์รุ่นเก่า (ไม่มีคอลัมน์ราคา) ต้องไม่พัง');
  const r3 = await page.evaluate(() => {
    window.__seed();
    const res = parseTypeFile({ rows: [
      ['รหัสสินค้า', 'ประเภท', 'สถานะ'],
      ['P1', 'Not Product', 'Dead Stock']
    ] });
    return { has: res.stat.hasPriceColumn, keys: Object.keys(res.priceUpdates),
             type: res.updates.P1, status: res.statusUpdates.P1 };
  });
  check('hasPriceColumn = false', r3.has === false, r3.has);
  check('ไม่แตะราคาเลยสักตัว', r3.keys.length === 0, r3.keys);
  check('ประเภทกับสถานะยังทำงานปกติ',
        r3.type === 'notProduct' && r3.status === 'Dead Stock', r3);

  /* ---------- 4. handleTypeImport เขียนราคา ---------- */
  console.log('\n[4] handleTypeImport — เขียน sellPrice + priceSource');
  const r4 = await page.evaluate(async () => {
    window.__seed();
    const csv = [
      'รหัสสินค้า,ประเภท,ราคาขาย',
      'P1,Product,199.50',
      'P4,,320',            // ช่องประเภทว่าง แต่มีราคา
      'P5,Product,'         // ช่องราคาว่าง
    ].join('\n');
    await handleTypeImport(new File([csv], 'x.csv', { type: 'text/csv' }));
    const merged = {};
    window.__products.forEach(p => Object.assign(merged, p.patch));
    return { merged: merged, mem: state.products,
             confirmBody: (window.__asks[0] || {}).b,
             doneMsg: (window.__asks[1] || {}).b };
  });
  check('P1/sellPrice = 199.5', r4.merged['P1/sellPrice'] === 199.5, r4.merged['P1/sellPrice']);
  check('P1/priceSource = manual', r4.merged['P1/priceSource'] === 'manual', r4.merged['P1/priceSource']);
  check('P4 ไม่มีประเภทในไฟล์ แต่ได้ราคา + updatedAt',
        r4.merged['P4/sellPrice'] === 320 && r4.merged['P4/type'] === undefined &&
        typeof r4.merged['P4/updatedAt'] === 'number', r4.merged);
  check('P5 ช่องราคาว่าง ไม่ถูกเขียนราคา', r4.merged['P5/sellPrice'] === undefined, r4.merged['P5/sellPrice']);
  check('in-memory อัปเดตตาม',
        r4.mem.P1.sellPrice === 199.5 && r4.mem.P1.priceSource === 'manual' &&
        r4.mem.P4.sellPrice === 320, r4.mem.P1);
  check('กล่องยืนยันบอกจำนวนราคาที่จะเขียน',
        /จะเขียนราคาขาย 2 รายการ \(เปลี่ยนค่าจริง 2 รายการ\)/.test(r4.confirmBody || ''), r4.confirmBody);
  check('สรุปท้ายงานบอกราคาด้วย',
        /ยืนยันราคาขาย 2 รายการ/.test(r4.doneMsg || ''), r4.doneMsg);

  /* อัปโหลดซ้ำ = ไม่เขียนอะไร */
  const r4b = await page.evaluate(async () => {
    const csv = 'รหัสสินค้า,ประเภท,ราคาขาย\nP1,Product,199.50';
    window.__seed();
    await handleTypeImport(new File([csv], 'x.csv', { type: 'text/csv' }));
    const first = window.__products.reduce((n, p) => n + Object.keys(p.patch).length, 0);
    window.__products = []; window.__asks = [];
    await handleTypeImport(new File([csv], 'x.csv', { type: 'text/csv' }));
    return { first: first, second: window.__products.reduce((n, p) => n + Object.keys(p.patch).length, 0) };
  });
  check('รอบแรกเขียน · รอบสองไม่เขียนอะไรเลย',
        r4b.first > 0 && r4b.second === 0, r4b);

  /* ---------- 5. Master upsert ห้ามทับราคาที่ตั้งเอง ---------- */
  console.log('\n[5] นำเข้า Master ต้องไม่ทับราคาที่ตั้งจากไฟล์');
  const r5 = await page.evaluate(() => {
    state.products = {
      M1: { code: 'M1', name: 'ก', sellPrice: 250, priceSource: 'manual', type: 'product', typeSource: 'auto' },
      M2: { code: 'M2', name: 'ข', sellPrice: 90, type: 'product', typeSource: 'auto' },
      M3: { code: 'M3', name: 'ค', sellPrice: 70, priceSource: 'manual', type: 'product', typeSource: 'auto' }
    };
    const incoming = {
      M1: { code: 'M1', name: 'ก', sellPrice: 999, _type: 'product', _needsReview: false },
      M2: { code: 'M2', name: 'ข', sellPrice: 999, _type: 'product', _needsReview: false },
      /* ไฟล์ Zort บางงวดส่งราคามาเป็น 0 — ต้องไม่ล้างราคาที่ตั้งไว้ */
      M3: { code: 'M3', name: 'ค', sellPrice: 0, _type: 'product', _needsReview: false }
    };
    const patch = buildProductPatch(incoming).patch;
    return {
      m1: patch.M1.sellPrice, m1src: patch.M1.priceSource,
      m2: patch.M2.sellPrice, m2src: patch.M2.priceSource,
      m3: patch.M3.sellPrice
    };
  });
  check('M1 priceSource=manual → ไฟล์ทับไม่ได้', r5.m1 === 250, r5.m1);
  check('M1 ยัง carry priceSource=manual ต่อ', r5.m1src === 'manual', r5.m1src);
  check('M2 ไม่ได้ตั้งเอง → ไฟล์ทับได้ตามเดิม', r5.m2 === 999, r5.m2);
  check('M2 ไม่ถูกยัด priceSource ให้', r5.m2src === undefined, r5.m2src);
  check('ไฟล์ส่งราคา 0 มา ก็ล้างราคาที่ตั้งเองไม่ได้', r5.m3 === 70, r5.m3);

  /* ---------- 6. ราคาบนหน้ายิง ---------- */
  console.log('\n[6] การ์ดสินค้าบนหน้ายิงโชว์ราคาขาย');
  const r6 = await page.evaluate(() => {
    state.products = {
      S1: { code: 'S1', name: 'มีราคา', category: 'ห', type: 'product', sellPrice: 1299.5 },
      S2: { code: 'S2', name: 'ราคา 0', category: 'ห', type: 'product', sellPrice: 0 },
      S3: { code: 'S3', name: 'ไม่มีฟิลด์ราคา', category: 'ห', type: 'product' }
    };
    state.systemQty = { S1: 5, S2: 5, S3: 5 };
    state.counts = {}; state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
    state.transfers = {}; state.unknownKeys = {};
    const out = {};
    showScanHit('S1'); out.withPrice = $('slPrice').textContent; out.cls1 = $('slPrice').className;
    showScanHit('S2'); out.zero = $('slPrice').textContent; out.cls2 = $('slPrice').className;
    showScanHit('S3'); out.missing = $('slPrice').textContent;
    showScanNewCode('8850000000000', safeKey('8850000000000'));
    out.newCode = $('slPrice').textContent;
    /* ราคาต้องอยู่ในการ์ดสินค้า ไม่ใช่ลอยอยู่ที่อื่น */
    out.insideCard = !!document.querySelector('#scanLast .pc-info #slPrice');
    return out;
  });
  check('มีราคา → "ราคาขาย ฿1,299.50"', r6.withPrice === 'ราคาขาย ฿1,299.50', r6.withPrice);
  check('ตัวหนังสือเข้ม (ไม่ใช่คลาส none)', r6.cls1 === 'pc-price', r6.cls1);
  check('ราคา 0 → ขีดกลาง ไม่ใช่ ฿0.00', r6.zero === 'ราคาขาย — (ยังไม่กรอก)', r6.zero);
  check('ราคา 0 ใช้คลาสจาง', r6.cls2 === 'pc-price none', r6.cls2);
  check('ไม่มีฟิลด์ราคา → ขีดกลางเหมือนกัน', r6.missing === 'ราคาขาย — (ยังไม่กรอก)', r6.missing);
  check('บาร์โค้ดที่ไม่มีในระบบ → ขีดกลาง ไม่ค้างราคาตัวก่อน',
        r6.newCode === 'ราคาขาย — (ยังไม่กรอก)', r6.newCode);
  check('บรรทัดราคาอยู่ในการ์ดสินค้า', r6.insideCard === true, r6.insideCard);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
