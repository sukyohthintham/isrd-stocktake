/* ============================================================
   มอนิเตอร์สดวันนับ (Live Count-Day Monitor) — v2.27.0 (ประหยัดโควตา)
   ============================================================
   โครงใหม่: รอบวิ่งอ่านแค่ "แถวล่าสุด/สาขา" (db.getLast) — เบามาก
             ยอดรายคน/จำนวนชิ้น โหลดตอน "กางดู" เท่านั้น (db.getQuiet)
   กันอะไร (READ-ONLY — ต้องไม่เขียนฐานเลย):
   [A] loadLiveMonitor อ่านแถวล่าสุด/Job → ได้ lastTs + lastUser รายสาขาถูก
   [B] loadBranchDetail อ่าน scans เต็มของสาขาเดียว → รวมชิ้น + รายคนถูก
   [C] เรียง "เงียบนานสุดขึ้นบน"
   [D] กรองเฉพาะรอบ counting (closed/reviewing ไม่เฝ้า)
   [E] renderLive วาดตารางสรุป + กางดูเห็นรายคน (จาก detail ที่โหลดมา)
   [F] สีเตือนตามเวลาเงียบ (เขียว/เหลือง/แดง)
   [G] ไม่เขียนฐานเลย (db.update = 0 ครั้ง)
   [H] ⭐ รอบวิ่งอ่าน getLast = จำนวน Job ที่เห็น · ไม่แตะ getQuiet (ของหนัก) เลย
   [I] ⭐ กรองสาขาตามสิทธิ์ (counter เห็น/อ่านแค่สาขาตัวเอง)
   [J] ⭐ กางดูแบบ lazy: เปิดครั้งแรกจึงโหลด detail · หุบแล้วเปิดซ้ำ ไม่อ่านฐานซ้ำ (cache)
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
  state.me = { uid: 'a1', name: 'แอดมิน', role: 'admin', branches: [] };   // แอดมินเห็นทุกสาขา
  state.page = 'summary'; state.summaryTab = 'live';                        // ให้ loadLiveMonitor ไม่ตัดกลางคัน

  /* ⭐ ดัก db.update — มอนิเตอร์ต้องไม่เขียนฐานเลย (read-only) */
  window.__writes = 0;
  window.db.update = function () { window.__writes++; return Promise.resolve(); };
  window.__glanceReads = 0;   // นับครั้งที่อ่าน "แถวล่าสุด" (getLast — ของเบา รอบวิ่ง)
  window.__detailReads = 0;   // นับครั้งที่อ่าน scans เต็ม (getQuiet — ของหนัก ตอนกางดู)

  var NOW = Date.now();
  window.__NOW = NOW;
  /* 3 รอบ: C1,C2 กำลังนับ · C3 ปิดแล้ว (ต้องถูกกรองทิ้ง) */
  window.cycleGroups = function () { return { C1: 1, C2: 1, C3: 1 }; };
  window.cycleStatus = function (cid) { return cid === 'C3' ? 'closed' : 'counting'; };
  window.jobsInCycle = function (cid) { return cid === 'C1' ? ['J1'] : (cid === 'C2' ? ['J2'] : ['J3']); };
  window.cycleBranch = function (cid) {
    if (cid === 'C1') return { branchCode: 'LKB-01', branchName: 'สุวรรณภูมิ' };
    if (cid === 'C2') return { branchCode: 'SMS-01', branchName: 'สยาม' };
    return { branchCode: 'XXX', branchName: 'ปิดแล้ว' };
  };

  /* ⭐ รอบวิ่งเบา: getLast คืน "แถวล่าสุดอันเดียว" ต่อ Job (ไม่ใช่ทั้งกอง) */
  window.db.getLast = function (path) {
    window.__glanceReads++;
    if (path === 'rounds/J1/scans') return Promise.resolve({ code: 'B', delta: 3, ts: NOW - 4000,   user: 'Oum' }); // 4 วิ
    if (path === 'rounds/J2/scans') return Promise.resolve({ code: 'D', delta: 1, ts: NOW - 1800000, user: 'May' }); // 30 นาที
    return Promise.resolve(null);   // J3 ไม่ควรถูกเรียกด้วยซ้ำ
  };

  /* ของหนัก: getQuiet อ่าน scans เต็ม — เรียกเฉพาะตอนกางดูสาขานั้น */
  window.db.getQuiet = function (path) {
    window.__detailReads++;
    if (path === 'rounds/J1/scans') return Promise.resolve({
      s1: { code: 'A', delta: 5, ts: NOW - 5000,   user: 'Oum' },     // 5 วิ
      s2: { code: 'B', delta: 3, ts: NOW - 4000,   user: 'Oum' },     // Oum รวม 8, ล่าสุด 4 วิ
      s3: { code: 'C', delta: 2, ts: NOW - 600000, user: 'Noey' }     // 10 นาที
    });
    if (path === 'rounds/J2/scans') return Promise.resolve({
      s4: { code: 'D', delta: 1, ts: NOW - 1800000, user: 'May' }
    });
    return Promise.resolve({});
  };
`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(HARNESS);

  /* ---------- [A][C][D][H] รอบวิ่งเบา: glance ---------- */
  console.log('\n[A/C/D/H] loadLiveMonitor — แถวล่าสุด/สาขา · เรียง · กรอง counting · อ่านเบา');
  const d = await page.evaluate(async () => {
    window.__glanceReads = 0; window.__detailReads = 0;
    const rows = await loadLiveMonitor();
    return {
      n: rows.length,
      order: rows.map(r => r.code),
      rows: rows.map(r => ({ code: r.code, lastUser: r.lastUser, hasLastTs: !!r.lastTs, hasPieces: 'pieces' in r })),
      glance: window.__glanceReads, detail: window.__detailReads, liveReads: state.liveReads
    };
  });
  check('[D] กรองเฉพาะ counting (C3 closed ถูกตัด) → 2 สาขา', d.n === 2, d);
  check('[C] เรียงเงียบนานสุดขึ้นบน (SMS-01 30นาที มาก่อน LKB-01 4วิ)',
        d.order[0] === 'SMS-01' && d.order[1] === 'LKB-01', d.order);
  check('[A] ได้คนล่าสุดรายสาขา (LKB-01=Oum, SMS-01=May)',
        d.rows.find(r => r.code === 'LKB-01').lastUser === 'Oum' &&
        d.rows.find(r => r.code === 'SMS-01').lastUser === 'May', d.rows);
  check('[A] รอบวิ่งไม่พก pieces มาด้วย (ของหนักแยกไปกางดู)',
        d.rows.every(r => r.hasPieces === false), d.rows);
  check('[H] รอบวิ่งอ่านแค่ getLast = จำนวน Job ที่เห็น (2 ครั้ง)', d.glance === 2, d);
  check('[H] ⭐ รอบวิ่งไม่แตะ getQuiet (ของหนัก) เลย (0 ครั้ง)', d.detail === 0, d);
  check('[H] ตัวนับภายใน state.liveReads = 2', d.liveReads === 2, d);

  /* ---------- [B] loadBranchDetail: ของหนัก รายคน ---------- */
  console.log('\n[B] loadBranchDetail — อ่าน scans เต็มของสาขาเดียว → รวมชิ้น + รายคน');
  const b = await page.evaluate(async () => {
    window.__detailReads = 0;
    const det = await loadBranchDetail('C1');   // LKB-01
    return {
      pieces: det.pieces, nUsers: det.users.length,
      users: det.users.map(u => ({ u: u.user, p: u.pieces })),
      detailReads: window.__detailReads
    };
  });
  check('[B] LKB-01 รวมชิ้นถูก (5+3+2=10)', b.pieces === 10, b);
  check('[B] รายคน Oum=8 (ล่าสุดก่อน), Noey=2',
        b.users[0].u === 'Oum' && b.users[0].p === 8 && b.users[1].u === 'Noey' && b.users[1].p === 2, b.users);
  check('[B] อ่าน scans เต็มของสาขานี้ 1 ครั้ง (1 Job)', b.detailReads === 1, b);

  /* ---------- [F] สีเตือน ---------- */
  console.log('\n[F] สีเตือนตามเวลาเงียบ');
  const col = await page.evaluate(() => ({
    fresh: liveIdleClass(Date.now() - 5000),
    mid:   liveIdleClass(Date.now() - 8 * 60000),
    old:   liveIdleClass(Date.now() - 20 * 60000),
    none:  liveIdleClass(0)
  }));
  check('เพิ่งยิง = เขียว', col.fresh === 'green', col);
  check('เงียบ 8 นาที = เหลือง', col.mid === 'yellow', col);
  check('เงียบ 20 นาที = แดง', col.old === 'red', col);
  check('ยังไม่เริ่ม = แดง', col.none === 'red', col);

  /* ---------- [E] วาดจริง + กางดูรายคน (จาก detail ที่โหลดมา) ---------- */
  console.log('\n[E] renderLive วาดตารางสรุป + กางดูเห็นรายคน');
  const r = await page.evaluate(async () => {
    setSummaryTab('live');
    await new Promise(x => setTimeout(x, 300));
    const host = document.getElementById('liveBody');
    const branchRows = host.querySelectorAll('tbody > tr').length;
    const chip = document.getElementById('liveChip').textContent;
    // กาง LKB-01 (มี 2 คน) — ใส่ detail ที่โหลดไว้แล้วตรง ๆ เพื่อทดสอบการวาด
    const cid = state.liveData.find(x => x.code === 'LKB-01').cid;
    state.liveDetail[cid] = { pieces: 10, at: Date.now(), users: [
      { user: 'Oum', pieces: 8, last: Date.now() - 4000 },
      { user: 'Noey', pieces: 2, last: Date.now() - 600000 }
    ] };
    state.liveOpen = {}; state.liveOpen[cid] = true;
    renderLive();
    const afterExpand = host.querySelectorAll('tbody > tr').length;
    const text = host.textContent;
    stopLiveTimer();
    return { branchRows, chip, afterExpand,
             hasOum: text.indexOf('Oum') >= 0, hasNoey: text.indexOf('Noey') >= 0,
             hasTotal: text.indexOf('รวม 10 ชิ้น') >= 0 };
  });
  check('วาด 2 แถวสาขา', r.branchRows === 2, r);
  check('ชิปนับ 2', r.chip === '2', r);
  check('กางดู LKB-01 → แถวเพิ่ม (2 สาขา + สรุป + 2 คน = 5)', r.afterExpand === 5, r);
  check('กางแล้วเห็นชื่อ Oum + Noey', r.hasOum && r.hasNoey, r);
  check('กางแล้วเห็นบรรทัดสรุป "รวม 10 ชิ้น"', r.hasTotal, r);

  /* ---------- [J] ⭐ กางดูแบบ lazy + cache ---------- */
  console.log('\n[J] ⭐ กางดูครั้งแรกจึงโหลด detail · หุบแล้วเปิดซ้ำไม่อ่านฐานซ้ำ');
  const j = await page.evaluate(async () => {
    await loadLiveMonitor();
    const cid = state.liveData.find(x => x.code === 'SMS-01').cid;   // สาขาที่ยังไม่เคยกาง
    state.liveOpen = {}; state.liveDetail = {}; state.liveDetailLoading = {};
    window.__detailReads = 0;
    toggleLiveBranch(cid);                         // เปิดครั้งแรก → ควรโหลด detail
    await new Promise(x => setTimeout(x, 250));
    const afterFirst = { reads: window.__detailReads, hasDetail: !!state.liveDetail[cid], pieces: state.liveDetail[cid] && state.liveDetail[cid].pieces };
    toggleLiveBranch(cid);                         // หุบ
    await new Promise(x => setTimeout(x, 50));
    toggleLiveBranch(cid);                         // เปิดซ้ำ → ต้องไม่อ่านฐานเพิ่ม (cache)
    await new Promise(x => setTimeout(x, 150));
    stopLiveTimer();
    return { afterFirst, readsAfterReopen: window.__detailReads };
  });
  check('[J] เปิดครั้งแรกโหลด detail (อ่านฐาน 1 ครั้ง)', j.afterFirst.reads === 1 && j.afterFirst.hasDetail, j);
  check('[J] detail ถูก (SMS-01 รวม 1 ชิ้น)', j.afterFirst.pieces === 1, j);
  check('[J] หุบแล้วเปิดซ้ำ ไม่อ่านฐานเพิ่ม (ยัง 1 ครั้งเท่าเดิม — ใช้ cache)', j.readsAfterReopen === 1, j);

  /* ---------- [G] read-only ---------- */
  const w = await page.evaluate(() => window.__writes);
  check('[G] ไม่เขียนฐานเลย (db.update = 0 ครั้ง)', w === 0, { writes: w });

  /* ---------- [I] ⭐ กรองสาขาตามสิทธิ์ ---------- */
  console.log('\n[I] ⭐ counter เห็น/อ่านแค่สาขาตัวเอง (รอบวิ่งเบา)');
  const ii = await page.evaluate(async () => {
    state.me = { uid: 'u9', name: 'น้อง', role: 'counter', branches: ['LKB-01'] };
    window.__glanceReads = 0;
    const rows = await loadLiveMonitor();
    state.me = { uid: 'a1', name: 'แอดมิน', role: 'admin', branches: [] };
    return { n: rows.length, code: rows[0] && rows[0].code, glance: window.__glanceReads };
  });
  check('เห็นแค่สาขาตัวเอง (1 สาขา = LKB-01)', ii.n === 1 && ii.code === 'LKB-01', ii);
  check('รอบวิ่งอ่านแค่ Job ของสาขาที่เห็น (1 ครั้ง)', ii.glance === 1, ii);

  /* ---------- [K] ⭐ roundIndex มาทีหลัง (race) → โหลดใหม่ต้องเห็นสาขา ---------- */
  console.log('\n[K] ⭐ เปิดแท็บตอนข้อมูลยังไม่ครบ (0 สาขา) แล้วข้อมูลมาเต็ม → โหลดใหม่เห็น 2 สาขา');
  const k = await page.evaluate(async () => {
    const realGroups = window.cycleGroups;
    window.cycleGroups = function () { return {}; };     // จำลอง roundIndex ยังไม่มา
    const empty = (await loadLiveMonitor()).length;
    window.cycleGroups = realGroups;                      // ข้อมูลมาเต็ม (SSE อัปเดต)
    const full = (await loadLiveMonitor()).length;
    return { empty, full };
  });
  check('ตอนข้อมูลยังไม่มา = 0 สาขา (ชิปจะขึ้น 0)', k.empty === 0, k);
  check('พอข้อมูลมาเต็มแล้วโหลดใหม่ = 2 สาขา (หายเอง ไม่ต้องกดรีเฟรช)', k.full === 2, k);

  /* ---------- [L] ⭐ เลขรอบ (generation): ผลรอบเก่าต้องไม่ทับรอบใหม่ ---------- */
  console.log('\n[L] ⭐ รอบเก่าที่จบทีหลัง (gen ไม่ตรง) ต้องทิ้งผล ไม่ทับ state.liveData');
  const L = await page.evaluate(async () => {
    state.liveGen = 5;
    state.liveData = [{ code: 'SENTINEL' }];           // ของรอบใหม่ (ปัจจุบัน)
    const stale = await loadLiveMonitor(4);            // รอบเก่า gen=4 (ไม่ตรงปัจจุบัน=5)
    const afterStale = state.liveData.map(r => r.code);
    const fresh = await loadLiveMonitor(5);            // รอบปัจจุบัน gen=5
    const afterFresh = state.liveData.map(r => r.code);
    return { staleRet: stale, afterStale, afterFreshN: afterFresh.length, keptSentinel: afterStale[0] === 'SENTINEL' };
  });
  check('[L] รอบเก่า (gen ไม่ตรง) คืน null และไม่ทับ liveData (ยังเห็น SENTINEL)',
        L.staleRet === null && L.keptSentinel, L);
  check('[L] รอบปัจจุบัน (gen ตรง) อัปเดต liveData เป็น 2 สาขาปกติ', L.afterFreshN === 2, L);

  /* ---------- [M] ⭐ ตัวกันซ้อน: กำลังโหลดอยู่ กดรีเฟรชซ้ำต้องไม่เริ่มรอบใหม่ ---------- */
  console.log('\n[M] ⭐ liveLoading=true → refreshLive() เป็น no-op (ไม่ bump gen ไม่อ่านซ้ำ)');
  const M = await page.evaluate(() => {
    state.liveLoading = true;
    const g0 = state.liveGen;
    refreshLive();                     // ควรถูกบล็อกทันที
    const g1 = state.liveGen;
    state.liveLoading = false;         // คืนสภาพ
    return { g0, g1 };
  });
  check('[M] กำลังโหลดอยู่ → refreshLive ไม่ bump gen (ไม่เริ่มรอบซ้อน)', M.g0 === M.g1, M);

  check('ไม่มี error หลุดในหน้า', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
