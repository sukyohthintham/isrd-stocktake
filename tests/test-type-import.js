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

  /* ---------- ตัวดัก db.update / ask ---------- */
  await page.evaluate(() => {
    window.__patches = [];
    window.__asks = [];
    window.db.update = function (path, patch) {
      window.__patches.push({ path: path, patch: patch });
      return Promise.resolve();
    };
    window.requireAdmin = function () { return true; };
    window.ask = function (title, body, okLabel) {
      window.__asks.push({ title: title, body: body, ok: okLabel });
      return Promise.resolve(true);
    };
    window.toast = function () {};

    window.__seed = function () {
      state.products = {
        // แก้ค่า + ค้างรอตรวจสอบ
        A001: { code: 'A001', name: 'ของจริง',  category: 'อาหาร',     type: 'product',    needsReview: true,  typeSource: 'auto' },
        // แก้ค่ากลับเป็น Product
        A002: { code: 'A002', name: 'ถุงหิ้ว',  category: 'บรรจุภัณฑ์', type: 'notProduct', needsReview: false, typeSource: 'auto' },
        // ค่าเท่าเดิม แต่ยัง auto → ต้องเขียนเพื่อยืนยัน
        A003: { code: 'A003', name: 'ยืนยันเฉย', category: 'อาหาร',     type: 'product',    needsReview: false, typeSource: 'auto' },
        // ค่าเท่าเดิม + manual แต่ยังค้างรอตรวจสอบ → ต้องเขียนเพื่อเคลียร์ธง
        A011: { code: 'A011', name: 'ค้างธง',   category: 'อาหาร',     type: 'product',    needsReview: true,  typeSource: 'manual' },
        // ยืนยันครบแล้วจริง ๆ → ข้าม
        A012: { code: 'A012', name: 'ครบแล้ว',  category: 'อาหาร',     type: 'product',    needsReview: false, typeSource: 'manual' },
        // ของเลิกขาย — Template เติมว่า Product เหมือนกัน ต้องไม่ถูกพลิก
        A004: { code: 'A004', name: 'เลิกขาย',  category: 'ปิดใช้งาน',  type: 'inactive',   needsReview: false, typeSource: 'auto' },
        A005: { code: 'A005', name: 'ช่องว่าง', category: 'อาหาร',     type: 'product',    needsReview: false, typeSource: 'auto' },
        A006: { code: 'A006', name: 'กรอกมั่ว', category: 'อาหาร',     type: 'product',    needsReview: false, typeSource: 'auto' },
        A008: { code: 'A008', name: 'ใช้ NP',   category: 'อาหาร',     type: 'product',    needsReview: false, typeSource: 'auto' },
        A009: { code: 'A009', name: 'ไทยเต็ม',  category: 'อาหาร',     type: 'product',    needsReview: false, typeSource: 'auto' },
        A010: { code: 'A010', name: 'ซ้ำสองแถว', category: 'อาหาร',    type: 'product',    needsReview: false, typeSource: 'auto' }
      };
      state.systemQty = {}; state.counts = {}; state.masterFilter = 'all';
    };
    window.__seed();
  });

  /* ---------- 1. parseTypeFile ---------- */
  console.log('\n[1] parseTypeFile — เขียนเมื่อ "เปลี่ยน หรือ ยังไม่ยืนยัน" · ข้ามเมื่อยืนยันครบแล้ว');
  const r1 = await page.evaluate(() => {
    const rows = [
      ['รายงานสินค้า', '', '', ''],
      ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ประเภทสินค้า'],
      ['A001', 'ของจริง', 'อาหาร', 'Not Product'],
      ['A002', 'ถุงหิ้ว', 'บรรจุภัณฑ์', 'Product'],
      ['A003', 'ยืนยันเฉย', 'อาหาร', 'Product'],
      ['A011', 'ค้างธง', 'อาหาร', 'Product'],
      ['A012', 'ครบแล้ว', 'อาหาร', 'Product'],
      ['A004', 'เลิกขาย', 'ปิดใช้งาน', 'Product'],
      ['A005', 'ช่องว่าง', 'อาหาร', ''],
      ['A006', 'กรอกมั่ว', 'อาหาร', 'ของแถม'],
      ['A007', 'ไม่มีใน Master', 'อาหาร', 'Not Product'],
      ['', 'ไม่มีรหัส', 'อาหาร', 'Product'],
      ['A008', 'ใช้ NP', 'อาหาร', 'np'],
      ['A009', 'ไทยเต็ม', 'อาหาร', 'ไม่ใช่สินค้า'],
      ['A010', 'ซ้ำสองแถว', 'อาหาร', 'Not Product'],
      ['A010', 'ซ้ำสองแถว', 'อาหาร', 'Not Product'],
      ['', '', '', ''], ['', '', '', '']
    ];
    return parseTypeFile({ rows: rows });
  });
  check('A001 product → Not Product', r1.updates.A001 === 'notProduct', r1.updates.A001);
  check('A002 notProduct → Product', r1.updates.A002 === 'product', r1.updates.A002);
  check('A003 ค่าเท่าเดิมแต่ยัง auto → เขียนยืนยัน', r1.updates.A003 === 'product', r1.updates.A003);
  check('A011 manual แต่ค้างรอตรวจ → เขียนเคลียร์ธง', r1.updates.A011 === 'product', r1.updates.A011);
  check('A012 manual + ไม่ค้างธง + ค่าเท่าเดิม → ข้าม', r1.updates.A012 === undefined, r1.updates.A012);
  check('A004 ของปิดใช้งาน ถูกตรึงเป็น inactive ไม่พลิกเป็น product',
        r1.updates.A004 === 'inactive', r1.updates.A004);
  check('A005 ช่องว่าง ไม่แตะของเดิม', r1.updates.A005 === undefined, r1.updates.A005);
  check('A006 กรอกมั่ว ไม่แตะของเดิม', r1.updates.A006 === undefined, r1.updates.A006);
  check('A007 ไม่มีใน Master ไม่สร้างใหม่', r1.updates.A007 === undefined, r1.updates.A007);
  check('A008 รับคำว่า np', r1.updates.A008 === 'notProduct', r1.updates.A008);
  check('A009 รับคำว่า ไม่ใช่สินค้า', r1.updates.A009 === 'notProduct', r1.updates.A009);
  check('A010 ซ้ำสองแถว นับเป็นตัวเดียว', r1.updates.A010 === 'notProduct', r1.updates.A010);
  check('stat.rows = 14 (ตัดแถวว่างท้ายไฟล์)', r1.stat.rows === 14, r1.stat.rows);
  check('stat.updated = 8 (A001,2,3,11,4,8,9,10)', r1.stat.updated === 8, r1.stat.updated);
  check('stat.changed = 5', r1.stat.changed === 5, r1.stat.changed);
  check('stat.confirmed = 3 (A003,A011,A004)', r1.stat.confirmed === 3, r1.stat.confirmed);
  check('stat.keptInactive = 1', r1.stat.keptInactive === 1, r1.stat.keptInactive);
  check('stat.same = 1 (A012 เท่านั้น)', r1.stat.same === 1, r1.stat.same);
  check('stat.blank = 1', r1.stat.blank === 1, r1.stat.blank);
  check('stat.invalid = 1', r1.stat.invalid === 1, r1.stat.invalid);
  check('stat.invalidValues เก็บตัวอย่าง', r1.stat.invalidValues[0] === 'ของแถม', r1.stat.invalidValues);
  check('stat.notFound = 1', r1.stat.notFound === 1, r1.stat.notFound);
  check('stat.noCode = 1', r1.stat.noCode === 1, r1.stat.noCode);
  check('stat.toNotProduct = 4 (นับเฉพาะที่เปลี่ยนจริง)', r1.stat.toNotProduct === 4, r1.stat.toNotProduct);
  check('stat.toProduct = 1 (นับเฉพาะที่เปลี่ยนจริง)', r1.stat.toProduct === 1, r1.stat.toProduct);

  /* ---------- 2. idempotent: อัปโหลดไฟล์เดิมซ้ำรอบสอง = ไม่เขียนอะไรเลย ---------- */
  console.log('\n[2] อัปโหลดไฟล์เดิมซ้ำรอบสอง');
  const r2 = await page.evaluate(async () => {
    window.__seed(); window.__patches = [];
    const csv = ['รหัสสินค้า,ประเภท', 'A001,Not Product', 'A003,Product', 'A011,Product'].join('\n');
    await handleTypeImport(new File([csv], 'a.csv', { type: 'text/csv' }));
    const firstKeys = window.__patches.reduce((n, p) => n + Object.keys(p.patch).length, 0);
    window.__patches = [];
    await handleTypeImport(new File([csv], 'a.csv', { type: 'text/csv' }));
    const secondKeys = window.__patches.reduce((n, p) => n + Object.keys(p.patch).length, 0);
    return { firstKeys: firstKeys, secondKeys: secondKeys, mem: state.products.A003 };
  });
  check('รอบแรกเขียน 12 คีย์ (3 รายการ x 4)', r2.firstKeys === 12, r2.firstKeys);
  check('รอบสองไม่เขียนอะไรเลย', r2.secondKeys === 0, r2.secondKeys);
  check('A003 กลายเป็น manual + ไม่ค้างธง',
        r2.mem.typeSource === 'manual' && r2.mem.needsReview === false, r2.mem);

  /* ---------- 3. handleTypeImport — เขียนจริง ---------- */
  console.log('\n[3] handleTypeImport — เขียนลงฐาน + อัปเดตในเครื่อง');
  const r3 = await page.evaluate(async () => {
    window.__seed(); window.__patches = []; window.__asks = [];
    const csv = [
      'รหัสสินค้า,ชื่อสินค้า,หมวดหมู่,ประเภท',
      'A001,ของจริง,อาหาร,Not Product',
      'A003,ยืนยันเฉย,อาหาร,Product',
      'A012,ครบแล้ว,อาหาร,Product',
      'A004,เลิกขาย,ปิดใช้งาน,Product'
    ].join('\n');
    await handleTypeImport(new File([csv], 'type.csv', { type: 'text/csv' }));
    const merged = {};
    window.__patches.forEach(p => Object.assign(merged, p.patch));
    return {
      paths: window.__patches.map(p => p.path),
      keyCount: Object.keys(merged).length,
      merged: merged,
      asks: window.__asks.map(a => a.title),
      confirmBody: (window.__asks[0] || {}).body,
      confirmBtn: (window.__asks[0] || {}).ok,
      memA001: state.products.A001,
      memA003: state.products.A003,
      memA004: state.products.A004,
      memA012: state.products.A012
    };
  });
  check('เขียนที่ products เท่านั้น', r3.paths.every(p => p === 'products'), r3.paths);
  check('เขียน 12 คีย์ (3 รายการ x 4 ฟิลด์)', r3.keyCount === 12, r3.keyCount);
  check('A001/type = notProduct', r3.merged['A001/type'] === 'notProduct', r3.merged['A001/type']);
  check('A001/typeSource = manual', r3.merged['A001/typeSource'] === 'manual', r3.merged['A001/typeSource']);
  check('A001/needsReview = false', r3.merged['A001/needsReview'] === false, r3.merged['A001/needsReview']);
  check('A001/updatedAt เป็นตัวเลข', typeof r3.merged['A001/updatedAt'] === 'number', r3.merged['A001/updatedAt']);
  check('A003 ไม่เปลี่ยนค่า แต่ถูกเขียนเพื่อยืนยัน',
        r3.merged['A003/type'] === 'product' && r3.merged['A003/typeSource'] === 'manual' &&
        r3.merged['A003/needsReview'] === false, r3.merged['A003/type']);
  check('A004 ปิดใช้งาน เขียน type = inactive ไม่ใช่ product',
        r3.merged['A004/type'] === 'inactive', r3.merged['A004/type']);
  check('A004 ยังถูกยืนยันเป็น manual + เคลียร์ธง',
        r3.merged['A004/typeSource'] === 'manual' && r3.merged['A004/needsReview'] === false, r3.merged);
  check('A004 ในเครื่องยังเป็น inactive', r3.memA004.type === 'inactive', r3.memA004.type);
  check('A012 ยืนยันครบแล้ว ไม่ถูกเขียน', r3.merged['A012/type'] === undefined, r3.merged['A012/type']);
  check('A012 ในเครื่องไม่ถูกแตะ updatedAt', r3.memA012.updatedAt === undefined, r3.memA012.updatedAt);
  check('in-memory A003 อัปเดตครบ',
        r3.memA003.typeSource === 'manual' && r3.memA003.needsReview === false, r3.memA003);
  check('กล่องยืนยันบอกว่าอัปโหลด = ยืนยันทุกแถว',
        /ยืนยันว่า "ทุกแถวในไฟล์" มีประเภท สถานะ และราคาถูกต้องแล้ว/.test(r3.confirmBody), r3.confirmBody);
  check('กล่องยืนยันบอกว่าเคลียร์ออกจากรอตรวจสอบ',
        /เคลียร์ออกจาก "รอตรวจสอบ"/.test(r3.confirmBody), r3.confirmBody);
  check('กล่องยืนยันแยกตัวเลข เปลี่ยน / ยืนยันเดิม',
        /เปลี่ยนเป็น Not Product 1/.test(r3.confirmBody) &&
        /ยืนยันประเภทเดิม \(ไม่เปลี่ยนค่า\) 2/.test(r3.confirmBody), r3.confirmBody);
  check('ปุ่มยืนยันบอกว่าแตะทั้งไฟล์', r3.confirmBtn === 'ยืนยันทั้งไฟล์ 3 รายการ', r3.confirmBtn);
  check('มีกล่องยืนยันแล้วตามด้วยสรุปผล', r3.asks.length === 2, r3.asks);

  /* ---------- 4. กดยกเลิก ---------- */
  console.log('\n[4] handleTypeImport — กดยกเลิก');
  const r4 = await page.evaluate(async () => {
    window.__seed(); window.__patches = [];
    const realAsk = window.ask;
    window.ask = function () { return Promise.resolve(false); };
    await handleTypeImport(new File(['รหัสสินค้า,ประเภท\nA001,Not Product'], 'a.csv', { type: 'text/csv' }));
    window.ask = realAsk;
    return { patches: window.__patches.length, mem: state.products.A001 };
  });
  check('ยกเลิกแล้วไม่มีการเขียน', r4.patches === 0, r4.patches);
  check('ยกเลิกแล้วค่าในเครื่องไม่เปลี่ยน',
        r4.mem.type === 'product' && r4.mem.typeSource === 'auto' && r4.mem.needsReview === true, r4.mem);

  /* ---------- 5. ไฟล์ผิดรูปแบบ ---------- */
  console.log('\n[5] parseTypeFile — ไฟล์ผิดรูปแบบ');
  const r5 = await page.evaluate(() => {
    const out = {};
    try { parseTypeFile({ rows: [] }); } catch (e) { out.empty = e.message; }
    try { parseTypeFile({ rows: [['รหัสสินค้า', 'ชื่อสินค้า'], ['A001', 'x']] }); }
    catch (e) { out.missing = e.message + ':' + (e.missing || []).join(','); }
    try { parseTypeFile({ rows: [['ก', 'ข'], ['A001', 'x']] }); }
    catch (e) { out.noHeader = e.message + ':' + (e.missing || []).join(','); }
    return out;
  });
  check('ไฟล์ว่าง → EMPTY_FILE', r5.empty === 'EMPTY_FILE', r5.empty);
  check('ไม่มีคอลัมน์ประเภท → MISSING_COLUMNS', r5.missing === 'MISSING_COLUMNS:ประเภท', r5.missing);
  check('ไม่มีหัวตารางเลย → MISSING_COLUMNS ทั้งสอง',
        r5.noHeader === 'MISSING_COLUMNS:รหัสสินค้า,ประเภท', r5.noHeader);

  /* ---------- 6. downloadTypeTemplate ---------- */
  console.log('\n[6] downloadTypeTemplate');
  const r6 = await page.evaluate(() => {
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
    const byCode = {}, statusByCode = {};
    rows.slice(1).forEach(r => { byCode[r[0]] = r[3]; statusByCode[r[0]] = r[4]; });
    return { header: rows[0], fileName: fileName, byCode: byCode,
             statusByCode: statusByCode, widths: captured[0].widths };
  });
  check('หัวตาราง 6 คอลัมน์ (มีสถานะ + ราคาขาย)',
        JSON.stringify(r6.header) === JSON.stringify(
          ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ประเภท', 'สถานะ', 'ราคาขาย']), r6.header);
  check('ความกว้างคอลัมน์ [18,44,24,16,20,14]',
        JSON.stringify(r6.widths) === JSON.stringify([18, 44, 24, 16, 20, 14]), r6.widths);
  check('ชื่อไฟล์ ISRD-Master-Type-Status-Price-Template.xlsx',
        r6.fileName === 'ISRD-Master-Type-Status-Price-Template.xlsx', r6.fileName);
  check('notProduct เติมว่า Not Product', r6.byCode.A002 === 'Not Product', r6.byCode.A002);
  check('product เติมว่า Product', r6.byCode.A001 === 'Product', r6.byCode.A001);
  check('สินค้าที่ไม่มี status เติมว่า Normal', r6.statusByCode.A001 === 'Normal', r6.statusByCode.A001);

  /* ---------- 7. ตัดก้อนละ 400 ---------- */
  console.log('\n[7] เขียนเป็นก้อนละ 400');
  const r7 = await page.evaluate(async () => {
    window.__patches = [];
    state.products = {};
    const lines = ['รหัสสินค้า,ประเภท'];
    for (let i = 0; i < 250; i++) {
      const code = 'B' + String(i).padStart(4, '0');
      state.products[code] = { code: code, name: code, category: 'อาหาร', type: 'product', typeSource: 'auto' };
      lines.push(code + ',Not Product');
    }
    await handleTypeImport(new File([lines.join('\n')], 'b.csv', { type: 'text/csv' }));
    const sizes = window.__patches.map(p => Object.keys(p.patch).length);
    return { chunks: sizes, total: sizes.reduce((a, b) => a + b, 0) };
  });
  check('250 รายการ = 1000 คีย์', r7.total === 1000, r7.total);
  check('แบ่งเป็น 3 ก้อน (400/400/200)',
        JSON.stringify(r7.chunks) === JSON.stringify([400, 400, 200]), r7.chunks);

  /* ---------- 8. ล็อกปุ่มตามสิทธิ์ ---------- */
  console.log('\n[8] ล็อกปุ่มตามสิทธิ์');
  const r8 = await page.evaluate(() => {
    const out = {};
    const realIsAdmin = window.isAdmin;
    state.products = {};
    window.isAdmin = function () { return false; };
    renderMaster();
    out.lockedNote = document.getElementById('btnImportNote').disabled;
    out.lockedType = document.getElementById('btnImportType').disabled;
    out.templateFree = document.getElementById('btnTypeTemplate').disabled;
    window.isAdmin = function () { return true; };
    renderMaster();
    out.openType = document.getElementById('btnImportType').disabled;
    window.isAdmin = realIsAdmin;
    return out;
  });
  check('ไม่ใช่ admin → ปุ่มเปลี่ยนประเภทถูกล็อก', r8.lockedType === true, r8.lockedType);
  check('ล็อกพร้อมกับปุ่ม Note', r8.lockedNote === true, r8.lockedNote);
  check('ปุ่มโหลด Template ไม่ล็อก', r8.templateFree === false, r8.templateFree);
  check('admin → ปุ่มปลดล็อก', r8.openType === false, r8.openType);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
