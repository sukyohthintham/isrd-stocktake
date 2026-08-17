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
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  console.log('\n[8] วงจรจริง: โหลด Template .xlsx → แก้ → อัปโหลดกลับ');
  const out = await page.evaluate(async () => {
    window.__patches = [];
    window.db.update = function (p, patch) { window.__patches.push(patch); return Promise.resolve(); };
    window.requireAdmin = function () { return true; };
    window.ask = function () { return Promise.resolve(true); };
    window.toast = function () {};

    state.products = {
      Z001: { code: 'Z001', name: 'กล่องพัสดุ', category: 'อาหาร', type: 'product', needsReview: true,  typeSource: 'auto' },
      Z002: { code: 'Z002', name: 'ขนมจริง',   category: 'อาหาร', type: 'product', needsReview: false, typeSource: 'auto' }
    };
    state.systemQty = {}; state.counts = {}; state.masterFilter = 'all';

    /* สร้างไฟล์แบบเดียวกับที่ downloadTypeTemplate ปล่อยออกไป */
    const keys = masterRows();
    const rows = [['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ประเภท']];
    keys.forEach(function (k) {
      const p = state.products[k];
      rows.push([p.code, p.name, p.category, p.type === 'notProduct' ? 'Not Product' : 'Product']);
    });
    /* คนกรอกแก้แถวเดียว: Z001 เป็น Not Product */
    rows[1][3] = 'Not Product';

    const blob = buildXlsx([{ name: 'Type', rows: rows, widths: [18, 44, 24, 16] }]);
    const file = new File([blob], 'ISRD-Master-Type-Template.xlsx',
                          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await handleTypeImport(file);

    const merged = {};
    window.__patches.forEach(function (p) { Object.assign(merged, p); });
    return { keys: Object.keys(merged).sort(), merged: merged, mem: state.products };
  });
  check('อ่านไฟล์ .xlsx จริงได้ และเขียนทั้งสองแถวในไฟล์ (8 คีย์)', out.keys.length === 8, out.keys);
  check('Z001 (แถวที่แก้) → notProduct', out.merged['Z001/type'] === 'notProduct', out.merged['Z001/type']);
  check('Z001 typeSource = manual', out.merged['Z001/typeSource'] === 'manual', out.merged['Z001/typeSource']);
  check('Z001 needsReview = false', out.merged['Z001/needsReview'] === false, out.merged['Z001/needsReview']);
  check('Z002 (แถวที่ไม่ได้แก้) ประเภทคงเดิม', out.merged['Z002/type'] === 'product', out.merged['Z002/type']);
  check('Z002 ถูกยืนยันเป็น manual', out.mem.Z002.typeSource === 'manual', out.mem.Z002.typeSource);
  check('Z002 เคลียร์ออกจากรอตรวจสอบ', out.merged['Z002/needsReview'] === false, out.merged['Z002/needsReview']);

  console.log('\n--- errors ---');
  console.log(errors.slice(0, 8).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
