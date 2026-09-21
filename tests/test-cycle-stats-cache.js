/* ============================================================
   v2.16.8 — แคชสถิติรวมรอบลงเครื่อง (เฉพาะรอบที่ปิดแล้ว)
   ============================================================

   อาการที่แก้: หน้า "ภาพรวมทุกสาขา" ตัวกรอง "ทั้งหมด" ค้าง "..." ทุกคอลัมน์
   23 รอบสั่งอ่านยอดระบบพร้อมกันแต่ช่องอ่านเบื้องหลังมีแค่ 2 ช่อง
   รอบคลังก้อนใหญ่จ่มทั้งสองช่อง รอบที่เหลือต่อคิวรอยาว

   สิ่งที่ต้องคุม:
   [1] รอบ closed ที่มีแคชในเครื่อง — ห้ามแตะเน็ตแม้แต่คำขอเดียว
   [2] รอบ counting/reviewing — ต้องอ่านสดเสมอ ห้ามอ่านแคช ห้ามเขียนแคช
   [3] รอบที่ถูกเปิดใหม่ (closed -> counting) — แคชต้องถูกลบ รอบหน้าอ่านสด
   [4] แคชคนละเวอร์ชัน / คนละราคา ใช้ไม่ได้ ต้องโหลดใหม่
   [5] localStorage เขียนไม่ได้ (โหมดส่วนตัว/พื้นที่เต็ม) ต้องไม่พัง
   ============================================================ */

const { puppeteer, CHROME, APP_URL, forceLive } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await forceLive(page);
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate(() => {
    hideLogin();
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };

    /* นับทุกคำขออ่านที่วิ่งออกจากชั้น db — ใช้พิสูจน์ว่า "ไม่แตะเน็ตเลย" */
    window.__reads = [];
    const feed = function (path) {
      window.__reads.push(path);
      if (/systemQty$/.test(path)) return Promise.resolve({ P1: 10, P2: 5 });
      const m = /^rounds\/([^/]+)\/scans$/.exec(path);
      if (m) {
        return Promise.resolve({
          s1: { code: 'P1', delta: 10, mode: 'scan', user: 'ท', ts: 100 },
          s2: { code: 'P2', delta: 4, mode: 'scan', user: 'ท', ts: 200 }
        });
      }
      return Promise.resolve(null);
    };
    window.db.get = feed;
    window.db.getQuiet = feed;

    /* รอบเดียว 1 Job — เล็กที่สุดที่ยังคิดสถิติได้ครบทุกฟิลด์ */
    window.__seedCycle = function (status) {
      state.me = { uid: 'u1', name: 'แอดมิน', role: 'admin', branches: [] };
      state.counter = 'แอดมิน';
      state.priceField = 'costPrice';
      state.products = {
        P1: { code: 'P1', name: 'สินค้า 1', type: 'product', costPrice: 10, sellPrice: 20 },
        P2: { code: 'P2', name: 'สินค้า 2', type: 'product', costPrice: 10, sellPrice: 20 }
      };
      state.roundIndex = {
        R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
              cycleId: 'CYC1', status: status, createdAt: 1 }
      };
      state.cycles = { CYC1: { status: status, info: { branchCode: 'B1', schema: 1 } } };
      state.cycleStats = {};
      state.jobStats = {};
      try {
        localStorage.removeItem('cycleStats:CYC1');
        localStorage.removeItem('jobStats:R1');
      } catch (e) {}
      window.__reads.length = 0;
    };
  });

  /* ---------- [1] รอบ closed: โหลดครั้งแรกแล้วเก็บลงเครื่อง ---------- */
  console.log('\n[1] รอบปิดแล้ว — โหลดรอบแรกแล้วเก็บลงเครื่อง');
  const r1 = await page.evaluate(async () => {
    window.__seedCycle('closed');
    const stat = await loadCycleStats('CYC1');
    let raw = null;
    try { raw = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}
    return { stat: stat, reads: window.__reads.slice(),
             saved: raw ? JSON.parse(raw) : null };
  });
  check('รอบแรกอ่านจากเน็ตจริง', r1.reads.length > 0, r1.reads);
  check('คิดสถิติได้ครบ', r1.stat && r1.stat.cid === 'CYC1' && r1.stat.jobs === 1 &&
        r1.stat.sysQty === 15 && r1.stat.pieces === 14, r1.stat);
  check('⭐ เก็บลงเครื่องแล้ว', !!r1.saved && r1.saved.cid === 'CYC1', r1.saved);
  check('⭐ แนบเลขเวอร์ชันแคชไปด้วย', r1.saved && r1.saved.v === 1, r1.saved);
  check('⭐ แนบราคาที่ใช้คิดไปด้วย (มูลค่าผูกกับราคาที่เลือก)',
        r1.saved && r1.saved.price === 'costPrice', r1.saved);

  /* ---------- [2] เปิดใหม่: ต้องไม่แตะเน็ตเลย ---------- */
  console.log('\n[2] ⭐ เปิดแอปใหม่ — รอบปิดแล้วต้องไม่แตะเน็ตเลย');
  const r2 = await page.evaluate(async () => {
    /* จำลอง "รีเฟรชหน้า": ล้างแคชในหน่วยความจำ แต่ของในเครื่องยังอยู่ */
    state.cycleStats = {};
    state.jobStats = {};
    try { localStorage.removeItem('jobStats:R1'); } catch (e) {}
    window.__reads.length = 0;
    const stat = await loadCycleStats('CYC1');
    return { stat: stat, reads: window.__reads.slice(),
             inMemory: !!state.cycleStats.CYC1 };
  });
  check('⭐ ไม่มีคำขออ่านออกไปเลยสักใบ', r2.reads.length === 0, r2.reads);
  check('⭐ ได้ตัวเลขชุดเดิมจากเครื่อง',
        r2.stat && r2.stat.sysQty === 15 && r2.stat.pieces === 14 &&
        r2.stat.jobs === 1, r2.stat);
  check('ยกขึ้นมาไว้ในหน่วยความจำให้ด้วย', r2.inMemory === true, r2.inMemory);

  /* ---------- [3] รอบที่ยังนับอยู่ ---------- */
  console.log('\n[3] ⭐ รอบที่ยังนับอยู่ — ต้องอ่านสดเสมอ');
  const r3 = await page.evaluate(async () => {
    window.__seedCycle('counting');
    await loadCycleStats('CYC1');
    const firstReads = window.__reads.slice();
    let raw = null;
    try { raw = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}

    /* รีเฟรชอีกรอบ ต้องกลับไปอ่านสดใหม่ ไม่ใช่หยิบของเก่ามาใช้ */
    state.cycleStats = {}; state.jobStats = {};
    try { localStorage.removeItem('jobStats:R1'); } catch (e) {}
    window.__reads.length = 0;
    await loadCycleStats('CYC1');
    return { firstReads: firstReads, saved: raw, secondReads: window.__reads.slice() };
  });
  check('อ่านสดรอบแรก', r3.firstReads.length > 0, r3.firstReads);
  check('⭐ ห้ามเก็บลงเครื่อง (คนกำลังยิงอยู่ เลขต้องขยับตามจริง)',
        r3.saved === null, r3.saved);
  check('⭐ รีเฟรชแล้วยังอ่านสดอีก', r3.secondReads.length > 0, r3.secondReads);

  console.log('\n[3b] รอบรอตรวจสอบก็ยังไม่นิ่ง — ห้ามแคชเหมือนกัน');
  const r3b = await page.evaluate(async () => {
    window.__seedCycle('reviewing');
    await loadCycleStats('CYC1');
    let raw = null;
    try { raw = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}
    return { saved: raw };
  });
  check('รอบ reviewing ไม่ถูกเก็บลงเครื่อง', r3b.saved === null, r3b.saved);

  /* ---------- [4] เปิดรอบใหม่ (closed -> counting) ---------- */
  console.log('\n[4] ⭐ รอบที่ปิดแล้วถูกเปิดใหม่ — แคชต้องถูกลบ');
  const r4 = await page.evaluate(async () => {
    window.__seedCycle('closed');
    await loadCycleStats('CYC1');
    let before = null;
    try { before = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}

    /* เปิดใหม่ผ่านเส้นทางจริง — ตัวที่ลบแคชอยู่ในนั้น */
    dropCycleStats(cycleOf(state.roundIndex.R1));
    state.roundIndex.R1.status = 'counting';
    state.cycles.CYC1.status = 'counting';
    let after = null;
    try { after = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}

    window.__reads.length = 0;
    state.jobStats = {};
    const stat = await loadCycleStats('CYC1');
    return { before: !!before, after: after, reads: window.__reads.slice(), stat: !!stat };
  });
  check('ก่อนเปิดใหม่มีแคชอยู่จริง', r4.before === true, r4.before);
  check('⭐ เปิดรอบใหม่แล้วแคชในเครื่องหายไปด้วย', r4.after === null, r4.after);
  check('⭐ รอบถัดไปกลับไปอ่านสด ไม่ค้างเลขเก่า',
        r4.reads.length > 0 && r4.stat === true, r4.reads);

  console.log('\n[4b] dropJobStats ก็ต้องลบแคชรอบที่ Job นั้นสังกัด');
  const r4b = await page.evaluate(async () => {
    window.__seedCycle('closed');
    await loadCycleStats('CYC1');
    dropJobStats('R1');
    let after = null;
    try { after = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}
    return { after: after, mem: !!state.cycleStats.CYC1 };
  });
  check('ยิงเพิ่ม/ลบ Job แล้วแคชรอบหายทั้งสองชั้น',
        r4b.after === null && r4b.mem === false, r4b);

  console.log('\n[4c] dropAllCycleStats ล้างของทุกรอบในเครื่อง');
  const r4c = await page.evaluate(async () => {
    window.__seedCycle('closed');
    await loadCycleStats('CYC1');
    try { localStorage.setItem('cycleStats:CYC9', '{"cid":"CYC9","v":1}'); } catch (e) {}
    /* ของคนอื่นห้ามโดนลูกหลง */
    try { localStorage.setItem('jobStats:R1', '{"counts":{},"v":2}'); } catch (e) {}
    dropAllCycleStats();
    let keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch (e) {}
    return { cyc: keys.filter(k => k && k.indexOf('cycleStats:') === 0),
             job: keys.filter(k => k && k.indexOf('jobStats:') === 0),
             mem: Object.keys(state.cycleStats).length };
  });
  check('ล้างแคชรอบในเครื่องหมดทุกใบ', r4c.cyc.length === 0, r4c.cyc);
  check('แคชสถิติใบนับไม่โดนลูกหลง', r4c.job.length === 1, r4c.job);
  check('ในหน่วยความจำก็ว่าง', r4c.mem === 0, r4c.mem);

  /* ---------- [5] แคชที่ใช้ไม่ได้ ---------- */
  console.log('\n[5] แคชคนละเวอร์ชัน / คนละราคา ต้องไม่เอามาใช้');
  const r5 = await page.evaluate(async () => {
    const out = {};
    const tryWith = async function (patch) {
      window.__seedCycle('closed');
      await loadCycleStats('CYC1');
      const raw = JSON.parse(localStorage.getItem('cycleStats:CYC1'));
      Object.keys(patch).forEach(function (k) { raw[k] = patch[k]; });
      localStorage.setItem('cycleStats:CYC1', JSON.stringify(raw));
      state.cycleStats = {}; state.jobStats = {};
      try { localStorage.removeItem('jobStats:R1'); } catch (e) {}
      window.__reads.length = 0;
      await loadCycleStats('CYC1');
      return window.__reads.length;
    };
    out.oldVersion = await tryWith({ v: 0 });
    out.otherPrice = await tryWith({ price: 'sellPrice' });
    out.brokenCid = await tryWith({ cid: 'CYC-OTHER' });
    return out;
  });
  check('⭐ แคชเวอร์ชันเก่า = โหลดใหม่', r5.oldVersion > 0, r5.oldVersion);
  check('⭐ แคชที่คิดด้วยราคาอีกชุด = โหลดใหม่ (ไม่งั้นมูลค่าผิดถาวร)',
        r5.otherPrice > 0, r5.otherPrice);
  check('แคชที่ cid ไม่ตรง = โหลดใหม่', r5.brokenCid > 0, r5.brokenCid);

  console.log('\n[5b] แคชพัง (JSON อ่านไม่ออก) ต้องไม่ทำให้หน้าพัง');
  const r5b = await page.evaluate(async () => {
    window.__seedCycle('closed');
    try { localStorage.setItem('cycleStats:CYC1', '{ไม่ใช่ json'); } catch (e) {}
    window.__reads.length = 0;
    const stat = await loadCycleStats('CYC1');
    return { ok: !!stat, reads: window.__reads.length };
  });
  check('อ่านแคชพังแล้วถอยไปโหลดสดได้', r5b.ok === true && r5b.reads > 0, r5b);

  console.log('\n[5c] เขียน localStorage ไม่ได้ (โหมดส่วนตัว/พื้นที่เต็ม)');
  const r5c = await page.evaluate(async () => {
    window.__seedCycle('closed');
    const realSet = localStorage.setItem.bind(localStorage);
    const realGet = localStorage.getItem.bind(localStorage);
    localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
    let stat = null, threw = false;
    try { stat = await loadCycleStats('CYC1'); } catch (e) { threw = true; }
    localStorage.setItem = realSet;

    /* อ่านก็พังได้เหมือนกัน */
    state.cycleStats = {}; state.jobStats = {};
    localStorage.getItem = function () { throw new Error('SecurityError'); };
    let stat2 = null;
    try { stat2 = await loadCycleStats('CYC1'); } catch (e) { threw = true; }
    localStorage.getItem = realGet;
    return { ok: !!stat, ok2: !!stat2, threw: threw };
  });
  check('⭐ เขียนแคชไม่ได้ก็ยังคืนสถิติได้ตามปกติ', r5c.ok === true, r5c);
  check('⭐ อ่านแคชไม่ได้ก็ยังคืนสถิติได้ตามปกติ', r5c.ok2 === true, r5c);
  check('ไม่โยน error ออกมาให้หน้าพัง', r5c.threw === false, r5c);

  /* ---------- [6] ทะเบียนสินค้ายังไม่มา ---------- */
  console.log('\n[6] ทะเบียนสินค้ายังมาไม่ถึง — ห้ามเก็บเลขที่อาจผิดลงเครื่อง');
  const r6 = await page.evaluate(async () => {
    window.__seedCycle('closed');
    state.products = {};
    await loadCycleStats('CYC1');
    let raw = null;
    try { raw = localStorage.getItem('cycleStats:CYC1'); } catch (e) {}
    return { saved: raw };
  });
  check('⭐ ไม่มีทะเบียนสินค้า = ไม่เก็บลงเครื่อง', r6.saved === null, r6.saved);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
