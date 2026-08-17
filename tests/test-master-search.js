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
    window.toast = function () {};
    window.db.update = function () { return Promise.resolve(); };
    hideLogin();
    state.me = { uid: 'u1', name: 'แอดมิน', role: 'admin', branches: [] };
    state.counter = 'แอดมิน';

    window.__seed = function (n) {
      var count = (n === undefined) ? 500 : n;    // 0 = ยังไม่ได้นำเข้า Master
      state.products = {};
      for (var i = 1; i <= count; i++) {
        var code = 'NTTW' + String(i).padStart(5, '0');
        state.products[code] = {
          code: code, name: 'เสื้อยืดรุ่นที่ ' + i, category: 'เสื้อผ้า',
          type: i % 50 === 0 ? 'notProduct' : 'product',
          needsReview: i % 100 === 0,
          costPrice: i % 3 === 0 ? undefined : 25,
          sellPrice: 199, status: 'Normal'
        };
      }
      state.systemQty = {}; state.counts = {};
      state.masterFilter = 'all'; state.masterTab = 'products';
      $('masterSearch').value = '';
      renderMaster();
    };

    window.__view = function () {
      const list = document.getElementById('masterList');
      return {
        cards: list.querySelectorAll('.mrow').length,
        prompt: !!list.querySelector('[data-masterprompt]'),
        promptText: (list.querySelector('[data-masterprompt]') || {}).textContent || '',
        empty: !!list.querySelector('[data-masterempty]'),
        emptyText: (list.querySelector('[data-masterempty]') || {}).textContent || '',
        count: document.getElementById('masterCount').textContent
      };
    };
    window.__search = function (t) {
      $('masterSearch').value = t;
      renderMaster();
      return window.__view();
    };
    window.__filter = function (f) {
      state.masterFilter = f;
      renderMaster();
      return window.__view();
    };
  });

  /* ---------- 1. ยังไม่ค้นหา ---------- */
  console.log('\n[1] เปิดหน้ามายังไม่พิมพ์อะไร');
  const r1 = await page.evaluate(() => { window.__seed(500); return window.__view(); });
  check('ไม่วาดการ์ดสินค้าสักใบ', r1.cards === 0, r1.cards);
  check('โชว์ข้อความชวนให้ค้นหา', r1.prompt === true, r1);
  check('ข้อความบอกจำนวนสินค้าจริง',
        /🔍 พิมพ์รหัสสินค้า หรือชื่อ เพื่อค้นหา · มีสินค้าทั้งหมด 500 รายการ/.test(r1.promptText),
        r1.promptText);
  check('บรรทัดนับบอกจำนวนทั้งหมด', r1.count === 'มีสินค้าทั้งหมด 500 รายการ', r1.count);

  /* ---------- 2. พิมพ์ค้นหา ---------- */
  console.log('\n[2] พิมพ์ค้นหา');
  const r2 = await page.evaluate(() => window.__search('NTTW00007'));
  check('โชว์ผลลัพธ์ที่ตรง', r2.cards === 1 && r2.prompt === false, r2);
  check('บรรทัดนับบอกว่าพบกี่รายการ', /พบ 1 จากทั้งหมด 500 รายการ/.test(r2.count), r2.count);

  const r2b = await page.evaluate(() => window.__search('เสื้อยืด'));
  check('ค้นชื่อไทยได้ (ติดเพดาน 200 แถวแรก)', r2b.cards === 200, r2b.cards);
  check('บอกว่าแสดงแค่บางส่วน', /แสดง 200 รายการแรก/.test(r2b.count), r2b.count);

  const r2c = await page.evaluate(() => window.__search('ไม่มีคำนี้แน่นอน'));
  check('ค้นไม่เจอ → ไม่ใช่ลิสต์ว่างเปล่า', r2c.empty === true && r2c.cards === 0, r2c);
  check('บอกวิธีแก้', /ลองพิมพ์รหัสหรือชื่อให้สั้นลง/.test(r2c.emptyText), r2c.emptyText);

  /* ---------- 3. ลบคำค้นออก → กลับไปเป็น prompt ---------- */
  console.log('\n[3] ลบคำค้นออก');
  const r3 = await page.evaluate(() => window.__search(''));
  check('กลับไปโชว์ข้อความชวนค้นหา', r3.prompt === true && r3.cards === 0, r3);

  /* ---------- 4. กดตัวกรอง = มีเงื่อนไข ---------- */
  console.log('\n[4] กดตัวกรองโดยไม่พิมพ์ค้นหา');
  const r4 = await page.evaluate(() => {
    const out = {};
    window.__seed(500);
    out.notProduct = window.__filter('notProduct');
    out.review = window.__filter('review');
    out.nocost = window.__filter('nocost');
    out.inactive = window.__filter('inactive');
    out.backToAll = window.__filter('all');
    return out;
  });
  check('ตัวกรอง Not Product โชว์ผลได้ทันที (10 ตัว)',
        r4.notProduct.cards === 10 && r4.notProduct.prompt === false, r4.notProduct);
  check('ตัวกรอง "รอตรวจสอบ" โชว์ผลได้ (5 ตัว)',
        r4.review.cards === 5 && r4.review.prompt === false, r4.review);
  check('ตัวกรอง "ยังไม่มีราคาต้นทุน" โชว์ผลได้',
        r4.nocost.cards > 0 && r4.nocost.prompt === false, r4.nocost.cards);
  check('ตัวกรอง "ปิดใช้งาน" ที่ไม่มีของ → ขึ้นว่าไม่พบ ไม่ใช่ชวนค้นหา',
        r4.inactive.empty === true && r4.inactive.prompt === false, r4.inactive);
  check('กดกลับ "ทั้งหมด" → กลับไปชวนค้นหา',
        r4.backToAll.prompt === true && r4.backToAll.cards === 0, r4.backToAll);

  /* ---------- 5. ตัวกรอง + คำค้นพร้อมกัน ---------- */
  console.log('\n[5] ใช้ตัวกรองพร้อมคำค้น');
  const r5 = await page.evaluate(() => {
    window.__seed(500);
    state.masterFilter = 'notProduct';
    return window.__search('NTTW00050');
  });
  check('กรองซ้อนคำค้นได้ตามเดิม', r5.cards === 1 && r5.prompt === false, r5);

  /* ---------- 6. ยังไม่มีสินค้าเลย ---------- */
  console.log('\n[6] ยังไม่ได้นำเข้า Master');
  const r6 = await page.evaluate(() => { window.__seed(0); return window.__view(); });
  check('ไม่ขึ้นข้อความชวนค้นหา (ไม่มีของให้ค้น)', r6.prompt === false, r6);
  check('บอกให้ไปนำเข้าไฟล์ก่อน', /ยังไม่มีข้อมูลสินค้า/.test(r6.count), r6.count);

  /* ---------- 7. ปุ่ม/ตัวกรองด้านบนยังอยู่ครบ ---------- */
  console.log('\n[7] ปุ่มและตัวกรองด้านบนต้องไม่หายไปด้วย');
  const r7 = await page.evaluate(() => {
    window.__seed(500);
    const vis = function (id) {
      const el = document.getElementById(id);
      return !!el && getComputedStyle(el).display !== 'none';
    };
    return {
      search: vis('masterSearch'),
      filters: document.querySelectorAll('[data-mfilter]').length,
      tpl: vis('btnTypeTemplate'), imp: vis('btnImportType'),
      note: vis('btnNoteTemplate'), master: vis('btnImportMaster'),
      img: vis('btnImportImages')
    };
  });
  check('ช่องค้นหายังอยู่', r7.search === true, r7);
  check('ปุ่มตัวกรองครบ 5 ปุ่ม', r7.filters === 5, r7.filters);
  check('ปุ่ม Template/Import ยังอยู่ครบ',
        r7.tpl && r7.imp && r7.note && r7.master && r7.img, r7);

  /* ---------- 8. Template ยึดตามตัวกรอง ไม่ขึ้นกับช่องค้นหา ---------- */
  console.log('\n[8] ดาวน์โหลด Template — ตามตัวกรอง ไม่ขึ้นกับช่องค้นหา');
  const r8 = await page.evaluate(() => {
    const grab = function (fn) {
      let captured = null;
      const realBuild = window.buildXlsx;
      window.buildXlsx = function (sheets) { captured = sheets; return new Blob(['x']); };
      const realCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = realCreate(tag);
        if (tag === 'a') { el.click = function () {}; }
        return el;
      };
      try { fn(); } finally { window.buildXlsx = realBuild; document.createElement = realCreate; }
      return captured[0].rows.length - 1;
    };
    const out = {};
    window.__seed(500);
    out.noSearch = grab(downloadTypeTemplate);
    out.promptOnScreen = window.__view().prompt;
    out.hintNoSearch = document.querySelector('[data-tplcount]').textContent;

    /* พิมพ์ค้นหาแล้วไฟล์ต้องยังได้ครบตามตัวกรอง ไม่ถูกคำค้นตัด */
    window.__search('NTTW00007');
    out.withSearch = grab(downloadTypeTemplate);
    out.hintWithSearch = document.querySelector('[data-tplcount]').textContent;
    out.noteWithSearch = grab(downloadNoteTemplate);

    /* กดตัวกรองแล้วไฟล์ต้องแคบลงตามตัวกรอง */
    window.__search('');
    window.__filter('notProduct');
    out.filtered = grab(downloadTypeTemplate);
    out.hintFiltered = document.querySelector('[data-tplcount]').textContent;
    out.hintCount = document.querySelectorAll('[data-tplcount]').length;
    return out;
  });
  check('จอยังชวนค้นหาอยู่ แต่ Template ได้ครบ 500 แถว',
        r8.promptOnScreen === true && r8.noSearch === 500, r8);
  check('พิมพ์ค้นหาแล้วไฟล์ยังได้ครบ 500 แถว (คำค้นไม่ตัดไฟล์)',
        r8.withSearch === 500 && r8.noteWithSearch === 500, r8);
  check('กดตัวกรองแล้วไฟล์แคบลงตามตัวกรอง (10 แถว)', r8.filtered === 10, r8.filtered);
  check('มีตัวเลขบอกจำนวนใต้ปุ่มทั้งสองปุ่ม', r8.hintCount === 2, r8.hintCount);
  check('ตัวเลขใต้ปุ่มตรงกับจำนวนที่จะได้จริง',
        r8.hintNoSearch === '500' && r8.hintWithSearch === '500' && r8.hintFiltered === '10', r8);

  const r8b = await page.evaluate(() => {
    window.__seed(500);
    return document.querySelector('#btnTypeTemplate').nextElementSibling.textContent
      .replace(/\s+/g, ' ').trim();
  });
  check('ข้อความบอกว่ายึดตามตัวกรอง ไม่ขึ้นกับช่องค้นหา',
        /ดาวน์โหลดตามตัวกรองที่เลือก \(ไม่ขึ้นกับช่องค้นหา\) — ตอนนี้ 500 รายการ/.test(r8b), r8b);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
