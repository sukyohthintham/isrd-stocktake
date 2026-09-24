/* ============================================================
   v2.22.0 — คอลัมน์ "ประเภทที่นับ" ในไฟล์ Excel รวมหลาย Job (exportJobsExcel)
   ============================================================

   ต่อจาก v2.21.0 ที่เพิ่มคอลัมน์นี้ให้ไฟล์รายงานสรุป — ไฟล์รวมหลาย Job ยังไม่มี
   ทั้งที่เป็นไฟล์ที่ใช้เทียบข้ามใบ ซึ่งเป็นจุดที่ "ของ SKU เดียวอยู่ทั้งชั้นโชว์
   และชั้นสต็อก" โผล่บ่อยที่สุด

   จุดต่างจากไฟล์รายงานสรุป: ตัวเลขต้องรวมข้าม Job ในรอบเดียวกัน
   (โชว์ยิงที่ใบหนึ่ง สต็อกยิงอีกใบหนึ่ง ต้องออกมาเป็นแถวเดียว "โชว์ (3), สต็อก (2)")

   ⚠ export ล้วน ๆ — ห้ามแตะ writeScan / rec.stockType / Rules
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

    /* สองใบในรอบ C1 ใบเดียวกัน — J1 ยิงของโชว์ · J2 ยิงของสต็อก
       ป้อนแถว scan ดิบ ๆ แบบที่ฐานเก็บจริง แล้วให้ db.get คืนตามใบ
       จะได้ทดสอบทางเดิน loadJobsRaw → byCycle → rows จริงทั้งเส้น */
    window.__seed = function (scansByJob) {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.priceField = 'costPrice';
      state.roundId = 'R1';
      state.roundIndex = {
        R1: { id: 'R1', name: 'ใบโชว์', branchCode: 'B1', jobCode: 'J1', cycleId: 'C1',
              status: 'counting', createdAt: 1, storeType: 'SHOW' },
        R2: { id: 'R2', name: 'ใบสต็อก', branchCode: 'B1', jobCode: 'J2', cycleId: 'C1',
              status: 'counting', createdAt: 2, storeType: 'STOCK' }
      };
      state.cycles = { C1: { status: 'counting', info: {} } };
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 },
        A2: { code: 'A2', name: 'สินค้า B', category: 'ห', type: 'product', costPrice: 20 },
        A3: { code: 'A3', name: 'สินค้า C', category: 'ห', type: 'product', costPrice: 30 }
      };
      state.locations = { offline: {}, online: {} };
      state.locationSet = 'offline';
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.reasons = {}; state.unknownKeys = {}; state.unknown = {};
      state.scanLog = []; state.manualLog = []; state.cycleData = null;
      state.exportPick = [];
      buildScanIndex();

      /* ยอดระบบของรอบ + แถว scan ของแต่ละใบ */
      window.db.get = function (path) {
        if (path === 'cycles/C1/systemQty') return Promise.resolve({ A1: 100, A2: 50, A3: 5 });
        const m = /^rounds\/(R\d)\/scans$/.exec(path);
        if (m) return Promise.resolve(scansByJob[m[1]] || {});
        return Promise.resolve(null);
      };
      window.db.getQuiet = window.db.get;
      window.cycleMigrated = function () { return true; };
    };

    /* ดักชีทที่ส่งเข้า buildXlsx แล้วยังสร้างไฟล์จริงต่อ — ตรวจได้ทั้งแถวและไฟล์ */
    window.__exportJobs = function (ids) {
      const real = window.buildXlsx;
      let captured = null, blob = null;
      window.buildXlsx = function (sheets) {
        captured = sheets;
        blob = real(sheets);
        return blob;
      };
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      return exportJobsExcel(ids).then(function () {
        window.buildXlsx = real;
        HTMLAnchorElement.prototype.click = realClick;
        return { sheets: captured, blob: blob,
                 names: captured.map(function (s) { return s.name; }) };
      });
    };
    window.__jobSheet = function (out) {
      return out.sheets.filter(function (s) { return s.name !== 'สรุปรวม'; })[0];
    };
    window.__row = function (sheet, code) {
      return sheet.rows.filter(function (r) { return r[0] === code; })[0] || null;
    };
  });

  /* ---------- 1. หัวตารางและความกว้าง ---------- */
  console.log('\n[1] หัวตาราง EXPORT_JOB_HEAD + ความกว้างชีทราย Job');
  const r1 = await page.evaluate(async () => {
    window.__seed({ R1: {}, R2: {} });
    const out = await window.__exportJobs(['R1', 'R2']);
    const sheet = window.__jobSheet(out);
    return { head: EXPORT_JOB_HEAD.slice(), sheetHead: sheet.rows[0],
             widths: sheet.widths, names: out.names };
  });
  check('EXPORT_JOB_HEAD index 4 คือ "ประเภทที่นับ"', r1.head[4] === 'ประเภทที่นับ', r1.head);
  check('อยู่ต่อจาก "โซนที่เก็บ" และตามด้วย Status เหมือนไฟล์รายงานสรุป',
        r1.head[3] === 'โซนที่เก็บ' && r1.head[5] === 'Status' && r1.head[6] === 'ประเภท', r1.head);
  check('หัวตารางมี 14 ช่อง', r1.head.length === 14, r1.head.length);
  check('หัวในชีทจริงตรงกับ EXPORT_JOB_HEAD',
        JSON.stringify(r1.sheetHead) === JSON.stringify(r1.head), r1.sheetHead);
  check('ความกว้างมี 14 ช่องเท่าจำนวนคอลัมน์',
        r1.widths.length === 14 && r1.widths.length === r1.head.length, r1.widths);
  check('ความกว้างช่องใหม่ = 18 และช่องโซนเดิม (8) ไม่เลื่อน',
        r1.widths[3] === 8 && r1.widths[4] === 18 && r1.widths[5] === 18, r1.widths);
  check('ไฟล์ยังมีชีทสรุปรวมนำหน้าเหมือนเดิม', r1.names[0] === 'สรุปรวม', r1.names);

  /* ---------- 2. ⭐ รวมประเภทข้าม Job ในรอบเดียวกัน ---------- */
  console.log('\n[2] ⭐ SKU เดียวยิงคนละใบคนละประเภท ต้องรวมเป็นแถวเดียว');
  const r2 = await page.evaluate(async () => {
    window.__seed({
      /* ใบ J1 = ของโชว์ 3 ชิ้น */
      R1: {
        s1: { code: 'A1', zone: 'no-zone', zoneName: '(ไม่ระบุโซน)', user: 'ก',
              ts: 1, delta: 2, mode: 'scan', stockType: 'display' },
        s2: { code: 'A1', zone: 'no-zone', zoneName: '(ไม่ระบุโซน)', user: 'ก',
              ts: 2, delta: 1, mode: 'scan', stockType: 'display' },
        s3: { code: 'A2', zone: 'no-zone', zoneName: '(ไม่ระบุโซน)', user: 'ก',
              ts: 3, delta: 4, mode: 'scan', stockType: 'asset' },
        s7: { code: 'A3', zone: 'no-zone', zoneName: '(ไม่ระบุโซน)', user: 'ก',
              ts: 7, delta: 3, mode: 'scan', stockType: 'stock' }
      },
      /* ใบ J2 = ของสต็อก 2 ชิ้น (SKU เดียวกับใบแรก)
         A3 ตั้งใจให้ "ประเภทเดียวกัน" อยู่ทั้งสองใบ — ต้องบวกกัน ไม่ใช่ใบหลังทับใบแรก */
      R2: {
        s4: { code: 'A1', zone: 'no-zone', zoneName: '(ไม่ระบุโซน)', user: 'ข',
              ts: 4, delta: 2, mode: 'scan', stockType: 'stock' },
        s5: { code: 'A3', zone: 'no-zone', zoneName: '(ไม่ระบุโซน)', user: 'ข',
              ts: 5, delta: 2, mode: 'scan', stockType: 'stock' }
      }
    });
    const out = await window.__exportJobs(['R1', 'R2']);
    const sheet = window.__jobSheet(out);
    return { a1: window.__row(sheet, 'A1'), a2: window.__row(sheet, 'A2'),
             a3: window.__row(sheet, 'A3'), sheetCount: out.sheets.length };
  });
  check('A1 รวมข้ามใบได้ "โชว์ (3), สต็อก (2)"',
        r2.a1[4] === 'โชว์ (3), สต็อก (2)', r2.a1 && r2.a1[4]);
  check('A2 (ยิงใบเดียว) ได้ "Asset (4)"', r2.a2[4] === 'Asset (4)', r2.a2 && r2.a2[4]);
  /* ⭐ ประเภทเดียวกันอยู่ทั้งสองใบ ต้องบวกยอดกัน (3 + 2) ไม่ใช่ใบหลังทับใบแรก
     เคสนี้คือเส้นแบ่งระหว่าง "รวมแบบบวก" กับ "รวมแบบตั้งธง" อย่างที่คอลัมน์โซนทำ */
  check('A3 ประเภทเดียวกันข้ามสองใบ ต้องบวกกันเป็น "สต็อก (5)"',
        r2.a3[4] === 'สต็อก (5)', r2.a3 && r2.a3[4]);
  check('ยอดในคอลัมน์เดิมยังรวมข้ามใบเหมือนเดิม (A1 ยิงจริง = 5)',
        r2.a1[8] === 5, r2.a1);
  check('สองใบอยู่รอบเดียวกัน จึงยุบเป็นชีทเดียว (สรุปรวม + 1 ชีท)',
        r2.sheetCount === 2, r2.sheetCount);
  check('คอลัมน์หลังช่องใหม่ไม่เลื่อน (Status · ประเภท · ยอดระบบ)',
        r2.a1[5] === 'Normal' && r2.a1[6] === 'Product' && r2.a1[7] === 100, r2.a1);

  /* ---------- 3. หักลบจนเหลือ 0 + แถวเก่าที่ไม่มี stockType ---------- */
  console.log('\n[3] ประเภทสุทธิ 0 ไม่โชว์ · แถวเก่าได้ "(ไม่ระบุ)"');
  const r3 = await page.evaluate(async () => {
    window.__seed({
      R1: {
        /* โชว์ยิงแล้วหักคืนจนหมด → ต้องไม่โชว์ฝั่งโชว์ */
        s1: { code: 'A1', zone: 'no-zone', user: 'ก', ts: 1, delta: 2, mode: 'scan', stockType: 'display' },
        s2: { code: 'A1', zone: 'no-zone', user: 'ก', ts: 2, delta: -2, mode: 'scan', stockType: 'display' },
        s3: { code: 'A1', zone: 'no-zone', user: 'ก', ts: 3, delta: 3, mode: 'scan', stockType: 'stock' },
        /* แถวก่อน v2.16.0 — ไม่มีฟิลด์ stockType เลย */
        s4: { code: 'A2', zone: 'no-zone', user: 'ก', ts: 4, delta: 4, mode: 'scan' },
        /* ปนเก่า+ใหม่ในตัวเดียวกัน */
        s5: { code: 'A3', zone: 'no-zone', user: 'ก', ts: 5, delta: 1, mode: 'scan' },
        s6: { code: 'A3', zone: 'no-zone', user: 'ก', ts: 6, delta: 2, mode: 'scan', stockType: 'display' }
      },
      R2: {}
    });
    const out = await window.__exportJobs(['R1', 'R2']);
    const sheet = window.__jobSheet(out);
    return { a1: window.__row(sheet, 'A1'), a2: window.__row(sheet, 'A2'),
             a3: window.__row(sheet, 'A3') };
  });
  check('ฝั่งที่สุทธิเหลือ 0 หายไป เหลือแต่ "สต็อก (3)"',
        r3.a1[4] === 'สต็อก (3)', r3.a1 && r3.a1[4]);
  check('แถวเก่าล้วน → "(ไม่ระบุ) (4)" ไม่ทิ้งยอด',
        r3.a2[4] === '(ไม่ระบุ) (4)', r3.a2 && r3.a2[4]);
  check('ปนเก่า+ใหม่ → โชว์ก่อน แล้วปิดท้ายด้วย (ไม่ระบุ)',
        r3.a3[4] === 'โชว์ (2), (ไม่ระบุ) (1)', r3.a3 && r3.a3[4]);

  /* ---------- 4. ไฟล์ .xlsx ที่ปล่อยออกไปจริง ---------- */
  console.log('\n[4] อ่านไฟล์ที่ปล่อยออกไปกลับเข้ามา');
  const r4 = await page.evaluate(async () => {
    window.__seed({
      R1: { s1: { code: 'A1', zone: 'no-zone', user: 'ก', ts: 1, delta: 3,
                  mode: 'scan', stockType: 'display', foundZone: 'DA-1' } },
      R2: { s2: { code: 'A1', zone: 'no-zone', user: 'ข', ts: 2, delta: 2,
                  mode: 'scan', stockType: 'stock', foundZone: 'SA-1' } }
    });
    const out = await window.__exportJobs(['R1', 'R2']);
    const sheets = await parseXlsxSheets(await out.blob.arrayBuffer());
    const job = sheets.filter(function (s) { return s.name !== 'สรุปรวม'; })[0];
    const a1 = job.rows.filter(function (r) { return r[0] === 'A1'; })[0];
    return { head: job.rows[0], a1: a1 };
  });
  check('ไฟล์จริงมีหัว "ประเภทที่นับ" ที่ index 4', r4.head[4] === 'ประเภทที่นับ', r4.head);
  check('ไฟล์จริงมีค่าในคอลัมน์นั้นครบ', r4.a1[4] === 'โชว์ (3), สต็อก (2)', r4.a1);
  check('ช่องโซนที่เก็บยังเป็นชื่อโซนล้วนไม่มีจำนวน (ของเดิม จงใจไม่แก้)',
        r4.a1[3] === 'DA-1, SA-1', r4.a1);
  /* ตัวอ่าน .xlsx คืนตัวเลขเป็นข้อความ เทียบด้วย Number() ไม่งั้นตกเพราะชนิดข้อมูล ไม่ใช่เพราะตำแหน่ง */
  check('คอลัมน์อื่นในไฟล์จริงไม่เลื่อนตำแหน่ง',
        r4.a1[0] === 'A1' && r4.a1[1] === 'สินค้า A' && r4.a1[5] === 'Normal' &&
        Number(r4.a1[7]) === 100 && Number(r4.a1[8]) === 5, r4.a1);

  /* ---------- 5. กติกาต้องเป็นก้อนเดียวกับไฟล์รายงานสรุป ---------- */
  console.log('\n[5] fmtStockTypeTally เป็นกติกากลางที่ใช้ร่วมกันสองไฟล์');
  const r5 = await page.evaluate(() => {
    return {
      mixed: fmtStockTypeTally({ display: 3, stock: 2, asset: 1 }),
      zeroOut: fmtStockTypeTally({ display: 0, stock: 2 }),
      negative: fmtStockTypeTally({ display: -1 }),
      blank: fmtStockTypeTally({ '': 4 }),
      unknownType: fmtStockTypeTally({ future: 2, display: 1 }),
      none: fmtStockTypeTally(null),
      empty: fmtStockTypeTally({})
    };
  });
  check('เรียงคงที่ โชว์ → สต็อก → Asset',
        r5.mixed === 'โชว์ (3), สต็อก (2), Asset (1)', r5.mixed);
  check('ตัดฝั่งที่เหลือ 0 และติดลบออก',
        r5.zeroOut === 'สต็อก (2)' && r5.negative === '', r5);
  check('ถังว่าง (แถวเก่า) แสดงเป็น "(ไม่ระบุ)"', r5.blank === '(ไม่ระบุ) (4)', r5.blank);
  check('ประเภทที่ไม่รู้จักไม่ถูกทิ้ง ต่อท้ายให้ก่อน (ไม่ระบุ)',
        r5.unknownType === 'โชว์ (1), future (2)', r5.unknownType);
  check('ไม่มีข้อมูล → ช่องว่าง', r5.none === '' && r5.empty === '', r5);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
