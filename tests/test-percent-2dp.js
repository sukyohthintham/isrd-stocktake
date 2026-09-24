/* ============================================================
   v2.24.0 — %Success โชว์ทศนิยม 2 ตำแหน่งทุกที่
   ============================================================

   ของเดิมปัดเหลือ 1 ตำแหน่ง ซึ่งหยาบเกินสำหรับรอบใหญ่:
   99.94% กับ 99.85% กลายเป็น "99.9%" เท่ากันทั้งคู่ ทั้งที่ห่างกันหลายสิบชิ้น

   ขอบเขตที่ต้องเปลี่ยน: หน้าจอ · เอกสารพิมพ์ (ตาราง + โดนัท) · ไฟล์ Excel ทุกใบ
   ⚠ ห้ามแตะ pctPiecesOf()/pctSkuOf() (สูตรคำนวณ) และ gap ของแถบกระจุกกลุ่ม
     ซึ่งเป็น %สัดส่วนให้รวมเป็น 100 คนละเรื่องกับ %Success
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

    /* 8 SKU ยิงตรง 7 ตัว = 87.5% ซึ่งเป็นค่าที่ 1 ตำแหน่งปัดเป็น 87.5 เหมือนกัน
       จึงเติม SKU ที่ทำให้ได้ .25 / .75 ด้วย เพื่อให้เห็นความต่างจริง */
    window.__seed = function () {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.page = 'summary';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.cycles = { C1: { status: 'counting', info: {} } };
      state.priceField = 'costPrice';
      state.products = {}; state.systemQty = {}; state.counts = {};
      /* 16 SKU — ตรง 15 ตัว = 93.75% (ปัด 1 ตำแหน่งจะกลายเป็น 93.8 ซึ่งผิดไป 0.05) */
      for (var i = 1; i <= 16; i++) {
        var k = 'P' + i;
        state.products[k] = { code: k, name: 'สินค้า ' + i, type: 'product', costPrice: 10 };
        state.systemQty[k] = 10;
        state.counts[k] = (i === 16) ? 9 : 10;      // ตัวสุดท้ายขาด 1 ชิ้น
      }
      state.scanQty = JSON.parse(JSON.stringify(state.counts));
      state.manualQty = {}; state.reasons = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.zones = {}; state.transfers = {}; state.transferQty = {};
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.cycleData = null; state.summaryTab = 'job';
      buildScanIndex();
    };

    /* ดักชีทที่ส่งเข้า buildXlsx แล้วยังสร้างไฟล์จริงต่อ */
    window.__grab = function (fn) {
      const real = window.buildXlsx;
      let captured = null;
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      window.buildXlsx = function (sheets) { captured = sheets; return real(sheets); };
      const r = fn();
      const done = function () {
        window.buildXlsx = real;
        HTMLAnchorElement.prototype.click = realClick;
        return captured;
      };
      return (r && r.then) ? r.then(done) : Promise.resolve(done());
    };
  });

  /* ---------- 1. ตัวฟอร์แมตกลาง ---------- */
  console.log('\n[1] fmtPercent() — 2 ตำแหน่งคงที่');
  const r1 = await page.evaluate(() => {
    return {
      p999: fmtPercent(99.9), p951: fmtPercent(95.1), p100: fmtPercent(100),
      p0: fmtPercent(0), pNull: fmtPercent(null), pInf: fmtPercent(Infinity),
      pNaN: fmtPercent(NaN), pUndef: fmtPercent(undefined),
      p9375: fmtPercent(93.75), p9994: fmtPercent(99.9375),
      pLong: fmtPercent(66.66666), pRound: fmtPercent(99.999)
    };
  });
  check('99.9 → "99.90%" (เติม 0 ให้ครบ 2 ตำแหน่ง)', r1.p999 === '99.90%', r1.p999);
  check('95.1 → "95.10%"', r1.p951 === '95.10%', r1.p951);
  check('100 → "100.00%" (เลขกลมก็ต้องมีทศนิยม ให้จุดเรียงตรงกันทั้งคอลัมน์)',
        r1.p100 === '100.00%', r1.p100);
  check('0 → "0.00%"', r1.p0 === '0.00%', r1.p0);
  check('⭐ ค่าที่ 1 ตำแหน่งเคยกลืนกัน แยกออกจากกันได้แล้ว',
        r1.p9375 === '93.75%' && r1.p9994 === '99.94%', r1);
  check('ทศนิยมยาวถูกปัดเหลือ 2 ตำแหน่ง', r1.pLong === '66.67%', r1.pLong);
  check('ปัดขึ้นข้ามหลักได้ถูก (99.999 → 100.00%)', r1.pRound === '100.00%', r1.pRound);
  check('ค่าที่ไม่มี/ไม่ใช่ตัวเลข ยังเป็นขีดกลางเหมือนเดิม',
        r1.pNull === '–' && r1.pInf === '–' && r1.pNaN === '–' && r1.pUndef === '–', r1);

  /* ---------- 2. หน้าสรุปบนจอ ---------- */
  console.log('\n[2] หน้าสรุปบนจอ');
  const r2 = await page.evaluate(() => {
    window.__seed();
    /* innerText อ่านเฉพาะของที่มองเห็น — ต้องเปิดหน้าสรุปให้ active ก่อน
       ไม่งั้นข้อนี้จะ "ผ่าน" เพราะไม่มีข้อความอะไรเลย ซึ่งไม่ได้พิสูจน์อะไร */
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    $('pageSummary').classList.add('active');
    renderSummary();
    const txt = document.body.innerText;
    const d = summaryData();
    return {
      pctPieces: pctPiecesOf(d.groups.total),
      pctSku: pctSkuOf(d.groups.total),
      shownPieces: fmtPercent(pctPiecesOf(d.groups.total)),
      shownSku: fmtPercent(pctSkuOf(d.groups.total)),
      onScreen: txt.indexOf(fmtPercent(pctSkuOf(d.groups.total))) >= 0,
      /* ต้องไม่เหลือรูปแบบ 1 ตำแหน่งของ %Success ค้างอยู่บนจอ */
      oneDp: (txt.match(/\d+\.\d%/g) || [])
    };
  });
  check('สูตรคำนวณไม่ถูกแตะ (SKU ตรง 15/16 = 93.75)', r2.pctSku === 93.75, r2.pctSku);
  check('จอโชว์ "93.75%" ไม่ใช่ "93.8%"', r2.shownSku === '93.75%', r2.shownSku);
  check('ตัวเลขนั้นอยู่บนหน้าจอจริง', r2.onScreen === true, r2.shownSku);
  check('ไม่มี % แบบ 1 ตำแหน่งหลงเหลือบนหน้าสรุป',
        r2.oneDp.length === 0, r2.oneDp.slice(0, 5));

  /* ---------- 3. เอกสารพิมพ์ (ตาราง + โดนัท) ---------- */
  console.log('\n[3] เอกสารพิมพ์ — ตาราง Dashboard + โดนัท');
  const r3b = await page.evaluate(() => {
    window.__seed();
    const fig = donutFigures(summaryData());
    /* วาดโดนัทด้วยทางเดินจริงของหน้าสรุป แล้วอ่านข้อความบน svg */
    state.page = 'summary';
    renderSummary();
    const texts = Array.prototype.map.call(
      document.querySelectorAll('#sumDonut text'), function (t) { return t.textContent; });
    return {
      fig: fig.map(function (f) { return { pieces: f.pieces, sku: f.sku }; }),
      want: fig.map(function (f) {
        return { pieces: fmtPercent(f.pieces), sku: fmtPercent(f.sku) };
      }),
      texts: texts,
      oneDp: texts.filter(function (t) { return /^\d+\.\d%$/.test(t); })
    };
  });
  check('โดนัทโชว์ 2 ตำแหน่งตาม fmtPercent',
        r3b.want.every(function (w) {
          return r3b.texts.indexOf(w.pieces) >= 0 && r3b.texts.indexOf(w.sku) >= 0;
        }), { texts: r3b.texts, want: r3b.want });
  check('ไม่มีตัวเลขแบบ 1 ตำแหน่งบนโดนัท', r3b.oneDp.length === 0, r3b.oneDp);

  /* ---------- 4. ไฟล์ Excel รายงานสรุป ---------- */
  console.log('\n[4] Excel รายงานสรุป — ค่าในเซลล์ต้องละเอียด 2 ตำแหน่ง');
  const r4 = await page.evaluate(async () => {
    window.__seed();
    const sheets = await window.__grab(function () {
      return buildSummaryExcel(summaryData());
    });
    const s1 = sheets.filter(function (s) { return s.name === 'สรุป'; })[0];
    const head = s1.rows[0];
    const iPc = head.indexOf('%Success (ชิ้น)');
    const iSku = head.indexOf('%Success (SKU)');
    const totalRow = s1.rows.filter(function (r) { return r[0] === 'รวมทั้งหมด'; })[0]
                  || s1.rows[3];
    return { iPc: iPc, iSku: iSku, pc: totalRow[iPc], sku: totalRow[iSku],
             head: head, totalRow: totalRow };
  });
  check('เซลล์ %Success (SKU) = 93.75 ไม่ใช่ 93.8', r4.sku === 93.75, r4);
  check('เซลล์ %Success (ชิ้น) ละเอียด 2 ตำแหน่ง',
        Math.abs(r4.pc - Math.round(r4.pc * 100) / 100) < 1e-9 &&
        String(r4.pc).indexOf('.') >= 0, r4.pc);
  check('เก็บเป็นตัวเลขไม่ใช่ข้อความ (Excel คำนวณต่อได้)',
        typeof r4.sku === 'number', typeof r4.sku);

  /* ---------- 5. ไฟล์ Excel รวมหลาย Job ---------- */
  console.log('\n[5] Excel รวมหลาย Job');
  const r5 = await page.evaluate(async () => {
    window.__seed();
    /* ป้อน scan ดิบให้ loadJobsRaw อ่าน — ตรง 15/16 SKU เหมือนกัน */
    const scans = {};
    for (var i = 1; i <= 16; i++) {
      scans['s' + i] = { code: 'P' + i, zone: 'no-zone', user: 'ก', ts: i,
                         delta: (i === 16) ? 9 : 10, mode: 'scan', stockType: 'stock' };
    }
    window.db.get = function (path) {
      if (path === 'cycles/C1/systemQty') return Promise.resolve(state.systemQty);
      if (path === 'rounds/R1/scans') return Promise.resolve(scans);
      return Promise.resolve(null);
    };
    window.db.getQuiet = window.db.get;
    window.cycleMigrated = function () { return true; };

    const sheets = await window.__grab(function () { return exportJobsExcel(['R1']); });
    const sum = sheets.filter(function (s) { return s.name === 'สรุปรวม'; })[0];
    const head = sum.rows[0];
    const iSku = head.indexOf('%Success (SKU)');
    const row = sum.rows[1];
    return { iSku: iSku, sku: row[iSku], row: row };
  });
  check('ชีทสรุปรวมเก็บ %Success (SKU) = 93.75', r5.sku === 93.75, r5);

  /* ---------- 6. แถบกระจุกกลุ่มต้องไม่ถูกแตะ ---------- */
  console.log('\n[6] %สัดส่วนของแถบกระจุกกลุ่ม (คนละเรื่องกับ %Success)');
  const r6 = await page.evaluate(() => {
    const src = String(stockDisplayReport);
    /* ตัวปรับ gap ให้รวมเป็น 100 ยังต้องเป็น 1 ตำแหน่งเหมือนเดิม */
    return { hasGap10: /Math\.round\(\(100 - sum\) \* 10\) \/ 10/.test(src),
             hasBig10: /Math\.round\(\(pct\[big\] \+ gap\) \* 10\) \/ 10/.test(src) };
  });
  check('gap ของแถบกระจุกกลุ่มยังปัด 1 ตำแหน่งเหมือนเดิม ไม่ถูกเหมารวม',
        r6.hasGap10 === true && r6.hasBig10 === true, r6);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
