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
   [6] ผู้ยิงรายคน (scannerStats) ต้องใช้กติกาเดียวกัน — ผลรวมรายคน = ยอดรวมรอบ
       ทั้งรอบมีผี/ไม่มีผี และทั้งยิงคนเดียว/หลายคน
   [7] เอกสารต้องไม่มีประโยคอธิบายว่าตัดบาร์โค้ดผีไปกี่ชิ้น — โชว์แค่ยอดสะอาด
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

  /* ---------- [6] ผู้ยิงรายคน ---------- */
  console.log('\n[6] ⭐ ผู้ยิงรายคน — ผลรวมรายคนต้องเท่ายอดรวมรอบเสมอ');

  const one = await page.evaluate(() => {
    window.__seedRound();
    window.__scanReal();          /* สมชายยิงคนเดียว 3,078 ชิ้น */
    window.__addGhosts(13);
    const rows = scannerStats();
    const sum = rows.reduce(function (s, r) { return s + r.pieces; }, 0);
    const board = currentStat();
    return { rows: rows, sum: sum, board: { pieces: board.pieces, skus: board.skus } };
  });
  check('มีผู้ยิงคนเดียว', one.rows.length === 1, one.rows.map(r => r.user));
  check('⭐ ผู้ยิงรายคน = 3,078 ชิ้น (ไม่ใช่ 3,065)', one.rows[0].pieces === 3078, one.rows[0]);
  check('⭐ ผลรวมรายคน = ยอดรวมรอบ', one.sum === one.board.pieces, one);
  check('⭐ SKU รายคน = SKU ของรอบ (ผีไม่ถูกนับ)',
        one.rows[0].skus === one.board.skus && one.rows[0].skus === 2, one);

  console.log('\n[6b] รอบไม่มีผี — ตัวเลขรายคนต้องไม่ขยับ');
  const oneClean = await page.evaluate(() => {
    window.__seedRound();
    window.__scanReal();
    const rows = scannerStats();
    return { pieces: rows[0].pieces, skus: rows[0].skus,
             sum: rows.reduce(function (s, r) { return s + r.pieces; }, 0),
             board: currentStat().pieces };
  });
  check('รายคน = 3,078 เหมือนเดิม', oneClean.pieces === 3078, oneClean);
  check('SKU = 2 เหมือนเดิม', oneClean.skus === 2, oneClean);
  check('ผลรวมรายคน = ยอดรวมรอบ', oneClean.sum === oneClean.board, oneClean);

  console.log('\n[6c] หลายคนยิง — ผลรวมรายคนต้องยังเท่ายอดรวมรอบ');
  const many = await page.evaluate(() => {
    window.__seedRound();
    /* สามคนยิงคนละส่วน + ผีของแต่ละคน */
    writeScan('P1', 1000, 'scan');
    state.counter = 'สมศรี';
    writeScan('P1', 2000, 'scan');
    state.counter = 'สมปอง';
    writeScan('P2', 78, 'scan');
    window.__addGhosts(5);        /* ผีของสมปอง */
    state.counter = 'สมชาย';
    window.__addGhosts(0);
    const rows = scannerStats();
    const sum = rows.reduce(function (s, r) { return s + r.pieces; }, 0);
    return { rows: rows, sum: sum, board: currentStat().pieces,
             summary: summaryData().groups.total.actQty };
  });
  check('มีผู้ยิง 3 คน', many.rows.length === 3, many.rows.map(r => r.user + ':' + r.pieces));
  check('⭐ ผลรวมรายคน = ยอดรวมรอบ', many.sum === many.board, many);
  check('⭐ ผลรวมรายคน = หน้าสรุป/เอกสาร', many.sum === many.summary, many);
  check('ยอดรวมยังเป็น 3,078', many.sum === 3078, many);

  console.log('\n[6d] ⭐ เคสยาก — คนหนึ่งยิง อีกคนหักคืนจนเป็นผี ต้องหลุดทั้งคู่');
  const cross = await page.evaluate(() => {
    window.__seedRound();
    window.__scanReal();
    /* สมชายยิงบาร์โค้ดที่ไม่มีในระบบ +5 · สมศรีหักคืน -5 → ยอดรวม 0 = ผี
       ถ้าตัดสินรายคนจะกลายเป็นตัดของคนหนึ่งแต่ไม่ตัดของอีกคน แล้วผลรวมเพี้ยนทันที */
    state.counter = 'สมชาย';
    writeScan(safeKey('BARZERO'), 5, 'scan', null, { unknown: true, raw: 'BARZERO' });
    state.counter = 'สมศรี';
    writeScan(safeKey('BARZERO'), -5, 'scan', 'ยิงหลุด', { unknown: true, raw: 'BARZERO' });
    const rows = scannerStats();
    const sum = rows.reduce(function (s, r) { return s + r.pieces; }, 0);
    const byUser = {};
    rows.forEach(function (r) { byUser[r.user] = r.pieces; });
    return { byUser: byUser, sum: sum, board: currentStat().pieces,
             summary: summaryData().groups.total.actQty };
  });
  check('⭐ ผลรวมรายคน = ยอดรวมรอบ (ไม่เพี้ยนจากการหักข้ามคน)',
        cross.sum === cross.board && cross.sum === cross.summary, cross);
  /* สมศรียิงแต่แถวผีล้วน พอตัดผีออกเธอจึงไม่เหลือรายการอะไรเลย = ไม่ขึ้นชื่อ
     ถูกต้องแล้ว — คนที่ไม่มียอดจริงไม่ควรไปโผล่ในรายชื่อผู้นับของเอกสาร
     ที่สำคัญคือ +5 ของสมชายต้องถูกตัดด้วย ไม่ใช่ตัดแต่ -5 ของสมศรี */
  check('สมชายไม่ได้ +5 ของผีติดมา (3,078 ไม่ใช่ 3,083)',
        cross.byUser['สมชาย'] === 3078, cross.byUser);
  check('สมศรีที่ยิงแต่ผีล้วน ไม่ขึ้นชื่อในรายชื่อผู้นับ',
        cross.byUser['สมศรี'] === undefined, cross.byUser);

  /* ---------- [7] เอกสารต้องไม่อธิบายเรื่องตัดผี ---------- */
  console.log('\n[7] เอกสารโชว์แค่ยอดสะอาด ไม่มีประโยคอธิบายส่วนต่าง');
  const docSrc = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  check('ไม่มีตัวแปร whoGap เหลืออยู่', /whoGap/.test(docSrc) === false, 'whoGap');
  check('ไม่มีข้อความ "ยอดจริงในตาราง"', /ยอดจริงในตาราง/.test(docSrc) === false, 'ยอดจริงในตาราง');
  check('ไม่มีข้อความ "จากบาร์โค้ดที่ไม่นับเป็นสินค้าจริง"',
        /จากบาร์โค้ดที่ไม่นับเป็นสินค้าจริง/.test(docSrc) === false, 'ไม่นับเป็นสินค้าจริง');

  const docLine = await page.evaluate(() => {
    window.__seedRound();
    window.__scanReal();
    window.__addGhosts(13);
    const who = scannerStats();
    const whoPieces = who.reduce(function (s, w) { return s + w.pieces; }, 0);
    /* ประกอบข้อความแบบเดียวกับที่ renderDoc เขียนลง #docScanners */
    return 'ผู้นับในรอบนี้ ' + fmtNum(who.length) + ' คน: ' +
           who.map(function (w) { return w.user + ' (' + fmtNum(w.pieces) + ' ชิ้น)'; }).join(' · ') +
           ' — รวม ' + fmtNum(whoPieces) + ' ชิ้น';
  });
  check('บรรทัดผู้นับจบที่ "รวม 3,078 ชิ้น"', /— รวม 3,078 ชิ้น$/.test(docLine), docLine);
  check('ไม่มีวงเล็บอธิบายส่วนต่างต่อท้าย', /ต่างกัน/.test(docLine) === false, docLine);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
