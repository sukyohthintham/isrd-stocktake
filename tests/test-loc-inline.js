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
    window.db.update = function (path, patch) {
      window.__writes.push({ path: path, patch: patch });
      return Promise.resolve();
    };
    hideLogin();

    window.__seed = function (role) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role || 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.page = 'master';
      state.products = {
        A001: { code: 'A001', name: 'เสื้อยืดคอกลม', barcode: '8850001', type: 'product' },
        A002: { code: 'A002', name: 'กางเกงยีนส์', barcode: '8850002', type: 'product' },
        B001: { code: 'B001', name: 'ถุงหิ้วใบใหญ่', barcode: '8850003', type: 'notProduct' }
      };
      state.locations = {
        offline: {
          A001: { sku: 'A001', name: 'เสื้อยืดคอกลม', pick: 'A1-01', refill: 'R1-01' },
          Z999: { sku: 'Z999', name: 'ของที่ไม่มีใน Master', pick: 'A1-09', refill: '' }
        },
        online: {
          A002: { sku: 'A002', name: 'กางเกงยีนส์', pick: 'ON-05', refill: '' }
        }
      };
      state.locationSet = 'offline';
      locViewSet = 'offline';
      $('locSearch').value = '';
      window.__toasts = []; window.__writes = [];
      renderLocationMaster();
    };

    window.__search = function (t) {
      $('locSearch').value = t;
      renderLocationMaster();
      return window.__view();
    };
    window.__view = function () {
      const host = document.getElementById('locList');
      const rows = Array.prototype.map.call(host.querySelectorAll('[data-loc]'), function (r) {
        const badges = Array.prototype.map.call(r.querySelectorAll('.badge, .chip'),
                                                function (b) { return b.textContent; });
        const pick = r.querySelector('[data-action="pick"]');
        const ref = r.querySelector('[data-action="refill"]');
        return { sku: r.getAttribute('data-loc'),
                 name: r.querySelector('.m-cat').textContent,
                 badges: badges,
                 hasEdit: !!r.querySelector('.m-edit'),
                 pick: pick ? pick.value : null,
                 refill: ref ? ref.value : null };
      });
      return {
        rows: rows,
        prompt: !!host.querySelector('[data-locprompt]'),
        empty: !!host.querySelector('[data-locempty]'),
        count: document.getElementById('locCount').textContent,
        status: document.getElementById('locStatus').textContent
      };
    };
  });

  /* ---------- 1. ยังไม่พิมพ์ค้นหา ---------- */
  console.log('\n[1] search-to-reveal');
  const r1 = await page.evaluate(() => { window.__seed('admin'); return window.__view(); });
  check('ไม่ถล่มลิสต์ ไม่มีแถวสักแถว', r1.rows.length === 0, r1.rows.length);
  check('โชว์ prompt ชวนค้นหา', r1.prompt === true, r1);
  check('ข้อความ prompt ตรงตามสเปก',
        await page.evaluate(() => document.querySelector('[data-locprompt]').textContent) ===
        '🔍 พิมพ์รหัสสินค้า ชื่อ หรือ Location เพื่อค้นหา', true);
  check('locStatus ยังนับ SKU ต่อชุดเหมือนเดิม',
        /Offline .*2 SKU · Online .*1 SKU/.test(r1.status), r1.status);

  /* ---------- 2. ค้นเจอสินค้าที่ยังไม่มี Location ---------- */
  console.log('\n[2] ค้นทั้ง Master ไม่ใช่แค่ตัวที่มี Location');
  const r2 = await page.evaluate(() => window.__search('B001'));
  check('เจอ B001 ที่ยังไม่เคยตั้ง Location', r2.rows.length === 1 && r2.rows[0].sku === 'B001', r2.rows);
  check('โชว์ชื่อจาก Master', r2.rows[0].name === 'ถุงหิ้วใบใหญ่', r2.rows[0].name);
  check('ติดป้าย "ยังไม่มี Location"',
        r2.rows[0].badges.indexOf('ยังไม่มี Location') >= 0, r2.rows[0].badges);
  check('ช่องแก้ว่างทั้งคู่', r2.rows[0].pick === '' && r2.rows[0].refill === '', r2.rows[0]);

  const r2b = await page.evaluate(() => window.__search('เสื้อยืด'));
  check('ค้นด้วยชื่อไทยได้', r2b.rows.length === 1 && r2b.rows[0].sku === 'A001', r2b.rows);
  check('ตัวที่มี Location โชว์ป้าย 📍 / 📦',
        r2b.rows[0].badges.join('|') === '📍 A1-01|📦 R1-01', r2b.rows[0].badges);

  const r2c = await page.evaluate(() => window.__search('8850002'));
  check('ค้นด้วยบาร์โค้ดได้', r2c.rows.length === 1 && r2c.rows[0].sku === 'A002', r2c.rows);

  const r2d = await page.evaluate(() => window.__search('A1-01'));
  check('ค้นด้วยรหัส Location ได้', r2d.rows.length === 1 && r2d.rows[0].sku === 'A001', r2d.rows);

  const r2e = await page.evaluate(() => window.__search('Z999'));
  check('เจอ Location ที่ไม่มีใน Master (ของค้างจากไฟล์เก่า)',
        r2e.rows.length === 1 && r2e.rows[0].sku === 'Z999' &&
        r2e.rows[0].name === 'ของที่ไม่มีใน Master', r2e.rows);

  const r2f = await page.evaluate(() => window.__search('ไม่มีคำนี้'));
  check('ค้นไม่เจอ มีข้อความบอก ไม่ใช่ลิสต์ว่างเปล่า',
        r2f.empty === true && r2f.rows.length === 0, r2f);

  /* ---------- 3. แก้ inline แล้วเขียนถูก path ---------- */
  console.log('\n[3] saveLocationEdit — เขียน');
  const r3 = await page.evaluate(async () => {
    window.__seed('admin');
    window.__search('B001');
    window.__writes = []; window.__toasts = [];
    const row = document.querySelector('[data-loc="B001"]');
    row.querySelector('[data-action="pick"]').value = ' c2-07 ';
    row.querySelector('[data-action="refill"]').value = 'R9-01';
    row.querySelector('[data-action="pick"]').onchange();
    await new Promise(function (r) { setTimeout(r, 50); });
    return { writes: window.__writes, mem: state.locations.offline.B001,
             toast: (window.__toasts[0] || {}).m,
             rowsAfter: window.__view().rows };
  });
  check('เขียน 1 ครั้งที่ locations/offline',
        r3.writes.length === 1 && r3.writes[0].path === 'locations/offline', r3.writes);
  check('patch คีย์เป็น B001 พร้อม sku/name/pick/refill ครบ',
        JSON.stringify(r3.writes[0].patch) ===
        JSON.stringify({ B001: { sku: 'B001', name: 'ถุงหิ้วใบใหญ่', pick: 'c2-07', refill: 'R9-01' } }),
        r3.writes[0].patch);
  check('ตัดช่องว่างหัวท้ายให้', r3.writes[0].patch.B001.pick === 'c2-07', r3.writes[0].patch.B001.pick);
  check('อัปเดต state ในเครื่องด้วย', r3.mem && r3.mem.pick === 'c2-07', r3.mem);
  check('toast บอกว่าบันทึกแล้ว', r3.toast === 'บันทึก Location B001 แล้ว', r3.toast);
  check('วาดใหม่แล้วป้ายเปลี่ยนเป็น 📍/📦',
        r3.rowsAfter[0].badges.join('|') === '📍 c2-07|📦 R9-01', r3.rowsAfter[0].badges);

  /* ---------- 4. ล้างทั้งสองช่อง = ลบเรคอร์ด ---------- */
  console.log('\n[4] saveLocationEdit — ลบ');
  const r4 = await page.evaluate(async () => {
    window.__seed('admin');
    window.__search('A001');
    window.__writes = [];
    const row = document.querySelector('[data-loc="A001"]');
    row.querySelector('[data-action="pick"]').value = '';
    row.querySelector('[data-action="refill"]').value = '   ';
    row.querySelector('[data-action="refill"]').onchange();
    await new Promise(function (r) { setTimeout(r, 50); });
    return { patch: window.__writes[0] && window.__writes[0].patch,
             path: window.__writes[0] && window.__writes[0].path,
             stillInMem: Object.prototype.hasOwnProperty.call(state.locations.offline, 'A001'),
             badges: window.__view().rows[0].badges };
  });
  check('เขียน null ที่คีย์นั้น (RTDB = ลบ)', r4.patch && r4.patch.A001 === null, r4.patch);
  check('path ถูกชุด', r4.path === 'locations/offline', r4.path);
  check('ลบออกจาก state ในเครื่องด้วย', r4.stillInMem === false, r4.stillInMem);
  check('ป้ายกลับเป็น "ยังไม่มี Location"',
        r4.badges.indexOf('ยังไม่มี Location') >= 0, r4.badges);

  /* ---------- 5. สลับชุด Offline / Online ---------- */
  console.log('\n[5] ชุด Offline / Online แยกกัน');
  const r5 = await page.evaluate(async () => {
    window.__seed('admin');
    locViewSet = 'online';
    const view = window.__search('A002');
    window.__writes = [];
    const row = document.querySelector('[data-loc="A002"]');
    row.querySelector('[data-action="pick"]').value = 'ON-99';
    row.querySelector('[data-action="pick"]').onchange();
    await new Promise(function (r) { setTimeout(r, 50); });
    return { pickShown: view.rows[0].pick, path: window.__writes[0].path,
             offlineUntouched: !state.locations.offline.A002,
             onlineNow: state.locations.online.A002.pick };
  });
  check('ชุด online โชว์ค่าของ online', r5.pickShown === 'ON-05', r5.pickShown);
  check('เขียนลง locations/online', r5.path === 'locations/online', r5.path);
  check('ชุด offline ไม่ถูกแตะ', r5.offlineUntouched === true, r5.offlineUntouched);
  check('ค่าใน online อัปเดต', r5.onlineNow === 'ON-99', r5.onlineNow);

  /* ---------- 6. admin gate ---------- */
  console.log('\n[6] เฉพาะ admin แก้ได้');
  const r6 = await page.evaluate(async () => {
    const out = {};
    ['counter', 'scanner'].forEach(function (role) {
      window.__seed(role);
      const v = window.__search('A001');
      out[role] = { rows: v.rows.length, hasEdit: v.rows[0] && v.rows[0].hasEdit,
                    importDisabled: $('btnImportLoc').disabled };
    });
    window.__seed('admin');
    const va = window.__search('A001');
    out.admin = { hasEdit: va.rows[0].hasEdit, importDisabled: $('btnImportLoc').disabled };

    /* counter เรียกฟังก์ชันตรง ๆ ต้องไม่เขียนอะไร */
    window.__seed('counter');
    window.__writes = []; window.__toasts = [];
    await saveLocationEdit('A001', 'A001', 'x', 'HACK', '');
    out.directWrites = window.__writes.length;
    out.directToast = (window.__toasts[0] || {}).m;
    out.memUntouched = state.locations.offline.A001.pick;
    return out;
  });
  check('counter เห็นรายการแต่ไม่มีช่องแก้',
        r6.counter.rows === 1 && r6.counter.hasEdit === false, r6.counter);
  check('scanner ก็ไม่มีช่องแก้', r6.scanner.hasEdit === false, r6.scanner);
  check('admin มีช่องแก้', r6.admin.hasEdit === true, r6.admin);
  check('ปุ่มนำเข้า Location ล็อกตามสิทธิ์เหมือนเดิม',
        r6.counter.importDisabled === true && r6.admin.importDisabled === false, r6);
  check('counter เรียก saveLocationEdit ตรง ๆ ก็ไม่เขียน', r6.directWrites === 0, r6.directWrites);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(r6.directToast || ''), r6.directToast);
  check('ค่าเดิมไม่ถูกแตะ', r6.memUntouched === 'A1-01', r6.memUntouched);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
