/* ทดสอบหน้าสรุปผลงานยิงรายคน (v2.37.9) — รวม scans รายคน/สาขา + flag ยิงน้อย/เริ่มสาย + Excel
 * + admin-only · กรองข้ามสาขา (canSeeBranch) · โหลดล้มไม่ซ่อนเงียบ · กันผลรอบเก่าทับรอบใหม่ */
const { puppeteer, CHROME, APP_URL } = require('./_env');
let pass = 0, fail = 0;
function check(n, ok, g) { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + '  -> ' + JSON.stringify(g)); } }
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => {
    if (typeof hideLogin === 'function') hideLogin();
    window.toast = () => {}; window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = () => {};
    window.isAdmin = () => true;                                   /* หน้านี้ admin-only */
    window.__allowBranch = true; window.canSeeBranch = (bc) => window.__allowBranch;  /* สิทธิ์เห็นสาขา (สลับได้ในเทส) */
    window.liveCountingCycles = () => ['C1'];
    window.jobsInCycle = () => ['J1'];
    window.cycleBranch = () => ({ branchCode: 'B1', branchName: 'สาขาทดสอบ' });
    window.cycleGroups = () => ({ C1: { id: 'C1', branchCode: 'B1', branchName: 'สาขาทดสอบ', createdAt: Date.now() },
                                 C2: { id: 'C2', branchCode: 'B2', branchName: 'สาขาสอง', createdAt: Date.now() - 1000 } });
    window.__status = { C1: 'counting', C2: 'closed' };
    window.cycleStatus = (cid) => window.__status[cid] || 'closed';
    var T8 = new Date(2026, 9, 20, 8, 0, 0).getTime(), T830 = new Date(2026, 9, 20, 8, 30, 0).getTime(), T11 = new Date(2026, 9, 20, 11, 0, 0).getTime();
    window.__scans = { s1: { code: 'A', delta: 50, ts: T8, user: 'สมชาย' }, s2: { code: 'B', delta: 30, ts: T830, user: 'สมชาย' }, s3: { code: 'A', delta: 5, ts: T11, user: 'สมหญิง' } };
    window.__scansOk = function (p) { if (String(p).indexOf('/scans') >= 0) return Promise.resolve(window.__scans); return Promise.resolve({}); };
    window.db.getQuiet = window.__scansOk;
    window.__xlsx = null; window.buildXlsx = function (sh) { window.__xlsx = sh; return new Blob(['x']); };
    state.summaryTab = 'staff';
  });

  /* ---- 1) การรวมยอดพื้นฐาน ---- */
  const r = await page.evaluate(async () => {
    state.staffScope = 'live'; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    var b = state.staffReport.branches[0], u0 = b.users[0], u1 = b.users[1];
    return { n: state.staffReport.branches.length, pieces: b.pieces,
      u0: { user: u0.user, pieces: u0.pieces, skus: u0.skus, firstT: u0.firstT, firstH: u0.firstH },
      u1: { user: u1.user, pieces: u1.pieces, skus: u1.skus, firstH: u1.firstH } };
  });
  check('รวม 1 สาขา · ยอดรวม 85 ชิ้น', r.n === 1 && r.pieces === 85, r);
  check('เรียงชิ้นมากสุด: สมชาย 80 ชิ้น 2 SKU เริ่ม 08:00', r.u0.user === 'สมชาย' && r.u0.pieces === 80 && r.u0.skus === 2 && r.u0.firstT === '08:00' && r.u0.firstH === 8, r.u0);
  check('สมหญิง 5 ชิ้น 1 SKU เริ่ม 11 โมง', r.u1.user === 'สมหญิง' && r.u1.pieces === 5 && r.u1.skus === 1 && r.u1.firstH === 11, r.u1);

  /* ---- 2) Excel + flag ---- */
  const x = await page.evaluate(() => {
    exportStaffExcel(); var sh = window.__xlsx[0];
    var late = sh.rows.filter(row => row[1] === 'สมหญิง')[0];
    return { name: sh.name, head: sh.rows[0], note: late && late[6] };
  });
  check('Excel ชีต "ผลงานยิง" หัว 7 คอลัมน์', x.name === 'ผลงานยิง' && x.head.length === 7 && x.head[0] === 'สาขา' && x.head[2] === 'จำนวนชิ้น', x);
  check('flag สมหญิง: ยิงน้อยผิดปกติ + เริ่มหลัง 10 โมง', x.note.indexOf('ยิงน้อย') >= 0 && x.note.indexOf('เริ่มหลัง 10') >= 0, x);

  /* ---- 2b) วันที่ต้องติดทั้งใน Excel และบนจอ (ข้ามวัน/รอบเก่าจะได้รู้วันไหน) ---- */
  const xdate = await page.evaluate(() => {
    exportStaffExcel(); var sh = window.__xlsx[0];
    var somchai = sh.rows.filter(row => row[1] === 'สมชาย')[0];
    state.summaryTab = 'staff'; renderStaffReport();
    var box = document.getElementById('sumStaff');
    return { xlsStart: somchai && somchai[4], screenHasDate: /\d{2}\/\d{2} \d{2}:\d{2}/.test(box.textContent) };
  });
  check('Excel: คอลัมน์เริ่มยิงมีวันที่ (DD/MM/YY HH:MM)', /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(xdate.xlsStart) && xdate.xlsStart.indexOf('20/10') === 0, xdate);
  check('หน้าเว็บ: แถวผู้ยิงมีวันที่กำกับเวลา (DD/MM HH:MM)', xdate.screenHasDate === true, xdate);

  /* ---- 3) เลือกดูรอบเก่าที่ปิดแล้ว ---- */
  const rsc = await page.evaluate(async () => {
    state.staffScope = 'C_OLD'; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    return { n: state.staffReport.branches.length };
  });
  check('เลือกรอบเฉพาะ (รอบเก่าที่ปิดแล้ว) โหลดผลงานยิงได้', rsc.n === 1, rsc);

  /* ---- 4) โหลด scans ล้ม → ต้องเตือน ไม่ซ่อนเงียบ ไม่ตัดสิน OT ---- */
  const rf = await page.evaluate(async () => {
    window.jobsInCycle = () => ['J1', 'J2'];
    window.db.getQuiet = function (p) {
      if (String(p).indexOf('J2/scans') >= 0) return Promise.reject(new Error('net'));   /* J2 ล้มทั้งครั้งแรกและ retry */
      if (String(p).indexOf('/scans') >= 0) return Promise.resolve(window.__scans);
      return Promise.resolve({});
    };
    state.staffScope = 'live'; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    var b = state.staffReport.branches[0];
    state.summaryTab = 'staff'; renderStaffReport();
    var box = document.getElementById('sumStaff');
    var flagSpans = Array.prototype.slice.call(box.querySelectorAll('span.badge.red'));
    var hasRedFlag = flagSpans.some(function (s) { return s.textContent.indexOf('🔴 ยิงน้อย') >= 0 || s.textContent.indexOf('🟠') >= 0; });
    var hasWarn = /โหลดไม่ครบ/.test(box.textContent);
    exportStaffExcel(); var sh = window.__xlsx[0];
    var note = sh.rows[1] ? sh.rows[1][6] : '';
    window.jobsInCycle = () => ['J1']; window.db.getQuiet = window.__scansOk;   /* คืนค่าให้เทสถัดไป */
    return { failed: b.failed, jobs: b.jobs, pieces: b.pieces, note: note, hasRedFlag: hasRedFlag, hasWarn: hasWarn };
  });
  check('โหลด scans ล้ม → นับ failed = 1/2 Job (ไม่ซ่อนเงียบ)', rf.failed === 1 && rf.jobs === 2, rf);
  check('โหลดล้ม → โชว์ badge เตือน "โหลดไม่ครบ"', rf.hasWarn === true, rf);
  check('โหลดล้ม → งดตี flag ยิงน้อย/เริ่มสาย (กันตัดสิน OT ผิด)', rf.hasRedFlag === false, rf);
  check('โหลดล้ม → Excel หมายเหตุ "ข้อมูลไม่ครบ"', String(rf.note).indexOf('ข้อมูลไม่ครบ') >= 0, rf);

  /* ---- 4b) สาขาที่โหลดล้ม "ทุก Job" (Job เดียว) → users ว่าง — ห้ามอ่านเป็น "ยังไม่มีใครยิง" ---- */
  const rfa = await page.evaluate(async () => {
    window.jobsInCycle = () => ['J1'];
    window.db.getQuiet = function (p) { if (String(p).indexOf('/scans') >= 0) return Promise.reject(new Error('net')); return Promise.resolve({}); };
    state.staffScope = 'live'; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    var b = state.staffReport.branches[0];
    state.summaryTab = 'staff'; renderStaffReport();
    var box = document.getElementById('sumStaff');
    var cardTxt = box.textContent;
    exportStaffExcel(); var sh = window.__xlsx[0];
    var row = sh.rows[1];
    window.jobsInCycle = () => ['J1']; window.db.getQuiet = window.__scansOk;
    return { users: b.users.length, failed: b.failed, jobs: b.jobs, who: row ? row[1] : null, note: row ? row[6] : null,
             cardOk: cardTxt.indexOf('โหลดข้อมูลไม่ได้') >= 0, cardNoIdle: cardTxt.indexOf('ยังไม่มีใครยิงในสาขานี้') < 0 };
  });
  check('สาขาโหลดล้มทุก Job (Job เดียว) → users ว่าง failed 1/1', rfa.users === 0 && rfa.failed === 1 && rfa.jobs === 1, rfa);
  check('Excel: โหลดล้มทั้งสาขา → "(โหลดข้อมูลไม่ได้)" + หมายเหตุไม่ครบ ไม่ใช่ "ยังไม่มีใครยิง"', rfa.who && rfa.who.indexOf('โหลดข้อมูลไม่ได้') >= 0 && String(rfa.note).indexOf('ข้อมูลไม่ครบ') >= 0, rfa);
  check('จอ: การ์ดสาขาโหลดล้มขึ้น "โหลดข้อมูลไม่ได้" ไม่ใช่รายชื่อว่าง', rfa.cardOk === true && rfa.cardNoIdle === true, rfa);

  /* ---- 5) กรองข้ามสาขา (canSeeBranch) — dropdown + ตัว load ---- */
  const rdd = await page.evaluate(() => {
    state.staffReport = null; state.staffScope = 'live';
    window.__allowBranch = true; renderStaffReport();
    var all = document.getElementById('sumStaff').querySelectorAll('select option').length;
    window.__allowBranch = false; renderStaffReport();
    var none = document.getElementById('sumStaff').querySelectorAll('select option').length;
    window.__allowBranch = true;
    return { all: all, restricted: none };
  });
  check('dropdown: มีสิทธิ์เห็นครบ (live+ปิด+ทุก+ช่วง + 2 รอบ = 6)', rdd.all === 6, rdd);
  check('dropdown: สาขาที่ไม่มีสิทธิ์ถูกกรองออก เหลือแต่ตัวรวม 4', rdd.restricted === 4, rdd);

  const rcb = await page.evaluate(async () => {
    window.__allowBranch = false;
    state.staffScope = 'C2'; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    window.__allowBranch = true;
    return { n: state.staffReport.branches.length };
  });
  check('ตั้ง scope เป็นสาขาที่ไม่มีสิทธิ์ (เลี่ยง dropdown) → โหลดไม่ได้ กันข้อมูลข้ามสาขา', rcb.n === 0, rcb);

  /* ---- 6) เปลี่ยนรอบระหว่างกำลังโหลด → ผลรอบเก่าต้องไม่ทับรอบใหม่ ---- */
  const rst = await page.evaluate(async () => {
    window.__allowBranch = true; window.jobsInCycle = () => ['J1']; window.db.getQuiet = window.__scansOk;
    state.staffScope = 'SCOPE_A'; state.staffLoading = false;
    state.staffReport = { branches: [{ code: 'MARKER_OLD' }], at: 1 };
    var p = loadStaffReport();
    state.staffScope = 'SCOPE_B';   /* ผู้ใช้สลับรอบระหว่างโหลด */
    await p;
    return { survived: state.staffReport.branches[0].code, loading: state.staffLoading };
  });
  check('เปลี่ยนรอบระหว่างโหลด → ทิ้งผลรอบเก่า ไม่ทับรอบใหม่', rst.survived === 'MARKER_OLD' && rst.loading === false, rst);

  /* ---- 6b) scope รวม: ปิดแล้ว / ทุกสถานะ ---- */
  const rcl = await page.evaluate(async () => {
    var saveBr = window.cycleBranch, saveJobs = window.jobsInCycle, saveGet = window.db.getQuiet;
    window.cycleBranch = (cid) => cid === 'C2' ? { branchCode: 'B2', branchName: 'สอง' } : { branchCode: 'B1', branchName: 'หนึ่ง' };
    window.jobsInCycle = (cid) => cid === 'C2' ? ['J2'] : ['J1'];
    var T8 = new Date(2026, 9, 20, 8, 0, 0).getTime();
    window.db.getQuiet = (p) => String(p).indexOf('/scans') >= 0 ? Promise.resolve({ x: { code: 'A', delta: 1, ts: T8, user: 'ก' } }) : Promise.resolve({});
    window.__allowBranch = true;
    state.staffScope = 'closed'; state.staffReport = null; state.staffLoading = false; await loadStaffReport();
    var closed = state.staffReport.branches.map(b => b.code).sort();
    state.staffScope = 'all'; state.staffReport = null; state.staffLoading = false; await loadStaffReport();
    var all = state.staffReport.branches.map(b => b.code).sort();
    window.cycleBranch = saveBr; window.jobsInCycle = saveJobs; window.db.getQuiet = saveGet;
    return { closed, all };
  });
  check('scope "ปิดแล้ว" → เฉพาะรอบปิด (B2)', rcl.closed.length === 1 && rcl.closed[0] === 'B2', rcl);
  check('scope "ทุกสถานะ" → ทุกรอบ (B1+B2)', rcl.all.length === 2 && rcl.all[0] === 'B1' && rcl.all[1] === 'B2', rcl);

  /* ---- 6c) เลือกช่วงวันที่ (จาก-ถึง) — ดึงเฉพาะรอบในช่วง ไม่ลากทั้งปี ---- */
  const rrg = await page.evaluate(async () => {
    var saveGrp = window.cycleGroups, saveBr = window.cycleBranch, saveJobs = window.jobsInCycle, saveGet = window.db.getQuiet, saveSt = window.cycleStatus;
    var now = Date.now(), old = now - 10 * 86400000;
    window.cycleGroups = () => ({ CT: { id: 'CT', branchCode: 'B1', branchName: 'วันนี้', createdAt: now }, CO: { id: 'CO', branchCode: 'B2', branchName: 'เก่า', createdAt: old } });
    window.cycleStatus = () => 'closed';
    window.cycleBranch = (cid) => cid === 'CO' ? { branchCode: 'B2', branchName: 'เก่า' } : { branchCode: 'B1', branchName: 'วันนี้' };
    window.jobsInCycle = () => ['J1'];
    var T8 = new Date(2026, 9, 20, 8, 0, 0).getTime();
    window.db.getQuiet = (p) => String(p).indexOf('/scans') >= 0 ? Promise.resolve({ x: { code: 'A', delta: 1, ts: T8, user: 'ก' } }) : Promise.resolve({});
    window.__allowBranch = true;
    var iso = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    var today = iso(new Date(now));
    state.staffScope = 'range'; state.staffFrom = today; state.staffTo = today; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    var todayOnly = state.staffReport.branches.map(b => b.code).sort();
    state.staffFrom = iso(new Date(old - 86400000)); state.staffTo = today; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    var wide = state.staffReport.branches.map(b => b.code).sort();
    window.cycleGroups = saveGrp; window.cycleBranch = saveBr; window.jobsInCycle = saveJobs; window.db.getQuiet = saveGet; window.cycleStatus = saveSt;
    return { todayOnly, wide };
  });
  check('ช่วงวัน: วันนี้-วันนี้ → เฉพาะรอบวันนี้ (B1)', rrg.todayOnly.length === 1 && rrg.todayOnly[0] === 'B1', rrg);
  check('ช่วงวัน: ขยายช่วงคลุมของเก่า → ได้ทั้ง 2 (B1+B2)', rrg.wide.length === 2, rrg);

  /* ---- 7) ดึงหลายสาขาพร้อมกัน (parallel) — ยอดต้องแยกสาขาถูก เรียงตามรหัส ---- */
  const rpar = await page.evaluate(async () => {
    var saveLive = window.liveCountingCycles, saveBr = window.cycleBranch, saveJobs = window.jobsInCycle, saveGet = window.db.getQuiet;
    window.liveCountingCycles = () => ['C1', 'C2'];
    window.cycleBranch = (cid) => cid === 'C2' ? { branchCode: 'B2', branchName: 'สาขาสอง' } : { branchCode: 'B1', branchName: 'สาขาหนึ่ง' };
    window.jobsInCycle = (cid) => cid === 'C2' ? ['J2'] : ['J1'];
    var T8 = new Date(2026, 9, 20, 8, 0, 0).getTime();
    window.db.getQuiet = function (p) {
      if (String(p).indexOf('J1/scans') >= 0) return Promise.resolve({ a: { code: 'A', delta: 10, ts: T8, user: 'ก' } });
      if (String(p).indexOf('J2/scans') >= 0) return Promise.resolve({ b: { code: 'B', delta: 20, ts: T8, user: 'ข' } });
      return Promise.resolve({});
    };
    window.__allowBranch = true;
    state.staffScope = 'live'; state.staffReport = null; state.staffLoading = false;
    await loadStaffReport();
    var r = state.staffReport.branches;
    window.liveCountingCycles = saveLive; window.cycleBranch = saveBr; window.jobsInCycle = saveJobs; window.db.getQuiet = saveGet;
    return { n: r.length, b0: r[0].code, b0p: r[0].pieces, b1: r[1].code, b1p: r[1].pieces };
  });
  check('หลายสาขาพร้อมกัน (parallel): ได้ 2 สาขา เรียงรหัส B1→B2 ยอดแยกถูก', rpar.n === 2 && rpar.b0 === 'B1' && rpar.b0p === 10 && rpar.b1 === 'B2' && rpar.b1p === 20, rpar);

  check('ไม่มี page error', errs.length === 0, errs.slice(0, 3));
  console.log('\n==== test-staff-report: ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close(); process.exit(fail ? 1 : 0);
})();
