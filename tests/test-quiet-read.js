/* ============================================================
   อ่านสถิติเบื้องหลัง (quiet read) ต้องไม่ทำคิว bgSlot ตัน (v2.9.6)
   ============================================================

   อาการหน้างานที่กันไว้ (จาก db.netLog() ของเครื่องจริง):
     เปิดแอปมา GET products/rounds/cycles = 200 เร็ว 46–429ms ปกติดี
     แต่พออ่านรอบคลัง WHS01 (31,910 ชิ้น) → status 0 note "signal is aborted"
     แล้ว ms พุ่ง 31,644 → 98,122 → 447,127 → 747,123 (12 นาที)
     ผลคือสถิติค้าง "..." ทั้งจอ ทั้งที่เน็ต ฐาน และสิทธิ์ปกติดีหมด

   กลไกที่ทำให้ลาม:
     quiet read จองช่อง bgSlot ซึ่งมีแค่ BG_MAX = 2 ช่อง
     ก้อนใหญ่อ่านไม่ทัน timeout → abort → retry อีก จนครบ 3 รอบ
     ตลอดเวลานั้นยังจองช่องค้างไว้ คำขออื่นจึงต่อคิวยาวเป็นนาที

   กันอะไร:
   [1] quiet read ใช้ timeout 30 วิ และไม่ retry (tries = 1)
   [2] คำขอที่ผู้ใช้กด/เขียน (non-quiet) ต้องคงเดิม 10 วิ + retry 3 รอบ
   [3] quiet read ที่ล้มเหลวต้องคืนช่อง bgSlot เสมอ คิวจึงไม่ตัน
   [4] เส้นทางเงียบกับเส้นทางปกติต้องแยกกันจริง (path เดียวกันก็ยังใช้เวลาคนละค่า)
   [5] quiet read ที่ล้มต้องไม่ลาก banner ไปออฟไลน์ (โซน v2.9.5 ห้ามถอย)
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

/* fetchT ตั้ง AbortController + setTimeout(ตัด, timeoutMs) เสมอ
   ดัก setTimeout จึงอ่าน "เวลาที่ใช้จริง" ได้ตรง ๆ โดยไม่ต้องนั่งรอ 30 วิ */
const HARNESS = `
  window.__calls = [];
  window.__mode = 'ok';                 /* ok = 200 · fail = เน็ตพัง */
  window.fetch = function (u) {
    window.__calls.push(String(u).split('?')[0]);
    if (window.__mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  };
  window.toast = function () {};
  window.session.token = function () { return 'tok'; };
  hideLogin();

  /* เก็บเวลาที่ setTimeout ถูกตั้ง แต่ยังปล่อยให้ทำงานจริง
     (retryNet ใช้ setTimeout หน่วง 800ms ด้วย ถ้าบล็อกไว้เทสจะค้าง) */
  window.__delays = [];
  var realTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms) {
    window.__delays.push(ms);
    return realTimeout.apply(window, arguments);
  };

  window.__reset = function (mode) {
    window.__calls = [];
    window.__delays = [];
    window.__mode = mode || 'ok';
  };
  /* เวลาที่ยาวกว่า 5 วิ = timeout ของคำขอ (ตัวอื่นในแอปเป็นหน่วงสั้น ๆ) */
  window.__reqTimeouts = function () {
    return window.__delays.filter(function (m) { return m >= 5000; });
  };
`;

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
  await page.evaluate(HARNESS);

  check('แอปอยู่ในโหมดต่อฐานกลาง (ไม่งั้นเทสนี้ไม่มีความหมาย)',
        await page.evaluate(() => db.remote === true), 'db.remote');

  /* ---------- [1] quiet read ---------- */
  console.log('\n[1] อ่านสถิติเบื้องหลัง (getQuiet) — 30 วิ ไม่ retry');
  const q = await page.evaluate(async () => {
    window.__reset('ok');
    await db.getQuiet('rounds/R1/scans');
    return { timeouts: window.__reqTimeouts(), calls: window.__calls.length };
  });
  check('ใช้ timeout 30 วิ', q.timeouts.indexOf(30000) >= 0, q.timeouts);
  check('ไม่เหลือ 12 วิของเดิมที่ getQuiet เคยทับไว้', q.timeouts.indexOf(12000) < 0, q.timeouts);
  check('ยิงคำขอครั้งเดียว', q.calls === 1, q.calls);

  console.log('\n[1b] quiet read ที่ล้มเหลวต้องไม่ลองซ้ำ (ตัวที่ทำให้ slot ตัน)');
  const qf = await page.evaluate(async () => {
    window.__reset('fail');
    let threw = false;
    try { await db.getQuiet('rounds/R1/scans'); } catch (e) { threw = true; }
    return { calls: window.__calls.length, threw: threw, timeouts: window.__reqTimeouts() };
  });
  check('ล้มแล้วยิงแค่ครั้งเดียว ไม่ลองซ้ำ 3 รอบ', qf.calls === 1, qf);
  check('ยังใช้ timeout 30 วิตอนล้ม', qf.timeouts.every(m => m === 30000), qf.timeouts);
  check('ยังโยน error ออกมาให้ผู้เรียกจัดการเหมือนเดิม', qf.threw === true, qf);

  /* ---------- [2] non-quiet ต้องคงเดิม ---------- */
  console.log('\n[2] คำขอที่ผู้ใช้รออยู่ (db.get) ต้องคงเดิม 10 วิ + retry 3');
  const g = await page.evaluate(async () => {
    window.__reset('ok');
    await db.get('products');
    return { timeouts: window.__reqTimeouts(), calls: window.__calls.length };
  });
  check('ใช้ timeout 10 วิเหมือนเดิม', g.timeouts.length === 1 && g.timeouts[0] === 10000, g.timeouts);
  check('สำเร็จรอบเดียวก็ไม่ยิงซ้ำ', g.calls === 1, g.calls);

  const gf = await page.evaluate(async () => {
    window.__reset('fail');
    let threw = false;
    try { await db.get('products'); } catch (e) { threw = true; }
    return { calls: window.__calls.length, threw: threw, timeouts: window.__reqTimeouts() };
  });
  check('เน็ตพังแล้วยังลองซ้ำครบ 3 รอบเหมือนเดิม', gf.calls === 3, gf);
  check('ทุกรอบใช้ 10 วิ', gf.timeouts.length === 3 && gf.timeouts.every(m => m === 10000), gf.timeouts);
  check('ครบ 3 รอบแล้วค่อยโยน error', gf.threw === true, gf);

  /* ---------- [3] คืนช่อง bgSlot ---------- */
  console.log('\n[3] quiet read ที่ล้มต้องคืนช่อง bgSlot — คิวห้ามตัน (BG_MAX = 2)');
  const slot = await page.evaluate(async () => {
    window.__reset('fail');
    /* ยิง 6 ใบพร้อมกัน = มากกว่า BG_MAX เท่าตัว ถ้าช่องไม่ถูกคืนจะค้างไม่ครบ */
    const jobs = [];
    for (let i = 0; i < 6; i++) {
      jobs.push(db.getQuiet('rounds/R' + i + '/scans').then(
        function () { return 'ok'; }, function () { return 'err'; }));
    }
    const done = await Promise.race([
      Promise.all(jobs),
      new Promise(function (r) { setTimeout(function () { r('TIMEOUT'); }, 8000); })
    ]);
    return { done: done, calls: window.__calls.length };
  });
  check('ทุกใบเดินจนจบ ไม่มีใบไหนค้างคิว', Array.isArray(slot.done) && slot.done.length === 6, slot.done);
  check('ยิงใบละครั้งพอดี รวม 6 ครั้ง', slot.calls === 6, slot.calls);

  console.log('\n[3b] ยิงสำเร็จก็ต้องคืนช่องเหมือนกัน');
  const slotOk = await page.evaluate(async () => {
    window.__reset('ok');
    const jobs = [];
    for (let i = 0; i < 6; i++) jobs.push(db.getQuiet('rounds/R' + i + '/scans'));
    const done = await Promise.race([
      Promise.all(jobs).then(function () { return 'all'; }),
      new Promise(function (r) { setTimeout(function () { r('TIMEOUT'); }, 8000); })
    ]);
    return { done: done, calls: window.__calls.length };
  });
  check('ทุกใบเดินจนจบ', slotOk.done === 'all', slotOk);
  check('ยิง 6 ครั้งพอดี', slotOk.calls === 6, slotOk.calls);

  /* ---------- [4] สองเส้นทางต้องแยกกันจริง ---------- */
  console.log('\n[4] path เดียวกันแต่คนละเส้นทาง ต้องได้เวลาคนละค่า');
  const custom = await page.evaluate(async () => {
    /* ยิง path เดียวกันทั้งสองทาง — พิสูจน์ว่าค่าเวลามาจาก "ทางที่เรียก" ไม่ใช่ตัว path */
    window.__reset('ok');
    await db.getQuiet('cycles/C1/systemQty');
    const quiet = window.__reqTimeouts().slice();
    window.__reset('ok');
    await db.get('cycles/C1/systemQty');
    const normal = window.__reqTimeouts().slice();
    return { quiet: quiet, normal: normal };
  });
  check('เส้นทางเงียบกับเส้นทางปกติใช้เวลาต่างกันจริง',
        custom.quiet[0] === 30000 && custom.normal[0] === 10000, custom);

  /* ---------- [5] ไม่ไปแตะสถานะ online/offline ---------- */
  console.log('\n[5] quiet read ที่ล้มต้องไม่ลาก banner ไปออฟไลน์ (โซน v2.9.5 ห้ามถอย)');
  const st = await page.evaluate(async () => {
    window.__status = [];
    db.onStatus(function (ok, why) { window.__status.push({ ok: ok, why: why }); });
    window.__reset('fail');
    try { await db.getQuiet('rounds/R1/scans'); } catch (e) {}
    const afterQuiet = window.__status.slice();
    window.__reset('fail');
    try { await db.get('products'); } catch (e) {}
    const afterNormal = window.__status.slice();
    return { afterQuiet: afterQuiet, afterNormal: afterNormal };
  });
  check('อ่านเงียบล้มแล้วไม่ประกาศออฟไลน์', st.afterQuiet.length === 0, st.afterQuiet);
  check('แต่คำขอปกติล้มยังประกาศออฟไลน์ตามเดิม',
        st.afterNormal.some(s => s.ok === false), st.afterNormal);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
