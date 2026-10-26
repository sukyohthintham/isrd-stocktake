/* ทดสอบเฟส 3 — สร้างไฟล์ปรับยอดเข้า Zort (v2.37.5)
   ไฟล์ Excel 4 คอลัมน์ (รหัสสินค้า·ชื่อสินค้า·จำนวนหน่วย·ชื่อคลัง) · จำนวนหน่วย=จำนวนจริง(act)
   โหมด all=ทุก SKU ที่นับ · diff=เฉพาะผลต่าง≠0 · ตัด unknown · ต้องมีชื่อคลัง */
const { puppeteer, CHROME, APP_URL } = require('./_env');
let pass = 0, fail = 0;
function check(n, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + '  ->  ' + JSON.stringify(got)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await wait(1200);

  await page.evaluate(() => {
    window.__toasts = [];
    window.toast = (m, bad) => __toasts.push({ m: m, bad: bad });
    window.__xlsx = null;
    window.buildXlsx = function (sheets) { window.__xlsx = sheets; return new Blob(['x']); };
    window.URL.createObjectURL = function () { return 'blob:x'; };
    window.URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () {};   // กันดาวน์โหลดจริงในเทส
    if (typeof hideLogin === 'function') hideLogin();
    window.__DATA = { rows: [
      { key: 'A001', code: 'A001', name: 'เสื้อ', sys: 12, act: 9, diff: -3, known: true },
      { key: 'B002', code: 'B002', name: 'หมวก', sys: 8, act: 11, diff: 3, known: true },
      { key: 'C003', code: 'C003', name: 'ตรง', sys: 5, act: 5, diff: 0, known: true },
      { key: 'U999', code: 'U999', name: 'ไม่รู้', sys: 0, act: 2, diff: 2, known: false }
    ] };
    window.__seedZ = function () {
      state.me = { uid: 'u1', name: 'หนึ่ง', role: 'admin', branches: [] };
      state.counter = 'หนึ่ง'; state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบ', branchCode: 'B1', branchName: 'คลังหลัก',
                                 jobCode: 'J1', cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job';
      state.products = {}; state.systemQty = {}; state.systemQtyRaw = {}; state.sold = {};
      state.counts = {}; state.scanQty = {}; state.manualQty = {}; state.unknownKeys = {};
      state.unknown = {}; state.manualLog = []; state.scanLog = []; state.zones = {};
      state.transfers = {}; state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.rechecks = {}; state.recheckDraft = {}; state.recheckView = 'admin';
      state.zortWarehouse = null; state.zortScope = 'all';
      var add = function (c, sys, act) {
        state.products[c] = { code: c, name: 'ชื่อ ' + c, category: 'ห', type: 'product', costPrice: 10, sellPrice: 10 };
        state.systemQty[c] = sys; state.systemQtyRaw[c] = sys;
        if (act) { state.counts[c] = act; state.scanQty[c] = act; }
      };
      add('A001', 12, 9); add('B002', 8, 11); add('C003', 5, 5);
    };
  });

  console.log('\n[1] ฟังก์ชันครบ');
  const f = await page.evaluate(() => ['zortAdjustRows', 'exportZortAdjust', 'buildZortAdjust', 'rcZortCard'].map(n => typeof window[n]));
  check('zortAdjustRows/export/build/card เป็น function', f.every(t => t === 'function'), f);

  console.log('\n[2] zortAdjustRows กรองถูก');
  const r2 = await page.evaluate(() => ({
    all: zortAdjustRows(window.__DATA, 'all').map(r => r.code),
    diff: zortAdjustRows(window.__DATA, 'diff').map(r => r.code)
  }));
  check('all = ทุก SKU known (ตัด unknown U999)', r2.all.join(',') === 'A001,B002,C003', r2.all);
  check('diff = เฉพาะผลต่าง≠0 (A001,B002)', r2.diff.join(',') === 'A001,B002', r2.diff);

  console.log('\n[3] buildZortAdjust (all) → 4 คอลัมน์ + act + ชื่อคลัง');
  const r3 = await page.evaluate(() => {
    window.__xlsx = null; buildZortAdjust(window.__DATA, 'คลังหลัก', 'all');
    var sh = window.__xlsx && window.__xlsx[0];
    return { name: sh && sh.name, head: sh && sh.rows[0], rowA: sh && sh.rows[1], count: sh && (sh.rows.length - 1) };
  });
  check('ชีตชื่อ "ปรับ Zort"', r3.name === 'ปรับ Zort', r3);
  check('หัว 4 คอลัมน์ถูกต้อง', JSON.stringify(r3.head) === JSON.stringify(['รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนหน่วย', 'ชื่อคลังสินค้า']), r3.head);
  check('แถว A001 = [รหัส, ชื่อ, จำนวนจริง=9, คลังหลัก]', JSON.stringify(r3.rowA) === JSON.stringify(['A001', 'เสื้อ', 9, 'คลังหลัก']), r3.rowA);
  check('all = 3 แถว (รวม C003 diff=0 · ตัด U999)', r3.count === 3, r3);

  console.log('\n[4] buildZortAdjust (diff)');
  const r4 = await page.evaluate(() => {
    window.__xlsx = null; buildZortAdjust(window.__DATA, 'คลังหลัก', 'diff');
    return { count: window.__xlsx[0].rows.length - 1, codes: window.__xlsx[0].rows.slice(1).map(r => r[0]) };
  });
  check('diff = 2 แถว (A001,B002)', r4.count === 2 && r4.codes.join(',') === 'A001,B002', r4);

  console.log('\n[5] ไม่มีรายการ → เตือน ไม่สร้าง');
  const r5 = await page.evaluate(() => {
    window.__xlsx = null; window.__toasts = [];
    buildZortAdjust({ rows: [{ code: 'X', name: 'x', act: 5, diff: 0, known: true }] }, 'ค', 'diff');
    return { xlsx: window.__xlsx, warned: window.__toasts.some(t => t.bad) };
  });
  check('diff ว่าง → ไม่เรียก buildXlsx + เตือน', r5.xlsx === null && r5.warned, r5);

  console.log('\n[6] ไม่มีชื่อคลัง → เตือน');
  const r6 = await page.evaluate(() => {
    __seedZ(); state.zortWarehouse = '';
    state.roundIndex.R1.branchName = ''; state.roundIndex.R1.branch = '';
    window.__toasts = []; window.__xlsx = null;
    exportZortAdjust();
    return { warned: window.__toasts.some(t => t.bad), xlsx: window.__xlsx };
  });
  check('ชื่อคลังว่าง → เตือน ไม่สร้างไฟล์', r6.warned && r6.xlsx === null, r6);

  console.log('\n[7] export เต็ม flow (ensureReportData stub)');
  const r7 = await page.evaluate(async () => {
    __seedZ(); state.zortWarehouse = 'คลังทดสอบ'; state.zortScope = 'all';
    window.ensureReportData = function () { return Promise.resolve(window.__DATA); };
    window.cycleScope = function () { return { multi: false }; };
    window.__xlsx = null; window.__toasts = [];
    await exportZortAdjust();
    var sh = window.__xlsx && window.__xlsx[0];
    return { made: !!sh, count: sh && sh.rows.length - 1, wh: sh && sh.rows[1][3] };
  });
  check('ensureReportData → buildXlsx ถูกเรียก (3 แถว)', r7.made && r7.count === 3, r7);
  check('ชื่อคลังในไฟล์ = ที่กรอก (คลังทดสอบ)', r7.wh === 'คลังทดสอบ', r7);

  console.log('\n[8] การ์ด rcZortCard');
  const r8 = await page.evaluate(() => {
    __seedZ(); state.zortScope = 'all';
    var card = rcZortCard();
    return {
      btns: Array.prototype.map.call(card.querySelectorAll('button'), b => b.textContent),
      inputs: card.querySelectorAll('input[type="text"]').length,
      text: card.textContent, wh: state.zortWarehouse
    };
  });
  check('มีปุ่ม toggle 2 + ปุ่มสร้างไฟล์ (3 ปุ่ม)',
    r8.btns.length === 3 && r8.btns.some(t => t.indexOf('ทุก SKU') >= 0) &&
    r8.btns.some(t => t.indexOf('เฉพาะผลต่าง') >= 0) && r8.btns.some(t => t.indexOf('สร้างไฟล์ปรับ Zort') >= 0), r8.btns);
  check('มีช่องกรอกชื่อคลัง + pre-fill ชื่อสาขา (คลังหลัก)', r8.inputs === 1 && r8.wh === 'คลังหลัก', r8);
  check('โชว์จำนวน "3 รายการ" (all · known=3)', r8.text.indexOf('3 รายการ') >= 0, r8.text);

  console.log('\n[10] SKU ยิง 0 + จำนวนลบ (checkbox + ข้อ 4 clamp)');
  const r10 = await page.evaluate(() => {
    var D = { rows: [
      { key:'Z1', code:'Z1', name:'ยิง0', sys:5, act:0, diff:-5, known:true },
      { key:'N1', code:'N1', name:'ลบ', sys:2, act:-3, diff:-5, known:true },
      { key:'OK', code:'OK', name:'ปกติ', sys:3, act:4, diff:1, known:true }
    ]};
    var notInc = zortAdjustRows(D, 'all', false).map(r => r.code);
    var inc = zortAdjustRows(D, 'all', true).map(r => r.code);
    window.__xlsx = null;
    buildZortAdjust(D, 'คลัง', 'all', true);
    var rows = window.__xlsx[0].rows.slice(1);
    var z1 = rows.filter(r => r[0] === 'Z1')[0];
    var n1 = rows.filter(r => r[0] === 'N1')[0];
    return { notInc: notInc, inc: inc, z1qty: z1 && z1[2], n1qty: n1 && n1[2] };
  });
  check('ไม่ติ๊ก → ตัด SKU ยิง 0 (Z1 หาย เหลือ N1,OK)', r10.notInc.join(',') === 'N1,OK', r10.notInc);
  check('ติ๊กรวม → รวม SKU ยิง 0 (Z1,N1,OK)', r10.inc.join(',') === 'Z1,N1,OK', r10.inc);
  check('จำนวนหน่วย SKU ยิง 0 = 0', r10.z1qty === 0, r10);
  check('จำนวนหน่วยติดลบ → ตัดเป็น 0 (ข้อ 4 กันส่งเลขลบเข้า Zort)', r10.n1qty === 0, r10);

  console.log('\n[9] ไม่มี error');
  check('ไม่มี page error', errors.length === 0, errors.slice(0, 5));

  console.log('\n==== test-zort-adjust: ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
