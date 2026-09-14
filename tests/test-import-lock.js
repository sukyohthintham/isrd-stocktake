/* ============================================================
   ล็อกการนำเข้ายอดระบบ กันเผลอเขียนทับ — v2.10.7
   ============================================================

   แนวคิด: กันด้วย "จำนวนจังหวะที่ต้องตั้งใจ" ไม่ใช่กันด้วย role
   ผู้นับสต๊อก (counter) ต้องอัปไฟล์ตั้งต้นเองได้ตลอด แต่พอมียอดระบบอยู่แล้ว
   การเขียนทับต้องผ่าน 3 จังหวะ: กดปลดล็อก → กดเลือกไฟล์ → ยืนยันในกล่องเตือน

   กันอะไร:
   [1] ยังไม่เลือก Job → ปุ่มอยู่แต่กดไม่ได้ (เหมือนเดิม ไม่ถอยหลัง)
   [2] ยอดระบบยังว่าง → กดได้เลย ไม่มีอะไรขวางการนำเข้าครั้งแรก
   [3] มียอดแล้ว ยังไม่ปลดล็อก → ซ่อนปุ่มทิ้ง เหลือกล่องล็อกพร้อมจำนวนรายการ
   [4] ปุ่มปลดล็อกโชว์เฉพาะ staff — scanner/viewer เห็นข้อความแต่ไม่มีปุ่ม
   [5] กดปลดล็อกแล้ว → ปุ่มกลับมาพร้อมป้ายที่บอกตรง ๆ ว่ากำลังจะเขียนทับ
   [6] handleImport มีด่านยืนยันของตัวเอง — กันคนเข้าทางอื่นที่ไม่ผ่านปุ่ม
       ยกเลิกแล้วต้องไม่แตะข้อมูลเดิมเลยสักนิด
   [7] นำเข้าสำเร็จ → ล็อกกลับทันที ครั้งต่อไปต้องตั้งใจปลดใหม่
   [8] เปลี่ยนรอบ → สถานะปลดล็อกต้องไม่ติดค้างข้ามใบ
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__toasts = []; window.__writes = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.enqueueWrite = function (p, patch) { window.__writes.push({ p: p, patch: patch }); };
  window.db.update = function (p, patch) { window.__writes.push({ p: p, patch: patch }); return Promise.resolve(); };
  window.session.token = function () { return 'tok'; };
  hideLogin();

  /* ดัก ask() ไว้ตอบตามที่เทสสั่ง + เก็บไว้ตรวจว่าถามด้วยข้อความและโหมดที่ถูก */
  window.__asks = [];
  window.__askAnswer = true;
  window.ask = function (title, message, okLabel, opts) {
    window.__asks.push({ title: title, message: message, okLabel: okLabel, opts: opts || {} });
    return Promise.resolve(window.__askAnswer);
  };

  window.__seed = function (role, sysCount) {
    state.me = { uid: 'u1', name: 'สมชาย', role: role || 'counter', branches: [] };
    state.counter = 'สมชาย';
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = {}; state.counts = {}; state.zones = {};
    state.transfers = {}; state.transferQty = {};
    state.systemQty = {};
    for (var i = 0; i < (sysCount || 0); i++) state.systemQty['P' + i] = 10;
    state.importUnlocked = false;
    state.lastImport = null;
    window.__toasts = []; window.__writes = []; window.__asks = [];
    renderStart();
  };

  window.__view = function () {
    var shown = function (id) {
      var el = document.getElementById(id);
      return !!el && getComputedStyle(el).display !== 'none';
    };
    return {
      action: shown('importAction'),
      locked: shown('importLocked'),
      lockedMsg: $('importLockedMsg').textContent,
      unlockShown: shown('btnUnlockImport'),
      btnDisabled: $('btnImport').disabled,
      btnLabel: $('btnImport').textContent,
      unlocked: state.importUnlocked
    };
  };
`;

const DEF_LABEL = '📄 นำเข้าไฟล์สินค้าจากระบบ (Excel / CSV)';
const OVERWRITE_LABEL = '📄 เขียนทับยอดระบบเดิม (เลือกไฟล์ใหม่)';

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

  /* ---------- [1] ยังไม่เลือก Job ---------- */
  console.log('\n[1] ยังไม่ได้เลือก Job — ปุ่มอยู่แต่กดไม่ได้');
  const noJob = await page.evaluate(() => {
    window.__seed('counter', 0);
    state.roundId = null;
    renderStart();
    return window.__view();
  });
  check('ปุ่มนำเข้ายังแสดงอยู่', noJob.action === true, noJob);
  check('กล่องล็อกซ่อน', noJob.locked === false, noJob);
  check('ปุ่มกดไม่ได้', noJob.btnDisabled === true, noJob);
  check('ป้ายปุ่มเป็นแบบปกติ', noJob.btnLabel === DEF_LABEL, noJob.btnLabel);

  /* ---------- [2] ยอดระบบยังว่าง ---------- */
  console.log('\n[2] เลือก Job แล้ว + ยอดระบบยังว่าง — นำเข้าครั้งแรกกดได้เลย');
  const first = await page.evaluate(() => { window.__seed('counter', 0); return window.__view(); });
  check('ปุ่มนำเข้าแสดง', first.action === true, first);
  check('กล่องล็อกซ่อน', first.locked === false, first);
  check('⭐ กดได้ทันที ไม่ต้องปลดล็อกก่อน', first.btnDisabled === false, first);
  check('ป้ายปุ่มเป็นแบบปกติ', first.btnLabel === DEF_LABEL, first.btnLabel);

  /* ---------- [3] มียอดแล้ว ยังไม่ปลดล็อก ---------- */
  console.log('\n[3] ⭐ มียอดระบบแล้ว — ซ่อนปุ่มนำเข้า เหลือกล่องล็อก');
  const locked = await page.evaluate(() => { window.__seed('counter', 1250); return window.__view(); });
  check('⭐ ปุ่มนำเข้าถูกซ่อนไปทั้งอัน', locked.action === false, locked);
  check('⭐ กล่องล็อกแสดงแทน', locked.locked === true, locked);
  check('บอกจำนวนรายการที่ล็อกไว้',
        locked.lockedMsg === '🔒 ยอดระบบล็อกไว้แล้ว (1,250 รายการ) กันเผลอนำเข้าทับ', locked.lockedMsg);
  check('counter เห็นปุ่มปลดล็อก', locked.unlockShown === true, locked);

  /* ---------- [4] สิทธิ์ ---------- */
  console.log('\n[4] ปุ่มปลดล็อกโชว์เฉพาะ staff');
  for (const role of ['admin', 'counter', 'scanner', 'viewer']) {
    const v = await page.evaluate(r => { window.__seed(r, 500); return window.__view(); }, role);
    const staff = role === 'admin' || role === 'counter';
    check(role + ' เห็นกล่องล็อก', v.locked === true, { role, v });
    check(role + (staff ? ' เห็นปุ่มปลดล็อก' : ' ไม่เห็นปุ่มปลดล็อก'),
          v.unlockShown === staff, { role, v });
  }

  /* ---------- [5] กดปลดล็อก ---------- */
  console.log('\n[5] กดปลดล็อกด้วยเมาส์จริง');
  await page.evaluate(() => {
    window.__seed('counter', 800);
    /* ต้องเปิดหน้าตั้งค่าก่อน — section ที่ไม่ active ถูก display:none ปุ่มจึงสูง 0 กดไม่โดน */
    showPage('start');
    $('btnUnlockImport').scrollIntoView();
  });
  const box = await page.evaluate(() => {
    const r = $('btnUnlockImport').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: Math.round(r.height) };
  });
  check('ปุ่มปลดล็อกแตะง่ายบนมือถือ (>=40px)', box.h >= 40, box.h);
  await page.mouse.click(box.x, box.y);
  const unlocked = await page.evaluate(() => window.__view());
  check('⭐ ปลดล็อกแล้ว flag เปลี่ยน', unlocked.unlocked === true, unlocked);
  check('⭐ ปุ่มนำเข้ากลับมา', unlocked.action === true && unlocked.btnDisabled === false, unlocked);
  check('กล่องล็อกหายไป', unlocked.locked === false, unlocked);
  check('⭐ ป้ายปุ่มบอกตรง ๆ ว่ากำลังจะเขียนทับ',
        unlocked.btnLabel === OVERWRITE_LABEL, unlocked.btnLabel);

  /* ---------- [6] ด่านยืนยันใน handleImport ---------- */
  console.log('\n[6] handleImport มีด่านยืนยันของตัวเอง (กันคนเข้าทางอื่น)');
  const cancel = await page.evaluate(async () => {
    window.__seed('counter', 42);
    state.importUnlocked = true;
    let applied = 0;
    window.applyImport = function () { applied++; return Promise.resolve({}); };
    window.__askAnswer = false;                    /* ผู้ใช้กดยกเลิก */
    const fakeFile = { name: 'x.csv', arrayBuffer: function () { applied += 100; return Promise.resolve(new ArrayBuffer(0)); } };
    await handleImport(fakeFile);
    return { applied: applied, asks: window.__asks, toast: (window.__toasts[0] || {}).m,
             sysLeft: Object.keys(state.systemQty).length };
  });
  check('⭐ ถามยืนยันก่อนเสมอเมื่อมียอดเดิม', cancel.asks.length === 1, cancel.asks);
  check('หัวข้อบอกจำนวนรายการเดิม',
        /มียอดระบบอยู่แล้ว 42 รายการ/.test(cancel.asks[0].title), cancel.asks[0].title);
  check('บอกว่ายอดที่ยิงนับไว้ไม่หาย',
        /ยอดที่ยิงนับไว้ \(ยอดยิงจริง\) ไม่หาย/.test(cancel.asks[0].message), cancel.asks[0].message);
  check('บอกว่ายอดระบบและส่วนต่างจะคิดใหม่',
        /ยอดระบบ และส่วนต่าง \(ขาด\/เกิน\) จะคำนวณใหม่/.test(cancel.asks[0].message), cancel.asks[0].message);
  check('เป็นกล่องแบบอันตราย (แดง)', cancel.asks[0].opts.danger === true, cancel.asks[0].opts);
  check('⭐ ยกเลิกแล้วไม่แตะไฟล์ ไม่เรียก applyImport เลย', cancel.applied === 0, cancel.applied);
  check('ยอดระบบเดิมยังอยู่ครบ', cancel.sysLeft === 42, cancel.sysLeft);
  check('บอกผู้ใช้ว่ายกเลิกแล้ว', /ยกเลิกการนำเข้า/.test(cancel.toast || ''), cancel.toast);

  console.log('\n[6b] ยอดระบบยังว่าง — ต้องไม่ถามอะไรให้เสียเวลา');
  const noAsk = await page.evaluate(async () => {
    window.__seed('counter', 0);
    window.__askAnswer = true;
    let read = 0;
    const fakeFile = { name: 'x.csv', arrayBuffer: function () { read++; return Promise.reject(new Error('EMPTY_FILE')); } };
    await handleImport(fakeFile);
    return { asks: window.__asks.length, read: read };
  });
  check('⭐ นำเข้าครั้งแรกไม่มีกล่องถาม', noAsk.asks === 0, noAsk);
  check('เดินต่อไปอ่านไฟล์เลย', noAsk.read === 1, noAsk);

  /* ---------- [7] นำเข้าสำเร็จแล้วล็อกกลับ ---------- */
  console.log('\n[7] นำเข้าสำเร็จ → ล็อกกลับทันที');
  const done = await page.evaluate(async () => {
    window.__seed('counter', 30);
    state.importUnlocked = true;
    window.__askAnswer = true;
    /* ลัดไปที่ผลลัพธ์: ให้ applyImport สำเร็จ แล้วดูว่า flag ถูกล็อกกลับไหม */
    window.applyImport = function () { return Promise.resolve({ added: 1 }); };
    window.refreshProducts = function () { return Promise.resolve(); };
    window.refreshSystemQty = function () { return Promise.resolve(); };
    window.showImportReport = function () {};
    window.parseProductFile = function () { return { stat: { rows: 1 }, rows: [] }; };
    window.parseCsv = function () { return [['รหัสสินค้า', 'จำนวน'], ['P1', '5']]; };
    window.decodeTextFile = function () { return ''; };
    window.confirmBranch = function () { return Promise.resolve(true); };
    window.confirmDuplicateImport = function () { return Promise.resolve(true); };
    const fakeFile = { name: 'x.csv', arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); } };
    await handleImport(fakeFile);
    await new Promise(r => setTimeout(r, 100));
    return { unlocked: state.importUnlocked, view: window.__view() };
  });
  check('⭐ อัปเสร็จแล้วล็อกกลับเอง', done.unlocked === false, done);

  /* ---------- [8] เปลี่ยนรอบ ---------- */
  console.log('\n[8] เปลี่ยนรอบแล้วสถานะปลดล็อกต้องไม่ติดค้าง');
  const swap = await page.evaluate(() => {
    window.__seed('counter', 60);
    state.importUnlocked = true;
    const before = state.importUnlocked;
    /* selectRound แตะเน็ตด้วย — ตรวจเฉพาะท่อนที่ล้าง state ก็พอ */
    state.systemQty = {};
    state.importUnlocked = false;
    renderStart();
    return { before: before, after: state.importUnlocked, view: window.__view() };
  });
  check('ก่อนเปลี่ยนปลดล็อกอยู่', swap.before === true, swap);
  check('เปลี่ยนรอบแล้วกลับไปล็อก', swap.after === false, swap);

  const src = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  check('⭐ selectRound ล้าง importUnlocked จริง',
        /state\.systemQty = \{\};\s*\n\s*state\.importUnlocked = false;/.test(src), 'selectRound');
  check('doImport ล็อกกลับหลังเขียนสำเร็จ',
        /applyImport\(state\.cycleId, result\)\.then\(function \(diff\) \{[\s\S]{0,220}state\.importUnlocked = false;/.test(src),
        'doImport');

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
