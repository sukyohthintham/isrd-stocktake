/* ============================================================
   diffPieces() — หาสาเหตุ "ชิ้นที่ยิงได้ไม่เท่ากันระหว่างหน้า" (v2.10.3)
   ============================================================

   เครื่องมืออ่านอย่างเดียวสำหรับตอบคำถามหน้างาน:
   ทำไม Job/สรุป ได้เลขหนึ่ง แต่เอกสารได้อีกเลขหนึ่ง — ส่วนต่างมาจากแถวไหน

   ⚠️ เทสนี้ไม่ได้ตัดสินว่านิยามไหนถูก แค่ยืนยันว่าเครื่องมือ "ชี้ตัวได้ตรง"
      การเปลี่ยนนิยามจริงต้องรอผลจากรอบจริงก่อน (ดูรายงานตอนส่งงาน)

   กันอะไร:
   [1] ยอดดิบ = ผลรวม delta ทุกแถว ไม่ตัดอะไรเลย
   [2] แถวผี 0/0 ถูกตัดแต่ไม่กระทบยอด (ต้องไม่โผล่ใน droppedWithQty)
   [3] บาร์โค้ดที่แอดมินสั่งลบทิ้ง แม้ยอดยังเป็นบวก ก็ถูกตัดจากหน้าสรุป
       → ชี้เหตุผลเป็น unknown-discarded พร้อมจำนวนชิ้นที่หายไป
   [4] บาร์โค้ดที่ยอดสุทธิ <= 0 ถูกตัด → ชี้เป็น unknown-net<=0
   [5] gap ต้องเท่ากับผลรวมของแถวที่ถูกตัดเสมอ (อธิบายส่วนต่างได้ครบ)
   [6] รอบที่ไม่มีแถวแปลก ๆ → gap = 0 ทุกทางตรงกันหมด
   [7] อ่านอย่างเดียว ห้ามเขียนอะไรลงฐาน
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
  window.db.update = function (p, patch) {
    window.__writes.push({ p: p, patch: patch });
    return Promise.resolve();
  };
  window.session.token = function () { return 'tok'; };
  hideLogin();
  var idN = 0;
  window.db.newKey = function () { return 'k' + (++idN); };

  window.__base = function () {
    state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
    state.counter = 'สมชาย';
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.priceField = 'costPrice';
    state.products = {
      A1: { code: 'A1', name: 'สินค้า A1', type: 'product', costPrice: 10, sellPrice: 10 },
      A2: { code: 'A2', name: 'สินค้า A2', type: 'product', costPrice: 10, sellPrice: 10 },
      A3: { code: 'A3', name: 'สินค้า A3', type: 'product', costPrice: 10, sellPrice: 10 }
    };
    state.systemQty = { A1: 100, A2: 50, A3: 0 };
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline'; state.locationFilter = '';
    resetRoundAggregates();
    window.__writes = [];
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

  /* ---------- [6] รอบสะอาด — ทุกทางต้องตรงกัน ---------- */
  console.log('\n[6] รอบที่ไม่มีแถวแปลก ๆ — ทุกทางต้องได้เลขเดียวกัน');
  const clean = await page.evaluate(() => {
    window.__base();
    writeScan('A1', 100, 'scan');
    writeScan('A2', 45, 'scan');
    return diffPieces();
  });
  check('ยอดดิบ = 145', clean.rawPieces === 145, clean);
  check('หน้าสรุปได้เลขเดียวกัน', clean.summaryActQty === 145, clean);
  check('scoreboard ได้เลขเดียวกัน', clean.scoreboardPieces === 145, clean);
  check('ไม่มีส่วนต่าง', clean.gap === 0, clean);
  check('ไม่มีแถวที่ถูกตัดทั้งที่ยังมียอด', clean.droppedWithQty.length === 0, clean.droppedWithQty);

  /* ---------- [2] แถวผี 0/0 ---------- */
  console.log('\n[2] แถวผี 0/0 — ตัดได้ แต่ต้องไม่กระทบยอด');
  const ghost = await page.evaluate(() => {
    window.__base();
    writeScan('A1', 100, 'scan');
    writeScan('A3', 5, 'scan');
    writeScan('A3', -5, 'scan', 'ยิงหลุด');   /* A3 กลับเป็น 0 · ยอดระบบก็ 0 = แถวผี */
    return diffPieces();
  });
  check('ยอดดิบ = 100', ghost.rawPieces === 100, ghost);
  check('หน้าสรุปก็ 100 เท่ากัน (แถวผีไม่มียอดให้หาย)', ghost.summaryActQty === 100, ghost);
  check('gap = 0', ghost.gap === 0, ghost);
  check('แถวผีถูกนับแยกไว้ ไม่ปนกับแถวที่มียอด',
        ghost.droppedZero >= 1 && ghost.droppedWithQty.length === 0, ghost);

  /* ---------- [3] บาร์โค้ดที่แอดมินสั่งลบทิ้ง แต่ยอดยังเป็นบวก ---------- */
  console.log('\n[3] ⭐ บาร์โค้ดที่ถูกสั่งลบทิ้งแต่ยอดยังบวก — ตัวที่ทำให้เลขต่างกัน');
  const disc = await page.evaluate(() => {
    window.__base();
    writeScan('A1', 100, 'scan');
    /* ยิงบาร์โค้ดที่ไม่มีในระบบ 13 ชิ้น แล้วแอดมินสั่งลบทิ้ง (แต่ยอดสุทธิยังเป็น +13) */
    for (var i = 0; i < 13; i++) writeUnknownScan('8850999999999');
    writeScan(safeKey('8850999999999'), 0, 'resolve', 'ลบทิ้ง (ยิงหลุด)',
              { unknown: true, raw: '8850999999999', discard: true });
    return diffPieces();
  });
  check('ยอดดิบรวม 13 ชิ้นนั้นด้วย = 113', disc.rawPieces === 113, disc);
  check('⭐ หน้าสรุปตัด 13 ชิ้นออก = 100', disc.summaryActQty === 100, disc);
  check('⭐ gap = 13 ตรงกับที่หายไป', disc.gap === 13, disc);
  check('ชี้เหตุผลว่า unknown-discarded',
        disc.byWhy['unknown-discarded'] && disc.byWhy['unknown-discarded'].pieces === 13,
        disc.byWhy);
  check('ชี้ตัวบาร์โค้ดได้ถูก',
        disc.droppedWithQty.length === 1 &&
        disc.droppedWithQty[0].code === '8850999999999' &&
        disc.droppedWithQty[0].act === 13 &&
        disc.droppedWithQty[0].discarded === true, disc.droppedWithQty);
  /* ⭐ v2.10.4 — scoreboard เปลี่ยนมาใช้เลขสะอาดแล้ว ต้องเท่ากับหน้าสรุปเป๊ะ
     ก่อนหน้านี้เป็นยอดดิบ (113) ซึ่งคือต้นเหตุที่การ์ดกับเอกสารไม่ตรงกัน */
  check('scoreboard = เลขสะอาด เท่ากับหน้าสรุป (100)',
        disc.scoreboardPieces === 100 && disc.scoreboardPieces === disc.summaryActQty, disc);

  /* ---------- [4] ยอดสุทธิ <= 0 ---------- */
  console.log('\n[4] บาร์โค้ดที่ยอดสุทธิเหลือ <= 0 (ย้ายไปผูกที่อื่น/หักเบิ้ล)');
  const neg = await page.evaluate(() => {
    window.__base();
    writeScan('A1', 100, 'scan');
    for (var i = 0; i < 4; i++) writeUnknownScan('8851111111111');
    /* หักเบิ้ลจนติดลบ — ของเดิมตั้งใจตัดแถวแบบนี้ออกจากผลต่าง */
    writeScan(safeKey('8851111111111'), -6, 'resolve', 'ย้ายไปรวมกับ A1',
              { unknown: true, raw: '8851111111111' });
    return diffPieces();
  });
  check('ยอดดิบ = 100 + 4 - 6 = 98', neg.rawPieces === 98, neg);
  check('หน้าสรุปตัดแถวติดลบออก = 100', neg.summaryActQty === 100, neg);
  check('gap ติดลบ (-2) เพราะตัดของที่ติดลบออก ยอดเลยสูงขึ้น', neg.gap === -2, neg);
  check('ชี้เหตุผลว่า unknown-net<=0',
        neg.byWhy['unknown-net<=0'] && neg.byWhy['unknown-net<=0'].pieces === -2, neg.byWhy);

  /* ---------- [5] gap ต้องอธิบายได้ครบเสมอ ---------- */
  console.log('\n[5] gap ต้องเท่ากับผลรวมของแถวที่ถูกตัดเสมอ');
  const mix = await page.evaluate(() => {
    window.__base();
    writeScan('A1', 100, 'scan');
    writeScan('A2', 40, 'scan');
    writeScan('A3', 7, 'scan');
    writeScan('A3', -7, 'scan', 'ยิงหลุด');                 /* แถวผี */
    for (var i = 0; i < 13; i++) writeUnknownScan('8850999999999');
    writeScan(safeKey('8850999999999'), 0, 'resolve', 'ลบทิ้ง',
              { unknown: true, raw: '8850999999999', discard: true });
    for (var j = 0; j < 4; j++) writeUnknownScan('8851111111111');
    writeScan(safeKey('8851111111111'), -6, 'resolve', 'ย้าย',
              { unknown: true, raw: '8851111111111' });
    const d = diffPieces();
    const sumDropped = d.droppedWithQty.reduce(function (s, r) { return s + r.act; }, 0);
    return { d: d, sumDropped: sumDropped };
  });
  check('gap = ผลรวมแถวที่ถูกตัด', mix.d.gap === mix.sumDropped, mix);
  check('ยอดดิบ + หน้าสรุป สอดคล้องกัน',
        mix.d.rawPieces - mix.d.gap === mix.d.summaryActQty, mix.d);
  check('แยกเหตุผลได้ทั้งสองแบบ',
        !!mix.d.byWhy['unknown-discarded'] && !!mix.d.byWhy['unknown-net<=0'], mix.d.byWhy);
  check('รายงาน roundId ของรอบที่กำลังดูอยู่', mix.d.roundId === 'R1', mix.d.roundId);

  /* ---------- [7] อ่านอย่างเดียว ---------- */
  console.log('\n[7] เครื่องมือนี้ต้องไม่เขียนอะไรลงฐาน');
  const ro = await page.evaluate(() => {
    window.__base();
    writeScan('A1', 5, 'scan');
    const before = window.__writes.length;
    diffPieces(); diffPieces(); diffPieces();
    return { before: before, after: window.__writes.length };
  });
  check('เรียกซ้ำ 3 ครั้งไม่เขียนเพิ่มเลย', ro.after === ro.before, ro);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
