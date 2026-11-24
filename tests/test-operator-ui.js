/* ============================================================
   ⭐ v2.49.0 ผู้นับ + PIN — หน้าจอ (PR2)
   ============================================================

   ต่อจาก test-operator-pin.js (ชั้นข้อมูล PR1) — ไฟล์นี้คุมหน้าจอและฟังก์ชันเขียน
   เปิดผ่าน http://127.0.0.1 เพราะ crypto.subtle (hash PIN) มีเฉพาะ secure context
   (127.0.0.1 ยังเป็นโหมดทดสอบ ไม่ต่อฐานจริง — ยืนยันในข้อ [1])

   กันอะไร:
   [1] บัญชีไม่มีผู้นับ = ไม่มี #opPick/#opBar · ไม่บล็อก navScan · ยิง/รีเช็คเดิมเป๊ะ
   [2] มีผู้นับแต่ยังไม่เลือก → navScan บล็อก + ปุ่มพาไปเลือก (ไม่ตัน) · ยิง/undo/manual/รีเช็คเขียนไม่ได้
   [3] คีย์แพด: PIN ผิด = สั่น+เคลียร์ · PIN ถูก = เข้าหน้ายิง + แถบผู้นับ + เตือน PIN สุ่ม
   [4] สลับคน → ต้องใส่ PIN ใหม่ · rec.user/op เปลี่ยน · undo ของคนก่อนไม่ติดมา
   [5] เปลี่ยน PIN ตัวเอง (fresh=false · PIN เก่าใช้ไม่ได้)
   [6] ⚙️ จัดการ: reauth ผิด=ไม่เปิด ถูก=เปิด · สุ่ม PIN ใหม่ · เพิ่ม (ชื่อซ้ำ=ปฏิเสธ) · ปิดใช้งาน · เสร็จ=ล็อก
   [7] อุปกรณ์ไม่มี crypto.subtle / hash พัง → ไม่เขียนอะไร + บอกเหตุผล
   [8] session.verifyPassword ฝั่ง REST จริง (stub fetch) — ไม่แตะ token เดิม
   [9] ปุ่ม ⚙️ ในการ์ดบัญชี (ทางเข้าของบัญชีที่ยังไม่มีผู้นับ)
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
const wait = ms => new Promise(r => setTimeout(r, ms));

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

const OPS = {
  op1: { name: 'แนน', pinHash: sha('u1|op1|1234'), fresh: true, active: true, createdAt: 1 },
  op2: { name: 'บี', pinHash: sha('u1|op2|5678'), fresh: false, active: true, createdAt: 2 }
};

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: String(m), bad: !!bad }); };
  window.session.token = function () { return 'tok'; };
  hideLogin();
  /* งานนับ (scans/stat) ไหลผ่าน enqueueWrite · ผู้นับเขียนตรงด้วย db.update — ดักทั้งสองทาง */
  window.__enq = [];
  window.enqueueWrite = function (path, patch) { window.__enq.push({ path: path, patch: patch }); return true; };
  window.__upd = [];
  window.__updFail = false;
  window.db.update = function (path, patch) {
    window.__upd.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) });
    return window.__updFail ? Promise.reject(new Error('net')) : Promise.resolve();
  };
  var n = 0;
  window.db.newKey = function () { return 'k' + (++n); };
  window.__ops = {};
  window.__users = { u1: { name: 'สมชาย', role: 'counter', active: true }, u9: { name: 'ป้อม', role: 'scanner', active: true } };
  var _get = window.db.get;
  window.db.get = function (p) {
    var m = /^operators\\/(.+)$/.exec(String(p));
    if (m) { var v = window.__ops[m[1]]; return Promise.resolve(v === undefined ? null : JSON.parse(JSON.stringify(v))); }
    if (p === 'users') return Promise.resolve(JSON.parse(JSON.stringify(window.__users)));
    return _get.apply(this, arguments);
  };
  window.__scans = function () {
    var out = [];
    window.__enq.forEach(function (e) {
      Object.keys(e.patch || {}).forEach(function (k) { if (/^scans\\//.test(k)) out.push(e.patch[k]); });
    });
    return out;
  };
  window.__seed = function (role) {
    setMe({ uid: 'u1', email: 'u1@x' }, { name: 'สมชาย', role: role || 'counter', active: true });
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1', branch: 'สาขาทดสอบ',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = { A1: { code: 'A1', name: 'สินค้า A1', type: 'product', category: 'หมวด', barcode: 'A1' } };
    state.systemQty = { A1: 10 };
    state.locations = { offline: {}, online: {} };
    state.locationsLoaded = true;
    state.locationSet = 'offline'; state.locationFilter = '';
    state.undoStack = [];
    resetRoundAggregates();
    state.scanIndex = null;
    try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
  };
  window.__reset = function () { window.__toasts = []; window.__enq = []; window.__upd = []; };
  window.__lastToast = function () { return (window.__toasts[window.__toasts.length - 1] || {}).m || ''; };
  /* ตอบ modal ask() แบบกดจริงบนจอ */
  window.__answer = function (vals, ok) {
    Object.keys(vals || {}).forEach(function (k) {
      var i = document.querySelector('#modalDetail [data-field="' + k + '"]'); if (i) i.value = vals[k];
    });
    document.getElementById(ok === false ? 'modalCancel' : 'modalOk').click();
  };
  window.__modalOpen = function () { return document.getElementById('modalBg').classList.contains('show'); };
  window.__visible = function (id) { var e = document.getElementById(id); return !!e && e.offsetParent !== null; };
`;

(async () => {
  const srv = await serve();
  const URL = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await wait(800);
  await page.evaluate(HARNESS);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  const clickSel = sel => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  const pad = async digits => { for (const d of digits) await clickSel('#opPick [data-opkey="' + d + '"]'); await wait(150); };

  /* ---------- 1. backward-compat ---------- */
  console.log('\n[1] บัญชีไม่มีผู้นับ — ไม่มี DOM/ด่านใหม่ ยิง/รีเช็คเดิมเป๊ะ');
  const r1 = await page.evaluate(async () => {
    window.__ops = {};
    window.__seed();
    await loadOperators(); opAfterLoad(); window.__reset();
    const blockers = startBlockers();
    refreshNav();
    showPage('scan');
    const onScan = state.page;
    handleScanValue('A1');
    const scans = window.__scans();
    showPage('recheck');
    const onRc = state.page;
    submitRecheck('A1');               // ไม่มีร่าง → ต้องเด้งเรื่องจำนวน/รูป (ด่านเดิม) ไม่ใช่เรื่องผู้นับ
    return {
      testMode: !db.remote, blockers, navScan: $('navScan').disabled, onScan, onRc,
      scanN: scans.length, user: scans[0] && scans[0].user, hasOp: !!(scans[0] && 'op' in scans[0]),
      opPick: !!document.getElementById('opPick'), opBar: !!document.getElementById('opBar'),
      opBarRc: !!document.getElementById('opBarRc'),
      scanFirst: (document.getElementById('pageScan').firstElementChild || {}).className,
      rcToast: window.__lastToast(), gate: opGateNeeded()
    };
  });
  check('อยู่โหมดทดสอบ (ไม่ต่อฐานจริง)', r1.testMode, r1);
  check('ไม่มีด่าน "ยังไม่ได้เลือกผู้นับ"', !r1.blockers.some(b => /ผู้นับ/.test(b)) && r1.gate === false, r1.blockers);
  check('navScan ไม่ถูกบล็อก', r1.navScan === false, r1);
  check('เข้าหน้ายิงได้ตรง ๆ ไม่มี overlay', r1.onScan === 'scan' && !r1.opPick, r1);
  check('ยิงได้ 1 แถว rec.user = ชื่อบัญชี ไม่มี op', r1.scanN === 1 && r1.user === 'สมชาย' && !r1.hasOp, r1);
  check('ไม่มี #opBar/#opBarRc ใน DOM เลย', !r1.opBar && !r1.opBarRc, r1);
  check('ลูกตัวแรกของหน้ายิงยังเป็นแบนเนอร์เดิม', /banner/.test(r1.scanFirst || ''), r1.scanFirst);
  check('เข้ารีเช็คได้ตรง ๆ', r1.onRc === 'recheck', r1);
  check('รีเช็คติดด่านเดิม (จำนวน/รูป) ไม่ใช่ด่านผู้นับ', /จำนวน/.test(r1.rcToast) && !/ผู้นับ/.test(r1.rcToast), r1.rcToast);

  /* ---------- 2. gate ---------- */
  console.log('\n[2] มีผู้นับแต่ยังไม่เลือก → บล็อก + ปุ่มพาไปเลือก · เขียนอะไรไม่ได้');
  const r2 = await page.evaluate(async (OPS) => {
    window.__ops = { u1: OPS };
    /* ไม่ใช้ showPage('jobs') — LITE_MODE จะดึง roundIndex ใหม่แบบ async มาทับ Job ที่ seed ไว้ */
    showPage('start');
    window.__seed();
    await loadOperators(); opAfterLoad(); window.__reset();
    const blockers = startBlockers();
    const navScan = $('navScan').disabled;
    const fixBtn = !!document.querySelector('#startBlockers [data-fixact="oppick"]');
    showPage('scan');
    const afterScan = { page: state.page, overlay: !!document.getElementById('opPick'),
                        cards: document.querySelectorAll('#opPick [data-opid]').length };
    closeOpPick();
    window.__reset();
    handleScanValue('A1');
    const scanToast = window.__lastToast(), reopened = !!document.getElementById('opPick');
    closeOpPick();
    state.undoStack = [{ key: 'A1', delta: 1 }];
    undoLastScan(); const undoToast = window.__lastToast();
    saveManual(); const manualToast = window.__lastToast();
    showPage('recheck');
    const rcPage = state.page, rcOverlay = !!document.getElementById('opPick');
    closeOpPick();
    submitRecheck('A1'); const subToast = window.__lastToast();
    sendRecheck('A1'); const sendToast = window.__lastToast();
    applyRecheck('A1'); const applyToast = window.__lastToast();
    return { blockers, navScan, fixBtn, afterScan, scanToast, reopened, undoToast, manualToast,
             rcPage, rcOverlay, subToast, sendToast, applyToast,
             scans: window.__scans().length, enq: window.__enq.length, upd: window.__upd.length };
  }, OPS);
  check('startBlockers มี "ยังไม่ได้เลือกผู้นับ"', r2.blockers.some(b => /ยังไม่ได้เลือกผู้นับ/.test(b)), r2.blockers);
  check('navScan ถูกบล็อก', r2.navScan === true, r2);
  check('กล่องเตือนมีปุ่ม "👤 เลือกผู้นับ" (ไม่ตัน)', r2.fixBtn, r2);
  check('showPage(scan) → เปิดหน้าเลือกแทน ไม่สลับหน้า', r2.afterScan.page !== 'scan' && r2.afterScan.overlay, r2.afterScan);
  check('การ์ดผู้นับขึ้นครบ 2 คน', r2.afterScan.cards === 2, r2.afterScan);
  check('ยิงไม่ได้ + บอกเหตุผล + เปิดหน้าเลือก', /เลือกผู้นับ/.test(r2.scanToast) && r2.reopened, r2);
  check('undo ไม่ได้', /เลือกผู้นับ/.test(r2.undoToast), r2.undoToast);
  check('กรอกจำนวนเองไม่ได้', /เลือกผู้นับ/.test(r2.manualToast), r2.manualToast);
  check('showPage(recheck) → เปิดหน้าเลือกแทน', r2.rcPage !== 'recheck' && r2.rcOverlay, r2);
  check('ส่งผลรีเช็คไม่ได้ (submitRecheck)', /ส่งผลรีเช็คไม่ได้ — ต้องเลือกผู้นับ/.test(r2.subToast), r2.subToast);
  check('ส่งรีเช็คไม่ได้ (sendRecheck)', /เลือกผู้นับ/.test(r2.sendToast), r2.sendToast);
  check('ปรับยอดจากรีเช็คไม่ได้ (applyRecheck)', /เลือกผู้นับ/.test(r2.applyToast), r2.applyToast);
  check('ไม่มีอะไรถูกเขียนเลย', r2.enq === 0 && r2.upd === 0, r2);

  /* ---------- 3. keypad ---------- */
  console.log('\n[3] คีย์แพด — ผิด = สั่น+เคลียร์ · ถูก = เข้าหน้ายิง');
  await page.evaluate(() => { showPage('start'); openOpPick('scan'); window.__reset(); });
  await clickSel('#opPick [data-opid="op1"]');
  await pad(['9', '9', '9', '9']);
  const r3a = await page.evaluate(() => ({
    err: (document.getElementById('opErr') || {}).textContent, bad: !!document.querySelector('#opDots.bad'),
    filled: document.querySelectorAll('#opPick .op-dot.f').length, op: state.currentOp,
    overlay: !!document.getElementById('opPick')
  }));
  check('PIN ผิด → ข้อความ + สั่น', /PIN ไม่ถูก/.test(r3a.err || '') && r3a.bad, r3a);
  check('PIN ผิด → ล้างดอท ไม่ตั้งผู้นับ ยังอยู่หน้าเลือก', r3a.filled === 0 && r3a.op === null && r3a.overlay, r3a);
  await clickSel('#opPick [data-opkey="5"]'); await clickSel('#opPick [data-opkey="del"]');
  const r3d = await page.evaluate(() => document.querySelectorAll('#opPick .op-dot.f').length);
  check('ปุ่มลบ ลบทีละหลัก', r3d === 0, r3d);
  await pad(['1', '2', '3', '4']);
  const r3 = await page.evaluate(() => {
    const out = { op: state.currentOp, overlay: !!document.getElementById('opPick'), page: state.page,
      navScan: $('navScan').disabled, bar: !!document.getElementById('opBar'),
      barName: (document.querySelector('#opBar [data-opname]') || {}).textContent,
      fresh: !!document.querySelector('#opBar [data-opfresh]'), rcBar: !!document.getElementById('opBarRc'),
      blockers: startBlockers() };
    window.__reset(); handleScanValue('A1');
    const s = window.__scans()[0] || {};
    out.user = s.user; out.recOp = s.op;
    return out;
  });
  check('PIN ถูก → ตั้งผู้นับ ปิดหน้าเลือก', r3.op === 'op1' && !r3.overlay, r3);
  check('เข้าหน้ายิงต่อเอง + navScan ปลดล็อก', r3.page === 'scan' && r3.navScan === false, r3);
  check('ด่านผู้นับหายจาก startBlockers', !r3.blockers.some(b => /ผู้นับ/.test(b)), r3.blockers);
  check('แถบผู้นับบนหน้ายิง + หน้ารีเช็ค', r3.bar && r3.rcBar && r3.barName === 'แนน', r3);
  check('fresh=true → แถบเตือนชวนเปลี่ยน PIN', r3.fresh, r3);
  check('ยิงแล้ว rec.user/op เป็นของแนน', r3.user === 'แนน · สมชาย' && r3.recOp === 'u1:op1', r3);

  /* ---------- 4. สลับคน ---------- */
  console.log('\n[4] สลับคน → ต้องใส่ PIN ใหม่ · ยอดลงคนใหม่ · undo ไม่ติด');
  await page.evaluate(() => { state.undoStack = [{ key: 'A1', delta: 1 }]; });
  await clickSel('#opBar [data-opbar="switch"]');
  const r4a = await page.evaluate(() => ({ op: state.currentOp, overlay: !!document.getElementById('opPick'),
    undo: state.undoStack.length, bar: !!document.getElementById('opBar'), counter: state.counter }));
  check('สลับคน → ล้างผู้นับ เปิดหน้าเลือก ถอดแถบ', r4a.op === null && r4a.overlay && !r4a.bar && r4a.counter === 'สมชาย', r4a);
  check('undo ของคนก่อนถูกทิ้ง', r4a.undo === 0, r4a);
  await clickSel('#opPick [data-opid="op2"]');
  await pad(['5', '6', '7', '8']);
  const r4 = await page.evaluate(() => {
    window.__reset(); handleScanValue('A1');
    const s = window.__scans()[0] || {};
    return { op: state.currentOp, user: s.user, recOp: s.op, fresh: !!document.querySelector('#opBar [data-opfresh]'),
             name: (document.querySelector('#opBar [data-opname]') || {}).textContent };
  });
  check('คนใหม่ → rec.user/op ของบี', r4.op === 'op2' && r4.user === 'บี · สมชาย' && r4.recOp === 'u1:op2', r4);
  check('fresh=false → ไม่มีแถบเตือน', r4.fresh === false && r4.name === 'บี', r4);

  /* ---------- 5. เปลี่ยน PIN ---------- */
  console.log('\n[5] เปลี่ยน PIN ตัวเอง');
  await page.evaluate(() => window.__reset());
  await clickSel('#opBar [data-opbar="pin"]'); await wait(80);
  await page.evaluate(() => window.__answer({ a: '2468', b: '1357' })); await wait(100);
  const r5m = await page.evaluate(() => ({ toast: window.__lastToast(), upd: window.__upd.length }));
  check('PIN สองช่องไม่ตรงกัน → ไม่เขียน', /ไม่ตรงกัน/.test(r5m.toast) && r5m.upd === 0, r5m);
  await clickSel('#opBar [data-opbar="pin"]'); await wait(80);
  await page.evaluate(() => window.__answer({ a: '12a4', b: '12a4' })); await wait(100);
  const r5b = await page.evaluate(() => ({ toast: window.__lastToast(), upd: window.__upd.length }));
  check('PIN ไม่ใช่ตัวเลข 4 หลัก → ไม่เขียน', /4 หลัก/.test(r5b.toast) && r5b.upd === 0, r5b);
  await clickSel('#opBar [data-opbar="pin"]'); await wait(80);
  await page.evaluate(() => window.__answer({ a: '2468', b: '2468' })); await wait(150);
  const r5 = await page.evaluate(async () => {
    const u = window.__upd[0] || {};
    const out = { path: u.path, patch: u.patch, fresh: state.operators.op2.fresh, toast: window.__lastToast() };
    clearCurrentOp();
    out.oldPin = await setCurrentOp('op2', '5678');
    out.newPin = await setCurrentOp('op2', '2468');
    out.notCur = await changeOwnPin('1111').then(() => 'ok', e => e.userMessage);
    return out;
  });
  check('เขียน operators/u1/op2 ด้วย update {pinHash,fresh:false}',
        r5.path === 'operators/u1/op2' && r5.patch && r5.patch.fresh === false && r5.patch.pinHash === sha('u1|op2|2468') &&
        Object.keys(r5.patch).sort().join() === 'fresh,pinHash', r5);
  check('fresh เป็น false ในเครื่องทันที', r5.fresh === false, r5);
  check('PIN เก่าใช้ไม่ได้ · PIN ใหม่ใช้ได้', r5.oldPin === false && r5.newPin === true, r5);

  /* ---------- 6. ⚙️ จัดการ ---------- */
  console.log('\n[6] ⚙️ จัดการผู้นับ — reauth · สุ่มใหม่ · เพิ่ม · ปิดใช้งาน');
  await page.evaluate(() => {
    window.__pwCalls = [];
    window.session.verifyPassword = function (email, pw, uid) {
      window.__pwCalls.push({ email: email, uid: uid });
      return Promise.resolve(pw === 'right');
    };
    clearCurrentOp(); refreshNav(); openOpPick('scan'); window.__reset();
  });
  await clickSel('#opPick [data-opact="manage"]'); await wait(80);
  await page.evaluate(() => window.__answer({ pw: 'wrong' })); await wait(100);
  const r6a = await page.evaluate(() => ({ manage: opUi.manage, addBtn: !!document.querySelector('#opPick [data-opact="add"]'),
    toast: window.__lastToast(), call: window.__pwCalls[0] }));
  check('reauth รหัสผิด → ไม่เปิดหน้าจัดการ', !r6a.manage && !r6a.addBtn && /รหัสผ่านไม่ถูกต้อง/.test(r6a.toast), r6a);
  check('reauth ส่งอีเมล+uid ของบัญชีที่ล็อกอินอยู่', r6a.call && r6a.call.email === 'u1@x' && r6a.call.uid === 'u1', r6a.call);
  /* จำกัดเวลา — ถ้าด่านหาย opAddUi จะเปิด modal ค้างรอคนตอบ เทสต้อง "ตก" ไม่ใช่ "ค้าง" (run-all ไม่มี timeout) */
  const r6g = await page.evaluate(() => {
    let p;
    try { p = Promise.resolve(opAddUi()); } catch (e) { p = Promise.resolve(); }
    return Promise.race([p.then(() => 'done'), new Promise(r => setTimeout(() => r('pending'), 600))]).then(st => {
      const out = { st, toast: window.__lastToast(), modal: window.__modalOpen() };
      if (out.modal) window.__answer({}, false);
      return out;
    });
  });
  check('เรียกเพิ่มผู้นับจาก Console โดยไม่ผ่าน reauth → ถูกกัน', /ใส่รหัสผ่านบัญชีก่อน/.test(r6g.toast) && !r6g.modal, r6g);
  await clickSel('#opPick [data-opact="manage"]'); await wait(80);
  await page.evaluate(() => window.__answer({ pw: 'right' })); await wait(100);
  const r6b = await page.evaluate(() => ({ manage: opUi.manage, rows: document.querySelectorAll('#opPick [data-oprow]').length,
    pinShown: /[0-9a-f]{64}/.test(document.getElementById('opPick').textContent) }));
  check('reauth รหัสถูก → เปิดหน้าจัดการ เห็นผู้นับครบ', r6b.manage && r6b.rows === 2, r6b);
  check('หน้าจัดการไม่โชว์ PIN/hash', r6b.pinShown === false, r6b);

  /* สุ่ม PIN ใหม่ */
  await page.evaluate(() => window.__reset());
  await clickSel('#opPick [data-opreset="op1"]'); await wait(150);
  const r6c = await page.evaluate(async () => {
    const pin = (document.querySelector('#modalDetail [data-oppin]') || {}).textContent || '';
    window.__answer({}); await new Promise(r => setTimeout(r, 50));
    const u = window.__upd[0] || {};
    return { pin, path: u.path, patch: u.patch, fresh: state.operators.op1.fresh,
             newOk: await setCurrentOp('op1', pin).then(ok => { clearCurrentOp(); return ok; }),
             oldOk: pin === '1234' ? false : await setCurrentOp('op1', '1234').then(ok => { clearCurrentOp(); return ok; }) };
  });
  check('สุ่ม PIN ใหม่ → โชว์เลข 4 หลักครั้งเดียว', /^[0-9]{4}$/.test(r6c.pin), r6c.pin);
  check('เขียน {pinHash ใหม่, fresh:true} ด้วย update', r6c.path === 'operators/u1/op1' && r6c.patch.fresh === true &&
        r6c.patch.pinHash === sha('u1|op1|' + r6c.pin) && Object.keys(r6c.patch).sort().join() === 'fresh,pinHash', r6c);
  check('PIN ใหม่ใช้ได้ · PIN เก่า (1234) ใช้ไม่ได้', r6c.newOk === true && r6c.oldOk === false, r6c);

  /* เพิ่มผู้นับ — ชื่อซ้ำทุกแบบต้องถูกปฏิเสธ */
  async function tryAdd(name) {
    await page.evaluate(() => window.__reset());
    await clickSel('#opPick [data-opact="add"]'); await wait(80);
    await page.evaluate(n => window.__answer({ name: n }), name); await wait(150);
    return page.evaluate(() => ({ toast: window.__lastToast(), upd: window.__upd.slice(), pin: (document.querySelector('#modalDetail [data-oppin]') || {}).textContent || '' }));
  }
  const dupAcct = await tryAdd('สมชาย');
  check('ชื่อซ้ำชื่อบัญชีตัวเอง → ปฏิเสธ ไม่เขียน', /ซ้ำกับชื่อบัญชีผู้ใช้/.test(dupAcct.toast) && dupAcct.upd.length === 0, dupAcct);
  const dupUser = await tryAdd('ป้อม');
  check('ชื่อซ้ำผู้ใช้คนอื่นในทะเบียน → ปฏิเสธ', /ซ้ำกับชื่อบัญชีผู้ใช้/.test(dupUser.toast) && dupUser.upd.length === 0, dupUser);
  const dupOp = await tryAdd('  แนน ');
  check('ชื่อซ้ำผู้นับเดิม (เว้นวรรคเกิน) → ปฏิเสธ', /มีอยู่แล้วในผู้นับ/.test(dupOp.toast) && dupOp.upd.length === 0, dupOp);
  const added = await tryAdd('ต้น');
  const r6d = await page.evaluate(async () => {
    window.__answer({}); await new Promise(r => setTimeout(r, 50));
    const ids = Object.keys(state.operators).filter(id => state.operators[id].name === 'ต้น');
    return { ids, rec: ids[0] && state.operators[ids[0]],
             rows: document.querySelectorAll('#opPick [data-oprow]').length };
  });
  const addW = added.upd[0] || {};
  const addRec = addW.patch && addW.patch[r6d.ids[0]];
  check('เพิ่ม "ต้น" → โชว์ PIN 4 หลัก', /^[0-9]{4}$/.test(added.pin), added);
  check('เขียนด้วย update ที่ operators/u1 คีย์ opId เดียว', addW.path === 'operators/u1' && Object.keys(addW.patch || {}).length === 1 && !!addRec, addW);
  check('เรคอร์ดใหม่ครบ name/pinHash/fresh:true/active:true/createdAt ไม่มี PIN ดิบ',
        addRec && addRec.name === 'ต้น' && addRec.fresh === true && addRec.active === true &&
        typeof addRec.createdAt === 'number' && addRec.pinHash === sha('u1|' + r6d.ids[0] + '|' + added.pin) &&
        Object.keys(addRec).sort().join() === 'active,createdAt,fresh,name,pinHash', addRec);
  check('รายการในหน้าจัดการเพิ่มเป็น 3', r6d.rows === 3, r6d);

  /* ปิดใช้งาน */
  await page.evaluate(() => window.__reset());
  await clickSel('#opPick [data-opoff="op2"]'); await wait(80);
  await page.evaluate(() => window.__answer({})); await wait(120);
  const r6e = await page.evaluate(async () => {
    const u = window.__upd[0] || {};
    const out = { path: u.path, patch: u.patch, active: state.operators.op2.active, still: !!state.operators.op2,
                  rowOff: !!document.querySelector('#opPick [data-oprow="op2"].off'),
                  resetBtn: !!document.querySelector('#opPick [data-opreset="op2"]') };
    out.canPin = await setCurrentOp('op2', '2468');
    return out;
  });
  check('ปิดใช้งาน = update {active:false} ไม่ลบโหนด', r6e.path === 'operators/u1/op2' && JSON.stringify(r6e.patch) === '{"active":false}' && r6e.still, r6e);
  check('แถวขึ้น "ปิดแล้ว" ไม่มีปุ่มสุ่ม PIN', r6e.rowOff && !r6e.resetBtn, r6e);
  check('PIN ถูกก็เข้าไม่ได้แล้ว', r6e.canPin === false, r6e);

  await clickSel('#opPick [data-opact="done"]'); await wait(50);
  const r6f = await page.evaluate(() => ({ manage: opUi.manage, view: opUi.view,
    cards: Array.from(document.querySelectorAll('#opPick [data-opid]')).map(e => e.getAttribute('data-opid')) }));
  check('เสร็จ → ล็อกหน้าจัดการ กลับหน้าการ์ด', r6f.manage === false && r6f.view === 'cards', r6f);
  check('การ์ดไม่มีคนที่ปิดใช้งาน', r6f.cards.indexOf('op2') < 0 && r6f.cards.indexOf('op1') >= 0 && r6f.cards.length === 2, r6f);

  /* ปิดใช้งานคนที่กำลังเลือกอยู่ → หลุดทันที */
  const r6h = await page.evaluate(async (OPS) => {
    closeOpPick();
    state.operators.op9 = { name: 'เก้า', pinHash: OPS.op1.pinHash.replace(/./, 'f'), active: true, createdAt: 9 };
    state.currentOp = 'op1'; syncCounter();
    opUi.manage = true;
    await deactivateOperator('op1');
    return { op: state.currentOp, counter: state.counter };
  }, OPS);
  check('ปิดคนที่เลือกอยู่ → ล้างผู้นับทันที', r6h.op === null && r6h.counter === 'สมชาย', r6h);

  /* เน็ตหลุดตอนบันทึก */
  const r6i = await page.evaluate(() => {
    window.__updFail = true;
    return resetOperatorPin('op9').then(() => 'ok', e => e.userMessage).then(m => { window.__updFail = false; return m; });
  });
  check('บันทึกไม่สำเร็จ → บอกให้ตรวจสัญญาณ', /ตรวจสัญญาณ/.test(r6i), r6i);

  /* ---------- 7. ไม่มี crypto.subtle ---------- */
  console.log('\n[7] อุปกรณ์ไม่รองรับ hash → ไม่เขียน + บอกเหตุผล');
  const r7 = await page.evaluate(async () => {
    window.__reset();
    const realCan = window.opCanHash, realHash = window.opPinHash;
    window.opCanHash = function () { return false; };
    const a = await addOperator('ใหม่').then(() => 'ok', e => e.userMessage);
    const b = await resetOperatorPin('op9').then(() => 'ok', e => e.userMessage);
    window.opCanHash = realCan;
    window.opPinHash = function () { return Promise.reject(new Error('boom')); };
    const c = await resetOperatorPin('op9').then(() => 'ok', e => e.userMessage);
    const d = await addOperator('ใหม่สอง').then(() => 'ok', e => e.userMessage);
    window.opPinHash = realHash;
    return { a, b, c, d, upd: window.__upd.length };
  });
  check('ไม่มี crypto.subtle → addOperator ปฏิเสธ', /ไม่รองรับการตั้ง PIN/.test(r7.a), r7);
  check('ไม่มี crypto.subtle → resetOperatorPin ปฏิเสธ', /ไม่รองรับการตั้ง PIN/.test(r7.b), r7);
  check('hash พัง → ปฏิเสธทั้งสุ่มใหม่และเพิ่ม', /ไม่รองรับการตั้ง PIN/.test(r7.c) && /ไม่รองรับการตั้ง PIN/.test(r7.d), r7);
  check('ไม่มีการเขียนฐานเลย', r7.upd === 0, r7);

  /* ---------- 8. verifyPassword (REST) ---------- */
  console.log('\n[8] session.verifyPassword — ฝั่ง REST จริง (stub fetch)');
  await page.reload({ waitUntil: 'load' }); await wait(600);
  const r8 = await page.evaluate(async () => {
    const realFetch = window.fetch, tok = session.token();
    const calls = [];
    function reply(status, body) {
      return function (u, o) { calls.push({ u: String(u), body: JSON.parse(o.body) });
        return Promise.resolve(new Response(JSON.stringify(body), { status: status })); };
    }
    window.REMOTE_MODE = true;
    const out = {};
    try {
      window.fetch = reply(200, { localId: 'u1' });          out.ok = await session.verifyPassword('a@x', 'pw', 'u1');
      window.fetch = reply(200, { localId: 'zz' });          out.otherUid = await session.verifyPassword('a@x', 'pw', 'u1');
      window.fetch = reply(400, { error: { message: 'INVALID_PASSWORD' } }); out.badPw = await session.verifyPassword('a@x', 'pw', 'u1');
      window.fetch = reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }); out.badCred = await session.verifyPassword('a@x', 'pw', 'u1');
      window.fetch = reply(400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : x' } });
      out.tooMany = await session.verifyPassword('a@x', 'pw', 'u1').then(() => 'resolved', e => e.authCode);
      window.fetch = function () { return Promise.reject(new TypeError('offline')); };
      out.net = await session.verifyPassword('a@x', 'pw', 'u1').then(() => 'resolved', e => e.authCode);
      out.empty = await session.verifyPassword('a@x', '', 'u1');
    } finally { window.fetch = realFetch; window.REMOTE_MODE = false; }
    out.body = calls[0] && calls[0].body; out.url = calls[0] && calls[0].u;
    out.tokSame = session.token() === tok;
    return out;
  });
  check('รหัสถูก + localId ตรง → true', r8.ok === true, r8);
  check('localId ไม่ตรง uid ที่ล็อกอิน → false', r8.otherUid === false, r8);
  check('INVALID_PASSWORD / INVALID_LOGIN_CREDENTIALS → false', r8.badPw === false && r8.badCred === false, r8);
  check('TOO_MANY_ATTEMPTS → throw ให้บอกเหตุผล', r8.tooMany === 'TOO_MANY_ATTEMPTS_TRY_LATER', r8);
  check('เน็ตหลุด → throw NETWORK', r8.net === 'NETWORK', r8);
  check('รหัสว่าง → false ไม่ยิงเน็ต', r8.empty === false, r8);
  check('ยิง signInWithPassword · returnSecureToken:false (ไม่แตะ session)',
        /signInWithPassword/.test(r8.url || '') && r8.body && r8.body.returnSecureToken === false && r8.tokSame, r8);

  /* ---------- 9. ปุ่ม ⚙️ ในการ์ดบัญชี ---------- */
  console.log('\n[9] ปุ่ม ⚙️ จัดการผู้นับ ในการ์ดบัญชี');
  await page.evaluate(HARNESS);
  const r9 = await page.evaluate(() => {
    window.__ops = {};
    window.__seed('scanner'); renderAccount();
    const scanner = { b1: !!document.getElementById('btnOpManage'), b2: !!document.getElementById('btnOpManage2') };
    window.__seed('viewer'); renderAccount();
    const viewer = { b1: !!document.getElementById('btnOpManage'), b2: !!document.getElementById('btnOpManage2') };
    return { scanner, viewer };
  });
  check('บัญชีที่ยิงได้ → มีปุ่ม ⚙️ ทั้งสองการ์ด', r9.scanner.b1 && r9.scanner.b2, r9);
  check('viewer (ยิงไม่ได้) → ไม่มีปุ่ม', !r9.viewer.b1 && !r9.viewer.b2, r9);

  console.log('\n[errors] ' + (errors.length ? errors.join('\n') : 'ไม่มี'));
  check('ไม่มี error บนหน้า', errors.length === 0, errors);

  await browser.close();
  srv.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
