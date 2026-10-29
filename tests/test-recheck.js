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
      state.rechecks = {}; state.recheckDraft = {}; state.recheckView = 'admin'; state.rcAdminTab = null;   // v2.43.9 แท็บ admin จำค่าไว้ — reset ทุก seed กันค้างข้ามเทส
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

  // ---------- [T] v2.43.9 แท็บ admin รอเช็ค / รอใช้ยอด / ใช้ยอดแล้ว ----------
  // A001 = เด็กส่งคืนแล้ว ยังไม่ใช้ยอด (รอใช้ยอด) · B002 = ส่งแล้ว ยังไม่นับ (รอเช็ค)
  console.log('\n[T] แท็บ admin (v2.43.9)');
  const rT = await page.evaluate(() => {
    var seedTabs = function () {
      __seed('admin');
      state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', applied: false },
                         B002: { name: 'ชื่อ B002', sentAt: 1 } };
      window.__rcDb = state.rechecks;
    };
    var cards = function () {
      return Array.prototype.map.call(document.getElementById('recheckBody').querySelectorAll('.card[data-sku]'),
        function (c) { return c.getAttribute('data-sku'); });
    };
    seedTabs(); renderRecheckAdmin();
    var t1 = state.rcAdminTab;
    var c2 = cards(), b2 = __btns();
    seedTabs(); state.rcAdminTab = 'done'; renderRecheckAdmin();
    var t3 = state.rcAdminTab;
    return { t1: t1, c2: c2, b2: b2, t3: t3 };
  });
  check('[T1] ค่าเริ่ม (rcAdminTab=null) มีทั้งรอเช็ค+รอใช้ยอด → ลงแท็บ pending', rT.t1 === 'pending', rT.t1);
  check('[T2] แท็บ pending วาดการ์ดรอใช้ยอด (A001) + มีปุ่ม "ใช้ยอดรีเช็ค"',
    rT.c2.indexOf('A001') >= 0 && rT.b2.some(t => t.indexOf('ใช้ยอดรีเช็ค') >= 0), { cards: rT.c2, btns: rT.b2 });
  check('[T2] แท็บ pending ไม่วาดการ์ดรอเช็ค (B002) — แยกกลุ่มจริง', rT.c2.indexOf('B002') < 0, rT.c2);
  check('[T3] ตั้งแท็บ done แต่ว่าง → fallback ไป pending/notyet (ไม่ค้างจอโล่ง)',
    rT.t3 === 'pending' || rT.t3 === 'notyet', rT.t3);

  // ---------- [R] v2.43.10 ส่งรีเช็คใหม่อีกรอบ (ใช้ยอดแล้วแต่ยังต่าง) ----------
  // A001 ควรเหลือ 12 · qty=10 = ยังต่าง → มีปุ่ม · qty=12 = ตรง → ไม่มีปุ่ม
  console.log('\n[R] ส่งรีเช็คใหม่อีกรอบ (v2.43.10)');
  const rR = await page.evaluate(async () => {
    var hasResend = function () { return __btns().some(function (t) { return t.indexOf('ส่งรีเช็คใหม่อีกรอบ') >= 0; }); };
    __seed('admin');
    state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 10, by: 'เด็ก', at: 5, applied: true, assignTo: 'เด็ก1' } };
    state.rcAdminTab = 'done'; renderRecheckAdmin();
    var r1 = { tab: state.rcAdminTab, btn: hasResend(), btns: __btns() };
    __seed('admin');
    state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', at: 5, applied: true } };
    state.rcAdminTab = 'done'; renderRecheckAdmin();
    var r2 = { tab: state.rcAdminTab, btn: hasResend() };
    __seed('admin');
    state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 10, by: 'เด็ก', at: 5, applied: true,
                               reopenOk: true, reopenReq: true, assignTo: 'เด็ก1' } };
    __calls.enqueue = [];
    resendRecheck('A001');
    await new Promise(function (res) { setTimeout(res, 30); });   // ask() เป็น Promise
    var it = rcMap().A001 || {}, pt = (__calls.enqueue[0] || {}).patch || {};
    return { r1: r1, r2: r2,
      it: it, patch: pt, path: (__calls.enqueue[0] || {}).path };
  });
  check('[R1] ใช้ยอดแล้ว + ยังต่าง (10 vs 12) → แท็บ done มีปุ่ม "🔁 ส่งรีเช็คใหม่อีกรอบ"', rR.r1.tab === 'done' && rR.r1.btn, rR.r1);
  check('[R2] ใช้ยอดแล้ว + ตรง (12 vs 12) → ไม่มีปุ่มส่งรีเช็คใหม่', rR.r2.tab === 'done' && !rR.r2.btn, rR.r2);
  check('[R3] resendRecheck → state ไม่มี qty/applied/by/at/reopen แล้ว',
    rR.it.qty === undefined && rR.it.applied === undefined && rR.it.by === undefined && rR.it.at === undefined
      && rR.it.reopenOk === undefined && rR.it.reopenReq === undefined, rR.it);
  check('[R3] resendRecheck → sentAt ใหม่ (> เดิม)', rR.it.sentAt > 1, rR.it.sentAt);
  check('[R3] resendRecheck → คง assignTo คนเดิม (ไม่หลุดเป็นงานกลาง)', rR.it.assignTo === 'เด็ก1', rR.it);
  check('[R3] DB patch ล้างด้วย null (qty/applied/by/at/reopen) + ไม่แตะ assignTo',
    rR.path === 'rounds/R1/rechecks' && rR.patch['A001/qty'] === null && rR.patch['A001/applied'] === null
      && rR.patch['A001/by'] === null && rR.patch['A001/at'] === null && rR.patch['A001/reopenOk'] === null
      && rR.patch['A001/reopenReq'] === null && !('A001/assignTo' in rR.patch) && rR.patch['A001/sentAt'] > 1,
    { path: rR.path, patch: rR.patch });

  // ---------- [RO] v2.43.12 แท็บ "🙋 ขอแก้ไข" — เด็กขอแก้ยอด รออนุมัติ ----------
  // A001 = ส่งคืน+ใช้ยอดแล้ว แต่เด็กขอแก้ (reopenReq) · B002 = ส่งคืนแล้ว รอใช้ยอด
  console.log('\n[RO] แท็บขอแก้ไข (v2.43.12)');
  const rRO = await page.evaluate(() => {
    var cards = function () {
      return Array.prototype.map.call(document.getElementById('recheckBody').querySelectorAll('.card[data-sku]'),
        function (c) { return c.getAttribute('data-sku'); });
    };
    var hasTab = function () { return __btns().some(function (t) { return t.indexOf('🙋 ขอแก้ไข') >= 0; }); };
    var seedRO = function (a001) {
      __seed('admin');
      state.rechecks = { A001: Object.assign({ name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', at: 5, applied: true }, a001),
                         B002: { name: 'ชื่อ B002', sentAt: 1, qty: 11, by: 'เด็ก', at: 5, applied: false } };
      window.__rcDb = state.rechecks;
    };
    // วาดทุกแท็บ จดว่าแท็บจริงที่วาด (หลัง fallback) มีการ์ดอะไร
    var sweep = function (a001) {
      var out = {};
      ['reopen', 'notyet', 'pending', 'done'].forEach(function (t) {
        seedRO(a001); state.rcAdminTab = t; renderRecheckAdmin();
        out[t] = { tab: state.rcAdminTab, cards: cards() };
      });
      return out;
    };
    var o = {};
    o.s1 = sweep({ reopenReq: true });
    seedRO({ reopenReq: true }); renderRecheckAdmin(); o.tab1 = hasTab();
    seedRO({ reopenReq: true }); state.rcAdminTab = null; renderRecheckAdmin(); o.def2 = state.rcAdminTab;
    o.s3 = sweep({ reopenReq: true, reopenOk: true });
    seedRO({ reopenReq: true, reopenOk: true }); renderRecheckAdmin(); o.tab3 = hasTab();
    seedRO({}); state.rcAdminTab = null; renderRecheckAdmin(); o.def4 = state.rcAdminTab; o.tab4 = hasTab();
    o.s4 = sweep({});
    // v2.43.18 เด็กส่งยอดใหม่แล้ว → submitRecheck ล้าง flag (false) + applied=false → กลับรอใช้ยอด แท็บขอแก้ไขหาย
    o.s3b = sweep({ reopenReq: false, reopenOk: false, applied: false, qty: 13 });
    seedRO({ reopenReq: false, reopenOk: false, applied: false, qty: 13 }); renderRecheckAdmin(); o.tab3b = hasTab();
    // [RA1] มีแถว + qty + reopenOk (ไม่มี reopenReq) + ยังไม่ใช้ยอด → ขอแก้ไข ไม่ใช่รอใช้ยอด
    o.ra1 = sweep({ applied: false, reopenOk: true });
    // [RA2] stub ไม่มีแถว + reopenOk → ขอแก้ไข · stub นับคืนปกติ → รอใช้ยอด
    o.ra2 = {};
    ['reopen', 'notyet', 'pending', 'done'].forEach(function (t) {
      __seed('admin');
      state.rechecks = { Z888: { name: 'ของเกินเปิดแก้', sentAt: 1, qty: 26, by: 'เด็ก', at: 5, reopenOk: true },
                         Z777: { name: 'ของเกินส่งคืน', sentAt: 1, qty: 4, by: 'เด็ก', at: 5 } };
      window.__rcDb = state.rechecks; state.rcAdminTab = t; renderRecheckAdmin();
      o.ra2[t] = { tab: state.rcAdminTab, cards: cards() };
    });
    return o;
  });
  var inTabs = function (s, sku) { return Object.keys(s).filter(function (t) { return s[t].tab === t && s[t].cards.indexOf(sku) >= 0; }); };
  check('[RO1] reopenReq=true ไม่มี reopenOk → A001 อยู่แท็บ reopen เท่านั้น (ไม่อยู่ pending/done)',
    inTabs(rRO.s1, 'A001').join() === 'reopen', rRO.s1);
  check('[RO1] B002 (รอใช้ยอด) ไม่ถูกดึงเข้าแท็บ reopen', inTabs(rRO.s1, 'B002').join() === 'pending', rRO.s1);
  check('[RO1] มีคำขอ → แท็บ "🙋 ขอแก้ไข" โผล่', rRO.tab1, rRO.tab1);
  check('[RO2] มีคำขอ + rcAdminTab=null → default = reopen', rRO.def2 === 'reopen', rRO.def2);
  check('[RO3] อนุมัติแล้ว (reopenOk=true) → A001 ยังอยู่แท็บขอแก้ไข (รอเด็กส่งยอดใหม่) · ไม่อยู่ done',
    inTabs(rRO.s3, 'A001').join() === 'reopen', rRO.s3);
  check('[RO3] อนุมัติแล้ว → แท็บขอแก้ไขยังโผล่ (จนกว่าเด็กส่งใหม่)', rRO.tab3, rRO.tab3);
  check('[RO3] เด็กส่งใหม่ (submitRecheck ล้าง flag เป็น false) → กลับไปรอใช้ยอด · แท็บขอแก้ไขหาย',
    inTabs(rRO.s3b, 'A001').join() === 'pending' && !rRO.tab3b, { s3b: rRO.s3b, tab3b: rRO.tab3b });
  check('[RA1] มีแถว + qty + reopenOk + ยังไม่ใช้ยอด → แท็บขอแก้ไขเท่านั้น (ไม่อยู่รอใช้ยอด)',
    inTabs(rRO.ra1, 'A001').join() === 'reopen' && inTabs(rRO.ra1, 'B002').join() === 'pending', rRO.ra1);
  check('[RA2] stub ไม่มีแถว + reopenOk → แท็บขอแก้ไข · stub นับคืนปกติ → รอใช้ยอด',
    inTabs(rRO.ra2, 'Z888').join() === 'reopen' && inTabs(rRO.ra2, 'Z777').join() === 'pending', rRO.ra2);
  check('[RA3] ใช้ยอดแล้ว + เด็กขอแก้ (applied+reopenReq) → แท็บขอแก้ไข ไม่จมในใช้ยอดแล้ว',
    inTabs(rRO.s1, 'A001').join() === 'reopen' && !(rRO.s1.done.tab === 'done' && rRO.s1.done.cards.indexOf('A001') >= 0), rRO.s1);
  check('[RO4] ไม่มี reopenReq → ไม่มีแท็บขอแก้ไข · default ไม่ใช่ reopen · ตั้ง reopen ไว้ก็ fallback',
    !rRO.tab4 && rRO.def4 !== 'reopen' && rRO.s4.reopen.tab !== 'reopen' && inTabs(rRO.s4, 'A001').join() === 'done',
    { tab4: rRO.tab4, def4: rRO.def4, s4: rRO.s4 });

  // ---------- [RO5] v2.43.13 ขอแก้ไขของ SKU ที่ "ไม่มีแถวสรุป" (ของเกิน/ไม่อยู่ระบบสาขานี้) ----------
  // Z999 ไม่อยู่ products/systemQty/counts → ไม่มีใน summaryData().rows · มีแค่ใน rc (เด็กนับคืน 26 แล้วขอแก้)
  console.log('\n[RO5] ขอแก้ไข SKU ที่ไม่มีแถวสรุป (v2.43.13)');
  const rRO5 = await page.evaluate(() => {
    var errs = [];
    __seed('admin');
    state.rechecks = { Z999: { name: 'ของเกินระบบ', sentAt: 1, qty: 26, by: 'เด็ก', at: 5, reopenReq: true },
                       A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', at: 5, applied: true, reopenReq: true } };
    window.__rcDb = state.rechecks;
    var noRow = !summaryData().rows.some(function (r) { return r.key === 'Z999'; });
    state.rcAdminTab = null;
    try { renderRecheckAdmin(); } catch (e) { errs.push(String(e && e.message || e)); }
    var cards = Array.prototype.map.call(document.getElementById('recheckBody').querySelectorAll('.card[data-sku]'),
      function (c) { return c.getAttribute('data-sku'); });
    var zc = document.getElementById('recheckBody').querySelector('.card[data-sku="Z999"]');
    var zt = zc ? zc.textContent : '';
    return { noRow: noRow, tab: state.rcAdminTab, errs: errs, cards: cards,
             zOk: !!zc && Array.prototype.some.call(zc.querySelectorAll('div'), function (d) { return !d.children.length && d.textContent === 'Z999'; }) && zt.indexOf('ของเกินระบบ') >= 0 && zt.indexOf('เกิน 26') >= 0 && zt.indexOf('ควรเหลือ (ระบบ) 0 · ยิงจริง 26 · ผลต่าง +26') >= 0 && !/undefined|NaN/.test(zt), zt: zt.slice(0, 240),
             hasTab: __btns().some(function (t) { return t.indexOf('🙋 ขอแก้ไข') >= 0; }),
             text: __bodyText().indexOf('ขอแก้ไขยอด — รออนุมัติ (2 SKU)') >= 0 };
  });
  check('[RO5] เตรียม: Z999 ไม่มีแถวใน summaryData().rows', rRO5.noRow, rRO5);
  check('[RO5a] Z999 (ไม่มีแถวสรุป) เข้าแท็บ reopen · แท็บ "🙋 ขอแก้ไข" โผล่ · เปิดมาที่แท็บนี้',
    rRO5.hasTab && rRO5.tab === 'reopen' && rRO5.cards.indexOf('Z999') >= 0, rRO5);
  check('[RO5b] การ์ด stub วาดได้ไม่ error', rRO5.errs.length === 0, rRO5.errs);
  check('[RO5b] การ์ด stub โชว์รหัส+ชื่อ+เกิน 26+ควรเหลือ 0 ไม่มี undefined/NaN (stub มีฟิลด์ครบ)', rRO5.zOk, rRO5.zt);
  check('[RO5c] A001 (มีแถวสรุป) ก็เข้าด้วย · ไม่ซ้ำ (การ์ดละ 1 ใบ · หัวข้อ 2 SKU)',
    rRO5.cards.filter(function (k) { return k === 'A001'; }).length === 1
      && rRO5.cards.filter(function (k) { return k === 'Z999'; }).length === 1 && rRO5.text, rRO5);

  // ---------- [OV] v2.43.14 ของเจอจริง แต่ยอดระบบ 0 / ไม่มีแถวสรุป (แถวผี 0/0 ถูกตัด) ----------
  // Z999 = ไม่อยู่ Master/ไฟล์ยอด · Y888 = อยู่ Master ยอดระบบ 0 ไม่มียอดยิง → ทั้งคู่ไม่มีแถว
  console.log('\n[OV] ใช้ยอดรีเช็คของที่ไม่มีแถวสรุป (v2.43.14)');
  const rOV = await page.evaluate(() => {
    var orig = db.update, upd = [];
    db.update = function (path, patch) { upd.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) }); return Promise.resolve(); };
    var cards = function () {
      return Array.prototype.map.call(document.getElementById('recheckBody').querySelectorAll('.card[data-sku]'),
        function (c) { return c.getAttribute('data-sku'); });
    };
    var rowOf = function (k) { return summaryData().rows.filter(function (r) { return r.key === k; })[0] || null; };
    /* writeScan ถูก stub ไว้ → จำลองยอดยิงลง counts ตาม delta ที่สั่งเขียน */
    var landScans = function () { __calls.scan.forEach(function (s) { state.counts[s.k] = (Number(state.counts[s.k]) || 0) + s.d; state.scanQty[s.k] = state.counts[s.k]; }); };
    var seedOV = function (rc) {
      __seed('admin'); state.adjust = {};
      state.products.Y888 = { code: 'Y888', name: 'ชื่อ Y888', category: 'ห', type: 'product', costPrice: 10, sellPrice: 10 };
      state.systemQty.Y888 = 0; state.systemQtyRaw.Y888 = 0;
      state.rechecks = rc; window.__rcDb = rc;
    };
    var o = {};
    try {
      // OV1 ไม่มีแถว + เด็กนับ 26 (ยังไม่ใช้ยอด ไม่ขอแก้) → รอใช้ยอด
      seedOV({ Z999: { name: 'ของเกินระบบ', sentAt: 1, qty: 26, by: 'เด็ก', at: 5 } });
      o.pre = { z: rowOf('Z999'), y: rowOf('Y888') };
      state.rcAdminTab = 'pending'; renderRecheckAdmin();
      o.ov1 = { tab: state.rcAdminTab, cards: cards(),
                pendBtn: __btns().some(function (t) { return t.indexOf('📥 รอใช้ยอด') >= 0; }) };
      // OV2 applyRecheck → writeScan +26 (cur=0) → มีแถว act=26 · ล็อก adjust 26
      __calls.scan = []; __calls.toast = []; upd = [];
      applyRecheck('Z999');
      o.ov2 = { scan: __calls.scan.slice(), toast: __calls.toast.slice(), applied: rcMap().Z999.applied,
                adj: state.adjust.Z999 || null };
      landScans();
      var zr = rowOf('Z999'); o.ov2.row = zr ? { act: zr.act, sys: zr.sys, diff: zr.diff } : null;
      // OV3 bulk: Z999 (ไม่อยู่ระบบ) + Y888 (ระบบ 0) + A001 (มีแถว act 9) → ยอด = qty ทุกตัว
      seedOV({ Z999: { name: 'ของเกินระบบ', sentAt: 1, qty: 26, by: 'เด็ก', at: 5 },
               Y888: { name: 'ชื่อ Y888', sentAt: 1, qty: 5, by: 'เด็ก', at: 5 },
               A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', at: 5 } });
      __calls.scan = []; upd = [];
      applyRecheckBulk(['Z999', 'Y888', 'A001']);
      var sc = {}; __calls.scan.forEach(function (s) { sc[s.k] = s.d; });
      landScans();
      o.ov3 = { scan: sc, applied: ['Z999', 'Y888', 'A001'].map(function (k) { return rcMap()[k].applied === true; }),
                act: ['Z999', 'Y888', 'A001'].map(function (k) { var r = rowOf(k); return r ? r.act : null; }),
                adj: ['Z999', 'Y888', 'A001'].map(function (k) { var a = state.adjust[k] || {}; return a.src + ':' + a.val; }) };
      // OV4 แยกกลุ่ม stub ตามสถานะ · ยังไม่นับ+ไม่ขอแก้ = ซ่อน
      var rc4 = { K1: { name: 'k1', sentAt: 1, qty: 3, by: 'เด็ก', at: 5 },
                  K2: { name: 'k2', sentAt: 1, qty: 4, by: 'เด็ก', at: 5, applied: true },
                  K3: { name: 'k3', sentAt: 1, qty: 6, by: 'เด็ก', at: 5, reopenReq: true },
                  K4: { name: 'k4', sentAt: 1 } };
      var sweep = {};
      ['reopen', 'notyet', 'pending', 'done'].forEach(function (t) {
        seedOV(JSON.parse(JSON.stringify(rc4))); state.rcAdminTab = t; renderRecheckAdmin();
        sweep[t] = { tab: state.rcAdminTab, cards: cards() };
      });
      o.ov4 = sweep;
    } finally { db.update = orig; state.adjust = {}; }
    return o;
  });
  var tabsOf = function (s, sku) { return Object.keys(s).filter(function (t) { return s[t].tab === t && s[t].cards.indexOf(sku) >= 0; }); };
  check('[OV] เตรียม: Z999 (ไม่อยู่ระบบ) + Y888 (ระบบ 0 ไม่มียอด) ไม่มีแถวสรุป', rOV.pre.z === null && rOV.pre.y === null, rOV.pre);
  check('[OV1] ไม่มีแถว + เด็กนับ 26 → อยู่แท็บรอใช้ยอด (pending) · แท็บ "📥 รอใช้ยอด" โผล่',
    rOV.ov1.tab === 'pending' && rOV.ov1.cards.indexOf('Z999') >= 0 && rOV.ov1.pendBtn, rOV.ov1);
  check('[OV2] applyRecheck ไม่มีแถว → ไม่เด้ง "ไม่พบ SKU" · writeScan +26 (cur=0) mode manual',
    rOV.ov2.scan.length === 1 && rOV.ov2.scan[0].k === 'Z999' && rOV.ov2.scan[0].d === 26 && rOV.ov2.scan[0].m === 'manual'
      && !rOV.ov2.toast.some(function (t) { return t.bad; }) && rOV.ov2.applied === true, rOV.ov2);
  check('[OV2] เหตุผลในแถว scan บอกว่าเดิมไม่มีในรอบ', /เดิม ไม่มีในรอบ/.test((rOV.ov2.scan[0] || {}).r || ''), rOV.ov2.scan);
  check('[OV2] หลังใช้ยอด → มีแถวสรุป act=26 (เกิน +26) · ล็อก adjust src=recheck val=26',
    !!rOV.ov2.row && rOV.ov2.row.act === 26 && rOV.ov2.row.diff === 26 && rOV.ov2.adj && rOV.ov2.adj.src === 'recheck' && rOV.ov2.adj.val === 26, rOV.ov2);
  check('[OV3] applyRecheckBulk รวมตัวไม่มีแถว → delta Z999 +26 · Y888 +5 (base 0) · A001 +3 (12-9)',
    rOV.ov3.scan.Z999 === 26 && rOV.ov3.scan.Y888 === 5 && rOV.ov3.scan.A001 === 3, rOV.ov3);
  check('[OV3] ทุกตัว applied · ยอดหลังใช้ = qty (26/5/12) · ล็อก recheck ครบ',
    rOV.ov3.applied.every(Boolean) && rOV.ov3.act.join() === '26,5,12' && rOV.ov3.adj.join() === 'recheck:26,recheck:5,recheck:12', rOV.ov3);
  check('[OV4] stub นับแล้วยังไม่ใช้ → pending', tabsOf(rOV.ov4, 'K1').join() === 'pending', rOV.ov4);
  check('[OV4] stub ใช้ยอดแล้ว → done', tabsOf(rOV.ov4, 'K2').join() === 'done', rOV.ov4);
  check('[OV4] stub ขอแก้ → reopen', tabsOf(rOV.ov4, 'K3').join() === 'reopen', rOV.ov4);
  check('[OV4] stub ยังไม่นับ + ไม่ขอแก้ → ไม่ถูกดึง (ขยะหลุดรอบคงซ่อน)', tabsOf(rOV.ov4, 'K4').length === 0
    && !Object.keys(rOV.ov4).some(function (t) { return rOV.ov4[t].cards.indexOf('K4') >= 0; }), rOV.ov4);

  // ---------- [OK] v2.43.15 ส่งรีเช็คแล้วแต่ยอดกลับมาตรง (diff=0) เด็กยังไม่นับ → แยกออกจาก "รอเช็ค" + เคลียร์รวดเดียว ----------
  // A001 diff -3 (ยังต่าง) · C003 diff 0 (ตรงแล้ว) — ทั้งคู่ส่งรีเช็คแล้ว เด็กยังไม่นับ
  console.log('\n[OK] ตัวกลับมาตรง (v2.43.15)');
  const rOK = await page.evaluate(async () => {
    var cards = function () {
      return Array.prototype.map.call(document.getElementById('recheckBody').querySelectorAll('.card[data-sku]'),
        function (c) { return c.getAttribute('data-sku'); });
    };
    var okBtnText = function () { return __btns().filter(function (t) { return t.indexOf('ตัวที่กลับมาตรงแล้ว') >= 0; })[0] || null; };
    var seedOK = function () {
      __seed('admin'); state.adjust = {};
      state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1 }, C003: { name: 'ชื่อ C003', sentAt: 1 },
                         B002: { name: 'ชื่อ B002', sentAt: 1, qty: 8, by: 'เด็ก', at: 5 } };
      window.__rcDb = state.rechecks;
    };
    var o = {};
    seedOK(); state.rcAdminTab = 'notyet'; renderRecheckAdmin();
    o.ok1 = { tab: state.rcAdminTab, cards: cards(), btn: okBtnText(),
              notyetBtn: __btns().filter(function (t) { return t.indexOf('⏳ รอเช็ค') >= 0; })[0] || null };
    var sweep = {};
    ['notyet', 'pending', 'done'].forEach(function (t) {
      seedOK(); state.rcAdminTab = t; renderRecheckAdmin(); sweep[t] = { tab: state.rcAdminTab, cards: cards() };
    });
    o.sweep = sweep;
    // OK3 clearRecheckBulk — C003 มีล็อก adjust ค้าง (จำลอง) ต้องถูกปลด · ยอดนับไม่ถูกแตะ
    seedOK();
    state.adjust = { C003: { val: 5, src: 'recheck' }, A001: { val: 7, reason: 'ขายหลังนับ' } };
    var orig = db.update, upd = [];
    db.update = function (path, patch) { upd.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) }); return Promise.resolve(); };
    var countsBefore = JSON.stringify(state.counts);
    __calls.enqueue = []; __calls.scan = [];
    try {
      clearRecheckBulk(['C003']);
      await new Promise(function (res) { setTimeout(res, 30); });
    } finally { db.update = orig; }
    o.ok3 = { enq: __calls.enqueue.slice(), upd: upd, rcKeys: Object.keys(rcMap()).sort(),
              adjC: 'C003' in state.adjust, adjA: !!state.adjust.A001, scan: __calls.scan.length,
              countsSame: JSON.stringify(state.counts) === countsBefore };
    state.adjust = {};
    return o;
  });
  var tabsOK = function (s, sku) { return Object.keys(s).filter(function (t) { return s[t].tab === t && s[t].cards.indexOf(sku) >= 0; }); };
  check('[OK1] ส่งแล้ว + diff≠0 + ยังไม่นับ (A001) → อยู่แท็บรอเช็ค · นับในป้าย "รอเช็ค"',
    tabsOK(rOK.sweep, 'A001').join() === 'notyet' && /⏳ รอเช็ค.*1/.test(rOK.ok1.notyetBtn || ''), rOK.ok1);
  check('[OK2] ส่งแล้ว + diff=0 + ยังไม่นับ (C003) → ไม่อยู่แท็บไหน (ไม่นับเป็นงานรอเช็ค)',
    tabsOK(rOK.sweep, 'C003').length === 0, rOK.sweep);
  check('[OK2] ปุ่ม "✅ เคลียร์ 1 ตัวที่กลับมาตรงแล้ว" โผล่', /เคลียร์ 1 ตัวที่กลับมาตรงแล้ว/.test(rOK.ok1.btn || ''), rOK.ok1.btn);
  check('[OK2] ตัวที่เด็กนับคืนแล้ว (B002 qty=8 ตรง) ยังอยู่รอใช้ยอด ไม่หลุดไปกลุ่มตรงแล้ว',
    tabsOK(rOK.sweep, 'B002').join() === 'pending', rOK.sweep);
  var okEnq = function (path) { var e = rOK.ok3.enq.filter(function (x) { return x.path === path; })[0]; return e ? e.patch : null; };
  check('[OK3] clearRecheckBulk → rounds/R1/rechecks {C003:null} + recheckPhotos/R1 {C003:null}',
    !!okEnq('rounds/R1/rechecks') && okEnq('rounds/R1/rechecks').C003 === null && Object.keys(okEnq('rounds/R1/rechecks')).join() === 'C003'
      && !!okEnq('recheckPhotos/R1') && okEnq('recheckPhotos/R1').C003 === null, rOK.ok3.enq);
  check('[OK3] ลบออกจาก rcMap local (เหลือ A001,B002)', rOK.ok3.rcKeys.join() === 'A001,B002', rOK.ok3.rcKeys);
  check('[OK3] ปลดล็อก adjust src=recheck ของ C003 (ฐาน {C003:null}) · ไม่แตะ adjust ขายหลังนับของ A001',
    !rOK.ok3.adjC && rOK.ok3.adjA && rOK.ok3.upd.length === 1 && rOK.ok3.upd[0].patch.C003 === null, rOK.ok3);
  check('[OK3] ไม่แตะยอดนับ (ไม่มี writeScan · counts เท่าเดิม)', rOK.ok3.scan === 0 && rOK.ok3.countsSame, rOK.ok3);

  // ---------- [OK4] เด็กส่งยอดเข้ามา "ระหว่างกล่องยืนยันเปิด" → ตัวนั้นต้องไม่ถูกลบ ----------
  // C003 + D004 = diff 0 ส่งรีเช็คแล้ว ยังไม่นับ · ระหว่างรอยืนยัน poll ดึงยอดที่เด็กส่งคืนของ C003 มา
  const rOK4 = await page.evaluate(async () => {
    var origAsk = window.ask, resolveAsk;
    var seed4 = function () {
      __seed('admin'); state.adjust = {};
      state.products.D004 = { code: 'D004', name: 'ชื่อ D004', category: 'ห', type: 'product', costPrice: 10, sellPrice: 10 };
      state.systemQty.D004 = 4; state.systemQtyRaw.D004 = 4; state.counts.D004 = 4; state.scanQty.D004 = 4;
      state.rechecks = { C003: { name: 'ชื่อ C003', sentAt: 1 }, D004: { name: 'ชื่อ D004', sentAt: 1 } };
      window.__rcDb = state.rechecks;
    };
    var run = async function (touch) {
      window.ask = function () { return new Promise(function (r) { resolveAsk = r; }); };
      __calls.enqueue = []; __calls.toast = [];
      clearRecheckBulk(['C003', 'D004']);           // กล่องยืนยันเปิดค้าง
      touch();                                       // ระหว่างนั้นเด็กแตะข้อมูล
      resolveAsk(true); await new Promise(function (res) { setTimeout(res, 30); });
      var rc = (__calls.enqueue.filter(function (x) { return x.path === 'rounds/R1/rechecks'; })[0] || {}).patch || null;
      var ph = (__calls.enqueue.filter(function (x) { return x.path === 'recheckPhotos/R1'; })[0] || {}).patch || null;
      return { rc: rc, ph: ph, keys: Object.keys(rcMap()).sort(), c003: rcMap().C003 || null,
               toastBad: __calls.toast.some(function (t) { return t.bad; }) };
    };
    var o = {};
    try {
      seed4();
      o.a = await run(function () { rcMap().C003.qty = 5; rcMap().C003.by = 'เด็ก'; rcMap().C003.at = 9; });
      seed4();
      o.b = await run(function () { rcMap().C003.qty = 5; rcMap().D004.reopenReq = true; });
      seed4();
      o.c = await run(function () { state.counts.D004 = 6; state.scanQty.D004 = 6; rcMap().C003.qty = 5; });   // D004 ยอดเปลี่ยน diff≠0
    } finally { window.ask = origAsk; }
    return o;
  });
  check('[OK4] C003 ที่เด็กส่งคืนระหว่างรอยืนยัน → ไม่มี {C003:null} ทั้ง rechecks และรูป · ยอด qty=5 ยังอยู่',
    !!rOK4.a.rc && !('C003' in rOK4.a.rc) && !!rOK4.a.ph && !('C003' in rOK4.a.ph) && rOK4.a.c003 && rOK4.a.c003.qty === 5, rOK4.a);
  check('[OK4] D004 (ยัง diff 0 + ยังไม่นับ) ยังถูกเคลียร์ได้', rOK4.a.rc && rOK4.a.rc.D004 === null && rOK4.a.ph.D004 === null
    && rOK4.a.keys.join() === 'C003', rOK4.a);
  check('[OK4] ทุกตัวโดนแตะ (ส่งยอด/ขอแก้) → ไม่เขียน {k:null} เลย + toast แจ้ง', rOK4.b.rc === null && rOK4.b.ph === null
    && rOK4.b.toastBad && rOK4.b.keys.join() === 'C003,D004', rOK4.b);
  check('[OK4] ยอดเปลี่ยนจน diff≠0 ระหว่างรอยืนยัน → ไม่ถูกเคลียร์', rOK4.c.rc === null && rOK4.c.keys.indexOf('D004') >= 0, rOK4.c);

  // ---------- [SC] v2.43.16 ฝั่งเด็กเห็นของเกิน/หลุดรอบที่ยังมีงานค้าง (renderRecheckScanner) ----------
  // stray = ไม่อยู่ systemQtyRaw + ไม่อยู่ counts (ยอดระบบรอบนี้โหลดครบแล้ว → rcStrayMap ทำงาน)
  console.log('\n[SC] เด็กเห็นของเกินที่ยังมีงานค้าง (v2.43.16)');
  const rSC = await page.evaluate(() => {
    __seed('scanner'); state.sysLoadedFor = 'C1';
    state.rechecks = {
      XQTYA: { name: 'นับแล้ว', sentAt: 1, qty: 26, by: 'หนึ่ง', at: 5 },
      XROKB: { name: 'เปิดให้แก้', sentAt: 1, reopenOk: true },   // ไม่มี qty → คุมเงื่อนไข reopenOk ตรง ๆ
      XRRQC: { name: 'ขอแก้', sentAt: 1, reopenReq: true },        // ไม่มี qty → คุมเงื่อนไข reopenReq ตรง ๆ
      XDRFD: { name: 'มีร่าง', sentAt: 1 },
      XJNKE: { name: 'ขยะหลุดรอบ', sentAt: 1 },
      A001: { name: 'ชื่อ A001', sentAt: 1 } };
    window.__rcDb = state.rechecks;
    state.recheckDraft = { XDRFD: { qty: '2' } };
    var stray = rcStrayMap();
    /* ตัวที่ส่งคืนแล้วอยู่ตัวกรอง "ส่งคืนแล้ว" (done) · ที่เหลืออยู่ "ต้องรีเช็ค" → วาดทั้งสองแล้วรวมกัน */
    state.rcScanScope = 'all';
    state.rcScanFilter = 'pending'; renderRecheckScanner(false); var t = __bodyText();
    state.rcScanFilter = 'done'; renderRecheckScanner(false); t += '\n' + __bodyText();
    var seen = {}; ['XQTYA', 'XROKB', 'XRRQC', 'XDRFD', 'XJNKE', 'A001'].forEach(function (k) { seen[k] = t.indexOf(k) >= 0; });
    state.recheckDraft = {}; state.sysLoadedFor = null; state.rcScanFilter = null; state.rcScanScope = null;
    return { stray: Object.keys(stray).sort(), seen: seen };
  });
  check('[SC] เตรียม: X* เป็น stray ทั้ง 5 ตัว · A001 ไม่ใช่', rSC.stray.join() === 'XDRFD,XJNKE,XQTYA,XROKB,XRRQC', rSC.stray);
  check('[SC1] stray + เด็กนับแล้ว (qty) → เด็กเห็น', rSC.seen.XQTYA, rSC.seen);
  check('[SC2] stray + reopenOk → เด็กเห็น', rSC.seen.XROKB, rSC.seen);
  check('[SC2] stray + reopenReq → เด็กเห็น', rSC.seen.XRRQC, rSC.seen);
  check('[SC2] stray + มีร่างกำลังกรอก → เด็กเห็น', rSC.seen.XDRFD, rSC.seen);
  check('[SC3] stray + qty=null + ไม่มีร่าง/คำขอ → ซ่อน (ขยะหลุดรอบ v2.41.6)', !rSC.seen.XJNKE, rSC.seen);
  check('[SC4] ไม่ stray (A001) → เห็นปกติ', rSC.seen.A001, rSC.seen);

  // ---------- [RP] v2.43.17 เปิดให้แก้ (reopenOk) = งานค้าง "ต้องรีเช็ค" ฝั่งเด็ก ----------
  console.log('\n[RP] reopenOk กลับมาเป็นงานค้าง (v2.43.17)');
  const rRP = await page.evaluate(() => {
    var stats = function () {
      var s = document.getElementById('recheckBody').querySelector('.stats');
      return s ? Array.prototype.map.call(s.children, function (c) { return c.firstChild.textContent; }) : null;
    };
    var segN = function (label) {
      var t = __btns().filter(function (x) { return x.indexOf(label) >= 0; })[0] || '';
      var m = t.match(/\((\d+)\)/); return m ? Number(m[1]) : null;
    };
    var view = function (filter) {
      state.rcScanFilter = filter; renderRecheckScanner(false);
      return { text: __bodyText(), stats: stats(), mine: segN('งานฉัน'), mid: segN('งานกลาง'), all: segN('ทั้งหมด') };
    };
    var o = {};
    // RP1 งานของฉัน: RPXA นับคืนแล้ว + reopenOk · RPXB นับคืนแล้วปกติ
    __seed('scanner'); state.rcScanScope = 'mine';
    state.rechecks = { RPXA: { name: 'เปิดให้แก้', sentAt: 1, qty: 5, by: 'หนึ่ง', at: 5, reopenOk: true, assignTo: 'หนึ่ง' },
                       RPXB: { name: 'ส่งคืนปกติ', sentAt: 1, qty: 6, by: 'หนึ่ง', at: 5, assignTo: 'หนึ่ง' } };
    window.__rcDb = state.rechecks;
    o.p1 = view('pending'); o.d1 = view('done');
    // RP2 งานกลาง (ไม่มี assignTo) + reopenOk
    __seed('scanner'); state.rcScanScope = 'mine';
    state.rechecks = { RPXM: { name: 'งานกลางเปิดแก้', sentAt: 1, qty: 26, by: 'เด็ก', at: 5, reopenOk: true },
                       RPXN: { name: 'งานกลางส่งแล้ว', sentAt: 1, qty: 3, by: 'เด็ก', at: 5 } };
    window.__rcDb = state.rechecks;
    o.p2 = view('pending'); o.scope2 = state.rcScanScope;
    // allowReopen ไม่เขียน assignTo
    __seed('admin');
    state.rechecks = { RPXM: { name: 'งานกลางเปิดแก้', sentAt: 1, qty: 26, by: 'เด็ก', at: 5, reopenReq: true } };
    __calls.enqueue = []; allowReopen('RPXM');
    o.allow = { patch: (__calls.enqueue[0] || {}).patch || null, it: rcMap().RPXM };
    state.rcScanFilter = null; state.rcScanScope = null;
    return o;
  });
  check('[RP1] นับคืนแล้ว + reopenOk → อยู่ "ต้องรีเช็ค" · stat ต้องรีเช็ค 1 / ส่งคืนแล้ว 1',
    rRP.p1.text.indexOf('RPXA') >= 0 && rRP.p1.text.indexOf('RPXB') < 0 && rRP.p1.stats && rRP.p1.stats.join() === '1,1', rRP.p1);
  check('[RP1] นับคืนแล้วไม่มี reopenOk (RPXB) ยังอยู่ "ส่งคืนแล้ว" · RPXA ไม่อยู่ในนั้น',
    rRP.d1.text.indexOf('RPXB') >= 0 && rRP.d1.text.indexOf('RPXA') < 0, rRP.d1);
  check('[RP1] ปุ่ม "งานฉัน" นับ reopenOk (1)', rRP.p1.mine === 1, rRP.p1);
  check('[RP2] งานกลาง + reopenOk → seg งานกลาง 1 · ทั้งหมด 1 (ไม่หายทุก scope)', rRP.p2.mid === 1 && rRP.p2.all === 1, rRP.p2);
  check('[RP2] การ์ด RPXM อยู่ "ต้องรีเช็ค" · stat ต้องรีเช็ค 1', rRP.p2.text.indexOf('RPXM') >= 0 && rRP.p2.stats && rRP.p2.stats[0] === '1', rRP.p2);
  check('[RP2] allowReopen เขียนแค่ reopenOk ไม่เขียน assignTo · งานกลางยังไม่มีเจ้าของ',
    !!rRP.allow.patch && Object.keys(rRP.allow.patch).join() === 'RPXM/reopenOk' && rRP.allow.it.reopenOk === true && !rRP.allow.it.assignTo, rRP.allow);

  // ---------- [L] v2.43.11 ใช้ยอดรีเช็ค = ล็อกยอดเป็น adjust (src=recheck) ----------
  // A001 ควรเหลือ 12 · เด็กนับ 9 · รีเช็คได้ 24 → ae ต้องยึด 24 แม้ยอดดิบเปลี่ยนทีหลัง
  console.log('\n[L] ล็อกยอดรีเช็คผ่าน adjust (v2.43.11)');
  const rL = await page.evaluate(async () => {
    var orig = db.update, upd = [];
    db.update = function (path, patch) { upd.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) }); return Promise.resolve(); };
    var aeOf = function (k) { var rows = summaryData().rows; for (var i = 0; i < rows.length; i++) if (rows[i].key === k) return rows[i].act; return null; };
    var adjUpd = function () { return upd.filter(function (u) { return u.path === 'cycles/C1/adjust'; }); };
    var out = {};
    try {
      // L1 apply qty=24
      __seed('admin'); state.adjust = {};
      state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 24, by: 'เด็ก', at: 5 } };
      upd = []; applyRecheck('A001');
      var a = state.adjust.A001 || {};
      out.l1 = { val: a.val, src: a.src, ae: aeOf('A001'), upd: adjUpd() };
      // L2 ยอดดิบเปลี่ยนเป็น 99 หลัง apply → ae ยังเป็น 24
      state.counts.A001 = 99; state.scanQty.A001 = 99;
      out.l2 = { ae: aeOf('A001') };
      // L3 resend → ปลดล็อก · apply ใหม่ได้ค่าใหม่
      upd = []; resendRecheck('A001');
      await new Promise(function (res) { setTimeout(res, 30); });
      out.l3a = { has: 'A001' in state.adjust, ae: aeOf('A001'), upd: adjUpd() };
      rcMap().A001.qty = 30; rcMap().A001.by = 'เด็ก'; rcMap().A001.at = 9;
      upd = []; applyRecheck('A001');
      out.l3b = { val: (state.adjust.A001 || {}).val, src: (state.adjust.A001 || {}).src, ae: aeOf('A001') };
      // L4 การ์ดรีเช็ค + หน้าสรุป: src=recheck ไม่ขึ้นกล่องม่วง · adjust ธรรมดายังขึ้น
      var rowOf = function (k) { return summaryData().rows.filter(function (r) { return r.key === k; })[0]; };
      __seed('admin');
      state.adjust = { A001: { val: 12, reason: 'ใช้ยอดรีเช็ค', by: 'หนึ่ง', at: 1, raw: 12, src: 'recheck' } };
      state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', at: 5, applied: true } };
      state.rcAdminTab = 'done'; renderRecheckAdmin();
      var recCard = __bodyText().indexOf('ปรับยิงจริงเป็น') >= 0;
      var recSum = !!sumCardRow(rowOf('A001'), 'short', 'product').querySelector('.adjust-badge');
      __seed('admin');
      state.adjust = { A001: { val: 7, reason: 'ขายหลังนับ', by: 'หนึ่ง', at: 1, raw: 9 } };
      state.rechecks = {}; state.rcAdminTab = null; renderRecheckAdmin();
      var manCard = __bodyText().indexOf('ปรับยิงจริงเป็น') >= 0;
      var manSum = !!sumCardRow(rowOf('A001'), 'short', 'product').querySelector('.adjust-badge');
      out.l4 = { recCard: recCard, recSum: recSum, manCard: manCard, manSum: manSum };
      // L5 applyRecheckBulk หลาย SKU → adjust ก้อนเดียว ทุกตัว src=recheck
      __seed('admin'); state.adjust = {};
      state.rechecks = { A001: { name: 'ชื่อ A001', sentAt: 1, qty: 12, by: 'เด็ก', at: 5 },
                         B002: { name: 'ชื่อ B002', sentAt: 1, qty: 8, by: 'เด็ก', at: 5 } };
      upd = []; applyRecheckBulk(['A001', 'B002']);
      out.l5 = { upd: adjUpd(), a: state.adjust.A001, b: state.adjust.B002, aeA: aeOf('A001'), aeB: aeOf('B002') };
    } finally { db.update = orig; state.adjust = {}; }
    return out;
  });
  check('[L1] applyRecheck qty=24 → state.adjust.A001 = {val:24, src:recheck}', rL.l1.val === 24 && rL.l1.src === 'recheck', rL.l1);
  check('[L1] summaryData ae (r.act) = 24', rL.l1.ae === 24, rL.l1.ae);
  check('[L1] เขียน cycles/C1/adjust {A001:{val:24,src:recheck}} ครั้งเดียว',
    rL.l1.upd.length === 1 && rL.l1.upd[0].patch.A001.val === 24 && rL.l1.upd[0].patch.A001.src === 'recheck', rL.l1.upd);
  check('[L2] ยอดดิบเปลี่ยนเป็น 99 หลัง apply → ae ยังยึด 24 (ไม่ถูกทับ)', rL.l2.ae === 24, rL.l2);
  check('[L3] resendRecheck → ปลดล็อก (state.adjust.A001 หาย · ae กลับเป็นยอดดิบ 99)', !rL.l3a.has && rL.l3a.ae === 99, rL.l3a);
  check('[L3] resendRecheck → ฐานล้าง adjust ด้วย {A001:null}',
    rL.l3a.upd.length === 1 && rL.l3a.upd[0].patch.A001 === null, rL.l3a.upd);
  check('[L3] applyRecheck รอบใหม่ qty=30 → ล็อกค่าใหม่ 30 · ae = 30',
    rL.l3b.val === 30 && rL.l3b.src === 'recheck' && rL.l3b.ae === 30, rL.l3b);
  check('[L4] adjust src=recheck → การ์ดรีเช็คไม่ขึ้นกล่องม่วง "ปรับยิงจริง"', !rL.l4.recCard, rL.l4);
  check('[L4] adjust src=recheck → หน้าสรุปไม่ขึ้น .adjust-badge', !rL.l4.recSum, rL.l4);
  check('[L4] adjust ธรรมดา (ขายหลังนับ) → การ์ดรีเช็คยังขึ้นกล่องม่วง (regression)', rL.l4.manCard, rL.l4);
  check('[L4] adjust ธรรมดา (ขายหลังนับ) → หน้าสรุปยังขึ้น .adjust-badge (regression)', rL.l4.manSum, rL.l4);
  check('[L5] applyRecheckBulk 2 SKU → เขียน cycles/C1/adjust ก้อนเดียวมีทั้ง A001+B002',
    rL.l5.upd.length === 1 && Object.keys(rL.l5.upd[0].patch).sort().join() === 'A001,B002', rL.l5.upd);
  check('[L5] ทุกตัว src=recheck · val ตรงยอดรีเช็ค · ae ตาม',
    rL.l5.a && rL.l5.a.src === 'recheck' && rL.l5.a.val === 12 && rL.l5.b && rL.l5.b.src === 'recheck' && rL.l5.b.val === 8
      && rL.l5.aeA === 12 && rL.l5.aeB === 8, rL.l5);

  console.log('\n[10] ไม่มี error');
  check('ไม่มี page error', errors.length === 0, errors.slice(0, 5));

  console.log('\n==== test-recheck: ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
