/* ============================================================
   v2.7.5 — หมายเหตุต้องรวมทุก Job ในรอบ (ปิดช่องโหว่ที่เหลือจาก v2.7.4)
   ============================================================

   v2.7.4 ใส่หมายเหตุต่อ SKU ได้จากหน้ายิง เก็บที่ rounds/{id}/reasons ของใบนั้น
   แต่เอกสารโหมด "รวมทุก Job" อ่าน state.reasons ซึ่งเป็นของใบที่เปิดอยู่ใบเดียว
   หมายเหตุที่คนอื่นเขียนไว้ที่ใบอื่นจึงหายเงียบ ๆ จากเอกสารและไฟล์ Excel

   สองฝั่งที่ต้องแก้:
   - อ่าน : รวมหมายเหตุทุกใบ · SKU เดียวมีหลายใบเขียน = ติดรหัส Job นำหน้า ห้ามทิ้งข้อมูล
   - เขียน: ช่องในเอกสารโชว์ข้อความรวม ถ้าปล่อยให้พิมพ์ทับ saveReason จะเอาทั้งก้อน
            (รวมของใบอื่น) ยัดลงใบที่เปิดอยู่ → หมายเหตุใบอื่นถูกก๊อปมาซ้ำ
            แก้ได้เฉพาะของใบตัวเองเท่านั้น
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
    window.__toasts = []; window.__writes = []; window.__updates = []; window.__reads = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    /* เขียนจริงลงชุดทดสอบด้วย — จะได้เทสวงจรครบ เขียนแล้วโหลดใหม่ต้องเห็นของที่เพิ่งเขียน */
    window.db.update = function (path, patch) {
      window.__updates.push({ path: path, patch: patch });
      const m = /^rounds\/([^/]+)$/.exec(path);
      if (m && window.__JOBS[m[1]]) {
        Object.keys(patch).forEach(function (k) {
          const rk = /^reasons\/(.+)$/.exec(k);
          if (!rk) return;
          const store = window.__JOBS[m[1]].reasons;
          if (patch[k] === null) delete store[rk[1]];
          else store[rk[1]] = patch[k];
        });
      }
      return Promise.resolve();
    };
    window.db.newKey = (function () { let n = 0; return function () { return 'gen' + (++n); }; })();
    window.__realRenderDoc = window.renderDoc;
    window.renderDoc = function () {};
    hideLogin();

    /* รอบเดียวมี 2 Job · A1 ถูกเขียนหมายเหตุทั้งสองใบ · B2 เขียนเฉพาะใบที่ไม่ได้เปิด */
    /* db.update ปลอมเขียนลง __JOBS จริง ทุกข้อจึงต้องเริ่มจากชุดสะอาด
       ไม่งั้นข้อก่อนหน้าไปแก้ fixture ของข้อถัดไป แล้วผลเทสจะขึ้นกับลำดับการรัน */
    window.__JOBS_TEMPLATE = {
      'R-STOCK': { scans: { s1: { code: 'A1', delta: 4, mode: 'scan', user: 'ก', ts: 11 } },
                   reasons: { A1: 'ของชำรุด 2 ชิ้น' } },
      'R-SHOW':  { scans: { s2: { code: 'A1', delta: 2, mode: 'scan', user: 'ข', ts: 12 },
                            s3: { code: 'B2', delta: 5, mode: 'scan', user: 'ข', ts: 13 } },
                   reasons: { A1: 'เจอหลังชั้น', B2: 'กล่องเปียก' } }
    };
    window.__JOBS = JSON.parse(JSON.stringify(window.__JOBS_TEMPLATE));
    window.__SYS = { A1: 6, B2: 5 };

    window.db.get = function (path) {
      window.__reads.push(path);
      let m = /^rounds\/([^/]+)\/scans$/.exec(path);
      if (m) return Promise.resolve((window.__JOBS[m[1]] || {}).scans || {});
      m = /^rounds\/([^/]+)\/reasons$/.exec(path);
      if (m) return Promise.resolve((window.__JOBS[m[1]] || {}).reasons || {});
      if (/systemQty$/.test(path)) return Promise.resolve(window.__SYS);
      return Promise.resolve(null);
    };

    window.__seed = function (role, openId) {
      window.__JOBS = JSON.parse(JSON.stringify(window.__JOBS_TEMPLATE));
      state.me = { uid: 'u1', name: 'สมชาย', role: role || 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.roundId = openId || 'R-STOCK'; state.cycleId = 'CYC1';
      state.roundIndex = {
        'R-STOCK': { id: 'R-STOCK', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'STOCK-01',
                     cycleId: 'CYC1', status: 'counting', createdAt: 1 },
        'R-SHOW':  { id: 'R-SHOW', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'SHOW-01',
                     cycleId: 'CYC1', status: 'counting', createdAt: 2 }
      };
      state.priceField = 'costPrice'; state.summaryTab = 'job'; state.page = 'doc';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 },
        B2: { code: 'B2', name: 'สินค้า B', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 6, B2: 5 };
      const mine = window.__JOBS[state.roundId] || {};
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      Object.keys(mine.scans || {}).forEach(function (sid) {
        const r = mine.scans[sid];
        const k = safeKey(r.code);
        state.counts[k] = (state.counts[k] || 0) + r.delta;
        state.scanQty[k] = state.counts[k];
      });
      /* state.reasons = ของใบที่เปิดอยู่เท่านั้น ตรงตามที่ refreshDocMeta โหลดจริง */
      state.reasons = JSON.parse(JSON.stringify(mine.reasons || {}));
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.remarkTs = {}; state.activeKey = null;
      state.cycleData = null; state.company = { name: 'บ.ทดสอบ', address: 'ที่อยู่' };
      state.docScope = 'cycle'; state.docScopeTouched = true; state.itemTab = 'items';
      buildScanIndex();
      window.__toasts = []; window.__writes = []; window.__updates = []; window.__reads = [];
    };

    window.__docReason = function (code) {
      const row = document.querySelector('#docItemTables [data-code="' + code + '"]');
      if (!row) return null;
      const input = row.querySelector('[data-reason]');
      return { value: input.value, readOnly: input.readOnly, title: input.title,
               printed: row.querySelector('[data-reason-print]').textContent };
    };
  });

  /* ---------- 1. อ่าน — รวมทุกใบ ---------- */
  console.log('\n[1] เอกสารโหมดรวม ต้องเห็นหมายเหตุของทุกใบ');
  const r1 = await page.evaluate(async () => {
    window.__seed('admin', 'R-STOCK');
    const beforeA1 = state.reasons.A1;
    const beforeB2 = state.reasons.B2;
    await ensureCycleData();
    return {
      beforeA1: beforeA1, beforeB2: beforeB2,
      a1: remarkTextOf('A1'), b2: remarkTextOf('B2'),
      partsA1: (state.cycleData.raw.remarkParts.A1 || []).map(function (p) {
        return p.jobCode + '=' + p.text;
      }).sort(),
      reads: window.__reads.filter(function (p) { return /\/reasons$/.test(p); }).length
    };
  });
  check('ก่อนรวม เห็นแค่ของใบที่เปิดอยู่ (B2 ไม่มีเลย)',
        r1.beforeA1 === 'ของชำรุด 2 ชิ้น' && r1.beforeB2 === undefined, r1);
  check('อ่านหมายเหตุครบทั้ง 2 ใบ', r1.reads === 2, r1.reads);
  check('A1 เขียนไว้ทั้ง 2 ใบ → ติดรหัส Job นำหน้า ไม่ทิ้งข้อมูล',
        r1.a1 === 'STOCK-01: ของชำรุด 2 ชิ้น · SHOW-01: เจอหลังชั้น', r1.a1);
  check('เก็บแยกรายใบไว้ครบ',
        JSON.stringify(r1.partsA1) ===
        JSON.stringify(['SHOW-01=เจอหลังชั้น', 'STOCK-01=ของชำรุด 2 ชิ้น']), r1.partsA1);
  check('B2 เขียนไว้ใบเดียว → โชว์ข้อความเปล่า ไม่ต้องมีรหัส Job',
        r1.b2 === 'กล่องเปียก', r1.b2);

  /* ---------- 2. โผล่ในเอกสารและ Excel ---------- */
  console.log('\n[2] ต้องไปโผล่จริงในเอกสารและไฟล์ Excel');
  const r2 = await page.evaluate(async () => {
    window.__seed('admin', 'R-STOCK');
    await ensureCycleData();
    window.__realRenderDoc();
    const doc = { a1: window.__docReason('A1'), b2: window.__docReason('B2') };

    const realBuild = window.buildXlsx;
    let sheets = null;
    window.buildXlsx = function (s) { sheets = s; return realBuild(s); };
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function () { return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () {};
    await exportExcel();
    const items = sheets.filter(function (s) { return s.name === 'รายสินค้า'; })[0];
    window.buildXlsx = realBuild;
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;

    const rowA1 = items.rows.filter(function (r) { return r[0] === 'A1'; })[0];
    const rowB2 = items.rows.filter(function (r) { return r[0] === 'B2'; })[0];
    return { doc: doc, xlA1: rowA1[rowA1.length - 1], xlB2: rowB2[rowB2.length - 1] };
  });
  check('เอกสารโชว์หมายเหตุรวมของ A1',
        r2.doc.a1.value === 'STOCK-01: ของชำรุด 2 ชิ้น · SHOW-01: เจอหลังชั้น' &&
        r2.doc.a1.printed === r2.doc.a1.value, r2.doc.a1);
  check('เอกสารโชว์หมายเหตุของ B2 ที่เขียนไว้ที่ใบอื่น (เดิมหายไปเลย)',
        r2.doc.b2.value === 'กล่องเปียก', r2.doc.b2);
  check('Excel ได้หมายเหตุรวมเหมือนกัน',
        r2.xlA1 === 'STOCK-01: ของชำรุด 2 ชิ้น · SHOW-01: เจอหลังชั้น' &&
        r2.xlB2 === 'กล่องเปียก', r2);

  /* ---------- 3. เขียน — แก้ได้เฉพาะของใบตัวเอง ---------- */
  console.log('\n[3] กับดักฝั่งเขียน — ห้ามเอาข้อความรวมยัดลงใบเดียว');
  const r3 = await page.evaluate(async () => {
    window.__seed('admin', 'R-STOCK');
    await ensureCycleData();
    window.__realRenderDoc();
    const a1 = window.__docReason('A1');       // เขียนไว้ 2 ใบ → ห้ามแก้
    const b2 = window.__docReason('B2');       // เขียนไว้ที่ใบอื่นใบเดียว → ห้ามแก้

    /* ฝืนเรียก saveReason ตรง ๆ ด้วยข้อความรวม */
    window.__updates = []; window.__toasts = [];
    await saveReason('A1', 'STOCK-01: ของชำรุด 2 ชิ้น · SHOW-01: เจอหลังชั้น');
    const blocked = { updates: window.__updates.length,
                      toast: (window.__toasts[0] || {}).m,
                      stillMerged: remarkTextOf('A1') };
    return { a1: a1, b2: b2, blocked: blocked };
  });
  check('A1 (เขียน 2 ใบ) ช่องถูกล็อกแก้ไม่ได้', r3.a1.readOnly === true, r3.a1);
  check('บอกเหตุผลว่าให้ไปเปิด Job นั้น', /Job อื่น/.test(r3.a1.title || ''), r3.a1.title);
  check('B2 (เขียนที่ใบอื่น) ก็ถูกล็อกเหมือนกัน', r3.b2.readOnly === true, r3.b2);
  check('เรียก saveReason ตรง ๆ ก็ไม่ผ่าน ไม่เขียนอะไร',
        r3.blocked.updates === 0 && /Job อื่น/.test(r3.blocked.toast || ''), r3.blocked);
  check('ข้อความรวมไม่ถูกก๊อปลงใบที่เปิดอยู่',
        r3.blocked.stillMerged === 'STOCK-01: ของชำรุด 2 ชิ้น · SHOW-01: เจอหลังชั้น',
        r3.blocked.stillMerged);

  /* ---------- 4. ของใบตัวเองยังแก้ได้ปกติ ---------- */
  console.log('\n[4] หมายเหตุของใบตัวเอง / ของที่ยังไม่มีใครเขียน ต้องแก้ได้');
  const r4 = await page.evaluate(async () => {
    /* เปิดใบ SHOW แล้วลบหมายเหตุ A1 ของ STOCK ออกจากชุดทดสอบ
       เหลือใบเดียวที่เขียน = ใบที่เปิดอยู่ → ต้องแก้ได้ (ล้าง fixture หลัง seed) */
    window.__seed('admin', 'R-SHOW');
    window.__JOBS['R-STOCK'].reasons = {};
    await ensureCycleData();
    window.__realRenderDoc();
    const a1 = window.__docReason('A1');

    window.__updates = []; window.__toasts = [];
    await saveReason('A1', 'แก้ใหม่จากใบตัวเอง');
    const after = { updates: window.__updates.length,
                    path: (window.__updates[0] || {}).path,
                    patch: (window.__updates[0] || {}).patch,
                    merged: remarkTextOf('A1') };

    /* SKU ที่ยังไม่มีใครเขียนเลย ต้องเขียนใหม่ได้ */
    window.__seed('admin', 'R-STOCK');
    await ensureCycleData();
    delete state.cycleData.raw.remarkParts.B2;      // จำลองว่าไม่มีใครเขียน B2
    const fresh = remarkEditableHere('B2');
    return { a1: a1, after: after, fresh: fresh };
  });
  check('หมายเหตุของใบตัวเองแก้ได้ ไม่ถูกล็อก', r4.a1.readOnly === false, r4.a1);
  check('เขียนลง reasons ของใบที่เปิดอยู่',
        r4.after.updates === 1 && r4.after.path === 'rounds/R-SHOW' &&
        r4.after.patch['reasons/A1'] === 'แก้ใหม่จากใบตัวเอง', r4.after);
  check('ก้อนรวมอัปเดตตามทันที ไม่ต้องโหลดทั้งรอบใหม่',
        r4.after.merged === 'แก้ใหม่จากใบตัวเอง', r4.after.merged);
  check('SKU ที่ยังไม่มีใครเขียน เขียนใหม่ได้', r4.fresh === true, r4.fresh);

  /* ---------- 5. หน้ายิงยังผูกกับใบตัวเองเสมอ ---------- */
  console.log('\n[5] ช่องบนหน้ายิงต้องเป็นของใบตัวเอง ไม่ใช่ข้อความรวม');
  const r5 = await page.evaluate(async () => {
    window.__seed('counter', 'R-STOCK');
    await ensureCycleData();                  // โหมดรวมพร้อมใช้อยู่
    state.page = 'scan';
    showScanHit('A1');
    const box = { value: $('scanRemarkInput').value, merged: remarkTextOf('A1') };

    window.__writes = []; window.__updates = [];
    await saveRemark('A1', 'ของใบ STOCK ล้วน');
    /* writeScan ล้างแคชยอดรวมทิ้งทุกครั้งที่มีแถวใหม่ (เหมือนการยิงปกติ)
       เอกสารจะโหลดรอบใหม่เองตอน renderDoc — ตรงนี้จำลองรอบนั้น */
    const staleCache = state.cycleData === null;
    await ensureCycleData();
    return { box: box, own: state.reasons.A1,
             path: (window.__updates[0] || {}).path,
             patch: (window.__updates[0] || {}).patch,
             staleCache: staleCache,
             merged: remarkTextOf('A1') };
  });
  check('ช่องหน้ายิงโชว์เฉพาะของใบตัวเอง ไม่ใช่ข้อความรวม',
        r5.box.value === 'ของชำรุด 2 ชิ้น' &&
        r5.box.merged === 'STOCK-01: ของชำรุด 2 ชิ้น · SHOW-01: เจอหลังชั้น', r5.box);
  check('บันทึกลงใบตัวเอง ไม่แตะใบอื่น',
        r5.path === 'rounds/R-STOCK' && r5.patch['reasons/A1'] === 'ของใบ STOCK ล้วน' &&
        r5.own === 'ของใบ STOCK ล้วน', r5);
  check('เขียนจากหน้ายิงแล้วแคชยอดรวมถูกล้าง (เอกสารจะโหลดใหม่เอง)',
        r5.staleCache === true, r5.staleCache);
  check('โหลดใหม่แล้วได้ข้อความรวมที่ถูกต้อง ของใบอื่นยังอยู่ครบ',
        r5.merged === 'STOCK-01: ของใบ STOCK ล้วน · SHOW-01: เจอหลังชั้น', r5.merged);

  /* ---------- 6. รอบ Job เดียว ต้องเหมือนเดิมเป๊ะ ---------- */
  console.log('\n[6] รอบ Job เดียว / โหมดเฉพาะ Job — ห้ามเปลี่ยนพฤติกรรม');
  const r6 = await page.evaluate(async () => {
    window.__seed('admin', 'R-STOCK');
    state.docScope = 'job';                   // โหมดเฉพาะ Job นี้
    const jobMode = { text: remarkTextOf('A1'), editable: remarkEditableHere('A1') };

    /* รอบที่มี Job เดียวจริง ๆ */
    delete state.roundIndex['R-SHOW'];
    state.docScope = 'cycle'; state.cycleData = null;
    window.__realRenderDoc();
    const solo = { text: remarkTextOf('A1'), editable: remarkEditableHere('A1') };

    window.__updates = [];
    await saveReason('A1', 'แก้ได้ตามปกติ');
    return { jobMode: jobMode, solo: solo,
             wrote: window.__updates.length,
             patch: (window.__updates[0] || {}).patch };
  });
  check('โหมดเฉพาะ Job อ่านจาก state.reasons เหมือนเดิม ไม่มีรหัส Job นำหน้า',
        r6.jobMode.text === 'ของชำรุด 2 ชิ้น' && r6.jobMode.editable === true, r6.jobMode);
  check('รอบที่มี Job เดียว ก็ไม่มีรหัส Job นำหน้า',
        r6.solo.text === 'ของชำรุด 2 ชิ้น' && r6.solo.editable === true, r6.solo);
  check('แก้ได้ตามปกติ ไม่โดนล็อก',
        r6.wrote === 1 && r6.patch['reasons/A1'] === 'แก้ได้ตามปกติ', r6);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
