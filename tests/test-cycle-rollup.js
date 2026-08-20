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

    /* db.get ปลอม — คืน scans ของแต่ละ Job ให้ loadCycleRaw ตามของจริง
       นับจำนวนครั้งที่อ่านไว้ด้วย ใช้พิสูจน์ว่ารอบ Job เดียวไม่แตะเน็ตเลย */
    window.db.get = function (path) {
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
  console.log('\n[6] ปุ่มเอาออกในป๊อปอัป — เขียนลงใบที่เปิดอยู่ใบเดียว');
  const r6 = await page.evaluate(async () => {
    window.__seed(['R-STOCK-01', 'R-STOCK-02', 'R-SHOW-01'], 'R-STOCK-01');
    await ensureCycleData();
    renderSummary();
    /* ห้าม await — openSumCard คืน promise ที่ resolve ตอน "ปิดกล่อง" ไม่ใช่ตอนวาดเสร็จ
       await แล้วจะค้างรอตลอดกาลเพราะไม่มีใครมากดปิด */
    openSumCard('match');

    /* P1: ทั้งรอบ 1,300 แต่ใบที่เปิดอยู่ยิงไว้ 1,000 — ปุ่มต้องบอก 1,000 ไม่ใช่ 1,300 */
    const row = document.querySelector('[data-sumcard-rows="match"] [data-sku="P1"]');
    const btnAll = row.querySelector('[data-removeall]');
    const note = row.querySelector('[data-jobact]');

    /* TF1 ใบนี้ไม่ได้ยิงเลย — ต้องไม่มีปุ่มให้กด */
    const tfRow = document.querySelector('[data-sumcard-rows="match"] [data-sku="TF1"]');
    const tfBtn = tfRow ? tfRow.querySelector('[data-removeover]') : null;

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
  check('แต่ปุ่มเอาออกทั้งหมดบอก 1,000 (เท่าที่ใบนี้ยิงไว้)',
        /1,000/.test(r6.btnLabel || '') && !/1,300/.test(r6.btnLabel || ''), r6.btnLabel);
  check('มีบรรทัดบอกว่ายอดที่เห็นเป็นยอดรวม ใบนี้ยิงไว้เท่าไหร่',
        /รวมทุก Job/.test(r6.noteText || '') && /1,000/.test(r6.noteText || ''), r6.noteText);
  check('SKU ที่ใบนี้ไม่ได้ยิง ไม่มีปุ่มให้กด', r6.tfHasBtn === false, r6.tfHasBtn);
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

  /* ---------- 9. ส่วนต่างจากบาร์โค้ดผี ต้องบอก ไม่ใช่กลบ ---------- */
  console.log('\n[9] มีบาร์โค้ดผี — ต้องบอกส่วนต่าง ไม่ใช่บังคับให้เท่ากัน');
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
  check('ยอดผู้นับรวมผีด้วย จึงเป็น 1,197', /รวม 1,197 ชิ้น/.test(r9.line), r9.line);
  check('บอกส่วนต่างตรง ๆ ว่าต่างกัน 2 ชิ้น เพราะบาร์โค้ดที่ไม่นับเป็นสินค้าจริง',
        /ยอดจริงในตาราง 1,199 ชิ้น/.test(r9.line) &&
        /ต่างกัน 2 ชิ้น/.test(r9.line) &&
        /บาร์โค้ดที่ไม่นับเป็นสินค้าจริง/.test(r9.line), r9.line);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
