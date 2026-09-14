/* ============================================================
   ยอดสรุปของรอบ (scoreboard) — Phase 1 · v2.10.0
   ============================================================

   Phase 1 = "เขียนคู่ + ตรวจ" ยังไม่เปลี่ยนสิ่งที่จออ่าน
   เทสนี้จึงมีหน้าที่เดียว: พิสูจน์ว่ายอดสรุปตรงกับการนับสดเป๊ะ ๆ ทุกกรณี
   ถ้าข้อไหนตกแปลว่า "ห้ามไป Phase 2" ยังไม่ใช่แค่บั๊กเล็ก ๆ

   กันอะไร:
   ⭐ v2.10.4 — นิยาม pieces/skus เปลี่ยนจาก "ผลรวมดิบ" เป็น "เลขสะอาด"
      ผ่าน countsAsRealRow() ตัวเดียวกับ summaryData/เอกสาร/Excel
      รอบที่ไม่มีบาร์โค้ดผี ตัวเลขต้องไม่เปลี่ยนเลยแม้แต่ชิ้นเดียว

   [1] นิยามตรงกับ computeJobStats() ที่จอใช้อยู่ (pieces/skus/lastAt)
   [2] ยอดในเครื่อง (bumpLocalStat ทีละแถว) == คำนวณใหม่จากศูนย์ (statFromScans)
       ครบทุกเคส: ยิงซ้ำ · ติดลบ · หักจนเหลือ 0 · แถวหมายเหตุ delta 0 · ghost 0/0
   [3] ทุก write path ของแอปอัปเดตยอดสรุป (ยิงสด · กรอกมือ · นำเข้าไฟล์ · ยกเลิกยิง ·
       หมายเหตุ · ย้าย/ลบบาร์โค้ดที่ไม่มีในระบบ) — hook ที่ writeScan() ที่เดียวต้องครบ
   [4] เขียนขึ้นฐานเป็น "ค่าสัมบูรณ์" ไม่ใช่สั่งบวกเพิ่ม (สองคนยิงพร้อมกันแล้วลู่เข้าหาค่าที่ถูก)
   [5] แถว scan กับแถว stat แยกคิวกัน — Rules ยังไม่วางก็ต้องยิงได้ตามปกติ
   [6] rebuildStat / validateStat ให้ผลตรงกับการนับสดเดิม
   [7] เปลี่ยนรอบแล้วยอดสรุปต้องไม่ติดค้างมาจากใบเดิม
   [8] Phase 1 ห้ามเปลี่ยนสิ่งที่จออ่าน — ทุกหน้ายังนับสดเหมือนเดิม
   [9] สองคนยิงพร้อมกัน — ค่าบนฐานเพี้ยนได้ชั่วคราว แต่ลู่เข้าหาค่าจริงเมื่อมีคนยิงต่อ
   [10] ⭐ ตรึงยอดก่อนพ้นขั้นนับ (ทางแก้ (ข) rebuild-on-close) — ข้อที่ห้ามพลาดที่สุด
        ลำดับต้องเป็น "เขียน stat ให้เสร็จ → ค่อยพลิกสถานะ" เท่านั้น
        สลับลำดับเมื่อไหร่ = Rules ปฏิเสธ = เลขปิดที่ถูกไม่ถูกบันทึก
   [11] validateAllStats ต้องอ่านทีละรอบ ห้ามยิงพร้อมกันจนคิว bgSlot ตัน
        รอบไหนไม่จบใน 35 วิ ตัดทิ้งไปรอบถัดไป ห้ามแขวนทั้งชุด · คืนผลครบทุกรอบเสมอ
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__writes = [];
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  /* ดักที่ enqueueWrite — เป็นประตูเดียวที่ทุก write ของรอบวิ่งผ่าน */
  window.__realEnqueue = window.enqueueWrite;
  window.enqueueWrite = function (path, patch) {
    window.__writes.push({ path: path, patch: patch });
  };
  window.db.update = function (path, patch) {
    window.__writes.push({ path: path, patch: patch, direct: true });
    return Promise.resolve();
  };
  window.session.token = function () { return 'tok'; };
  hideLogin();

  var idN = 0;
  window.db.newKey = function () { return 'k' + (++idN); };

  window.__seed = function (role) {
    state.me = { uid: 'u1', email: 'x@y.z', name: 'สมชาย', role: role || 'admin', branches: [] };
    state.counter = 'สมชาย';
    state.roundId = 'R1';
    state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = {
      A1: { code: 'A1', name: 'สินค้า A1', type: 'product', costPrice: 10, sellPrice: 20 },
      A2: { code: 'A2', name: 'สินค้า A2', type: 'product', costPrice: 10, sellPrice: 20 },
      A3: { code: 'A3', name: 'สินค้า A3', type: 'product', costPrice: 10, sellPrice: 20 }
    };
    state.systemQty = { A1: 5, A2: 0, A3: 0 };
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline'; state.locationFilter = '';
    resetRoundAggregates();
    window.__writes = []; window.__toasts = [];
  };

  /* เอาแถว scan ที่ถูกเขียนทั้งหมดมาประกอบเป็นก้อน scans เหมือนที่อยู่บนฐานจริง */
  window.__scanBlob = function () {
    var blob = {};
    window.__writes.forEach(function (w) {
      Object.keys(w.patch || {}).forEach(function (k) {
        var m = /^scans\\/(.+)$/.exec(k);
        if (m) blob[m[1]] = w.patch[k];
      });
    });
    return blob;
  };
  /* ก้อน stat ล่าสุดที่ถูกเขียนขึ้นฐาน */
  window.__lastStat = function () {
    var out = null;
    window.__writes.forEach(function (w) {
      if (!w.patch || w.patch['stat/pieces'] === undefined) return;
      out = {
        pieces: w.patch['stat/pieces'], skus: w.patch['stat/skus'],
        lastAt: w.patch['stat/lastAt'], lastBy: w.patch['stat/lastBy'],
        ver: w.patch['stat/ver']
      };
    });
    return out;
  };
  window.__statWrites = function () {
    return window.__writes.filter(function (w) {
      return w.patch && w.patch['stat/pieces'] !== undefined;
    });
  };
  window.__scanWrites = function () {
    return window.__writes.filter(function (w) {
      return w.patch && Object.keys(w.patch).some(function (k) { return /^scans\\//.test(k); });
    });
  };
  /* เทียบสามทาง: ยอดในเครื่อง · คำนวณใหม่จากศูนย์ · การนับสดแบบเดิมที่จอใช้ */
  window.__compare = function () {
    var blob = window.__scanBlob();
    var built = statFromScans(blob);
    var live = computeJobStats(blob);
    return {
      local: { pieces: currentStat().pieces, skus: currentStat().skus,
               lastAt: currentStat().lastAt, lastBy: currentStat().lastBy },
      built: { pieces: built.pieces, skus: built.skus, lastAt: built.lastAt, lastBy: built.lastBy },
      live: { pieces: live.pieces, skus: live.skuScanned, lastAt: live.lastTs },
      records: Object.keys(blob).length
    };
  };
  /* ดักลำดับ "ใครถูกเขียนก่อนหลัง" และ "ตอนนั้นสถานะรอบเป็นอะไร"
     สถานะ ณ วินาทีที่เขียนคือตัวชี้ขาดว่า Rules จะยอมหรือปฏิเสธ */
  window.__installOrder = function () {
    window.__order = [];
    window.__scansOnDb = {};
    window.db.getQuiet = function (p) {
      if (/\\/scans$/.test(p)) return Promise.resolve(window.__scansOnDb);
      return Promise.resolve({});
    };
    window.db.update = function (path, patch) {
      var keys = Object.keys(patch || {});
      var isStat = keys.some(function (k) { return /^(stat|skuQty)\\//.test(k); });
      var isStatus = patch && patch.status !== undefined;
      window.__order.push({
        kind: isStat ? 'stat' : (isStatus ? 'status' : 'other'),
        path: path,
        statusNow: (state.roundIndex.R1 || {}).status,
        to: isStatus ? patch.status : null,
        pieces: patch['stat/pieces'], skus: patch['stat/skus'], builtAt: patch['stat/builtAt']
      });
      return Promise.resolve();
    };
    window.syncCycleStatus = function () { return Promise.resolve(); };
  };
  window.__statOrder = function () {
    return window.__order.filter(function (o) { return o.kind === 'stat'; });
  };
  window.__same = function (c) {
    return c.local.pieces === c.built.pieces && c.built.pieces === c.live.pieces &&
           c.local.skus === c.built.skus && c.built.skus === c.live.skus &&
           c.local.lastAt === c.built.lastAt && c.built.lastAt === c.live.lastAt;
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

  /* ---------- [1] นิยามต้องยืมของเดิมมา ไม่ใช่เขียนใหม่ ---------- */
  console.log('\n[1] statFromScans ต้องได้เลขเดียวกับ computeJobStats เสมอ');
  const defs = await page.evaluate(() => {
    window.__seed('admin');                 /* A1·A2·A3 อยู่ใน Master · sys A1=5 */
    const blob = {
      s1: { code: 'A1', delta: 3, ts: 100, user: 'สมชาย' },
      s2: { code: 'A1', delta: -3, ts: 200, user: 'สมศรี' },   /* หักจนเหลือ 0 แต่มี sys=5 */
      s3: { code: 'A2', delta: 4, ts: 150, user: 'สมชาย' },
      s4: { code: 'A3', delta: 0, ts: 300, user: 'สมปอง' },    /* แถวหมายเหตุ */
      s5: { code: 'A2', delta: -6, ts: 250, user: 'สมศรี' }    /* ติดลบสุทธิ แต่อยู่ใน Master */
    };
    const built = statFromScans(blob, state.systemQty);
    const live = computeJobStats(blob, state.systemQty);
    return { built: built, live: live };
  });
  check('pieces ตรงกัน', defs.built.pieces === defs.live.pieces, defs);
  /* A1 สุทธิ 0 แต่มียอดระบบ 5 → เป็นแถวจริง นับ 0 ชิ้น · A2 สุทธิ -2 อยู่ใน Master → นับ
     A3 สุทธิ 0 และยอดระบบ 0 → แถวผี ตัดทิ้ง */
  check('pieces = เฉพาะแถวจริง (0 + -2 = -2)', defs.built.pieces === -2, defs.built.pieces);
  check('skus ตรงกัน', defs.built.skus === defs.live.skuScanned, defs);
  check('นับเฉพาะแถวจริงที่ยอดไม่เป็น 0 (A2 ตัวเดียว = 1)',
        defs.built.skus === 1, { skus: defs.built.skus, counts: defs.live.counts });
  check('lastAt ตรงกัน และนับแถวหมายเหตุ delta 0 ด้วย (= 300)',
        defs.built.lastAt === defs.live.lastTs && defs.built.lastAt === 300, defs.built.lastAt);
  check('lastBy = คนของแถวล่าสุด', defs.built.lastBy === 'สมปอง', defs.built.lastBy);
  check('ติดธงเวอร์ชันไว้ (ขึ้นเป็น 2 เพราะนิยามเปลี่ยน)', defs.built.ver === 2, defs.built.ver);

  console.log('\n[1b] ⭐ บาร์โค้ดผีที่แอดมินสั่งลบทิ้ง ต้องหลุดออกจากยอดทุกทาง');
  const ghostDrop = await page.evaluate(() => {
    window.__seed('admin');
    const blob = {
      g1: { code: 'A1', delta: 3078, ts: 10, user: 'ก' },
      /* ผี 13 ตัว ตัวละ -1 แบบเคสจริง WHS19 — ยิงเจอแล้วถูกสั่งลบทิ้ง */
      g2: { code: 'BAD', delta: -13, ts: 20, user: 'ก', unknown: true, raw: 'BAD', discard: true }
    };
    const built = statFromScans(blob, state.systemQty);
    const rawSum = Object.keys(blob).reduce(function (s, k) { return s + blob[k].delta; }, 0);
    return { built: built, rawSum: rawSum };
  });
  check('ผลรวมดิบคือ 3,065 (แบบที่การ์ดเคยโชว์)', ghostDrop.rawSum === 3065, ghostDrop.rawSum);
  check('⭐ เลขสะอาดคือ 3,078 (แบบที่เอกสาร/Excel โชว์)',
        ghostDrop.built.pieces === 3078, ghostDrop.built);
  check('ผีไม่ถูกนับเป็น SKU ด้วย', ghostDrop.built.skus === 1, ghostDrop.built);

  /* ---------- [2] ยอดในเครื่องต้องเท่ากับคำนวณใหม่ทุกจังหวะ ---------- */
  console.log('\n[2] ยิงทีละแถว — ยอดในเครื่องต้องไม่หลุดจากการนับสดเลยสักก้าว');
  const steps = await page.evaluate(() => {
    window.__seed('admin');
    const out = [];
    const step = (label, fn) => { fn(); const c = window.__compare(); out.push({ label, c, same: window.__same(c) }); };
    step('ยิง A1 ครั้งแรก', () => writeScan('A1', 1, 'scan'));
    step('ยิง A1 ซ้ำ', () => writeScan('A1', 1, 'scan'));
    step('ยิง A2', () => writeScan('A2', 5, 'scan'));
    step('หมายเหตุ A3 (delta 0)', () => writeScan('A3', 0, 'remark', 'ของโชว์'));
    step('ยกเลิกการยิง A1 (-1)', () => writeScan('A1', -1, 'scan', 'ยกเลิก'));
    step('หัก A1 จนเหลือ 0', () => writeScan('A1', -1, 'scan', 'ยกเลิก'));
    step('ยิง A1 ใหม่หลังเหลือ 0', () => writeScan('A1', 2, 'scan'));
    step('กรอกมือ A2 ติดลบ', () => writeScan('A2', -9, 'manual', 'นับเกิน'));
    return out;
  });
  steps.forEach(s => {
    check(s.label + ' → สามทางตรงกัน', s.same === true, s.c);
  });
  const last = steps[steps.length - 1].c;
  check('ยอดสุดท้าย pieces ถูก (1+1+5+0-1-1+2-9 = -2)', last.local.pieces === -2, last.local);
  check('ยอดสุดท้าย skus ถูก (A1=2 · A2=-4 · A3=0 → 2 ตัว)', last.local.skus === 2, last.local);

  /* ---------- [2b] เคสแถวผี 0/0 ---------- */
  console.log('\n[2b] แถวผี 0/0 — ยิงแล้วหักคืนจนเหลือ 0 ต้องไม่ค้างอยู่ในจำนวน SKU');
  const ghost = await page.evaluate(() => {
    window.__seed('admin');
    writeScan('A3', 2, 'scan');
    const mid = window.__compare();
    writeScan('A3', -2, 'scan', 'ยิงหลุด');
    const end = window.__compare();
    return { mid: mid, end: end, sameMid: window.__same(mid), sameEnd: window.__same(end) };
  });
  check('ระหว่างทางยังนับเป็น 1 SKU', ghost.mid.local.skus === 1 && ghost.sameMid, ghost.mid);
  check('หักคืนจนเหลือ 0 แล้ว SKU กลับเป็น 0', ghost.end.local.skus === 0, ghost.end);
  check('แต่ lastAt ยังเดินหน้า (แถวยังอยู่ในประวัติ)', ghost.end.local.lastAt > 0, ghost.end);
  check('สามทางยังตรงกัน', ghost.sameEnd === true, ghost.end);

  /* ---------- [3] ทุก write path ---------- */
  console.log('\n[3] ทุกทางที่เขียน scan ต้องอัปเดตยอดสรุปด้วย');
  const paths = await page.evaluate(() => {
    const out = {};
    const run = (name, fn) => {
      window.__seed('admin');
      fn();
      const c = window.__compare();
      out[name] = { statWrites: window.__statWrites().length,
                    scanWrites: window.__scanWrites().length,
                    same: window.__same(c), pieces: c.local.pieces };
    };
    run('ยิงสด', () => writeScan('A1', 1, 'scan'));
    run('กรอกมือ', () => writeScan('A1', 7, 'manual', 'ป้ายขาด'));
    run('นำเข้าไฟล์', () => { writeScan('A1', 3, 'scan', 'นำเข้าไฟล์'); writeScan('A2', 4, 'scan', 'นำเข้าไฟล์'); });
    run('ยกเลิกการยิงล่าสุด', () => { writeScan('A1', 1, 'scan'); writeScan('A1', -1, 'scan', 'ยกเลิกการยิงล่าสุด'); });
    run('หมายเหตุ', () => writeScan('A1', 0, 'remark', 'ของโชว์ห้ามนับ'));
    run('บาร์โค้ดไม่มีในระบบ', () => writeUnknownScan('8850999999999'));
    run('โน้ตของบาร์โค้ดไม่มีในระบบ', () => writeUnknownNote('8850999999999', 'อยู่หลังเคาน์เตอร์'));
    run('ย้ายไปผูกสินค้าอื่น', () => {
      writeUnknownScan('8850999999999');
      writeScan(safeKey('8850999999999'), -1, 'resolve', 'ย้ายไปรวมกับ A1', { unknown: true, raw: '8850999999999' });
      writeScan('A1', 1, 'resolve', 'ย้ายมาจากบาร์โค้ด 8850999999999');
    });
    run('ลบบาร์โค้ดทิ้ง', () => {
      writeUnknownScan('8850999999999');
      writeScan(safeKey('8850999999999'), -1, 'resolve', 'ลบทิ้ง (ยิงหลุด)', { unknown: true, raw: '8850999999999', discard: true });
    });
    return out;
  });
  Object.keys(paths).forEach(k => {
    const p = paths[k];
    check(k + ' → เขียน stat ครบทุกแถว scan', p.statWrites === p.scanWrites && p.statWrites > 0, { k, p });
    check(k + ' → ยอดยังตรงกันสามทาง', p.same === true, { k, p });
  });

  /* ---------- [4] เขียนเป็นค่าสัมบูรณ์ ---------- */
  console.log('\n[4] ต้องเขียนค่าสัมบูรณ์ ไม่ใช่สั่งบวกเพิ่ม (กันสองคนยิงพร้อมกันแล้วทบผิด)');
  const abs = await page.evaluate(() => {
    window.__seed('admin');
    writeScan('A1', 4, 'scan');
    const first = window.__lastStat();
    writeScan('A1', 3, 'scan');
    const second = window.__lastStat();
    /* จำลองแถวของ "คนอื่น" ที่วิ่งเข้ามาทางสาย SSE แล้วยิงต่อ */
    applyScanRecord('remote1', { code: 'A2', delta: 10, ts: Date.now() + 1000, user: 'สมศรี', mode: 'scan' });
    writeScan('A1', 1, 'scan');
    const third = window.__lastStat();
    return { first: first, second: second, third: third,
             localPieces: currentStat().pieces, keys: Object.keys(window.__writes[1].patch) };
  });
  check('ค่าที่เขียนเป็นยอดรวมสะสม ไม่ใช่ delta', abs.first.pieces === 4 && abs.second.pieces === 7, abs);
  check('ยอดรวมแถวของคนอื่นที่วิ่งเข้ามาด้วย (7+10+1 = 18)', abs.third.pieces === 18, abs);
  check('ตรงกับยอดในเครื่อง', abs.third.pieces === abs.localPieces, abs);
  check('เขียน skuQty ของ SKU ที่เพิ่งขยับมาด้วย',
        abs.keys.some(k => /^skuQty\//.test(k)), abs.keys);
  check('ติดธงเวอร์ชันไปกับทุกก้อน', abs.third.ver === 2, abs.third);

  /* ---------- [5] แยกคิวจากแถว scan ---------- */
  console.log('\n[5] แถว scan กับแถว stat ต้องแยกคิว (Rules ยังไม่วางก็ต้องยิงได้)');
  const split = await page.evaluate(() => {
    window.__seed('admin');
    writeScan('A1', 1, 'scan');
    const w = window.__writes;
    return {
      count: w.length,
      firstKeys: Object.keys(w[0].patch),
      secondKeys: Object.keys(w[1].patch),
      samePath: w[0].path === w[1].path
    };
  });
  check('ยิงหนึ่งครั้ง = สองคิวแยกกัน', split.count === 2, split);
  check('คิวแรกมีแต่แถว scan', split.firstKeys.every(k => /^scans\//.test(k)), split.firstKeys);
  check('คิวสองมีแต่ยอดสรุป ไม่ปนแถว scan',
        split.secondKeys.every(k => /^(stat|skuQty)\//.test(k)), split.secondKeys);
  check('เขียนลงรอบเดียวกัน', split.samePath === true, split);

  /* ---------- [6] rebuildStat / validateStat ---------- */
  console.log('\n[6] คำนวณใหม่จากศูนย์ + ตัวตรวจ');
  const rb = await page.evaluate(async () => {
    window.__seed('admin');
    writeScan('A1', 6, 'scan');
    writeScan('A2', -2, 'scan');
    writeScan('A3', 0, 'remark', 'โน้ต');
    const blob = window.__scanBlob();
    /* ให้ getQuiet คืนก้อนนี้ แทนการยิงฐานจริง */
    window.db.getQuiet = function () { return Promise.resolve(blob); };

    const built = await rebuildStat('R1');                 // ไม่เขียน
    const wBefore = window.__writes.length;
    const written = await rebuildStat('R1', { write: true });
    const wAfter = window.__writes.length;
    const v = await validateStat('R1', { pieces: built.pieces, skus: built.skus, lastAt: built.lastAt });
    const vBad = await validateStat('R1', { pieces: built.pieces + 5, skus: built.skus, lastAt: built.lastAt });
    const patch = window.__writes[window.__writes.length - 1].patch;
    return { built: built, written: written, wrote: wAfter - wBefore, v: v, vBad: vBad,
             local: { pieces: currentStat().pieces, skus: currentStat().skus, lastAt: currentStat().lastAt },
             patchKeys: Object.keys(patch).sort() };
  });
  check('คำนวณใหม่ได้เลขเดียวกับยอดในเครื่อง',
        rb.built.pieces === rb.local.pieces && rb.built.skus === rb.local.skus &&
        rb.built.lastAt === rb.local.lastAt, rb);
  check('ไม่ใส่ write = ไม่แตะฐานเลย', rb.wrote === 1, rb.wrote);
  check('ใส่ write = เขียนทั้ง stat และ skuQty',
        rb.patchKeys.some(k => k === 'stat/pieces') && rb.patchKeys.some(k => /^skuQty\//.test(k)),
        rb.patchKeys);
  check('ตัวตรวจบอกว่าตรง', rb.v.ok === true && rb.v.diff.length === 0, rb.v);
  check('ตัวตรวจนับจำนวนแถวได้', rb.v.records === 3, rb.v.records);
  check('drift เป็น 0 เมื่อก้อนบนฐานตรงกัน',
        rb.v.drift.pieces === 0 && rb.v.drift.skus === 0, rb.v.drift);
  check('จับ drift ได้เมื่อก้อนบนฐานเพี้ยน', rb.vBad.drift.pieces === 5, rb.vBad.drift);
  check('แต่ ok ยังเป็น true เพราะสูตรสองทางยังตรงกัน', rb.vBad.ok === true, rb.vBad.ok);

  console.log('\n[6b] ไล่ตรวจทุกรอบ');
  const all = await page.evaluate(async () => {
    window.__seed('admin');
    state.roundIndex.R2 = { id: 'R2', name: 'รอบสอง', cycleId: 'C1', status: 'counting', createdAt: 2 };
    const blobs = {
      'rounds/R1/scans': { a: { code: 'A1', delta: 2, ts: 10, user: 'ก' } },
      'rounds/R2/scans': { b: { code: 'A2', delta: 9, ts: 20, user: 'ข' } }
    };
    window.db.getQuiet = function (p) { return Promise.resolve(blobs[p] || {}); };
    return await validateAllStats();
  });
  check('ไล่ครบทุกรอบ', all.length === 2, all);
  check('ทุกรอบผ่าน', all.every(r => r.ok === true), all);
  check('เลขของแต่ละรอบแยกกันถูก',
        all[0].pieces === 2 && all[1].pieces === 9, all);

  /* ---------- [7] เปลี่ยนรอบ ---------- */
  console.log('\n[7] เปลี่ยนรอบแล้วยอดสรุปต้องไม่ติดค้าง');
  const swap = await page.evaluate(() => {
    window.__seed('admin');
    writeScan('A1', 12, 'scan');
    const before = { pieces: currentStat().pieces, skus: currentStat().skus };
    resetRoundAggregates();
    const after = { pieces: currentStat().pieces, skus: currentStat().skus, lastAt: currentStat().lastAt,
                    lastBy: currentStat().lastBy, ver: currentStat().ver };
    return { before: before, after: after };
  });
  check('ก่อนเปลี่ยนมียอดอยู่', swap.before.pieces === 12 && swap.before.skus === 1, swap.before);
  check('เปลี่ยนรอบแล้วล้างเป็นศูนย์หมด',
        swap.after.pieces === 0 && swap.after.skus === 0 && swap.after.lastAt === 0 &&
        swap.after.lastBy === '', swap.after);
  check('ยังติดธงเวอร์ชันไว้ (v2.10.4 = 2)', swap.after.ver === 2, swap.after);

  /* ---------- [8] Phase 1 ห้ามเปลี่ยนสิ่งที่จออ่าน ---------- */
  console.log('\n[8] Phase 1 — จอยังต้องนับสดเหมือนเดิมทุกประการ');
  const untouched = await page.evaluate(() => {
    const src = String(refreshJobStats) + String(loadCycleStats) + String(computeJobStats);
    return {
      jobStatsStillReadsScans: /rounds\/' \+ id \+ '\/scans/.test(String(refreshJobStats)),
      noStatInJobStats: !/state\.stat\b/.test(src),
      computeUnchanged: /skuScanned/.test(String(computeJobStats))
    };
  });
  check('การ์ด Job ยังอ่าน scan ก้อนเต็มเหมือนเดิม', untouched.jobStatsStillReadsScans === true, untouched);
  check('ยังไม่มีใครไปอ่าน state.stat มาแสดงผล', untouched.noStatInJobStats === true, untouched);
  check('computeJobStats ไม่ถูกแก้', untouched.computeUnchanged === true, untouched);

  /* ---------- [9] ข้อจำกัดที่รู้ตัว: หลายคนนับพร้อมกัน ---------- */
  console.log('\n[9] สองคนยิงพร้อมกัน — บันทึกพฤติกรรมจริงไว้ก่อนตัดสินใจ Phase 2');
  const race = await page.evaluate(() => {
    /* จำลองสองเครื่อง: เครื่องนี้ (สมชาย) กับอีกเครื่อง (สมศรี)
       แต่ละเครื่องเขียนยอดสรุปจาก "ภาพที่ตัวเองเห็น" ณ ตอนนั้น
       ช่วงที่แถวของอีกฝ่ายยังวิ่งมาไม่ถึง ภาพของทั้งคู่จึงยังไม่ครบ */
    window.__seed('admin');
    writeScan('A1', 1, 'scan');                       // สมชายยิง — เขียน stat = 1
    const mine = window.__lastStat().pieces;

    /* สมศรียิงพร้อมกันอีกเครื่อง ตอนนั้นเครื่องเธอเห็นแค่แถวของตัวเอง จึงเขียน stat = 1 เหมือนกัน */
    const hers = 1;
    const onDb = hers;                                // ใครถึงทีหลังทับ — ค่าบนฐานคือ 1
    const truth = 2;                                  // ความจริงคือ 2 ชิ้น

    /* แถวของสมศรีวิ่งเข้ามาทางสาย SSE */
    applyScanRecord('remote_ss', { code: 'A2', delta: 1, ts: Date.now() + 500, user: 'สมศรี', mode: 'scan' });
    const afterFrame = currentStat().pieces;             // ภาพในเครื่องครบแล้ว
    const dbStillStale = onDb;                        // แต่ยังไม่มีใครเขียนทับให้ถูก

    /* พอมีการยิงครั้งถัดไป ค่าที่เขียนจะเป็นยอดรวมที่ถูกต้อง = ลู่เข้าหาค่าจริง */
    writeScan('A1', 1, 'scan');
    const afterNextWrite = window.__lastStat().pieces;

    return { mine: mine, onDb: onDb, truth: truth, afterFrame: afterFrame,
             dbStillStale: dbStillStale, afterNextWrite: afterNextWrite };
  });
  check('ต่างคนต่างเขียนจากภาพของตัวเอง (คนละ 1)', race.mine === 1 && race.onDb === 1, race);
  check('⚠️ ช่วงที่แถวยังวิ่งมาไม่ถึง ค่าบนฐานต่ำกว่าความจริง',
        race.dbStillStale < race.truth, race);
  check('พอแถวของอีกฝ่ายมาถึง ยอดในเครื่องครบทันที', race.afterFrame === 2, race);
  check('และการยิงครั้งถัดไปเขียนค่าที่ถูกทับลงไป (ลู่เข้าหาค่าจริง)',
        race.afterNextWrite === 3, race);
  check('สรุป: ถูกเสมอเมื่อมีคนยิงต่อ · ค้างเพี้ยนได้เฉพาะ "แถวสุดท้ายของรอบ"',
        race.afterNextWrite === 3 && race.dbStillStale < race.truth, race);

  /* ---------- [10] ตรึงยอดก่อนพ้นขั้นนับ ---------- */
  console.log('\n[10] ตรึงยอดสรุปก่อนพ้นขั้นนับ — ลำดับต้องถูกเป๊ะ');
  const close = await page.evaluate(async () => {
    window.__seed('admin');
    window.__installOrder();
    /* ยิงจริงสองแถว แล้วให้ฐาน "มี" แถวพวกนั้นอยู่ เพื่อให้ rebuild อ่านเจอ */
    writeScan('A1', 4, 'scan');
    writeScan('A2', 3, 'scan');
    window.__scansOnDb = window.__scanBlob();

    await changeJobStatus('reviewing');
    const afterReview = window.__order.slice();

    window.__order = [];
    await changeJobStatus('closed', { closedBy: 'สมชาย', closedAt: Date.now() });
    const afterClose = window.__order.slice();

    return { afterReview: afterReview, afterClose: afterClose,
             localPieces: currentStat().pieces, localSkus: currentStat().skus };
  });
  const rv = close.afterReview;
  check('ออกจากขั้นนับแล้วมีทั้งเขียน stat และพลิกสถานะ', rv.length >= 2, rv);
  check('⭐ เขียน stat "ก่อน" พลิกสถานะ',
        rv[0].kind === 'stat' && rv.some(o => o.kind === 'status'), rv);
  check('⭐ ตอนเขียน stat สถานะยังเป็น counting (Rules จึงยอม)',
        rv[0].statusNow === 'counting', rv[0]);
  check('เลขที่ตรึงไว้ตรงกับยอดในเครื่อง (4+3 = 7 · 2 SKU)',
        rv[0].pieces === 7 && rv[0].skus === 2 &&
        rv[0].pieces === close.localPieces && rv[0].skus === close.localSkus, { rv0: rv[0], close });
  check('ติด builtAt ไว้ด้วย (Phase 2 ใช้เทียบกับ closedAt)', typeof rv[0].builtAt === 'number', rv[0]);

  const cl = close.afterClose;
  check('reviewing → closed ไม่ตรึงซ้ำ (ยอดไม่ขยับมาตั้งแต่ออกจาก counting)',
        cl.every(o => o.kind !== 'stat'), cl);
  check('แต่ยังพลิกสถานะเป็น closed ตามปกติ',
        cl.some(o => o.kind === 'status' && o.to === 'closed'), cl);

  console.log('\n[10b] ปิดรวดเดียวจากขั้นนับ (ไม่ผ่านขั้นตรวจสอบ)');
  const direct = await page.evaluate(async () => {
    window.__seed('admin');
    window.__installOrder();
    writeScan('A1', 9, 'scan');
    window.__scansOnDb = window.__scanBlob();
    await changeJobStatus('closed', { closedBy: 'สมชาย', closedAt: Date.now() });
    return window.__order.slice();
  });
  check('ตรึง stat ก่อน แล้วค่อยพลิกเป็น closed',
        direct[0].kind === 'stat' && direct[0].statusNow === 'counting' &&
        direct.some(o => o.kind === 'status' && o.to === 'closed'), direct);
  check('เลขที่ตรึงถูก (9 ชิ้น · 1 SKU)', direct[0].pieces === 9 && direct[0].skus === 1, direct[0]);

  console.log('\n[10c] เปิดกลับมาแก้แล้วปิดใหม่ — ต้องตรึงใหม่ทุกครั้ง ไม่ใช่แค่ครั้งแรก');
  const reopen = await page.evaluate(async () => {
    window.__seed('admin');
    window.__installOrder();
    writeScan('A1', 5, 'scan');
    window.__scansOnDb = window.__scanBlob();
    await changeJobStatus('closed', { closedBy: 'ก', closedAt: 1 });
    const first = window.__statOrder().map(function (o) { return o.pieces; });

    /* ผู้ดูแลเปิดกลับมาแก้ */
    window.__order = [];
    state.roundIndex.R1.status = 'closed';
    await changeJobStatus('counting', { reopenCount: 1 });
    const onReopen = window.__statOrder().length;

    /* ยิงเพิ่มแล้วปิดใหม่ */
    window.__order = [];
    writeScan('A2', 7, 'scan');
    window.__scansOnDb = window.__scanBlob();
    await changeJobStatus('closed', { closedBy: 'ก', closedAt: 2 });
    const second = window.__statOrder();

    return { first: first, onReopen: onReopen, second: second };
  });
  check('ปิดครั้งแรกตรึงไว้ 5 ชิ้น', reopen.first[0] === 5, reopen.first);
  check('ตอนเปิดกลับมาแก้ไม่ตรึง (ยังนับไม่จบ + Rules ห้ามตอน closed)',
        reopen.onReopen === 0, reopen.onReopen);
  check('⭐ ปิดครั้งที่สองตรึงใหม่ให้ ไม่ใช่ใช้ของเก่า',
        reopen.second.length === 1 && reopen.second[0].pieces === 12, reopen.second);
  check('ตอนตรึงครั้งที่สองสถานะยังเป็น counting',
        reopen.second[0].statusNow === 'counting', reopen.second[0]);

  console.log('\n[10d] ตรึงไม่สำเร็จ (เน็ตสะดุด) ต้องไม่บล็อกการปิดรอบ');
  const failFreeze = await page.evaluate(async () => {
    window.__seed('admin');
    window.__order = [];
    window.db.getQuiet = function () { return Promise.reject(new TypeError('Failed to fetch')); };
    window.db.update = function (path, patch) {
      window.__order.push({ status: patch && patch.status });
      return Promise.resolve();
    };
    window.syncCycleStatus = function () { return Promise.resolve(); };
    writeScan('A1', 2, 'scan');
    let threw = false;
    try { await changeJobStatus('closed', { closedBy: 'ก', closedAt: 9 }); } catch (e) { threw = true; }
    return { threw: threw, order: window.__order, statusNow: state.roundIndex.R1.status };
  });
  check('ไม่โยน error ออกมาใส่คนกำลังปิดรอบ', failFreeze.threw === false, failFreeze);
  check('ยังปิดรอบได้ตามปกติ',
        failFreeze.statusNow === 'closed' &&
        failFreeze.order.some(o => o.status === 'closed'), failFreeze);

  /* ---------- [11] validateAllStats ต้องไม่ถล่มตัวเอง ---------- */
  console.log('\n[11] ไล่ตรวจทุกรอบ — ทีละใบ ไม่แขวน คืนผลครบ');
  const seq = await page.evaluate(async () => {
    window.__seed('admin');
    /* 6 รอบ · แต่ละรอบอ่านช้า 60ms เพื่อให้จับ "ทับเวลากัน" ได้ถ้ามันยิงพร้อมกัน */
    state.roundIndex = {};
    for (var i = 1; i <= 6; i++) {
      state.roundIndex['R' + i] = { id: 'R' + i, name: 'รอบ ' + i, cycleId: 'C1',
                                    status: 'counting', createdAt: i };
    }
    var inFlight = 0, peak = 0, order = [];
    window.__writes = [];
    window.db.getQuiet = function (p) {
      inFlight++; peak = Math.max(peak, inFlight);
      order.push(p);
      return new Promise(function (res) {
        setTimeout(function () { inFlight--; res({ s1: { code: 'A1', delta: 2, ts: 10, user: 'ก' } }); }, 60);
      });
    };
    var rows = await validateAllStats({ log: false });
    return { rows: rows, peak: peak, reads: order.length, writes: window.__writes.length };
  });
  check('⭐ อ่านทีละรอบจริง — ไม่มีจังหวะไหนที่มีสองคำขอบินพร้อมกัน', seq.peak === 1, seq.peak);
  check('ครบทุกรอบ 6 ใบ', seq.rows.length === 6, seq.rows.length);
  check('ทุกใบผ่านและติดเหตุผลว่า ok', seq.rows.every(r => r.ok === true && r.reason === 'ok'), seq.rows);
  /* 6 Job อยู่รอบเดียวกัน → ยอดระบบอ่านครั้งเดียว + scans อีกใบละครั้ง = 7
     ถ้าเลขนี้กลายเป็น 12 แปลว่าแคชยอดระบบพัง กลับไปอ่านซ้ำทุกใบแล้ว */
  check('อ่านฐานเท่าที่จำเป็น: ยอดระบบรอบละครั้ง + scans ใบละครั้ง', seq.reads === 7, seq.reads);
  check('อ่านอย่างเดียว ไม่เขียนอะไรลงฐานเลย', seq.writes === 0, seq.writes);

  console.log('\n[11b] รอบที่อ่านไม่จบต้องถูกตัด แล้วไปรอบถัดไป ไม่แขวนทั้งชุด');
  const hang = await page.evaluate(async () => {
    window.__seed('admin');
    state.roundIndex = {};
    for (var i = 1; i <= 4; i++) {
      state.roundIndex['R' + i] = { id: 'R' + i, name: 'รอบ ' + i, cycleId: 'C1',
                                    status: 'counting', createdAt: i };
    }
    window.__writes = [];
    window.db.getQuiet = function (p) {
      /* R2 ค้างตลอดกาล (จำลองช่อง bgSlot รั่ว) · R3 อ่านพัง · ที่เหลือปกติ */
      if (/\/R2\//.test(p)) return new Promise(function () {});
      if (/\/R3\//.test(p)) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ s1: { code: 'A1', delta: 5, ts: 10, user: 'ก' } });
    };
    var t0 = Date.now();
    var rows = await validateAllStats({ timeoutMs: 300, log: false });
    return { rows: rows, ms: Date.now() - t0, writes: window.__writes.length };
  });
  check('ไม่แขวน — ชุดเดินจนจบ', Array.isArray(hang.rows) && hang.rows.length === 4, hang.rows);
  check('รอบที่ค้างถูกตัดด้วยเหตุผล read-timeout',
        hang.rows[1].roundId === 'R2' && hang.rows[1].ok === false &&
        hang.rows[1].reason === 'read-timeout', hang.rows[1]);
  check('รอบที่อ่านพังแยกเหตุผลเป็น read-failed',
        hang.rows[2].roundId === 'R3' && hang.rows[2].reason === 'read-failed', hang.rows[2]);
  check('รอบที่ดีก่อนและหลังยังผ่านปกติ',
        hang.rows[0].ok === true && hang.rows[3].ok === true, [hang.rows[0], hang.rows[3]]);
  check('เลขของรอบที่ดียังถูก (5 ชิ้น · 1 SKU)',
        hang.rows[0].pieces === 5 && hang.rows[0].skus === 1, hang.rows[0]);
  check('ตัดตามเวลาที่ตั้งไว้จริง ไม่รอจนครบ 35 วิ', hang.ms < 5000, hang.ms);
  check('ยังไม่เขียนอะไรลงฐาน', hang.writes === 0, hang.writes);

  console.log('\n[11c] ไม่มีรอบเลยก็ต้องไม่พัง');
  const empty = await page.evaluate(async () => {
    window.__seed('admin');
    state.roundIndex = {};
    window.db.getQuiet = function () { return Promise.resolve({}); };
    return await validateAllStats({ log: false });
  });
  check('คืนลิสต์ว่าง ไม่โยน error', Array.isArray(empty) && empty.length === 0, empty);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
