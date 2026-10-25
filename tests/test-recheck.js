/* ทดสอบแท็บรีเช็ค (v2.37.0) — seed state จริง ขับ Chrome จริง เช็คสิทธิ์ตาม role จริง
   ครอบคลุม: กัน XSS (DOM API) · ล็อกสองชั้น (requirePerm) · เด็กไม่เห็นเป้า ·
   รูปแยกโหนด recheckPhotos · applied รีเซ็ตตอนส่งใหม่ · scanner ปรับยอดไม่ได้ */
const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  await wait(1200);

  await page.evaluate(() => {
    window.__calls = { enqueue: [], scan: [], toast: [] };
    window.enqueueWrite = (path, patch) => __calls.enqueue.push({ path: path, patch: patch });
    window.writeScan = (k, d, m, r) => __calls.scan.push({ k: k, d: d, m: m, r: r });
    window.toast = (m, bad) => __calls.toast.push({ m: m, bad: bad });
    window.ask = () => Promise.resolve(true);
    window.__rcDb = {};
    window.db.getQuiet = function () { return Promise.resolve(window.__rcDb); };
    if (typeof hideLogin === 'function') hideLogin();

    window.__seed = function (role) {
      state.me = { uid: 'u1', name: 'หนึ่ง', role: role || 'admin', branches: [] };
      state.counter = 'หนึ่ง'; state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job';
      state.products = {}; state.systemQty = {}; state.systemQtyRaw = {}; state.sold = {};
      state.counts = {}; state.scanQty = {}; state.manualQty = {}; state.unknownKeys = {};
      state.unknown = {}; state.manualLog = []; state.scanLog = []; state.zones = {};
      state.transfers = {}; state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.rechecks = {}; state.recheckDraft = {}; state.recheckView = 'admin';
      var add = function (code, sys, act) {
        state.products[code] = { code: code, name: 'ชื่อ ' + code, category: 'ห',
                                 type: 'product', costPrice: 10, sellPrice: 10 };
        if (sys !== null) { state.systemQty[code] = sys; state.systemQtyRaw[code] = sys; }
        if (act) { state.counts[code] = act; state.scanQty[code] = act; }
      };
      add('A001', 12, 9);   // ขาด -3
      add('B002', 8, 11);   // เกิน +3
      add('C003', 5, 5);    // ตรง
    };
    window.__btns = function () {
      return Array.prototype.map.call(document.getElementById('recheckBody').querySelectorAll('button'), function (b) { return b.textContent; });
    };
    window.__bodyText = function () { return document.getElementById('recheckBody').textContent; };
  });

  // ---------- [1] admin เห็นผลต่าง + ปุ่มส่งรีเช็ค ----------
  console.log('\n[1] admin view');
  await page.evaluate(() => { __seed('admin'); window.__rcDb = {}; state.rechecks = {}; renderRecheckAdmin(); });
  let r = await page.evaluate(() => ({ t: __bodyText(), b: __btns() }));
  check('admin แสดง A001 (ขาด)', r.t.indexOf('A001') >= 0);
  check('admin แสดง B002 (เกิน)', r.t.indexOf('B002') >= 0);
  check('admin ซ่อน C003 (ตรง+ยังไม่ส่ง)', r.t.indexOf('C003') < 0);
  check('admin มีปุ่ม "ส่งรีเช็ค"', r.b.some(t => t.indexOf('ส่งรีเช็ค') >= 0), r.b);

  // ---------- [2] sendRecheck ไม่หลุดเป้า ----------
  console.log('\n[2] ส่งรีเช็ค A001');
  await page.evaluate(() => { __calls.enqueue = []; sendRecheck('A001'); });
  let e2 = await page.evaluate(() => __calls.enqueue);
  let p2 = e2[0] ? e2[0].patch : {};
  check('enqueue 1 ครั้ง ไป rounds/R1/rechecks', e2.length === 1 && e2[0].path === 'rounds/R1/rechecks', e2);
  check('เขียน name+sentBy+sentAt', !!p2['A001/name'] && !!p2['A001/sentBy'] && !!p2['A001/sentAt']);
  check('ไม่หลุดเป้า (ไม่มี sys/act/target/diff/qty)',
    p2['A001/sys'] === undefined && p2['A001/act'] === undefined && p2['A001/target'] === undefined &&
    p2['A001/diff'] === undefined && p2['A001/qty'] === undefined, p2);

  // ---------- [3] scanner เห็นแค่ SKU ----------
  console.log('\n[3] เด็ก scanner — เห็นแค่ SKU');
  await page.evaluate(() => {
    __seed('scanner');
    window.__rcDb = { A001: { name: 'ชื่อ A001', sentAt: 1, sentBy: 'หนึ่ง' } };
    state.rechecks = window.__rcDb; renderRecheckScanner(false);
  });
  r = await page.evaluate(() => ({ t: __bodyText(), toggleHidden: getComputedStyle(document.getElementById('recheckTabs')).display === 'none', hasInput: !!document.getElementById('recheckBody').querySelector('input[type=number]') }));
  check('เด็กแสดง A001', r.t.indexOf('A001') >= 0);
  check('เด็ก "ไม่" เห็นตัวเลขเป้า (ไม่มี ควรเหลือ/ระบบ/ผลต่าง)',
    r.t.indexOf('ควรเหลือ') < 0 && r.t.indexOf('ระบบ') < 0 && r.t.indexOf('ผลต่าง') < 0);
  check('เด็กมีช่องใส่จำนวน', r.hasInput);
  check('เด็กมีปุ่มถ่ายรูป', r.t.indexOf('ถ่าย/แนบรูป') >= 0);

  // ---------- [4] submit ต้องมีจำนวน+รูป ----------
  console.log('\n[4] ส่งคืนต้องมีจำนวน+รูป');
  await page.evaluate(() => { __calls.enqueue = []; __calls.toast = []; state.recheckDraft = {}; submitRecheck('A001'); });
  check('บล็อกการส่งเมื่อยังไม่ครบ', await page.evaluate(() => __calls.enqueue.length === 0 && __calls.toast.some(t => t.bad)));

  // ---------- [5] submit ครบ → เขียน 2 โหนด (meta + รูปแยก) ----------
  console.log('\n[5] ใส่จำนวน+รูป แล้วส่งคืน');
  await page.evaluate(() => {
    state.recheckDraft = { A001: { qty: 12, photo: 'data:image/jpeg;base64,/9j/zzzz' } };
    __calls.enqueue = []; submitRecheck('A001');
  });
  let e5 = await page.evaluate(() => __calls.enqueue);
  let meta = (e5.find(x => x.path === 'rounds/R1/rechecks') || {}).patch || {};
  let photo = (e5.find(x => x.path === 'recheckPhotos/R1') || {}).patch || {};
  check('เขียน meta (qty/by/at/applied=false) ไป rounds/.../rechecks', meta['A001/qty'] === 12 && !!meta['A001/by'] && !!meta['A001/at'] && meta['A001/applied'] === false, meta);
  check('เขียนรูปแยกไป recheckPhotos/R1 (ไม่ปนใน rounds)', typeof photo['A001'] === 'string' && photo['A001'].indexOf('data:image/jpeg;base64,') === 0 && meta['A001/photo'] === undefined, { photo: !!photo['A001'], metaHasPhoto: meta['A001/photo'] !== undefined });
  check('อัปเดต cache + ล้าง draft', await page.evaluate(() => state.rechecks.A001.qty === 12 && !state.recheckDraft.A001));

  // ---------- [6] admin เห็นผลกลับ + ปุ่มใช้ยอด + ปุ่มดูรูป ----------
  console.log('\n[6] admin เห็นผลรีเช็คกลับ');
  await page.evaluate(() => {
    __seed('admin');
    window.__rcDb = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', applied: false } };
    state.rechecks = window.__rcDb; renderRecheckAdmin();
  });
  r = await page.evaluate(() => ({ t: __bodyText(), b: __btns() }));
  check('admin แสดงยอดที่เด็กนับคืน', r.t.indexOf('นับรีเช็คได้') >= 0);
  check('admin เทียบ 12 vs ควรเหลือ 12 → ตรงแล้ว', r.t.indexOf('ตรงแล้ว') >= 0);
  check('admin มีปุ่ม "ใช้ยอดรีเช็ค"', r.b.some(t => t.indexOf('ใช้ยอดรีเช็ค') >= 0), r.b);
  check('admin มีปุ่ม "ดูรูป" (lazy load)', r.b.some(t => t.indexOf('ดูรูป') >= 0), r.b);

  // ---------- [7] applyRecheck (admin) → ปรับยอดนับ ----------
  console.log('\n[7] admin ใช้ยอดรีเช็ค');
  await page.evaluate(() => { __calls.scan = []; applyRecheck('A001'); });
  let s7 = await page.evaluate(() => __calls.scan);
  check('writeScan delta +3 (12-9) mode manual', s7.length === 1 && s7[0].d === 3 && s7[0].m === 'manual', s7);
  check('mark applied', await page.evaluate(() => state.rechecks.A001.applied === true));

  // ---------- [8] scanner ปรับยอดไม่ได้ (ล็อกชั้นฟังก์ชัน) ----------
  console.log('\n[8] scanner กดใช้ยอดไม่ได้ (requirePerm adjustCount)');
  await page.evaluate(() => {
    __seed('scanner');
    state.rechecks = { A001: { name: 'ชื่อ A001', qty: 99, applied: false } };
    __calls.scan = []; __calls.toast = []; applyRecheck('A001');
  });
  check('scanner applyRecheck ถูกบล็อก (ไม่มี writeScan)', await page.evaluate(() => __calls.scan.length === 0));
  check('scanner sendRecheck ถูกบล็อกด้วย', await page.evaluate(() => { __calls.enqueue = []; sendRecheck('B002'); return __calls.enqueue.length === 0; }));

  // ---------- [9] cancelRecheck (admin) → ลบ 2 โหนด ----------
  console.log('\n[9] admin ถอนรีเช็ค');
  const e9 = await page.evaluate(async () => {
    __seed('admin');
    state.rechecks = { B002: { name: 'ชื่อ B002', sentAt: 1 } };
    __calls.enqueue = []; cancelRecheck('B002');
    await new Promise(r => setTimeout(r, 30));
    return __calls.enqueue;
  });
  check('ถอน: ลบ meta (rounds/.../rechecks B002=null)', e9.some(x => x.path === 'rounds/R1/rechecks' && x.patch['B002'] === null), e9);
  check('ถอน: ลบรูป (recheckPhotos/R1 B002=null)', e9.some(x => x.path === 'recheckPhotos/R1' && x.patch['B002'] === null), e9);

  // ---------- [10] no page errors ----------
  console.log('\n[10] ไม่มี error');
  check('ไม่มี page error', errors.length === 0, errors.slice(0, 5));

  console.log('\n==== test-recheck: ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
