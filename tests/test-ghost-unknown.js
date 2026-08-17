/* ============================================================
   v2.6.9 — บาร์โค้ดผี (unknown ที่ยอดสุทธิ ≤ 0) ต้องไม่ไปโผล่ในการ์ด "ขาด"
   ============================================================

   อาการเดิม: บาร์โค้ดที่ไม่มีในระบบ ถูกลบทิ้ง / ผูกไปที่อื่น / หักเบิ้ล
   จนยอดสุทธิเหลือ 0 หรือติดลบ ยังถูกนับเป็นแถวจริงในหน้าสรุป
   ยอดติดลบ (act < sys = 0) เลยกลายเป็น "ขาด" ทั้งที่ไม่เคยมีของอยู่จริง
   ลากทั้งจำนวนชิ้นที่ขาด และ %Success ให้เพี้ยนทั้งใบ
   (เคสจริง: ผี 3 ตัว ทำ 163 → 160 ผลต่าง -3)

   เส้นแบ่งที่ต้องไม่พลาด:
   - ไม่ใช่ของจริง (ไม่มีใน Master) + ยอด ≤ 0  → ตัดทิ้ง
   - ไม่ใช่ของจริง แต่ยอด > 0                  → ยังอยู่ กลุ่ม "เกิน" ตามปกติ
   - ของจริง (มีใน Master) ที่ขาด               → ห้ามโดนตัดเด็ดขาด
   - มียอดระบบ (sys > 0)                       → เป็นแถวจริงเสมอ ห้ามโดนตัด
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
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function () {};
    window.db.update = function () { return Promise.resolve(); };
    window.renderDoc = function () {};
    hideLogin();

    /* พื้นฐานที่ทุกเคสใช้ร่วมกัน — ตัวเลขของแต่ละเคสค่อยทับทีหลัง */
    window.__base = function () {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job';
      state.manualQty = {}; state.scanQty = {}; state.zones = {}; state.transfers = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.products = {}; state.systemQty = {}; state.counts = {};
    };

    /* ย่อ unknownKeys ให้เขียนสั้น — โครงเดียวกับที่ applyScan สร้างจริง */
    window.__unk = function (key, value, qty, discarded) {
      state.unknownKeys[key] = {
        key: key, value: value, qty: qty, firstTs: 100,
        zone: 'A', user: 'สมชาย', note: '', discarded: !!discarded
      };
    };

    /* สรุปกลุ่มให้อ่านง่ายในผลเทส */
    window.__g = function (g) {
      return { sysQty: g.sysQty, actQty: g.actQty, skuTotal: g.skuTotal,
               skuMatch: g.skuMatch, skuShort: g.skuShort, skuOver: g.skuOver,
               pcMatch: g.pcMatch, pcShort: g.pcShort, pcOver: g.pcOver };
    };

    window.__codes = function (rows) { return rows.map(function (r) { return r.key; }).sort(); };
  });

  /* ---------- 1. เคสจริงที่แจ้งมา: ผี 3 ตัว ทำ 163 → 160 ---------- */
  console.log('\n[1] ผี 3 ตัว ต้องไม่ลากยอด 163 ให้เหลือ 160');
  const r1 = await page.evaluate(() => {
    window.__base();
    state.products = {
      K1: { code: 'K1', name: 'ของจริง 1', category: 'ห', type: 'product', costPrice: 10 },
      K2: { code: 'K2', name: 'ของจริง 2', category: 'ห', type: 'product', costPrice: 10 }
    };
    state.systemQty = { K1: 100, K2: 63 };
    state.counts = { K1: 100, K2: 63, G1: -1, G2: 0, G3: -2 };
    window.__unk('G1', '8850000000001', -1);      // หักเบิ้ลจนติดลบ
    window.__unk('G2', '8850000000002', 0);       // ผูกไปสินค้าอื่นจนเหลือ 0
    window.__unk('G3', '8850000000003', -2);      // ลบทิ้งแล้วยังยิงซ้ำ
    const d = summaryData();
    return {
      rows: window.__codes(d.rows),
      total: window.__g(d.groups.total),
      product: window.__g(d.groups.product),
      short: window.__codes(sumCardRows(d, 'short')),
      shortPieces: sumCardPieces(sumCardRows(d, 'short'), 'short'),
      pctPieces: pctPiecesOf(d.groups.total),
      pctSku: pctSkuOf(d.groups.total)
    };
  });
  check('เหลือแต่ของจริง 2 แถว ผีหลุดหมด',
        JSON.stringify(r1.rows) === JSON.stringify(['K1', 'K2']), r1.rows);
  check('ยอดจริงยังเป็น 163 ไม่ถูกลากเหลือ 160',
        r1.total.sysQty === 163 && r1.total.actQty === 163, r1.total);
  check('SKU รวมไม่ถูกนับเกิน (2 ไม่ใช่ 5)', r1.total.skuTotal === 2, r1.total);
  check('ไม่มี SKU ขาด และไม่มีชิ้นที่ขาด',
        r1.total.skuShort === 0 && r1.total.pcShort === 0, r1.total);
  check('การ์ด "ขาด" ว่างเปล่า',
        r1.short.length === 0 && r1.shortPieces === 0, r1);
  check('%Success ชิ้น = 100 (เดิมเพี้ยนเพราะผี)', r1.pctPieces === 100, r1.pctPieces);
  check('%Success SKU = 100 (เดิมเพี้ยนเพราะผี)', r1.pctSku === 100, r1.pctSku);
  check('กลุ่ม Product ก็ไม่ถูกนับผีเข้าไปด้วย',
        r1.product.skuTotal === 2 && r1.product.pcShort === 0, r1.product);

  /* ---------- 2. เส้นแบ่ง: ยอด > 0 ยังอยู่ · ของจริงที่ขาดยังอยู่ ---------- */
  console.log('\n[2] เส้นแบ่ง — ตัดเฉพาะผี ห้ามตัดของจริง');
  const r2 = await page.evaluate(() => {
    window.__base();
    state.products = {
      K1: { code: 'K1', name: 'นับตรง', category: 'ห', type: 'product', costPrice: 10 },
      K3: { code: 'K3', name: 'ของจริงที่ขาด', category: 'ห', type: 'product', costPrice: 10 },
      K5: { code: 'K5', name: 'ของจริงที่เกิน', category: 'ห', type: 'product', costPrice: 10 }
    };
    /* X1 อยู่ในไฟล์ยอดของสาขา แต่ไม่มีใน Master — sys > 0 จึงเป็นแถวจริงเสมอ */
    state.systemQty = { K1: 100, K3: 10, K5: 4, X1: 8 };
    state.counts = { K1: 100, K3: 7, K5: 6, X1: 0, G1: -1, G2: 0, U1: 4, D1: 2 };
    window.__unk('G1', '8850000000001', -1);          // ผี ติดลบ
    window.__unk('G2', '8850000000002', 0);           // ผี ศูนย์
    window.__unk('U1', '8850000000004', 4);           // ไม่มีในระบบ แต่เจอของจริง 4 ชิ้น
    window.__unk('D1', '8850000000005', 2, true);     // สั่งลบทิ้งแล้ว แม้ยอดจะกลับมาเป็นบวก
    const d = summaryData();
    return {
      rows: window.__codes(d.rows),
      total: window.__g(d.groups.total),
      short: window.__codes(sumCardRows(d, 'short')),
      over: window.__codes(sumCardRows(d, 'over')),
      match: window.__codes(sumCardRows(d, 'match')),
      shortPieces: sumCardPieces(sumCardRows(d, 'short'), 'short'),
      overPieces: sumCardPieces(sumCardRows(d, 'over'), 'over')
    };
  });
  check('เหลือ 5 แถว — ผี 2 ตัวกับตัวที่ลบทิ้งหลุดไป',
        JSON.stringify(r2.rows) === JSON.stringify(['K1', 'K3', 'K5', 'U1', 'X1']), r2.rows);
  check('unknown ที่ยอด > 0 ยังอยู่ในกลุ่ม "เกิน" ตามเดิม',
        JSON.stringify(r2.over) === JSON.stringify(['K5', 'U1']), r2.over);
  check('ของจริงที่นับขาดยังนับเป็น "ขาด" ตามเดิม',
        r2.short.indexOf('K3') >= 0, r2.short);
  check('ของที่มียอดระบบแต่ไม่มีใน Master ยังนับเป็น "ขาด" (ไม่โดนตัด)',
        r2.short.indexOf('X1') >= 0, r2.short);
  check('การ์ด "ขาด" มีแค่ 2 ตัวนี้ ไม่มีผีปน',
        JSON.stringify(r2.short) === JSON.stringify(['K3', 'X1']), r2.short);
  check('ตัวที่สั่งลบทิ้งแล้วหลุดทั้งใบ แม้ยอดจะเป็นบวก',
        r2.rows.indexOf('D1') < 0 && r2.over.indexOf('D1') < 0, r2);
  check('กลุ่ม "ตรง" มีแค่ของที่นับตรงจริง',
        JSON.stringify(r2.match) === JSON.stringify(['K1']), r2.match);
  check('ยอดรวมถูกต้อง sys 122 · act 117',
        r2.total.sysQty === 122 && r2.total.actQty === 117, r2.total);
  check('นับ SKU ถูก — ตรง 1 ขาด 2 เกิน 2 รวม 5',
        r2.total.skuTotal === 5 && r2.total.skuMatch === 1 &&
        r2.total.skuShort === 2 && r2.total.skuOver === 2, r2.total);
  check('ชิ้นที่ขาด 11 (K3 3 + X1 8) ไม่มีผีบวกเพิ่ม',
        r2.total.pcShort === 11 && r2.shortPieces === 11, r2);
  check('ชิ้นที่เกิน 6 (K5 2 + U1 4) ยังครบ',
        r2.total.pcOver === 6 && r2.overPieces === 6, r2);

  /* ---------- 3. การ์ดบนหน้าจอจริง ---------- */
  console.log('\n[3] ตัวเลขบนการ์ดในหน้าสรุป');
  const r3 = await page.evaluate(() => {
    window.__base();
    state.products = {
      K1: { code: 'K1', name: 'ของจริง', category: 'ห', type: 'product', costPrice: 10 }
    };
    state.systemQty = { K1: 163 };
    state.counts = { K1: 163, G1: -1, G2: 0, G3: -2 };
    window.__unk('G1', '8850000000001', -1);
    window.__unk('G2', '8850000000002', 0);
    window.__unk('G3', '8850000000003', -2);
    renderSummary();
    return {
      shortNum: $('cardShortNum').textContent,
      shortPc: $('cardShortPc').textContent,
      shortVal: $('cardShortVal').textContent,
      matchNum: $('cardMatchNum').textContent
    };
  });
  check('การ์ด "ขาด" โชว์ 0 SKU', r3.shortNum === '0', r3.shortNum);
  check('การ์ด "ขาด" โชว์ 0 ชิ้น (เดิมโชว์ 3)', r3.shortPc === '0 ชิ้น', r3.shortPc);
  check('มูลค่าผลต่างของการ์ด "ขาด" เป็น 0', /0/.test(r3.shortVal) && !/-/.test(r3.shortVal), r3.shortVal);
  check('การ์ด "ตรง" ยังนับของจริงได้ 1 SKU', r3.matchNum === '1', r3.matchNum);

  /* ---------- 4. หน้ารวมทุก Job ใน cycle (summaryDataFrom) ---------- */
  console.log('\n[4] แท็บรวมทั้ง Cycle — ต้องตัดผีเหมือนกัน');
  const r4 = await page.evaluate(() => {
    window.__base();
    state.products = {
      K1: { code: 'K1', name: 'นับตรง', category: 'ห', type: 'product', costPrice: 10 },
      K3: { code: 'K3', name: 'ของจริงที่ขาด', category: 'ห', type: 'product', costPrice: 10 }
    };
    const sysMap = { K1: 100, K3: 10, X1: 8 };
    const countMap = { K1: 100, K3: 7, X1: 0, G1: -1, G2: 0, U1: 4 };
    const d = summaryDataFrom(sysMap, countMap, {});
    return {
      rows: window.__codes(d.rows),
      total: window.__g(d.groups.total),
      short: window.__codes(sumCardRows(d, 'short')),
      over: window.__codes(sumCardRows(d, 'over')),
      pctPieces: pctPiecesOf(d.groups.total),
      pctSku: pctSkuOf(d.groups.total)
    };
  });
  check('ผีหลุดจากแท็บ Cycle ด้วย',
        JSON.stringify(r4.rows) === JSON.stringify(['K1', 'K3', 'U1', 'X1']), r4.rows);
  check('unknown ที่ยอด > 0 ยังอยู่กลุ่ม "เกิน"',
        JSON.stringify(r4.over) === JSON.stringify(['U1']), r4.over);
  check('ของจริงที่ขาด + ของที่มียอดระบบ ยังนับ "ขาด" ครบ',
        JSON.stringify(r4.short) === JSON.stringify(['K3', 'X1']), r4.short);
  check('ยอดรวม sys 118 · act 111', r4.total.sysQty === 118 && r4.total.actQty === 111, r4.total);
  check('SKU รวม 4 — ตรง 1 ขาด 2 เกิน 1',
        r4.total.skuTotal === 4 && r4.total.skuMatch === 1 &&
        r4.total.skuShort === 2 && r4.total.skuOver === 1, r4.total);
  check('ชิ้นที่ขาด 11 ไม่มีผีบวกเพิ่ม', r4.total.pcShort === 11, r4.total);
  check('%Success คิดจาก 4 SKU ไม่ใช่ 6', r4.pctSku === 25, r4.pctSku);

  /* ---------- 5. ของจริงที่ไม่ได้นับเลย ต้องยังขึ้น "ขาด" ---------- */
  console.log('\n[5] ของจริงที่ยังไม่ได้นับ (act = 0) ห้ามหาย');
  const r5 = await page.evaluate(() => {
    window.__base();
    state.products = {
      K1: { code: 'K1', name: 'ยังไม่ได้นับ', category: 'ห', type: 'product', costPrice: 10 },
      K2: { code: 'K2', name: 'นับแล้ว', category: 'ห', type: 'product', costPrice: 10 }
    };
    state.systemQty = { K1: 20, K2: 5 };
    state.counts = { K2: 5, G1: -1 };
    window.__unk('G1', '8850000000001', -1);
    const d = summaryData();
    const fromCycle = summaryDataFrom({ K1: 20, K2: 5 }, { K2: 5, G1: -1 }, {});
    return {
      short: window.__codes(sumCardRows(d, 'short')),
      pcShort: d.groups.total.pcShort,
      cycleShort: window.__codes(sumCardRows(fromCycle, 'short')),
      cyclePcShort: fromCycle.groups.total.pcShort
    };
  });
  check('ของจริงที่ยังไม่ได้นับยังขึ้นการ์ด "ขาด"',
        JSON.stringify(r5.short) === JSON.stringify(['K1']), r5.short);
  check('ขาด 20 ชิ้นเต็ม ไม่มีผีบวกเพิ่ม', r5.pcShort === 20, r5.pcShort);
  check('แท็บ Cycle ก็เหมือนกัน',
        JSON.stringify(r5.cycleShort) === JSON.stringify(['K1']) && r5.cyclePcShort === 20, r5);

  /* ---------- 6. ของที่ยังไม่ถูกจัดการต้องยังเห็นในรายการ unknown ---------- */
  console.log('\n[6] ตัดออกจากผลต่าง แต่ต้องยังตรวจย้อนหลังได้');
  const r6 = await page.evaluate(() => {
    window.__base();
    state.products = {
      K1: { code: 'K1', name: 'ของจริง', category: 'ห', type: 'product', costPrice: 10 }
    };
    state.systemQty = { K1: 10 };
    state.counts = { K1: 10, G1: -1, U1: 4 };
    window.__unk('G1', '8850000000001', -1);
    window.__unk('U1', '8850000000004', 4);
    const d = summaryData();
    const all = unknownRows(true).map(function (r) { return r.value; }).sort();
    return {
      rows: window.__codes(d.rows),
      unknownAll: all,
      pending: unknownPending()
    };
  });
  check('ผีหลุดจากการคิดผลต่าง',
        JSON.stringify(r6.rows) === JSON.stringify(['K1', 'U1']), r6.rows);
  check('แต่ยังอยู่ครบในรายการบาร์โค้ดที่ไม่มีในระบบ (หลักฐานไม่หาย)',
        r6.unknownAll.length === 2 && r6.unknownAll.indexOf('8850000000001') >= 0, r6.unknownAll);
  check('ตัวที่ยอดยังเหลือเท่านั้นที่ค้างรอจัดการ', r6.pending === 1, r6.pending);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
