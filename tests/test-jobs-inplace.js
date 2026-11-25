/* ============================================================
   v2.52.3 (B) — อัปเดตการ์ดหน้า Job แบบ in-place เมื่อโครงเท่าเดิม (กันกระพริบ)
   ============================================================
   ต้นตอกระพริบ: renderJobs ทำ list.innerHTML='' วาดการ์ดใหม่ทั้งก้อนทุกครั้งที่ถูกเรียก
   เข้าหน้า Job = showPage + LITE roundIndex/cycles async มาคนละจังหวะ (ห่างเกินเฟรม)
   → วาดหลายรอบ → การ์ดหายวูบ-โผล่ = กระพริบ (coalesce rAF v2.52.2 แก้ไม่ได้)
   B: โครงสร้างชุดการ์ดเท่าเดิม → อัปเดตเลข/แถบใน DOM เดิม ไม่ล้างทิ้ง = ไม่กระพริบ

   บั๊กที่เคยพลาด (CC จับ): ลายเซ็น jobsViewSig ต้องรวม "สิทธิ์ผู้ดู" ด้วย —
   การ์ดมีปุ่มส่งตรวจ/เปิดแก้/ช่องติ๊ก+Excel ตาม hasPerm · ถ้าสิทธิ์เปลี่ยนแต่ลายเซ็นไม่เปลี่ยน
   จะ in-place ค้างปุ่มของสิทธิ์เก่า (UX ผิด) → ต้องเข้า rebuild

   กติกาที่ต้องได้:
     [1] jobsViewSig รวม r (role) / p (perms) / br (สาขา)
     [2] state เท่าเดิม เรียก renderJobs ซ้ำ → การ์ด node เดิมถูกใช้ซ้ำ (ไม่ล้าง DOM = ไม่กระพริบ)
     [3] เปลี่ยน role (สิทธิ์) → วาดใหม่ (node ใหม่) — ปุ่มตามสิทธิ์อัปเดต
     [4] เพิ่ม Job → วาดใหม่ (การ์ดโผล่)
     [5] เปลี่ยนตัวกรองแท็บสถานะ → วาดใหม่
     [6] in-place อัปเดตตัวเลขจริง (ยอดขยับแล้วเลขในการ์ดเดิมตาม)
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
    const list = () => document.getElementById('jobList');
    const cardJ1 = () => list().querySelector('[data-job="J1"]');

    /* seed: admin เห็นทุก Job + 2 Job รอบเดียวกัน */
    state.products = {}; state.jobFilter = 'all'; state.jobBranch = 'all'; state.roundId = null;
    var now = Date.now();
    state.roundIndex = {
      J1: { jobCode:'A-01', status:'counting', storeType:'STOCK', branch:'W', branchName:'WT', createdAt:now,   cycleId:'C1' },
      J2: { jobCode:'A-02', status:'counting', storeType:'STOCK', branch:'W', branchName:'WT', createdAt:now-1, cycleId:'C1' }
    };
    state.me = { uid:'a1', role:'admin', branches:null, name:'Admin', perms:null };
    state.page = 'jobs';

    /* [1] ลายเซ็นรวม r/p/br */
    var sig = jobsViewSig(jobsComputeView());
    out.sigRPBR = /"r":/.test(sig) && /"p":/.test(sig) && /"br":/.test(sig);

    renderJobs();
    out.cardsFirst = list().querySelectorAll('[data-job]').length;

    /* [2] state เดิม → node reuse */
    cardJ1().setAttribute('data-probe', 'keepA');
    renderJobs();
    out.sameState_reuse = !!(cardJ1() && cardJ1().getAttribute('data-probe') === 'keepA');

    /* [3] เปลี่ยน role → rebuild (probe หาย) */
    cardJ1().setAttribute('data-probe', 'keepB');
    state.me = { uid:'a1', role:'scanner', branches:null, name:'Scanner', perms:null };
    renderJobs();
    out.roleChange_rebuild = !!(cardJ1() && cardJ1().getAttribute('data-probe') !== 'keepB');

    /* กลับเป็น admin เพื่อทดสอบต่อ */
    state.me = { uid:'a1', role:'admin', branches:null, name:'Admin', perms:null };
    renderJobs();

    /* [4] เพิ่ม Job → rebuild (การ์ดโผล่) */
    cardJ1().setAttribute('data-probe', 'keepC');
    state.roundIndex.J3 = { jobCode:'A-03', status:'counting', storeType:'STOCK', branch:'W', branchName:'WT', createdAt:now-2, cycleId:'C1' };
    renderJobs();
    out.addJob_cards = list().querySelectorAll('[data-job]').length;        // 3
    out.addJob_rebuild = !!(cardJ1() && cardJ1().getAttribute('data-probe') !== 'keepC');

    /* [5] เปลี่ยนตัวกรองแท็บ → rebuild */
    cardJ1().setAttribute('data-probe', 'keepD');
    state.jobFilter = 'reviewing';   // ไม่มี Job reviewing → shown ว่าง → โครงต่าง
    renderJobs();
    out.filterChange_rebuild = (list().querySelector('[data-job="J1"]') === null)
      || (cardJ1() && cardJ1().getAttribute('data-probe') !== 'keepD');
    state.jobFilter = 'all'; renderJobs();   // reset

    /* [6] in-place อัปเดตเลขจริง: ตั้ง cache ยอดแล้วเรียก renderJobs (โครงเท่าเดิม) → เลขในการ์ดเดิมเปลี่ยน */
    state.jobStats = state.jobStats || {};
    state.jobStats.J1 = { skuScanned: 7, pieces: 123, lastTs: 0, at: Date.now() };
    renderJobs();   // โครงเท่าเดิม → in-place → fillJobCardStats เติมเลขจาก cache
    var skuEl = cardJ1() && cardJ1().querySelector('[data-prog=sku]');
    out.inplace_number = !!(skuEl && skuEl.textContent.replace(/[^0-9]/g,'') === '7');

    return out;
  });

  check('[1] jobsViewSig รวม role/perms/สาขา (r/p/br)', r.sigRPBR, r);
  check('[2] state เท่าเดิม → การ์ด node เดิมถูกใช้ซ้ำ (ไม่กระพริบ)', r.sameState_reuse && r.cardsFirst === 2, r);
  check('[3] เปลี่ยน role/สิทธิ์ → วาดการ์ดใหม่', r.roleChange_rebuild, r);
  check('[4] เพิ่ม Job → วาดใหม่ (การ์ดโผล่ครบ 3)', r.addJob_rebuild && r.addJob_cards === 3, r);
  check('[5] เปลี่ยนตัวกรองแท็บ → วาดใหม่', r.filterChange_rebuild, r);
  check('[6] in-place อัปเดตเลขในการ์ดเดิมจริง', r.inplace_number, r);
  check('[7] โหลดแอปไม่มี error', errors.length === 0, errors);

  if (errors.length) { console.log('  (errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
