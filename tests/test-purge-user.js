/* ============================================================
   ล้างยอดของผู้ใช้ในรอบ (admin) — v2.10.10
   ============================================================

   ⚠️ เป็น "ลบถาวร" ข้อยกเว้นของกฎบ้าน "ห้ามลบยอดที่นับไปแล้ว"
   ใช้เก็บขยะจากคนยิงทดสอบ/ยิงผิดบัญชีเท่านั้น

   ที่มา: leaderboard นับยอดดิบต่อคนจาก rec.user แต่การ "เอาออกจากสรุป"
   เขียนแถวลบในชื่อคนที่กดลบ ไม่ใช่ชื่อคนที่ยิงเดิม
   → คนทดสอบยังโชว์ยอดเต็ม ส่วนแอดมินโดนหักยอดตัวเอง

   กันอะไร:
   [1] กรณี A — ยอดยังไม่เคยถูกหักคืน: ลบแล้วของจริงลดตาม net
   [2] กรณี B — ถูกหักคืนไปแล้ว: ลบทั้งแถวเป้าหมายและแถวหักคืน
       → ของจริง "คงที่" ไม่ลดซ้ำ · คนหักกลับมาเป็นยอดจริง
   [3] ⭐ ห้ามไปลบ undo จริงของคนอื่น — จับคู่ไม่ลงตัวต้องไม่ติ๊กให้
   [4] รอบหลาย Job — ใบที่ไม่ใช่ counting ต้องรายงานว่าล้างไม่ได้ ไม่ใช่เงียบ
   [5] purgeLog เก็บแถวเต็มทุกฟิลด์ก่อนลบ (ตาข่ายนิรภัยไว้กู้ด้วยมือ)
   [6] สิทธิ์: admin เท่านั้น · เฉพาะ counting · ปุ่มอยู่ในการ์ดที่กางแล้ว
   [7] เขียน purgeLog ไม่สำเร็จ = ห้ามลบ (ห้ามลบโดยไม่มีหลักฐาน)
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
  window.enqueueWrite = function () {};
  window.session.token = function () { return 'tok'; };
  hideLogin();

  /* ตอบกล่องยืนยันตามที่เทสสั่ง + เก็บ detail ไว้ติ๊ก checkbox เองได้ */
  window.__asks = [];
  window.__askAnswer = true;
  window.ask = function (title, message, okLabel, opts) {
    window.__asks.push({ title: title, message: message, opts: opts || {} });
    window.__lastDetail = (opts || {}).detail || null;
    return Promise.resolve(window.__askAnswer);
  };
  window.selectRound = function () { return true; };      /* กันโหลดรอบจริงตอนเทส */

  var kid = 0;
  window.db.newKey = function () { return 'log' + (++kid); };

  /* ฐานจำลอง: scans ของแต่ละ Job + ดัก db.update ไว้ดูว่าเขียน/ลบอะไรไปบ้าง */
  window.__db = {};
  window.__updates = [];
  window.__failLog = false;
  window.db.getQuiet = function (p) {
    var m = /^rounds\\/([^/]+)\\/scans$/.exec(p);
    if (m) {
      if (window.__readFail && window.__readFail[m[1]]) return Promise.reject(new Error('net'));
      return Promise.resolve(JSON.parse(JSON.stringify(window.__db[m[1]] || {})));
    }
    return Promise.resolve({});
  };
  window.db.update = function (path, patch) {
    var keys = Object.keys(patch || {});
    window.__updates.push({ path: path, keys: keys, patch: patch });
    if (window.__failLog && keys.some(function (k) { return /^purgeLog\\//.test(k); })) {
      return Promise.reject(new Error('PERMISSION_DENIED'));
    }
    var jid = (/^rounds\\/(.+)$/.exec(path) || [])[1];
    keys.forEach(function (k) {
      var ms = /^scans\\/(.+)$/.exec(k);
      if (ms && patch[k] === null && window.__db[jid]) delete window.__db[jid][ms[1]];
    });
    return Promise.resolve();
  };

  window.__seed = function (role, jobs) {
    state.me = { uid: 'u1', name: 'isrd', role: role || 'admin', branches: [] };
    state.counter = 'isrd';
    state.cycleId = 'C1';
    state.roundIndex = {};
    state.cycles = { C1: { status: 'counting', info: {} } };
    jobs.forEach(function (j) {
      state.roundIndex[j.id] = { id: j.id, jobCode: j.id, cycleId: 'C1',
                                 status: j.status || 'counting', createdAt: 1 };
      window.__db[j.id] = JSON.parse(JSON.stringify(j.scans || {}));
    });
    state.roundId = jobs[0].id;
    state.products = {
      NTSALE150Rg: { code: 'NTSALE150Rg', name: 'ก', type: 'product' },
      SOSALE150CT: { code: 'SOSALE150CT', name: 'ข', type: 'product' },
      NTSALE250SE: { code: 'NTSALE250SE', name: 'ค', type: 'product' }
    };
    state.systemQty = { NTSALE150Rg: 100, SOSALE150CT: 100, NTSALE250SE: 100 };
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline';
    window.__updates = []; window.__toasts = []; window.__asks = [];
    window.__failLog = false; window.__readFail = null;
  };

  /* แถว scan ให้เขียนสั้น ๆ */
  window.__row = function (code, delta, user, ts, reason) {
    var r = { code: code, zone: 'no-zone', zoneName: '(ไม่ระบุโซน)',
              user: user, ts: ts, delta: delta, mode: 'scan' };
    if (reason) r.reason = reason;
    return r;
  };

  window.__deleted = function () {
    var out = [];
    window.__updates.forEach(function (u) {
      u.keys.forEach(function (k) {
        var m = /^scans\\/(.+)$/.exec(k);
        if (m && u.patch[k] === null) out.push(m[1]);
      });
    });
    return out;
  };
  window.__logs = function () {
    var out = [];
    window.__updates.forEach(function (u) {
      u.keys.forEach(function (k) {
        if (/^purgeLog\\//.test(k)) out.push({ path: u.path, entry: u.patch[k] });
      });
    });
    return out;
  };
  /* ยอด "ของจริง" ของทั้งรอบจากก้อนที่เหลืออยู่ในฐานจำลอง */
  window.__pieces = function () {
    var merged = {};
    Object.keys(window.__db).forEach(function (jid) {
      Object.keys(window.__db[jid]).forEach(function (sid) {
        merged[jid + '|' + sid] = window.__db[jid][sid];
      });
    });
    return computeJobStats(merged, state.systemQty).pieces;
  };
  window.__tick = function (sid, on) {
    var cb = window.__lastDetail &&
             window.__lastDetail.querySelector('[data-purgeoffset="' + sid + '"]');
    if (!cb) return false;
    cb.checked = !!on;
    cb.onchange();
    return true;
  };
  window.__autoTicked = function () {
    if (!window.__lastDetail) return [];
    return Array.prototype.filter.call(
      window.__lastDetail.querySelectorAll('[data-purgeoffset]'),
      function (cb) { return cb.checked; }
    ).map(function (cb) { return cb.getAttribute('data-purgeoffset'); });
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

  /* ---------- [1] กรณี A ---------- */
  console.log('\n[1] กรณี A — ยอดยังไม่เคยถูกหักคืน → ของจริงต้องลดตาม net');
  const caseA = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      a1: window.__row('NTSALE150Rg', 270, 'isrd', 1000),
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000),
      g2: window.__row('SOSALE150CT', 4, 'Gift', 2001),
      g3: window.__row('NTSALE250SE', 1, 'Gift', 2002)
    } }]);
    const before = window.__pieces();
    window.__askAnswer = true;
    await purgeUserScans('Gift');
    return { before: before, after: window.__pieces(),
             deleted: window.__deleted(), toast: (window.__toasts.slice(-1)[0] || {}).m,
             askMsg: (window.__asks[0] || {}).message };
  });
  check('ก่อนลบ ของจริง = 278', caseA.before === 278, caseA);
  check('ลบเฉพาะแถวของ Gift 3 แถว',
        caseA.deleted.length === 3 && caseA.deleted.sort().join(',') === 'g1,g2,g3', caseA.deleted);
  check('⭐ ของจริงลดเหลือ 270', caseA.after === 270, caseA);
  check('กล่องยืนยันบอกจำนวนแถวและยอดสุทธิ',
        /ลบถาวร 3 แถว \(สุทธิ \+8 ชิ้น\)/.test(caseA.askMsg || ''), caseA.askMsg);
  check('รายงานว่าสำเร็จ 1 ใบ', /ล้างสำเร็จ 1 ใบ/.test(caseA.toast || ''), caseA.toast);

  /* ---------- [2] กรณี B — เคสจริง Gift/isrd ---------- */
  console.log('\n[2] ⭐ กรณี B — ถูกหักคืนไปแล้ว → ของจริงต้องคงที่ 278');
  const caseB = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      a1: window.__row('NTSALE150Rg', 270, 'isrd', 1000),
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000),
      g2: window.__row('SOSALE150CT', 4, 'Gift', 2001),
      g3: window.__row('NTSALE250SE', 1, 'Gift', 2002),
      /* แอดมินลบยอด Gift ไปแล้วในชื่อตัวเอง */
      r1: window.__row('NTSALE150Rg', -3, 'isrd', 3000, 'เอาออกจากสรุป (ยิงเกิน)'),
      r2: window.__row('SOSALE150CT', -4, 'isrd', 3001, 'เอาออกทั้งหมดจากสรุป'),
      r3: window.__row('NTSALE250SE', -1, 'isrd', 3002, 'เอาออกจากสรุป (ยิงเกิน)')
    } }]);
    const before = window.__pieces();
    window.__askAnswer = true;
    const planTicks = [];
    /* ดัก autoTick ตอนกล่องเปิด */
    const realAsk = window.ask;
    window.ask = function (t, m, o, opts) {
      const r = realAsk(t, m, o, opts);
      planTicks.push(window.__autoTicked());
      return r;
    };
    await purgeUserScans('Gift');
    window.ask = realAsk;
    return { before: before, after: window.__pieces(), deleted: window.__deleted().sort(),
             autoTicked: (planTicks[0] || []).sort(), toast: (window.__toasts.slice(-1)[0] || {}).m };
  });
  check('ก่อนลบ ของจริง = 270 (Gift ถูกหักไปแล้ว)', caseB.before === 270, caseB);
  check('⭐ ติ๊กแถวหักคืนให้อัตโนมัติครบ 3 แถว (จับคู่ลงตัว)',
        caseB.autoTicked.join(',') === 'r1,r2,r3', caseB.autoTicked);
  check('⭐ ลบทั้งของ Gift และแถวหักคืน รวม 6 แถว',
        caseB.deleted.join(',') === 'g1,g2,g3,r1,r2,r3', caseB.deleted);
  check('⭐ ของจริง "คงที่" 270 ไม่ลดซ้ำ', caseB.after === 270, caseB);

  console.log('\n[2b] ไม่ติ๊กแถวหักคืน → ของจริงลดลงตามที่เตือนไว้');
  const caseB2 = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      a1: window.__row('NTSALE150Rg', 270, 'isrd', 1000),
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000),
      r1: window.__row('NTSALE150Rg', -3, 'isrd', 3000, 'เอาออกจากสรุป (ยิงเกิน)')
    } }]);
    const realAsk = window.ask;
    window.ask = function (t, m, o, opts) {
      window.__lastDetail = (opts || {}).detail;
      window.__tick('r1', false);                 /* แอดมินเลือกไม่ลบแถวหักคืน */
      return Promise.resolve(true);
    };
    const before = window.__pieces();
    await purgeUserScans('Gift');
    window.ask = realAsk;
    return { before: before, after: window.__pieces(), deleted: window.__deleted() };
  });
  check('ลบเฉพาะแถวของ Gift', caseB2.deleted.join(',') === 'g1', caseB2.deleted);
  check('ของจริงลดลง 3 (270 → 267)',
        caseB2.before === 270 && caseB2.after === 267, caseB2);

  /* ---------- [3] กันลบ undo จริงของคนอื่น ---------- */
  console.log('\n[3] ⭐ จับคู่ไม่ลงตัว → ห้ามติ๊กให้ (กันลบ undo จริงของคนอื่น)');
  const amb = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      a1: window.__row('NTSALE150Rg', 20, 'isrd', 1000),
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000),
      /* แอดมินลบ 5 ชิ้น — มากกว่าที่ Gift ยิง แปลว่ามีของคนอื่นปนอยู่ ตีความไม่ได้ */
      r1: window.__row('NTSALE150Rg', -5, 'isrd', 3000, 'เอาออกจากสรุป (ยิงเกิน)')
    } }]);
    const realAsk = window.ask;
    let ticked = null;
    window.ask = function (t, m, o, opts) {
      window.__lastDetail = (opts || {}).detail;
      ticked = window.__autoTicked();
      return Promise.resolve(true);
    };
    await purgeUserScans('Gift');
    window.ask = realAsk;
    return { ticked: ticked, deleted: window.__deleted(), after: window.__pieces() };
  });
  check('⭐ ไม่ติ๊กให้เลย เพราะจับคู่ไม่ลงตัว', amb.ticked.length === 0, amb);
  check('ลบแต่แถวของ Gift ไม่แตะแถวของคนอื่น', amb.deleted.join(',') === 'g1', amb.deleted);
  check('ของจริงเหลือ 15 (20-5)', amb.after === 15, amb);

  console.log('\n[3b] แถวลบที่เกิด "ก่อน" เป้าหมายยิง ต้องไม่ถูกมองว่าเกี่ยวกัน');
  const older = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      a1: window.__row('NTSALE150Rg', 20, 'isrd', 1000),
      r1: window.__row('NTSALE150Rg', -3, 'isrd', 1500, 'ยกเลิกการยิงล่าสุด'),
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000)
    } }]);
    const realAsk = window.ask;
    let ticked = null;
    window.ask = function (t, m, o, opts) {
      window.__lastDetail = (opts || {}).detail;
      ticked = window.__autoTicked();
      return Promise.resolve(true);
    };
    await purgeUserScans('Gift');
    window.ask = realAsk;
    return { ticked: ticked, deleted: window.__deleted() };
  });
  check('⭐ แถวลบที่เก่ากว่าไม่ถูกเสนอเลย', older.ticked.length === 0, older);
  check('ลบแต่ของ Gift', older.deleted.join(',') === 'g1', older.deleted);

  console.log('\n[3c] แถวลบที่ไม่ใช่เหตุผลของระบบ ต้องไม่ถูกเสนอ');
  const otherReason = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000),
      r1: window.__row('NTSALE150Rg', -3, 'somchai', 3000, 'นับใหม่แล้วของหาย')
    } }]);
    const realAsk = window.ask;
    let ticked = null;
    window.ask = function (t, m, o, opts) {
      window.__lastDetail = (opts || {}).detail;
      ticked = window.__autoTicked();
      return Promise.resolve(true);
    };
    await purgeUserScans('Gift');
    window.ask = realAsk;
    return { ticked: ticked, deleted: window.__deleted() };
  });
  check('⭐ เหตุผลนอกลิสต์ของระบบไม่ถูกเสนอ', otherReason.ticked.length === 0, otherReason);
  check('ลบแต่ของ Gift', otherReason.deleted.join(',') === 'g1', otherReason.deleted);

  /* ---------- [4] รอบหลาย Job ---------- */
  console.log('\n[4] ⭐ รอบหลาย Job — ใบที่ไม่ใช่ counting ต้องรายงานว่าล้างไม่ได้');
  const multi = await page.evaluate(async () => {
    window.__seed('admin', [
      { id: 'J1', status: 'counting', scans: { g1: window.__row('NTSALE150Rg', 5, 'Gift', 2000) } },
      { id: 'J2', status: 'counting', scans: { g2: window.__row('SOSALE150CT', 2, 'Gift', 2100) } },
      { id: 'J3', status: 'closed',   scans: { g3: window.__row('NTSALE250SE', 9, 'Gift', 2200) } }
    ]);
    window.__askAnswer = true;
    await purgeUserScans('Gift');
    return { deleted: window.__deleted().sort(), toast: (window.__toasts.slice(-1)[0] || {}).m,
             left: Object.keys(window.__db.J3), bad: (window.__toasts.slice(-1)[0] || {}).bad };
  });
  check('ลบของใบที่ counting ทั้งสองใบ', multi.deleted.join(',') === 'g1,g2', multi.deleted);
  check('⭐ ใบที่ปิดแล้วไม่ถูกแตะ', multi.left.join(',') === 'g3', multi.left);
  check('⭐ รายงานว่าสำเร็จ 2 ใบ', /ล้างสำเร็จ 2 ใบ/.test(multi.toast || ''), multi.toast);
  check('⭐ รายงานว่าล้างไม่ได้ 1 ใบ พร้อมชื่อและเหตุผล',
        /ล้างไม่ได้ 1 ใบ: J3 \(ใบนี้ปิดแล้วแล้ว\)/.test(multi.toast || '') ||
        /ล้างไม่ได้ 1 ใบ: J3/.test(multi.toast || ''), multi.toast);
  check('ขึ้นเป็นข้อความเตือน ไม่ใช่ข้อความปกติ', multi.bad === true, multi.bad);

  /* ---------- [5] purgeLog ---------- */
  console.log('\n[5] ⭐ purgeLog ต้องเก็บแถวเต็มทุกฟิลด์ก่อนลบ');
  const log = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: {
      g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000, 'ยิงทดสอบ'),
      r1: window.__row('NTSALE150Rg', -3, 'isrd', 3000, 'เอาออกจากสรุป (ยิงเกิน)')
    } }]);
    window.__askAnswer = true;
    await purgeUserScans('Gift');
    const logs = window.__logs();
    return { count: logs.length, entry: logs[0] && logs[0].entry, path: logs[0] && logs[0].path,
             order: window.__updates.map(function (u) {
               return /purgeLog/.test(u.keys[0] || '') ? 'log' : 'del';
             }) };
  });
  check('เขียน purgeLog 1 รายการ', log.count === 1, log.count);
  check('เขียนลงใบเดียวกับที่ลบ', log.path === 'rounds/J1', log.path);
  check('⭐ เขียนบันทึก "ก่อน" ลบเสมอ', log.order[0] === 'log', log.order);
  check('บอกว่าใครลบ ลบของใคร เมื่อไหร่',
        log.entry.by === 'isrd' && log.entry.targetUser === 'Gift' &&
        typeof log.entry.at === 'number', log.entry);
  check('⭐ เก็บแถวเต็มของเป้าหมาย (sid + ทุกฟิลด์)',
        log.entry.rows.length === 1 && log.entry.rows[0].sid === 'g1' &&
        log.entry.rows[0].code === 'NTSALE150Rg' && log.entry.rows[0].delta === 3 &&
        log.entry.rows[0].user === 'Gift' && log.entry.rows[0].ts === 2000 &&
        log.entry.rows[0].reason === 'ยิงทดสอบ' && log.entry.rows[0].zone === 'no-zone' &&
        log.entry.rows[0].mode === 'scan', log.entry.rows);
  check('⭐ เก็บแถวหักคืนแยกไว้ต่างหาก',
        log.entry.offsetRows.length === 1 && log.entry.offsetRows[0].sid === 'r1' &&
        log.entry.offsetRows[0].delta === -3, log.entry.offsetRows);
  check('บันทึกยอดก่อน/หลังไว้ด้วย',
        log.entry.actBefore === 0 && log.entry.actAfter === 0, log.entry);

  /* ---------- [6] สิทธิ์ ---------- */
  console.log('\n[6] สิทธิ์ — admin เท่านั้น และเฉพาะรอบที่ยังนับอยู่');
  for (const role of ['counter', 'scanner', 'viewer']) {
    const r = await page.evaluate(async (rl) => {
      window.__seed(rl, [{ id: 'J1', scans: { g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000) } }]);
      window.__askAnswer = true;
      const ok = await purgeUserScans('Gift');
      return { ok: ok, deleted: window.__deleted().length, asks: window.__asks.length,
               toast: (window.__toasts[0] || {}).m };
    }, role);
    check(role + ' เรียกตรง ๆ ก็ล้างไม่ได้', r.ok === false && r.deleted === 0, { role, r });
    check(role + ' ไม่ถึงกล่องยืนยันด้วยซ้ำ', r.asks === 0, { role, r });
    check(role + ' บอกเหตุผลเป็นภาษาคน', /สิทธิ์|ผู้ดูแล/.test(r.toast || ''), r.toast);
  }

  const closed = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', status: 'closed',
      scans: { g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000) } }]);
    const ok = await purgeUserScans('Gift');
    return { ok: ok, deleted: window.__deleted().length, toast: (window.__toasts[0] || {}).m };
  });
  check('รอบที่ปิดแล้ว admin ก็ล้างไม่ได้', closed.ok === false && closed.deleted === 0, closed);
  check('บอกว่าล้างได้เฉพาะรอบที่ยังนับอยู่', /ยังนับอยู่/.test(closed.toast || ''), closed.toast);

  console.log('\n[6b] ปุ่มอยู่ในการ์ดที่กางแล้ว และโชว์เฉพาะ admin');
  const btn = await page.evaluate(() => {
    const out = {};
    ['admin', 'counter', 'scanner'].forEach(function (rl) {
      window.__seed(rl, [{ id: 'J1', scans: {} }]);
      state.scanLog = [{ id: 's1', rec: window.__row('NTSALE150Rg', 3, 'Gift', 2000) }];
      state.counts = { NTSALE150Rg: 3 };
      state.scannerOpen = null;
      renderScanners();
      /* เช็ค "กดโดนได้จริงไหม" ไม่ใช่แค่ "มีใน DOM"
         ปุ่มถูกสร้างไว้ในส่วนที่กางออก ซึ่งตอนหุบถูก display:none = แตะไม่โดน */
      var cEl = document.querySelector('#scannerList [data-purgeuser]');
      const collapsed = !!cEl && cEl.parentElement.style.display !== 'none';
      state.scannerOpen = 'Gift';
      renderScanners();
      const el = document.querySelector('#scannerList [data-purgeuser]');
      out[rl] = { collapsed: collapsed, expanded: !!el, label: el ? el.textContent : null };
    });
    return out;
  });
  check('⭐ การ์ดยังไม่กาง ปุ่มถูกซ่อน แตะไม่โดน (admin)', btn.admin.collapsed === false, btn.admin);
  check('กางแล้วถึงมีปุ่ม (admin)', btn.admin.expanded === true, btn.admin);
  check('ป้ายปุ่มถูกต้อง', btn.admin.label === '🗑 ล้างยอดของผู้ใช้นี้ในรอบ', btn.admin.label);
  check('counter ไม่เห็นปุ่มแม้กางแล้ว', btn.counter.expanded === false, btn.counter);
  check('scanner ไม่เห็นปุ่มแม้กางแล้ว', btn.scanner.expanded === false, btn.scanner);

  /* ---------- [7] เขียน log ไม่ได้ = ห้ามลบ ---------- */
  console.log('\n[7] ⭐ เขียน purgeLog ไม่สำเร็จ = ห้ามลบ (ห้ามลบโดยไม่มีหลักฐาน)');
  const noLog = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: { g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000) } }]);
    window.__failLog = true;
    window.__askAnswer = true;
    await purgeUserScans('Gift');
    return { deleted: window.__deleted().length, left: Object.keys(window.__db.J1),
             toast: (window.__toasts.slice(-1)[0] || {}).m };
  });
  check('⭐ ไม่ลบอะไรเลยเมื่อบันทึกไม่สำเร็จ', noLog.deleted === 0, noLog);
  check('แถวเดิมยังอยู่ครบ', noLog.left.join(',') === 'g1', noLog.left);
  check('รายงานว่าล้างไม่ได้', /ล้างไม่ได้/.test(noLog.toast || ''), noLog.toast);

  console.log('\n[7b] ไม่มียอดของคนนั้น / กดยกเลิก');
  const none = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: { a1: window.__row('NTSALE150Rg', 5, 'isrd', 1000) } }]);
    const ok = await purgeUserScans('Gift');
    return { ok: ok, deleted: window.__deleted().length, toast: (window.__toasts.slice(-1)[0] || {}).m };
  });
  check('ไม่พบยอด = ไม่ทำอะไร', none.ok === false && none.deleted === 0, none);
  check('บอกว่าไม่พบยอดของคนนั้น', /ไม่พบยอดของ Gift/.test(none.toast || ''), none.toast);

  const cancel = await page.evaluate(async () => {
    window.__seed('admin', [{ id: 'J1', scans: { g1: window.__row('NTSALE150Rg', 3, 'Gift', 2000) } }]);
    window.__askAnswer = false;
    const ok = await purgeUserScans('Gift');
    return { ok: ok, deleted: window.__deleted().length, logs: window.__logs().length,
             toast: (window.__toasts.slice(-1)[0] || {}).m };
  });
  check('กดยกเลิก = ไม่ลบ ไม่เขียน log',
        cancel.ok === false && cancel.deleted === 0 && cancel.logs === 0, cancel);
  check('บอกว่ายกเลิกแล้ว', /ยกเลิก ไม่ได้ลบอะไร/.test(cancel.toast || ''), cancel.toast);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
