/* ============================================================
   v2.34.0 — สรุปกลุ่ม: มูลค่าขาด / มูลค่าเกิน / ผลต่างสุทธิ
   ============================================================

   ที่มา: คอลัมน์มูลค่าเดิม "มูลค่าระบบ / มูลค่าจริง / ผลต่าง" เป็นมูลค่ารวมทั้งคลัง (หลักแสน)
   ดูไม่ออกว่าของหายไปกี่บาท และผลต่างสุทธิอย่างเดียว ขาด 100 เกิน 100 ก็ได้ 0
   เท่ากับไม่ขาดไม่เกินเลย

   กติกา:
   - มูลค่าขาด  = Σ max(0, sys − act) × price   แสดงติดลบ
   - มูลค่าเกิน = Σ max(0, act − sys) × price   แสดงบวก
   - ผลต่างสุทธิ = เกิน − ขาด  (ต้องเท่ากับ actValue − sysValue เดิมเสมอ)
   - ใช้กับสรุปกลุ่มทุก surface: ตารางบนจอ · PDF · Excel สรุป · Excel เอกสาร · Excel รวมหลาย Job
   - ชีตรายสินค้า (รายตัว) ไม่เกี่ยว — ยังมี มูลค่าระบบ/จริง/ผลต่างมูลค่า ตามเดิม
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

    /* A1 ขาด 10 × 10 = 100 · A2 เกิน 5 × 20 = 100 · A3 ตรง · A4 ราคา 0 ขาด 3 (ไม่เป็นเงิน)
       N1 Not Product ขาด 2 × 50 = 100 */
    window.__seed = function () {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.page = 'scan';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1,
                                 storeType: 'STOCK' } };
      state.cycles = { C1: { status: 'counting', info: {} } };
      state.priceField = 'costPrice';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 },
        A2: { code: 'A2', name: 'สินค้า B', category: 'ห', type: 'product', costPrice: 20 },
        A3: { code: 'A3', name: 'สินค้า C', category: 'ห', type: 'product', costPrice: 30 },
        A4: { code: 'A4', name: 'ของใช้ร้าน', category: 'ห', type: 'product', costPrice: 0 },
        N1: { code: 'N1', name: 'ไม่ใช่สินค้า', category: 'ห', type: 'notProduct', costPrice: 50 }
      };
      state.systemQty = { A1: 100, A2: 50, A3: 5, A4: 3, N1: 2 };
      state.locations = { offline: {}, online: {} };
      state.locationSet = 'offline';
      state.counts = { A1: 90, A2: 55, A3: 5 };
      state.scanQty = { A1: 90, A2: 55, A3: 5 }; state.manualQty = {};
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {}; state.transferQty = {};
      state.zoneTotals = {}; state.foundZones = {}; state.reasons = {};
      state.appliedScanIds = Object.create(null);
      state.cycleData = null;
      state.lastZoneName = ''; state.locationFilter = '';
      state.scanType = 'stock'; state.customShopZones = [];
      buildScanIndex();
    };

    window.__summarySheet = function () {
      const real = window.buildXlsx;
      let captured = null;
      window.buildXlsx = function (sheets) { captured = sheets; return real(sheets); };
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      try { buildSummaryExcel(summaryData()); }
      finally { HTMLAnchorElement.prototype.click = realClick; window.buildXlsx = real; }
      return captured.filter(function (s) { return s.name === 'สรุป'; })[0];
    };
  });

  /* ---------- 1. คำนวณใน group ---------- */
  console.log('\n[1] summaryData — shortValue / overValue ต่อกลุ่ม');
  const r1 = await page.evaluate(() => {
    window.__seed();
    const g = summaryData().groups;
    function pick(x) { return { s: x.shortValue, o: x.overValue, sys: x.sysValue, act: x.actValue }; }
    return { p: pick(g.product), n: pick(g.notProduct), t: pick(g.total), blank: blankGroup() };
  });
  check('blankGroup มี shortValue/overValue = 0',
        r1.blank.shortValue === 0 && r1.blank.overValue === 0, r1.blank);
  check('Product: ขาด 100 · เกิน 100 (ของราคา 0 ไม่เป็นเงิน)', r1.p.s === 100 && r1.p.o === 100, r1.p);
  check('Not Product: ขาด 100 · เกิน 0', r1.n.s === 100 && r1.n.o === 0, r1.n);
  check('รวม: ขาด 200 · เกิน 100', r1.t.s === 200 && r1.t.o === 100, r1.t);
  check('สุทธิ (เกิน − ขาด) = actValue − sysValue เดิม ทุกกลุ่ม',
        [r1.p, r1.n, r1.t].every(function (x) { return Math.abs((x.o - x.s) - (x.act - x.sys)) < 1e-9; }),
        [r1.p, r1.n, r1.t]);

  /* ---------- 2. ตารางบนจอ ---------- */
  console.log('\n[2] ตารางสรุปบนจอ (#sumTable)');
  const r2 = await page.evaluate(() => {
    window.__seed();
    try { renderSummary(); } catch (e) { return { err: e.message }; }
    const head = Array.from(document.querySelectorAll('#sumTable thead th')).map(function (th) { return th.textContent.trim(); });
    const tr = document.querySelector('#sumBody tr[data-group="total"]');
    const tds = tr ? Array.from(tr.children).slice(-3) : [];
    return { head: head.slice(-3), vals: tds.map(function (td) { return td.textContent; }),
             cls: tds.map(function (td) { return td.className; }) };
  });
  check('หัว 3 ช่องท้าย = มูลค่าขาด · มูลค่าเกิน · ผลต่างสุทธิ',
        JSON.stringify(r2.head) === JSON.stringify(['มูลค่าขาด', 'มูลค่าเกิน', 'ผลต่างสุทธิ']), r2);
  check('ค่าแถวรวม = -200.00 · +100.00 · -100.00',
        JSON.stringify(r2.vals) === JSON.stringify(['-200.00', '+100.00', '-100.00']), r2);
  check('ขาดสีแดง (neg) · เกินสีเขียว (pos) · สุทธิติดลบเป็นแดง',
        /\bneg\b/.test(r2.cls[0]) && /\bpos\b/.test(r2.cls[1]) && /\bneg\b/.test(r2.cls[2]), r2.cls);

  /* ---------- 3. PDF / เอกสาร ---------- */
  console.log('\n[3] ตาราง Dashboard ในเอกสาร (#docDashBody)');
  const r3 = await page.evaluate(() => {
    window.__seed();
    renderDocDashboard(summaryData());
    const sub = Array.from(document.querySelectorAll('#docDashBody')[0].closest('table')
      .querySelectorAll('thead tr:nth-child(2) th')).map(function (th) { return th.textContent.trim(); });
    const tr = document.querySelector('#docDashBody tr[data-group="total"]');
    const tds = Array.from(tr.children).slice(-3);
    return { sub: sub.slice(-3), vals: tds.map(function (td) { return td.textContent; }) };
  });
  check('หัวย่อยกลุ่มมูลค่า = ขาด · เกิน · สุทธิ',
        JSON.stringify(r3.sub) === JSON.stringify(['ขาด', 'เกิน', 'สุทธิ']), r3.sub);
  check('ค่าแถวรวม = -200.00 · +100.00 · -100.00',
        JSON.stringify(r3.vals) === JSON.stringify(['-200.00', '+100.00', '-100.00']), r3.vals);

  /* ---------- 4. Excel ชีต "สรุป" ---------- */
  console.log('\n[4] Excel รายงานสรุป ชีต "สรุป"');
  const r4 = await page.evaluate(() => {
    window.__seed();
    const s = window.__summarySheet();
    return { head: s.rows[0].slice(9), p: s.rows[1].slice(9), n: s.rows[2].slice(9), t: s.rows[3].slice(9) };
  });
  check('หัว = มูลค่าขาด · มูลค่าเกิน · ผลต่างสุทธิ',
        JSON.stringify(r4.head) === JSON.stringify(['มูลค่าขาด', 'มูลค่าเกิน', 'ผลต่างสุทธิ']), r4.head);
  check('Product = -100 · 100 · 0', JSON.stringify(r4.p) === JSON.stringify([-100, 100, 0]), r4.p);
  check('Not Product = -100 · 0 · -100', JSON.stringify(r4.n) === JSON.stringify([-100, 0, -100]), r4.n);
  check('รวม = -200 · 100 · -100', JSON.stringify(r4.t) === JSON.stringify([-200, 100, -100]), r4.t);
  check('ขาด 0 บาทไม่เป็น -0', !Object.is(r4.n[1], -0) && !Object.is(r4.p[2], -0), r4);

  /* ---------- 5. moneyTriple ---------- */
  console.log('\n[5] moneyTriple — ปัดสองตำแหน่ง · ไม่มี -0');
  const r5 = await page.evaluate(() => ({
    a: moneyTriple({ shortValue: 0, overValue: 0 }),
    b: moneyTriple({ shortValue: 0.105, overValue: 1.004 })
  }));
  check('ศูนย์ทั้งหมด = [0, 0, 0] และไม่มี -0',
        r5.a.every(function (x) { return x === 0 && !Object.is(x, -0); }), r5.a);
  check('ปัดสองตำแหน่ง', r5.b[1] === 1 && (r5.b[0] === -0.1 || r5.b[0] === -0.11), r5.b);

  /* ---------- 6. ไม่มีจุดสรุปกลุ่มไหนหลงใช้ sysValue/actValue แสดงผล ---------- */
  console.log('\n[6] grep — สรุปกลุ่มทุก surface เลิกแสดง g.sysValue / g.actValue');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  check('ไม่มี fmtMoney(g.sysValue) / fmtMoney(g.actValue)', !/fmtMoney\(g\.(sys|act)Value\)/.test(src));
  check('ไม่มี Math.round(g.sysValue / g.actValue', !/Math\.round\(g\.(sys|act)Value/.test(src));
  check('ไม่มีหัว "ผลต่าง (บาท)" เหลือ', src.indexOf('ผลต่าง (บาท)') === -1);

  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors);

  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
