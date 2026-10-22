/* ============================================================
   v2.35.0 — การ์ดสรุป ตรง/ขาด/เกิน แยก 2 แถว Product / Not Product
   ============================================================

   ที่มา: #sumCards รวม Product + Not Product ไว้ใบเดียว
   เคสจริง: การ์ดขาดขึ้น 164 ทั้งที่สินค้าจริงขาด 38 (อีก 126 เป็น Asset/ของใช้ร้าน)
   กดเข้าไปดูก็เจอ Asset ท่วมลิสต์ หาสินค้าที่ขาดจริงไม่เจอ

   กติกา:
   - sumCardRows(data, kind, group) — group = r.type · ไม่ส่ง = ทุกกลุ่มเหมือนเดิม
   - แถว Product ใช้ id เดิม (cardMatch/Short/Over) · แถว Not Product ต่อท้าย "NP"
   - กดการ์ดแถวไหน ลิสต์ในป๊อปอัปต้องมีเฉพาะกลุ่มนั้น
   - การ์ดหน้ายิง (#scanCard*) ไม่ส่ง group → ยังเป็นยอดรวมทุกกลุ่มตามเดิม
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
    window.toast = function () {};
    window.enqueueWrite = function () {};
    window.db.update = function () { return Promise.resolve(); };
    window.renderDoc = function () {};
    hideLogin();

    /* Product:     P1 ขาด 2 (×10) · P2 เกิน 1 (×20) · P3 ตรง
       Not Product: A1 ขาด 5 (×100) · A2 ขาด 1 (×0 ของใช้ร้าน) · A3 ตรง · A4 เกิน 3 (×1) */
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
      function p(code, type, price) {
        return { code: code, name: 'สินค้า ' + code, category: 'ห', type: type, costPrice: price };
      }
      state.products = {
        P1: p('P1', 'product', 10), P2: p('P2', 'product', 20), P3: p('P3', 'product', 30),
        A1: p('A1', 'notProduct', 100), A2: p('A2', 'notProduct', 0),
        A3: p('A3', 'notProduct', 5), A4: p('A4', 'notProduct', 1)
      };
      state.systemQty = { P1: 5, P2: 1, P3: 4, A1: 5, A2: 1, A3: 2, A4: 0 };
      state.counts = { P1: 3, P2: 2, P3: 4, A3: 2, A4: 3 };
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
    };
    window.__popup = function () {
      const out = { shown: $('modalBg').classList.contains('show'), title: $('modalTitle').textContent,
                    msg: $('modalMsg').textContent,
                    skus: Array.prototype.map.call(document.querySelectorAll('[data-sumcard-rows] .srow'),
                      function (r) { return r.getAttribute('data-sku'); }) };
      $('modalOk').click();
      return out;
    };
  });

  /* ---------- 1. sumCardRows กรองตาม group ---------- */
  console.log('\n[1] sumCardRows(data, kind, group)');
  const r1 = await page.evaluate(() => {
    window.__seed();
    const d = summaryData();
    const keys = function (rows) { return rows.map(function (r) { return r.key; }); };
    return {
      allShort: keys(sumCardRows(d, 'short')),
      pShort: keys(sumCardRows(d, 'short', 'product')),
      npShort: keys(sumCardRows(d, 'short', 'notProduct')),
      pOver: keys(sumCardRows(d, 'over', 'product')),
      npOver: keys(sumCardRows(d, 'over', 'notProduct')),
      npMatch: keys(sumCardRows(d, 'match', 'notProduct'))
    };
  });
  check('ไม่ส่ง group = ทุกกลุ่มเหมือนเดิม (ขาด 3 ตัว เรียงหนักสุดก่อน)',
        JSON.stringify(r1.allShort) === JSON.stringify(['A1', 'P1', 'A2']), r1.allShort);
  check('group=product → เฉพาะ P1', JSON.stringify(r1.pShort) === JSON.stringify(['P1']), r1.pShort);
  check('group=notProduct → A1, A2 (ยังเรียงตาม spec เดิม)',
        JSON.stringify(r1.npShort) === JSON.stringify(['A1', 'A2']), r1.npShort);
  check('เกิน: Product P2 · Not Product A4',
        JSON.stringify(r1.pOver) === '["P2"]' && JSON.stringify(r1.npOver) === '["A4"]', r1);
  check('ตรง Not Product = A3', JSON.stringify(r1.npMatch) === '["A3"]', r1.npMatch);

  /* ---------- 2. การ์ด 2 แถวบนหน้าสรุป ---------- */
  console.log('\n[2] การ์ดหน้าสรุป 2 แถว');
  const r2 = await page.evaluate(() => {
    window.__seed();
    renderSummary();
    const t = function (id) { return $(id).textContent; };
    return {
      heads: Array.prototype.map.call(document.querySelectorAll('#sumCards .sum-grp-hd'),
                                      function (e) { return e.textContent; }),
      p: [t('cardMatchNum'), t('cardShortNum'), t('cardOverNum')],
      pPc: [t('cardShortPc'), t('cardOverPc')],
      pVal: [t('cardMatchVal').trim(), t('cardShortVal'), t('cardOverVal')],
      np: [t('cardMatchNPNum'), t('cardShortNPNum'), t('cardOverNPNum')],
      npPc: [t('cardShortNPPc'), t('cardOverNPPc')],
      npVal: [t('cardMatchNPVal').trim(), t('cardShortNPVal'), t('cardOverNPVal')],
      groups: Array.prototype.map.call(document.querySelectorAll('#sumCards [data-sumcard]'),
                                       function (b) { return b.getAttribute('data-group'); })
    };
  });
  check('หัวกลุ่ม 2 แถว', JSON.stringify(r2.heads) === JSON.stringify(['📦 Product', '🏷 Not Product']), r2.heads);
  check('แถว Product (id เดิม) = ตรง 1 · ขาด 1 · เกิน 1', JSON.stringify(r2.p) === '["1","1","1"]', r2.p);
  check('แถว Product ชิ้น/เงิน = ขาด 2 ชิ้น -฿20 · เกิน 1 ชิ้น +฿20',
        JSON.stringify(r2.pPc) === '["2 ชิ้น","1 ชิ้น"]' &&
        r2.pVal[0] === '' && r2.pVal[1] === '-฿20.00' && r2.pVal[2] === '+฿20.00', r2);
  check('แถว Not Product = ตรง 1 · ขาด 2 · เกิน 1', JSON.stringify(r2.np) === '["1","2","1"]', r2.np);
  check('แถว Not Product ชิ้น/เงิน = ขาด 6 ชิ้น -฿500 · เกิน 3 ชิ้น +฿3',
        JSON.stringify(r2.npPc) === '["6 ชิ้น","3 ชิ้น"]' &&
        r2.npVal[0] === '' && r2.npVal[1] === '-฿500.00' && r2.npVal[2] === '+฿3.00', r2);
  check('ทุกการ์ดมี data-group ครบ 6 ใบ',
        JSON.stringify(r2.groups) ===
        JSON.stringify(['product', 'product', 'product', 'notProduct', 'notProduct', 'notProduct']), r2.groups);

  /* ---------- 3. กดการ์ด → ลิสต์เฉพาะกลุ่ม ---------- */
  console.log('\n[3] กดการ์ดแล้วลิสต์มีเฉพาะกลุ่มนั้น');
  const r3 = await page.evaluate(() => {
    window.__seed();
    renderSummary();
    $('cardShort').click();   const p = window.__popup();
    $('cardShortNP').click(); const np = window.__popup();
    $('cardOverNP').click();  const npo = window.__popup();
    return { p: p, np: np, npo: npo };
  });
  check('การ์ดขาด Product → เห็นแค่ P1', r3.p.shown && JSON.stringify(r3.p.skus) === '["P1"]', r3.p);
  check('หัวป๊อปอัปบอกกลุ่ม', r3.p.title === '❌ สินค้าที่ขาด · Product', r3.p.title);
  check('ยอดรวมในป๊อปอัปคิดเฉพาะกลุ่ม (1 รายการ · -฿20)',
        /^1 รายการ · มูลค่าผลต่างรวม -฿20\.00/.test(r3.p.msg), r3.p.msg);
  check('การ์ดขาด Not Product → A1, A2 ไม่มี P1', JSON.stringify(r3.np.skus) === '["A1","A2"]', r3.np);
  check('หัวป๊อปอัป Not Product', r3.np.title === '❌ สินค้าที่ขาด · Not Product', r3.np.title);
  check('การ์ดเกิน Not Product → A4', JSON.stringify(r3.npo.skus) === '["A4"]', r3.npo);

  /* ---------- 4. การ์ดหน้ายิงยังเป็นยอดรวม ---------- */
  console.log('\n[4] การ์ดหน้ายิง — ไม่ส่ง group ยังรวมทุกกลุ่ม');
  const r4 = await page.evaluate(() => {
    window.__seed();
    state.page = 'scan';
    renderScanTotals();
    const num = $('scanCardShortNum').textContent;
    $('scanCardShort').click();
    return { num: num, pop: window.__popup() };
  });
  check('ตัวเลขการ์ดขาดหน้ายิง = 3 (รวมทุกกลุ่ม)', r4.num === '3', r4.num);
  check('ลิสต์จากหน้ายิงเห็นครบทุกกลุ่ม · หัวไม่มีชื่อกลุ่ม',
        JSON.stringify(r4.pop.skus) === '["A1","P1","A2"]' && r4.pop.title === '❌ สินค้าที่ขาด', r4.pop);

  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors);

  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
