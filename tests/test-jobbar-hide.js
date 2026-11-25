/* ============================================================
   v2.52.1 — ซ่อนแถบ job (#jobBar) ในหน้า Master (จัดการ/ตั้งค่า/ผู้ใช้)
   ============================================================
   เหตุผล: หน้า Master เป็นงานทะเบียนกลางข้ามทุกรอบนับ แถบ job ล่าสุดที่ค้างอยู่
   ทำให้เข้าใจผิดว่ากำลังตั้งค่าให้บัญชี/รอบนั้น (เคสจริง: ตั้งสิทธิ์ให้ user แต่
   แถบโชว์ job สาขา RM2-02 ค้างอยู่หัวจอ อ่านแล้วนึกว่ากำลังแก้สาขานั้น)

   กติกาที่ต้องได้:
     [1] renderJobBar มี guard state.page==='master' (ซ่อนแล้ว return)
     [2] showPage เรียก renderJobBar() — sync แถบตอนเปลี่ยนหน้า
         (showPage ไม่ได้เรียก refreshNav เสมอ ถ้าไม่ sync แถบจะไม่หาย/ไม่กลับ)
     [3] มี job + อยู่หน้า jobs → แถบโชว์ (มี class show + มีเนื้อหา)
     [4] อยู่หน้า master → แถบหาย (ไม่มี class show + innerHTML ว่าง)
     [5] กลับไปหน้า summary → แถบโชว์อีกครั้ง (ไม่ค้างซ่อน)
     [6] ไม่มี job + หน้า jobs → แถบซ่อนเหมือนเดิม (กัน regress กรณีเดิม)
     [7] โหลดแอปไม่มี error
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

  const r = await page.evaluate(() => {
    const out = {};
    const bar = () => document.getElementById('jobBar');
    const isShown = () => { var b = bar(); return /\bshow\b/.test(b.className) && b.innerHTML.trim() !== ''; };
    const isHidden = () => { var b = bar(); return !/\bshow\b/.test(b.className) && b.innerHTML.trim() === ''; };

    /* ---- [1][2] ตรวจ wiring จาก source ---- */
    var rjb = (typeof renderJobBar === 'function') ? renderJobBar.toString() : '';
    var sp  = (typeof showPage === 'function') ? showPage.toString() : '';
    out.guardInRender = /state\.page\s*===\s*['"]master['"]/.test(rjb);
    out.renderCalledInShowPage = /renderJobBar\s*\(\s*\)/.test(sp);

    /* ---- seed job จริง (currentJob = state.roundIndex[state.roundId]) ---- */
    state.roundIndex = state.roundIndex || {};
    state.roundIndex.__t = { jobCode: 'TEST-JOBBAR-01', status: 'counting', storeType: 'STOCKASSET', branch: 'WHS-15', branchName: 'WH Asset Event' };
    state.roundId = '__t';

    /* ---- [3] หน้า jobs → โชว์ ---- */
    state.page = 'jobs'; renderJobBar(); out.showOnJobs = isShown();

    /* ---- [4] หน้า master → ซ่อน ---- */
    state.page = 'master'; renderJobBar(); out.hideOnMaster = isHidden();

    /* ---- [5] หน้า summary → กลับมาโชว์ ---- */
    state.page = 'summary'; renderJobBar(); out.showAgainSummary = isShown();

    /* ---- [6] ไม่มี job + หน้า jobs → ซ่อนเหมือนเดิม ---- */
    state.roundId = null; state.page = 'jobs'; renderJobBar(); out.hideNoJob = isHidden();

    return out;
  });

  check('[1] renderJobBar มี guard state.page===master', r.guardInRender, r);
  check('[2] showPage เรียก renderJobBar() (sync ตอนเปลี่ยนหน้า)', r.renderCalledInShowPage, r);
  check('[3] มี job + หน้า jobs → แถบโชว์', r.showOnJobs, r);
  check('[4] หน้า master → แถบหาย', r.hideOnMaster, r);
  check('[5] กลับไป summary → แถบโชว์อีกครั้ง', r.showAgainSummary, r);
  check('[6] ไม่มี job + หน้า jobs → แถบซ่อนเหมือนเดิม', r.hideNoJob, r);
  check('[7] โหลดแอปไม่มี error', errors.length === 0, errors);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
