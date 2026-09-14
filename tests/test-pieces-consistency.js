/* ============================================================
   "ชิ้นที่ยิงได้" ต้องเท่ากันทุกหน้า — v2.10.4
   ============================================================

   เคสจริงที่แก้ (WHS19-STOCK-20260903-01):
     เอกสาร/Excel = 3,078 (ถูก — ผ่านกติกาตัดแถวของ summaryData)
     การ์ด Job / ภาพรวมทุกสาขา / scoreboard = 3,065 (บวก delta ดิบเอง ไม่ผ่านกติกา)
     ส่วนต่าง 13 = บาร์โค้ดผีที่แอดมินสั่งลบทิ้ง 13 ตัว ยอดสุทธิตัวละ -1

   ทางแก้: ทุกทางเรียก countsAsRealRow() ตัวเดียวกัน ไม่มีใครบวกดิบเองอีก

   กันอะไร:
   [1] รอบที่มีผี → ทุกทางต้องได้ "เลขสะอาด" เท่ากันหมด
       (การ์ด Job = หัวรอบ/ภาพรวม = หน้าสรุป = เอกสาร = scoreboard)
   [2] รอบที่ไม่มีผี → ตัวเลขต้องไม่เปลี่ยนจากเดิมเลยแม้แต่ชิ้นเดียว
   [3] กติกาเดียวมีที่เดียว — ไม่มีใครเขียนเงื่อนไข 0/0 หรือ discarded ซ้ำที่อื่น
   [4] แคชสถิติของกติกาเก่าใน localStorage ต้องถูกทิ้ง ไม่เอามาใช้ต่อ
   [5] ผีที่ถูกสั่งลบใน Job หนึ่ง ต้องไม่ถูกนับในยอดรวมของทั้งรอบด้วย
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__writes = [];
  window.toast = function () {};
  window.enqueueWrite = function (p, patch) { window.__writes.push({ p: p, patch: patch }); };
  window.db.update = function (p, patch) { window.__writes.push({ p: p, patch: patch }); return Promise.resolve(); };
  window.session.token = function () { return 'tok'; };
  hideLogin();
  var idN = 0;
  window.db.newKey = function () { return 'k' + (++idN); };

  window.__seedRound = function () {
    state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
    state.counter = 'สมชาย';
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.priceField = 'costPrice';
    state.products = {
      P1: { code: 'P1', name: 'สินค้า P1', type: 'product', costPrice: 10, sellPrice: 10 },
      P2: { code: 'P2', name: 'สินค้า P2', type: 'product', costPrice: 10, sellPrice: 10 }
    };
    state.systemQty = { P1: 3000, P2: 100 };
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline'; state.locationFilter = '';
    resetRoundAggregates();
    window.__writes = [];
  };

  /* ยิงของจริง 3,078 ชิ้น (P1 3,000 + P2 78) */
  window.__scanReal = function () {
    writeScan('P1', 3000, 'scan');
    writeScan('P2', 78, 'scan');
  };
  /* ผี 13 ตัว ตัวละ -1 แล้วแอดมินสั่งลบทิ้ง — แบบเคส WHS19 เป๊ะ */
  window.__addGhosts = function (n) {
    for (var i = 0; i < n; i++) {
      var code = 'GHOST' + i;
      writeScan(safeKey(code), -1, 'resolve', 'ลบทิ้ง (ยิงหลุด)',
                { unknown: true, raw: code, discard: true });
    }
  };

  /* รวบตัวเลข "ชิ้นที่ยิงได้" จากทุกทางที่จอใช้จริง */
  window.__allPaths = function () {
    var blob = {};
    window.__writes.forEach(function (w) {
      Object.keys(w.patch || {}).forEach(function (k) {
        var m = /^scans\\/(.+)$/.exec(k);
        if (m) blob[m[1]] = w.patch[k];
      });
    });
    var jobCard = computeJobStats(blob, state.systemQty);   // การ์ด Job
    var summary = summaryData();                            // หน้าสรุป + เอกสาร + Excel
    var board = currentStat();                              // scoreboard
    var rebuilt = statFromScans(blob, state.systemQty);     // ที่ rebuild จะเขียนลงฐาน
    return {
      jobCard: jobCard.pieces,
      jobCardSkus: jobCard.skuScanned,
      summary: summary.groups.total.actQty,
      scoreboard: board.pieces,
      scoreboardSkus: board.skus,
      rebuilt: rebuilt.pieces,
      rawSum: Object.keys(blob).reduce(function (s, k) { return s + (blob[k].delta || 0); }, 0),
      records: Object.keys(blob).length
    };
  };
  window.__allEqual = function (a) {
    return a.jobCard === a.summary && a.summary === a.scoreboard && a.scoreboard === a.rebuilt;
  };
`;

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
  await page.evaluate(HARNESS);

  /* ---------- [2] รอบไม่มีผี — ห้ามเปลี่ยนอะไรเลย ---------- */
  console.log('\n[2] รอบที่ไม่มีบาร์โค้ดผี — ตัวเลขต้องไม่ขยับเลยแม้แต่ชิ้นเดียว');
  const clean = await page.evaluate(() => {
    window.__seedRound();
    window.__scanReal();
    return window.__allPaths();
  });
  check('ยอดดิบ = 3,078', clean.rawSum === 3078, clean);
  check('การ์ด Job = 3,078', clean.jobCard === 3078, clean);
  check('หน้าสรุป/เอกสาร/Excel = 3,078', clean.summary === 3078, clean);
  check('scoreboard = 3,078', clean.scoreboard === 3078, clean);
  check('ที่ rebuild จะเขียน = 3,078', clean.rebuilt === 3078, clean);
  const cleanEq = await page.evaluate(() => window.__allEqual(window.__allPaths()));
  check('⭐ ยืนยันซ้ำ: ทุกทางเท่ากัน', cleanEq === true, cleanEq);

  /* ---------- [1] รอบมีผี — ต้องเป็นเลขสะอาดทุกทาง ---------- */
  console.log('\n[1] ⭐ รอบที่มีผี 13 ตัว (เคส WHS19) — ทุกทางต้องได้ 3,078');
  const ghost = await page.evaluate(() => {
    window.__seedRound();
    window.__scanReal();
    window.__addGhosts(13);
    return window.__allPaths();
  });
  check('ยอดดิบคือ 3,065 (เลขที่การ์ดเคยโชว์ผิด)', ghost.rawSum === 3065, ghost);
  check('⭐ การ์ด Job = 3,078 แล้ว', ghost.jobCard === 3078, ghost);
  check('⭐ หน้าสรุป/เอกสาร/Excel = 3,078 (เหมือนเดิม ไม่ถูกแตะ)', ghost.summary === 3078, ghost);
  check('⭐ scoreboard = 3,078 แล้ว', ghost.scoreboard === 3078, ghost);
  check('⭐ rebuild จะเขียน 3,078 ลงฐาน', ghost.rebuilt === 3078, ghost);
  const ghostEq = await page.evaluate(() => window.__allEqual(window.__allPaths()));
  check('⭐⭐ ทุกทางเท่ากันเป๊ะ = 3,078', ghostEq === true, ghost);
  check('ผีไม่ถูกนับเป็น SKU ด้วย (P1 · P2 เท่านั้น = 2)',
        ghost.jobCardSkus === 2 && ghost.scoreboardSkus === 2, ghost);

  /* ---------- [5] ยอดรวมทั้งรอบ (หัวรอบ + ภาพรวมทุกสาขา) ---------- */
  console.log('\n[5] ยอดรวมทั้งรอบต้องตัดผีด้วย (หัวรอบนับ + ภาพรวมทุกสาขา)');
  const cyc = await page.evaluate(async () => {
    window.__seedRound();
    window.__scanReal();
    window.__addGhosts(13);
    const blob = {};
    window.__writes.forEach(function (w) {
      Object.keys(w.patch || {}).forEach(function (k) {
        const m = /^scans\/(.+)$/.exec(k);
        if (m) blob[m[1]] = w.patch[k];
      });
    });
    /* ป้อนก้อนเดียวกันให้ loadCycleStats ผ่านทางที่มันอ่านจริง */
    window.db.getQuiet = function (p) {
      if (/\/scans$/.test(p)) return Promise.resolve(blob);
      if (/systemQty$/.test(p)) return Promise.resolve(state.systemQty);
      return Promise.resolve({});
    };
    state.jobStats = {}; state.cycleStats = {};
    try { localStorage.removeItem('jobStats:R1'); } catch (e) {}
    const st = await loadCycleStats('C1');
    return { pieces: st.pieces, skuScanned: st.skuScanned };
  });
  check('⭐ หัวรอบ/ภาพรวม = 3,078', cyc.pieces === 3078, cyc);
  check('SKU ที่ยิงของทั้งรอบ = 2', cyc.skuScanned === 2, cyc);

  /* ---------- [3] กติกาต้องมีที่เดียว ---------- */
  console.log('\n[3] กติกาตัดแถวต้องมีที่เดียว — ห้ามเขียนซ้ำที่อื่น');
  const src = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  const defs = (src.match(/function countsAsRealRow/g) || []).length;
  check('ประกาศ countsAsRealRow ครั้งเดียว', defs === 1, defs);
  const users = (src.match(/countsAsRealRow\(/g) || []).length;
  check('มีคนเรียกใช้หลายที่ (ประกาศ + ผู้เรียกอย่างน้อย 4)', users >= 5, users);
  /* เงื่อนไข discarded ดิบ ๆ ต้องไม่เหลืออยู่นอก countsAsRealRow อีก */
  const rawDiscard = (src.match(/unknownInfo && unknownInfo\.discarded/g) || []).length;
  check('ไม่มีเงื่อนไข discarded ดิบซ้ำในที่คำนวณยอดอีก', rawDiscard <= 1, rawDiscard);

  /* ---------- [4] แคชกติกาเก่าต้องถูกทิ้ง ---------- */
  console.log('\n[4] แคชสถิติของกติกาเก่าต้องไม่ถูกเอามาใช้ต่อ');
  const cache = await page.evaluate(() => {
    window.__seedRound();
    /* แกล้งวางแคชแบบเก่า (ไม่มีธงเวอร์ชัน) ไว้ */
    localStorage.setItem('jobStats:R1', JSON.stringify({
      counts: { P1: 999 }, pieces: 999, skuScanned: 1, lastTs: 1, at: Date.now()
    }));
    state.jobStats = {};
    const got = cachedJobStats('R1');
    const left = localStorage.getItem('jobStats:R1');
    /* แคชที่มีธงถูกต้องต้องยังใช้ได้ */
    localStorage.setItem('jobStats:R1', JSON.stringify({
      counts: { P1: 5 }, pieces: 5, skuScanned: 1, lastTs: 1, at: Date.now(), v: JOB_STATS_V
    }));
    state.jobStats = {};
    const ok = cachedJobStats('R1');
    return { oldRejected: got === null, oldRemoved: left === null,
             newAccepted: !!ok && ok.pieces === 5 };
  });
  check('แคชกติกาเก่าถูกปฏิเสธ', cache.oldRejected === true, cache);
  check('และถูกลบทิ้งไม่ให้ค้าง', cache.oldRemoved === true, cache);
  check('แคชกติกาใหม่ยังใช้ได้ปกติ', cache.newAccepted === true, cache);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
