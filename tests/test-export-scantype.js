/* ============================================================
   v2.21.0 — คอลัมน์ "ประเภทที่นับ" ในชีท "รายสินค้า" ของไฟล์รายงานสรุป
   ============================================================

   ที่มา: ตั้งแต่ v2.16.0 ทุกแถวที่ยิงมี rec.stockType (โชว์/สต็อก/Asset) ติดไปด้วย
   แต่ไฟล์ Excel รายงานสรุปไม่เคยเอามาแสดง คนเปิดไฟล์จึงบอกไม่ได้ว่า SKU ตัวนี้
   นับเจอที่ชั้นโชว์กี่ชิ้น ชั้นสต็อกกี่ชิ้น ทั้งที่ข้อมูลมีอยู่ครบแล้ว

   กติกาเดียวกับคอลัมน์ "โซนที่เก็บ" เป๊ะ:
   - รวม delta สุทธิต่อประเภท (แถวหักลบหักถูกฝั่ง)
   - ฝั่งที่สุทธิเหลือ 0 ไม่โชว์
   - แถวเก่าที่ไม่มี stockType → "(ไม่ระบุ)" ไม่ใช่ทิ้งยอดหาย

   ⚠ export ล้วน ๆ — ห้ามแตะ writeScan / rec.stockType / Rules / ชีทอื่น
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
    window.db.newKey = (function () { let n = 0; return function () { return 'g' + (++n); }; })();
    window.renderDoc = function () {};
    hideLogin();

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
        A3: { code: 'A3', name: 'สินค้า C', category: 'ห', type: 'product', costPrice: 30 }
      };
      state.systemQty = { A1: 100, A2: 50, A3: 5 };
      state.locations = { offline: { A1: { pick: 'D1-2-2' } }, online: {} };
      state.locationSet = 'offline';
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {}; state.transferQty = {};
      state.zoneTotals = {}; state.foundZones = {}; state.reasons = {};
      state.appliedScanIds = Object.create(null);
      state.cycleData = null;
      state.lastZoneName = ''; state.locationFilter = '';
      state.scanType = 'stock'; state.customShopZones = [];
      buildScanIndex();
    };

    /* ดักชีทที่ถูกส่งเข้า buildXlsx แล้วยังปล่อยให้สร้างไฟล์จริงต่อ
       จะได้ตรวจได้ทั้ง "แถวที่ประกอบขึ้นมา" และ "ไฟล์ที่ออกไปจริง" ในการรันเดียว */
    window.__export = function () {
      const real = window.buildXlsx;
      let captured = null, blob = null;
      window.buildXlsx = function (sheets) {
        captured = sheets;
        blob = real(sheets);
        return blob;
      };
      /* ปิดการกดลิงก์ดาวน์โหลด ไม่งั้นเบราว์เซอร์จะพยายามโหลด blob แล้วพ่น error ลงคอนโซล */
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      buildSummaryExcel(summaryData());
      HTMLAnchorElement.prototype.click = realClick;
      window.buildXlsx = real;
      const s2 = captured.filter(function (s) { return s.name === 'รายสินค้า'; })[0];
      return { sheet: s2, blob: blob, names: captured.map(function (s) { return s.name; }) };
    };

    /* แถวของ SKU ไหนในชีท "รายสินค้า" */
    window.__row = function (sheet, code) {
      return sheet.rows.filter(function (r) { return r[0] === code; })[0] || null;
    };
  });

  /* ---------- 1. หัวตารางและความกว้าง ---------- */
  console.log('\n[1] หัวตาราง "ประเภทที่นับ" + ความกว้างคอลัมน์');
  const r1 = await page.evaluate(() => {
    window.__seed();
    const out = window.__export();
    return { head: out.sheet.rows[0], widths: out.sheet.widths, names: out.names };
  });
  check('คอลัมน์ที่ 5 (index 4) คือ "ประเภทที่นับ"', r1.head[4] === 'ประเภทที่นับ', r1.head);
  check('อยู่ต่อจาก "โซนที่เก็บ" พอดี', r1.head[3] === 'โซนที่เก็บ', r1.head);
  check('คอลัมน์ที่ตามมายังเป็นของเดิม (Status · หน่วย · ประเภท)',
        r1.head[5] === 'Status' && r1.head[6] === 'หน่วย' && r1.head[7] === 'ประเภท', r1.head);
  check('หัวตารางมี 17 ช่อง', r1.head.length === 17, r1.head.length);
  check('จำนวนความกว้างเท่าจำนวนคอลัมน์ (17 ช่อง)',
        r1.widths.length === 17 && r1.widths.length === r1.head.length, r1.widths);
  check('ความกว้างช่องใหม่ = 16 และช่องอื่นไม่เลื่อน',
        r1.widths[3] === 22 && r1.widths[4] === 16 && r1.widths[5] === 18, r1.widths);
  check('ชีทอื่นในไฟล์ยังครบเหมือนเดิม',
        JSON.stringify(r1.names) ===
        JSON.stringify(['สรุป', 'รายสินค้า', 'ประวัติการนับ', 'ไม่มีในระบบ']), r1.names);

  /* ---------- 2. SKU เดียวนับทั้งชั้นโชว์และชั้นสต็อก ---------- */
  console.log('\n[2] SKU เดียวกันนับคนละประเภท ต้องแยกให้เห็นทั้งสองฝั่ง');
  const r2 = await page.evaluate(() => {
    window.__seed();
    /* A1: โชว์ 3 ชิ้น · สต็อก 2 ชิ้น */
    state.scanType = 'display';
    writeScan('A1', 1, 'scan', null); writeScan('A1', 1, 'scan', null); writeScan('A1', 1, 'scan', null);
    state.scanType = 'stock';
    writeScan('A1', 1, 'scan', null); writeScan('A1', 1, 'scan', null);
    /* A2: Asset อย่างเดียว */
    state.scanType = 'asset';
    writeScan('A2', 4, 'scan', null);
    const out = window.__export();
    return { a1: window.__row(out.sheet, 'A1'), a2: window.__row(out.sheet, 'A2'),
             counts: JSON.parse(JSON.stringify(state.counts)) };
  });
  check('A1 ได้ "โชว์ (3), สต็อก (2)" เรียงคงที่ โชว์→สต็อก',
        r2.a1[4] === 'โชว์ (3), สต็อก (2)', r2.a1 && r2.a1[4]);
  check('A2 ได้ "Asset (4)"', r2.a2[4] === 'Asset (4)', r2.a2 && r2.a2[4]);
  check('ยอดรวมในคอลัมน์เดิมไม่ขยับ (A1 จำนวนจริง = 5)',
        r2.a1[9] === 5 && r2.counts.A1 === 5, { row: r2.a1, counts: r2.counts });
  check('คอลัมน์โซนที่เก็บยังทำงานเหมือนเดิม (ไม่ได้พิมพ์โซน → โซนจาก Location)',
        r2.a1[3] === 'D (5)', r2.a1 && r2.a1[3]);

  /* ---------- 3. หักลบจนเหลือ 0 ---------- */
  console.log('\n[3] ประเภทที่ถูกหักคืนจนเหลือ 0 ต้องไม่โชว์');
  const r3 = await page.evaluate(() => {
    window.__seed();
    state.scanType = 'display';
    writeScan('A1', 2, 'scan', null);
    writeScan('A1', -2, 'scan', 'ยกเลิก');      // โชว์เหลือสุทธิ 0
    state.scanType = 'stock';
    writeScan('A1', 3, 'scan', null);
    /* A3 ถูกหักจนติดลบทั้งตัว — ต้องไม่โผล่ประเภทไหนเลย */
    state.scanType = 'asset';
    writeScan('A3', 1, 'scan', null);
    writeScan('A3', -2, 'scan', 'ยกเลิก');
    const out = window.__export();
    return { a1: window.__row(out.sheet, 'A1'), a3: window.__row(out.sheet, 'A3') };
  });
  check('โชว์สุทธิ 0 หายไป เหลือแต่ "สต็อก (3)"', r3.a1[4] === 'สต็อก (3)', r3.a1 && r3.a1[4]);
  check('ประเภทที่สุทธิติดลบก็ไม่โชว์ (ช่องว่าง)',
        r3.a3 === null || r3.a3[4] === '', r3.a3);

  /* ---------- 4. แถวเก่าที่ไม่มี stockType ---------- */
  console.log('\n[4] ข้อมูลเก่าก่อน v2.16.0 ที่ไม่มี stockType');
  const r4 = await page.evaluate(() => {
    window.__seed();
    /* ป้อนแถวดิบตรง ๆ แบบที่ฐานเก่าเก็บไว้ — ไม่มีฟิลด์ stockType เลย */
    applyScanRecord('old1', { code: 'A1', zone: 'D', zoneName: 'D', user: 'เก่า',
                              ts: 1, delta: 4, mode: 'scan' });
    const outOld = window.__export();
    const oldRow = window.__row(outOld.sheet, 'A1');

    /* ปนกับแถวใหม่ที่มี stockType — ต้องเห็นทั้งสองก้อน ไม่ใช่กลืนกัน */
    state.scanType = 'display';
    writeScan('A1', 2, 'scan', null);
    const outMix = window.__export();
    return { oldOnly: oldRow[4], mixed: window.__row(outMix.sheet, 'A1')[4] };
  });
  check('แถวเก่าล้วน → "(ไม่ระบุ) (4)" ไม่ใช่ช่องว่างหรือยอดหาย',
        r4.oldOnly === '(ไม่ระบุ) (4)', r4.oldOnly);
  check('ปนเก่า+ใหม่ → โชว์ก่อน แล้วปิดท้ายด้วย (ไม่ระบุ)',
        r4.mixed === 'โชว์ (2), (ไม่ระบุ) (4)', r4.mixed);

  /* ---------- 5. ไฟล์ที่ออกไปจริงต้องมีคอลัมน์นี้ ---------- */
  console.log('\n[5] อ่านไฟล์ .xlsx ที่ปล่อยออกไปกลับเข้ามา');
  const r5 = await page.evaluate(async () => {
    window.__seed();
    state.scanType = 'display';
    writeScan('A1', 3, 'scan', null);
    state.scanType = 'stock';
    writeScan('A1', 2, 'scan', null);
    const out = window.__export();
    const sheets = await parseXlsxSheets(await out.blob.arrayBuffer());
    const s2 = sheets.filter(function (s) { return s.name === 'รายสินค้า'; })[0];
    const head = s2.rows[0];
    const a1 = s2.rows.filter(function (r) { return r[0] === 'A1'; })[0];
    return { head: head, a1: a1, sheetNames: sheets.map(function (s) { return s.name; }) };
  });
  check('ไฟล์จริงมีหัว "ประเภทที่นับ" ที่ตำแหน่งเดียวกัน', r5.head[4] === 'ประเภทที่นับ', r5.head);
  check('ไฟล์จริงมีค่าในคอลัมน์นั้นครบ', r5.a1[4] === 'โชว์ (3), สต็อก (2)', r5.a1);
  check('ค่าคอลัมน์อื่นในไฟล์จริงไม่เลื่อนตำแหน่ง',
        r5.a1[0] === 'A1' && r5.a1[1] === 'สินค้า A' && r5.a1[5] === 'Normal', r5.a1);

  /* ---------- 6. export อื่นต้องไม่ถูกแตะ ---------- */
  console.log('\n[6] export ใบอื่นต้องไม่ขยับ');
  const r6 = await page.evaluate(() => {
    return { jobHead: EXPORT_JOB_HEAD.slice(0, 6), jobLen: EXPORT_JOB_HEAD.length };
  });
  check('EXPORT_JOB_HEAD (ไฟล์รายใบ) ยังเป็นของเดิม ไม่มี "ประเภทที่นับ" แทรก',
        r6.jobHead.indexOf('ประเภทที่นับ') < 0 &&
        r6.jobHead[3] === 'โซนที่เก็บ' && r6.jobHead[4] === 'Status', r6);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
