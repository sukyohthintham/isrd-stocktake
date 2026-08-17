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

  /* ---------- 1. HTML ---------- */
  console.log('\n[1] ปุ่มและช่องรับไฟล์');
  const r1 = await page.evaluate(() => ({
    accept: document.getElementById('imageFile').accept,
    label: document.getElementById('btnImportImages').textContent,
    version: APP_VERSION,
    meta: document.querySelector('meta[name=version]').content,
    title: document.title
  }));
  check('accept = .json,.csv', r1.accept === '.json,.csv', r1.accept);
  check('ป้ายปุ่มบอกว่ารับ JSON / CSV', r1.label === '🖼 นำเข้ารูปสินค้า (JSON / CSV)', r1.label);
  check('เวอร์ชันตรงกันทั้ง 3 จุด',
    r1.version === r1.meta && r1.title === 'ISRD Stocktake v' + r1.meta,
    [r1.version, r1.meta, r1.title]);

  /* ---------- 2. CSV แบบ A — jsonb_object_agg ---------- */
  console.log('\n[2] CSV แบบ A (คอลัมน์เดียวชื่อ images)');
  const r2 = await page.evaluate(() => {
    const inner = JSON.stringify({ 'SKU-1': 'https://cdn/a.jpg', 'SKU-2': 'https://cdn/b.jpg' });
    const csvCell = '"' + inner.replace(/"/g, '""') + '"';
    const out = {};
    out.plain = parseImageMap('images\n' + csvCell);
    out.quotedHeader = parseImageMap('"images"\n' + csvCell);
    out.withBom = parseImageMap('\uFEFFimages\n' + csvCell);
    out.crlf = parseImageMap('images\r\n' + csvCell + '\r\n');
    /* แบบย่อ prefix/suffix ที่ห่อมาใน CSV ต้องถูกคลี่ต่อโดย parseImageMap เหมือน JSON */
    const short = JSON.stringify({ prefix: 'https://cdn/', suffix: '.jpg',
                                   images: { 'SKU-9': 'nine', 'SKU-8': '*https://other/x.png' } });
    out.short = parseImageMap('images\n"' + short.replace(/"/g, '""') + '"');
    return out;
  });
  check('อ่านก้อน JSON ที่ escape แบบ CSV ได้',
    JSON.stringify(r2.plain) === JSON.stringify({ 'SKU-1': 'https://cdn/a.jpg', 'SKU-2': 'https://cdn/b.jpg' }), r2.plain);
  check('หัวคอลัมน์มีเครื่องหมายคำพูดก็อ่านได้', r2.quotedHeader['SKU-1'] === 'https://cdn/a.jpg', r2.quotedHeader);
  check('ไฟล์ที่มี BOM นำหน้าอ่านได้', r2.withBom['SKU-1'] === 'https://cdn/a.jpg', r2.withBom);
  check('ไฟล์ CRLF อ่านได้', r2.crlf['SKU-2'] === 'https://cdn/b.jpg', r2.crlf);
  check('แบบย่อ prefix/suffix ใน CSV ถูกคลี่ต่อ',
    r2.short['SKU-9'] === 'https://cdn/nine.jpg', r2.short);
  check('ค่าขึ้นต้นด้วย * ใน CSV ใช้ URL เต็มตามเดิม',
    r2.short['SKU-8'] === 'https://other/x.png', r2.short);

  /* ---------- 3. CSV แบบ B — sku,image_url ---------- */
  console.log('\n[3] CSV แบบ B (sku,image_url)');
  const r3 = await page.evaluate(() => {
    const out = {};
    out.basic = parseImageMap('sku,image_url\nA001,https://cdn/a.jpg\nA002,https://cdn/b.jpg');
    out.quoted = parseImageMap('sku,image_url\n"A001","https://cdn/a.jpg"');
    out.crlf = parseImageMap('sku,image_url\r\nA001,https://cdn/a.jpg\r\n\r\n');
    /* URL ที่มี , อยู่ข้างใน — ตัดที่ comma ตัวแรกเท่านั้น */
    out.commaUrl = parseImageMap('sku,image_url\nA001,https://cdn/a.jpg?w=1,h=2');
    out.blankSkipped = parseImageMap('sku,image_url\nA001,https://cdn/a.jpg\nA002,\n,https://cdn/c.jpg');
    return out;
  });
  check('อ่าน sku,image_url ได้',
    JSON.stringify(r3.basic) === JSON.stringify({ A001: 'https://cdn/a.jpg', A002: 'https://cdn/b.jpg' }), r3.basic);
  check('ค่าที่ครอบด้วยเครื่องหมายคำพูดถูกถอดออก', r3.quoted.A001 === 'https://cdn/a.jpg', r3.quoted);
  check('CRLF + บรรทัดว่างท้ายไฟล์', JSON.stringify(r3.crlf) === JSON.stringify({ A001: 'https://cdn/a.jpg' }), r3.crlf);
  check('URL ที่มี , ข้างในไม่ถูกตัด', r3.commaUrl.A001 === 'https://cdn/a.jpg?w=1,h=2', r3.commaUrl);
  check('แถวที่ขาดรหัสหรือขาด URL ถูกข้าม',
    JSON.stringify(r3.blankSkipped) === JSON.stringify({ A001: 'https://cdn/a.jpg' }), r3.blankSkipped);

  /* ---------- 4. JSON เดิมต้องไม่พัง ---------- */
  console.log('\n[4] ไฟล์ JSON เดิม (regression)');
  const r4 = await page.evaluate(() => {
    const out = {};
    out.full = parseImageMap(JSON.stringify({ A001: 'https://cdn/a.jpg' }));
    out.min = parseImageMap(JSON.stringify({ prefix: 'https://cdn/', suffix: '.jpg',
                                             images: { A001: 'a', A002: '*https://other/b.png' } }));
    return out;
  });
  check('JSON เต็มยังอ่านได้', r4.full.A001 === 'https://cdn/a.jpg', r4.full);
  check('JSON ย่อ prefix/suffix ยังอ่านได้', r4.min.A001 === 'https://cdn/a.jpg', r4.min);
  check('JSON ย่อ * ยังใช้ URL เต็ม', r4.min.A002 === 'https://other/b.png', r4.min);

  /* ---------- 5. ไฟล์เสีย ---------- */
  console.log('\n[5] ไฟล์ที่อ่านไม่ออก');
  const r5 = await page.evaluate(() => {
    const out = {};
    const grab = function (text) {
      try { parseImageMap(text); return 'NO_THROW'; } catch (e) { return e.message; }
    };
    out.garbage = grab('อะไรก็ไม่รู้ ไม่ใช่ทั้ง JSON และ CSV');
    out.oneLine = grab('images');
    out.badInner = grab('images\n"{ไม่ใช่ json}"');
    out.emptyJson = grab('{}');
    out.headerOnly = grab('sku,image_url\n');
    out.nullJson = grab('null');
    /* parseImageCsv เองต้องคืน null ไม่ throw */
    out.csvReturnsNull = parseImageCsv('images\n"{พัง}"');
    out.csvNoNewline = parseImageCsv('images');
    return out;
  });
  check('ข้อความมั่ว → BAD_JSON', r5.garbage === 'BAD_JSON', r5.garbage);
  check('มีบรรทัดเดียว → BAD_JSON', r5.oneLine === 'BAD_JSON', r5.oneLine);
  check('ก้อน JSON ข้างในพัง → BAD_JSON', r5.badInner === 'BAD_JSON', r5.badInner);
  check('JSON ว่าง {} → NO_ROWS (เหมือนเดิม)', r5.emptyJson === 'NO_ROWS', r5.emptyJson);
  check('CSV มีแต่หัวตาราง → BAD_JSON', r5.headerOnly === 'BAD_JSON', r5.headerOnly);
  check('ไฟล์ที่มีคำว่า null → BAD_JSON ไม่ใช่ crash', r5.nullJson === 'BAD_JSON', r5.nullJson);
  check('parseImageCsv คืน null ไม่ throw', r5.csvReturnsNull === null, r5.csvReturnsNull);
  check('parseImageCsv ไม่มีขึ้นบรรทัดใหม่ → null', r5.csvNoNewline === null, r5.csvNoNewline);

  /* ---------- 6. วงจรจริง: อัปโหลดไฟล์ .csv แล้วเขียนลงฐาน ---------- */
  console.log('\n[6] วงจรจริง: กดปุ่มแล้วอัปโหลด .csv');
  const r6 = await page.evaluate(async () => {
    window.__patches = [];
    window.db.update = function (path, patch) { window.__patches.push({ path: path, patch: patch }); return Promise.resolve(); };
    window.refreshProducts = function () { return Promise.resolve(); };
    window.ask = function () { return Promise.resolve(true); };
    window.toast = function (m, bad) { window.__toast = { m: m, bad: bad }; };
    state.products = {
      A001: { code: 'A001', name: 'ก', category: 'หมวด' },
      A002: { code: 'A002', name: 'ข', category: 'หมวด' },
      A003: { code: 'A003', name: 'ค', category: 'หมวด' }
    };
    const inner = JSON.stringify({ A001: 'https://cdn/a.jpg', A002: 'https://cdn/b.jpg' });
    const csv = 'images\n"' + inner.replace(/"/g, '""') + '"\n';
    /* handleImageImport ไม่ได้คืน promise ออกมา (ต่างจาก handleNoteImport/handleTypeImport)
       จึงต้องรอจนปุ่มถูกปลดล็อกเอง แทนการ await */
    handleImageImport(new File([csv], 'supabase-images.csv', { type: 'text/csv' }));
    const btn = document.getElementById('btnImportImages');
    for (let i = 0; i < 100 && btn.disabled; i++) await new Promise(r => setTimeout(r, 50));
    const merged = {};
    window.__patches.forEach(p => Object.assign(merged, p.patch));
    return { patches: merged, toast: window.__toast, btn: document.getElementById('btnImportImages').disabled };
  });
  check('เขียน imageUrl ให้ A001', r6.patches['A001/imageUrl'] === 'https://cdn/a.jpg', r6.patches);
  check('เขียน imageUrl ให้ A002', r6.patches['A002/imageUrl'] === 'https://cdn/b.jpg', r6.patches);
  check('A003 ที่ไม่มีในไฟล์ ไม่ถูกเขียน', r6.patches['A003/imageUrl'] === undefined, r6.patches);
  check('ไม่มี toast แจ้ง error', !r6.toast || !r6.toast.bad, r6.toast);
  check('ปุ่มถูกปลดล็อกหลังทำงานเสร็จ', r6.btn === false, r6.btn);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
