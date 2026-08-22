/* ============================================================
   v2.7.7 — คิวเขียนต้องไม่ค้างเพราะแถวเดียวที่ส่งไม่ผ่านถาวร
   ============================================================

   บั๊กเดิม: flushQueue() shift คิวเฉพาะตอนสำเร็จ
     }).catch(function () { flushing = false; ... })      // ไม่ shift
   แถวที่ฐานปฏิเสธถาวรจึงค้างหัวคิว แล้วบล็อกทุก write ที่ตามมา "ทั้งแอป"
   บนจอยังยิงได้ปกติ แต่ไม่มีอะไรขึ้นฐานอีกเลย และไม่มีใครรู้

   เกิดได้จริง: สิทธิ์ถูกเปลี่ยนกลางคัน · รอบถูกปิดตอนคิวยังไม่ว่าง · Rules ถูกปรับ

   กติกาที่ต้องได้:
     HTTP 4xx            = ส่งกี่ครั้งก็ไม่ผ่าน -> พักไว้แล้วเดินคิวต่อ
     HTTP 5xx / เน็ตหลุด = ลองใหม่ได้          -> คาไว้หัวคิว ห้ามทิ้ง
     ของที่พักไว้ห้ามหาย ต้องกดส่งใหม่ได้ และต้องมองเห็นบนจอ
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
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    hideLogin();

    /* คุม db.update เอง — กำหนดได้ว่าแต่ละ path จะสำเร็จหรือพังด้วยรหัสอะไร */
    window.__sent = [];
    window.__failWith = {};          // path -> 'HTTP 401' | 'HTTP 500' | 'boom'
    window.db.update = function (path, patch) {
      window.__sent.push(path);
      const e = window.__failWith[path];
      if (e) return Promise.reject(new Error(e));
      return Promise.resolve();
    };

    window.__reset = function () {
      localStorage.removeItem('isrd_write_queue');
      localStorage.removeItem('isrd_write_failed');
      window.__sent = []; window.__failWith = {}; window.__toasts = [];
      state.roundId = 'R1';
      state.roundIndex = { R1: { id: 'R1', jobCode: 'J1', cycleId: 'C1',
                                 status: 'counting', createdAt: 1 } };
      state.unknownKeys = {}; state.unknown = {};
    };

    /* ปั๊ม flushQueue จนคิวนิ่ง — flushQueue เป็น async ต้องรอให้ promise เดินจนสุด */
    window.__drain = async function (rounds) {
      for (let i = 0; i < (rounds || 12); i++) {
        flushQueue();
        await new Promise(function (r) { setTimeout(r, 5); });
      }
    };

    window.__q = function () { return JSON.parse(localStorage.getItem('isrd_write_queue') || '[]'); };
    window.__f = function () { return JSON.parse(localStorage.getItem('isrd_write_failed') || '[]'); };
  });

  /* ---------- 1. แยก 4xx ออกจาก 5xx / เน็ต ---------- */
  console.log('\n[1] แยกความผิดพลาดถาวร ออกจากที่ลองใหม่ได้');
  const r1 = await page.evaluate(() => {
    return {
      p400: isPermanentWriteError(new Error('HTTP 400')),
      p401: isPermanentWriteError(new Error('HTTP 401')),
      p403: isPermanentWriteError(new Error('HTTP 403')),
      p404: isPermanentWriteError(new Error('HTTP 404')),
      s500: isPermanentWriteError(new Error('HTTP 500')),
      s503: isPermanentWriteError(new Error('HTTP 503')),
      t408: isPermanentWriteError(new Error('HTTP 408')),
      t429: isPermanentWriteError(new Error('HTTP 429')),
      net: isPermanentWriteError(new TypeError('Failed to fetch')),
      empty: isPermanentWriteError(null)
    };
  });
  check('4xx = ถาวร (400 · 401 · 403 · 404)',
        r1.p400 && r1.p401 && r1.p403 && r1.p404, r1);
  check('5xx = ลองใหม่ได้ (ฐานล่มชั่วคราว)', r1.s500 === false && r1.s503 === false, r1);
  check('408 timeout / 429 โดนจำกัดอัตรา = ลองใหม่ได้ ทั้งที่เป็น 4xx',
        r1.t408 === false && r1.t429 === false, r1);
  check('เน็ตหลุด / error ไม่มีรหัส = ลองใหม่ได้',
        r1.net === false && r1.empty === false, r1);

  /* ---------- 2. ⭐ แถวพังต้องไม่บล็อกแถวหลัง ---------- */
  console.log('\n[2] ⭐ แถวที่ปฏิเสธถาวร ต้องไม่บล็อกคิวทั้งแอป');
  const r2 = await page.evaluate(async () => {
    window.__reset();
    window.__failWith['rounds/BAD'] = 'HTTP 401';     // รอบถูกปิด / สิทธิ์เปลี่ยน
    enqueueWrite('rounds/BAD', { 'scans/s1': { delta: 1 } });
    enqueueWrite('rounds/R1', { 'scans/s2': { delta: 1 } });
    enqueueWrite('rounds/R1', { 'scans/s3': { delta: 1 } });
    await window.__drain();
    return {
      queue: window.__q().length,
      failed: window.__f().length,
      failedPath: (window.__f()[0] || {}).path,
      failedErr: (window.__f()[0] || {}).err,
      sentR1: window.__sent.filter(function (p) { return p === 'rounds/R1'; }).length,
      tries: window.__sent.filter(function (p) { return p === 'rounds/BAD'; }).length
    };
  });
  check('ลองแถวที่พังครบ 3 ครั้งก่อนตัดสินว่าถาวร (เผื่อ token หมุน)',
        r2.tries === 3, r2.tries);
  check('⭐ แถวหลังถูกส่งขึ้นฐานได้ ไม่ถูกบล็อก', r2.sentR1 === 2, r2);
  check('คิวว่างเกลี้ยง ไม่มีอะไรค้าง', r2.queue === 0, r2.queue);
  check('แถวที่พังถูกยกไปพักไว้ พร้อมสาเหตุ',
        r2.failed === 1 && r2.failedPath === 'rounds/BAD' &&
        r2.failedErr === 'HTTP 401', r2);

  /* ---------- 3. 5xx / เน็ตหลุด ต้องคาไว้ ห้ามทิ้ง ---------- */
  console.log('\n[3] ฐานล่ม / เน็ตหลุด — ต้องคาไว้หัวคิว ห้ามยกไปพัก');
  const r3 = await page.evaluate(async () => {
    window.__reset();
    window.__failWith['rounds/R1'] = 'HTTP 500';
    enqueueWrite('rounds/R1', { 'scans/s1': { delta: 1 } });
    await window.__drain();
    const during = { queue: window.__q().length, failed: window.__f().length,
                     tries: window.__q()[0] && window.__q()[0].tries };

    /* ฐานกลับมาแล้ว ต้องส่งได้เองโดยไม่ต้องทำอะไรเพิ่ม */
    delete window.__failWith['rounds/R1'];
    await window.__drain();
    return { during: during, after: { queue: window.__q().length, failed: window.__f().length } };
  });
  check('ส่งไม่ผ่านเพราะ 5xx = ยังอยู่ในคิว ไม่ถูกพัก',
        r3.during.queue === 1 && r3.during.failed === 0, r3.during);
  check('ไม่นับ tries ให้ 5xx (ไม่งั้นเน็ตล่มนาน ๆ จะถูกพักทั้งคิว)',
        r3.during.tries === undefined, r3.during);
  check('ฐานกลับมาแล้วส่งได้เอง คิวเกลี้ยง',
        r3.after.queue === 0 && r3.after.failed === 0, r3.after);

  /* ---------- 4. เน็ตหลุดยาว ๆ ห้ามพักทั้งคิว ---------- */
  console.log('\n[4] เน็ตหลุดยาว — ยิงต่อได้ ไม่มีอะไรถูกพักทิ้ง');
  const r4 = await page.evaluate(async () => {
    window.__reset();
    window.db.update = function (path) {
      window.__sent.push(path);
      return Promise.reject(new TypeError('Failed to fetch'));
    };
    for (let i = 0; i < 5; i++) enqueueWrite('rounds/R1', { ['scans/n' + i]: { delta: 1 } });
    await window.__drain(20);
    const off = { queue: window.__q().length, failed: window.__f().length };

    window.db.update = function (path) { window.__sent.push(path); return Promise.resolve(); };
    await window.__drain(20);
    return { off: off, back: { queue: window.__q().length, failed: window.__f().length } };
  });
  check('ออฟไลน์ยาว ๆ ทุกแถวยังอยู่ในคิวครบ 5 ไม่มีอะไรถูกพัก',
        r4.off.queue === 5 && r4.off.failed === 0, r4.off);
  check('เน็ตกลับมาแล้วส่งครบทุกแถว',
        r4.back.queue === 0 && r4.back.failed === 0, r4.back);

  /* ---------- 5. กดส่งใหม่ ---------- */
  console.log('\n[5] กดส่งใหม่หลังแก้ต้นเหตุแล้ว');
  const r5 = await page.evaluate(async () => {
    window.__reset();
    window.db.update = function (path, patch) {
      window.__sent.push(path);
      const e = window.__failWith[path];
      if (e) return Promise.reject(new Error(e));
      return Promise.resolve();
    };
    window.__failWith['rounds/BAD'] = 'HTTP 403';
    enqueueWrite('rounds/BAD', { 'scans/s1': { delta: 7 } });
    await window.__drain();
    const parked = window.__f().length;

    /* แอดมินแก้สิทธิ์ให้แล้ว */
    delete window.__failWith['rounds/BAD'];
    window.__toasts = [];
    const n = retryFailedWrites();
    await window.__drain();
    return { parked: parked, retried: n,
             queue: window.__q().length, failed: window.__f().length,
             sent: window.__sent.filter(function (p) { return p === 'rounds/BAD'; }).length,
             toast: (window.__toasts[0] || {}).m };
  });
  check('แถวถูกพักไว้ก่อน 1 รายการ', r5.parked === 1, r5.parked);
  check('กดส่งใหม่แล้วเอากลับเข้าคิวและส่งผ่าน',
        r5.retried === 1 && r5.queue === 0 && r5.failed === 0, r5);
  check('ส่งซ้ำจริง (3 ครั้งแรกพัง + 1 ครั้งหลังแก้)', r5.sent === 4, r5.sent);
  check('บอกผู้ใช้ว่าส่งใหม่กี่รายการ', /ส่งรายการที่ค้างใหม่อีกครั้ง 1 รายการ/.test(r5.toast || ''), r5.toast);

  /* ---------- 6. ไม่มีอะไรค้าง = ไม่มีอะไรให้กด ---------- */
  console.log('\n[6] ไม่มีรายการค้าง');
  const r6 = await page.evaluate(() => {
    window.__reset();
    window.__toasts = [];
    const n = retryFailedWrites();
    return { n: n, toast: (window.__toasts[0] || {}).m };
  });
  check('กดตอนไม่มีของค้าง = ไม่ทำอะไร + บอกให้รู้',
        r6.n === 0 && /ไม่มีรายการค้าง/.test(r6.toast || ''), r6);

  /* ---------- 7. ต้องมองเห็นบนจอ ห้ามเงียบ ---------- */
  console.log('\n[7] แถบเตือนบนหน้าจอ');
  const r7 = await page.evaluate(async () => {
    window.__reset();
    renderSyncBar();
    const clean = { shown: $('failedBar').style.display !== 'none' };

    window.db.update = function (path, patch) {
      window.__sent.push(path);
      const e = window.__failWith[path];
      if (e) return Promise.reject(new Error(e));
      return Promise.resolve();
    };
    window.__failWith['rounds/BAD'] = 'HTTP 401';
    enqueueWrite('rounds/BAD', { 'scans/s1': { delta: 1 } });
    await window.__drain();
    renderSyncBar();
    const bad = { shown: $('failedBar').style.display !== 'none',
                  text: $('failedText').textContent,
                  hasBtn: !!$('btnRetryFailed') };
    return { clean: clean, bad: bad };
  });
  check('ปกติไม่มีแถบเตือนมากวน', r7.clean.shown === false, r7.clean);
  check('มีของค้างแล้วแถบโผล่ พร้อมปุ่มส่งใหม่',
        r7.bad.shown === true && r7.bad.hasBtn === true, r7.bad);
  check('บอกจำนวนและย้ำว่ายอดไม่ได้หาย',
        /ส่งขึ้นระบบไม่สำเร็จ 1 รายการ/.test(r7.bad.text) &&
        /ยอดยังอยู่ในเครื่อง ไม่ได้หาย/.test(r7.bad.text), r7.bad.text);
  check('แปลสาเหตุเป็นภาษาคน ไม่ใช่โยนรหัส HTTP ใส่หน้า',
        /รอบถูกปิดไปแล้ว หรือสิทธิ์ของบัญชีถูกเปลี่ยน/.test(r7.bad.text), r7.bad.text);

  /* ---------- 7b. ต้องเห็นจากหน้าอื่นด้วย ---------- */
  console.log('\n[7b] แถบเชื่อมต่อ (ติดทุกหน้า) ต้องบอกด้วย');
  const r7b = await page.evaluate(async () => {
    window.__reset();
    const wasRemote = db.remote;
    Object.defineProperty(db, 'remote', { value: true, configurable: true });
    state.connection = 'online';
    renderConnection();
    const clean = { conn: $('connBar').getAttribute('data-conn'), text: $('connText').textContent };

    window.db.update = function (path, patch) {
      const e = window.__failWith[path];
      if (e) return Promise.reject(new Error(e));
      return Promise.resolve();
    };
    window.__failWith['rounds/BAD'] = 'HTTP 401';
    enqueueWrite('rounds/BAD', { 'scans/s1': { delta: 1 } });
    await window.__drain();
    renderConnection();
    const bad = { conn: $('connBar').getAttribute('data-conn'), text: $('connText').textContent };
    Object.defineProperty(db, 'remote', { value: wasRemote, configurable: true });
    return { clean: clean, bad: bad };
  });
  check('ปกติแถบเชื่อมต่อบอกว่าต่อฐานได้',
        r7b.clean.conn === 'online' && /ต่อฐานกลางแล้ว/.test(r7b.clean.text), r7b.clean);
  check('มีของค้าง แถบเชื่อมต่อเปลี่ยนสถานะและบอกจำนวน',
        r7b.bad.conn === 'failed' && /ส่งไม่สำเร็จค้างอยู่ 1 รายการ/.test(r7b.bad.text), r7b.bad);
  check('บอกด้วยว่าต้องไปทำอะไรต่อ', /ไปที่หน้ายิงเพื่อส่งใหม่/.test(r7b.bad.text), r7b.bad.text);

  /* ---------- 8. ข้อความอธิบายสาเหตุ ---------- */
  console.log('\n[8] แปลรหัสผิดพลาดเป็นภาษาคน');
  const r8 = await page.evaluate(() => {
    return { a401: writeErrorReason('HTTP 401'), a403: writeErrorReason('HTTP 403'),
             a400: writeErrorReason('HTTP 400'), a500: writeErrorReason('HTTP 500'),
             other: writeErrorReason('Failed to fetch') };
  });
  check('401/403 บอกให้ไปเช็คสิทธิ์หรือสถานะรอบ',
        /สิทธิ์/.test(r8.a401) && r8.a401 === r8.a403, r8);
  check('400 บอกให้แจ้งผู้ดูแลพร้อมบริบท', /ผู้ดูแลระบบ/.test(r8.a400), r8.a400);
  check('รหัสอื่นยังบอกรหัสไว้ให้ไล่ต่อได้', /HTTP 500/.test(r8.a500), r8.a500);
  check('error ที่ไม่ใช่ HTTP ก็ไม่พัง', r8.other === 'Failed to fetch', r8.other);

  /* ---------- 9. ของที่พักไว้ต้องรอดข้ามการเปิดแอปใหม่ ---------- */
  console.log('\n[9] ของที่พักไว้ต้องไม่หายตอนปิดแอป');
  const r9 = await page.evaluate(async () => {
    window.__reset();
    window.db.update = function (path, patch) {
      const e = window.__failWith[path];
      if (e) return Promise.reject(new Error(e));
      return Promise.resolve();
    };
    window.__failWith['rounds/BAD'] = 'HTTP 401';
    enqueueWrite('rounds/BAD', { 'scans/s1': { delta: 9 } });
    await window.__drain();
    /* อ่านกลับจาก localStorage ตรง ๆ เหมือนตอนเปิดแอปใหม่ */
    const raw = JSON.parse(localStorage.getItem('isrd_write_failed') || '[]');
    return { count: raw.length, path: raw[0].path,
             patch: JSON.stringify(raw[0].patch), hasAt: !!raw[0].at };
  });
  check('เก็บลง localStorage ครบ ทั้ง path และข้อมูลที่จะเขียน',
        r9.count === 1 && r9.path === 'rounds/BAD' &&
        r9.patch === JSON.stringify({ 'scans/s1': { delta: 9 } }), r9);
  check('บันทึกเวลาที่พักไว้ด้วย', r9.hasAt === true, r9.hasAt);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
