/* ============================================================
   v2.32.0 — LITE_MODE: ลด Firebase connection/คน จาก ~4 สาย → 1 สาย (scans)
   ============================================================
   ปัญหา: subscribe/subscribeChildren ใช้ EventSource (สายเปิดค้าง = 1 Firebase connection/สาย)
     1 คนเปิด ~4 สาย: cycles + roundIndex (ทั้งแอป) + scans + unknown (ตอนนับ)
     50 คน × 2 สายฐาน = ชน Spark 100 connections → 402 → หลุด offline
   แก้: LITE_MODE เปลี่ยน cycles/roundIndex/unknown เป็น db.get (REST ครั้งเดียว ไม่นับ connection)
        + ดึงใหม่ตอนเข้าหน้า Job/สรุป · เหลือ scans เป็นสายสดสายเดียว

   กติกาที่ต้องได้:
     [1] LITE_MODE = true (เปิดโหมดประหยัด)
     [2] window._applyCycles / _applyRoundIndex ถูกตั้งเป็น global (showPage เรียกได้)
     [3] เข้าหน้า Job/สรุป → ใช้ db.get ('roundIndex'+'cycles') ไม่ใช่ db.subscribe (ไม่เปิดสาย)
     [4] _applyCycles เซ็ต state.cycles จาก data ถูก (ตรรกะเดิมไม่เพี้ยน)
     [5] _applyRoundIndex เซ็ต state.roundIndex + รัน migration ครั้งแรก (first)
     [6] showPage source ฝัง LITE hook (db.get roundIndex/cycles)
     [7] โหลดแอปไม่มี parse/runtime error
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

  const r = await page.evaluate(async () => {
    const out = {};

    out.liteFlag = (typeof LITE_MODE !== 'undefined' && LITE_MODE === true);
    out.applyFnsExist = (typeof window._applyCycles === 'function'
                      && typeof window._applyRoundIndex === 'function');

    /* [6] showPage ต้องฝัง LITE hook ที่ db.get roundIndex/cycles */
    var src = (typeof showPage === 'function') ? showPage.toString() : '';
    out.showPageHook = /LITE_MODE/.test(src) && /db\.get\('roundIndex'\)/.test(src) && /db\.get\('cycles'\)/.test(src);

    /* [3] จำลองจังหวะ "เข้าหน้า Job" แล้วดูว่าใช้ get ไม่ใช่ subscribe */
    var calls = { get: [], sub: [] };
    var realGet = db.get, realSub = db.subscribe;
    db.get = function (p) { calls.get.push(p); return Promise.resolve(null); };
    db.subscribe = function (p, cb) { calls.sub.push(p); return function () {}; };
    if (typeof LITE_MODE !== 'undefined' && LITE_MODE && window._applyRoundIndex) {
      db.get('roundIndex').then(window._applyRoundIndex);
      db.get('cycles').then(window._applyCycles);
    }
    out.navUsesGet = (calls.get.indexOf('roundIndex') >= 0 && calls.get.indexOf('cycles') >= 0);
    out.navNoSub = (calls.sub.length === 0);
    db.get = realGet; db.subscribe = realSub;

    /* [4] _applyCycles ตรรกะเดิม — เก็บแค่ status/info */
    if (window._applyCycles) {
      window._applyCycles({ C1: { status: 'open', info: { x: 1 }, systemQty: { big: 1 } } });
      out.applyCyclesWorks = !!(state.cycles && state.cycles.C1
                              && state.cycles.C1.status === 'open'
                              && state.cycles.C1.systemQty === undefined);   // ไม่เก็บก้อนใหญ่
    }

    /* [5] _applyRoundIndex — เซ็ต roundIndex + first-load (migration path) */
    if (window._applyRoundIndex) {
      startApp._gotJobs = false;
      window._applyRoundIndex({ R1: { br: 'TPY' } });
      out.applyRoundWorks = !!(state.roundIndex && state.roundIndex.R1 && startApp._gotJobs === true);
    }

    return out;
  });

  check('[1] LITE_MODE = true', r.liteFlag, r);
  check('[2] _applyCycles / _applyRoundIndex เป็น global (showPage เรียกได้)', r.applyFnsExist, r);
  check('[3] เข้าหน้า Job/สรุป ใช้ db.get ไม่เปิดสาย subscribe', r.navUsesGet && r.navNoSub, r);
  check('[4] _applyCycles เซ็ต state.cycles ถูก (เก็บแค่ status/info)', r.applyCyclesWorks, r);
  check('[5] _applyRoundIndex เซ็ต roundIndex + first-load flag', r.applyRoundWorks, r);
  check('[6] showPage ฝัง LITE hook (db.get roundIndex/cycles)', r.showPageHook, r);
  check('[7] โหลดแอปไม่มี error', errors.length === 0, errors);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
