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
    window.__realEnqueue = window.enqueueWrite;
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

  // ---------- [5] submit ครบ → รูปส่งตรง db.update, สำเร็จก่อนค่อยบันทึกยอด ----------
  console.log('\n[5] ใส่จำนวน+รูป แล้วส่งคืน (รูปตรง db.update → ยอดตาม)');
  const r5 = await page.evaluate(async () => {
    window.__dbUpd = [];
    var orig = db.update;
    db.update = function (path, patch) { __dbUpd.push({ path: path, patch: patch }); return Promise.resolve(); };
    state.recheckDraft = { A001: { qty: 12, photo: 'data:image/jpeg;base64,/9j/zzzz' } };
    __calls.enqueue = []; submitRecheck('A001');
    await new Promise(r => setTimeout(r, 50));
    db.update = orig;
    return { upd: __dbUpd, enq: __calls.enqueue };
  });
  const photoUpd = (r5.upd.find(x => x.path === 'recheckPhotos/R1') || {}).patch || {};
  const meta5 = (r5.enq.find(x => x.path === 'rounds/R1/rechecks') || {}).patch || {};
  check('รูปส่งตรง db.update → recheckPhotos/R1 (ไม่ผ่านคิว localStorage)', typeof photoUpd['A001'] === 'string' && photoUpd['A001'].indexOf('data:image/jpeg;base64,') === 0, photoUpd);
  check('รูปสำเร็จแล้วค่อยบันทึกยอด (qty/by/at/applied=false ผ่าน enqueue · รูปไม่ปนใน meta)', meta5['A001/qty'] === 12 && !!meta5['A001/by'] && meta5['A001/applied'] === false && meta5['A001/photo'] === undefined, meta5);
  check('อัปเดต cache + ล้าง draft', await page.evaluate(() => state.rechecks.A001.qty === 12 && !state.recheckDraft.A001));

  // ---------- [5b] รูปส่งไม่สำเร็จ → ยอดไม่ขึ้น (กัน orphan) + เตือน ----------
  console.log('\n[5b] รูปส่งไม่สำเร็จ → ยอดไม่ขึ้น');
  const r5b = await page.evaluate(async () => {
    var orig = db.update;
    db.update = function () { return Promise.reject(new Error('quota/net')); };
    state.rechecks = {}; state.recheckDraft = { Z9: { qty: 7, photo: 'data:image/jpeg;base64,/9j/zzzz' } };
    __calls.enqueue = []; __calls.toast = []; submitRecheck('Z9');
    await new Promise(r => setTimeout(r, 50));
    db.update = orig;
    return { enq: __calls.enqueue.length, bad: __calls.toast.some(t => t.bad), cached: !!state.rechecks.Z9, draft: !!state.recheckDraft.Z9 };
  });
  check('รูป fail → ไม่บันทึกยอด (ไม่มี orphan qty)', r5b.enq === 0 && !r5b.cached, r5b);
  check('รูป fail → เตือน + คง draft ให้ส่งใหม่ได้', r5b.bad && r5b.draft, r5b);

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
  check('admin มีรูปย่อ (thumbnail) ให้คลิกขยาย', await page.evaluate(() => !!document.getElementById('recheckBody').querySelector('img')), 'thumb');

  // ---------- [6b] รูปแคช — วาดการ์ดซ้ำไม่โหลด recheckPhotos ซ้ำ (กันกินโควตา) ----------
  console.log('\n[6b] รูปแคชต่อ Job');
  const r6b = await page.evaluate(async () => {
    __seed('admin');
    var calls = 0; var orig = db.getQuiet;
    db.getQuiet = function (path) { if (String(path).indexOf('recheckPhotos') === 0) calls++; return Promise.resolve('data:image/jpeg;base64,/9j/zz'); };
    state.rcPhotoCache = {};
    state.rechecks = { A001: { name: 'x', sentAt: 1, qty: 12, by: 'เด็ก' } };
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    db.getQuiet = orig;
    return { calls: calls };
  });
  check('รูปแคช: วาดการ์ด 3 ครั้ง โหลด recheckPhotos ครั้งเดียว (ไม่กินโควตาซ้ำ)', r6b.calls === 1, r6b);

  // ---------- [6c] รูปแคชถูกใบ — key = SKU@at · closure · ล้มแล้วลองใหม่ ----------
  console.log('\n[6c] รูปแคชถูกใบ (กันรูปผิด)');
  // (A) at เปลี่ยน (เด็กส่งรูปใหม่จากอีกเครื่อง) → โหลดรูปใหม่
  const r6cA = await page.evaluate(async () => {
    __seed('admin');
    var calls = 0; var orig = db.getQuiet;
    db.getQuiet = function (path) { if (String(path).indexOf('recheckPhotos') === 0) calls++; return Promise.resolve('data:image/jpeg;base64,/9j/zz'); };
    state.rcPhotoCache = {};
    state.rechecks = { A001: { name: 'x', sentAt: 1, qty: 12, by: 'เด็ก', at: 100 } };
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    var same = calls;
    state.rechecks.A001.at = 200;
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    db.getQuiet = orig;
    return { same: same, after: calls };
  });
  check('รูปแคช: at เดิม วาดซ้ำไม่โหลดใหม่ (=1)', r6cA.same === 1, r6cA);
  check('รูปแคช: at เปลี่ยน (เด็กส่งรูปใหม่อีกเครื่อง) → โหลดรูปใหม่ (=2)', r6cA.after === 2, r6cA);

  // (B) โหลดล้ม → ไม่แคช null ถาวร · เรนเดอร์ใหม่ลองโหลดอีก
  const r6cB = await page.evaluate(async () => {
    __seed('admin');
    var calls = 0, failNow = true; var orig = db.getQuiet;
    db.getQuiet = function (path) {
      if (String(path).indexOf('recheckPhotos') !== 0) return orig(path);
      calls++; return failNow ? Promise.reject(new Error('net')) : Promise.resolve('data:image/jpeg;base64,/9j/zz');
    };
    state.rcPhotoCache = {};
    state.rechecks = { A001: { name: 'x', sentAt: 1, qty: 12, by: 'เด็ก', at: 300 } };
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    var c1 = calls, cached = Object.prototype.hasOwnProperty.call(state.rcPhotoCache, 'A001@300');
    failNow = false;
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 25));
    db.getQuiet = orig;
    return { c1: c1, c2: calls, cached: cached };
  });
  check('รูปแคช: โหลดล้ม → ไม่แคช null (ลองใหม่ได้)', r6cB.cached === false, r6cB);
  check('รูปแคช: โหลดล้มแล้วเรนเดอร์ใหม่ → ลองโหลดซ้ำ (1→2)', r6cB.c1 === 1 && r6cB.c2 === 2, r6cB);

  // (C) สลับ Job ระหว่างรูปกำลังโหลด → เขียนลงแคช Job เก่า (closure) ไม่ปน Job ใหม่ (กันรูปผิดใบ)
  const r6cC = await page.evaluate(async () => {
    __seed('admin');
    var resolvers = []; var orig = db.getQuiet;
    db.getQuiet = function (path) {
      if (String(path).indexOf('recheckPhotos') !== 0) return orig(path);
      return new Promise(function (res) { resolvers.push(function () { res('data:image/jpeg;base64,/9j/OLD'); }); });
    };
    state.roundId = 'R1';
    var oldCache = (state.rcPhotoCache = {});
    state.rechecks = { A001: { name: 'x', sentAt: 1, qty: 12, by: 'เด็ก', at: 100 } };
    renderRecheckAdmin(); await new Promise(r => setTimeout(r, 10));
    var newCache = (state.rcPhotoCache = {}); state.roundId = 'R2';
    resolvers.forEach(function (f) { f(); }); await new Promise(r => setTimeout(r, 25));
    db.getQuiet = orig;
    return {
      oldHas: Object.prototype.hasOwnProperty.call(oldCache, 'A001@100'),
      newPolluted: Object.prototype.hasOwnProperty.call(newCache, 'A001@100')
    };
  });
  check('รูปแคช: สลับ Job ระหว่างโหลด → เขียนลงแคช Job เก่า (closure)', r6cC.oldHas === true, r6cC);
  check('รูปแคช: สลับ Job ระหว่างโหลด → ไม่ปนแคช Job ใหม่ (กันรูปผิดใบ)', r6cC.newPolluted === false, r6cC);
  // คืนสภาพ state ให้เทสถัดไป ([7] ใช้ A001 qty 12 บน R1)
  await page.evaluate(() => { __seed('admin'); state.rechecks = { A001: { name: 'x', sentAt: 1, qty: 12, by: 'เด็ก' } }; renderRecheckAdmin(); });

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

  // ---------- [9b] cancelRecheck ตอนรอบปิด = block (ล็อกชั้นฟังก์ชัน) ----------
  console.log('\n[9b] ถอนรีเช็คตอนรอบปิด = block');
  const e9b = await page.evaluate(async () => {
    __seed('admin');
    state.roundIndex.R1.status = 'closed';
    state.rechecks = { B002: { name: 'x', sentAt: 1 } };
    __calls.enqueue = []; __calls.toast = [];
    cancelRecheck('B002');
    await new Promise(r => setTimeout(r, 30));
    return { enq: __calls.enqueue.length, bad: __calls.toast.some(t => t.bad) };
  });
  check('รอบปิด: cancelRecheck ไม่ enqueue + เตือน', e9b.enq === 0 && e9b.bad, e9b);

  // ---------- [5c] เปลี่ยน Job ระหว่างอัปรูป → ยอดยังลง Job เดิม (ยอดไม่หาย) ----------
  console.log('\n[5c] เปลี่ยน Job ระหว่างอัป → ยอดลง Job เดิม');
  const r5c = await page.evaluate(async () => {
    __seed('scanner'); state.roundId = 'R1'; state.rechecks = {};
    var orig = db.update; var resolveFn;
    db.update = function (path) { if (String(path).indexOf('recheckPhotos') === 0) return new Promise(function (res) { resolveFn = res; }); return Promise.resolve(); };
    state.recheckDraft = { M5: { qty: 4, photo: 'data:image/jpeg;base64,/9j/zz' } };
    __calls.enqueue = [];
    submitRecheck('M5');        // รูป pending
    state.roundId = 'R2';       // เปลี่ยน Job ระหว่างรอ
    resolveFn();                // รูปสำเร็จ
    await new Promise(r => setTimeout(r, 40));
    db.update = orig;
    return { paths: __calls.enqueue.map(function (x) { return x.path; }) };
  });
  check('เปลี่ยน Job ระหว่างอัป → ยอดยัง enqueue ลง Job เดิม (rounds/R1)', r5c.paths.indexOf('rounds/R1/rechecks') >= 0, r5c);

  // ---------- [9d] queueSave เต็มตลอด → enqueueWrite ยิงตรง db.update (ยอดไม่หาย) ----------
  console.log('\n[9d] queueSave เต็มตลอด → ยิงตรง');
  const r9d = await page.evaluate(async () => {
    var origSet = localStorage.setItem.bind(localStorage);
    var origRem = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) { if (k === 'isrd_write_queue') { var e = new Error('q'); e.name = 'QuotaExceededError'; throw e; } return origSet(k, v); };
    localStorage.removeItem = function (k) { return origRem(k); };
    var direct = []; var origUpd = db.update; db.update = function (p) { direct.push(p); return Promise.resolve(); };
    __calls.toast = [];
    window.__realEnqueue('rounds/R1', { 'scans/x': { code: 'A', delta: 1 } });   // enqueueWrite ตัวจริง (setup mock ตัว global ไว้)
    localStorage.setItem = origSet; localStorage.removeItem = origRem; db.update = origUpd;
    return { direct: direct };
  });
  check('queueSave เต็มตลอด → enqueueWrite ยิงตรง db.update (ยอดไม่หาย)', r9d.direct.indexOf('rounds/R1') >= 0, r9d);

  // ---------- [9c] queueSave: localStorage เต็ม → ล้างแคชรูปสินค้าแล้วเขียนคิวได้ (ยอดยิงไม่หาย) ----------
  console.log('\n[9c] queueSave เต็ม → กู้ด้วยล้างแคชรูป');
  const rq = await page.evaluate(() => {
    var removed = [];
    var origSet = localStorage.setItem.bind(localStorage);
    var origRem = localStorage.removeItem.bind(localStorage);
    var failOnce = true;
    localStorage.setItem = function (k, v) {
      if (k === 'isrd_write_queue' && failOnce) { failOnce = false; var e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return origSet(k, v);
    };
    localStorage.removeItem = function (k) { removed.push(k); return origRem(k); };
    var ok = queueSave([{ path: 'x', patch: { a: 1 } }]);
    localStorage.setItem = origSet; localStorage.removeItem = origRem;
    return { ok: ok, removedThumb: removed.indexOf('isrd_thumbs_v2') >= 0, saved: JSON.parse(localStorage.getItem('isrd_write_queue') || '[]').length };
  });
  check('queueSave เต็ม → ลบแคชรูปสินค้า (isrd_thumbs_v2) แล้วเขียนคิวสำเร็จ (ยอดไม่หาย)', rq.ok && rq.removedThumb && rq.saved === 1, rq);

  // ---------- [10] no page errors ----------
  console.log('\n[11] cut-off: ขอแก้ / อนุมัติ');
  const r11 = await page.evaluate(() => {
    __seed('admin');
    state.rechecks = { A001: { name: 'x', sentAt: 1, qty: 12, by: 'เด็ก', at: 100 } };
    __calls.enqueue = []; requestReopen('A001');
    var reqP = (__calls.enqueue[0] || {}).patch; var reqF = state.rechecks.A001.reopenReq === true;
    __calls.enqueue = []; allowReopen('A001');
    var okP = (__calls.enqueue[0] || {}).patch;
    var okF = state.rechecks.A001.reopenOk === true;
    return { reqP: reqP, reqF: reqF, okP: okP, okF: okF };
  });
  check('requestReopen → enqueue reopenReq=true + ตั้ง flag', r11.reqF && !!r11.reqP && r11.reqP['A001/reopenReq'] === true, r11.reqP);
  check('allowReopen → enqueue reopenOk=true (ไม่เขียน reopenReq กัน PATCH ตกสำหรับ custom)', r11.okF && !!r11.okP && r11.okP['A001/reopenOk'] === true && r11.okP['A001/reopenReq'] === undefined, r11.okP);

  console.log('\n[12] auto-refresh poll (ไม่ต้องรีเฟรชหน้าเอง)');
  const r12 = await page.evaluate(() => {
    var has = typeof startRecheckPoll === 'function' && typeof stopRecheckPoll === 'function';
    state.rcLastLocalAt = 0;
    window.__realEnqueue('rounds/R1/rechecks', { 'A001/reopenReq': true });
    var stamped = state.rcLastLocalAt > 0;
    state.rcLastLocalAt = 0;
    window.__realEnqueue('rounds/R1/scans', { x: 1 });
    var noStampOther = state.rcLastLocalAt === 0;
    state.page = 'recheck'; state.roundId = 'R1';
    startRecheckPoll(); var started = !!state.rcPollTimer;
    stopRecheckPoll(); var stopped = !state.rcPollTimer;
    return { has: has, stamped: stamped, noStampOther: noStampOther, started: started, stopped: stopped };
  });
  check('startRecheckPoll/stopRecheckPoll มีจริง', r12.has, r12);
  check('enqueueWrite rechecks → stamp rcLastLocalAt (กัน poll ทับ local)', r12.stamped, r12);
  check('enqueueWrite path อื่น (scans) ไม่ stamp', r12.noStampOther, r12);
  check('startRecheckPoll ตั้ง timer · stopRecheckPoll เคลียร์', r12.started && r12.stopped, r12);

  console.log('\n[10] ไม่มี error');
  check('ไม่มี page error', errors.length === 0, errors.slice(0, 5));

  console.log('\n==== test-recheck: ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
