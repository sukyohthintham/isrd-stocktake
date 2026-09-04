/* ============================================================
   DIAG (ไม่ใช่ regression — ชื่อไม่ขึ้นต้น test- จึงไม่ถูก run-all เก็บ)

   จำลอง "หน้างานจริง": ต่อฐานกลาง (REMOTE_MODE) แล้วนับว่า renderJobs()
   หนึ่งครั้ง ยิง HTTP ไปกี่คำขอ และคำขอที่ยิงทีหลัง (เช่น สร้าง Job)
   ต้องรอคิวนานแค่ไหน — เบราว์เซอร์เปิดต่อโฮสต์เดียวได้ 6 สายเท่านั้น

   รัน: node tests/diag-request-storm.js [จำนวน Job]
   ============================================================ */
const { puppeteer, CHROME, APP_URL } = require('./_env');

const N_JOBS = Number(process.argv[2] || 8);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1000));

  const report = await page.evaluate(async (N) => {
    /* ---------- 1. ปลอม network layer ----------
       - จำกัด 6 สายพร้อมกันเหมือนเบราว์เซอร์จริงต่อ 1 โฮสต์
       - GET scans ก้อนใหญ่ = ช้า 300ms · คำขอเล็ก = 60ms          */
    const log = [];
    let inFlight = 0, peak = 0;
    const waiting = [];
    const T0 = Date.now();

    function slot() {
      if (inFlight < 6) { inFlight++; peak = Math.max(peak, inFlight); return Promise.resolve(); }
      return new Promise(res => waiting.push(res));
    }
    function release() {
      inFlight--;
      const next = waiting.shift();
      if (next) { inFlight++; peak = Math.max(peak, inFlight); next(); }
    }

    window.EventSource = function () {
      this.close = function () {};
      this.addEventListener = function () {};
      this.readyState = 1;
      setTimeout(() => { if (this.onopen) this.onopen(); }, 5);
    };

    window.fetch = function (u, opts) {
      const method = (opts && opts.method) || 'GET';
      const path = String(u).split('.app/')[1] || String(u);
      const big = /\/scans\.json/.test(path);
      const ms = big ? 300 : 60;
      const rec = { path: path.split('?')[0], method: method, queuedAt: Date.now() - T0 };
      log.push(rec);
      return slot().then(() => new Promise(res => {
        rec.startAt = Date.now() - T0;
        setTimeout(() => {
          release();
          rec.doneAt = Date.now() - T0;
          rec.waitMs = rec.startAt - rec.queuedAt;
          res({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }, ms);
      }));
    };

    /* ---------- 2. บังคับโหมดต่อฐานกลาง + ปิด UI ที่ไม่เกี่ยว ---------- */
    window.REMOTE_MODE = true;
    window.toast = function () {};
    hideLogin();

    /* ---------- 3. เพาะข้อมูล: N Job อยู่ในรอบเดียวกัน ---------- */
    state.me = { uid: 'u1', name: 'แอดมิน', role: 'admin', branches: [] };
    state.roundIndex = {};
    state.jobStats = {}; state.cycleStats = {}; state.cycles = {};
    state.jobFilter = 'all'; state.jobBranch = 'all';
    state.products = {}; state.priceField = 'costPrice';
    for (let i = 0; i < N; i++) {
      state.roundIndex['R' + i] = {
        id: 'R' + i, name: 'ใบที่ ' + i, branchCode: 'B1', branchName: 'สาขาหนึ่ง',
        jobCode: 'J' + i, cycleId: 'B1-2609-01', status: 'counting', createdAt: 1000 + i
      };
    }

    /* ---------- 4. วาดหน้า Job หนึ่งครั้ง ---------- */
    const drawAt = Date.now() - T0;
    renderJobs();

    /* ---------- 5. 400ms ต่อมา ผู้ใช้กด "สร้าง Job" (write) ---------- */
    let writeMs = null, writeOk = null;
    setTimeout(() => {
      const t = Date.now();
      db.update('rounds/NEW', { name: 'ใบใหม่' })
        .then(() => { writeMs = Date.now() - t; writeOk = true; },
              () => { writeMs = Date.now() - t; writeOk = false; });
    }, 400);

    /* ---------- 6. รอจนคิวว่าง (สูงสุด 30 วิ) ---------- */
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      if (inFlight === 0 && waiting.length === 0 && writeMs !== null) break;
    }

    const byPath = {};
    log.forEach(r => {
      const k = r.method + ' ' + r.path.replace(/R\d+/, 'R*').replace(/rounds\/NEW/, 'rounds/NEW');
      byPath[k] = (byPath[k] || 0) + 1;
    });

    const cardTexts = Array.prototype.map.call(
      document.querySelectorAll('#jobList [data-prog=pieces]'), e => e.textContent);
    const cycleText = (document.querySelector('[data-cycleprog]') || {}).textContent;

    return {
      jobs: N,
      totalRequests: log.length,
      peakConcurrency: peak,
      byPath: byPath,
      maxQueueWaitMs: log.reduce((m, r) => Math.max(m, r.waitMs || 0), 0),
      lastDoneMs: log.reduce((m, r) => Math.max(m, r.doneAt || 0), 0),
      drawAt: drawAt,
      writeMs: writeMs, writeOk: writeOk,
      cardsStillDots: cardTexts.filter(t => t === '…').length,
      cardsTotal: cardTexts.length,
      cycleText: cycleText
    };
  }, N_JOBS);

  console.log('\n=========== ผลการจำลอง: renderJobs() ครั้งเดียว ===========');
  console.log('จำนวน Job ในรอบ            : ' + report.jobs);
  console.log('คำขอ HTTP ทั้งหมด          : ' + report.totalRequests);
  console.log('สายพร้อมกันสูงสุด          : ' + report.peakConcurrency + '  (เบราว์เซอร์จำกัด 6)');
  console.log('รอคิวนานสุด                : ' + report.maxQueueWaitMs + ' ms');
  console.log('คำขอสุดท้ายเสร็จที่         : ' + report.lastDoneMs + ' ms');
  console.log('write "สร้าง Job" ใช้เวลา   : ' + report.writeMs + ' ms  (สำเร็จ: ' + report.writeOk + ')');
  console.log('การ์ดที่ยังค้าง "…"        : ' + report.cardsStillDots + ' / ' + report.cardsTotal);
  console.log('ข้อความหัวรอบ              : ' + report.cycleText);
  console.log('\nแยกตาม path:');
  Object.keys(report.byPath).sort((a, b) => report.byPath[b] - report.byPath[a])
    .forEach(k => console.log('  ' + String(report.byPath[k]).padStart(5) + '  ' + k));

  await browser.close();
})();
