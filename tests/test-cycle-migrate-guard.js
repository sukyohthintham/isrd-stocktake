/* ============================================================
   ด่านกันเขียนรอบที่ปิดแล้วตอนย้ายข้อมูล — v2.11.1
   ============================================================

   อาการที่แก้: migrateCyclesIfNeeded() เป็น backfill ครั้งเดียวจาก v2.1.0 → v2.1.1
   แต่มันยิง write ให้ "ทุกรอบที่ยังไม่ย้าย" รวมรอบที่ปิดไปแล้ว
   Database Rules ปฏิเสธ → PATCH 401 · แล้วรอบนั้นก็ไม่ถูกทำเครื่องหมายว่าย้ายแล้ว
   → เปิดแอปครั้งหน้ายิงใหม่อีก วนแบบนี้ตลอดไป ยอดระบบทั้งบริษัทมีหมื่นกว่ารหัส
   ส่งทีละ 400 คีย์ = หลายสิบใบต่อรอบ Console เลยเต็มไปด้วย 401 ทุกครั้งที่เปิดแอป

   กฎที่ยึด (stocktake-rules-v2.1.1.json ตัวจริง ไม่ใช่เดา):
     cycles/$cid/systemQty   เขียนได้เมื่อ status ยังไม่มี หรือเป็น counting
     cycles/$cid/info        เขียนได้เมื่อ status ไม่ใช่ closed
     roundIndex/$id          Job ที่ปิดแล้วเขียนได้เฉพาะ admin

   กันอะไร:
   [1] ⭐ รอบที่ปิดแล้ว = ไม่ยิง db.update เลยสักใบ (write = 0) ไม่ใช่ยิงแล้ว .catch
   [2] รอบที่ยังนับอยู่ ต้องย้ายได้ครบเหมือนเดิมทุกอย่าง (ห้าม regress)
   [3] ⭐ ยังไม่ได้รับสาย cycles ก็ต้องกันได้ — ถอยไปดูสถานะ Job แทน
   [4] เปลี่ยนชื่อรหัสรอบบน Job: ข้ามเป็นราย Job ที่ฐานไม่ยอมให้เขียน
   [5] รอบเดียวพังต้องไม่ลากรอบอื่นตายไปด้วย
   [6] ข้ามแล้วยอดต้องไม่หาย — การอ่านถอยไปหาของเดิมที่ rounds/{id} ได้เอง
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
  window.ask = function () { return Promise.resolve(true); };
  hideLogin();

  /* ฐานจำลอง: ยอดระบบเดิมที่ยังอยู่ใต้ rounds/{id} + ดักทุก write เอาไว้นับ */
  window.__legacy = {};          // id -> { systemQty: {}, transfers: {} }
  window.__writes = [];
  window.__reads = [];
  window.__failCycle = null;     // ชื่อรอบที่ให้ฐานปฏิเสธ (จำลองเคสพัง)

  window.db.getQuiet = function (p) {
    window.__reads.push(p);
    var m = /^rounds\\/([^/]+)\\/(systemQty|transfers)\$/.exec(p);
    if (m) return Promise.resolve((window.__legacy[m[1]] || {})[m[2]] || {});
    return Promise.resolve({});
  };
  window.db.get = window.db.getQuiet;
  window.db.update = function (path, patch) {
    window.__writes.push({ path: path, patch: patch });
    if (window.__failCycle && path.indexOf(window.__failCycle) >= 0) {
      return Promise.reject(new Error('PERMISSION_DENIED'));
    }
    return Promise.resolve();
  };

  /* หาว่ามี write ไปโดนรอบไหนบ้าง — ใช้ชี้ว่า "ยิง 0 ใบ" จริงไหม */
  window.__writesFor = function (needle) {
    return window.__writes.filter(function (w) { return w.path.indexOf(needle) >= 0; });
  };
  window.__readsFor = function (needle) {
    return window.__reads.filter(function (p) { return p.indexOf(needle) >= 0; });
  };

  /* jobs: [{ id, cycleId, status, sys }] · cycles: ระเบียนรอบที่ "มาจากฐานแล้ว" */
  window.__seed = function (role, jobs, cycles) {
    state.me = { uid: 'u1', email: 'a@b.c', name: 'isrd', role: role, branches: [] };
    state.counter = 'isrd';
    state.roundIndex = {};
    state.cycles = cycles || {};
    state.products = {}; state.systemQty = {}; state.counts = {};
    state.roundId = ''; state.cycleId = '';
    window.__legacy = {};
    jobs.forEach(function (j, i) {
      state.roundIndex[j.id] = {
        id: j.id, jobCode: j.id, branchCode: j.branch || 'B1', branchName: 'สาขา ' + (j.branch || 'B1'),
        cycleId: j.cycleId, status: j.status || 'counting', createdAt: 1000 + i
      };
      window.__legacy[j.id] = { systemQty: j.sys || {}, transfers: j.transfers || {} };
    });
    window.__writes = []; window.__reads = []; window.__toasts = [];
    window.__failCycle = null;
  };
`;

(async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');

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

  /* ---------- [1]+[2] รอบปิดไม่ยิงเลย · รอบนับย้ายครบ ---------- */
  console.log('\n[1] ⭐ รอบที่ปิดแล้ว = ไม่ยิง db.update สักใบ');
  const mix = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'J1', cycleId: 'OPEN-256907-01', status: 'counting', sys: { A: 10, B: 5 } },
      { id: 'J2', cycleId: 'SHUT-256907-01', status: 'closed', sys: { C: 20 } }
    ], {
      'OPEN-256907-01': { status: 'counting', info: {} },
      'SHUT-256907-01': { status: 'closed', info: {} }
    });
    const report = await migrateCyclesIfNeeded();
    return {
      shutWrites: window.__writesFor('SHUT-256907-01'),
      shutRound: window.__writesFor('roundIndex/J2'),
      shutReads: window.__readsFor('rounds/J2'),
      openWrites: window.__writesFor('OPEN-256907-01').map(w => w.path),
      report: report,
      cycleRec: state.cycles['OPEN-256907-01']
    };
  });
  check('⭐ ไม่มี write ไปที่รอบที่ปิดแล้วเลย', mix.shutWrites.length === 0, mix.shutWrites);
  check('⭐ ไม่แตะ roundIndex ของ Job ที่ปิดแล้ว', mix.shutRound.length === 0, mix.shutRound);
  check('ไม่เสียแม้แต่การอ่านของเดิม (ข้ามตั้งแต่ยังไม่เริ่ม)', mix.shutReads.length === 0, mix.shutReads);
  check('รายงานว่าข้ามรอบนั้นเพราะปิดแล้ว',
        mix.report && mix.report.skipped.length === 1 &&
        mix.report.skipped[0].cid === 'SHUT-256907-01' && mix.report.skipped[0].why === 'closed',
        mix.report && mix.report.skipped);

  console.log('\n[2] รอบที่ยังนับอยู่ ต้องย้ายได้ครบเหมือนเดิม');
  check('เขียนยอดระบบขึ้นรอบนับ',
        mix.openWrites.indexOf('cycles/OPEN-256907-01/systemQty') >= 0, mix.openWrites);
  check('เขียนหัวรอบ (status + info)',
        mix.openWrites.indexOf('cycles/OPEN-256907-01') >= 0, mix.openWrites);
  check('นับจำนวนรอบที่ย้ายสำเร็จถูก', mix.report.cycles === 1, mix.report);
  check('นับจำนวนรหัสที่ย้ายถูก (A,B)', mix.report.keys === 2, mix.report);
  check('ทำเครื่องหมาย schema ให้ครั้งหน้าไม่ต้องย้ายซ้ำ',
        mix.cycleRec && mix.cycleRec.info && mix.cycleRec.info.schema === 1, mix.cycleRec);
  check('สถานะที่เขียนลงหัวรอบยังเป็น counting',
        mix.cycleRec && mix.cycleRec.status === 'counting', mix.cycleRec);

  console.log('\n[2b] รันซ้ำอีกครั้ง ต้องไม่ยิงอะไรอีก (ย้ายแล้วคือจบ)');
  const again = await page.evaluate(async () => {
    window.__writes = []; window.__reads = [];
    const report = await migrateCyclesIfNeeded();
    return { writes: window.__writes.length, report: report };
  });
  check('ไม่มี write ซ้ำ', again.writes === 0, again);
  check('ไม่รายงานอะไร', again.report === null, again);

  /* ---------- [3] ยังไม่ได้รับสาย cycles ---------- */
  console.log('\n[3] ⭐ สาย cycles ยังมาไม่ถึง ก็ต้องกันได้ (ถอยไปดูสถานะ Job)');
  const race = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'J9', cycleId: 'SHUT-256907-02', status: 'closed', sys: { C: 20 } }
    ], {});                       /* state.cycles ว่าง = สายยังมาไม่ถึง */
    const report = await migrateCyclesIfNeeded();
    return { writes: window.__writes.length, reads: window.__reads.length, report: report };
  });
  check('⭐ ยังไม่ยิง write สักใบ', race.writes === 0, race);
  check('ไม่ยิงอ่านเปล่า ๆ ด้วย', race.reads === 0, race);
  check('ทั้งชุดถูกข้าม จึงไม่มีรายงานให้กวนผู้ใช้', race.report === null, race);

  console.log('\n[3b] รอบที่กำลังตรวจ (reviewing) ก็เขียน systemQty ไม่ได้');
  const rev = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'J8', cycleId: 'REV-256907-01', status: 'reviewing', sys: { C: 20 } }
    ], {});
    const report = await migrateCyclesIfNeeded();
    return { writes: window.__writes.length, report: report };
  });
  check('ไม่ยิง write ให้รอบที่กำลังตรวจ', rev.writes === 0, rev);

  console.log('\n[3c] Job ในรอบเดียวกันปิดไม่ครบ = รอบยังนับอยู่ ต้องย้ายได้');
  const partial = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'JA', cycleId: 'MIX-256907-01', status: 'closed', sys: { A: 7 } },
      { id: 'JB', cycleId: 'MIX-256907-01', status: 'counting', sys: { A: 9 } }
    ], {});
    const report = await migrateCyclesIfNeeded();
    const sysWrite = window.__writes.filter(w => w.path === 'cycles/MIX-256907-01/systemQty')[0];
    return { report: report, sys: sysWrite && sysWrite.patch };
  });
  check('ย้ายให้เพราะยังมี Job ที่นับอยู่', partial.report && partial.report.cycles === 1, partial.report);
  check('ยุบด้วย "เอาค่าสูงสุดรายรหัส" ไม่ใช่บวกกัน (7,9 → 9)',
        partial.sys && partial.sys.A === 9, partial.sys);

  /* ---------- [4] เปลี่ยนชื่อรหัสรอบบน Job ---------- */
  console.log('\n[4] ⭐ เปลี่ยนชื่อรหัสรอบ: ข้ามเป็นราย Job ที่ฐานไม่ยอม');
  const renameJobs = [
    { id: 'JN', cycleId: 'B1-256907-01', status: 'counting', sys: { A: 1 } },  /* พารอบที่ย้ายได้มาด้วย */
    { id: 'JO', cycleId: 'B2-202607', status: 'closed', sys: { B: 2 } },       /* รูปแบบเก่า + ปิดแล้ว */
    { id: 'JP', cycleId: 'B3-202607', status: 'counting', sys: { C: 3 } }      /* รูปแบบเก่า + ยังนับ */
  ];
  const renCounter = await page.evaluate(async (jobs) => {
    window.__seed('counter', jobs, {});
    await migrateCyclesIfNeeded();
    return { closed: window.__writesFor('roundIndex/JO').length,
             open: window.__writesFor('roundIndex/JP').length,
             newId: (state.roundIndex.JP || {}).cycleId };
  }, renameJobs);
  check('⭐ counter ไม่แตะ Job ที่ปิดแล้ว', renCounter.closed === 0, renCounter);
  check('Job ที่ยังนับอยู่ยังเปลี่ยนชื่อให้เหมือนเดิม', renCounter.open === 1, renCounter);
  check('เปลี่ยนเป็นรหัสรูปแบบใหม่ถูกต้อง', renCounter.newId === 'B3-256907-01', renCounter);

  const renAdmin = await page.evaluate(async (jobs) => {
    window.__seed('admin', jobs, {});
    await migrateCyclesIfNeeded();
    return { closed: window.__writesFor('roundIndex/JO').length,
             patch: (window.__writesFor('roundIndex/JO')[0] || {}).patch };
  }, renameJobs);
  check('admin เขียน Job ที่ปิดแล้วได้ (Rules ยอม) จึงไม่ต้องข้าม', renAdmin.closed === 1, renAdmin);
  check('เปลี่ยนเป็นรหัสรูปแบบใหม่', renAdmin.patch && renAdmin.patch.cycleId === 'B2-256907-01', renAdmin);

  /* ---------- [5] รอบเดียวพังไม่ลากรอบอื่น ---------- */
  console.log('\n[5] ⭐ รอบเดียวพังต้องไม่ลากรอบอื่นตายไปด้วย');
  const isolate = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'JX', cycleId: 'BAD-256907-01', status: 'counting', sys: { A: 1 } },
      { id: 'JY', cycleId: 'GOOD-256907-01', status: 'counting', sys: { B: 2 } }
    ], {});
    window.__failCycle = 'BAD-256907-01';      /* ฐานปฏิเสธเฉพาะรอบนี้ */
    const report = await migrateCyclesIfNeeded();
    return { report: report, good: window.__writesFor('cycles/GOOD-256907-01').map(w => w.path),
             badMigrated: cycleMigrated('BAD-256907-01'),
             cycleRec: state.cycles['GOOD-256907-01'] };
  });
  check('⭐ รอบที่ดีย้ายสำเร็จ ไม่ถูกลากตาย', isolate.report && isolate.report.cycles === 1, isolate.report);
  check('เขียนครบทั้งยอดและหัวรอบ', isolate.good.length === 2, isolate.good);
  check('รายงานว่ารอบไหนพลาด',
        isolate.report && isolate.report.failed.length === 1 &&
        isolate.report.failed[0] === 'BAD-256907-01', isolate.report && isolate.report.failed);
  check('รอบที่พลาดไม่ถูกทำเครื่องหมายว่าย้ายแล้ว ครั้งหน้ายังลองใหม่ได้',
        isolate.badMigrated === false, isolate.badMigrated);
  check('ไม่นับรอบที่เขียนไม่ผ่านว่าย้ายสำเร็จ', isolate.report.cycles === 1, isolate.report);

  /* ---------- [6] ข้ามแล้วยอดต้องไม่หาย ---------- */
  console.log('\n[6] ⭐ ข้ามการย้ายแล้วยอดต้องยังอ่านได้ครบจากของเดิม');
  const readBack = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'JC', cycleId: 'SHUT-256907-03', status: 'closed', sys: { A: 7, B: 4 } },
      { id: 'JD', cycleId: 'SHUT-256907-03', status: 'closed', sys: { A: 9 } }
    ], {});
    await migrateCyclesIfNeeded();
    const writes = window.__writes.length;
    const sys = await loadCycleSystemQty('SHUT-256907-03');
    return { writes: writes, sys: sys, migrated: cycleMigrated('SHUT-256907-03') };
  });
  check('ไม่ได้ย้าย (ยังไม่มี schema)', readBack.migrated === false, readBack.migrated);
  check('ไม่มี write เกิดขึ้นเลย', readBack.writes === 0, readBack.writes);
  check('⭐ ยังอ่านยอดได้ครบทุกรหัส', readBack.sys.A === 9 && readBack.sys.B === 4, readBack.sys);
  check('ยุบแบบเอาค่าสูงสุด ไม่ใช่บวกกัน (7,9 → 9 ไม่ใช่ 16)', readBack.sys.A === 9, readBack.sys);

  /* ---------- [7] ข้อความรายงาน ---------- */
  console.log('\n[7] รายงานต้องบอกด้วยว่ามีรอบที่ไม่ได้ย้าย');
  const msg = await page.evaluate(async () => {
    window.__seed('counter', [
      { id: 'JE', cycleId: 'OPEN2-256907-01', status: 'counting', sys: { A: 1 } },
      { id: 'JF', cycleId: 'SHUT2-256907-01', status: 'closed', sys: { B: 1 } }
    ], {});
    const report = await migrateCyclesIfNeeded();
    window.__toasts = [];
    showCycleMigrationReport(report);
    return { toast: (window.__toasts[0] || {}).m, report: report };
  });
  check('บอกจำนวนรอบที่ย้ายสำเร็จ', /ย้ายยอดระบบขึ้นรอบนับแล้ว 1 รอบ/.test(msg.toast || ''), msg.toast);
  check('⭐ บอกด้วยว่ามีรอบที่ไม่ได้ย้าย', /อีก 1 รอบไม่ได้ย้าย/.test(msg.toast || ''), msg.toast);
  check('บอกว่ายอดยังอ่านได้ครบ ไม่ให้คนอ่านตกใจ', /ยอดยังอ่านได้ครบ/.test(msg.toast || ''), msg.toast);

  /* ---------- [8] ด่านอยู่ก่อนยิง ไม่ใช่ .catch ทีหลัง ---------- */
  console.log('\n[8] ⭐ ด่านต้องอยู่ "ก่อนยิง" ไม่ใช่ยิงแล้วค่อยกลืน error');
  check('มีตัวช่วยตัดสินแยกออกมา', /function canMigrateCycle\(cid\)/.test(src), 'canMigrateCycle');
  check('ตัดสินจาก cycleStatus (ถอยไปดูสถานะ Job ได้เมื่อยังไม่มีระเบียน)',
        /function canMigrateCycle\(cid\) \{ return cycleStatus\(cid\) === 'counting'; \}/.test(src),
        'cycleStatus');
  check('คัดออกตั้งแต่ตอนทำรายการ ไม่ได้ปล่อยให้เข้า migrateOneCycle',
        /if \(!canMigrateCycle\(cid\)\) \{ report\.skipped\.push/.test(src), 'filter');
  check('ด่านเปลี่ยนชื่อรหัสรอบอยู่ก่อน push เข้าคิวเขียน',
        /if \(!canRenameRoundCycle\(job\)\) return;[\s\S]{0,80}renames\.push/.test(src), 'rename guard');
  /* v2.12.0 — ด่านนี้ผูกกับความสามารถ reopenRound แทนการเช็ค role ตรง ๆ
     ความหมายเท่าเดิม: แม่แบบให้ reopenRound เฉพาะ admin เท่านั้น */
  check('Job ที่ปิดแล้วให้เฉพาะคนที่เปิดรอบได้ (ตรงกับ Rules)',
        /function canRenameRoundCycle\(job\)[\s\S]{0,180}!== 'closed' \|\| hasPerm\('reopenRound'\)/.test(src),
        'reopenRound only');

  /* ---------- [9] ไม่กระทบของเดิม ---------- */
  console.log('\n[9] ไม่แตะงานอื่น');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
                  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('สายค้างยังมี 4 สายเท่าเดิม',
        code.split('\n').filter(l => /\bdb\.subscribe(Children)?\(/.test(l)).length === 4, 'streams');
  check('ไม่แตะ role-sync (v2.11.0)', /function ensureRoleFresh\(opts\)/.test(src), 'ensureRoleFresh');
  check('กำแพงห้ามเปลี่ยนสิทธิ์ตัวเองยังอยู่', /เปลี่ยนสิทธิ์ของตัวเองไม่ได้/.test(src), 'self-guard');
  check('เวอร์ชันขึ้นเป็น 2.11.1 ครบ 3 จุด',
        (src.match(/2\.11\.1/g) || []).length >= 3, 'version');

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
