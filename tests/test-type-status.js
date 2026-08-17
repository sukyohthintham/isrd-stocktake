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
    window.__products = [];
    window.__settings = [];
    window.db.update = function (path, patch) {
      if (path === 'settings') window.__settings.push(patch);
      else window.__products.push({ path: path, patch: patch });
      return Promise.resolve();
    };
    window.requireAdmin = function () { return true; };
    window.ask = function (t, b, ok) { window.__asks.push({ t: t, b: b, ok: ok }); return Promise.resolve(true); };
    window.toast = function () {};
    window.__asks = [];

    window.__seed = function () {
      state.customStatuses = ['ของโชว์'];          // ค่าที่แอดมินเคยเพิ่มไว้
      state.products = {
        // สถานะเปลี่ยน (Normal → Dead Stock) ประเภทไม่เปลี่ยน แต่ยัง auto
        A001: { code: 'A001', name: 'ก', category: 'ห', type: 'product', typeSource: 'auto', needsReview: false },
        // สถานะเดิม New CI ยืนยันไว้แล้ว (manual) และประเภทก็ยืนยันแล้ว → ข้ามทั้งคู่
        A002: { code: 'A002', name: 'ข', category: 'ห', type: 'product', typeSource: 'manual',
                needsReview: false, status: 'New CI', statusSource: 'manual' },
        // ช่องสถานะว่างในไฟล์ → ห้ามแตะสถานะเดิม
        A003: { code: 'A003', name: 'ค', category: 'ห', type: 'product', typeSource: 'manual',
                needsReview: false, status: 'GWP (แถม)', statusSource: 'manual' },
        // ช่องประเภทว่าง แต่มีสถานะ → ต้องได้สถานะใหม่
        A004: { code: 'A004', name: 'ง', category: 'ห', type: 'product', typeSource: 'manual', needsReview: false },
        // สถานะเป็นค่าใหม่ที่ไม่มีในทะเบียน
        A005: { code: 'A005', name: 'จ', category: 'ห', type: 'product', typeSource: 'manual', needsReview: false },
        // สถานะเป็นค่าที่แอดมินเพิ่มไว้แล้ว ไม่ต้องขึ้นทะเบียนซ้ำ
        A006: { code: 'A006', name: 'ฉ', category: 'ห', type: 'product', typeSource: 'manual', needsReview: false }
      };
      window.__products = []; window.__settings = []; window.__asks = [];
    };
    window.__seed();
  });

  /* ---------- 1. parseTypeFile อ่านสถานะ ---------- */
  console.log('\n[1] parseTypeFile — คอลัมน์สถานะ');
  const r1 = await page.evaluate(() => {
    window.__seed();
    const rows = [
      ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ประเภท', 'สถานะ'],
      ['A001', 'ก', 'ห', 'Product', 'Dead Stock'],
      ['A002', 'ข', 'ห', 'Product', 'New CI'],
      ['A003', 'ค', 'ห', 'Product', ''],
      ['A004', 'ง', 'ห', '', 'ปิดใช้งาน'],
      ['A005', 'จ', 'ห', 'Product', 'ล็อตพิเศษ 2569'],
      ['A006', 'ฉ', 'ห', 'Product', 'ของโชว์']
    ];
    return parseTypeFile({ rows: rows });
  });
  check('มีคอลัมน์สถานะ → hasStatusColumn', r1.stat.hasStatusColumn === true, r1.stat.hasStatusColumn);
  check('A001 สถานะเปลี่ยนเป็น Dead Stock', r1.statusUpdates.A001 === 'Dead Stock', r1.statusUpdates.A001);
  check('A002 ค่าเดิม + manual แล้ว → ข้าม', r1.statusUpdates.A002 === undefined, r1.statusUpdates.A002);
  check('A003 ช่องสถานะว่าง → ไม่แตะของเดิม', r1.statusUpdates.A003 === undefined, r1.statusUpdates.A003);
  check('A004 ช่องประเภทว่าง แต่สถานะยังถูกอ่าน',
        r1.statusUpdates.A004 === 'ปิดใช้งาน' && r1.updates.A004 === undefined, r1.statusUpdates.A004);
  check('A005 ค่าใหม่ถูกเก็บ', r1.statusUpdates.A005 === 'ล็อตพิเศษ 2569', r1.statusUpdates.A005);
  check('A006 ค่าที่แอดมินเพิ่มไว้แล้วก็เขียนได้', r1.statusUpdates.A006 === 'ของโชว์', r1.statusUpdates.A006);
  check('newStatuses มีแค่ค่าที่ไม่อยู่ในทะเบียน',
        JSON.stringify(r1.newStatuses) === JSON.stringify(['ล็อตพิเศษ 2569']), r1.newStatuses);
  check('stat.statusUpdated = 4 (A001,A004,A005,A006)', r1.stat.statusUpdated === 4, r1.stat.statusUpdated);
  check('stat.statusBlank = 1', r1.stat.statusBlank === 1, r1.stat.statusBlank);
  check('stat.statusSame = 1', r1.stat.statusSame === 1, r1.stat.statusSame);

  /* ---------- 2. ไฟล์รุ่นเก่าที่ไม่มีคอลัมน์สถานะ ---------- */
  console.log('\n[2] ไฟล์รุ่นเก่า (ไม่มีคอลัมน์สถานะ) ต้องไม่พัง');
  const r2 = await page.evaluate(() => {
    window.__seed();
    const res = parseTypeFile({ rows: [
      ['รหัสสินค้า', 'ประเภท'],
      ['A001', 'Not Product']
    ] });
    return { has: res.stat.hasStatusColumn, statusKeys: Object.keys(res.statusUpdates),
             newStatuses: res.newStatuses, typeUpd: res.updates.A001 };
  });
  check('ไม่มีคอลัมน์สถานะ → hasStatusColumn = false', r2.has === false, r2.has);
  check('ไม่แตะสถานะเลยสักตัว', r2.statusKeys.length === 0, r2.statusKeys);
  check('ไม่มีค่าสถานะใหม่', r2.newStatuses.length === 0, r2.newStatuses);
  check('ฝั่งประเภทยังทำงานปกติ', r2.typeUpd === 'notProduct', r2.typeUpd);

  /* ---------- 3. handleTypeImport เขียนจริง ---------- */
  console.log('\n[3] handleTypeImport — เขียน status + statusSource');
  const r3 = await page.evaluate(async () => {
    window.__seed();
    const csv = [
      'รหัสสินค้า,ประเภท,สถานะ',
      'A001,Product,Dead Stock',
      'A002,Product,New CI',
      'A003,Product,',
      'A004,,ปิดใช้งาน',
      'A005,Product,ล็อตพิเศษ 2569'
    ].join('\n');
    await handleTypeImport(new File([csv], 'x.csv', { type: 'text/csv' }));
    const merged = {};
    window.__products.forEach(p => Object.assign(merged, p.patch));
    return {
      merged: merged,
      settings: window.__settings,
      mem: {
        A001: state.products.A001, A003: state.products.A003,
        A004: state.products.A004, A005: state.products.A005
      },
      customStatuses: state.customStatuses,
      confirmBody: (window.__asks[0] || {}).b,
      confirmBtn: (window.__asks[0] || {}).ok,
      doneTitle: (window.__asks[1] || {}).t
    };
  });
  check('A001/status = Dead Stock', r3.merged['A001/status'] === 'Dead Stock', r3.merged['A001/status']);
  check('A001/statusSource = manual', r3.merged['A001/statusSource'] === 'manual', r3.merged['A001/statusSource']);
  check('A002 ยืนยันครบแล้ว ไม่ถูกเขียนสถานะ', r3.merged['A002/status'] === undefined, r3.merged['A002/status']);
  check('A003 ช่องว่าง ไม่ถูกเขียนสถานะ', r3.merged['A003/status'] === undefined, r3.merged['A003/status']);
  check('A003 สถานะเดิมในเครื่องยังอยู่', r3.mem.A003.status === 'GWP (แถม)', r3.mem.A003.status);
  check('A004 ไม่มีประเภทในไฟล์ แต่ได้สถานะ + updatedAt',
        r3.merged['A004/status'] === 'ปิดใช้งาน' && r3.merged['A004/type'] === undefined &&
        typeof r3.merged['A004/updatedAt'] === 'number', r3.merged['A004/status']);
  check('A005 ได้สถานะค่าใหม่', r3.merged['A005/status'] === 'ล็อตพิเศษ 2569', r3.merged['A005/status']);
  check('ขึ้นทะเบียนค่าใหม่ที่ settings/productStatuses 1 ครั้ง',
        r3.settings.length === 1 &&
        JSON.stringify(r3.settings[0].productStatuses) === JSON.stringify(['ของโชว์', 'ล็อตพิเศษ 2569']),
        r3.settings);
  check('state.customStatuses อัปเดตในเครื่องด้วย',
        JSON.stringify(r3.customStatuses) === JSON.stringify(['ของโชว์', 'ล็อตพิเศษ 2569']), r3.customStatuses);
  check('in-memory A001 ได้ status + statusSource',
        r3.mem.A001.status === 'Dead Stock' && r3.mem.A001.statusSource === 'manual', r3.mem.A001);
  check('กล่องยืนยันบอกจำนวนสถานะ',
        /จะเขียนสถานะ 3 รายการ \(เปลี่ยนค่าจริง 3 รายการ\)/.test(r3.confirmBody || ''), r3.confirmBody);
  check('กล่องยืนยันบอกค่าสถานะใหม่ที่จะเพิ่ม',
        /เพิ่มค่าสถานะใหม่เข้าทะเบียน 1 ค่า: ล็อตพิเศษ 2569/.test(r3.confirmBody || ''), r3.confirmBody);
  check('สรุปท้ายงานพูดถึงสถานะและราคา',
        /ยืนยันประเภท \+ สถานะ \+ ราคาเรียบร้อย/.test(r3.doneTitle || ''), r3.doneTitle);

  /* ---------- 4. อัปโหลดไฟล์เดิมซ้ำ = ไม่เขียนอะไร ---------- */
  console.log('\n[4] อัปโหลดไฟล์เดิมซ้ำรอบสอง');
  const r4 = await page.evaluate(async () => {
    const csv = ['รหัสสินค้า,ประเภท,สถานะ', 'A001,Product,Dead Stock'].join('\n');
    window.__seed();
    await handleTypeImport(new File([csv], 'x.csv', { type: 'text/csv' }));
    const first = window.__products.reduce((n, p) => n + Object.keys(p.patch).length, 0);
    window.__products = []; window.__settings = []; window.__asks = [];
    await handleTypeImport(new File([csv], 'x.csv', { type: 'text/csv' }));
    const second = window.__products.reduce((n, p) => n + Object.keys(p.patch).length, 0);
    return { first: first, second: second, msg: (window.__asks[0] || {}).t };
  });
  check('รอบแรกเขียน 6 คีย์ (type 4 + status 2)', r4.first === 6, r4.first);
  check('รอบสองไม่เขียนอะไรเลย', r4.second === 0, r4.second);
  check('รอบสองขึ้นกล่อง "ไม่มีอะไรต้องเปลี่ยน"', r4.msg === 'ไม่มีอะไรต้องเปลี่ยน', r4.msg);

  /* ---------- 5. Master upsert ห้ามทับสถานะที่ตั้งเอง ---------- */
  console.log('\n[5] นำเข้า Master ต้องไม่ทับสถานะที่ตั้งจากไฟล์');
  const r5 = await page.evaluate(() => {
    state.products = {
      M1: { code: 'M1', name: 'ก', status: 'Dead Stock', statusSource: 'manual', type: 'product', typeSource: 'auto' },
      M2: { code: 'M2', name: 'ข', status: 'GWP (แถม)', type: 'product', typeSource: 'auto' },
      M3: { code: 'M3', name: 'ค', type: 'product', typeSource: 'auto' }
    };
    /* จำลองไฟล์ Zort ที่ "มี" คอลัมน์สถานะและพยายามทับ */
    const incoming = {
      M1: { code: 'M1', name: 'ก', status: 'Normal', _type: 'product', _needsReview: false },
      M2: { code: 'M2', name: 'ข', status: 'Normal', _type: 'product', _needsReview: false },
      M3: { code: 'M3', name: 'ค', status: '', _type: 'product', _needsReview: false }
    };
    /* buildProductPatch คืน { patch: {key: recordเต็ม}, ... } ไม่ใช่ path แบบ slash */
    const patch = buildProductPatch(incoming).patch;
    return {
      m1: patch.M1.status, m1src: patch.M1.statusSource,
      m2: patch.M2.status, m2src: patch.M2.statusSource,
      m3: patch.M3.status
    };
  });
  check('M1 statusSource=manual → ไฟล์ทับไม่ได้', r5.m1 === 'Dead Stock', r5.m1);
  check('M1 ยัง carry statusSource=manual ต่อ', r5.m1src === 'manual', r5.m1src);
  check('M2 ไม่ได้ตั้งเอง → ไฟล์ทับได้ตามเดิม', r5.m2 === 'Normal', r5.m2);
  check('M2 ไม่ถูกยัด statusSource ให้', r5.m2src === undefined, r5.m2src);
  check('M3 ไฟล์ไม่มีค่า + ไม่มีของเดิม → Normal', r5.m3 === 'Normal', r5.m3);

  /* ---------- 6. ป้ายปุ่ม ---------- */
  console.log('\n[6] ป้ายปุ่ม');
  const r6 = await page.evaluate(() => ({
    tpl: document.getElementById('btnTypeTemplate').textContent,
    imp: document.getElementById('btnImportType').textContent
  }));
  check('ปุ่ม Template บอก (ประเภท + สถานะ + ราคา)',
        r6.tpl === '⬇ ดาวน์โหลด Template (ประเภท + สถานะ + ราคา)', r6.tpl);
  check('ปุ่มนำเข้าบอก เปลี่ยนประเภท + สถานะ + ราคา จากไฟล์',
        r6.imp === '🏷 เปลี่ยนประเภท + สถานะ + ราคา จากไฟล์', r6.imp);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
