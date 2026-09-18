/* ============================================================
   ช่องอ่านเบื้องหลัง (bgSlot) ต้องถูกคืนเสมอ — v2.10.2
   ============================================================

   อาการหน้างานที่ไล่มา:
     validateAllStats 30 รอบ → 25 รอบขึ้น read-timeout ค้างครบ 35 วิเป๊ะ
     รวมรอบเล็กที่ควรอ่านจบในเสี้ยววินาที = ไม่ได้กำลังอ่าน แต่ "รอคิวที่ไม่มีวันว่าง"
     รอบแรก ๆ ผ่าน แล้วที่เหลือค้างหมด = ช่องถูกจองแล้วไม่ถูกคืน จนเหลือ 0 ช่อง

   ต้นตอที่พบ:
     อ่านเงียบจองช่อง → เจอ 401 → withAuthRetry เรียก session.renew()
     → refreshOnce() ใช้ fetch เปล่า "ไม่มี timeout" → เน็ตค้างกลางทางแล้วค้างตลอดกาล
     → promise ของ remoteGet ไม่ settle → ไม่มีใครคืนช่อง
     ซ้ำร้าย refreshing ถูกแคช ทุกคำขอที่โดน 401 ต่อจากนั้นไปรอใบเดียวกันที่ไม่มีวันจบ

   กันอะไร:
   [1] อ่านสำเร็จ / ฐานตอบ error / เน็ตพัง / timeout → ช่องกลับเป็น 0 เสมอ
   [2] 401 แล้วต่ออายุโทเคนค้าง → ต้องมีเวลาตัด ไม่ถือช่องตลอดกาล
   [3] คืนช่องซ้ำหรือคืนใบที่ถูกยึดไปแล้ว ต้องไม่ทำให้ตัวนับติดลบ
   [4] ยามเฝ้าช่อง: ใบที่ถือเกินเวลาต้องถูกยึดคืน แล้วคิวเดินต่อได้
   [5] db.bgInfo() บอกสภาพจริง — แยก "ช่องรั่ว" ออกจาก "คิวแน่น" ได้
   [6] คำขอที่ผู้ใช้รออยู่ (non-quiet) ไม่แตะคิวนี้เลย
   [7] คำขอต่ออายุโทเคนต้องมีเวลาตัด (ตรวจจากซอร์สจริง)
   [8] เคสค้างจริง + ยามเฝ้า — อยู่ท้ายสุดเพราะจงใจทิ้ง state สกปรก
   ============================================================ */

const { puppeteer, CHROME, APP_URL, forceLive } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.toast = function () {};
  window.session.token = function () { return 'tok'; };
  hideLogin();

  window.__mode = 'ok';
  window.__calls = [];
  window.__hangs = [];                 /* คำขอที่ถูกสั่งให้ค้าง เก็บตัวปลดไว้ปล่อยทีหลัง */
  window.fetch = function (u, opts) {
    var url = String(u).split('?')[0];
    window.__calls.push(url);
    var m = window.__mode;
    if (m === 'ok') {
      return Promise.resolve({ ok: true, status: 200,
                               json: function () { return Promise.resolve({ a: 1 }); } });
    }
    if (m === 'http500') {
      return Promise.resolve({ ok: false, status: 500,
                               json: function () { return Promise.resolve({}); } });
    }
    if (m === 'neterr') return Promise.reject(new TypeError('Failed to fetch'));
    if (m === 'abort') {
      var e = new Error('signal is aborted without reason');
      e.name = 'AbortError';
      return Promise.reject(e);
    }
    if (m === 'hang') {
      return new Promise(function (res, rej) { window.__hangs.push({ res: res, rej: rej }); });
    }
    /* ฐานตอบ 401 ทุกใบ — ตัวที่ทำให้ค้างคือ session.renew ที่เทสดักไว้เอง */
    if (m === 'auth401') {
      return Promise.resolve({ ok: false, status: 401,
                               json: function () { return Promise.resolve({}); } });
    }
    return Promise.reject(new Error('unknown mode ' + m));
  };

  window.__bg = function () { return db.bgInfo(); };
  window.__reset = function (mode) {
    window.__mode = mode || 'ok';
    window.__calls = [];
    window.__hangs = [];
  };
  /* ยิงอ่านเงียบพร้อมกัน n ใบ แล้วรอให้จบหมด (สำเร็จหรือพังก็นับว่าจบ) */
  window.__fire = function (n, prefix) {
    var jobs = [];
    for (var i = 0; i < n; i++) {
      jobs.push(db.getQuiet((prefix || 'rounds/R') + i + '/scans')
        .then(function () { return 'ok'; }, function () { return 'err'; }));
    }
    return Promise.all(jobs);
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
  /* เทสนี้วัดชั้นเน็ต/สายค้างจริง ต้องปิดโหมดทดสอบก่อนโหลดหน้า (v2.16.0) */
  await forceLive(page);
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(HARNESS);

  check('แอปอยู่ในโหมดต่อฐานกลาง (ไม่งั้นเทสนี้ไม่มีความหมาย)',
        await page.evaluate(() => db.remote === true), 'db.remote');
  check('มีช่องส่องคิวให้ใช้', await page.evaluate(() => typeof db.bgInfo === 'function'), 'bgInfo');

  const start = await page.evaluate(() => db.bgInfo());
  check('เริ่มต้นคิวว่าง', start.running === 0 && start.queued === 0, start);
  check('ช่องสูงสุด 2 ช่องเหมือนเดิม', start.max === 2, start.max);

  /* ---------- [1] ทุกผลลัพธ์ต้องคืนช่อง ---------- */
  console.log('\n[1] อ่านเงียบ 6 ใบ (3 เท่าของช่อง) ทุกโหมดต้องคืนช่องครบ');
  for (const mode of ['ok', 'http500', 'neterr', 'abort']) {
    const r = await page.evaluate(async (m) => {
      window.__reset(m);
      const res = await window.__fire(6);
      return { res: res, bg: db.bgInfo(), calls: window.__calls.length };
    }, mode);
    check('โหมด ' + mode + ' → เดินจนจบครบ 6 ใบ', r.res.length === 6, r);
    check('โหมด ' + mode + ' → ช่องกลับเป็น 0 ไม่มีรั่ว',
          r.bg.running === 0 && r.bg.queued === 0 && r.bg.active.length === 0, r.bg);
  }

  /* ---------- [3] คืนซ้ำต้องไม่ทำให้ตัวนับเพี้ยน ---------- */
  console.log('\n[3] คืนช่องซ้ำ / คืนใบที่ถูกยึดไปแล้ว ตัวนับห้ามติดลบ');
  const dbl = await page.evaluate(async () => {
    window.__reset('ok');
    await window.__fire(4);
    const a = db.bgInfo();
    db.bgSweep(); db.bgSweep();          /* กวาดซ้ำตอนไม่มีอะไรค้าง */
    const b = db.bgInfo();
    await window.__fire(2);              /* ยังต้องใช้งานได้ปกติหลังจากนั้น */
    const c = db.bgInfo();
    return { a: a, b: b, c: c };
  });
  check('อ่านจบแล้วเป็น 0', dbl.a.running === 0, dbl.a);
  check('กวาดซ้ำตอนว่างไม่ทำให้ติดลบ', dbl.b.running === 0, dbl.b);
  check('ยังอ่านต่อได้ปกติและกลับเป็น 0', dbl.c.running === 0 && dbl.c.queued === 0, dbl.c);

  /* ---------- [4] คิวยาวแต่ไม่รั่ว ---------- */
  console.log('\n[4] ยิงรัว 20 ใบ — คิวยาวได้ แต่ต้องระบายจนหมด');
  const burst = await page.evaluate(async () => {
    window.__reset('ok');
    const p = window.__fire(20);
    const mid = db.bgInfo();               /* อ่านทันที ยังไม่ปล่อยให้ microtask เดิน */
    const res = await p;
    return { mid: mid, done: res.length, end: db.bgInfo() };
  });
  check('ระหว่างทางมีคิวรออยู่จริง', burst.mid.queued > 0, burst.mid);
  check('ไม่เกินช่องสูงสุด', burst.mid.running <= burst.mid.max, burst.mid);
  check('ระบายจนครบ 20 ใบ', burst.done === 20, burst.done);
  check('จบแล้วคิวว่างสนิท',
        burst.end.running === 0 && burst.end.queued === 0 && burst.end.active.length === 0, burst.end);

  /* ---------- [5] bgInfo แยกอาการได้ ---------- */
  console.log('\n[5] db.bgInfo() ต้องบอกได้ว่าใบไหนถือนานแค่ไหน');
  const info = await page.evaluate(async () => {
    window.__reset('hang');
    db.getQuiet('rounds/BIGWHS/scans').then(function () {}, function () {});
    await new Promise(r => setTimeout(r, 150));
    const bg = db.bgInfo();
    window.__hangs.forEach(h => h.rej(new TypeError('Failed to fetch')));
    await new Promise(r => setTimeout(r, 200));
    return { bg: bg, after: db.bgInfo() };
  });
  check('บอก path ที่กำลังถือช่องอยู่',
        info.bg.active.length === 1 && /BIGWHS/.test(info.bg.active[0].path), info.bg);
  check('บอกอายุของใบจอง', typeof info.bg.active[0].ageMs === 'number', info.bg.active[0]);
  check('พอคำขอจบ ช่องคืนทันที', info.after.running === 0 && info.after.active.length === 0, info.after);

  /* ---------- [6] คำขอที่ผู้ใช้รอ ไม่แตะคิวนี้ ---------- */
  console.log('\n[6] คำขอปกติ (db.get) ต้องไม่ไปแย่งคิวอ่านเบื้องหลัง');
  const direct = await page.evaluate(async () => {
    window.__reset('ok');
    const p = db.get('products');
    const during = db.bgInfo();
    await p;
    return { during: during, after: db.bgInfo() };
  });
  check('ไม่จองช่องเลย', direct.during.running === 0 && direct.during.queued === 0, direct.during);
  check('จบแล้วก็ยังว่าง', direct.after.running === 0, direct.after);

  /* ---------- [7] ต่ออายุโทเคนต้องมีเวลาตัด ---------- */
  console.log('\n[7] คำขอต่ออายุโทเคนต้องมี AbortController ครอบ');
  const t = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  check('ไม่ใช้ fetch เปล่ากับคำขอต่ออายุโทเคนแล้ว',
        /return fetch\(IDENTITY_REFRESH/.test(t) === false, 'return fetch(IDENTITY_REFRESH');
  check('ใช้ตัวที่มีเวลาตัดแทน', /fetchAuthT\(IDENTITY_REFRESH/.test(t) === true, 'fetchAuthT');
  check('ตัวนั้นใช้ AbortController จริง',
        /function fetchAuthT[\s\S]{0,500}AbortController/.test(t) === true, 'AbortController');

  /* ---------- [8] 401 + ต่ออายุโทเคนค้าง — ต้องอยู่ท้ายสุด ----------
     บล็อกนี้จงใจทำให้ช่องค้างและเลื่อนนาฬิกาเพื่อทดสอบยามเฝ้า
     จึงทิ้ง state สกปรกไว้ ห้ามวางไว้กลางชุดเด็ดขาด ไม่งั้นข้อหลัง ๆ พังตามหมด */
  console.log('\n[8] ⭐ ต้นตอจริง — 401 แล้วคำขอต่ออายุโทเคนค้าง');
  const authHang = await page.evaluate(async () => {
    window.__reset('auth401');
    /* ดักที่ session.renew ตรง ๆ — จำลอง "ต่ออายุโทเคนแล้วค้างตลอดกาล"
       ซึ่งเป็นเส้นทางจริงที่ทำให้ช่องไม่ถูกคืน (refreshOnce ของเดิมไม่มีเวลาตัด) */
    window.__realRenew = window.session.renew;
    window.session.renew = function () { return new Promise(function () {}); };

    const jobs = window.__fire(2);          /* 2 ใบ = เต็มช่องพอดี */
    await new Promise(r => setTimeout(r, 200));
    const during = db.bgInfo();

    /* ใบที่ 3 ต้องต่อคิว ไม่ใช่ได้ช่องทันที */
    let third = 'pending';
    db.getQuiet('rounds/RX/scans').then(() => { third = 'ok'; }, () => { third = 'err'; });
    await new Promise(r => setTimeout(r, 200));
    return { during: during, queued: db.bgInfo(), third: third, jobs: !!jobs };
  });
  check('⭐ ต่ออายุโทเคนค้าง → ช่องถูกถือไว้ทั้งสองช่อง', authHang.during.running === 2, authHang.during);
  check('ใบที่ 3 ต้องต่อคิว ยังไม่ได้ช่อง',
        authHang.queued.queued >= 1 && authHang.third === 'pending', authHang.queued);

  console.log('\n[8b] ยามเฝ้าช่องต้องยึดคืนแล้วปล่อยคิวให้เดินต่อ');
  const swept = await page.evaluate(() => db.bgInfo());
  check('ยังถืออยู่ครบ 2 ใบก่อนกวาด', swept.running === 2, swept);

  const afterAge = await page.evaluate(async () => {
    /* ทำให้ใบที่ถืออยู่แก่เกิน 60 วิ ด้วยการเลื่อนนาฬิกา แล้วสั่งกวาด */
    const realNow = Date.now;
    Date.now = function () { return realNow.call(Date) + 90000; };
    const freed = db.bgSweep();
    const after = db.bgInfo();
    Date.now = realNow;
    await new Promise(r => setTimeout(r, 200));
    return { freed: freed, after: after, bgNow: db.bgInfo() };
  });
  check('⭐ ยึดใบที่ค้างคืนได้', afterAge.freed >= 1, afterAge);
  check('ยึดแล้วคิวที่รออยู่ได้เดินต่อ (ไม่ค้างถาวร)',
        afterAge.bgNow.running + afterAge.bgNow.queued <= 3, afterAge.bgNow);
  const logged = await page.evaluate(() =>
    db.netLog().filter(r => r.note === 'slot-stuck-reclaimed').length);
  check('บันทึกไว้ใน netLog ว่ายึดคืนไปกี่ใบ', logged >= 1, logged);

  /* คืนสภาพก่อนไปข้อถัดไป — คืน session.renew ตัวจริง + ปล่อยคำขอที่ค้าง */
  await page.evaluate(async () => {
    if (window.__realRenew) { window.session.renew = window.__realRenew; window.__realRenew = null; }
    window.__hangs.forEach(h => h.rej(new TypeError('Failed to fetch')));
    window.__hangs = [];
    window.__reset('ok');
    await new Promise(r => setTimeout(r, 300));
    db.bgSweep();
  });


  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
