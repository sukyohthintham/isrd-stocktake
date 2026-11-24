/* ============================================================
   ⭐ v2.48.0 ผู้นับ + PIN — ชั้นข้อมูล (PR1)
   ============================================================

   ทำไมต้องมีเทสนี้:
   1 บัญชี Firebase = 1 สาขา แล้วให้เด็กหลายคนแยกตัวตนด้วย PIN
   เครดิตการนับทั้งระบบ (leaderboard · purge · รายงานรายคน) อ่านจาก rec.user ที่มาจาก
   state.counter ที่เดียว ถ้าชื่อผู้นับหลุด เครดิตจะไปลงบัญชีกลางกะเงียบ ๆ

   ทำไมเปิดผ่าน http://127.0.0.1 ไม่ใช่ file://
   PIN เก็บเป็น SHA-256 ด้วย crypto.subtle ซึ่งมีเฉพาะ secure context
   (127.0.0.1 ยังเข้าโหมดทดสอบอัตโนมัติเหมือน file:// — ไม่ต่อฐานจริง ดู isTestMode ใน index.html)

   กันอะไร:
   [1] บัญชีไม่มีผู้นับ = พฤติกรรมเดิมเป๊ะ (rec.user = ชื่อบัญชี · ไม่มี rec.op · แถบบนเดิม)
   [2] pinHash = SHA-256(uid|opId|pin) ตรงกับที่คำนวณฝั่ง Node
   [3] PIN ผิด/รูปแบบผิด ไม่ตั้งผู้นับ · PIN ถูก → rec.user = "ผู้นับ · บัญชี" + rec.op = uid:opId
   [4] สลับคน → rec.user/rec.op เปลี่ยนตาม (ทั้ง writeScan และ adjustJobCount)
   [5] role poll / แก้ชื่อบัญชี แล้วชื่อผู้นับต้องไม่เด้งกลับเป็นชื่อบัญชี (กับระเบิด D1)
   [6] reload → จำผู้นับเดิมต่อ uid · บัญชีอื่นในเครื่องเดียวกันไม่ติด
   [7] ผู้นับถูกปิด (active:false) หรือหาย → ล้างที่จำไว้ กลับเป็นชื่อบัญชี
   [8] โหลด operators ไม่สำเร็จ (เน็ตหลุด) → คงผู้นับเดิม ไม่หลุดกลางกะ
   [9] requireOperator() · ออกจากระบบล้างผู้นับในเครื่อง · เอกสาร "ออกโดย" ใช้ชื่อบัญชี
   ============================================================ */

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { puppeteer, CHROME, APP_FILE } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}
function sha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

/* เสิร์ฟ index.html ไฟล์เดียวบน 127.0.0.1 พอร์ตสุ่ม */
function serve() {
  return new Promise(function (res) {
    const srv = http.createServer(function (req, resp) {
      if (req.url === '/' || req.url.indexOf('/index.html') === 0) {
        resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resp.end(fs.readFileSync(APP_FILE));
      } else { resp.writeHead(404); resp.end(); }
    });
    srv.listen(0, '127.0.0.1', function () { res(srv); });
  });
}

/* ผู้นับในฐานจำลองของบัญชี u1 — pinHash คำนวณฝั่ง Node (เป็นอิสระจากโค้ดแอป) */
const OPS = {
  op1: { name: 'แนน', pinHash: sha('u1|op1|1234'), fresh: true, createdAt: 1 },
  op2: { name: 'บี', pinHash: sha('u1|op2|5678'), fresh: false, createdAt: 2 }
};

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.session.token = function () { return 'tok'; };
  hideLogin();
  window.__updates = [];
  window.db.update = function (path, patch) { window.__updates.push({ path: path, patch: patch }); return Promise.resolve(); };
  var n = 0;
  window.db.newKey = function () { return 'k' + (++n); };

  /* ดักเฉพาะ operators/<uid> — path อื่นใช้ของเดิม */
  window.__ops = {};             // uid -> ก้อน operators
  window.__opsFail = false;
  var _get = window.db.get;
  window.db.get = function (p) {
    var m = /^operators\\/(.+)$/.exec(String(p));
    if (m) {
      if (window.__opsFail) return Promise.reject(new Error('net'));
      var v = window.__ops[m[1]];
      return Promise.resolve(v === undefined ? null : JSON.parse(JSON.stringify(v)));
    }
    return _get.apply(this, arguments);
  };

  window.__login = function (uid, name, role) {
    setMe({ uid: uid, email: uid + '@x' }, { name: name, role: role || 'counter', active: true });
    return loadOperators();
  };
  window.__seed = function () {
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = { A1: { code: 'A1', name: 'สินค้า A1', type: 'product', category: 'หมวด' } };
    state.systemQty = { A1: 10 };
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline'; state.locationFilter = '';
    resetRoundAggregates();
    try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
  };
  /* แถว scan ล่าสุดที่ writeScan/adjustJobCount สร้าง */
  window.__scan = function () { return writeScan('A1', 1, 'scan', null).rec; };
  window.__adj  = function () { return adjustJobCount('R1', 'A1', -1, 'ทดสอบ').rec; };
`;

(async () => {
  const srv = await serve();
  const URL = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(HARNESS);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

  /* ---------- 1. บัญชีไม่มีผู้นับ = เดิมเป๊ะ ---------- */
  console.log('\n[1] snapshot — บัญชีไม่มีผู้นับ พฤติกรรมเดิมเป๊ะ');
  const r1 = await page.evaluate(async () => {
    window.__ops = {};
    await window.__login('u1', 'สมชาย');
    window.__seed();
    showPage('scan');
    const s = window.__scan(), a = window.__adj();
    return {
      counter: state.counter, testMode: !db.remote,
      scanKeys: Object.keys(s).sort(), user: s.user, hasOp: 'op' in s,
      adjKeys: Object.keys(a).sort(), adjUser: a.user, adjHasOp: 'op' in a,
      session: $('sessionText').textContent,
      expectSession: roundLabel('รอบทดสอบ') + ' · ผู้นับ สมชาย',
      req: requireOperator('x'), toasts: window.__toasts.length,
      ls: localStorage.getItem('isrd_op_u1'), acct: accountName(),
      newDom: !!document.getElementById('opBar') || !!document.getElementById('opPick')
    };
  });
  check('อยู่โหมดทดสอบ (127.0.0.1 ไม่ต่อฐานจริง)', r1.testMode, r1);
  check('state.counter = ชื่อบัญชี', r1.counter === 'สมชาย', r1);
  check('rec.user = ชื่อบัญชี', r1.user === 'สมชาย', r1);
  check('writeScan ไม่มีฟิลด์ op', r1.hasOp === false, r1);
  check('writeScan ฟิลด์ชุดเดิมเป๊ะ',
        JSON.stringify(r1.scanKeys) === JSON.stringify(['code', 'delta', 'mode', 'stockType', 'ts', 'user', 'zone', 'zoneName']) ||
        JSON.stringify(r1.scanKeys) === JSON.stringify(['code', 'delta', 'mode', 'ts', 'user', 'zone', 'zoneName']), r1.scanKeys);
  check('adjustJobCount ไม่มี op และ user = ชื่อบัญชี', r1.adjHasOp === false && r1.adjUser === 'สมชาย', r1);
  check('adjustJobCount ฟิลด์ชุดเดิมเป๊ะ',
        JSON.stringify(r1.adjKeys) === JSON.stringify(['code', 'delta', 'mode', 'reason', 'ts', 'user', 'zone', 'zoneName']), r1.adjKeys);
  check('แถบบนหน้ายิงข้อความเดิม', r1.session === r1.expectSession, r1);
  check('requireOperator ผ่านเสมอ ไม่เด้ง toast', r1.req === true && r1.toasts === 0, r1);
  check('ไม่จำอะไรใน localStorage', r1.ls === null, r1);
  check('PR1 ยังไม่เพิ่ม UI ใด ๆ', r1.newDom === false, r1);

  /* ---------- 2. hash ---------- */
  console.log('\n[2] pinHash = SHA-256(uid|opId|pin)');
  const r2 = await page.evaluate(async () => ({
    secure: window.isSecureContext, h: await opPinHash('u1', 'op1', '1234')
  }));
  check('secure context (crypto.subtle ใช้ได้)', r2.secure === true, r2);
  check('hash ตรงกับ Node', r2.h === sha('u1|op1|1234'), r2);
  check('hash เป็น hex64 ผ่าน validate ของ Rules', /^[0-9a-f]{64}$/.test(r2.h), r2);

  /* ---------- 3. PIN ผิด / ถูก ---------- */
  console.log('\n[3] PIN ผิดไม่ตั้ง · PIN ถูก → rec.user = "ผู้นับ · บัญชี" + rec.op');
  const r3 = await page.evaluate(async (OPS) => {
    window.__ops = { u1: OPS };
    await loadOperators();
    const wrong = await setCurrentOp('op1', '9999');
    const afterWrong = { counter: state.counter, op: state.currentOp, ls: localStorage.getItem('isrd_op_u1') };
    const bad = await setCurrentOp('op1', '12a4');
    const ghost = await setCurrentOp('nope', '1234');
    const otherPin = await setCurrentOp('op1', '5678');   // PIN ของอีกคน ใช้กับชื่อนี้ไม่ได้
    const ok = await setCurrentOp('op1', '1234');
    const s = window.__scan(), a = window.__adj();
    return { wrong, afterWrong, bad, ghost, otherPin, ok, counter: state.counter,
             ls: localStorage.getItem('isrd_op_u1'), user: s.user, op: s.op, adjUser: a.user, adjOp: a.op,
             acct: accountName(), req: requireOperator('x') };
  }, OPS);
  check('PIN ผิด → false', r3.wrong === false, r3);
  check('PIN ผิด → ไม่ตั้งผู้นับ ไม่จำในเครื่อง ชื่อเดิม',
        r3.afterWrong.op === null && r3.afterWrong.ls === null && r3.afterWrong.counter === 'สมชาย', r3.afterWrong);
  check('PIN ไม่ใช่ตัวเลข 4 หลัก → false', r3.bad === false, r3);
  check('opId ที่ไม่มี → false', r3.ghost === false, r3);
  check('PIN ของอีกคนใช้กับชื่อนี้ไม่ได้', r3.otherPin === false, r3);
  check('PIN ถูก → true', r3.ok === true, r3);
  check('state.counter = "แนน · สมชาย"', r3.counter === 'แนน · สมชาย', r3);
  check('จำ opId ในเครื่องต่อ uid', r3.ls === 'op1', r3);
  check('writeScan rec.user/rec.op ถูก', r3.user === 'แนน · สมชาย' && r3.op === 'u1:op1', r3);
  check('adjustJobCount rec.user/rec.op ถูก', r3.adjUser === 'แนน · สมชาย' && r3.adjOp === 'u1:op1', r3);
  check('accountName() ยังเป็นชื่อบัญชี (ใช้กับเอกสาร)', r3.acct === 'สมชาย', r3);
  check('requireOperator ผ่านเมื่อเลือกผู้นับแล้ว', r3.req === true, r3);

  /* ---------- 4. สลับคน ---------- */
  console.log('\n[4] สลับคน → rec.user/rec.op เปลี่ยนตาม');
  const r4 = await page.evaluate(async () => {
    clearCurrentOp();
    const mid = { counter: state.counter, ls: localStorage.getItem('isrd_op_u1'), hasOp: 'op' in window.__scan() };
    window.__toasts = [];
    const blocked = requireOperator('ยิงไม่ได้');
    const toast = (window.__toasts[0] || {}).m || '';
    await setCurrentOp('op2', '5678');
    const s = window.__scan(), a = window.__adj();
    return { mid, blocked, toast, user: s.user, op: s.op, adjUser: a.user, adjOp: a.op };
  });
  check('สลับคน (ล้าง) → กลับเป็นชื่อบัญชี ไม่มี op ไม่จำ',
        r4.mid.counter === 'สมชาย' && r4.mid.ls === null && r4.mid.hasOp === false, r4.mid);
  check('มีผู้นับแต่ยังไม่เลือก → requireOperator กัน + บอกเหตุผล',
        r4.blocked === false && /เลือกผู้นับ/.test(r4.toast), r4);
  check('คนใหม่ → rec.user/op ของคนใหม่', r4.user === 'บี · สมชาย' && r4.op === 'u1:op2', r4);
  check('adjustJobCount ตามคนใหม่', r4.adjUser === 'บี · สมชาย' && r4.adjOp === 'u1:op2', r4);

  /* ---------- 5. role poll / แก้ชื่อ ---------- */
  console.log('\n[5] role poll / แก้ชื่อบัญชี — ชื่อผู้นับต้องไม่เด้งกลับ (D1)');
  const r5 = await page.evaluate(async () => {
    const same = applyRoleChange({ name: 'สมชาย', role: 'counter', active: true });
    const c1 = state.counter;
    const changed = applyRoleChange({ name: 'สมชาย', role: 'scanner', active: true });
    const c2 = state.counter, user2 = window.__scan().user;
    /* โปรไฟล์ถูกแก้ชื่อจากที่อื่น แล้ว role poll ดึงมา */
    applyRoleChange({ name: 'สาขาหนึ่ง', role: 'scanner', active: true });
    const c3 = state.counter;
    applyRoleChange({ name: 'สมชาย', role: 'counter', active: true });
    return { same, c1, changed: !!changed, c2, user2, c3 };
  });
  check('refresh สิทธิ์ (ไม่เปลี่ยน) → ผู้นับยังอยู่', r5.c1 === 'บี · สมชาย', r5);
  check('refresh สิทธิ์ (role เปลี่ยน) → ผู้นับยังอยู่', r5.changed && r5.c2 === 'บี · สมชาย', r5);
  check('แถวที่ยิงหลัง refresh ยังลงชื่อผู้นับ', r5.user2 === 'บี · สมชาย', r5);
  check('ชื่อบัญชีเปลี่ยน → ท่อนหลังตาม ผู้นับยังอยู่', r5.c3 === 'บี · สาขาหนึ่ง', r5);

  /* ---------- 6. reload / ต่อ uid ---------- */
  console.log('\n[6] reload จำผู้นับเดิม · บัญชีอื่นในเครื่องเดียวกันไม่ติด');
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(HARNESS);
  const r6 = await page.evaluate(async (OPS) => {
    window.__ops = { u1: OPS, u2: { op1: OPS.op1 } };
    const before = state.counter;
    await window.__login('u1', 'สมชาย');
    const restored = { counter: state.counter, op: state.currentOp };
    await window.__login('u2', 'สาขาสอง');           // คนละบัญชี — op1 ของ u2 มีจริงแต่ไม่เคยใส่ PIN
    const other = { counter: state.counter, op: state.currentOp, ls1: localStorage.getItem('isrd_op_u1') };
    return { before, restored, other };
  }, OPS);
  check('หลัง reload ก่อนล็อกอิน ไม่มีชื่อผู้นับค้าง', r6.before === '', r6);
  check('reload → จำผู้นับเดิม (บี)', r6.restored.op === 'op2' && r6.restored.counter === 'บี · สมชาย', r6.restored);
  check('สลับไปบัญชีอื่น → ไม่ติดผู้นับของบัญชีก่อน', r6.other.op === null && r6.other.counter === 'สาขาสอง', r6.other);
  check('ของบัญชีเดิมยังจำอยู่ในเครื่อง (แยกคีย์ต่อ uid)', r6.other.ls1 === 'op2', r6.other);

  /* ---------- 7. ผู้นับถูกปิด / หาย ---------- */
  console.log('\n[7] ผู้นับถูกปิด (active:false) หรือหาย → ล้างที่จำไว้');
  const r7 = await page.evaluate(async (OPS) => {
    const off = JSON.parse(JSON.stringify(OPS)); off.op2.active = false;
    window.__ops = { u1: off };
    await window.__login('u1', 'สมชาย');
    const a = { counter: state.counter, op: state.currentOp, ls: localStorage.getItem('isrd_op_u1'),
                can: await setCurrentOp('op2', '5678'), active: activeOperatorIds() };
    window.__ops = { u1: OPS };
    await loadOperators();
    await setCurrentOp('op1', '1234');
    window.__ops = { u1: { op2: OPS.op2 } };              // op1 หายจากฐาน
    await loadOperators();
    const b = { counter: state.counter, op: state.currentOp, ls: localStorage.getItem('isrd_op_u1') };
    return { a, b };
  }, OPS);
  check('active:false → ล้างผู้นับ กลับเป็นชื่อบัญชี',
        r7.a.op === null && r7.a.counter === 'สมชาย' && r7.a.ls === null, r7.a);
  check('active:false → ใส่ PIN ถูกก็เข้าไม่ได้', r7.a.can === false, r7.a);
  check('active:false ไม่นับเป็นผู้นับที่ใช้งาน', JSON.stringify(r7.a.active) === '["op1"]', r7.a);
  check('ผู้นับหายจากฐาน → ล้างที่จำไว้', r7.b.op === null && r7.b.counter === 'สมชาย' && r7.b.ls === null, r7.b);

  /* ---------- 8. โหลดไม่สำเร็จ ---------- */
  console.log('\n[8] โหลด operators ไม่สำเร็จ → คงผู้นับเดิม');
  const r8 = await page.evaluate(async (OPS) => {
    window.__ops = { u1: OPS };
    await loadOperators();
    await setCurrentOp('op1', '1234');
    window.__opsFail = true;
    await loadOperators();
    window.__opsFail = false;
    return { counter: state.counter, op: state.currentOp, n: Object.keys(state.operators).length };
  }, OPS);
  check('เน็ตหลุดตอนโหลด → ผู้นับไม่หลุด', r8.op === 'op1' && r8.counter === 'แนน · สมชาย' && r8.n === 2, r8);

  /* ---------- 9. ออกจากระบบ ---------- */
  console.log('\n[9] ออกจากระบบ (forceSignOut) ล้างผู้นับในเครื่อง');
  const r9 = await page.evaluate(() => {
    const _st = window.setTimeout;
    window.setTimeout = function () { return 0; };        // กัน location.reload ของ forceSignOut
    try { forceSignOut(); } finally { window.setTimeout = _st; }
    return { ls: localStorage.getItem('isrd_op_u1'), op: state.currentOp,
             n: Object.keys(state.operators).length, counter: state.counter, me: state.me };
  });
  check('ล้างคีย์ในเครื่อง + ผู้นับ + รายชื่อ', r9.ls === null && r9.op === null && r9.n === 0 && r9.counter === '', r9);

  /* เอกสาร Excel "ออกโดย" ต้องใช้ชื่อบัญชี ไม่ใช่ชื่อเล่นผู้นับ — เช็คจากซอร์ส (ฟังก์ชันส่งออกใหญ่ เรียกตรงไม่สะดวก) */
  const src = fs.readFileSync(APP_FILE, 'utf8');
  check('Excel "ออกโดย" ใช้ accountName()', /summary\.push\(\['ออกโดย', accountName\(\)/.test(src), 'src');
  check('setMe ไม่ตั้ง state.counter = me.name ตรง ๆ อีก', !/state\.counter = state\.me\.name/.test(src), 'src');

  console.log('\n[errors] ' + (errors.length ? errors.join('\n') : 'ไม่มี'));
  check('ไม่มี error บนหน้า', errors.length === 0, errors);

  await browser.close();
  srv.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
