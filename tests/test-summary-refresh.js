/* ============================================================
   v2.31.0 — หน้าสรุปวาดใหม่เองเมื่อยอดยิงไหลเข้าสด (scheduleSummaryRefresh)
   ============================================================
   ปัญหาเดิม: สาย subscribeChildren('.../scans') เรียก renderScanTotals เฉพาะ
   หน้า 'scan' — คนเปิดหน้า "สรุป" มาดู พอมีคนยิงเพิ่ม/ตอนโหลดรอบครั้งแรก
   จอค้างเลขเก่า (0%/ขาดหมด) จนต้องกดสลับแท็บต้นทุนให้ renderSummary เอง

   แก้: scheduleSummaryRefresh() (debounce 250ms) + renderSummaryActive() (dispatch)
     - รอบ Job เดียว  → วาดได้ทุกครั้ง (ใช้ state.counts ในเครื่อง ไม่โหลดอะไร)
     - รอบหลาย Job    → throttle โหลดยอดรวมทุกใบไม่ถี่กว่า SUM_HEAVY_MIN (60 วิ/จอ)
       + trailing timer 1 ตัว → ยอดชุดสุดท้ายในกรอบไม่หาย แม้คนยิงหยุดพอดี (โควตายัง ≤1/นาที)

   กติกาที่ต้องได้:
     [1] ไม่ได้อยู่หน้าสรุป              → ไม่วาด
     [2] burst หลายครั้งรวด             → วาดครั้งเดียว (debounce)
     [3] แท็บ overview                  → renderOverview
     [4] แท็บ sd (Job เดียว)            → renderStockDisplay
     [5] แท็บ live                      → ไม่วาด (timer เอง)
     [6] flag reset                     → เรียกใหม่วาดได้อีก
     [7] ออกจากหน้าสรุประหว่างรอ timer   → ไม่วาด
     [M1] หลาย Job: ครั้งแรก (leading)   → วาดทันที
     [M2] หลาย Job: อยู่ในกรอบ           → ไม่วาดหนักซ้ำ (throttle กันโควตา)
     [M3] หลาย Job: trailing            → ยิงแล้วหยุด พอครบกรอบ วาดเองโดยไม่ต้องมีแถวถัดไป
     [M4] Job เดียว                     → ไม่ throttle วาดได้ทุกครั้ง
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
    const wait = ms => new Promise(res => setTimeout(res, ms));

    var calls = { summary: 0, overview: 0, sd: 0 };
    window.renderSummary = function () { calls.summary++; };
    window.renderOverview = function () { calls.overview++; };
    window.renderStockDisplay = function () { calls.sd++; };
    window.__multi = false;
    window.cycleScope = function () { return { multi: !!window.__multi }; };

    /* ---------- ชุด logic พื้นฐาน (Job เดียว ไม่แตะ throttle) ---------- */

    /* [1] ไม่ได้อยู่หน้าสรุป → ไม่วาด */
    state.page = 'scan'; state.summaryTab = 'job'; calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    out.guardPage = (calls.summary === 0);

    /* [2] หน้าสรุป + burst 5 ครั้ง → วาดครั้งเดียว */
    state.page = 'summary'; state.summaryTab = 'job'; window.__multi = false; calls.summary = 0;
    for (var i = 0; i < 5; i++) scheduleSummaryRefresh();
    out.immediate = calls.summary;
    await wait(320);
    out.burstOnce = (calls.summary === 1);

    /* [3] overview → renderOverview */
    state.summaryTab = 'overview'; calls.overview = 0; calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    out.overview = (calls.overview === 1 && calls.summary === 0);

    /* [4] sd (Job เดียว) → renderStockDisplay */
    state.summaryTab = 'sd'; window.__multi = false; calls.sd = 0; calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    out.sd = (calls.sd === 1 && calls.summary === 0);

    /* [5] live → ไม่วาดอะไร */
    state.summaryTab = 'live'; calls.summary = 0; calls.overview = 0; calls.sd = 0;
    scheduleSummaryRefresh(); await wait(320);
    out.live = (calls.summary === 0 && calls.overview === 0 && calls.sd === 0);

    /* [6] flag reset → เรียกใหม่วาดได้อีก */
    state.summaryTab = 'job'; window.__multi = false; calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    var first = calls.summary;
    scheduleSummaryRefresh(); await wait(320);
    out.reschedule = (first === 1 && calls.summary === 2);

    /* [7] ออกจากหน้าสรุประหว่างรอ timer → ไม่วาด */
    state.page = 'summary'; state.summaryTab = 'job'; window.__multi = false; calls.summary = 0;
    scheduleSummaryRefresh();
    state.page = 'scan';
    await wait(320);
    out.leftDuringWait = (calls.summary === 0);

    /* ---------- ชุด throttle รอบหลาย Job ---------- */
    state.page = 'summary'; state.summaryTab = 'job'; window.__multi = true;

    /* [M1] leading: กรอบใหญ่มาก (กัน trailing ยิงระหว่างเทส) + _sumHeavyAt=0 → วาดทันที */
    window.SUM_HEAVY_MIN = 100000; window._sumHeavyAt = 0; window._sumTrailT = null;
    calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    out.multiLeading = (calls.summary === 1);        // ครั้งแรกวาดเลย

    /* [M2] อยู่ในกรอบ (เพิ่งวาดไป, กรอบ 100วิ ยังเปิด) → ไม่วาดหนักซ้ำ */
    calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    out.multiThrottled = (calls.summary === 0);      // throttle กันโควตา (trailing 100วิ ยังไม่ยิง)

    /* [M3] trailing: กรอบสั้น 500ms, window เปิด → ยิง 1 ครั้งแล้วหยุด
            ไม่มี scheduleSummaryRefresh รอบสอง — พอครบกรอบต้องวาดเอง */
    window.SUM_HEAVY_MIN = 500; window._sumHeavyAt = Date.now(); window._sumTrailT = null;
    calls.summary = 0;
    scheduleSummaryRefresh();                         // ภายในกรอบ → ตั้ง trailing ไว้
    await wait(300);
    out.trailBefore = (calls.summary === 0);          // ยังไม่ถึงกรอบ ยังไม่วาด
    await wait(700);                                   // รวม ~1000ms > 500+debounce
    out.trailFired = (calls.summary === 1);           // trailing วาดเองโดยไม่ต้องมีแถวถัดไป

    /* [M4] Job เดียว → ไม่ throttle วาดได้ทุกครั้ง */
    window.__multi = false; calls.summary = 0;
    scheduleSummaryRefresh(); await wait(320);
    scheduleSummaryRefresh(); await wait(320);
    out.singleNoThrottle = (calls.summary === 2);

    return out;
  });

  check('[1] ไม่ได้อยู่หน้าสรุป → ไม่วาด', r.guardPage, r);
  check('[2] burst → ยังไม่วาดทันที (debounce)', r.immediate === 0, r);
  check('[2] burst 5 ครั้ง → วาดครั้งเดียว', r.burstOnce, r);
  check('[3] แท็บ overview → renderOverview', r.overview, r);
  check('[4] แท็บ sd (Job เดียว) → renderStockDisplay', r.sd, r);
  check('[5] แท็บ live → ไม่วาด (timer เอง)', r.live, r);
  check('[6] flag reset → เรียกใหม่วาดได้อีก', r.reschedule, r);
  check('[7] ออกจากหน้าสรุประหว่างรอ → ไม่วาด', r.leftDuringWait, r);
  check('[M1] หลาย Job: ครั้งแรก (leading) วาดทันที', r.multiLeading, r);
  check('[M2] หลาย Job: อยู่ในกรอบ → ไม่วาดหนักซ้ำ (throttle)', r.multiThrottled, r);
  check('[M3] หลาย Job: ในกรอบยังไม่วาด', r.trailBefore, r);
  check('[M3] หลาย Job: trailing วาดเองพอครบกรอบ (ยิงแล้วหยุด)', r.trailFired, r);
  check('[M4] Job เดียว → ไม่ throttle วาดได้ทุกครั้ง', r.singleNoThrottle, r);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
