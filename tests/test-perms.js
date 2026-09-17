/* ============================================================
   สิทธิ์แบบ "ติ๊กความสามารถ" (capability) — v2.12.0
   ============================================================

   ทำไมต้องมีเทสนี้:
   ก่อน v2.12.0 สิทธิ์เป็น role ตายตัว 4 ค่า จะให้ใครอัปโหลด Location สักคน
   ต้องตั้งเป็น admin เต็มใบ ซึ่งพ่วงลบ Job · จัดการผู้ใช้ · ล้างยอด ไปให้ทั้งชุด
   ตอนนี้สิทธิ์จริงอยู่ที่ users/<uid>/perms และ role เหลือหน้าที่เป็นแม่แบบ

   สิ่งที่ต้องคุมไม่ให้หลุด:
   [1] แม่แบบ role -> perms ตรงกับพฤติกรรมจริงก่อนหน้านี้เป๊ะ (ห้ามใครได้/เสียสิทธิ์)
   [2] ผู้ใช้เดิมที่ยังไม่มี perms ในฐาน ต้องทำงานเหมือนเดิมทุกอย่าง
   [3] custom ผสมเองได้ และแต่ละด่านเปิด/ปิดตาม cap ของตัวเอง
   [4] manageUsers เป็นของ admin เท่านั้น ติ๊กเองไม่ได้
   [5] กับระเบิด 5 ลูกของ role 'custom' (ดู CLAUDE.md / AUDIT v2.12.0)
   [6] role-sync ต้องเห็นการเปลี่ยน perms ไม่ใช่เฉพาะ role
   [7] ห้ามเพิ่มสายค้าง — ยังต้องเป็น 4 สายเท่าเดิม

   รัน: node tests/test-perms.js
   ============================================================ */

const fs = require('fs');
const { puppeteer, CHROME, APP_URL, APP_FILE } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

/* แม่แบบที่ตกลงกันไว้ — ต้องตรงกับ ROLE_PERMS ใน index.html และกับพฤติกรรมก่อน v2.12.0 */
const TEMPLATE = {
  admin: ['scan', 'seeSystemQty', 'createJob', 'closeJob', 'editMaster', 'editLocation',
          'importSysQty', 'adjustCount', 'viewSummary', 'docs', 'editDoc', 'viewMasterLoc',
          'deleteJob', 'reopenRound', 'purgeUser'],
  counter: ['scan', 'seeSystemQty', 'createJob', 'closeJob', 'importSysQty',
            'viewSummary', 'docs', 'editDoc', 'viewMasterLoc', 'adjustCount'],
  scanner: ['scan'],
  viewer: ['docs'],
  custom: []
};

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.enqueueWrite = function () { return Promise.resolve(); };
  window.__updates = [];
  window.db.update = function (p, patch) {
    window.__updates.push({ path: p, patch: patch });
    return Promise.resolve();
  };
  /* ด่านที่ทำลายของ (ล้างยอด · ปิดรอบ · แก้สิทธิ์) บังคับอ่านสิทธิ์สดก่อนลงมือ
     ต้องคืนเรคอร์ดปัจจุบันกลับไป ไม่ใช่ null — null แปลว่า "ถูกถอดออกจากทะเบียน"
     แล้วระบบจะเตะออกก่อนถึงด่านสิทธิ์ที่กำลังจะทดสอบ */
  window.__rec = null;
  window.db.getQuiet = function (p) {
    if (String(p).indexOf('users/') === 0) {
      return Promise.resolve(window.__rec ? JSON.parse(JSON.stringify(window.__rec)) : null);
    }
    return Promise.resolve(null);
  };
  window.session.token = function () { return Promise.resolve('tok'); };
  /* กล่องยืนยันรอคนกดจริง ถ้าไม่ดักไว้เทสจะค้างตรงด่านที่ผ่านสิทธิ์มาแล้ว
     ตอบ "ยกเลิก" เสมอ — เราสนใจแค่ว่าด่านสิทธิ์ทำงานก่อนถึงกล่องหรือไม่ */
  window.ask = function () { return Promise.resolve(false); };
  hideLogin();

  /* กันไม่ให้เทสรีโหลดหน้าจริงตอน forceSignOut */
  window.__signedOut = 0;
  window.session.signOut = function () { window.__signedOut++; };
  window.db.closeAll = function () {};
  var realSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms) { if (ms === 1200) return 0; return realSetTimeout(fn, ms); };

  /* seed ด้วย "เรคอร์ดในทะเบียน" แล้วให้ setMe แปลงเอง — จะได้ทดสอบเส้นทางจริง
     ไม่ใช่ยัด state.me ตรง ๆ ซึ่งข้ามตรรกะ perms/role ที่กำลังจะทดสอบไปเลย */
  window.__seedRec = function (rec) {
    window.__rec = rec;
    setMe({ uid: 'U1', email: 'a@b.c' }, rec);
    state.counter = state.me.name;
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', jobCode: 'J1', cycleId: 'C1', branch: 'B1',
                               branchCode: 'B1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = { A1: { code: 'A1', name: 'สินค้า A', type: 'product', costPrice: 10 } };
    state.systemQty = { A1: 10 };
    state.counts = { A1: 3 }; state.scanQty = { A1: 3 }; state.manualQty = {};
    state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
    state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
    state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
    state.undoStack = []; state.appliedScanIds = Object.create(null);
    state.reasons = {}; state.remarkTs = {}; state.activeKey = null;
    state.users = {}; state.cycleData = null;
    state.company = { name: 'บ.ทดสอบ', address: 'ที่อยู่' };
    state.priceField = 'costPrice'; state.summaryTab = 'job'; state.itemTab = 'items';
    state.docScope = 'job'; state.docScopeTouched = true;
    if (typeof buildScanIndex === 'function') buildScanIndex();
    roleCheckedAt = 0; roleChecking = null;
    window.__toasts = []; window.__updates = [];
    refreshNav();
  };
  /* ทางลัดสำหรับเคสที่สนใจแค่ role (ผู้ใช้เดิมที่ยังไม่มีฟิลด์ perms ในฐาน) */
  window.__seedRole = function (role) {
    window.__seedRec({ name: 'ทดสอบ', email: 'a@b.c', role: role, active: true });
  };
  window.__capsOn = function () {
    return CAPS.filter(function (c) { return hasPerm(c); });
  };
`;

(async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');

  /* ---------- [0] ตรวจจากซอร์ส — กับระเบิดที่มองไม่เห็นตอนรัน ---------- */
  console.log('\n[0] กับระเบิดของ role custom (ตรวจจากซอร์ส)');
  check('setMe รับ role custom ได้ (ไม่งั้นถูกแปลงเป็น counter เงียบ ๆ)',
        /role: \/\^\(admin\|viewer\|scanner\|custom\)\$\/\.test\(rec\.role\)/.test(src), 'setMe regex');
  check('ถอด ROLE_RANK ทิ้งแล้ว (ลำดับ role ใช้กับ custom ไม่ได้)',
        !/ROLE_RANK/.test(src), 'ROLE_RANK');
  check('applyRoleChange เทียบ perms ด้วย ไม่ใช่แค่ role',
        /permsSig\(afterPerms\) === beforeSig/.test(src), 'perms compare');
  check('handleImport มีด่านชั้นฟังก์ชันแล้ว (รูเดิม)',
        /function handleImport\(file\)[\s\S]{0,400}requirePerm\('importSysQty'/.test(src), 'handleImport');
  check('กฎสิทธิ์อยู่ที่ hasPerm ที่เดียว — ไม่มี isStaff เหลือในโค้ด',
        !/\bisStaff\(\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'isStaff');

  console.log('\n[0b] Rules ต้องรู้จัก custom + perms');
  const rules = JSON.parse(fs.readFileSync(
    require('path').join(__dirname, '..', 'stocktake-rules-v2.1.3.json'), 'utf8'));
  const RU = rules.rules.stocktake2026.users.$uid;
  check('role/.validate ยอมรับ custom', /custom/.test(RU.role['.validate']), RU.role['.validate']);
  check('perms รับเฉพาะ boolean', RU.perms.$cap['.validate'] === 'newData.isBoolean()', RU.perms);
  check('users/ ยังเป็น admin เท่านั้น ไม่เปิดให้ perms ใดเขียน',
        !/perms\//.test(RU['.write']), RU['.write'].slice(0, 80));
  check('ยังมีบล็อก wms2026 ติดไปด้วย', !!rules.rules.wms2026, 'wms2026');

  console.log('\n[0c] ห้ามเพิ่มสายค้าง — ต้องเป็น 4 สายเท่าเดิม');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
                  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const subLines = code.split('\n').filter(l => /\bdb\.subscribe(Children)?\(/.test(l));
  check('subscribe จริงมี 4 สาย', subLines.length === 4, subLines.map(l => l.trim()));
  check('ไม่มี subscribe ไปที่ users', !/\bdb\.subscribe(Children)?\(\s*'users/.test(code), 'users stream');

  /* ---------- [0d] โหนดที่แช่แข็งไว้ — ต้องไม่มีใครเขียน ----------
     สามโหนดนี้เป็นของเก่าที่เลิกใช้แล้ว แต่ Rules ยังเก็บไว้ (ข้อมูลเดิมยังอ่านได้):
       rounds/$id/zones          เลิกสร้างโซนตั้งแต่ v2.1.9 · refreshZones() อ่านอย่างเดียว
       cycles/$cid/deductTransfer, rounds/$id/deductTransfer   ถอดออกทั้งเส้นตั้งแต่ v2.1.6

     ตั้งใจ "ไม่" เติมทางเลือก perms ให้ทั้งสาม เพราะไม่มี code path ไหนเขียน
     การเติมคือการเปิดสิทธิ์เขียนให้โหนดที่ไม่มีใครใช้ = กว้างขึ้นโดยไม่ได้อะไรกลับมา

     ⚠ ถ้าวันหนึ่งมีคนรื้อฟีเจอร์พวกนี้กลับมา เทสข้อนี้จะดังทันที
        แล้วต้องไปเติม (role เดิม) || (perms/<cap>) ใน Rules ให้ตรงกับ cap ที่เขียนจริง
        ไม่งั้นผู้ใช้ role 'custom' จะโดน 401 ตอนเขียนโหนดนั้น */
  console.log('\n[0d] โหนดที่แช่แข็ง — ไม่มีใครเขียน จึงไม่ต้องมีทางเลือก perms');
  const FROZEN = ['zones', 'deductTransfer'];
  FROZEN.forEach(function (node) {
    const writes = code.split('\n').filter(function (l) {
      return new RegExp('(db\\.update|db\\.set|enqueueWrite)\\([^)]*' + node).test(l)
          || new RegExp("patch\\['" + node).test(l)
          || new RegExp("Patch\\['" + node).test(l);
    });
    check('ไม่มีโค้ดเขียน ' + node + ' (ถ้าดังแปลว่าต้องไปเติม perms ใน Rules)',
          writes.length === 0, writes.map(function (l) { return l.trim(); }));
  });
  check('refreshZones() อ่านอย่างเดียว ไม่ได้เขียน',
        /function refreshZones\(\)[\s\S]{0,300}db\.get\('rounds\/' \+ id \+ '\/zones'\)/.test(src),
        'refreshZones');

  /* คุมอีกด้าน: ต้องไม่มี .write โหนดไหน "นอกเหนือจากสี่โหนดนี้" ที่ลืมเติม perms
     เจอเมื่อไหร่แปลว่ามี path ที่ custom user เขียนไม่ได้ทั้งที่ควรได้ */
  const noPerm = [];
  (function walk(n, p) {
    if (!n || typeof n !== 'object') return;
    const w = n['.write'];
    if (typeof w === 'string' && w !== 'false' && w !== 'true' && !/perms\//.test(w)) noPerm.push(p);
    Object.keys(n).forEach(function (k) { if (k[0] !== '.') walk(n[k], p + '/' + k); });
  })(rules.rules, '');
  check('มีเฉพาะ users/$uid + สามโหนดที่แช่แข็งที่ไม่มีทางเลือก perms',
        noPerm.slice().sort().join('\n') === [
          '/stocktake2026/cycles/$cycleId/deductTransfer',
          '/stocktake2026/rounds/$roundId/deductTransfer',
          '/stocktake2026/rounds/$roundId/zones',
          '/stocktake2026/users/$uid'
        ].join('\n'), noPerm);

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

  /* ---------- [1] แม่แบบ role -> perms ---------- */
  console.log('\n[1] permsFromRole ตรงแม่แบบทุก role');
  const tpl = await page.evaluate(() => {
    const out = {};
    ['admin', 'counter', 'scanner', 'viewer', 'custom'].forEach(function (r) {
      out[r] = CAPS.filter(function (c) { return permsFromRole(r)[c] === true; });
    });
    out.__caps = CAPS.slice();
    out.__unknown = CAPS.filter(function (c) { return permsFromRole('ไม่รู้จัก')[c] === true; });
    return out;
  });
  check('มีช่องติ๊กครบ 15 ช่อง', tpl.__caps.length === 15, tpl.__caps);
  check('manageUsers ไม่อยู่ในช่องติ๊ก', tpl.__caps.indexOf('manageUsers') < 0, tpl.__caps);
  Object.keys(TEMPLATE).forEach(function (r) {
    check(r + ': แม่แบบตรงที่ตกลงไว้',
          tpl[r].slice().sort().join(',') === TEMPLATE[r].slice().sort().join(','),
          { got: tpl[r], want: TEMPLATE[r] });
  });
  check('role ที่ไม่รู้จักถือเป็น counter (ตรงกับ setMe)',
        tpl.__unknown.slice().sort().join(',') === TEMPLATE.counter.slice().sort().join(','), tpl.__unknown);

  /* ---------- [2] ผู้ใช้เดิมที่ไม่มี perms ---------- */
  console.log('\n[2] ⭐ ผู้ใช้เดิม (ไม่มีฟิลด์ perms ในฐาน) ต้องทำงานเหมือนเดิมเป๊ะ');
  const legacy = await page.evaluate((roles) => {
    const out = {};
    roles.forEach(function (r) {
      window.__seedRole(r);                       // เรคอร์ดไม่มี perms เลย
      out[r] = { caps: window.__capsOn(), hadPerms: Object.keys(state.me.perms).length };
    });
    return out;
  }, ['admin', 'counter', 'scanner', 'viewer']);
  ['admin', 'counter', 'scanner', 'viewer'].forEach(function (r) {
    check(r + ' เดิม: ได้สิทธิ์ตามแม่แบบครบ ไม่ขาดไม่เกิน',
          legacy[r].caps.slice().sort().join(',') === TEMPLATE[r].slice().sort().join(','),
          { got: legacy[r].caps, want: TEMPLATE[r] });
  });

  console.log('\n[2b] viewer ต้องเห็นเท่าเดิม — เอกสารอย่างเดียว');
  const vw = await page.evaluate(() => {
    window.__seedRole('viewer');
    const pages = {};
    ['jobs', 'start', 'scan', 'master', 'summary', 'doc'].forEach(function (p) { pages[p] = canSeePage(p); });
    return { pages: pages, edit: canEdit(), doc: canSeeDoc(), sys: hasPerm('seeSystemQty') };
  });
  check('viewer เข้าได้แค่ jobs + doc (เหมือน v2.9.0)',
        JSON.stringify(vw.pages) === JSON.stringify(
          { jobs: true, start: false, scan: false, master: false, summary: false, doc: true }), vw.pages);
  check('viewer เปิดเอกสารได้', vw.doc === true, vw);
  check('viewer แก้หมายเหตุ/ออกเลขที่ไม่ได้', vw.edit === false, vw);

  /* ---------- [3] custom ผสมเอง ---------- */
  console.log('\n[3] ⭐ custom — ติ๊กเฉพาะที่ต้องการ (เคสหลักของงานนี้)');
  const locOnly = await page.evaluate(() => {
    window.__seedRec({ name: 'ลูกน้อง', email: 'x@y.z', role: 'custom', active: true,
                       perms: { editLocation: true, viewMasterLoc: true } });
    const pages = {};
    ['jobs', 'start', 'scan', 'master', 'summary', 'doc'].forEach(function (p) { pages[p] = canSeePage(p); });
    return {
      pages: pages,
      caps: window.__capsOn(),
      loc: hasPerm('editLocation'),
      master: hasPerm('editMaster'),
      del: hasPerm('deleteJob'),
      users: hasPerm('manageUsers'),
      purge: hasPerm('purgeUser'),
      role: state.me.role
    };
  });
  check('role ยังเป็น custom หลัง setMe (ไม่ถูกแปลงเป็น counter)', locOnly.role === 'custom', locOnly);
  check('⭐ ติ๊ก editLocation แล้วเข้าหน้า Master ได้', locOnly.pages.master === true, locOnly.pages);
  check('อัปโหลด Location ได้', locOnly.loc === true, locOnly);
  check('แต่แก้ Master ไม่ได้', locOnly.master === false, locOnly);
  check('ลบ Job ไม่ได้', locOnly.del === false, locOnly);
  check('ล้างยอดผู้ใช้ไม่ได้', locOnly.purge === false, locOnly);
  check('จัดการผู้ใช้ไม่ได้', locOnly.users === false, locOnly);
  check('ยิงบาร์โค้ดไม่ได้ (ไม่ได้ติ๊ก)', locOnly.pages.scan === false, locOnly.pages);
  check('ได้สิทธิ์เท่าที่ติ๊กเท่านั้น', locOnly.caps.slice().sort().join(',') === 'editLocation,viewMasterLoc',
        locOnly.caps);

  console.log('\n[3b] ปุ่มบนจอต้องตามสิทธิ์ที่ติ๊ก (ชั้นจอ)');
  const locUi = await page.evaluate(() => {
    window.__seedRec({ name: 'ลูกน้อง', email: 'x@y.z', role: 'custom', active: true,
                       perms: { editLocation: true, viewMasterLoc: true } });
    state.masterTab = 'locations';
    renderMaster();
    const out = { loc: document.getElementById('btnImportLoc').disabled };
    state.masterTab = 'products';
    renderMaster();
    out.master = document.getElementById('btnImportMaster').disabled;
    out.tabUsers = document.getElementById('tabUsers').style.display;
    out.tabNew = document.getElementById('tabNewcodes').style.display;
    return out;
  });
  check('ปุ่มนำเข้า Location กดได้', locUi.loc === false, locUi);
  check('ปุ่มนำเข้า Master ยังล็อก', locUi.master === true, locUi);
  check('แท็บผู้ใช้ถูกซ่อน', locUi.tabUsers === 'none', locUi);
  check('แท็บบาร์โค้ดใหม่ถูกซ่อน', locUi.tabNew === 'none', locUi);

  /* ---------- [4] แต่ละด่านเปิด/ปิดตาม cap ของตัวเอง ---------- */
  console.log('\n[4] ชั้นฟังก์ชัน — เรียกตรง ๆ ต้องไม่ผ่านถ้าไม่ได้ติ๊ก');
  /* [cap ที่คุมด่านนี้, ชื่อ, โค้ดที่เรียก, โค้ดเตรียมสถานะ (ถ้าต้องมี)] */
  const CLOSED = "state.roundIndex.R1.status = 'closed';";
  const GATES = [
    ['adjustCount',  'removeOverScan',   "removeOverScan({ key: 'A1', act: 3, sys: 10 }, 'over', 1)", ''],
    ['adjustCount',  'handleScanImport', 'handleScanImport(null)', ''],
    ['adjustCount',  'discardUnknown',   "discardUnknown({ value: '999', key: '999', qty: 1 })", ''],
    ['importSysQty', 'handleImport',     'handleImport(null)', ''],
    ['editMaster',   'saveProductEdit',  "saveProductEdit('A1', 'costPrice', 5)", ''],
    ['editLocation', 'saveLocationEdit', "saveLocationEdit('A1', 'A1', 'ก', 'P-1', '')", ''],
    ['editDoc',      'saveDocNo',        "saveDocNo('ISRD-ST-B1-680001')", ''],
    ['editDoc',      'saveReason',       "saveReason('A1', 'นับซ้ำแล้ว')", ''],
    ['deleteJob',    'deleteJob',        'deleteJob()', ''],
    /* reopenRound ใช้ได้เฉพาะรอบที่ปิดแล้ว ไม่งั้นฟังก์ชันคืนก่อนถึงด่านสิทธิ์ */
    ['reopenRound',  'reopenRound',      'reopenRound()', CLOSED],
    ['viewSummary',  'openSumCard',      "openSumCard('over')", ''],
    ['createJob',    'ปุ่มสร้าง Job',      "document.getElementById('btnAddRound').onclick()", ''],
    ['closeJob',     'closeRound',       'closeRound()', ''],
    ['purgeUser',    'purgeUserScans',   "purgeUserScans('Gift')", '']
  ];
  for (const g of GATES) {
    const r = await page.evaluate(async (cap, callSrc, setupSrc) => {
      const run = async function (perms) {
        window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: perms });
        if (setupSrc) eval(setupSrc);
        window.__toasts = []; window.__updates = [];
        try { await eval(callSrc); } catch (e) { /* บางตัวคืน undefined ไม่ใช่ promise */ }
        await new Promise(function (r2) { setTimeout(r2, 40); });
        return { toasts: window.__toasts.slice(), writes: window.__updates.length };
      };
      /* ปิด cap นี้อย่างเดียว เปิดที่เหลือหมด — พิสูจน์ว่าด่านนี้ดูที่ cap ของตัวเองจริง
         ไม่ใช่บังเอิญผ่านเพราะ cap อื่นที่เกี่ยวข้องกันถูกปิดไปด้วย */
      const off = {};
      CAPS.forEach(function (c) { if (c !== cap) off[c] = true; });
      const a = await run(off);
      const on = {};
      CAPS.forEach(function (c) { on[c] = true; });
      const b = await run(on);

      const isPermMsg = function (t) {
        return t.bad && /ยังไม่ได้เปิดความสามารถนี้ให้|บัญชีนี้เป็นสิทธิ์/.test(t.m);
      };
      return {
        blockedOff: a.toasts.some(isPermMsg),
        wroteOff: a.writes,
        blockedOn: b.toasts.some(isPermMsg),
        msgOff: (a.toasts[0] || {}).m,
        msgOn: (b.toasts[0] || {}).m
      };
    }, g[0], g[2], g[3]);
    check(g[1] + ' — ไม่ติ๊ก ' + g[0] + ' แล้วถูกบล็อกพร้อมบอกเหตุผลเรื่องสิทธิ์',
          r.blockedOff === true, r);
    check(g[1] + ' — ไม่ติ๊กแล้วไม่มีการเขียนฐาน', r.wroteOff === 0, r);
    check(g[1] + ' — ติ๊กแล้วไม่โดนบล็อกเรื่องสิทธิ์', r.blockedOn === false, r);
  }

  /* ---------- [5] admin กับ manageUsers ---------- */
  console.log('\n[5] ⭐ manageUsers เป็นของ admin เท่านั้น ติ๊กเองไม่ได้');
  const mu = await page.evaluate(() => {
    /* จงใจยัด manageUsers เข้ามาในฐานตรง ๆ เหมือนคนแก้ฐานเอง */
    window.__seedRec({ name: 'แอบ', email: 'x@y.z', role: 'custom', active: true,
                       perms: { manageUsers: true, editMaster: true } });
    const forged = { can: hasPerm('manageUsers'), stored: state.me.perms.manageUsers };
    window.__seedRole('admin');
    const adm = { can: hasPerm('manageUsers'), all: CAPS.every(function (c) { return hasPerm(c); }) };
    return { forged: forged, adm: adm };
  });
  check('ยัด manageUsers เข้าฐานเองก็ไม่ได้สิทธิ์', mu.forged.can === false, mu.forged);
  check('normPerms กรอง cap นอกลิสต์ทิ้ง', mu.forged.stored === undefined, mu.forged);
  check('admin ได้ manageUsers', mu.adm.can === true, mu.adm);
  check('admin ได้ครบทุก cap เสมอ', mu.adm.all === true, mu.adm);

  const muUi = await page.evaluate(() => {
    window.__seedRec({ name: 'แอบ', email: 'x@y.z', role: 'custom', active: true,
                       perms: { manageUsers: true, viewMasterLoc: true } });
    state.masterTab = 'users';
    renderMaster();
    return { tab: document.getElementById('tabUsers').style.display, landed: state.masterTab };
  });
  check('แท็บผู้ใช้ยังซ่อนอยู่', muUi.tab === 'none', muUi);
  check('ถูกเด้งออกจากแท็บผู้ใช้', muUi.landed === 'products', muUi);

  /* ---------- [6] role-sync ต้องเห็นการเปลี่ยน perms ---------- */
  console.log('\n[6] ⭐ role-sync — เปลี่ยน perms สดจากอีกเครื่องต้องมีผลทันที');
  const sync = await page.evaluate(() => {
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true,
                       perms: { scan: true, adjustCount: true, docs: true } });
    const before = window.__capsOn();
    /* แอดมินถอนติ๊ก adjustCount ออก โดยไม่แตะ role เลย */
    const res = applyRoleChange({ name: 'ท', email: 'a@b.c', role: 'custom', active: true,
                                  perms: { scan: true, docs: true } });
    return { before: before, after: window.__capsOn(), res: res,
             toast: (window.__toasts[0] || {}).m, bad: (window.__toasts[0] || {}).bad };
  });
  check('ก่อนซิงก์มี adjustCount', sync.before.indexOf('adjustCount') >= 0, sync.before);
  check('⭐ ซิงก์แล้วรู้ว่าสิทธิ์เปลี่ยน (ไม่คืน null ทั้งที่ role เท่าเดิม)', !!sync.res, sync);
  check('adjustCount หายไปจริง', sync.after.indexOf('adjustCount') < 0, sync.after);
  check('รายงานว่าเป็นการลดสิทธิ์', sync.res && sync.res.down === true, sync.res);
  check('บอกชื่อความสามารถที่หายไปเป็นภาษาคน',
        /แก้ยอดที่นับไปแล้ว/.test(sync.toast || ''), sync.toast);
  check('เตือนด้วยโทน error', sync.bad === true, sync);

  const syncUp = await page.evaluate(() => {
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: { docs: true } });
    const res = applyRoleChange({ name: 'ท', email: 'a@b.c', role: 'custom', active: true,
                                  perms: { docs: true, viewSummary: true } });
    return { res: res, caps: window.__capsOn(), toast: (window.__toasts[0] || {}).m };
  });
  check('ติ๊กเพิ่มแล้วใช้ได้ทันที ไม่ต้องล็อกอินใหม่', syncUp.caps.indexOf('viewSummary') >= 0, syncUp);
  check('รายงานว่าไม่ใช่การลดสิทธิ์', syncUp.res && syncUp.res.down === false, syncUp.res);

  const syncSame = await page.evaluate(() => {
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: { docs: true } });
    return applyRoleChange({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: { docs: true } });
  });
  check('ไม่มีอะไรเปลี่ยนก็ต้องเงียบ (กันวาดจอซ้ำทุก 60 วิ)', syncSame === null, syncSame);

  const syncLegacy = await page.evaluate(() => {
    /* ผู้ใช้เดิม: ฐานไม่มี perms เลยทั้งก่อนและหลัง เปลี่ยนแค่ role */
    window.__seedRole('counter');
    const res = applyRoleChange({ name: 'ทดสอบ', email: 'a@b.c', role: 'scanner', active: true });
    return { res: res, caps: window.__capsOn() };
  });
  check('ผู้ใช้เดิมเปลี่ยน role ยังทำงานเหมือนเดิม', syncLegacy.res && syncLegacy.res.down === true, syncLegacy);
  check('ลดเป็น scanner แล้วเหลือแค่ scan', syncLegacy.caps.join(',') === 'scan', syncLegacy.caps);

  /* ---------- [7] หน้าจัดการผู้ใช้ ---------- */
  console.log('\n[7] หน้าจัดการผู้ใช้ — ช่องติ๊ก + กำแพงเดิม');
  const ui = await page.evaluate(() => {
    window.__seedRole('admin');
    state.users = {
      U1: { name: 'ตัวเอง', email: 'a@b.c', role: 'admin', active: true },
      U2: { name: 'ลูกน้อง', email: 'x@y.z', role: 'counter', active: true }
    };
    state.me.uid = 'U1';
    renderUsers();
    const row2 = document.querySelector('[data-user="U2"]');
    const boxes = row2.querySelectorAll('[data-permpick]');
    const opts = Array.prototype.map.call(row2.querySelector('[data-action="role"]').options,
                                          function (o) { return o.value; });
    const row1 = document.querySelector('[data-user="U1"]');
    return {
      count: boxes.length,
      opts: opts,
      checked: Array.prototype.filter.call(boxes, function (b) { return b.checked; })
                    .map(function (b) { return b.getAttribute('data-permpick'); }),
      adminLocked: Array.prototype.every.call(row1.querySelectorAll('[data-permpick]'),
                                              function (b) { return b.disabled && b.checked; })
    };
  });
  check('มีช่องติ๊กครบ 15 ช่อง', ui.count === 15, ui.count);
  check('ดรอปดาวน์มีตัวเลือก custom', ui.opts.indexOf('custom') >= 0, ui.opts);
  check('counter ถูกติ๊กตามแม่แบบ',
        ui.checked.slice().sort().join(',') === TEMPLATE.counter.slice().sort().join(','), ui.checked);
  check('แถวของ admin ติ๊กครบและกดแก้ไม่ได้', ui.adminLocked === true, ui);

  /* saveUserField วิ่งผ่าน ensureRoleFresh({force:true}) ก่อนเขียนเสมอ (v2.11.0)
     จึงเป็นงานแบบรอผล ต้องหน่วงอ่านผลลัพธ์ ไม่ใช่อ่านทันทีหลังกดติ๊ก */
  const tick = await page.evaluate(async () => {
    window.__seedRole('admin');
    state.users = {
      U1: { name: 'ตัวเอง', email: 'a@b.c', role: 'admin', active: true },
      U2: { name: 'ลูกน้อง', email: 'x@y.z', role: 'counter', active: true }
    };
    state.me.uid = 'U1';
    renderUsers();
    window.__updates = [];
    const row2 = document.querySelector('[data-user="U2"]');
    const cb = row2.querySelector('[data-permpick="editLocation"]');
    cb.checked = true;
    cb.onchange();
    await new Promise(function (r) { setTimeout(r, 60); });
    const p = (window.__updates[0] || {}).patch || {};
    return { patch: p, sel: row2.querySelector('[data-action="role"]').value,
             path: (window.__updates[0] || {}).path };
  });
  check('ติ๊กแล้วเขียนที่ users', tick.path === 'users', tick);
  check('เขียน perms รายช่อง ไม่ทับทั้งก้อน',
        tick.patch['U2/perms/editLocation'] === true, tick.patch);
  check('ช่องที่ไม่ได้ติ๊กเขียน null ให้คีย์หายไป (ไม่เก็บ false)',
        tick.patch['U2/perms/deleteJob'] === null, tick.patch);
  check('⭐ ติ๊กเองแล้ว role กลายเป็น custom อัตโนมัติ', tick.patch['U2/role'] === 'custom', tick.patch);
  check('ดรอปดาวน์บนจอตามไปด้วย', tick.sel === 'custom', tick);
  check('ยังเก็บ perms เดิมของ counter ไว้ครบ',
        tick.patch['U2/perms/scan'] === true && tick.patch['U2/perms/editDoc'] === true, tick.patch);

  const pickRole = await page.evaluate(async () => {
    window.__seedRole('admin');
    state.users = {
      U1: { name: 'ตัวเอง', email: 'a@b.c', role: 'admin', active: true },
      U2: { name: 'ลูกน้อง', email: 'x@y.z', role: 'custom', active: true, perms: { editLocation: true } }
    };
    state.me.uid = 'U1';
    renderUsers();
    window.__updates = [];
    const sel = document.querySelector('[data-user="U2"] [data-action="role"]');
    sel.value = 'scanner';
    sel.onchange();
    await new Promise(function (r) { setTimeout(r, 60); });
    return (window.__updates[0] || {}).patch || {};
  });
  check('เลือก role = เขียน perms ตามแม่แบบไปด้วย', pickRole['U2/perms/scan'] === true, pickRole);
  check('สิทธิ์เดิมที่ไม่อยู่ในแม่แบบถูกล้าง', pickRole['U2/perms/editLocation'] === null, pickRole);
  check('เขียน role ลงไปด้วย', pickRole['U2/role'] === 'scanner', pickRole);

  console.log('\n[7b] กำแพงเดิมต้องยังอยู่');
  const walls = await page.evaluate(() => {
    window.__seedRole('admin');
    state.users = {
      U1: { name: 'ตัวเอง', email: 'a@b.c', role: 'admin', active: true },
      U2: { name: 'อีกคน', email: 'x@y.z', role: 'counter', active: true }
    };
    state.me.uid = 'U1';
    renderUsers();
    window.__updates = []; window.__toasts = [];
    const own = document.querySelector('[data-user="U1"] [data-action="role"]');
    own.value = 'viewer';
    own.onchange();
    const selfBlocked = { wrote: window.__updates.length, msg: (window.__toasts[0] || {}).m, back: own.value };

    window.__updates = []; window.__toasts = [];
    state.users.U2.role = 'counter';
    renderUsers();
    /* เหลือ admin คนเดียวคือ U1 — ลดตัวเองไม่ได้อยู่แล้ว ลองลด U2 ที่เป็น admin แทน */
    state.users.U2.role = 'admin';
    state.users.U1.role = 'counter';
    state.me.uid = 'U9';                       // ทำเป็นคนอื่นที่เป็น admin
    renderUsers();
    const sel2 = document.querySelector('[data-user="U2"] [data-action="role"]');
    sel2.value = 'viewer';
    sel2.onchange();
    const lastAdmin = { wrote: window.__updates.length, msg: (window.__toasts[0] || {}).m };
    return { selfBlocked: selfBlocked, lastAdmin: lastAdmin };
  });
  check('เปลี่ยนสิทธิ์ตัวเองไม่ได้', walls.selfBlocked.wrote === 0, walls.selfBlocked);
  check('บอกเหตุผลเป็นภาษาคน', /เปลี่ยนสิทธิ์ของตัวเองไม่ได้/.test(walls.selfBlocked.msg || ''),
        walls.selfBlocked.msg);
  check('ดีดค่าในดรอปดาวน์กลับ', walls.selfBlocked.back === 'admin', walls.selfBlocked);
  check('ต้องเหลือ admin อย่างน้อย 1 คน', walls.lastAdmin.wrote === 0, walls.lastAdmin);
  check('บอกว่าต้องตั้งคนอื่นเป็น admin ก่อน',
        /ผู้ดูแลอย่างน้อย 1 คน/.test(walls.lastAdmin.msg || ''), walls.lastAdmin.msg);

  /* ---------- [8] ข้อความ error ต้องเป็นภาษาคน ---------- */
  console.log('\n[8] ข้อความบล็อกต้องบอกทางออก ไม่ใช่ "ไม่มีสิทธิ์" ลอย ๆ');
  const msgs = await page.evaluate(() => {
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: { docs: true } });
    const custom = roleBlockMessage('แก้ Location ไม่ได้');
    window.__seedRole('scanner');
    const scanner = roleBlockMessage('แก้ Location ไม่ได้');
    return { custom: custom, scanner: scanner, label: ROLE_LABEL.custom, help: ROLE_HELP.custom };
  });
  check('custom มีชื่อสิทธิ์เป็นภาษาไทย', msgs.label === 'กำหนดเอง', msgs.label);
  check('custom มีคำอธิบาย', (msgs.help || '').length > 10, msgs.help);
  check('custom ไม่พ่น undefined ใส่หน้าคนใช้', !/undefined/.test(msgs.custom), msgs.custom);
  check('custom บอกให้ไปขอติ๊กเพิ่ม', /ติ๊กเพิ่มให้ก่อน/.test(msgs.custom), msgs.custom);
  check('role เดิมยังใช้ข้อความแบบเดิม', /เป็นสิทธิ์ "พนักงานยิงอย่างเดียว"/.test(msgs.scanner), msgs.scanner);

  /* ---------- [9] หน้าผู้ใช้แบบพับได้ + ค้นหา + ชิปกรอง (v2.12.1) ---------- */
  console.log('\n[9] พับ/กางแถวผู้ใช้');
  const SEED_USERS = `
    window.__seedRole('admin');
    state.me.uid = 'U1';
    state.users = {
      U1: { name: 'สมชาย ใจดี',  email: 'somchai@isrd.local', role: 'admin',   active: true },
      U2: { name: 'สมหญิง รักงาน', email: 'somying@isrd.local', role: 'counter', active: true },
      U3: { name: 'กิ๊ฟ',        email: 'gift@isrd.local',    role: 'scanner', active: true },
      U4: { name: 'ป้าแดง',      email: 'daeng@isrd.local',   role: 'viewer',  active: false },
      U5: { name: 'น้องบอล',     email: 'ball@isrd.local',    role: 'custom',  active: true,
            perms: { editLocation: true, viewMasterLoc: true, docs: true } }
    };
    userOpen = {}; userRoleFilter = 'all';
    document.getElementById('userSearch').value = '';
    renderUsers();
  `;

  const fold = await page.evaluate((seed) => {
    eval(seed);
    const read = function (uid) {
      const head = document.querySelector('[data-userhead="' + uid + '"]');
      const body = document.querySelector('[data-userbody="' + uid + '"]');
      return { hidden: body.hidden, arrow: head.querySelector('.u-arrow').textContent,
               exp: head.getAttribute('aria-expanded'),
               inDom: body.querySelectorAll('[data-permpick]').length };
    };
    const before = read('U2');
    document.querySelector('[data-userhead="U2"]').click();
    const after = read('U2');
    document.querySelector('[data-userhead="U3"]').click();
    const both = { u2: read('U2').hidden, u3: read('U3').hidden, u4: read('U4').hidden };
    /* วาดใหม่ (เหมือนหลังบันทึก) แล้วต้องยังกางค้างอยู่ทั้งสองคน */
    renderUsers();
    const afterRedraw = { u2: read('U2').hidden, u3: read('U3').hidden, u4: read('U4').hidden };
    document.querySelector('[data-userhead="U2"]').click();
    return { before: before, after: after, both: both, afterRedraw: afterRedraw,
             closed: read('U2').hidden, tag: document.querySelector('[data-userhead="U2"]').tagName };
  }, SEED_USERS);
  check('ค่าเริ่มต้นพับทุกคน', fold.before.hidden === true, fold.before);
  check('ลูกศรพับเป็น ▸', fold.before.arrow === '▸', fold.before);
  check('editor ยังอยู่ใน DOM ตอนพับ (ไม่ได้ถอดทิ้ง)', fold.before.inDom === 15, fold.before);
  check('คลิกหัวแถวแล้วกาง', fold.after.hidden === false, fold.after);
  check('ลูกศรกางเป็น ▾', fold.after.arrow === '▾', fold.after);
  check('หัวแถวเป็นปุ่มจริง (คีย์บอร์ดใช้ได้)', fold.tag === 'BUTTON', fold.tag);
  check('บอกสถานะด้วย aria-expanded', fold.after.exp === 'true', fold.after);
  check('⭐ กางได้หลายคนพร้อมกัน', fold.both.u2 === false && fold.both.u3 === false, fold.both);
  check('คนอื่นยังพับอยู่', fold.both.u4 === true, fold.both);
  check('⭐ วาดใหม่แล้วยังกางค้าง (ไม่พับกลับตอนบันทึก)',
        fold.afterRedraw.u2 === false && fold.afterRedraw.u3 === false, fold.afterRedraw);
  check('คลิกซ้ำแล้วพับกลับ', fold.closed === true, fold.closed);

  console.log('\n[9b] สรุปสิทธิ์บนหัวแถว');
  const summary = await page.evaluate((seed) => {
    eval(seed);
    const txt = function (uid) {
      return { count: document.querySelector('[data-usercount="' + uid + '"]').textContent,
               role: document.querySelector('[data-userrole="' + uid + '"]').textContent };
    };
    const out = { admin: txt('U1'), counter: txt('U2'), scanner: txt('U3'), custom: txt('U5') };
    /* ติ๊กเพิ่มให้ U5 แล้วตัวเลขบนหัวแถวต้องขยับทันที (ติ๊กใช้ keepUi ไม่มีการวาดใหม่) */
    document.querySelector('[data-userhead="U5"]').click();
    const cb = document.querySelector('[data-userbody="U5"] [data-permpick="scan"]');
    cb.checked = true; cb.onchange();
    out.afterTick = txt('U5').count;
    return out;
  }, SEED_USERS);
  check('admin โชว์ "ทุกสิทธิ์" ไม่ใช่ตัวเลข', /ทุกสิทธิ์/.test(summary.admin.count), summary.admin);
  check('counter โชว์ ติ๊ก 10/15', /ติ๊ก 10\/15/.test(summary.counter.count), summary.counter);
  check('scanner โชว์ ติ๊ก 1/15', /ติ๊ก 1\/15/.test(summary.scanner.count), summary.scanner);
  check('custom โชว์ ติ๊ก 3/15', /ติ๊ก 3\/15/.test(summary.custom.count), summary.custom);
  check('ป้ายสิทธิ์ใช้ ROLE_LABEL', summary.counter.role === 'ผู้นับสต๊อก' &&
        summary.custom.role === 'กำหนดเอง', summary.counter);
  check('⭐ ติ๊กแล้วตัวเลขบนหัวแถวขยับทันที', /ติ๊ก 4\/15/.test(summary.afterTick), summary.afterTick);

  console.log('\n[9c] ช่องค้นหา');
  const search = await page.evaluate((seed) => {
    eval(seed);
    const box = document.getElementById('userSearch');
    const shown = function () {
      return Array.prototype.filter.call(
        document.querySelectorAll('#userList [data-user]'), function (r) { return !r.hidden; })
        .map(function (r) { return r.getAttribute('data-user'); });
    };
    const out = { all: shown().length };
    box.value = 'สมหญิง'; box.oninput();      out.byName = shown();
    box.value = 'gift@';  box.oninput();      out.byMail = shown();
    box.value = 'ดูอย่างเดียว'; box.oninput(); out.byRole = shown();
    box.value = 'ไม่มีคนนี้'; box.oninput();
    out.none = shown();
    out.emptyShown = !document.getElementById('userEmpty').hidden;
    out.emptyText = document.getElementById('userEmpty').textContent;
    box.value = ''; box.oninput();
    out.back = shown().length;
    out.emptyHidden = document.getElementById('userEmpty').hidden;
    return out;
  }, SEED_USERS);
  check('เริ่มต้นเห็นครบ 5 คน', search.all === 5, search.all);
  check('ค้นด้วยชื่อ', search.byName.join(',') === 'U2', search.byName);
  check('ค้นด้วยอีเมล', search.byMail.join(',') === 'U3', search.byMail);
  check('ค้นด้วยชื่อสิทธิ์ภาษาไทย', search.byRole.join(',') === 'U4', search.byRole);
  check('ไม่เจอ = ไม่เหลือแถว', search.none.length === 0, search.none);
  check('ขึ้นข้อความ "ไม่พบผู้ใช้"', search.emptyShown && /ไม่พบผู้ใช้/.test(search.emptyText),
        search.emptyText);
  check('ล้างคำค้นแล้วกลับมาครบ', search.back === 5, search.back);
  check('ข้อความไม่พบหายไปด้วย', search.emptyHidden === true, search.emptyHidden);

  console.log('\n[9d] ชิปกรองสิทธิ์ + ทำงานร่วมกับช่องค้นหา (AND)');
  const chips = await page.evaluate((seed) => {
    eval(seed);
    const shown = function () {
      return Array.prototype.filter.call(
        document.querySelectorAll('#userList [data-user]'), function (r) { return !r.hidden; })
        .map(function (r) { return r.getAttribute('data-user'); });
    };
    const labels = Array.prototype.map.call(
      document.querySelectorAll('[data-userchip]'), function (b) { return b.textContent; });
    const out = { labels: labels,
                  keys: Array.prototype.map.call(document.querySelectorAll('[data-userchip]'),
                          function (b) { return b.getAttribute('data-userchip'); }) };
    document.querySelector('[data-userchip="counter"]').click();
    out.counter = shown();
    out.onClass = document.querySelector('[data-userchip="counter"]').className;
    document.querySelector('[data-userchip="all"]').click();
    out.all = shown();
    /* AND: ชิป scanner + คำค้นที่ตรงกับ counter ต้องไม่เหลืออะไรเลย */
    document.querySelector('[data-userchip="scanner"]').click();
    const box = document.getElementById('userSearch');
    box.value = 'สมหญิง'; box.oninput();
    out.andNone = shown();
    box.value = 'กิ๊ฟ'; box.oninput();
    out.andHit = shown();
    return out;
  }, SEED_USERS);
  check('มีชิปครบ 6 อัน (ทั้งหมด + 5 สิทธิ์)',
        chips.keys.join(',') === 'all,admin,counter,scanner,viewer,custom', chips.keys);
  check('ชิปบอกจำนวนต่อกลุ่ม', /ทั้งหมด 5/.test(chips.labels[0]) && /1$/.test(chips.labels[1]),
        chips.labels);
  check('โชว์กลุ่มที่ไม่มีใครด้วย (เป็นข้อมูลเหมือนกัน)', chips.labels.length === 6, chips.labels);
  check('กดชิป counter เหลือเฉพาะ counter', chips.counter.join(',') === 'U2', chips.counter);
  check('ชิปที่เลือกมีสถานะ on', chips.onClass === 'on', chips.onClass);
  check('กดทั้งหมดกลับมาครบ', chips.all.length === 5, chips.all);
  check('⭐ ชิป + ค้นหาเป็น AND — ไม่ตรงทั้งคู่ = ว่าง', chips.andNone.length === 0, chips.andNone);
  check('⭐ ตรงทั้งคู่ = เจอ', chips.andHit.join(',') === 'U3', chips.andHit);

  console.log('\n[9e] ของเดิมต้องไม่หาย');
  const keep = await page.evaluate((seed) => {
    eval(seed);
    const out = {
      newUser: !!document.getElementById('btnNewUser'),
      linkUser: !!document.getElementById('btnLinkUser'),
      linkUid: !!document.getElementById('linkUserUid'),
      reset: document.querySelectorAll('#userList [data-action="reset"]').length,
      active: document.querySelectorAll('#userList [data-action="active"]').length,
      branch: document.querySelectorAll('#userList [data-branchlist]').length,
      roleSel: document.querySelectorAll('#userList [data-action="role"]').length
    };
    /* gate admin-only ต้องยังอยู่ — ไม่ใช่ admin แล้วต้องไม่วาดอะไรเลย */
    document.getElementById('userList').innerHTML = '<i id="untouched"></i>';
    window.__seedRole('counter');
    renderUsers();
    out.blocked = !!document.getElementById('untouched');
    return out;
  }, SEED_USERS);
  check('ปุ่มสร้างบัญชียังอยู่ที่เดิม', keep.newUser === true, keep);
  check('ช่องเพิ่มด้วย UID ยังอยู่', keep.linkUser && keep.linkUid, keep);
  check('ปุ่มรีเซ็ตรหัสผ่านครบทุกคน', keep.reset === 5, keep);
  check('ปุ่มปิด/เปิดบัญชีครบ (ยกเว้นตัวเอง)', keep.active === 4, keep);
  check('กล่องสาขาที่ดูแลยังอยู่ครบ', keep.branch === 5, keep);
  check('ดรอปดาวน์สิทธิ์ยังอยู่ครบ', keep.roleSel === 5, keep);
  check('⭐ gate admin-only ยังกันอยู่ (ไม่ใช่ admin = ไม่วาดเลย)', keep.blocked === true, keep);

  /* ---------- [10] ทุกสิทธิ์ต้องมีทางออกจากระบบ (v2.14.1) ----------
     บั๊กเดิม: ปุ่มออกระบบอยู่แต่ในหน้า Master ซึ่ง scanner/viewer เข้าไม่ถึงเลย
     คนยิงจึงออกจากระบบไม่ได้ ต้องล้างข้อมูลเบราว์เซอร์อย่างเดียว
     ข้อนี้คุมกติกาที่แรงกว่าตัวบั๊ก: "ทุกสิทธิ์ต้องมีปุ่มออกระบบที่กดถึงจริง"
     ถ้าวันหลังมีคนย้ายปุ่มหรือเพิ่มสิทธิ์ใหม่ที่เข้าหน้าไหนไม่ได้ ต้องดังตรงนี้ */
  console.log('\n[10] ⭐ ทุกสิทธิ์ต้องมีปุ่มออกจากระบบที่กดถึงจริง');
  const LOGOUTS = [
    { id: 'btnLogout',  page: 'master' },   // การ์ดเดิมบนหน้า Master
    { id: 'btnLogout2', page: 'jobs' }      // การ์ดบนหน้า Job (ทุกสิทธิ์เห็นหน้านี้)
  ];
  const escape = await page.evaluate((spots, roles) => {
    const out = {};
    roles.forEach(function (r) {
      window.__seedRole(r);
      renderAccount();
      applyNavVisibility();
      out[r] = spots.map(function (s) {
        const el = document.getElementById(s.id);
        if (!el) return { id: s.id, ok: false, why: 'ไม่มีปุ่มนี้ในหน้า' };
        /* กดถึงจริง = ปุ่มไม่ถูกซ่อน · การ์ดแม่ไม่ถูกซ่อน · และเข้าหน้านั้นได้ */
        const card = el.closest('.card');
        const visible = el.style.display !== 'none' &&
                        (!card || card.style.display !== 'none');
        return { id: s.id, page: s.page, visible: visible, reachable: visible && canSeePage(s.page),
                 wired: el.onclick === window.doLogout };
      });
    });
    return out;
  }, LOGOUTS, ['admin', 'counter', 'scanner', 'viewer']);

  ['admin', 'counter', 'scanner', 'viewer'].forEach(function (r) {
    const any = escape[r].filter(function (s) { return s.reachable && s.wired; });
    check(r + ': มีปุ่มออกระบบที่กดถึงจริงอย่างน้อย 1 ที่', any.length >= 1, escape[r]);
  });
  check('⭐ scanner ได้ปุ่มบนหน้า Job (บั๊กเดิมที่แก้)',
        escape.scanner.filter(function (s) { return s.id === 'btnLogout2'; })[0].reachable === true,
        escape.scanner);
  check('⭐ viewer ก็โดนบั๊กเดียวกัน ต้องได้ปุ่มด้วย',
        escape.viewer.filter(function (s) { return s.id === 'btnLogout2'; })[0].reachable === true,
        escape.viewer);
  check('admin ไม่เห็นการ์ดซ้ำบนหน้า Job',
        escape.admin.filter(function (s) { return s.id === 'btnLogout2'; })[0].visible === false,
        escape.admin);
  check('counter ก็ไม่เห็นการ์ดซ้ำ',
        escape.counter.filter(function (s) { return s.id === 'btnLogout2'; })[0].visible === false,
        escape.counter);
  check('ปุ่มเดิมบนหน้า Master ไม่ถูกแตะ — admin/counter ยังใช้ได้',
        escape.admin.filter(function (s) { return s.id === 'btnLogout'; })[0].reachable === true &&
        escape.counter.filter(function (s) { return s.id === 'btnLogout'; })[0].reachable === true,
        { admin: escape.admin[0], counter: escape.counter[0] });

  console.log('\n[10b] custom ที่ติ๊กไม่ครบก็ต้องออกระบบได้');
  const escCustom = await page.evaluate(() => {
    const read = function () {
      renderAccount(); applyNavVisibility();
      const el = document.getElementById('btnLogout2');
      const card = el.closest('.card');
      return { shown: card.style.display !== 'none', jobs: canSeePage('jobs'),
               master: canSeeMasterPage() };
    };
    const out = {};
    /* ติ๊กแค่ยิงอย่างเดียว — เข้าหน้า Master ไม่ได้ */
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: { scan: true } });
    out.scanOnly = read();
    /* ไม่ติ๊กอะไรเลย — เห็นแค่รายการ Job ก็ยังต้องออกได้ */
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true, perms: {} });
    out.nothing = read();
    /* ติ๊ก editLocation = เข้าหน้า Master ได้ การ์ดต้องหายไป ไม่โผล่ซ้ำ */
    window.__seedRec({ name: 'ท', email: 'a@b.c', role: 'custom', active: true,
                       perms: { editLocation: true } });
    out.locEditor = read();
    return out;
  });
  check('custom ที่ติ๊กแค่ scan ได้ปุ่มออกระบบ',
        escCustom.scanOnly.shown === true && escCustom.scanOnly.jobs === true, escCustom.scanOnly);
  check('custom ที่ไม่ติ๊กอะไรเลยก็ยังออกระบบได้',
        escCustom.nothing.shown === true, escCustom.nothing);
  check('custom ที่เข้าหน้า Master ได้ ไม่เห็นการ์ดซ้ำ',
        escCustom.locEditor.shown === false && escCustom.locEditor.master === true,
        escCustom.locEditor);

  console.log('\n[10c] สิทธิ์เปลี่ยนสดจากอีกเครื่อง — การ์ดต้องตามทันที');
  const escLive = await page.evaluate(() => {
    window.__seedRole('admin');
    renderAccount(); applyNavVisibility();
    const before = document.getElementById('btnLogout2').closest('.card').style.display;
    /* แอดมินอีกเครื่องลดสิทธิ์เราเป็น scanner ระหว่างเปิดแอปค้างไว้ */
    applyRoleChange({ name: 'ทดสอบ', email: 'a@b.c', role: 'scanner', active: true });
    const after = document.getElementById('btnLogout2').closest('.card').style.display;
    return { before: before, after: after };
  });
  check('admin: ซ่อนอยู่', escLive.before === 'none', escLive);
  check('⭐ ถูกลดเป็น scanner แล้วการ์ดโผล่ทันที ไม่ต้องล็อกอินใหม่', escLive.after === '', escLive);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
