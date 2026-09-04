/* ============================================================
   v2.9.0 — ตารางสิทธิ์ครบทั้ง 4 role
   ============================================================

   ตารางเป้าหมาย (ต้องตรงกับ CLAUDE.md และหน้าจอจริง):

   ความสามารถ                | admin | counter | scanner | viewer
   ยิงบาร์โค้ด                |  ✓   |   ✓    |   ✓    |  ✗
   สร้าง / ปิด Job            |  ✓   |   ✓    |   ✗    |  ✗
   ออกเอกสาร (ดู + พิมพ์)     |  ✓   |   ✓    |   ✗    |  ✓
   ค้นหาสินค้า + Location      |  ✓   | ✓ ดูอย่างเดียว | ✗ | ✗
   แก้ไข Master / Location    |  ✓   |   ✗    |   ✗    |  ✗
   พิมพ์ Remark (ตอนยิง)      |  ✓   |   ✓    |   ✓    |  ✗
   เห็นรายการ Job            |  ✓   |   ✓    |   ✓    |  ✓
   เข้าหน้า start / summary   |  ✓   |   ✓    |   ✗    |  ✗

   เทสนี้คุมทั้งสองชั้นตามกฎบ้าน (defense-in-depth):
     ชั้นจอ   — ปุ่ม/ช่องถูกซ่อนหรือ disable
     ชั้นโค้ด — เรียกฟังก์ชันตรง ๆ (เหมือนคนแก้ DOM หรือพิมพ์ใน Console) ต้องไม่ผ่าน
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const ROLES = ['admin', 'counter', 'scanner', 'viewer'];

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
    window.__toasts = []; window.__writes = []; window.__updates = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function (path, patch) {
      window.__updates.push({ path: path, patch: patch });
      return Promise.resolve();
    };
    hideLogin();

    window.__seed = function (role) {
      state.me = { uid: 'u1', email: 'x@y.z', name: 'สมชาย', role: role, branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job'; state.itemTab = 'items';
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 },
        B2: { code: 'B2', name: 'สินค้า B', category: 'ห', type: 'product', costPrice: 20 }
      };
      state.systemQty = { A1: 10, B2: 5 };
      state.counts = { A1: 3, B2: 5 };
      state.scanQty = { A1: 3, B2: 5 }; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: { A1: { sku: 'A1', name: 'สินค้า A', pick: 'P-01', refill: '' } },
                          online: {} };
      state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.reasons = {}; state.remarkTs = {}; state.activeKey = null;
      state.cycleData = null; state.docScope = 'job'; state.docScopeTouched = true;
      state.company = { name: 'บ.ทดสอบ', address: 'ที่อยู่' };
      if (typeof buildScanIndex === 'function') buildScanIndex();
      window.__toasts = []; window.__writes = []; window.__updates = [];
      refreshNav();
    };
  });

  /* ---------- 1. เข้าหน้าไหนได้บ้าง ---------- */
  console.log('\n[1] สิทธิ์เข้าหน้า — canSeePage() ทั้ง 6 หน้า');
  const r1 = await page.evaluate((roles) => {
    const out = {};
    roles.forEach(function (role) {
      window.__seed(role);
      out[role] = {};
      ['jobs', 'start', 'scan', 'master', 'summary', 'doc'].forEach(function (p) {
        out[role][p] = canSeePage(p);
      });
    });
    return out;
  }, ROLES);

  const WANT = {
    admin:   { jobs: true, start: true,  scan: true,  master: true,  summary: true,  doc: true },
    counter: { jobs: true, start: true,  scan: true,  master: true,  summary: true,  doc: true },
    scanner: { jobs: true, start: false, scan: true,  master: false, summary: false, doc: false },
    viewer:  { jobs: true, start: false, scan: false, master: false, summary: false, doc: true }
  };
  ROLES.forEach(function (role) {
    check(role + ': เข้าหน้าได้ตรงตามตารางสิทธิ์',
          JSON.stringify(r1[role]) === JSON.stringify(WANT[role]),
          { got: r1[role], want: WANT[role] });
  });

  /* ---------- 2. ปุ่มบนแถบนำทางต้องตรงกับสิทธิ์จริง ---------- */
  console.log('\n[2] ปุ่มนำทาง — ซ่อนหน้าที่เข้าไม่ได้');
  const r2 = await page.evaluate((roles) => {
    const out = {};
    roles.forEach(function (role) {
      window.__seed(role);
      applyNavVisibility();
      out[role] = {};
      [['Jobs', 'jobs'], ['Start', 'start'], ['Scan', 'scan'],
       ['Master', 'master'], ['Summary', 'summary'], ['Doc', 'doc']].forEach(function (p) {
        const el = document.getElementById('nav' + p[0]);
        out[role][p[1]] = !!el && el.style.display !== 'none';
      });
    });
    return out;
  }, ROLES);
  ROLES.forEach(function (role) {
    check(role + ': ปุ่มนำทางโชว์ตรงกับ canSeePage',
          JSON.stringify(r2[role]) === JSON.stringify(WANT[role]),
          { nav: r2[role], want: WANT[role] });
  });

  /* ---------- 3. เรียก showPage() ตรง ๆ ต้องเด้งไปหน้าที่มีสิทธิ์เสมอ ----------
     ข้อนี้สำคัญกว่าที่เห็น: ก่อน v2.9.0 ตัวสำรองเป็น 'summary' ตายตัว
     พอ viewer เข้า summary ไม่ได้แล้ว มันจะเด้งเข้าหน้าที่ไม่มีสิทธิ์ซ้ำอีกรอบ */
  console.log('\n[3] เรียก showPage() ตรง ๆ — ห้ามหลุดเข้าหน้าที่ไม่มีสิทธิ์');
  const r3 = await page.evaluate((roles) => {
    const out = {};
    roles.forEach(function (role) {
      window.__seed(role);
      out[role] = {};
      ['jobs', 'start', 'scan', 'master', 'summary', 'doc'].forEach(function (p) {
        showPage(p);
        out[role][p] = { landed: state.page, allowed: canSeePage(state.page) };
      });
    });
    return out;
  }, ROLES);
  ROLES.forEach(function (role) {
    const pages = Object.keys(r3[role]);
    const bad = pages.filter(function (p) { return !r3[role][p].allowed; });
    check(role + ': ทุกครั้งที่เด้ง ลงบนหน้าที่มีสิทธิ์เสมอ', bad.length === 0,
          bad.map(function (p) { return p + '->' + r3[role][p].landed; }));
    /* หน้าที่มีสิทธิ์ต้องเข้าได้จริง ไม่ใช่ถูกเด้งทิ้งไปเฉย ๆ */
    const wanted = pages.filter(function (p) { return WANT[role][p]; });
    const stuck = wanted.filter(function (p) { return r3[role][p].landed !== p; });
    check(role + ': หน้าที่มีสิทธิ์เข้าได้จริงทุกหน้า', stuck.length === 0, stuck);
  });

  /* ---------- 4. แก้ Master ได้เฉพาะ admin ---------- */
  console.log('\n[4] Master — admin แก้ได้ · counter ดูได้อย่างเดียว');
  const r4 = await page.evaluate(async (roles) => {
    const out = {};
    for (const role of roles) {
      window.__seed(role);
      const before = window.__updates.length;
      await saveProductEdit('A1', 'costPrice', 999);
      out[role] = {
        wrote: window.__updates.length > before,
        toast: (window.__toasts[window.__toasts.length - 1] || {}).m || ''
      };
    }
    return out;
  }, ROLES);
  check('admin แก้ราคาใน Master ได้', r4.admin.wrote === true, r4.admin);
  ['counter', 'scanner', 'viewer'].forEach(function (role) {
    check(role + ' แก้ Master ไม่ได้ + บอกเหตุผล',
          r4[role].wrote === false && /สิทธิ์/.test(r4[role].toast), r4[role]);
  });

  /* counter ต้องยัง "เข้าดู + ค้นหา" Master ได้ ห้ามตัดการเข้าหน้าไปด้วย */
  const r4b = await page.evaluate(() => {
    window.__seed('counter');
    showPage('master');
    renderMaster();
    return { page: state.page,
             rows: document.querySelectorAll('#masterList [data-mrow], #masterList .mcard').length,
             canSee: canSeePage('master') };
  });
  check('counter ยังเข้าหน้า Master เพื่อค้นหาได้', r4b.canSee === true && r4b.page === 'master', r4b);

  /* ---------- 5. แก้ Location ได้เฉพาะ admin ---------- */
  console.log('\n[5] Location — admin แก้ได้ · ที่เหลือไม่ได้');
  const r5 = await page.evaluate(async (roles) => {
    const out = {};
    for (const role of roles) {
      window.__seed(role);
      const before = window.__updates.length;
      await saveLocationEdit('A1', 'A1', 'สินค้า A', 'P-99', '');
      out[role] = {
        wrote: window.__updates.length > before,
        toast: (window.__toasts[window.__toasts.length - 1] || {}).m || ''
      };
    }
    return out;
  }, ROLES);
  check('admin แก้ Location ได้', r5.admin.wrote === true, r5.admin);
  ['counter', 'scanner', 'viewer'].forEach(function (role) {
    check(role + ' แก้ Location ไม่ได้ + บอกเหตุผล',
          r5[role].wrote === false && /สิทธิ์/.test(r5[role].toast), r5[role]);
  });

  /* ---------- 6. Remark ตอนยิง — scanner ได้ · viewer ไม่ได้ ---------- */
  console.log('\n[6] Remark ตอนยิง — admin/counter/scanner ได้ · viewer ไม่ได้');
  const r6 = await page.evaluate(async (roles) => {
    const out = {};
    for (const role of roles) {
      window.__seed(role);
      showScanHit('A1');
      const shown = document.getElementById('scanRemark').style.display !== 'none';
      const ok = await saveRemark('A1', 'หมายเหตุจาก ' + role);
      out[role] = { shown: shown, ok: ok, reason: state.reasons.A1 };
    }
    return out;
  }, ROLES);
  ['admin', 'counter', 'scanner'].forEach(function (role) {
    check(role + ' เห็นช่อง Remark และเขียนได้จริง',
          r6[role].shown === true && r6[role].ok === true &&
          r6[role].reason === 'หมายเหตุจาก ' + role, r6[role]);
  });
  check('viewer ไม่เห็นช่อง Remark และเขียนไม่ได้',
        r6.viewer.shown === false && r6.viewer.ok === false &&
        r6.viewer.reason === undefined, r6.viewer);

  /* ---------- 7. viewer เข้าเอกสารได้ แต่แก้อะไรไม่ได้ ---------- */
  console.log('\n[7] viewer — ดูเอกสารได้ แต่แก้หมายเหตุไม่ได้');
  const r7 = await page.evaluate(async () => {
    window.__seed('viewer');
    showPage('doc');
    const landed = state.page;
    const navDisabled = document.getElementById('navDoc').disabled;
    /* ช่องหมายเหตุในเอกสารต้องอ่านอย่างเดียว ไม่ใช่ปล่อยให้พิมพ์แล้วค่อยเด้ง */
    const inputs = document.querySelectorAll('#docItemTables input[data-reason]');
    const allReadOnly = inputs.length > 0 &&
      Array.prototype.every.call(inputs, function (i) { return i.readOnly; });
    const before = window.__updates.length;
    await saveReason('A1', 'viewer แอบแก้');
    return {
      landed: landed, navDisabled: navDisabled,
      inputCount: inputs.length, allReadOnly: allReadOnly,
      wrote: window.__updates.length > before,
      reason: state.reasons.A1,
      toast: (window.__toasts[window.__toasts.length - 1] || {}).m || ''
    };
  });
  check('viewer เข้าหน้าเอกสารได้จริง', r7.landed === 'doc', r7);
  check('ปุ่มเอกสารกดได้ (ไม่ disable)', r7.navDisabled === false, r7);
  check('ช่องหมายเหตุในเอกสารเป็นอ่านอย่างเดียว',
        r7.inputCount > 0 && r7.allReadOnly === true, r7);
  check('viewer เรียก saveReason ตรง ๆ ก็เขียนไม่ได้',
        r7.wrote === false && r7.reason === undefined, r7);

  /* ---------- 8. สร้าง / ปิด Job — scanner กับ viewer ทำไม่ได้ ---------- */
  console.log('\n[8] จัดการ Job — admin/counter เท่านั้น');
  const r8 = await page.evaluate((roles) => {
    const out = {};
    roles.forEach(function (role) {
      window.__seed(role);
      renderJobs();
      const acts = jobActions().map(function (a) { return a.id; });
      out[role] = {
        canCreate: !!document.getElementById('btnAddRound') &&
                   document.getElementById('btnAddRound').style.display !== 'none',
        hasClose: acts.indexOf('close') >= 0,
        hasReview: acts.indexOf('review') >= 0
      };
    });
    return out;
  }, ROLES);
  ['admin', 'counter'].forEach(function (role) {
    check(role + ' ปิด/ส่งตรวจ Job ได้', r8[role].hasClose && r8[role].hasReview, r8[role]);
  });
  ['scanner', 'viewer'].forEach(function (role) {
    check(role + ' ไม่มีปุ่มปิด/ส่งตรวจ Job',
          !r8[role].hasClose && !r8[role].hasReview, r8[role]);
  });

  /* ---------- 9. ยิงบาร์โค้ด — viewer เท่านั้นที่ทำไม่ได้ ---------- */
  console.log('\n[9] ยิงบาร์โค้ด — viewer ทำไม่ได้');
  const r9 = await page.evaluate((roles) => {
    const out = {};
    roles.forEach(function (role) {
      window.__seed(role);
      out[role] = { canScanRole: canScanRole(), canScan: canScan() };
    });
    return out;
  }, ROLES);
  ['admin', 'counter', 'scanner'].forEach(function (role) {
    check(role + ' ยิงบาร์โค้ดได้', r9[role].canScanRole === true && r9[role].canScan === true, r9[role]);
  });
  check('viewer ยิงบาร์โค้ดไม่ได้',
        r9.viewer.canScanRole === false && r9.viewer.canScan === false, r9.viewer);

  console.log('\n--- console/page errors ---');
  console.log(errors.length ? errors.join('\n') : '(none)');

  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
