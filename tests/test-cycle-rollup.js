/* ============================================================
   v2.7.0 — รอบนับที่มีหลาย Job ต้องรวมยอดทุกใบก่อนคิดผลต่าง
   ============================================================

   อาการเดิม: รอบ POP08-STOCK-20260817-01 มี 3 Job
     STOCK-01 = 1,199 · STOCK-02 = 16 · SHOW-01 = 386  →  รวม 1,601
   รายงาน PDF ใช้ buildCycleData() รวมทุกใบ = ถูก
   แต่หน้าสรุป / Excel / แท็บโอนกลับ ใช้ state.counts ของ Job ที่เปิดอยู่ใบเดียว
   จึงได้ 1,201 และขึ้น "ขาด" หลอกทุกตัวที่คนอื่นนับไว้ในใบอื่น

   เส้นแบ่งที่ต้องไม่พลาด:
   - รอบมีหลาย Job  → ทุกจุดใช้ยอดรวมทุกใบ ตรงกับ PDF
   - รอบมี Job เดียว → ต้องเหมือนเดิมเป๊ะ ห้ามโหลดอะไรเพิ่ม ห้ามเปลี่ยนพฤติกรรม
   - ปุ่มเอาออกในป๊อปอัป ยังต้องหักได้แค่ยอดของ Job ที่เปิดอยู่ (เขียนลงใบนี้ใบเดียว)
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
    window.__toasts = []; window.__writes = []; window.__reads = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'gen' + (++n); }; })();
    window.__realRenderDoc = window.renderDoc;      // เก็บตัวจริงไว้ให้ข้อที่เทสหัวเอกสาร
    window.renderDoc = function () {};
    hideLogin();

    /* ---------- ยอดจริงของรอบที่แจ้งมา ----------
       สินค้า 3 ตัว กระจายกันนับคนละใบ — เลขรวมต้องได้ 1,601 เท่ากับที่นับได้จริง */
    /* ใบ SHOW ยิง 381 + กรอกมืออีก 5 (เติมในตัว mock ข้างล่าง) = 386 ตามที่แจ้งมา */
    window.__JOBS = {
      'R-STOCK-01': { P1: 1000, P2: 199 },              // 1,199
      'R-STOCK-02': { P2: 16 },                         //    16
      'R-SHOW-01':  { P1: 300, P3: 75, TF1: 6 }         //   381 + 5 กรอกมือ = 386
    };
    window.__SYS = { P1: 1300, P2: 215, P3: 80, TF1: 6 };   // = 1,601 พอดี ผลต่างต้องเป็น 0

    /* db.get / db.getQuiet ปลอม — คืน scans ของแต่ละ Job ให้ loadCycleRaw ตามของจริง
       นับจำนวนครั้งที่อ่านไว้ด้วย ใช้พิสูจน์ว่ารอบ Job เดียวไม่แตะเน็ตเลย

       ต้องปลอมทั้งสองตัว: loadCycleSystemQty กับ legacyRoundParts อ่านผ่าน getQuiet
       ถ้าปลอมแต่ db.get ยอดระบบจะไม่มาถึงตัวรวมยอด ทุกแถวจะได้ sys = 0
       ของที่ควร "ตรง" จะไหลไปกองใน "เกิน" หมด ป๊อปอัป match จะว่าง แล้วข้อ 6 พังทั้งไฟล์
       (getQuiet ถูกแยกออกมาตอน v2.7.x เทสก็เงียบ ๆ ไปยิงเน็ตจริงตั้งแต่นั้น) */
    window.__fakeRead = function (path) {
      window.__reads.push(path);
      const m = /^rounds\/([^/]+)\/scans$/.exec(path);
      if (m) {
        const counts = window.__JOBS[m[1]] || {};
        const out = {};
        let i = 0;
        Object.keys(counts).forEach(function (k) {
          out['s' + (++i)] = { code: k, delta: counts[k], mode: 'scan',
                               user: 'คนนับ ' + m[1], ts: 1000 + i };
        });
        /* ใบ SHOW ใส่รายการกรอกมือปนไว้ 1 แถว — ใช้เช็คว่าคอลัมน์ "กรอกมือ" ไม่หายตอนรวม */
        /* คนของใบ STOCK-01 ไปช่วยกรอกมือที่ใบ SHOW ด้วย — ใช้เช็คว่าคนเดียวกันยิงข้ามใบ
           ต้องถูกยุบเป็นคนเดียวในหัวเอกสาร ไม่ใช่นับเป็นสองคน */
        if (m[1] === 'R-SHOW-01') {
          out.sm = { code: 'P3', delta: 5, mode: 'manual', reason: 'นับมือ',
                     user: 'คนนับ R-STOCK-01', ts: 1500 };
        }
        return Promise.resolve(out);
      }
      if (/systemQty$/.test(path)) return Promise.resolve(window.__SYS);
      return Promise.resolve(null);
    };
    window.db.get = window.__fakeRead;
    window.db.getQuiet = window.__fakeRead;

    /* ---------- ตั้งรอบ ---------- */
    window.__seed = function (jobIds, openId) {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.priceField = 'costPrice'; state.summaryTab = 'job';
      state.page = 'summary';
      state.products = {
        P1: { code: 'P1', name: 'สินค้า 1', category: 'ห', type: 'product', costPrice: 10 },
        P2: { code: 'P2', name: 'สินค้า 2', category: 'ห', type: 'product', costPrice: 10 },
        P3: { code: 'P3', name: 'สินค้า 3', category: 'ห', type: 'product', costPrice: 10 },
        TF1: { code: 'TF1', name: 'ของโอนกลับ', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.roundIndex = {};
      jobIds.forEach(function (id, i) {
        state.roundIndex[id] = {
          id: id, name: 'รอบทดสอบ', branchCode: 'POP08', jobCode: id.replace('R-', ''),
          cycleId: 'CYC1', status: 'counting', createdAt: 100 + i
        };
      });
      state.roundId = openId; state.cycleId = 'CYC1';

      /* ยอดระบบเป็นของทั้งรอบเสมอ (loadCycleSystemQty) — ทุกใบเห็นก้อนเดียวกัน */
      state.systemQty = {};
      Object.keys(window.__SYS).forEach(function (k) { state.systemQty[k] = window.__SYS[k]; });

      /* state.counts = ยอดของ "ใบที่เปิดอยู่" เท่านั้น ตรงตามที่แอปจริงเก็บ */
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      const mine = window.__JOBS[openId] || {};
      Object.keys(mine).forEach(function (k) {
        state.counts[k] = mine[k]; state.scanQty[k] = mine[k];
      });
      if (openId === 'R-SHOW-01') {          // ให้ตรงกับแถวกรอกมือใน mock
        state.counts.P3 = (state.counts.P3 || 0) + 5;
        state.manualQty.P3 = 5;
      }

      state.zones = {}; state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.transfers = {}; state.transferQty = {};
      state.cycleData = null; state.docScope = 'job'; state.docScopeTouched = false;
      state.itemTab = 'items';
      window.__toasts = []; window.__writes = []; window.__reads = [];
    };

    window.__totals = function (d) {
      return { sysQty: d.groups.total.sysQty, actQty: d.groups.total.actQty,
               skuShort: d.groups.total.skuShort, skuOver: d.groups.total.skuOver,
               skuMatch: d.groups.total.skuMatch, pcShort: d.groups.total.pcShort };
    };
  });

  /* ---------- 1. ยอดยิงรวม = ผลรวมทุก Job ---------- */
  console.log('\n[1] รอบ 3 Job — ยอดยิงรวมต้องเป็นผลรวมทุกใบ');
  const r1 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    const jobOnly = window.__totals(summaryData());          // ก่อนรวม = ของใบเดียว
    const scope = cycleScope();
    const cd = await ensureCycleData();
    const rolled = window.__totals(cd.data);
    return {
      multi: scope.multi, cid: scope.cid,
      jobOnly: jobOnly, rolled: rolled,
      perJob: cd.raw.perJob.map(function (j) { return { code: j.jobCode, pieces: j.pieces }; })
        .sort(function (a, b) { return a.code.localeCompare(b.code); })
    };
  });
  check('รู้ว่ารอบนี้มีหลาย Job', r1.multi === true && r1.cid === 'CYC1', r1);
  check('ก่อนรวม เห็นแค่ยอดใบที่เปิดอยู่ 1,199', r1.jobOnly.actQty === 1199, r1.jobOnly);
  check('หลังรวม ได้ 1,601 = 1,199 + 16 + 386',
        r1.rolled.actQty === 1601, r1.rolled);
  check('ยอดระบบยังเป็นของทั้งรอบเหมือนเดิม 1,601',
        r1.rolled.sysQty === 1601 && r1.jobOnly.sysQty === 1601, r1);
  check('รวมแล้วผลต่างเป็น 0 — ไม่มี "ขาด" หลอกอีก',
        r1.rolled.skuShort === 0 && r1.rolled.pcShort === 0, r1.rolled);
  check('ก่อนแก้ ใบเดียวขาดหลอก 402 ชิ้น (1,601 − 1,199)',
        r1.jobOnly.pcShort === 402, r1.jobOnly);
  check('ตารางแยกราย Job ครบ 3 ใบ ยอดตรงทุกใบ',
        JSON.stringify(r1.perJob) === JSON.stringify([
          { code: 'SHOW-01', pieces: 386 },     // 381 ยิง + 5 กรอกมือ
          { code: 'STOCK-01', pieces: 1199 },
          { code: 'STOCK-02', pieces: 16 }
        ]), r1.perJob);

  /* ---------- 2. หน้าสรุป + Excel ใช้ยอดรวม ---------- */
  console.log('\n[2] การ์ดหน้าสรุป และ Excel ต้องได้ยอดรวม');
  const r2 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    renderSummary();                                   // วาดรอบแรก = ยังไม่มียอดรวม
    const firstPaint = {
      short: $('cardShortNum').textContent,
      scope: $('sumScopeInfo').textContent
    };
    await ensureCycleData();
    renderSummary();                                   // วาดซ้ำหลังยอดรวมมาถึง
    const rows = Array.prototype.map.call($('sumBody').querySelectorAll('tr'), function (tr) {
      return { group: tr.getAttribute('data-group'),
               act: tr.querySelector('[data-col="actQty"]').textContent,
               sys: tr.querySelector('[data-col="sysQty"]').textContent,
               pct: tr.querySelector('[data-col="pctPieces"]').textContent };
    });
    const total = rows.filter(function (r) { return r.group === 'total'; })[0];

    /* Excel — ต้องรอยอดรวมเองโดยไม่ต้องมีใครสั่ง */
    const data = await ensureReportData();
    return {
      firstPaint: firstPaint,
      scopeAfter: $('sumScopeInfo').textContent,
      cardShort: $('cardShortNum').textContent,
      cardMatch: $('cardMatchNum').textContent,
      totalRow: total,
      excelAct: data.groups.total.actQty,
      excelSameObject: data === state.cycleData.data
    };
  });
  check('วาดครั้งแรกยังเป็นของใบเดียว แต่บอกผู้ใช้ว่ากำลังรวม',
        /กำลังรวมยอดทุกใบ/.test(r2.firstPaint.scope), r2.firstPaint);
  check('รวมเสร็จแล้วบอกว่ารวมครบ 3 ใบ',
        /รวมทุก Job/.test(r2.scopeAfter) && /3 ใบ/.test(r2.scopeAfter), r2.scopeAfter);
  check('ตารางรวมโชว์ยอดจริง 1,601', r2.totalRow.act === '1,601', r2.totalRow);
  check('ยอดระบบยังเป็น 1,601', r2.totalRow.sys === '1,601', r2.totalRow);
  check('%Success (ชิ้น) = 100%', /100/.test(r2.totalRow.pct), r2.totalRow.pct);
  check('การ์ด "ขาด" เหลือ 0 SKU', r2.cardShort === '0', r2.cardShort);
  check('การ์ด "ตรง" ได้ครบ 4 SKU', r2.cardMatch === '4', r2.cardMatch);
  check('Excel ได้ total_act = 1,601 ตรงกับผลรวม 3 Job', r2.excelAct === 1601, r2.excelAct);
  check('Excel ใช้ก้อนเดียวกับหน้าจอ ไม่ได้คำนวณคนละชุด',
        r2.excelSameObject === true, r2.excelSameObject);

  /* ---------- 3. คอลัมน์กรอกมือไม่หายตอนรวม ---------- */
  console.log('\n[3] แยกยอดยิง / ยอดกรอกมือ ตอนรวมทั้งรอบ');
  const r3 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    const cd = await ensureCycleData();
    const p3 = cd.data.rows.filter(function (r) { return r.key === 'P3'; })[0];
    const p1 = cd.data.rows.filter(function (r) { return r.key === 'P1'; })[0];
    return { p3: { act: p3.act, scan: p3.scanQty, manual: p3.manualQty },
             p1: { act: p1.act, scan: p1.scanQty, manual: p1.manualQty },
             p1Jobs: p1.jobCount, p1Known: p1.known, p1InRound: p1.inRound };
  });
  check('P3 แยกได้ ยิง 75 · กรอกมือ 5 · รวม 80',
        r3.p3.act === 80 && r3.p3.scan === 75 && r3.p3.manual === 5, r3.p3);
  check('P1 ไม่มีกรอกมือ ยิงล้วน 1,300',
        r3.p1.act === 1300 && r3.p1.scan === 1300 && r3.p1.manual === 0, r3.p1);
  check('P1 ยิงจาก 2 ใบ (STOCK-01 + SHOW-01)', r3.p1Jobs === 2, r3.p1Jobs);
  check('known / inRound ติดมาครบ (ตารางของมาผิดสาขาถึงจะทำงาน)',
        r3.p1Known === true && r3.p1InRound === true, r3);

  /* ---------- 4. แท็บโอนกลับ ---------- */
  console.log('\n[4] แท็บโอนกลับ — diff ต้องไม่ติดลบหลอก');
  const r4 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    /* TF1 ถูกโอนกลับ 6 ชิ้น และถูกนับไว้ที่ใบ SHOW-01 ไม่ใช่ใบที่เปิดอยู่ */
    const tf = { tfNo: 'TF-001', status: 'ส่งแล้ว', to: 'คลังกลาง', pieces: 6,
                 items: { TF1: { code: 'TF1', name: 'ของโอนกลับ', qty: 6 } } };

    function diffOf(box) {
      const tds = box.querySelectorAll('tbody tr td');
      return Array.prototype.map.call(tds, function (td) { return td.textContent; });
    }
    const cd = await ensureCycleData();
    const oldWay = buildTransferItemTable(tf);                    // ไม่ส่ง counts = ของใบเดียว
    const newWay = buildTransferItemTable(tf, cd.raw.counts);     // ยอดรวมทุกใบ
    return { oldCells: diffOf(oldWay), newCells: diffOf(newWay),
             jobCount: state.counts.TF1 || 0, allCount: cd.raw.counts.TF1 };
  });
  check('ใบที่เปิดอยู่ไม่ได้นับ TF1 เลย (ยอด 0)', r4.jobCount === 0, r4.jobCount);
  check('แต่ทั้งรอบนับไว้ครบ 6 ชิ้น', r4.allCount === 6, r4.allCount);
  check('แบบเดิม (ใบเดียว) ขึ้นผลต่าง -6 หลอก',
        r4.oldCells.join('|').indexOf('-6') >= 0, r4.oldCells);
  check('แบบใหม่ (ยอดรวม) ผลต่างเป็น 0 ไม่มีค่าลบหลอก',
        r4.newCells.join('|').indexOf('-6') < 0 &&
        r4.newCells.filter(function (c) { return c === '6'; }).length >= 2, r4.newCells);

  /* ---------- 5. รอบ Job เดียว ต้องเหมือนเดิมเป๊ะ ---------- */
  console.log('\n[5] รอบ Job เดียว — ห้ามเปลี่ยนพฤติกรรม');
  const r5 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    const scope = cycleScope();
    window.__reads = [];
    const sync = reportDataSync();
    const awaited = await ensureReportData();
    const readsAfter = window.__reads.length;

    renderSummary();
    /* ยอดของ Job เดียว: P1 1000 + P2 199 = 1,199 เทียบยอดระบบ 1,601 = ขาด 402 */
    return {
      multi: scope.multi,
      ready: cycleDataReady(),
      cacheFresh: cycleCacheFresh(),
      reads: readsAfter,
      syncAct: sync.groups.total.actQty,
      awaitedAct: awaited.groups.total.actQty,
      scopeText: $('sumScopeInfo').textContent,
      cardShort: $('cardShortNum').textContent,
      sameShape: JSON.stringify(Object.keys(sync).sort()) ===
                 JSON.stringify(Object.keys(summaryData()).sort())
    };
  });
  check('รู้ว่าไม่ใช่รอบหลาย Job', r5.multi === false, r5.multi);
  check('ไม่แตะเน็ตเลยแม้แต่ครั้งเดียว', r5.reads === 0, r5.reads);
  check('ทั้งแบบรอและไม่รอ ได้ยอดของ Job นี้เท่ากัน 1,199',
        r5.syncAct === 1199 && r5.awaitedAct === 1199, r5);
  check('ไม่มีแถบบอกขอบเขตมากวน (ว่างเปล่า)', r5.scopeText === '', r5.scopeText);
  /* ใบนี้ยิงแค่ P1 กับ P2 — อีกสองตัวไปนับที่ใบอื่น จึงขาดครบ 4 SKU
     นี่คือ "ขาดหลอก" ที่เป็นต้นเรื่องทั้งหมด รอบ Job เดียวต้องยังเห็นแบบนี้เหมือนเดิม */
  check('การ์ด "ขาด" ยังทำงานเหมือนเดิม (4 SKU ที่ขาด)', r5.cardShort === '4', r5.cardShort);
  check('รูปร่างข้อมูลเหมือน summaryData() ทุกประการ', r5.sameShape === true, r5.sameShape);

  /* ---------- 6. ปุ่มเอาออก ต้องหักได้แค่ยอดของใบที่เปิดอยู่ ---------- */
  /* v2.15.0 — ปุ่มเอาออกเปลี่ยนเป็นรายการรายใบ ปุ่ม 'เอาออกทั้งหมด' จึงผูกกับ jobId
     ใจความเดิมยังเหมือนกัน: ตัวเลขบนปุ่มต้องเป็นยอดของใบนั้น ไม่ใช่ยอดรวมทั้งรอบ */
  console.log('\n[6] ปุ่มเอาออกในป๊อปอัป — ผูกกับยอดของใบนั้น ไม่ใช่ยอดรวมรอบ');
  const r6 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    await ensureCycleData();
    renderSummary();
    /* ห้าม await — openSumCard คืน promise ที่ resolve ตอน "ปิดกล่อง" ไม่ใช่ตอนวาดเสร็จ
       await แล้วจะค้างรอตลอดกาลเพราะไม่มีใครมากดปิด */
    openSumCard('match');

    /* P1: ทั้งรอบ 1,300 แต่ใบที่เปิดอยู่ยิงไว้ 1,000 — ปุ่มต้องบอก 1,000 ไม่ใช่ 1,300 */
    const row = document.querySelector('[data-sumcard-rows="match"] [data-sku="P1"]');
    const btnAll = row.querySelector('[data-removejoball]');
    const note = row.querySelector('[data-jobact]');

    /* TF1 ใบนี้ไม่ได้ยิงเลย — ต้องไม่มีปุ่มให้กด */
    const tfRow = document.querySelector('[data-sumcard-rows="match"] [data-sku="TF1"]');
    const tfBtn = tfRow ? tfRow.querySelector('[data-removejob="R-STOCK-01"]') : null;

    window.__writes = []; window.__toasts = [];
    removeOverScan({ key: 'TF1', code: 'TF1' }, 'match', 6);
    const blocked = { writes: window.__writes.length, toast: (window.__toasts[0] || {}).m };

    const out = {
      shownAct: row.querySelector('[data-cell="act"]').textContent,
      btnLabel: btnAll ? btnAll.textContent : null,
      noteText: note ? note.textContent : null,
      tfHasBtn: !!tfBtn,
      blocked: blocked
    };
    $('modalOk').click();          // เก็บกวาดกล่องที่เปิดค้างไว้ ไม่ให้ไปกวนข้อถัดไป
    return out;
  });
  check('แถวโชว์ยอดรวมทั้งรอบ 1,300', r6.shownAct === '1,300', r6.shownAct);
  check('ปุ่มเอาออกทั้งหมดของใบนี้บอก 1,000 (ไม่ใช่ยอดรวมรอบ 1,300)',
        /1,000/.test(r6.btnLabel || '') && !/1,300/.test(r6.btnLabel || ''), r6.btnLabel);
  check('มีบรรทัดบอกว่ายอดที่เห็นเป็นยอดรวม ใบนี้ยิงไว้เท่าไหร่',
        /รวมทุก Job/.test(r6.noteText || '') && /1,000/.test(r6.noteText || ''), r6.noteText);
  check('SKU ที่ใบนี้ไม่ได้ยิง ไม่มีปุ่มของใบนี้ให้กด', r6.tfHasBtn === false, r6.tfHasBtn);
  check('เรียกตรง ๆ ก็ไม่เขียน + บอกให้ไปเอาออกที่ใบที่นับ',
        r6.blocked.writes === 0 && /Job อื่น/.test(r6.blocked.toast || ''), r6.blocked);

  /* ---------- 6b. ชีท "ประวัติการนับ" ต้องครอบคลุมเท่าชีทสรุป ---------- */
  console.log('\n[6b] ชีทประวัติการนับ — ผลรวมต้องเท่ากับจำนวนจริงในหน้าสรุป');
  const r6b = await page.evaluate(async () => {
    /* ดัก buildXlsx เพื่ออ่านแถวที่กำลังจะถูกเขียนลงไฟล์ ไม่ต้องแกะไฟล์จริง */
    const realBuild = window.buildXlsx;
    let sheets = null;
    window.buildXlsx = function (s) { sheets = s; return realBuild(s); };
    /* กันไม่ให้เบราว์เซอร์ดาวน์โหลดไฟล์จริงตอนเทส
       ต้องปิด a.click() ด้วย ไม่งั้นเบราว์เซอร์บ่นว่าโหลด blob ปลอมไม่ได้ */
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function () { return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};

    function histOf() {
      const sh = sheets.filter(function (s) { return s.name === 'ประวัติการนับ'; })[0];
      const note = sh.rows[0][0];
      const head = sh.rows[1];
      const body = sh.rows.slice(2);
      const qtyCol = head.indexOf('จำนวน');
      return {
        note: note, head: head, rows: body.length, qtyCol: qtyCol,
        sum: body.reduce(function (s, r) { return s + (Number(r[qtyCol]) || 0); }, 0),
        jobs: head.indexOf('Job') >= 0
          ? body.map(function (r) { return r[head.indexOf('Job')]; })
                .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort()
          : null
      };
    }

    /* --- รอบ 3 Job --- */
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    await exportExcel();
    const cyc = histOf();
    const cycTotalAct = (await ensureReportData()).groups.total.actQty;

    /* --- รอบ Job เดียว --- */
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'สมชาย', ts: 1001 } },
      { id: 's2', rec: { code: 'P2', delta: 199, mode: 'scan', user: 'สมชาย', ts: 1002 } }
    ];
    await exportExcel();
    const solo = histOf();
    const soloTotalAct = summaryData().groups.total.actQty;

    window.buildXlsx = realBuild;
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return { cyc: cyc, cycTotalAct: cycTotalAct, solo: solo, soloTotalAct: soloTotalAct };
  });
  check('cycle: ผลรวมช่อง "จำนวน" ในชีทประวัติ = จำนวนจริงของ 3 Job (1,601)',
        r6b.cyc.sum === 1601 && r6b.cycTotalAct === 1601, r6b);
  check('cycle: ได้แถวประวัติครบทุกใบ (2 + 1 + 4 = 7 แถว)', r6b.cyc.rows === 7, r6b.cyc.rows);
  check('cycle: มีคอลัมน์ Job ให้ตรวจย้อนหลังว่าแถวไหนมาจากใบไหน',
        r6b.cyc.head[1] === 'Job' &&
        JSON.stringify(r6b.cyc.jobs) === JSON.stringify(['SHOW-01', 'STOCK-01', 'STOCK-02']),
        r6b.cyc);
  check('cycle: หัวชีทบอกว่ารวมทุก Job แล้ว', /รวมทุก Job/.test(r6b.cyc.note), r6b.cyc.note);
  check('job เดียว: ผลรวมยังเท่าจำนวนจริงของใบนั้น (1,199)',
        r6b.solo.sum === 1199 && r6b.soloTotalAct === 1199, r6b);
  check('job เดียว: หัวตารางเหมือนเดิมเป๊ะ ไม่มีคอลัมน์ Job งอกมา',
        JSON.stringify(r6b.solo.head) === JSON.stringify(
          ['วันเวลา', 'รหัสสินค้า', 'ชื่อสินค้า', 'โซน', 'ผู้นับ', 'จำนวน', 'วิธีนับ', 'เหตุผล', 'รหัสรายการ']),
        r6b.solo.head);
  check('job เดียว: หัวชีทยังบอกว่าเป็นของใบเดียว',
        /เป็นของ Job STOCK-01 เท่านั้น/.test(r6b.solo.note), r6b.solo.note);

  /* ---------- 7. กันยิงซ้อน ---------- */
  console.log('\n[7] ขอยอดรวมพร้อมกันหลายที่ ต้องอ่านชุดเดียว');
  const r7 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    window.__reads = [];
    const all = await Promise.all([ensureCycleData(), ensureCycleData(), ensureReportData()]);
    const scanReads = window.__reads.filter(function (p) { return /\/scans$/.test(p); }).length;
    window.__reads = [];
    await ensureCycleData();                       // มีแคชแล้ว ต้องไม่อ่านซ้ำ
    return { scanReads: scanReads, cachedReads: window.__reads.length,
             same: all[0] === all[1], act: all[0].data.groups.total.actQty };
  });
  check('เรียกพร้อมกัน 3 ที่ อ่าน scans แค่ 3 ใบ (ไม่ใช่ 9)', r7.scanReads === 3, r7.scanReads);
  check('ทุกคนได้ก้อนเดียวกัน', r7.same === true, r7.same);
  check('มีแคชแล้วไม่อ่านซ้ำเลย', r7.cachedReads === 0, r7.cachedReads);
  check('ยอดยังถูกต้อง 1,601', r7.act === 1601, r7.act);

  /* ---------- 8. หัวเอกสาร "ผู้นับในรอบนี้" ---------- */
  console.log('\n[8] หัวเอกสาร — ผู้นับต้องรวมทุก Job และกระทบยอดได้');
  const r8 = await page.evaluate(async () => {
    function readDoc() {
      return { scanners: $('docScanners').textContent, basis: $('docBasis').textContent };
    }

    /* --- รอบ 3 Job โหมดรวม --- */
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    state.page = 'doc';
    state.company = { name: 'บริษัททดสอบ', address: 'ที่อยู่ทดสอบ' };
    /* scanLog = ของใบที่เปิดอยู่ใบเดียว ตรงตามที่แอปจริงเก็บ (ต้นเหตุของบั๊ก) */
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1001 } },
      { id: 's2', rec: { code: 'P2', delta: 199, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1002 } }
    ];
    const jobOnlyWho = scannerStats();               // แบบเดิม = ใบเดียว

    await ensureCycleData();
    state.docScopeTouched = false;                   // ให้ default อัจฉริยะเลือก cycle เอง
    window.__realRenderDoc();
    const cyc = readDoc();
    const cycScope = state.docScope;
    const cycWho = scannerStats(cycleScannerEntries());
    const cycAct = state.cycleData.data.groups.total.actQty;

    /* --- รอบ Job เดียว --- */
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.page = 'doc';
    state.company = { name: 'บริษัททดสอบ', address: 'ที่อยู่ทดสอบ' };
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1001 } },
      { id: 's2', rec: { code: 'P2', delta: 199, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1002 } }
    ];
    state.docScopeTouched = false;
    window.__realRenderDoc();
    const solo = readDoc();

    return {
      jobOnlyWho: jobOnlyWho.map(function (w) { return { u: w.user, p: w.pieces }; }),
      cyc: cyc, cycScope: cycScope,
      cycWho: cycWho.map(function (w) { return { u: w.user, p: w.pieces }; }),
      cycWhoSum: cycWho.reduce(function (s, w) { return s + w.pieces; }, 0),
      cycAct: cycAct,
      solo: solo, soloScope: state.docScope
    };
  });

  check('ก่อนแก้: หัวเอกสารเห็นผู้นับแค่คนเดียว 1,199 ชิ้น (ต้นเหตุของบั๊ก)',
        r8.jobOnlyWho.length === 1 && r8.jobOnlyWho[0].p === 1199, r8.jobOnlyWho);
  check('เอกสารเลือกโหมดรวมเอง', r8.cycScope === 'cycle', r8.cycScope);
  check('หัวเอกสารนับผู้นับครบ 3 คน (ไม่ใช่ 1)',
        /ผู้นับในรอบนี้ 3 คน/.test(r8.cyc.scanners), r8.cyc.scanners);
  check('คนเดียวกันที่ยิงข้าม 2 ใบ ถูกยุบเป็นคนเดียว ยอดรวมกัน 1,204',
        r8.cycWho.length === 3 &&
        r8.cycWho.filter(function (w) { return w.u === 'คนนับ R-STOCK-01'; })[0].p === 1204,
        r8.cycWho);
  check('ยอดของแต่ละคนขึ้นครบในบรรทัดเดียวกัน',
        /คนนับ R-STOCK-01 \(1,204 ชิ้น\)/.test(r8.cyc.scanners) &&
        /คนนับ R-SHOW-01 \(381 ชิ้น\)/.test(r8.cyc.scanners) &&
        /คนนับ R-STOCK-02 \(16 ชิ้น\)/.test(r8.cyc.scanners), r8.cyc.scanners);
  check('บรรทัดบอกยอดรวมของผู้นับทุกคน = 1,601',
        /รวม 1,601 ชิ้น/.test(r8.cyc.scanners), r8.cyc.scanners);
  check('ยอดรวมผู้นับ reconcile กับ "จำนวนจริง" ทั้งรอบในตาราง',
        r8.cycWhoSum === 1601 && r8.cycAct === 1601 && r8.cycWhoSum === r8.cycAct, r8);
  check('ตรงกันแล้วไม่ต้องขึ้นวงเล็บอธิบายส่วนต่าง',
        r8.cyc.scanners.indexOf('ต่างกัน') < 0, r8.cyc.scanners);
  check('ป้ายขอบเขตไม่พูดว่า "รวมทั้งสาขา" อีกแล้ว (เอกสารเป็นของสาขาเดียว)',
        r8.cyc.basis.indexOf('รวมทั้งสาขา') < 0, r8.cyc.basis);
  check('ป้ายขอบเขตบอกตรงว่ารวมทุก Job ในรอบ กี่ใบ',
        /ขอบเขต: รวมทุก Job ในรอบนี้ \(3 ใบ\)/.test(r8.cyc.basis), r8.cyc.basis);

  check('รอบ Job เดียว: ยังเป็นโหมดเฉพาะ Job นี้', r8.soloScope === 'job', r8.soloScope);
  check('รอบ Job เดียว: ผู้นับ 1 คน 1,199 ชิ้น เท่าเดิม',
        /ผู้นับในรอบนี้ 1 คน/.test(r8.solo.scanners) &&
        /คนนับ R-STOCK-01 \(1,199 ชิ้น\)/.test(r8.solo.scanners), r8.solo.scanners);
  check('รอบ Job เดียว: ยอดรวมผู้นับ = จำนวนจริงของใบนั้น ไม่มีส่วนต่าง',
        /รวม 1,199 ชิ้น/.test(r8.solo.scanners) &&
        r8.solo.scanners.indexOf('ต่างกัน') < 0, r8.solo.scanners);
  check('รอบ Job เดียว: ป้ายขอบเขตยังเป็น "เฉพาะ Job นี้"',
        /ขอบเขต: เฉพาะ Job นี้/.test(r8.solo.basis), r8.solo.basis);

  /* ---------- 9. บาร์โค้ดผีต้องหลุดออกจากยอดผู้นับด้วย (v2.10.5) ----------
     ⚠️ ข้อนี้กลับด้านจากของเดิมโดยตั้งใจ
     เดิม (v2.7.1): ยอดผู้นับบวก delta ดิบ จึงรวมผีไปด้วย แล้วพิมพ์ส่วนต่างบอกในวงเล็บ
     ตอนนี้ (v2.10.5): ผู้นับใช้กติกาตัดแถวตัวเดียวกับตาราง ยอดจึงเท่ากันเสมอ
     ไม่มีส่วนต่างให้บอกอีกแล้ว และเอกสารต้องไม่พูดถึงบาร์โค้ดที่ถูกตัดเลย (คนอ่านสับสน) */
  console.log('\n[9] มีบาร์โค้ดผี — ยอดผู้นับต้องตัดผีออกให้เท่ากับตาราง');
  const r9 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.page = 'doc';
    state.company = { name: 'บริษัททดสอบ', address: 'ที่อยู่ทดสอบ' };
    /* ผีถูกหักเบิ้ลจนติดลบ 2 — v2.6.9 ตัดออกจากผลต่าง แต่แถวยังอยู่ในประวัติ */
    state.counts.GHOST = -2;
    state.unknownKeys = { GHOST: { key: 'GHOST', value: '8859999', qty: -2, firstTs: 1,
                                   zone: 'A', user: 'คนนับ R-STOCK-01', note: '' } };
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1001 } },
      { id: 's2', rec: { code: 'P2', delta: 199, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1002 } },
      { id: 's3', rec: { code: 'GHOST', delta: -2, mode: 'scan', unknown: true,
                         user: 'คนนับ R-STOCK-01', ts: 1003 } }
    ];
    state.docScopeTouched = false;
    window.__realRenderDoc();
    return { line: $('docScanners').textContent,
             act: summaryData().groups.total.actQty };
  });
  check('ยอดจริงในตารางไม่นับผี (ยัง 1,199)', r9.act === 1199, r9.act);
  check('⭐ ยอดผู้นับตัดผีออกแล้ว = 1,199 เท่าตาราง (เดิมเป็น 1,197)',
        /รวม 1,199 ชิ้น/.test(r9.line), r9.line);
  check('⭐ ไม่มีวงเล็บอธิบายส่วนต่างในเอกสารอีกแล้ว',
        r9.line.indexOf('ต่างกัน') < 0 &&
        r9.line.indexOf('ยอดจริงในตาราง') < 0 &&
        r9.line.indexOf('บาร์โค้ดที่ไม่นับเป็นสินค้าจริง') < 0, r9.line);
  check('ยอดที่โชว์รายคนก็เป็นเลขสะอาดเหมือนกัน',
        /คนนับ R-STOCK-01 \(1,199 ชิ้น\)/.test(r9.line), r9.line);

  /* ==========================================================
     [10] ⭐ "ผู้ยิงในรอบนี้" บนหน้าสรุป ต้องรวมทุก Job ในรอบ (v2.14.2)
     ==========================================================

     บั๊กเดิม: renderScanners() อ่าน state.scanLog ตรง ๆ ซึ่งเป็นของ Job ใบที่เปิดอยู่ใบเดียว
     รอบที่มีหลายใบจึงโชว์ยอดผู้ยิงน้อยกว่า "จำนวนจริง" ในตารางเทียบที่อยู่หน้าเดียวกัน
     คนอ่านเห็นสองตัวเลขขัดกันในจอเดียว แล้วไม่รู้ว่าอันไหนเชื่อได้

     ข้อ [8] พิสูจน์ไว้แล้วว่า scannerStats(cycleScannerEntries()) ให้ยอดถูก
     แต่ไม่ได้พิสูจน์ว่า "จอ" เรียกตัวนั้นจริง — ช่องว่างนี้คือที่ที่บั๊กหลุดออกไป
     ข้อนี้จึงวัดจาก DOM ที่วาดออกมาจริง ไม่ใช่เรียกฟังก์ชันคำนวณตรง ๆ */
  console.log('\n[10] ผู้ยิงในรอบนี้ — ต้องรวมทุก Job ให้ตรงกับตารางเทียบ');
  const r10 = await page.evaluate(async () => {
    const readDom = function () {
      const els = document.querySelectorAll('#scannerList [data-pieces]');
      const rows = Array.prototype.map.call(els, function (e) {
        return Number(e.getAttribute('data-pieces')) || 0;
      });
      return { rows: rows, sum: rows.reduce(function (a, b) { return a + b; }, 0),
               chip: Number($('scannerChip').textContent.replace(/,/g, '')) || 0 };
    };

    /* --- รอบ 3 Job --- */
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1001 } },
      { id: 's2', rec: { code: 'P2', delta: 199, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1002 } }
    ];
    renderScanners();
    const beforeRollup = readDom();          // ยังไม่มี cycleData = ต้องเป็นของใบเดียว

    await ensureCycleData();
    renderScanners();
    const afterRollup = readDom();

    const want = scannerStats(cycleScannerEntries());
    const tableAct = state.cycleData.data.groups.total.actQty;

    /* --- รอบ Job เดียว ต้องเหมือนเดิมเป๊ะ --- */
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1001 } },
      { id: 's2', rec: { code: 'P2', delta: 199, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1002 } }
    ];
    await ensureCycleData();
    renderScanners();
    const solo = readDom();
    const soloWant = scannerStats();

    return {
      beforeRollup: beforeRollup, afterRollup: afterRollup,
      wantSum: want.reduce(function (a, w) { return a + w.pieces; }, 0),
      wantRows: want.length, tableAct: tableAct,
      solo: solo, soloSum: soloWant.reduce(function (a, w) { return a + w.pieces; }, 0),
      soloRows: soloWant.length
    };
  });
  check('ก่อนมียอดรวมรอบ — โชว์ของใบที่เปิดอยู่ตามเดิม',
        r10.beforeRollup.sum === 1199, r10.beforeRollup);
  check('⭐ รอบหลายใบ — ยอดรวมผู้ยิงเท่า "จำนวนจริง" ในตารางเทียบ',
        r10.afterRollup.sum === r10.tableAct, r10.afterRollup);
  check('⭐ ตรงกับ scannerStats(cycleScannerEntries()) ที่ข้อ [8] พิสูจน์ไว้',
        r10.afterRollup.sum === r10.wantSum, { dom: r10.afterRollup.sum, want: r10.wantSum });
  check('จำนวนคนที่โชว์ก็รวมทุกใบด้วย',
        r10.afterRollup.rows.length === r10.wantRows, r10.afterRollup);
  check('ชิปบอกจำนวนคนตรงกับลิสต์',
        r10.afterRollup.chip === r10.afterRollup.rows.length, r10.afterRollup);
  check('⭐ รวมแล้วต้องมากกว่าของใบเดียว (พิสูจน์ว่าเปลี่ยนจริง)',
        r10.afterRollup.sum > r10.beforeRollup.sum, r10);
  check('⭐ รอบที่มี Job เดียว — เหมือนเดิมทุกอย่าง',
        r10.solo.sum === r10.soloSum && r10.solo.rows.length === r10.soloRows,
        { dom: r10.solo, want: { sum: r10.soloSum, rows: r10.soloRows } });

  /* ==========================================================
     [11] ⭐ สลับมาแท็บ "สรุปรอบนี้" แล้วต้องวาดตัวเลขทันที (v2.14.2)
     ==========================================================

     บั๊กเดิม: setSummaryTab() วาดใหม่เฉพาะตอนสลับไปแท็บ "ภาพรวมทุกสาขา"
     สลับกลับมาแท็บนี้จะโชว์ตัวเลขค้างจากครั้งก่อน ต้องไปกดสลับราคาให้มันวาดใหม่เอง
     คนใช้ไม่มีทางรู้ว่าเลขที่เห็นเป็นของเก่า ซึ่งอันตรายกว่าการไม่โชว์เลย */
  console.log('\n[11] สลับแท็บกลับมา — ตัวเลขต้องสดทันที');
  const r11 = await page.evaluate(() => {
    /* อ่านทั้งจำนวน SKU และยอดชิ้น — เพิ่มของให้ SKU ที่ขาดอยู่อาจไม่เปลี่ยนบัคเก็ต
       (ยังขาดอยู่เหมือนเดิม) แต่ยอดชิ้นต้องขยับเสมอ ถ้าวาดใหม่จริง */
    const nums = function () {
      return { match: $('cardMatchNum').textContent, matchPc: $('cardMatchPc').textContent,
               short: $('cardShortNum').textContent, shortPc: $('cardShortPc').textContent,
               over: $('cardOverNum').textContent, overPc: $('cardOverPc').textContent };
    };
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.summaryTab = 'job';
    renderSummary();
    const first = nums();

    /* ข้อมูลเปลี่ยนระหว่างที่คนไปดูแท็บอื่น (เพื่อนยิงเพิ่ม / โหลดใหม่เข้ามา) */
    state.counts.P1 = (state.counts.P1 || 0) + 7;
    state.scanQty.P1 = state.counts.P1;

    setSummaryTab('overview');
    const onOverview = { jobShown: $('sumJob').style.display,
                         ovShown: $('sumOverview').style.display };
    setSummaryTab('job');
    const back = nums();

    /* วาดเองอีกทีเพื่อหา "คำตอบที่ถูก" มาเทียบ */
    renderSummary();
    const truth = nums();
    return { first: first, back: back, truth: truth, onOverview: onOverview,
             jobShownBack: $('sumJob').style.display };
  });
  check('สลับไปแท็บภาพรวม — ซ่อนกล่องสรุปรอบ', r11.onOverview.jobShown === 'none', r11.onOverview);
  check('สลับกลับมา — โชว์กล่องสรุปรอบ', r11.jobShownBack === 'block', r11.jobShownBack);
  check('⭐ ตัวเลขหลังสลับกลับตรงกับของจริง ไม่ค้างของเก่า',
        JSON.stringify(r11.back) === JSON.stringify(r11.truth),
        { หลังสลับกลับ: r11.back, ของจริง: r11.truth });
  check('⭐ และต้องต่างจากตอนแรก (พิสูจน์ว่าวาดใหม่จริง ไม่ใช่บังเอิญเท่ากัน)',
        JSON.stringify(r11.back) !== JSON.stringify(r11.first),
        { ตอนแรก: r11.first, หลังสลับกลับ: r11.back });

  const r11b = await page.evaluate(() => {
    /* สลับไปมาหลายรอบต้องไม่พัง และไม่วนเรียกตัวเอง */
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.summaryTab = 'job';
    renderSummary();
    let calls = 0;
    const real = window.renderSummary;
    window.renderSummary = function () { calls++; return real.apply(this, arguments); };
    setSummaryTab('job');
    const once = calls;
    setSummaryTab('overview');
    setSummaryTab('job');
    setSummaryTab('overview');
    setSummaryTab('job');
    const total = calls;
    window.renderSummary = real;
    return { once: once, total: total };
  });
  check('สลับมาแท็บนี้ = วาดครั้งเดียว ไม่วนซ้ำ', r11b.once === 1, r11b);
  check('สลับไปมา 5 ครั้ง = วาด 3 ครั้ง (เฉพาะตอนมาแท็บนี้)', r11b.total === 3, r11b);

  /* ==========================================================
     [12] ⭐ เจาะสองชั้นในการ์ดผู้ยิง: คน → Job → โซน (v2.14.4)
     ==========================================================

     v2.14.2 รวมยอดผู้ยิงทุก Job แล้ว v2.14.3 แตกเป็นราย Job ได้
     แต่ตอนนั้นยังโชว์ "แยกตามโซน" แบบรวมทุก Job ปนกันอยู่ ซึ่งใช้งานจริงไม่ได้:
     โซน A ของใบ STOCK กับโซน A ของใบ SHOW เป็นคนละที่ เดินไปหาของตามตัวเลขนั้นไม่เจอ

     v2.14.4 จึงซ้อนโซนไว้ใต้ Job — กด Job ไหนถึงเห็นโซนของใบนั้น
     คนที่ยิงใบเดียวไม่มีชั้นให้ซ้อน กดชื่อแล้วเห็นโซนตรง ๆ เหมือนก่อน v2.14.3 */
  console.log('\n[12] เจาะสองชั้น — คน → Job → โซน');
  const r12 = await page.evaluate(async () => {
    const read = function (user) {
      const card = document.querySelector('[data-scanner="' + user + '"]');
      if (!card) return null;
      const jobRows = Array.prototype.map.call(card.querySelectorAll('[data-jobpieces]'), function (e) {
        return { job: e.getAttribute('data-jobpieces'),
                 label: e.querySelector('span').textContent,
                 n: Number(e.querySelector('b').textContent.replace(/[^0-9-]/g, '')) || 0 };
      });
      const zoneRows = Array.prototype.map.call(card.querySelectorAll('[data-jobzone]'), function (e) {
        return { key: e.getAttribute('data-jobzone'),
                 label: e.querySelector('span').textContent,
                 pad: e.style.paddingLeft,
                 n: Number(e.querySelector('b').textContent.replace(/[^0-9-]/g, '')) || 0 };
      });
      return {
        jobRows: jobRows,
        jobSum: jobRows.reduce(function (a, b) { return a + b.n; }, 0),
        zoneRows: zoneRows,
        zoneSum: zoneRows.reduce(function (a, b) { return a + b.n; }, 0),
        flatZones: card.querySelectorAll('[data-zone]').length,
        big: Number(card.querySelector('[data-pieces]').getAttribute('data-pieces'))
      };
    };

    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    await ensureCycleData();
    state.scannerOpen = 'คนนับ R-STOCK-01';
    state.scannerJobOpen = null;
    renderScanners();
    const level1 = read('คนนับ R-STOCK-01');          // กดชื่อแล้ว — ควรเห็นแค่ราย Job

    /* กดที่ Job แรก */
    const firstJob = level1.jobRows[0].job;
    document.querySelector('[data-scanner="คนนับ R-STOCK-01"] [data-jobpieces="' + firstJob + '"]')
      .click();
    const level2 = read('คนนับ R-STOCK-01');
    const openState = state.scannerJobOpen;

    /* กด Job เดิมซ้ำ = พับ */
    document.querySelector('[data-scanner="คนนับ R-STOCK-01"] [data-jobpieces="' + firstJob + '"]')
      .click();
    const collapsed = read('คนนับ R-STOCK-01');
    const collapsedState = state.scannerJobOpen;

    /* กาง Job แล้วไปกดคนอื่น — Job ที่กางค้างต้องถูกล้าง */
    document.querySelector('[data-scanner="คนนับ R-STOCK-01"] [data-jobpieces="' + firstJob + '"]')
      .click();
    const beforeSwitch = state.scannerJobOpen;
    document.querySelector('[data-scanner="คนนับ R-SHOW-01"] .m-top').click();
    const afterSwitch = { job: state.scannerJobOpen, user: state.scannerOpen };

    /* คนที่ยิงใบเดียว — ไม่มีชั้น Job */
    state.scannerOpen = 'คนนับ R-STOCK-02';
    state.scannerJobOpen = null;
    renderScanners();
    const solo = read('คนนับ R-STOCK-02');

    /* รอบ Job เดียว */
    window.__seed(['R-STOCK-01'], 'R-STOCK-01');
    state.scanLog = [
      { id: 's1', rec: { code: 'P1', delta: 1000, mode: 'scan', user: 'คนนับ R-STOCK-01', ts: 1001 } }
    ];
    await ensureCycleData();
    state.scannerOpen = 'คนนับ R-STOCK-01';
    state.scannerJobOpen = null;
    renderScanners();
    const single = read('คนนับ R-STOCK-01');

    return { level1: level1, level2: level2, openState: openState, firstJob: firstJob,
             collapsed: collapsed, collapsedState: collapsedState,
             beforeSwitch: beforeSwitch, afterSwitch: afterSwitch,
             solo: solo, single: single };
  });

  check('⭐ ชั้นที่ 1 — กดชื่อแล้วเห็นราย Job สองใบ', r12.level1.jobRows.length === 2, r12.level1.jobRows);
  check('⭐ ชั้นที่ 1 — ยังไม่โชว์โซน', r12.level1.zoneRows.length === 0, r12.level1.zoneRows);
  check('⭐ ผลรวมราย Job = ยอดใหญ่ข้างชื่อ',
        r12.level1.jobSum === r12.level1.big, { sum: r12.level1.jobSum, big: r12.level1.big });
  check('ยอดแต่ละใบถูกต้อง (STOCK-01 = 1,199 · SHOW-01 = 5)',
        JSON.stringify(r12.level1.jobRows.map(function (j) { return j.job + ':' + j.n; })) ===
        JSON.stringify(['STOCK-01:1199', 'SHOW-01:5']), r12.level1.jobRows);
  check('Job ที่ยังพับอยู่ขึ้นลูกศร ▸',
        r12.level1.jobRows.every(function (j) { return /^▸ /.test(j.label); }), r12.level1.jobRows);

  console.log('\n[12b] ชั้นที่ 2 — กด Job แล้วแตกเป็นโซนของใบนั้น');
  check('⭐ กด Job แล้วมีโซนโผล่', r12.level2.zoneRows.length > 0, r12.level2.zoneRows);
  check('⭐ ผลรวมโซน = จำนวนของ Job ใบนั้น',
        r12.level2.zoneSum === r12.level2.jobRows[0].n,
        { zoneSum: r12.level2.zoneSum, job: r12.level2.jobRows[0] });
  check('โซนที่โผล่เป็นของ Job ที่กดเท่านั้น',
        r12.level2.zoneRows.every(function (z) { return z.key.indexOf(r12.firstJob + '|') === 0; }),
        r12.level2.zoneRows);
  check('เยื้องเข้าไปให้เห็นว่าเป็นชั้นลูก', r12.level2.zoneRows.every(function (z) { return z.pad === '18px'; }),
        r12.level2.zoneRows);
  check('มีเครื่องหมาย ↳ นำหน้า', r12.level2.zoneRows.every(function (z) { return /^↳ /.test(z.label); }),
        r12.level2.zoneRows);
  check('Job ที่กางอยู่เปลี่ยนลูกศรเป็น ▾',
        /^▾ /.test(r12.level2.jobRows[0].label), r12.level2.jobRows[0]);
  check('จำ Job ที่กางไว้ใน state', r12.openState === 'คนนับ R-STOCK-01|' + r12.firstJob, r12.openState);
  check('Job อีกใบยังพับอยู่ ไม่กางพร้อมกัน',
        /^▸ /.test(r12.level2.jobRows[1].label), r12.level2.jobRows[1]);

  console.log('\n[12c] พับกลับ / สลับคน');
  check('กด Job ซ้ำแล้วโซนหายไป', r12.collapsed.zoneRows.length === 0, r12.collapsed.zoneRows);
  check('state ถูกล้าง', r12.collapsedState === null, r12.collapsedState);
  check('ก่อนสลับคนมี Job กางค้างอยู่', r12.beforeSwitch !== null, r12.beforeSwitch);
  check('⭐ กดคนอื่นแล้ว Job ที่กางค้างถูกรีเซ็ต', r12.afterSwitch.job === null, r12.afterSwitch);
  check('และสลับไปกางการ์ดคนใหม่แทน', r12.afterSwitch.user === 'คนนับ R-SHOW-01', r12.afterSwitch);

  console.log('\n[12d] คนที่ยิงใบเดียว / รอบ Job เดียว — โซนตรง ๆ เหมือนเดิม');
  check('คนที่ยิงใบเดียวไม่มีชั้น Job', r12.solo.jobRows.length === 0, r12.solo.jobRows);
  check('แต่เห็นโซนตรง ๆ', r12.solo.flatZones > 0, r12.solo.flatZones);
  check('⭐ รอบที่มี Job เดียว — ไม่มีชั้น Job', r12.single.jobRows.length === 0, r12.single.jobRows);
  check('และเห็นโซนตรง ๆ เหมือนก่อน v2.14.3', r12.single.flatZones > 0, r12.single.flatZones);

  /* ==========================================================
     [13] ⭐ ปรับยอดราย Job จากหน้าสรุป (v2.15.0)
     ==========================================================

     ของเดิมมีปุ่มเดียวที่หักเข้า "ใบที่เปิดอยู่" เสมอ ซึ่งผิดทันทีเมื่อของอยู่คนละใบ:
     P1 อยู่ใบ STOCK-01 1,000 และใบ SHOW-01 300 — ถ้าคนเปิดใบ STOCK แล้วอยากหักของ
     ที่ใบ SHOW นับเกิน กดปุ่มเดิมจะไปหักใบ STOCK แทน ใบ STOCK ยอดลดทั้งที่ไม่ผิด
     ส่วนใบ SHOW ยังเกินเหมือนเดิม = พังสองใบพร้อมกัน

     ตอนนี้โชว์ยอดแยกรายใบให้เลือกหักตรงใบ */
  console.log('\n[13] เอาออกราย Job — เลือกใบได้เอง');
  const r13 = await page.evaluate(async () => {
    const openCard = async function () {
      window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
      await ensureCycleData();
      renderSummary();
      openSumCard('match');
    };
    const readJobs = function (sku) {
      const row = document.querySelector('[data-sumcard-rows="match"] [data-sku="' + sku + '"]');
      if (!row) return null;
      return Array.prototype.map.call(row.querySelectorAll('[data-adjustjob]'), function (e) {
        const btn = e.querySelector('[data-removejob]');
        return { id: e.getAttribute('data-adjustjob'),
                 label: e.querySelector('span').textContent,
                 net: Number(e.querySelector('[data-jobnet]').getAttribute('data-jobnet')),
                 disabled: btn.disabled, btnText: btn.textContent };
      });
    };

    await openCard();
    const listed = readJobs('P1');
    const netOf = function (jobId, key) {
      const j = (state.cycleData.raw.jobs || []).filter(function (p) { return p.id === jobId; })[0];
      if (!j) return null;
      let n = 0;
      Object.keys(j.scans || {}).forEach(function (sid) {
        if (safeKey(j.scans[sid].code) === key) n += Number(j.scans[sid].delta) || 0;
      });
      return n;
    };
    const before = { show: netOf('R-SHOW-01', 'P1'), stock: netOf('R-STOCK-01', 'P1'),
                     total: state.cycleData.data.groups.total.actQty };

    /* [a] กด ➖ ที่ใบ SHOW-01 ทั้งที่เปิดใบ STOCK-01 อยู่ */
    window.__writes = []; window.__toasts = [];
    document.querySelector('[data-sumcard-rows="match"] [data-sku="P1"] ' +
                           '[data-removejob="R-SHOW-01"]').click();
    await new Promise(function (r) { setTimeout(r, 80); });
    const wroteOther = window.__writes.slice();
    const recOther = wroteOther.length
      ? wroteOther[0].patch[Object.keys(wroteOther[0].patch)[0]] : null;
    const countsAfterOther = state.counts.P1;

    /* [b] กด ➖ ที่ใบที่เปิดอยู่ */
    await openCard();
    window.__writes = []; window.__toasts = [];
    const countsBeforeOwn = state.counts.P1;
    document.querySelector('[data-sumcard-rows="match"] [data-sku="P1"] ' +
                           '[data-removejob="R-STOCK-01"]').click();
    /* อ่านทันที — writeScan อัปเดตยอดในเครื่องแบบ sync ส่วนการโหลดยอดรวมรอบใหม่
       จะมาทับทีหลัง (ยอดรวมมาจาก mock ที่ยังไม่รู้จักแถวที่เพิ่งเขียน) */
    const countsRightAfter = state.counts.P1;
    await new Promise(function (r) { setTimeout(r, 80); });
    const wroteOwn = window.__writes.slice();
    const recOwn = wroteOwn.length ? wroteOwn[0].patch[Object.keys(wroteOwn[0].patch)[0]] : null;

    /* [d] หักเกินยอดของใบนั้น → ต้องถูก cap */
    await openCard();
    window.__writes = [];
    /* หักมากกว่า 1 ชิ้นมีกล่องยืนยันคั่นเสมอ — ตอบตกลงให้ เพื่อทดสอบตัว cap ไม่ใช่ตัวถาม */
    const realAsk = window.ask;
    window.ask = function () { return Promise.resolve(true); };
    removeFromJob({ key: 'P1', code: 'P1' }, 'match', 'R-SHOW-01', 9999);
    await new Promise(function (r) { setTimeout(r, 80); });
    const capped = window.__writes.length
      ? window.__writes[0].patch[Object.keys(window.__writes[0].patch)[0]].delta : null;
    window.ask = realAsk;

    /* [e] ➕ เพิ่ม 1 → เข้าใบที่เปิดอยู่ */
    await openCard();
    window.__writes = [];
    document.querySelector('[data-sumcard-rows="match"] [data-sku="P1"] [data-addone]').click();
    await new Promise(function (r) { setTimeout(r, 80); });
    const added = window.__writes.length
      ? { path: window.__writes[0].path,
          rec: window.__writes[0].patch[Object.keys(window.__writes[0].patch)[0]] } : null;

    /* [c] ใบเป้าหมายไม่ได้อยู่ขั้นนับ */
    await openCard();
    state.roundIndex['R-SHOW-01'].status = 'reviewing';
    renderSummary();
    openSumCard('match');
    const closedList = readJobs('P1');
    window.__writes = []; window.__toasts = [];
    removeFromJob({ key: 'P1', code: 'P1' }, 'match', 'R-SHOW-01', 1);
    await new Promise(function (r) { setTimeout(r, 60); });
    const closedBlocked = { writes: window.__writes.length, toast: (window.__toasts[0] || {}).m };
    state.roundIndex['R-SHOW-01'].status = 'counting';

    /* [f] ไม่มีสิทธิ์ adjustCount */
    await openCard();
    /* ต้องมี viewSummary ด้วย ไม่งั้น openSumCard ไม่ยอมเปิดกล่องเลย
       แล้วจะไปอ่าน DOM ที่ค้างจากรอบก่อนแทน ซึ่งไม่ได้พิสูจน์อะไร */
    state.me = { uid: 'u9', name: 'ท', role: 'custom', branches: [],
                 perms: { scan: true, viewSummary: true } };
    renderSummary();
    openSumCard('match');
    const noPerm = { jobs: readJobs('P1'),
                     add: !!document.querySelector('[data-sumcard-rows="match"] [data-sku="P1"] [data-addone]') };
    window.__writes = []; window.__toasts = [];
    removeFromJob({ key: 'P1', code: 'P1' }, 'match', 'R-SHOW-01', 1);
    await new Promise(function (r) { setTimeout(r, 60); });
    const noPermBlocked = { writes: window.__writes.length, toast: (window.__toasts[0] || {}).m };

    $('modalOk').click();
    return {
      listed: listed, before: before,
      other: { writes: wroteOther.length, path: wroteOther[0] && wroteOther[0].path,
               rec: recOther, counts: countsAfterOther },
      own: { writes: wroteOwn.length, path: wroteOwn[0] && wroteOwn[0].path, rec: recOwn,
             countsBefore: countsBeforeOwn, countsAfter: countsRightAfter },
      capped: capped, added: added,
      closedList: closedList, closedBlocked: closedBlocked,
      noPerm: noPerm, noPermBlocked: noPermBlocked
    };
  });

  check('โชว์ทุกใบที่นับ SKU นี้ไว้ (P1 อยู่ 2 ใบ)', r13.listed.length === 2, r13.listed);
  check('ยอดรายใบถูก (STOCK-01 = 1,000 · SHOW-01 = 300)',
        JSON.stringify(r13.listed.map(function (j) { return j.id + ':' + j.net; })) ===
        JSON.stringify(['R-STOCK-01:1000', 'R-SHOW-01:300']), r13.listed);
  check('ติดป้ายว่าใบไหนคือใบที่เปิดอยู่',
        /ใบที่เปิดอยู่/.test(r13.listed[0].label) && !/ใบที่เปิดอยู่/.test(r13.listed[1].label),
        r13.listed.map(function (j) { return j.label; }));

  console.log('\n[13a] ⭐ กด ➖ ที่ใบอื่น — ต้องเขียนเข้าใบนั้น ไม่ใช่ใบที่เปิดอยู่');
  check('เขียน 1 แถว', r13.other.writes === 1, r13.other);
  check('⭐ ลงที่ rounds/R-SHOW-01 ไม่ใช่ใบที่เปิดอยู่', r13.other.path === 'rounds/R-SHOW-01', r13.other.path);
  check('delta = -1 · mode = scan', r13.other.rec.delta === -1 && r13.other.rec.mode === 'scan', r13.other.rec);
  check('⭐ เหตุผลระบุ Job ที่ถูกหักถูกใบ',
        r13.other.rec.reason === 'เอาออกจากสรุป (Job SHOW-01)', r13.other.rec.reason);
  check('บันทึกคนทำและเวลา', !!r13.other.rec.user && !!r13.other.rec.ts, r13.other.rec);
  check('⭐ ยอดของใบที่เปิดอยู่ไม่ถูกแตะ (state.counts เท่าเดิม)',
        r13.other.counts === 1000, r13.other.counts);

  console.log('\n[13b] กด ➖ ที่ใบที่เปิดอยู่ — เส้นทางเดิม');
  check('ลงที่ใบที่เปิดอยู่', r13.own.path === 'rounds/R-STOCK-01', r13.own.path);
  check('delta = -1', r13.own.rec.delta === -1, r13.own.rec);
  check('เหตุผลระบุใบที่เปิดอยู่',
        r13.own.rec.reason === 'เอาออกจากสรุป (Job STOCK-01)', r13.own.rec.reason);
  check('ยอดในเครื่องขยับทันที (1,000 → 999)',
        r13.own.countsBefore === 1000 && r13.own.countsAfter === 999, r13.own);

  console.log('\n[13c] ใบที่ไม่ได้อยู่ขั้นนับ');
  check('ปุ่มของใบนั้นถูกล็อก',
        r13.closedList.filter(function (j) { return j.id === 'R-SHOW-01'; })[0].disabled === true,
        r13.closedList);
  check('ปุ่มบอกเหตุผลว่าใบนี้ปิดอยู่',
        /ใบนี้ปิดอยู่/.test(r13.closedList.filter(function (j) { return j.id === 'R-SHOW-01'; })[0].btnText),
        r13.closedList);
  check('ใบที่ยังนับอยู่ยังกดได้ตามปกติ',
        r13.closedList.filter(function (j) { return j.id === 'R-STOCK-01'; })[0].disabled === false,
        r13.closedList);
  check('⭐ เรียกฟังก์ชันตรง ๆ ก็ไม่เขียน', r13.closedBlocked.writes === 0, r13.closedBlocked);
  check('บอกเหตุผลเป็นภาษาคน', /ไม่ได้อยู่ขั้นนับ/.test(r13.closedBlocked.toast || ''),
        r13.closedBlocked.toast);

  console.log('\n[13d] หักเกินยอดของใบนั้น ต้องถูก cap');
  check('⭐ ขอหัก 9,999 จากใบที่มี 300 → เขียน -300 ไม่ใช่ -9,999', r13.capped === -300, r13.capped);

  console.log('\n[13e] ➕ เพิ่ม 1 ชิ้น');
  check('เข้าใบที่เปิดอยู่', r13.added.path === 'rounds/R-STOCK-01', r13.added);
  check('delta = +1 · mode = scan',
        r13.added.rec.delta === 1 && r13.added.rec.mode === 'scan', r13.added.rec);
  check('เหตุผลบอกว่าเจอของเพิ่ม',
        r13.added.rec.reason === 'เพิ่มจากสรุป (เจอของ)', r13.added.rec.reason);

  console.log('\n[13f] ไม่มีสิทธิ์ adjustCount');
  check('⭐ ไม่มีรายการรายใบให้กดเลย', r13.noPerm.jobs.length === 0, r13.noPerm.jobs);
  check('ไม่มีปุ่มเพิ่มด้วย', r13.noPerm.add === false, r13.noPerm.add);
  check('⭐ เรียกฟังก์ชันตรง ๆ ก็ไม่เขียน', r13.noPermBlocked.writes === 0, r13.noPermBlocked);
  check('บอกเหตุผลเรื่องสิทธิ์',
        /สิทธิ์|ความสามารถ/.test(r13.noPermBlocked.toast || ''), r13.noPermBlocked.toast);

  /* ==========================================================
     [14] กราฟโดนัท + หัวข้อสำหรับแคปส่งทีม (v2.15.0)
     ========================================================== */
  console.log('\n[14] โดนัทบนหน้าสรุป — ตัวเลขต้องตรงกับหน้าเอกสาร');
  const r14 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    await ensureCycleData();
    state.page = 'summary';
    renderSummary();
    const fig = donutFigures(state.cycleData.data);
    const texts = Array.prototype.map.call(
      document.querySelectorAll('#sumDonut text'), function (t) { return t.textContent; });
    return {
      blocks: document.querySelectorAll('#sumDonut .donut-block').length,
      docBlocks: document.querySelectorAll('#donutGroups .donut-block').length,
      texts: texts,
      fig: fig,
      /* ข้อความที่ "ควรจะเป็น" ต้องมาจาก fmtPercent ตัวจริงของแอป ไม่ใช่ประกอบเองในเทส
         ไม่งั้นทุกครั้งที่รูปแบบ % เปลี่ยน (v2.24.0 เป็น 2 ตำแหน่ง) ข้อนี้จะตกทั้งที่จอถูก
         หน้าที่ของข้อนี้คือ "จอตรงกับเอกสาร" ไม่ใช่ "% มีกี่ตำแหน่ง" */
      figFmt: fig.map(function (f) {
        return { pieces: fmtPercent(f.pieces), sku: fmtPercent(f.sku) };
      }),
      branch: $('sumBranchLine').textContent,
      date: $('sumAuditDate').textContent,
      title: document.querySelector('#sumShareHead .tbl-title').textContent
    };
  });
  check('วาดโดนัทลงกล่องของหน้าสรุป', r14.blocks > 0, r14.blocks);
  check('⭐ วาดครบทุกกลุ่มเท่าที่หน้าเอกสารวาด (สองกล่องอยู่แยกกันได้)',
        r14.blocks === r14.docBlocks, { sumDonut: r14.blocks, docGroups: r14.docBlocks });
  check('⭐ ตัวเลขบนโดนัทตรงกับ donutFigures() ที่หน้าเอกสารใช้',
        r14.figFmt.every(function (f) {
          return r14.texts.indexOf(f.pieces) >= 0 && r14.texts.indexOf(f.sku) >= 0;
        }), { texts: r14.texts, figFmt: r14.figFmt });
  check('มีกราฟทั้ง Product และ Not Product',
        r14.fig.map(function (f) { return f.key; }).join(',') === 'product,notProduct',
        r14.fig.map(function (f) { return f.key; }));
  check('โชว์ชื่อสาขา', /^สาขา: .+/.test(r14.branch) && !/undefined/.test(r14.branch), r14.branch);
  check('โชว์วันที่ Audit', /^วันที่ Audit: .+/.test(r14.date) && !/undefined|NaN/.test(r14.date), r14.date);
  check('มีหัวข้อภาษาอังกฤษไว้แคปส่ง', r14.title === 'Stock Counting Accuracy', r14.title);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  /* ของเดิมพิมพ์ทิ้งไว้เฉย ๆ ไม่ได้ assert — error ใน renderOverview จึงเงียบมาตั้งแต่ ส.ค. 69
     จนข้อ [11] ไปสะกิดเจอ (แถวที่หลุดจาก DOM แล้วถูก insertBefore ซ้ำ)
     ต่อจากนี้ error ในคอนโซลต้องทำให้เทสตกทันที ไม่ใช่แค่โผล่มาให้เลื่อนผ่าน */
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
