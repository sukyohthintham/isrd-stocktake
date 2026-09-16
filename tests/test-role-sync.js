/* ============================================================
   ซิงก์สิทธิ์สด (role / active) — v2.11.0
   ============================================================

   ช่องโหว่ที่ปิด: loadMyProfile() อ่าน users/<uid> ครั้งเดียวตอนบูต
   แอดมินลดสิทธิ์หรือปิดบัญชีแล้ว เครื่องที่เปิดค้างยังถือสิทธิ์เดิมจนกว่าจะรีเฟรชเอง
   ปุ่มระดับแอดมินยังกดได้ (ฐานปฏิเสธก็จริง แต่จอเปิดให้ทำ = ผิดกฎ defense-in-depth ชั้นจอ)

   ⚠️ ข้อห้ามที่เทสไฟล์นี้ต้องกันไว้ตลอดไป: ห้ามเพิ่มสายค้าง (EventSource) ใหม่
   HTTP/1.1 เปิดได้ ~6 สายต่อโฮสต์ ตอนนี้ใช้ไปแล้ว 4 (cycles · roundIndex · scans · unknown)
   สายที่ 5 จะเหลือช่องให้ PATCH ตอนยิงแค่สายเดียว อาการคือ "ยิงได้ ยอดขึ้นจอ
   แต่ไม่มีอะไรถูกบันทึกและไม่มี error" การซิงก์สิทธิ์จึงต้องเป็นการอ่านเป็นครั้ง ๆ เท่านั้น

   กันอะไร:
   [1] ⭐ ไม่มีสายค้างเพิ่มเลย — ใช้ db.getQuiet อ่านผ่านคิว bgSlot ที่มีอยู่แล้ว
   [2] แคช TTL 30 วิ — กดรัว ๆ ในงานเดียวไม่ยิงซ้ำ / force ข้ามแคชได้
   [3] งานที่ทำลายของบังคับเช็คสดและรอผล (ลดสิทธิ์ · ล้างยอด · ปิดรอบ)
   [4] role ต่ำลง → ปรับจอ + เด้งออกจากหน้าที่ไม่มีสิทธิ์ + บอกเหตุผล
   [5] active=false / ถูกถอดจากทะเบียน → เตะออกจากระบบ
   [6] role สูงขึ้น → ใช้สิทธิ์ได้ทันที ไม่ต้องล็อกอินใหม่
   [7] อ่านไม่สำเร็จ (เน็ตสะดุด) → ห้ามเดาว่าโดนลดสิทธิ์แล้วเตะคนออก
   [8] แยก "ทะเบียนยังโหลดไม่เสร็จ" ออกจากกฎ last-admin
   [9] ยามเฝ้า 60 วิ หยุดตอนพับแอป
   ============================================================ */

const fs = require('fs');
const { puppeteer, CHROME, APP_URL, APP_FILE } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.enqueueWrite = function () { return Promise.resolve(); };
  window.session.token = function () { return Promise.resolve('tok'); };
  hideLogin();

  /* ดักการอ่านสิทธิ์ — นับจำนวนครั้งเพื่อพิสูจน์เรื่องแคช */
  window.__reads = [];
  window.__rec = null;
  window.__readFail = false;
  window.__installGetQuiet = function () {
    window.db.getQuiet = function (p) {
      window.__reads.push(p);
      if (window.__readFail) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(window.__rec === null ? null : JSON.parse(JSON.stringify(window.__rec)));
    };
  };
  window.db.update = function () { return Promise.resolve(); };
  /* นับเฉพาะการอ่านสิทธิ์ — การวาดหน้าจอก็ยิง getQuiet ของมันเอง (systemQty ฯลฯ)
     ถ้านับรวมจะกลายเป็นเทสเรื่องอื่นไปโดยไม่รู้ตัว */
  window.__roleReads = function () {
    return window.__reads.filter(function (p) { return p.indexOf('users/') === 0; });
  };

  /* กันไม่ให้เทสรีโหลดหน้าจริงตอนถูกเตะออก */
  window.__signedOut = 0;
  window.session.signOut = function () { window.__signedOut++; };
  window.db.closeAll = function () {};
  var realSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms) {
    /* forceSignOut หน่วง 1200ms ให้ toast ทันขึ้นจอแล้วค่อยรีโหลด — ในเทสต้องไม่รีโหลดจริง */
    if (ms === 1200) return 0;
    return realSetTimeout(fn, ms);
  };

  window.__seed = function (role) {
    state.me = { uid: 'U_OUM', email: 'o@x.z', name: 'Oum', role: role, branches: [] };
    state.counter = 'Oum';
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', jobCode: 'J1', cycleId: 'C1', branch: 'B1',
                               status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = {}; state.systemQty = {}; state.counts = {};
    state.users = {};
    window.__rec = { name: 'Oum', email: 'o@x.z', role: role, active: true };
    window.__reads = []; window.__toasts = []; window.__signedOut = 0;
    window.__readFail = false;
    window.__installGetQuiet();
    roleCheckedAt = 0;              // ล้างแคช TTL
    roleChecking = null;
    showPage('jobs');
    window.__toasts = [];
  };
`;

(async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');

  /* ---------- [1] ห้ามมีสายค้างเพิ่ม (ตรวจจากซอร์สตรง ๆ) ---------- */
  console.log('\n[1] ⭐ ห้ามเพิ่ม EventSource / db.subscribe สายใหม่');
  /* ต้องตัดคอมเมนต์ทิ้งก่อนนับ — ทั้งเอกสาร API ของชั้น db และคำเตือน "ห้ามใช้
     db.subscribe('users/<uid>')" ในโมดูลนี้เอง ก็มีข้อความเดียวกันอยู่
     ถ้านับดิบ ๆ จะได้ 6 แล้วเทสจะฟ้องผิด หรือแย่กว่านั้นคือถูกแก้ให้ผ่านแบบหลวม ๆ */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
                  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const subLines = code.split('\n').filter(l => /\bdb\.subscribe(Children)?\(/.test(l));
  check('การเรียก subscribe จริงมี 4 สายเท่าเดิม', subLines.length === 4,
        subLines.map(l => l.trim()));
  check('เป็น cycles · roundIndex · scans · unknown เท่านั้น',
        subLines.filter(l => /'cycles'|'roundIndex'|\/scans'|\/unknown'/.test(l)).length === 4,
        subLines.map(l => l.trim()));
  check('new EventSource ยังมี 2 จุดเท่าเดิม (ในชั้น db)',
        (code.match(/new EventSource/g) || []).length === 2, 'EventSource');
  check('⭐ ไม่มี subscribe ไปที่ users', !/\bdb\.subscribe(Children)?\(\s*'users/.test(code),
        subLines.map(l => l.trim()));
  check('คำเตือนห้ามเปิดสายที่ 5 เขียนไว้ในโค้ดแล้ว',
        /ห้ามใช้ db\.subscribe\('users\/<uid>'\) เด็ดขาด/.test(src), 'warning comment');
  check('ensureRoleFresh อ่านด้วย getQuiet (ผ่านคิว bgSlot)',
        /function ensureRoleFresh[\s\S]{0,900}db\.getQuiet\('users\/'/.test(src), 'getQuiet');
  check('คอมเมนต์งบสายค้างบอกจำนวนจริง 4 สาย', /ปัจจุบัน 4 สาย/.test(src), 'budget comment');

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(HARNESS);

  /* ---------- [2] แคช TTL ---------- */
  console.log('\n[2] แคช TTL 30 วิ — กดรัวไม่ยิงซ้ำ');
  const ttl = await page.evaluate(async () => {
    window.__seed('admin');
    await ensureRoleFresh();
    const first = window.__roleReads().length;
    await ensureRoleFresh();
    await ensureRoleFresh();
    await ensureRoleFresh();
    const after = window.__roleReads().length;
    roleCheckedAt = Date.now() - 31000;       // ทำให้ TTL หมดอายุ
    await ensureRoleFresh();
    return { first: first, after: after, expired: window.__roleReads().length,
             path: window.__roleReads()[0] };
  });
  check('ครั้งแรกยิงอ่านจริง 1 ครั้ง', ttl.first === 1, ttl);
  check('อ่านจาก users/<uid> ของตัวเอง', ttl.path === 'users/U_OUM', ttl);
  check('⭐ เรียกซ้ำ 3 ครั้งภายใน TTL ไม่ยิงเพิ่ม', ttl.after === 1, ttl);
  check('พ้น TTL แล้วยิงใหม่', ttl.expired === 2, ttl);

  console.log('\n[2b] force ข้าม TTL ได้');
  const forced = await page.evaluate(async () => {
    window.__seed('admin');
    await ensureRoleFresh();
    const a = window.__roleReads().length;
    await ensureRoleFresh({ force: true });
    return { a: a, b: window.__roleReads().length };
  });
  check('⭐ force ยิงใหม่ทันทีแม้เพิ่งเช็ค', forced.a === 1 && forced.b === 2, forced);

  console.log('\n[2c] กดรัวตอนคำขอยังไม่กลับ = ใช้ใบเดียวกัน');
  const inflight = await page.evaluate(async () => {
    window.__seed('admin');
    let release;
    window.db.getQuiet = function (p) {
      window.__reads.push(p);
      return new Promise(function (res) { release = function () { res(window.__rec); }; });
    };
    ensureRoleFresh(); ensureRoleFresh(); ensureRoleFresh();
    const during = window.__roleReads().length;
    release();
    await new Promise(r => setTimeout(r, 30));
    window.__installGetQuiet();
    return { during: during };
  });
  check('ยิงใบเดียวแม้เรียก 3 ครั้งพร้อมกัน', inflight.during === 1, inflight);

  console.log('\n[2d] ยังไม่ล็อกอิน = ไม่ต้องยิงเลย');
  const noop = await page.evaluate(async () => {
    window.__seed('admin');
    state.me = null;
    const a = await ensureRoleFresh({ force: true });
    return { res: a, reads: window.__roleReads().length };
  });
  check('ไม่มี state.me → ไม่ยิงอ่าน', noop.reads === 0 && noop.res === null, noop);

  /* ---------- [4] role ต่ำลง ---------- */
  console.log('\n[4] ⭐ role ต่ำลง → ปรับจอ + เด้งออกจากหน้าที่ไม่มีสิทธิ์');
  const down = await page.evaluate(async () => {
    window.__seed('admin');
    showPage('master');
    const pageBefore = state.page;
    window.__rec = { name: 'Oum', email: 'o@x.z', role: 'scanner', active: true };
    const res = await ensureRoleFresh({ force: true });
    const t = window.__toasts.slice(-1)[0] || {};
    return { res: res, pageBefore: pageBefore, pageAfter: state.page,
             role: state.me.role, isAdmin: isAdmin(), toast: t.m, bad: t.bad,
             out: window.__signedOut };
  });
  check('อยู่หน้า Master ก่อนโดนลด', down.pageBefore === 'master', down);
  check('⭐ role ใน session เปลี่ยนเป็น scanner', down.role === 'scanner', down);
  check('isAdmin() เป็นเท็จแล้ว', down.isAdmin === false, down);
  check('รายงานว่าเปลี่ยนจาก admin → scanner และเป็นการลด',
        down.res && down.res.from === 'admin' && down.res.to === 'scanner' && down.res.down === true,
        down.res);
  check('⭐ เด้งออกจากหน้าที่ไม่มีสิทธิ์แล้ว', down.pageAfter !== 'master', down);
  check('เด้งไปหน้าที่สิทธิ์ใหม่เข้าได้จริง', down.pageAfter === 'scan', down);
  check('บอกเหตุผลเป็นภาษาคน', /สิทธิ์ของคุณถูกเปลี่ยนเป็น/.test(down.toast || ''), down.toast);
  check('ขึ้นเป็นข้อความเตือน', down.bad === true, down.bad);
  check('ไม่ได้เตะออกจากระบบ (แค่ลดสิทธิ์)', down.out === 0, down.out);

  console.log('\n[4b] อยู่หน้าที่ยังมีสิทธิ์ ต้องไม่โดนเด้ง');
  const stay = await page.evaluate(async () => {
    window.__seed('admin');
    showPage('jobs');
    window.__rec = { name: 'Oum', email: 'o@x.z', role: 'counter', active: true };
    await ensureRoleFresh({ force: true });
    return { page: state.page, role: state.me.role, first: firstAllowedPage() };
  });
  check('ยังอยู่หน้ารายการ Job', stay.page === 'jobs', stay);
  check('(ไม่ใช่เพราะบังเอิญตรงกับหน้าสำรอง)', stay.first !== 'jobs', stay);
  check('role เปลี่ยนเป็น counter', stay.role === 'counter', stay);

  /* ---------- [5] ปิดบัญชี / ถูกถอด ---------- */
  console.log('\n[5] ⭐ active=false → เตะออกจากระบบทันที');
  const off = await page.evaluate(async () => {
    window.__seed('admin');
    window.__rec = { name: 'Oum', role: 'admin', active: false };
    const res = await ensureRoleFresh({ force: true });
    return { res: res, out: window.__signedOut, me: state.me,
             toast: (window.__toasts.slice(-1)[0] || {}).m, timer: rolePollTimer };
  });
  check('⭐ ถูก signOut', off.out === 1, off);
  check('รายงานว่าเป็นเคสบัญชีถูกปิด', off.res && off.res.disabled === true, off.res);
  check('บอกเหตุผลก่อนเตะ', /บัญชีนี้ถูกปิดการใช้งาน/.test(off.toast || ''), off.toast);
  check('ล้าง session ในเครื่องด้วย', off.me === null, off.me);
  check('หยุดยามเฝ้าด้วย ไม่ให้ยิงต่อหลังออก', !off.timer, off.timer);

  const gone = await page.evaluate(async () => {
    window.__seed('admin');
    window.__rec = null;                      /* ถูกถอดออกจากทะเบียน */
    const res = await ensureRoleFresh({ force: true });
    return { res: res, out: window.__signedOut, toast: (window.__toasts.slice(-1)[0] || {}).m };
  });
  check('⭐ ถูกถอดจากทะเบียน → เตะออกเหมือนกัน',
        gone.out === 1 && gone.res && gone.res.removed === true, gone);
  check('บอกเหตุผลต่างจากเคสปิดบัญชี', /ถูกถอดออกจากทะเบียน/.test(gone.toast || ''), gone.toast);

  /* ---------- [6] role สูงขึ้น ---------- */
  console.log('\n[6] role สูงขึ้น → ใช้สิทธิ์ได้ทันที ไม่ต้องล็อกอินใหม่');
  const up = await page.evaluate(async () => {
    window.__seed('scanner');
    window.__rec = { name: 'Oum', email: 'o@x.z', role: 'admin', active: true };
    const res = await ensureRoleFresh({ force: true });
    const t = window.__toasts.slice(-1)[0] || {};
    return { res: res, role: state.me.role, isAdmin: isAdmin(), toast: t.m, bad: t.bad };
  });
  check('role เป็น admin แล้ว', up.role === 'admin' && up.isAdmin === true, up);
  check('รายงานว่าเป็นการเพิ่มสิทธิ์', up.res && up.res.down === false, up.res);
  check('บอกผู้ใช้ว่าได้สิทธิ์ใหม่', /สิทธิ์ของคุณถูกปรับเป็น/.test(up.toast || ''), up.toast);
  check('ข้อความไม่ใช่แบบเตือน', up.bad !== true, up);

  console.log('\n[6b] role เท่าเดิม → ไม่ทำอะไร ไม่กวนผู้ใช้');
  const same = await page.evaluate(async () => {
    window.__seed('counter');
    const res = await ensureRoleFresh({ force: true });
    return { res: res, toasts: window.__toasts.length, role: state.me.role };
  });
  check('ไม่รายงานการเปลี่ยน', same.res === null, same);
  check('ไม่เด้ง toast กวน', same.toasts === 0, same);

  /* ---------- [7] อ่านไม่สำเร็จ ---------- */
  console.log('\n[7] ⭐ อ่านสิทธิ์ไม่สำเร็จ ห้ามเดาว่าโดนลดแล้วเตะคนออก');
  const neterr = await page.evaluate(async () => {
    window.__seed('admin');
    window.__readFail = true;
    const res = await ensureRoleFresh({ force: true });
    const after = await ensureRoleFresh({ force: true });   // ต้องยิงใหม่ได้ ไม่ค้างคาใบเดิม
    return { res: res, after: after, role: state.me.role, out: window.__signedOut,
             toasts: window.__toasts.length, reads: window.__roleReads().length };
  });
  check('ยังถือสิทธิ์เดิมต่อไป', neterr.role === 'admin', neterr);
  check('⭐ ไม่เตะออกจากระบบ', neterr.out === 0, neterr);
  check('ไม่เด้ง toast ให้ตกใจ', neterr.toasts === 0, neterr);
  check('ไม่ค้างใบเดิม ลองใหม่ได้', neterr.reads === 2, neterr);

  /* ---------- [3] ด่านบังคับเช็คสด ---------- */
  console.log('\n[3] ⭐ งานที่ทำลายของต้องเช็คสดเสมอ (ข้ามแคช)');
  const gate = await page.evaluate(async () => {
    window.__seed('admin');
    await ensureRoleFresh();                       // เติมแคชให้เต็มก่อน
    const before = window.__roleReads().length;
    window.__rec = { name: 'Oum', role: 'counter', active: true };   // โดนลดระหว่างนั้น
    const ok = await purgeUserScans('Gift');
    return { reads: window.__roleReads().length - before, ok: ok, role: state.me.role,
             toast: (window.__toasts.slice(-1)[0] || {}).m };
  });
  check('แคชเต็มอยู่แต่ยังยิงอ่านสดอีกครั้ง', gate.reads === 1, gate);
  check('⭐ พอรู้ว่าโดนลดสิทธิ์แล้ว ล้างยอดไม่ได้', gate.ok === false, gate);
  check('role ถูกอัปเดตเป็น counter', gate.role === 'counter', gate);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /ล้างยอดของผู้ใช้ไม่ได้/.test(gate.toast || ''), gate.toast);

  const gateOk = await page.evaluate(async () => {
    window.__seed('admin');
    let planned = 0;
    var realPlan = window.planUserPurge;
    window.planUserPurge = function () {
      planned++;
      return Promise.resolve({ rowCount: 0, skipped: [], before: 0 });
    };
    const ok = await purgeUserScans('Gift');
    window.planUserPurge = realPlan;
    return { planned: planned, ok: ok };
  });
  check('ยังเป็น admin จริง → ผ่านด่านไปทำงานต่อได้', gateOk.planned === 1, gateOk);

  check('ปิดรอบมีด่านบังคับเช็คสด',
        /function closeRound\(\)[\s\S]{0,500}ensureRoleFresh\(\{ force: true \}\)/.test(src), 'closeRound');
  check('ปิดรอบตรวจสิทธิ์ซ้ำหลังได้ผลสด',
        /ensureRoleFresh\(\{ force: true \}\)[\s\S]{0,160}requirePerm\('closeJob', 'ปิด Job ไม่ได้'\)/.test(src),
        'closeRound recheck');
  check('แก้สิทธิ์ผู้ใช้มีด่านบังคับเช็คสด',
        /function saveUserField\([\s\S]{0,600}ensureRoleFresh\(\{ force: true \}\)/.test(src), 'saveUserField');
  check('requireAdmin/requirePerm กระทุ้งตรวจเบื้องหลัง',
        /function requireAdmin\(what\) \{\s*touchRoleCheck\(\);/.test(src) &&
        /function requirePerm\(cap, what\) \{\s*touchRoleCheck\(\);/.test(src), 'guards');

  console.log('\n[3b] guard ปกติต้องไม่หน่วงจอ (ยังคืนค่าทันที ไม่ใช่ promise)');
  const sync = await page.evaluate(() => {
    window.__seed('admin');
    const r = requireAdmin('ทดสอบ');
    return { val: r, type: typeof r, reads: window.__roleReads().length };
  });
  check('⭐ requireAdmin ยังคืน true/false ทันที ไม่ใช่ promise',
        sync.val === true && sync.type === 'boolean', sync);
  check('แต่กระทุ้งให้ไปอ่านสิทธิ์เบื้องหลังแล้ว', sync.reads === 1, sync);

  /* ---------- [8] ทะเบียนยังไม่โหลด vs last-admin ---------- */
  console.log('\n[8] ⭐ "ทะเบียนยังโหลดไม่เสร็จ" ต้องไม่ปนกับกฎ last-admin');
  check('มีสาขาแยกสำหรับทะเบียนว่าง', /ทะเบียนผู้ใช้ยังโหลดไม่เสร็จ/.test(src), 'empty-registry');
  check('ข้อความต่างจากกฎ last-admin',
        /ระบบต้องมีผู้ดูแลอย่างน้อย 1 คน/.test(src), 'last-admin msg');
  check('เคสทะเบียนว่างสั่งโหลดทะเบียนใหม่ให้',
        /ทะเบียนผู้ใช้ยังโหลดไม่เสร็จ[\s\S]{0,200}refreshUsers\(\)/.test(src), 'refreshUsers');
  check('เคสทะเบียนว่างเช็คก่อนกฎ last-admin',
        src.indexOf('ทะเบียนผู้ใช้ยังโหลดไม่เสร็จ') < src.indexOf('ระบบต้องมีผู้ดูแลอย่างน้อย 1 คน'),
        'order');
  check('ทั้งสองเคสคืนค่า select กลับเป็น admin ไม่ให้จอโกหก',
        (src.match(/sel2\.value = 'admin';/g) || []).length === 2, 'revert select');
  check('กำแพง "ห้ามเปลี่ยนสิทธิ์ตัวเอง" ยังอยู่ครบ',
        /เปลี่ยนสิทธิ์ของตัวเองไม่ได้/.test(src), 'self-guard');

  const cnt = await page.evaluate(() => {
    window.__seed('admin');
    state.users = {};
    const empty = activeAdminCount('U_OUM');
    state.users = { A: { role: 'admin', active: true }, B: { role: 'counter', active: true },
                    C: { role: 'admin', active: false } };
    return { empty: empty, one: activeAdminCount('X'), selfOut: activeAdminCount('A') };
  });
  check('ทะเบียนว่างนับได้ 0 (จึงต้องแยกเคสก่อน)', cnt.empty === 0, cnt);
  check('นับเฉพาะ admin ที่ยังเปิดใช้งาน', cnt.one === 1, cnt);
  check('ไม่นับตัวเองตอนกำลังจะลดสิทธิ์ตัวเอง', cnt.selfOut === 0, cnt);

  /* ---------- [9] ยามเฝ้า ---------- */
  console.log('\n[9] ยามเฝ้า 60 วิ — หยุดตอนพับแอป');
  check('เริ่มยามเฝ้าตอน startApp', /startRolePoll\(\);/.test(src), 'startRolePoll');
  check('ตั้งรอบ 60 วิ', /ROLE_POLL_MS = 60000/.test(src), 'ROLE_POLL_MS');
  check('ตั้ง TTL 30 วิ', /ROLE_FRESH_TTL = 30000/.test(src), 'ROLE_FRESH_TTL');
  check('⭐ หยุดตอน document.hidden', /document\.hidden\) return;/.test(src), 'hidden');
  check('ยามเฝ้าใช้ force เพื่อไม่ให้แคชบัง',
        /rolePollTimer = setInterval\([\s\S]{0,260}ensureRoleFresh\(\{ force: true \}\)/.test(src),
        'poll force');

  const poll = await page.evaluate(async () => {
    stopRolePoll();
    window.__seed('admin');
    const fns = [];
    const realSI = window.setInterval, realCI = window.clearInterval;
    window.setInterval = function (fn, ms) { fns.push({ fn: fn, ms: ms }); return 99; };
    window.clearInterval = function () {};
    startRolePoll();
    const started = fns.length;
    startRolePoll();                       // เรียกซ้ำต้องไม่ตั้งซ้อน
    const again = fns.length;
    const ms = fns[0] ? fns[0].ms : 0;

    /* พับแอปอยู่ = ต้องไม่ยิง */
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
    window.__reads = [];
    fns[0].fn();
    await new Promise(r => setTimeout(r, 20));
    const hiddenReads = window.__roleReads().length;

    /* กลับมาเปิดจอ = ยิง แม้แคชเพิ่งเติม */
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
    roleCheckedAt = Date.now();
    fns[0].fn();
    await new Promise(r => setTimeout(r, 20));
    const shownReads = window.__roleReads().length;

    window.setInterval = realSI; window.clearInterval = realCI;
    rolePollTimer = null;
    delete document.hidden;
    return { started: started, again: again, ms: ms,
             hiddenReads: hiddenReads, shownReads: shownReads };
  });
  check('ตั้งยามเฝ้า 1 ตัว', poll.started === 1, poll);
  check('เรียก startRolePoll ซ้ำไม่ตั้งซ้อน', poll.again === 1, poll);
  check('รอบ 60 วินาที', poll.ms === 60000, poll);
  check('⭐ พับแอปอยู่ไม่ยิงเลย (ไม่แย่งเน็ตคนนับ)', poll.hiddenReads === 0, poll);
  check('⭐ กลับมาเปิดจอแล้วยิง แม้แคชเพิ่งเติม', poll.shownReads === 1, poll);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
