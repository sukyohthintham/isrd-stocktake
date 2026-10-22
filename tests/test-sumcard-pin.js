/* ============================================================
   v2.35.0 — กดเพิ่ม/ลบในป๊อปอัปการ์ดสรุป: แถว "ค้างก่อนแล้วหายเอง" ไม่เด้งหายวับ
   ============================================================

   ที่มา: addFromSummary / removeFromJob เคยปิดป๊อปอัปแล้วเปิดใหม่ทั้งลิสต์
   SKU ที่เพิ่งแก้จนหลุดกลุ่ม (ขาด → ตรง) หายไปทันที คนงงว่าเพิ่งแตะตัวไหน

   กติกาใหม่:
   - ไม่ปิดป๊อปอัป · อัปเดตเฉพาะแถวนั้นในที่ (ระบบ/ยิงจริง/ผลต่าง) + พื้นเขียว + ป้าย "✓ แก้แล้ว"
   - ยังอยู่ในกลุ่ม = ค้างต่อ ตัวเลขอัปเดต กดซ้ำได้
   - หลุดกลุ่ม = ค้างให้เห็น SUMCARD_PIN_MS แล้วจางออก (srow-fade) แล้วค่อยถอดทิ้ง
   - การ์ดด้านหลัง + ยอดรวมหัวป๊อปอัป ตามความจริง
   - เอาออกหลายชิ้น (ผ่านกล่องยืนยัน) → เปิดลิสต์กลับพร้อมแถวนั้น pin ไว้บนสุด
   - ⚠️ แหล่งความจริงไม่เปลี่ยน: ยังเขียน scan 1 แถวต่อการกด · ตัวเลขมาจาก summaryData()
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  await wait(1200);

  await page.evaluate(() => {
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.__writes = [];
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    window.renderDoc = function () {};
    hideLogin();
    /* ย่อเวลาค้างให้เทสไม่ต้องรอ 4 วิ — กติกาเดียวกัน แค่สั้นลง */
    window.SUMCARD_PIN_MS = 150;
    window.SUMCARD_FADE_MS = 60;

    /* P1 ขาด 2 (ระบบ 5 ยิง 3) · P2 ขาด 1 · P3 ตรง 4 · OV เกิน 3 (ระบบ 1 ยิง 4) */
    window.__seed = function () {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.page = 'summary';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1,
                                 storeType: 'STOCK' } };
      state.cycles = { C1: { status: 'counting', info: {} } };
      state.priceField = 'costPrice';
      function p(code, price) {
        return { code: code, name: 'สินค้า ' + code, category: 'ห', type: 'product', costPrice: price };
      }
      state.products = { P1: p('P1', 10), P2: p('P2', 20), P3: p('P3', 30), OV: p('OV', 5) };
      state.systemQty = { P1: 5, P2: 1, P3: 4, OV: 1 };
      state.counts = { P1: 3, P3: 4, OV: 4 };
      state.scanQty = Object.assign({}, state.counts); state.manualQty = {};
      state.locations = { offline: {}, online: {} };
      state.locationSet = 'offline';
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {}; state.transferQty = {};
      state.zoneTotals = {}; state.foundZones = {}; state.reasons = {};
      state.appliedScanIds = Object.create(null);
      state.cycleData = null;
      state.lastZoneName = ''; state.locationFilter = '';
      state.scanType = 'stock'; state.customShopZones = [];
      buildScanIndex();
      renderSummary();
      window.__writes = []; window.__toasts = [];
    };
    window.__row = function (sku) {
      const el = document.querySelector('[data-sumcard-rows] [data-sku="' + sku + '"]');
      if (!el) return null;
      const c = function (n) { return el.querySelector('[data-cell="' + n + '"]').textContent; };
      return { sys: c('sys'), act: c('act'), diff: c('diff'), done: !!el.querySelector('[data-done]'),
               green: el.classList.contains('srow-done'), fading: el.classList.contains('srow-fade') };
    };
    window.__state = function () {
      return { open: $('modalBg').classList.contains('show'), msg: $('modalMsg').textContent,
               skus: Array.prototype.map.call(document.querySelectorAll('[data-sumcard-rows] .srow'),
                 function (r) { return r.getAttribute('data-sku'); }),
               empty: !!document.querySelector('[data-sumcard-empty]'),
               cardShort: $('cardShortNum').textContent, cardMatch: $('cardMatchNum').textContent };
    };
  });

  /* ---------- 1. เพิ่ม 1 ชิ้น ยังขาดอยู่ → ค้าง ตัวเลขอัปเดต ---------- */
  console.log('\n[1] เพิ่ม 1 ชิ้น (ยังขาด) — ป๊อปอัปไม่ปิด แถวอัปเดตในที่');
  const r1 = await page.evaluate(() => {
    window.__seed();
    $('cardShort').click();
    const host = document.querySelector('[data-sumcard-rows]');
    const before = window.__state();
    document.querySelector('[data-sku="P1"] [data-addone]').click();
    const after = window.__state();
    return { before: before, after: after, row: window.__row('P1'),
             sameHost: document.querySelector('[data-sumcard-rows]') === host,
             writes: window.__writes.length, toast: (window.__toasts[0] || {}).m };
  });
  check('ป๊อปอัปยังเปิดอยู่ ลิสต์เดิม (ไม่ได้ปิด-เปิดใหม่)', r1.after.open && r1.sameHost, r1);
  check('แถว P1 อัปเดตในที่: ระบบ 5 · ยิง 4 · ผลต่าง -1',
        r1.row && r1.row.sys === '5' && r1.row.act === '4' && r1.row.diff === '-1', r1.row);
  check('ไฮไลต์เขียว + ป้าย ✓ แก้แล้ว', r1.row.green && r1.row.done, r1.row);
  check('ลำดับแถวไม่กระโดด', JSON.stringify(r1.after.skus) === JSON.stringify(r1.before.skus), r1);
  check('เขียน scan 1 แถว (แหล่งความจริงเดิม) + toast เพิ่มแล้ว',
        r1.writes === 1 && /^เพิ่ม P1 1 ชิ้น/.test(r1.toast || ''), r1);
  check('ยอดรวมหัวป๊อปอัปตามจริง (-฿40 → -฿30)',
        /มูลค่าผลต่างรวม -฿40\.00/.test(r1.before.msg) && /มูลค่าผลต่างรวม -฿30\.00/.test(r1.after.msg), r1);

  await wait(400);
  const r1b = await page.evaluate(() => ({ row: window.__row('P1'), st: window.__state() }));
  check('ยังขาดอยู่ → ค้างต่อแม้เลยเวลา pin (ไม่จาง)', r1b.row && !r1b.row.fading && r1b.row.done, r1b);

  /* ---------- 2. กดซ้ำจนตรง → ค้างก่อน แล้วจางหาย ---------- */
  console.log('\n[2] กดซ้ำจนตรง — ค้างให้เห็นก่อน แล้วจางหายเอง');
  const r2 = await page.evaluate(() => {
    document.querySelector('[data-sku="P1"] [data-addone]').click();
    return { row: window.__row('P1'), st: window.__state(), writes: window.__writes.length };
  });
  check('กดซ้ำได้ (ปุ่มในแถวที่อัปเดตยังใช้งานได้) · เขียนรวม 2 แถว', r2.writes === 2, r2.writes);
  check('ผลต่าง 0 แล้ว แต่แถวยังอยู่ทันทีหลังกด (ไม่หายวับ)',
        r2.row && r2.row.diff === '0' && r2.row.act === '5' && r2.row.done && !r2.row.fading, r2.row);
  check('การ์ดด้านหลังอัปเดตตามจริง (ขาด 2 → 1 · ตรง 1 → 2)',
        r2.st.cardShort === '1' && r2.st.cardMatch === '2', r2.st);
  check('ยอดรวมหัวป๊อปอัปไม่นับแถวที่หลุดกลุ่มแล้ว (1 รายการ)', /^1 รายการ/.test(r2.st.msg), r2.st.msg);

  await wait(180);   // เลย PIN แต่ยังไม่ครบ FADE
  const r2b = await page.evaluate(() => window.__row('P1'));
  check('เลยเวลา pin → เริ่มจาง (srow-fade)', r2b && r2b.fading === true, r2b);
  await wait(200);
  const r2c = await page.evaluate(() => window.__state());
  check('จางเสร็จ → ถอดแถว P1 ออก เหลือ P2', JSON.stringify(r2c.skus) === '["P2"]' && r2c.open, r2c);

  /* ---------- 3. ช่องค้นหาหลังแก้ ต้องเห็นตัวเลขล่าสุด ---------- */
  console.log('\n[3] พิมพ์ค้นหาหลังแก้ — ตัวเลขล่าสุด + ป้าย ✓ ยังอยู่');
  const r3 = await page.evaluate(() => {
    window.__seed();
    $('cardShort').click();
    document.querySelector('[data-sku="P1"] [data-addone]').click();   // ยิง 4 ยังขาด
    const s = document.querySelector('[data-sumcard-search]');
    s.value = 'P1'; s.oninput.call(s);
    const one = window.__row('P1');
    s.value = ''; s.oninput.call(s);
    return { one: one, skus: window.__state().skus };
  });
  check('ค้น P1 เจอแถวที่ยิง 4 พร้อม ✓', r3.one && r3.one.act === '4' && r3.one.done, r3.one);
  check('ล้างคำค้น → ลิสต์กลับครบ', JSON.stringify(r3.skus) === '["P1","P2"]', r3.skus);

  /* ---------- 4. เอาออก 1 ชิ้นจากกลุ่มเกินจนตรง ---------- */
  console.log('\n[4] ➖ เอาออก 1 ชิ้น (กลุ่มเกิน)');
  const r4 = await page.evaluate(() => {
    window.__seed();
    state.counts.OV = 2; state.scanQty.OV = 2;      // เกิน 1
    renderSummary();
    $('cardOver').click();
    document.querySelector('[data-sku="OV"] [data-removejob]').click();
    const rec = window.__writes[0] && window.__writes[0].patch[Object.keys(window.__writes[0].patch)[0]];
    return { row: window.__row('OV'), st: window.__state(), delta: rec && rec.delta,
             toast: (window.__toasts[0] || {}).m };
  });
  check('ป๊อปอัปไม่ปิด · OV ค้าง ✓ ผลต่าง 0', r4.st.open && r4.row && r4.row.diff === '0' && r4.row.done, r4);
  check('เขียนแถวลบ delta -1 (ไม่ได้ลบยอดเดิม) + toast เดิม',
        r4.delta === -1 && /ไม่ได้ลบยอดเดิม/.test(r4.toast || ''), r4);
  await wait(400);
  const r4b = await page.evaluate(() => window.__state());
  check('จางหายเอง → ลิสต์เกินว่าง ขึ้นข้อความกลุ่มว่าง', r4b.skus.length === 0 && r4b.empty, r4b);

  /* ---------- 5. เอาออกหลายชิ้น (กล่องยืนยัน) → เปิดกลับ + pin บนสุด ---------- */
  console.log('\n[5] เอาออกทั้งหมด (ผ่านกล่องยืนยัน) — เปิดลิสต์กลับ pin แถวไว้');
  const r5 = await page.evaluate(async () => {
    window.__seed();
    $('cardOver').click();
    document.querySelector('[data-sku="OV"] [data-removejoball]').click();   // OV ยิง 4
    $('modalOk').click();                                                     // ยืนยัน
    await new Promise(r => setTimeout(r, 30));
    return { st: window.__state(), row: window.__row('OV'), writes: window.__writes.length,
             title: $('modalTitle').textContent };
  });
  check('ยืนยันแล้วกลับเข้าลิสต์ "เกิน · Product"',
        r5.st.open && r5.title === '➕ สินค้าที่เกิน · Product', r5);
  check('OV (ตอนนี้ขาด 1) ถูก pin ไว้บนสุดพร้อม ✓',
        r5.st.skus[0] === 'OV' && r5.row.diff === '-1' && r5.row.done, r5);
  check('เขียน 1 แถว', r5.writes === 1, r5.writes);
  await wait(400);
  const r5b = await page.evaluate(() => window.__state());
  check('หลุดกลุ่มเกินแล้ว → จางหายเอง', r5b.skus.indexOf('OV') < 0, r5b.skus);

  /* ---------- 6. ปิดป๊อปอัประหว่างรอจาง ต้องไม่พัง ---------- */
  console.log('\n[6] ปิดป๊อปอัประหว่างแถวกำลังค้าง');
  await page.evaluate(() => {
    window.__seed();
    $('cardShort').click();
    document.querySelector('[data-sku="P2"] [data-addone]').click();   // P2 ตรงทันที → ตั้งเวลาจาง
    $('modalOk').click();                                               // ปิดก่อนครบเวลา
  });
  await wait(400);
  const r6 = await page.evaluate(() => ({ open: $('modalBg').classList.contains('show'),
                                          cardShort: $('cardShortNum').textContent }));
  check('ปิดแล้วไม่มีอะไรเด้งกลับมา · การ์ดอัปเดตแล้ว (ขาด 1)',
        r6.open === false && r6.cardShort === '1', r6);

  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors);

  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
