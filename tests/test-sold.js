/* ============================================================
   v2.36.0 — ขายออกระหว่างนับ (cycles/$cid/sold)
   ============================================================

   ที่มา: ร้านเปิดขายระหว่างนับ ของที่ขายไปแล้วไม่อยู่บนชั้น
   ยอดตั้งต้นจาก Zort จึงสูงกว่าของจริง → ขึ้น "ขาด" ทั้งที่ของไม่ได้หาย

   กติกา:
   - นำเข้าไฟล์ขาย (รหัสสินค้า + จำนวน) → เก็บที่ cycles/$cid/sold · อัปใหม่ = แทนที่ทั้งชุด
   - ควรเหลือ = Math.max(0, ตั้งต้น − ขาย) หักที่ "ประตูโหลด" เท่านั้น
     ประตูรายใบ (refreshSystemQty) · รวมทั้งรอบ (loadCycleRaw) · หัวรอบ/สกอร์บอร์ด (loadCycleStats)
     · export (loadJobsRaw) → ทุกหน้าได้ตัวเลขชุดเดียวกัน
   - ตั้งต้นไม่ถูกแตะ เก็บที่ state.systemQtyRaw เป็นหลักฐาน
   - การ์ด SKU โชว์ ตั้งต้น/ขายออก/ควรเหลือ/ยิงจริง/ผลต่าง เมื่อ sold > 0 · ไม่มีขาย = 3 ช่องเดิม
   - applyImport ลบคีย์ที่หายจากไฟล์ใหม่ โดยเทียบจาก systemQtyRaw (ยอดตั้งต้น)
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

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
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate(() => {
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: !!bad }); };
    window.enqueueWrite = function () {};
    window.renderDoc = function () {};
    hideLogin();

    /* ฐานจำลอง — getQuiet/get อ่านจาก __db · update เขียนลง __db และจดไว้ */
    window.__db = {};
    window.__writes = [];
    function at(path) {
      return path.split('/').filter(Boolean).reduce(function (cur, seg) {
        return cur == null ? undefined : cur[seg];
      }, window.__db);
    }
    function read(path) {
      var v = at(path);
      return Promise.resolve(v === undefined ? null : JSON.parse(JSON.stringify(v)));
    }
    window.db.get = read;
    window.db.getQuiet = read;
    window.db.update = function (path, patch) {
      window.__writes.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) });
      Object.keys(patch).forEach(function (k) {
        var segs = (path + '/' + k).split('/').filter(Boolean);
        var cur = window.__db;
        for (var i = 0; i < segs.length - 1; i++) cur = cur[segs[i]] || (cur[segs[i]] = {});
        if (patch[k] === null) delete cur[segs[segs.length - 1]];
        else cur[segs[segs.length - 1]] = patch[k];
      });
      return Promise.resolve();
    };

    /* P1 ตั้งต้น 5 ขาย 2 → ควรเหลือ 3 · ยิง 3 = ตรง
       P2 ตั้งต้น 4 ไม่มีขาย → ควรเหลือ 4 · ยิง 2 = ขาด 2
       P3 ตั้งต้น 1 ขาย 3 (ขายเกินตั้งต้น) → ควรเหลือ 0 ไม่ติดลบ · ยิง 1 = เกิน 1 */
    window.__seed = function () {
      window.__db = {
        cycles: { C1: { status: 'counting', info: {},
                        systemQty: { P1: 5, P2: 4, P3: 1 },
                        sold: { P1: 2, P3: 3 } } },
        rounds: { R1: { scans: {
          s1: { code: 'P1', delta: 3, user: 'สมชาย', ts: 1 },
          s2: { code: 'P2', delta: 2, user: 'สมชาย', ts: 2 },
          s3: { code: 'P3', delta: 1, user: 'สมชาย', ts: 3 }
        }, reasons: {} } }
      };
      window.__writes = [];
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.page = 'summary';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1, storeType: 'STOCK' } };
      state.cycles = { C1: { status: 'counting', info: {} } };
      state.priceField = 'costPrice';
      function p(code, price) { return { code: code, name: 'สินค้า ' + code, category: 'ห', type: 'product', costPrice: price }; }
      state.products = { P1: p('P1', 10), P2: p('P2', 20), P3: p('P3', 30) };
      state.systemQty = {}; state.systemQtyRaw = {}; state.sold = {};
      state.counts = { P1: 3, P2: 2, P3: 1 };
      state.scanQty = Object.assign({}, state.counts); state.manualQty = {};
      state.locations = { offline: {}, online: {} };
      state.locationSet = 'offline';
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {}; state.transferQty = {};
      state.zoneTotals = {}; state.foundZones = {}; state.reasons = {};
      state.appliedScanIds = Object.create(null);
      state.cycleData = null; state.cycleStats = {}; state.jobStats = {};
      try { localStorage.removeItem('jobStats:R1'); } catch (e) {}
      state.lastZoneName = ''; state.locationFilter = '';
      state.scanType = 'stock'; state.customShopZones = [];
      buildScanIndex();
    };
  });

  /* ---------- 1. parseSoldFile ---------- */
  console.log('\n[1] parseSoldFile — อ่านไฟล์ขาย');
  const r1 = await page.evaluate(() => {
    const ok = parseSoldFile({ rows: [
      ['รายงานยอดขาย 20-21 ต.ค.'],
      [],
      ['#', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน'],
      ['1', 'P1', 'ก', '2'],
      ['2', 'P1', 'ก', '1'],          // รหัสซ้ำ = บวกรวม
      ['3', 'A.B/1', 'ข', '1,200'],    // คีย์ต้อง safeKey · คอมมาหลักพัน
      ['4', 'P9', 'ค', 'abc'],         // จำนวนอ่านไม่ได้ = ข้าม
      ['5', '', 'ง', '4'],             // ไม่มีรหัส = ข้าม
      ['Exported by', 'admin']         // ท้ายไฟล์ = ข้าม
    ] });
    const csv = parseSoldFile(parseCsv('รหัสสินค้า,จำนวน\nP2,3\nP3,1\n'));
    let miss = null, empty = null;
    try { parseSoldFile({ rows: [['รหัสสินค้า', 'ชื่อสินค้า'], ['P1', 'ก']] }); } catch (e) { miss = e.message + ':' + (e.missing || []).join('+'); }
    try { parseSoldFile({ rows: [] }); } catch (e) { empty = e.message; }
    return { ok: ok, csv: csv, miss: miss, empty: empty };
  });
  check('รหัสซ้ำบวกรวม P1 = 3', r1.ok.sold.P1 === 3, r1.ok);
  check('รหัสมี . / ถูก safeKey + คอมมาหลักพัน = 1200', r1.ok.sold['A_B_1'] === 1200, r1.ok);
  check('ข้ามจำนวนเสีย / ไม่มีรหัส / ท้ายไฟล์ · นับ 3 แถว',
        r1.ok.count === 3 && r1.ok.sold.P9 === undefined && Object.keys(r1.ok.sold).length === 2, r1.ok);
  check('ไฟล์ CSV อ่านได้', JSON.stringify(r1.csv.sold) === '{"P2":3,"P3":1}' && r1.csv.count === 2, r1.csv);
  check('ไม่มีคอลัมน์จำนวน → MISSING_COLUMNS', r1.miss === 'MISSING_COLUMNS:รหัสสินค้า+จำนวน', r1.miss);
  check('ไฟล์ว่าง → EMPTY_FILE', r1.empty === 'EMPTY_FILE', r1.empty);

  /* ---------- 2. ประตูรายใบ refreshSystemQty ---------- */
  console.log('\n[2] refreshSystemQty — หัก Math.max(0, ตั้งต้น − ขาย)');
  const r2 = await page.evaluate(async () => {
    window.__seed();
    await refreshSystemQty();
    return { sys: state.systemQty, raw: state.systemQtyRaw, sold: state.sold, dbSys: window.__db.cycles.C1.systemQty };
  });
  check('ควรเหลือ P1 = 5−2 = 3', r2.sys.P1 === 3, r2.sys);
  check('ไม่มีขาย P2 = ตั้งต้น 4', r2.sys.P2 === 4, r2.sys);
  check('⭐ ขายเกินตั้งต้น P3 → 0 ไม่ติดลบ', r2.sys.P3 === 0, r2.sys);
  check('ตั้งต้นเก็บไว้ครบใน systemQtyRaw', JSON.stringify(r2.raw) === '{"P1":5,"P2":4,"P3":1}', r2.raw);
  check('⭐ ยอดตั้งต้นในฐานไม่ถูกแตะ', JSON.stringify(r2.dbSys) === '{"P1":5,"P2":4,"P3":1}', r2.dbSys);
  check('state.sold = ของในฐาน', JSON.stringify(r2.sold) === '{"P1":2,"P3":3}', r2.sold);

  /* ---------- 3. summaryData + การ์ด SKU ---------- */
  console.log('\n[3] summaryData + การ์ด SKU 5 ช่อง');
  const r3 = await page.evaluate(async () => {
    window.__seed();
    await refreshSystemQty();
    const d = summaryData();
    const by = {};
    d.rows.forEach(function (r) { by[r.key] = r; });
    function caps(r, kind) {
      const el = sumCardRow(r, kind, 'product');
      return Array.prototype.map.call(el.querySelectorAll('.s-nums > div'), function (b) {
        return b.textContent;
      });
    }
    return {
      p1: { sys: by.P1.sys, sysRaw: by.P1.sysRaw, sold: by.P1.sold, diff: by.P1.diff },
      p2: { sys: by.P2.sys, sysRaw: by.P2.sysRaw, sold: by.P2.sold, diff: by.P2.diff },
      p3: { sys: by.P3.sys, sysRaw: by.P3.sysRaw, sold: by.P3.sold, diff: by.P3.diff },
      c1: caps(by.P1, 'match'), c2: caps(by.P2, 'short'), c3: caps(by.P3, 'over'),
      short: sumCardRows(d, 'short').map(function (r) { return r.key; }),
      over: sumCardRows(d, 'over').map(function (r) { return r.key; }),
      match: sumCardRows(d, 'match').map(function (r) { return r.key; })
    };
  });
  check('P1 แถวมี sysRaw 5 · sold 2 · sys 3 · ผลต่าง 0',
        JSON.stringify(r3.p1) === '{"sys":3,"sysRaw":5,"sold":2,"diff":0}', r3.p1);
  check('P2 ไม่มีขาย sysRaw = sys', JSON.stringify(r3.p2) === '{"sys":4,"sysRaw":4,"sold":0,"diff":-2}', r3.p2);
  check('P3 ควรเหลือ 0 → ยิง 1 = เกิน +1', JSON.stringify(r3.p3) === '{"sys":0,"sysRaw":1,"sold":3,"diff":1}', r3.p3);
  check('⭐ การ์ด sold>0 = 5 ช่อง ตั้งต้น/ขายออก/ควรเหลือ/ยิงจริง/ผลต่าง',
        JSON.stringify(r3.c1) === JSON.stringify(['ตั้งต้น5', 'ขายออก-2', 'ควรเหลือ3', 'ยิงจริง3', 'ผลต่าง0']), r3.c1);
  check('การ์ดไม่มีขาย = 3 ช่องเดิม ระบบ/ยิงจริง/ผลต่าง',
        JSON.stringify(r3.c2) === JSON.stringify(['ระบบ4', 'ยิงจริง2', 'ผลต่าง-2']), r3.c2);
  check('การ์ดขายเกินตั้งต้น ควรเหลือ 0',
        JSON.stringify(r3.c3) === JSON.stringify(['ตั้งต้น1', 'ขายออก-3', 'ควรเหลือ0', 'ยิงจริง1', 'ผลต่าง+1']), r3.c3);
  check('⭐ กลุ่มการ์ดคิดจากควรเหลือ: ตรง P1 · ขาด P2 · เกิน P3',
        JSON.stringify([r3.match, r3.short, r3.over]) === '[["P1"],["P2"],["P3"]]', r3);

  /* ---------- 4. ทุกประตูได้ควรเหลือชุดเดียวกัน ---------- */
  console.log('\n[4] ทุกประตูโหลด — job / cycle / scoreboard / export ตรงกัน');
  const r4 = await page.evaluate(async () => {
    window.__seed();
    await refreshSystemQty();
    const job = Object.assign({}, state.systemQty);
    const jobSum = summaryData();
    const raw = await loadCycleRaw('C1');
    const stat = await loadCycleStats('C1');
    const exp = await loadJobsRaw(['R1']);
    const sumSys = jobSum.rows.reduce(function (s, r) { return s + r.sys; }, 0);
    const sumAct = jobSum.rows.reduce(function (s, r) { return s + r.act; }, 0);
    const match = jobSum.rows.filter(function (r) { return r.diff === 0; }).length;
    return { job: job, cycle: raw.sys, cycleRaw: raw.sysRaw, cycleSold: raw.sold, exp: exp[0].sys,
             statSys: stat && stat.sysQty, statSucc: stat && stat.success,
             sumSys: sumSys, sumAct: sumAct, success: match / jobSum.rows.length * 100 };
  });
  const want = '{"P1":3,"P2":4,"P3":0}';
  check('ประตูรายใบ (refreshSystemQty)', JSON.stringify(r4.job) === want, r4.job);
  check('ประตูรวมทั้งรอบ (loadCycleRaw)', JSON.stringify(r4.cycle) === want, r4.cycle);
  check('loadCycleRaw ส่งตั้งต้น + ขาย มาด้วย',
        JSON.stringify(r4.cycleRaw) === '{"P1":5,"P2":4,"P3":1}' && JSON.stringify(r4.cycleSold) === '{"P1":2,"P3":3}', r4);
  check('ประตู export (loadJobsRaw)', JSON.stringify(r4.exp) === want, r4.exp);
  check('⭐ หัวรอบ/สกอร์บอร์ด sysQty = ผลรวมควรเหลือในหน้าสรุป (7)',
        r4.statSys === 7 && r4.sumSys === 7, r4);
  check('⭐ %Success หัวรอบ = หน้าสรุป (1 ใน 3)',
        Math.abs(r4.statSucc - r4.success) < 1e-9 && Math.abs(r4.success - 100 / 3) < 1e-9, r4);

  /* ---------- 5. applyImport ลบคีย์เทียบจาก systemQtyRaw ---------- */
  console.log('\n[5] applyImport — ลบคีย์ที่หายจากไฟล์ เทียบยอดตั้งต้น');
  const r5 = await page.evaluate(async () => {
    window.__seed();
    await refreshSystemQty();
    window.__writes = [];
    const diff = await applyImport('C1', { products: {}, systemQty: { P1: 6 } });
    const sysW = window.__writes.filter(function (w) { return w.path === 'cycles/C1'; })[0];

    /* เคสที่ systemQty (ควรเหลือ) ไม่มีคีย์ แต่ตั้งต้นมี → ต้องอ่านจาก raw */
    window.__seed();
    state.systemQtyRaw = { Q9: 2 }; state.systemQty = {};
    window.__writes = [];
    const diff2 = await applyImport('C1', { products: {}, systemQty: { P1: 1 } });
    const sysW2 = window.__writes.filter(function (w) { return w.path === 'cycles/C1'; })[0];
    return { patch: sysW && sysW.patch, removed: diff.removedFromRound,
             patch2: sysW2 && sysW2.patch, removed2: diff2.removedFromRound, sold: window.__db.cycles.C1.sold };
  });
  check('เขียนยอดใหม่ P1 = 6 (ตั้งต้น ไม่ใช่ควรเหลือ)', r5.patch && r5.patch['systemQty/P1'] === 6, r5.patch);
  check('ลบ P2, P3 ที่หายจากไฟล์ · removed 2',
        r5.patch['systemQty/P2'] === null && r5.patch['systemQty/P3'] === null && r5.removed === 2, r5);
  check('⭐ เทียบจาก systemQtyRaw — คีย์ที่มีแต่ในตั้งต้นก็ถูกลบ',
        r5.patch2['systemQty/Q9'] === null && r5.removed2 === 1, r5.patch2);
  check('นำเข้ายอดระบบไม่แตะ sold', JSON.stringify(r5.sold) === '{"P1":2,"P3":3}', r5.sold);

  /* ---------- 6. applySoldImport / handleSoldImport ---------- */
  console.log('\n[6] นำเข้าไฟล์ขาย — แทนที่ทั้งชุด + ล้างแคชรอบ');
  const r6 = await page.evaluate(async () => {
    window.__seed();
    await refreshSystemQty();
    window.__writes = [];
    await applySoldImport('C1', { P1: 1, P2: 2 });
    const w = window.__writes[0];

    window.__seed();
    await refreshSystemQty();
    await loadCycleStats('C1');
    state.cycleData = { stale: true };
    const hadStat = !!state.cycleStats.C1;
    window.__toasts = [];
    const file = new File(['รหัสสินค้า,จำนวน\nP2,1\n'], 'sold.csv', { type: 'text/csv' });
    await handleSoldImport(file);
    return { path: w.path, patch: w.patch, hadStat: hadStat,
             cycleData: state.cycleData, stat: state.cycleStats.C1 || null,
             sold: window.__db.cycles.C1.sold, sys: state.systemQty, toasts: window.__toasts };
  });
  check('applySoldImport เขียน cycles/C1 ด้วย update', r6.path === 'cycles/C1', r6.path);
  check('⭐ อัปใหม่ = แทนที่ทั้งชุด (P3 เดิมถูกลบ)',
        JSON.stringify(r6.patch) === '{"sold/P1":1,"sold/P2":2,"sold/P3":null}', r6.patch);
  check('handleSoldImport → ฐาน sold = ไฟล์ใหม่', JSON.stringify(r6.sold) === '{"P2":1}', r6.sold);
  check('ควรเหลือคิดใหม่ทันที (P1 กลับเป็น 5 · P2 = 3)',
        JSON.stringify(r6.sys) === '{"P1":5,"P2":3,"P3":1}', r6.sys);
  check('⭐ ล้างแคชยอดรวมรอบ + หัวรอบ (ไม่ค้างตัวเลขก่อนหักขาย)',
        r6.hadStat && r6.cycleData === null && r6.stat === null, r6);
  check('แจ้งผลสำเร็จ', r6.toasts.some(function (t) { return !t.bad && /นำเข้ายอดขาย 1 รายการ/.test(t.m); }), r6.toasts);

  /* ---------- 7. สิทธิ์ + สถานะรอบ ---------- */
  console.log('\n[7] กันสิทธิ์ + รอบปิด');
  const r7 = await page.evaluate(async () => {
    const file = function () { return new File(['รหัสสินค้า,จำนวน\nP2,1\n'], 'sold.csv'); };
    window.__seed();
    state.me = { uid: 'u2', name: 'ยิงอย่างเดียว', role: 'scanner', branches: [] };
    window.__writes = [];
    await handleSoldImport(file());
    const scanner = window.__writes.length;

    window.__seed();
    state.cycles.C1.status = 'closed';
    window.__writes = [];
    await handleSoldImport(file());
    const closed = window.__writes.length;

    window.__seed();
    state.me = { uid: 'u3', name: 'custom', role: 'custom', perms: { importSysQty: true }, branches: [] };
    window.__writes = [];
    await handleSoldImport(file());
    return { scanner: scanner, closed: closed, custom: window.__writes.length };
  });
  check('scanner (ไม่มี importSysQty) เขียนไม่ได้', r7.scanner === 0, r7);
  check('รอบปิดแล้วเขียนไม่ได้', r7.closed === 0, r7);
  check('custom + importSysQty เขียนได้', r7.custom === 1, r7);

  /* ---------- 8. เทมเพลต ---------- */
  console.log('\n[8] เทมเพลตไฟล์ขาย อ่านกลับได้');
  const r8 = await page.evaluate(async () => {
    let blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { blob = b; return 'blob:x'; };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try { downloadSoldTemplate(); } finally {
      URL.createObjectURL = orig;
      HTMLAnchorElement.prototype.click = origClick;
    }
    const parsed = await parseXlsx(await blob.arrayBuffer());
    return parseSoldFile(parsed);
  });
  check('เทมเพลตมีหัว รหัสสินค้า + จำนวน แล้ว parse ได้ 2 แถว', r8.count === 2, r8);

  /* ---------- 9. ไม่มีขาย = เหมือนเดิม ---------- */
  console.log('\n[9] ไม่มีขาย = พฤติกรรมเดิม');
  const r9 = await page.evaluate(async () => {
    window.__seed();
    delete window.__db.cycles.C1.sold;
    await refreshSystemQty();
    return { sys: state.systemQty, raw: state.systemQtyRaw, sold: state.sold };
  });
  check('ไม่มีโหนด sold → ควรเหลือ = ตั้งต้น',
        JSON.stringify(r9.sys) === '{"P1":5,"P2":4,"P3":1}' && JSON.stringify(r9.sold) === '{}', r9);

  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors);

  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
