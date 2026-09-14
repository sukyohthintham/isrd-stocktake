/* ============================================================
   ยิง 1 ครั้ง = เขียนขึ้นฐานพอดี 1 PATCH + KPI "ค้างส่ง" ต้องสด — v2.10.9
   ============================================================

   หลักฐานหน้างานที่แก้:
     · db.netLog() เห็น PATCH มาเป็นคู่ทุก timestamp ไป rounds/<id> เดียวกัน status 200 ทั้งคู่
       ทั้งที่ตาราง "ยิงไปแล้ว" มีแถวเดียวและยอดนับ +1 ถูกต้อง
     · localStorage 'isrd_write_queue' ว่าง แต่ KPI "ค้างส่ง" บนจอโชว์ 2

   ต้นเหตุ (วัดด้วยการนับ db.update ต่อการยิง 1 ครั้ง ไม่ใช่เดา):
     BUG B — writeScan() เข้าคิว 2 ใบ: แถว scan หนึ่งใบ + ยอดสรุป (stat/skuQty) อีกหนึ่งใบ
             ทั้งคู่ path เดียวกัน จึงกลายเป็น 2 PATCH ต่อการยิงหนึ่งครั้ง
     BUG A — flushQueue() เรียกแค่ renderSyncBar() ไม่ได้วาดแผงสรุปสด
             KPI "ค้างส่ง" อยู่ใน renderLivePanel จึงค้างที่ค่าเดิมทั้งที่คิวเคลียร์แล้ว

   กันอะไร:
   [1] ยิง 1 ครั้ง → เข้าคิว 1 ใบ → PATCH 1 ครั้ง (ต่อ record)
   [2] ยิงรัว ๆ หลายครั้ง → จำนวน PATCH เท่ากับจำนวนการยิงพอดี ไม่ทบ
   [3] flush เสร็จ → คิวว่าง และ KPI "ค้างส่ง" วาดใหม่เป็น 0
   [4] flushQueue ถูกเรียกซ้อน → ห้ามส่ง item เดิมซ้ำ
   [5] ยอดนับและแถว scan ต้องไม่หาย (แก้เรื่องคิว ห้ามกระทบยอด)
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.session.token = function () { return 'tok'; };
  hideLogin();

  /* ดักที่ db.update — ทางออกจริงสู่ Firebase (remoteUpdate → PATCH)
     ปล่อยให้ enqueueWrite/flushQueue ตัวจริงทำงาน จะได้วัดเส้นทางจริงทั้งเส้น */
  window.__updates = [];
  window.__hold = null;                    /* ค้าง PATCH ไว้เพื่อทดสอบการเรียกซ้อน */
  window.db.update = function (path, patch) {
    var rec = { path: path, keys: Object.keys(patch || {}) };
    window.__updates.push(rec);
    if (window.__hold) return new Promise(function (res) { window.__hold.push(res); });
    return Promise.resolve();
  };

  var n = 0;
  window.db.newKey = function () { return 'k' + (++n); };

  window.__seed = function () {
    state.me = { uid: 'u1', name: 'สมชาย', role: 'counter', branches: [] };
    state.counter = 'สมชาย';
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = { A1: { code: 'A1', name: 'สินค้า A1', type: 'product', category: 'หมวด' } };
    state.systemQty = { A1: 10, A2: 5 };
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline'; state.locationFilter = '';
    resetRoundAggregates();
    try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
    window.__updates = []; window.__hold = null; window.__toasts = [];
    showPage('scan');
  };

  window.__scanWrites = function () {
    return window.__updates.filter(function (u) {
      return u.keys.some(function (k) { return /^scans\\//.test(k); });
    });
  };
  window.__statWrites = function () {
    return window.__updates.filter(function (u) {
      return u.keys.some(function (k) { return /^(stat|skuQty)\\//.test(k); });
    });
  };
  /* ค่าที่ KPI "ค้างส่ง" แสดงอยู่บนจอจริง ณ ตอนนี้ */
  window.__pendingOnScreen = function () {
    var out = null;
    document.querySelectorAll('#liveStats .live-cell').forEach(function (d) {
      if (/^ค้างส่ง/.test(d.querySelector('span').textContent)) out = d.querySelector('b').textContent;
    });
    return out;
  };
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  /* แผงสรุปสดเป็นคอลัมน์ฝั่งขวาของเลย์เอาต์ Laptop — จอแคบ renderLivePanel จะ early-return */
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(HARNESS);

  /* ---------- [1] ยิง 1 ครั้ง = 1 PATCH ---------- */
  console.log('\n[1] ⭐ ยิง 1 ครั้ง → เข้าคิว 1 ใบ → PATCH 1 ครั้ง');
  const one = await page.evaluate(async () => {
    window.__seed();
    writeScan('A1', 1, 'scan');
    const queued = pendingCount();
    await new Promise(r => setTimeout(r, 300));
    return { queued: queued, updates: window.__updates.length,
             detail: window.__updates, left: pendingCount(),
             counts: state.counts.A1 };
  });
  check('⭐ เข้าคิวใบเดียว', one.queued === 1, one);
  check('⭐ PATCH ขึ้นฐานครั้งเดียว (เดิมเป็น 2)', one.updates === 1, one.detail);
  check('เป็นแถว scan จริง', one.detail[0].keys.length === 1 && /^scans\//.test(one.detail[0].keys[0]), one.detail);
  check('ไม่มี PATCH ของยอดสรุปตามมาอีกใบ',
        one.detail.every(u => !u.keys.some(k => /^(stat|skuQty)\//.test(k))), one.detail);
  check('คิวระบายหมด', one.left === 0, one.left);
  check('ยอดนับยังถูก (+1)', one.counts === 1, one.counts);

  /* ---------- [2] ยิงรัว ---------- */
  console.log('\n[2] ยิงรัว 10 ครั้ง → PATCH เท่ากับจำนวนการยิงพอดี');
  const many = await page.evaluate(async () => {
    window.__seed();
    for (let i = 0; i < 10; i++) writeScan('A1', 1, 'scan');
    await new Promise(r => setTimeout(r, 600));
    return { updates: window.__updates.length, scans: window.__scanWrites().length,
             stats: window.__statWrites().length, left: pendingCount(),
             counts: state.counts.A1, logRows: state.scanLog.length };
  });
  check('⭐ PATCH = 10 ครั้งพอดี (ไม่ใช่ 20)', many.updates === 10, many);
  check('ทุกใบเป็นแถว scan', many.scans === 10, many);
  check('ไม่มี PATCH ยอดสรุปเลย', many.stats === 0, many);
  check('คิวระบายหมด', many.left === 0, many.left);
  check('ยอดนับครบ 10', many.counts === 10, many.counts);
  check('แถวในตาราง "ยิงไปแล้ว" = 10 แถว ไม่ซ้ำ', many.logRows === 10, many.logRows);

  /* ---------- [3] KPI ค้างส่ง ---------- */
  console.log('\n[3] ⭐ KPI "ค้างส่ง" ต้องสะท้อนคิวจริงหลัง flush');
  const kpi = await page.evaluate(async () => {
    window.__seed();
    /* ค้าง PATCH ไว้ก่อน เพื่อให้คิวยาวจริงแล้ววาดจอ */
    window.__hold = [];
    writeScan('A1', 1, 'scan');
    writeScan('A1', 1, 'scan');
    renderLivePanel();
    const during = { queue: pendingCount(), screen: window.__pendingOnScreen() };

    /* ปล่อยให้ PATCH สำเร็จทีละใบจนหมด */
    const release = function () {
      const fns = window.__hold.slice();
      window.__hold.length = 0;
      fns.forEach(function (f) { f(); });
    };
    for (let i = 0; i < 5; i++) { release(); await new Promise(r => setTimeout(r, 60)); }
    window.__hold = null;
    await new Promise(r => setTimeout(r, 200));

    return { during: during, afterQueue: pendingCount(),
             afterScreen: window.__pendingOnScreen(), updates: window.__updates.length };
  });
  check('ระหว่างค้าง: คิวยาว 2 และจอโชว์ 2', kpi.during.queue === 2 && kpi.during.screen === '2', kpi.during);
  check('flush เสร็จ: คิวว่าง', kpi.afterQueue === 0, kpi.afterQueue);
  check('⭐ flush เสร็จ: จอโชว์ "ค้างส่ง 0" เอง ไม่ต้องรอวาดใหม่',
        kpi.afterScreen === '0', kpi.afterScreen);
  check('ยิง 2 ครั้ง = PATCH 2 ครั้ง', kpi.updates === 2, kpi.updates);

  /* ---------- [4] เรียกซ้อน ---------- */
  console.log('\n[4] ⭐ flushQueue ถูกเรียกซ้อน ต้องไม่ส่ง item เดิมซ้ำ');
  const reent = await page.evaluate(async () => {
    window.__seed();
    window.__hold = [];
    writeScan('A1', 1, 'scan');           // เข้าคิว 1 ใบ · flush เริ่มแล้วค้างอยู่
    const firstCount = window.__updates.length;
    /* กระทุ้งซ้ำ ๆ ระหว่างที่ใบแรกยังไม่ตอบ */
    for (let i = 0; i < 8; i++) flushQueue();
    const duringCount = window.__updates.length;

    const fns = window.__hold.slice();
    window.__hold.length = 0;
    fns.forEach(function (f) { f(); });
    window.__hold = null;
    await new Promise(r => setTimeout(r, 250));

    return { firstCount: firstCount, duringCount: duringCount,
             finalCount: window.__updates.length, left: pendingCount(),
             counts: state.counts.A1 };
  });
  check('ใบแรกถูกส่งไปแล้ว 1 ครั้ง', reent.firstCount === 1, reent);
  check('⭐ กระทุ้งซ้ำ 8 ครั้งระหว่างรอ ไม่ส่งเพิ่มเลย', reent.duringCount === 1, reent);
  check('⭐ จบแล้วยังเป็น 1 PATCH', reent.finalCount === 1, reent);
  check('คิวว่าง ไม่มีของค้าง', reent.left === 0, reent.left);
  check('ยอดนับไม่ซ้ำ (ยัง 1)', reent.counts === 1, reent.counts);

  /* ---------- [5] ทางเขียนอื่นต้องไม่หาย ---------- */
  console.log('\n[5] ทางเขียนอื่นยังทำงานครบ (กรอกมือ / หมายเหตุ / ไม่มีในระบบ)');
  const paths = await page.evaluate(async () => {
    const out = {};
    const run = async function (name, fn) {
      window.__seed();
      fn();
      await new Promise(r => setTimeout(r, 300));
      out[name] = { updates: window.__updates.length, scans: window.__scanWrites().length,
                    left: pendingCount() };
    };
    await run('กรอกมือ', function () { writeScan('A1', 7, 'manual', 'ป้ายขาด'); });
    await run('หมายเหตุ', function () { writeScan('A1', 0, 'remark', 'ของโชว์'); });
    await run('ไม่มีในระบบ', function () { writeUnknownScan('8850999999999'); });
    await run('ยกเลิกการยิง', function () {
      writeScan('A1', 1, 'scan'); writeScan('A1', -1, 'scan', 'ยกเลิกการยิงล่าสุด');
    });
    return out;
  });
  check('กรอกมือ = 1 PATCH', paths['กรอกมือ'].updates === 1 && paths['กรอกมือ'].scans === 1, paths['กรอกมือ']);
  check('หมายเหตุ = 1 PATCH', paths['หมายเหตุ'].updates === 1, paths['หมายเหตุ']);
  check('ไม่มีในระบบ = 1 PATCH', paths['ไม่มีในระบบ'].updates === 1, paths['ไม่มีในระบบ']);
  check('ยกเลิกการยิง (2 แถว) = 2 PATCH', paths['ยกเลิกการยิง'].updates === 2, paths['ยกเลิกการยิง']);
  check('ทุกทางคิวระบายหมด',
        Object.keys(paths).every(k => paths[k].left === 0), paths);

  /* ---------- [6] ยอดสรุปยังถูกตรึงตอนออกจากขั้นนับ ---------- */
  console.log('\n[6] ถอด bumpStat ออกแล้ว แต่ยอดสรุปตอนปิดรอบต้องยังถูกเขียน');
  const freeze = await page.evaluate(async () => {
    window.__seed();
    writeScan('A1', 5, 'scan');
    await new Promise(r => setTimeout(r, 200));
    window.__updates = [];
    window.db.getQuiet = function (p) {
      if (/\/scans$/.test(p)) return Promise.resolve({ s1: { code: 'A1', delta: 5, ts: 1, user: 'ก' } });
      return Promise.resolve({});
    };
    window.syncCycleStatus = function () { return Promise.resolve(); };
    await changeJobStatus('reviewing');
    return { updates: window.__updates, stats: window.__statWrites().length };
  });
  check('⭐ ออกจากขั้นนับแล้วยังเขียนยอดสรุปให้ (freeze-on-close)', freeze.stats === 1, freeze.updates);

  const src = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  check('ไม่มีฟังก์ชัน bumpStat หลงเหลือ',
        /function bumpStat/.test(src) === false, 'bumpStat');
  check('writeScan ไม่เรียกเขียนยอดสรุปแล้ว',
        /bumpStat\(state\.roundId/.test(src) === false, 'call site');
  check('flushQueue วาด KPI ผ่าน syncQueueUi()',
        (src.match(/syncQueueUi\(\);/g) || []).length >= 2, 'syncQueueUi');

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
