/* ============================================================
   กู้การเชื่อมต่อเองเมื่อเน็ตเครื่องเปลี่ยน (v2.9.4 · ปรับกติกาออฟไลน์ v2.9.5)
   ============================================================

   อาการหน้างานที่กันไว้: net::ERR_NETWORK_CHANGED ซ้ำ ๆ แล้วแอปค้าง "ออฟไลน์"
   + ตัวเลขค้าง "..." ทั้งที่เน็ตกลับมาแล้ว รีเฟรชหน้าอย่างเดียวถึงจะหาย

   ⚠️ กติกาตัดสิน "ออฟไลน์" เปลี่ยนที่ v2.9.5 — เทสไฟล์นี้ล็อกของใหม่
      v2.9.4: สาย CLOSED = ประกาศออฟไลน์ทันที
              → พอสายใดสายหนึ่งสะดุด (มือถือสลับ 4G/ล็อกจอ) banner เด้งทั้งที่ข้อมูล
                ยังไหลจากสายอื่นอยู่ = อาการ "ไม่ถึง 10 วิ ก็ออฟไลน์"
      v2.9.5: สายสะดุดหรือปิด → "นัดเปิดสายใหม่ทันที" เสมอ
              แต่ประกาศออฟไลน์ต่อเมื่อครบ grace 6 วิแล้วยังไม่มีสายไหนกลับมาเลย
              (สายไหนเปิดได้/มีเฟรมเข้ามาใน 6 วิ streamOk() ยกเลิกนัดตัดสินให้เอง)

   กันอะไร:
   [1] สาย SSE ที่ปิดจริง (readyState CLOSED) ต้องถูกนัดเปิดใหม่ทันที
       แต่ยังไม่ประกาศออฟไลน์ — รอ grace ก่อน (กติกา v2.9.5)
   [2] เวลาถอยเพิ่มจริง 2→4→8→16→30 วิ และตัน 30 · ต่อได้แล้วต้องรีเซ็ตกลับ 0
   [3] นัดรอบเดียวต่อหนึ่งครั้ง แม้ทุกสายจะร้อง error พร้อมกัน (ไม่ยิงถี่)
   [4] นัดครบเวลาแล้วต้องสร้าง EventSource ใบใหม่จริง
   [5] สายหนึ่งตายแต่อีกสายยังดี — streamOk ของสายที่ดีต้องไม่ไปยกเลิกนัดของสายที่ตาย
   [6] ปุ่ม "เชื่อมต่อใหม่" โผล่ตอนออฟไลน์ · กดแล้วเปิดสายใหม่ + โหลดข้อมูลหน้าที่เปิดอยู่
   [7] event 'online' ต้อง re-fetch ข้อมูลหน้าปัจจุบัน ไม่ใช่ flushQueue อย่างเดียว
   [8] คิวที่ยังไม่ได้ส่งต้องไม่ถูกล้างตอน re-fetch (กฎบ้าน "ห้ามทำยอดหาย")
   [9] grace 6 วิเดิมยังอยู่ · สายสะดุดต้องนัดเปิดใหม่ทันทีแต่ยังไม่เด้ง "ออฟไลน์"
   [9c] ⭐ ต้นเหตุที่ v2.9.5 แก้ — สายหนึ่งตายแต่อีกสายยังส่งเฟรมอยู่ ห้ามเด้งออฟไลน์
   [10] ออกจากระบบแล้วต้องไม่มีนัดค้างไว้เปิดสายคืนทีหลัง
   [12] กลับมาเห็นหน้าจอ (ปลุกจากล็อกจอ / กลับจาก bfcache) ต้องเปิดสายใหม่ + อ่านข้อมูลกลับ
   ============================================================ */

const { puppeteer, CHROME, APP_URL, forceLive } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

/* EventSource ปลอมที่สั่งได้ + fetch ปลอมที่นับคำขอ
   ต้องวางก่อน db.subscribe() ทุกครั้ง ไม่งั้นสายจริงจะวิ่งออกเน็ต */
const HARNESS = `
  window.__es = [];                       /* ทุกใบที่ถูกสร้าง เรียงตามเวลา */
  window.EventSource = function (u) {
    var self = this;
    this.url = u;
    this.readyState = 0;                  /* CONNECTING */
    this.closed = false;
    this.handlers = {};
    this.addEventListener = function (k, fn) { self.handlers[k] = fn; };
    this.close = function () { self.closed = true; self.readyState = 2; };
    window.__es.push(this);
  };
  /* จำลองสายต่อติด */
  window.__esOpen = function (es) { es.readyState = 1; if (es.onopen) es.onopen(); };
  /* จำลอง net::ERR_NETWORK_CHANGED — สายถูกฆ่าทิ้ง (CLOSED) แล้ว error */
  window.__esKill = function (es) { es.readyState = 2; if (es.onerror) es.onerror(); };
  /* จำลองสายสะดุดแต่เบราว์เซอร์ยังต่อใหม่ให้เอง (CONNECTING) */
  window.__esBlip = function (es) { es.readyState = 0; if (es.onerror) es.onerror(); };
  /* ใบล่าสุดที่ยัง "มีชีวิต" ของแต่ละสาย = ใบท้าย ๆ ที่ยังไม่ถูก close */
  window.__esLive = function () { return window.__es.filter(function (e) { return !e.closed; }); };

  window.__fetched = [];
  window.fetch = function (u, opts) {
    window.__fetched.push({ url: String(u).split('?')[0], method: (opts && opts.method) || 'GET' });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  };
  window.__fetchedPaths = function () {
    return window.__fetched.map(function (r) { return (r.url.split('.app/')[1] || r.url); });
  };

  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.session.token = function () { return 'tok'; };
  hideLogin();

  /* ดัก setTimeout เฉพาะช่วงที่ต้องการ — เอาไว้ดูเวลาถอยและสั่งให้นัดครบกำหนดทันที
     ไม่ต้องนั่งรอจริง 2+4+8+16+30 วิในชุดทดสอบ */
  window.__timers = [];
  window.__timerId = 0;
  window.__hookTimers = function () {
    if (window.__realTimeout) return;
    window.__realTimeout = window.setTimeout;
    window.__realClear = window.clearTimeout;
    window.setTimeout = function (fn, ms) {
      var id = ++window.__timerId;
      window.__timers.push({ id: id, fn: fn, ms: ms });
      return id;                           /* ไม่ยิงจริง — รอให้เทสสั่งเอง */
    };
    /* ต้อง stub คู่กันเสมอ — โค้ดจริงยกเลิกนัด grace ด้วย clearTimeout()
       ถ้าไม่เอาออกจากลิสต์ เทสจะไปสั่งยิงนัดที่ถูกยกเลิกไปแล้ว แล้วฟ้องผิด */
    window.clearTimeout = function (id) {
      window.__timers = window.__timers.filter(function (t) { return t.id !== id; });
      return window.__realClear.call(window, id);
    };
  };
  window.__unhookTimers = function () {
    if (!window.__realTimeout) return;
    window.setTimeout = window.__realTimeout;
    window.clearTimeout = window.__realClear;
    window.__realTimeout = null;
  };
  /* สั่งนัดที่หน่วงนานที่สุด (= นัดเปิดสายใหม่) ให้ครบกำหนดเดี๋ยวนี้ */
  window.__runTimer = function (ms) {
    var hit = window.__timers.filter(function (t) { return t.ms === ms; });
    window.__timers = window.__timers.filter(function (t) { return t.ms !== ms; });
    hit.forEach(function (t) { t.fn(); });
    return hit.length;
  };
  window.__timerDelays = function () { return window.__timers.map(function (t) { return t.ms; }); };
  /* ล้างนัดที่ค้างจากบล็อกก่อน — ไม่งั้น __runTimer(6000) จะไปยิงนัด grace ของบล็อกอื่นด้วย
     แล้วนับจำนวนครั้งที่ประกาศออฟไลน์เพี้ยน */
  window.__resetTimers = function () { window.__timers = []; };

  /* ข้อมูลขั้นต่ำให้หน้า Job วาดได้จริง */
  window.__seedApp = function () {
    state.me = { uid: 'u1', email: 'x@y.z', name: 'แอดมิน', role: 'admin', branches: [] };
    state.counter = 'แอดมิน';
    state.products = { P1: { code: 'P1', name: 'สินค้า P1', type: 'product', costPrice: 10, sellPrice: 20 } };
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', branchName: 'สาขาหนึ่ง',
                               jobCode: 'J1', cycleId: 'C1', status: 'counting', createdAt: 1000 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.jobStats = {}; state.cycleStats = {}; state.cycleData = null;
    try { localStorage.removeItem("jobStats:R1"); } catch (e) {}
    state.jobFilter = 'all'; state.jobBranch = 'all';
    state.systemQty = {}; state.counts = {}; state.scanQty = {}; state.zones = {};
    state.transfers = {}; state.transferQty = {};
    state.page = 'jobs';
    state.connection = 'online';
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

  /* ---------- [1] สายตายแล้วต้องนัดเปิดใหม่ ---------- */
  console.log('\n[1] สาย SSE ปิดจริง (ERR_NETWORK_CHANGED) → นัดเปิดใหม่');
  const r1 = await page.evaluate(() => {
    window.__status = [];
    db.onStatus(function (ok, why) { window.__status.push({ ok: ok, why: why }); });
    window.__unsub = db.subscribe('cycles', function () {});
    const es = window.__es[0];
    window.__esOpen(es);                       /* ต่อติดก่อน */
    const afterOpen = db.connInfo();
    window.__hookTimers();
    window.__esKill(es);                       /* เน็ตเครื่องเปลี่ยน — สายถูกฆ่า */
    const delays = window.__timerDelays();
    const info = db.connInfo();
    window.__unhookTimers();
    return { afterOpen: afterOpen, info: info, delays: delays,
             status: window.__status.slice(), streams: window.__es.length };
  });
  check('เปิดสายแล้วสถานะเป็นออนไลน์', r1.status.some(s => s.ok === true), r1.status);
  check('ต่อติดแล้วไม่มีนัดค้าง', r1.afterOpen.retryPending === false && r1.afterOpen.retryDelay === 0, r1.afterOpen);
  /* ⭐ v2.9.5 — สายตายแล้วยังไม่เด้ง banner ทันที รอ grace ก่อน
     (v2.9.4 เด้งทันที = ต้นเหตุ banner กะพริบตอนสายใดสายหนึ่งสะดุด) */
  check('สายตายแล้วยังไม่ประกาศออฟไลน์ทันที', r1.status.every(s => s.ok === true), r1.status);
  check('ตั้งนัดตัดสินออฟไลน์ไว้ที่ grace 6 วิ', r1.delays.indexOf(6000) >= 0, r1.delays);
  check('นับได้ว่ามีสายตายค้างอยู่ 1 สาย', r1.info.dead === 1, r1.info);
  check('นัดเปิดสายใหม่ทันที ไม่รอ grace', r1.info.retryPending === true, r1.info);
  check('รอบแรกถอยเวลา 2 วิ', r1.info.retryDelay === 2000 && r1.delays.indexOf(2000) >= 0, r1);

  /* ---------- [2]+[4] นัดครบเวลา → สร้างสายใหม่จริง + ถอยเวลาเพิ่ม ---------- */
  console.log('\n[2] ถอยเวลาเพิ่มทีละเท่า และสร้างสายใหม่จริงทุกรอบ');
  const r2 = await page.evaluate(() => {
    const steps = [];
    let expect = 2000;
    for (let i = 0; i < 6; i++) {
      window.__hookTimers();
      const before = window.__es.length;
      window.__runTimer(expect);                 /* นัดครบกำหนด → เปิดสายใหม่ */
      const made = window.__es.length - before;
      /* สายใหม่ก็ต่อไม่ติดอีก (เน็ตยังไม่กลับ) */
      const fresh = window.__es[window.__es.length - 1];
      window.__esKill(fresh);
      const info = db.connInfo();
      window.__unhookTimers();
      steps.push({ ran: expect, made: made, next: info.retryDelay, pending: info.retryPending });
      expect = info.retryDelay;
    }
    return steps;
  });
  check('ทุกรอบสร้าง EventSource ใบใหม่จริง', r2.every(s => s.made === 1), r2.map(s => s.made));
  check('เวลาถอยเดิน 4→8→16→30→30→30',
        r2.map(s => s.next).join(',') === '4000,8000,16000,30000,30000,30000', r2.map(s => s.next));
  check('เพดานไม่เกิน 30 วิ', r2.every(s => s.next <= 30000), r2.map(s => s.next));
  check('ยังมีนัดรออยู่ตลอดที่ยังต่อไม่ได้', r2.every(s => s.pending === true), r2.map(s => s.pending));

  /* ---------- [2b] ต่อได้แล้วต้องหยุด ---------- */
  console.log('\n[2b] ต่อได้แล้วเลิกนัด + รีเซ็ตเวลาถอย');
  const r2b = await page.evaluate(() => {
    const live = window.__esLive();
    live.forEach(function (es) { window.__esOpen(es); });
    const info = db.connInfo();
    return { info: info, live: live.length, lastStatus: window.__status[window.__status.length - 1] };
  });
  check('ไม่มีสายตายเหลือแล้ว', r2b.info.dead === 0, r2b.info);
  check('เลิกนัดเปิดสายใหม่', r2b.info.retryPending === false, r2b.info);
  check('เวลาถอยกลับไปเริ่มที่ 0 (ครั้งหน้าเริ่ม 2 วิใหม่)', r2b.info.retryDelay === 0, r2b.info);
  check('สถานะกลับเป็นออนไลน์', r2b.lastStatus.ok === true, r2b.lastStatus);

  /* ---------- [3] หลายสายร้องพร้อมกัน = นัดรอบเดียว ---------- */
  console.log('\n[3] ทุกสายร้องพร้อมกันต้องนัดรอบเดียว ไม่ยิงถี่');
  const r3 = await page.evaluate(() => {
    window.__unsub2 = db.subscribe('roundIndex', function () {});
    window.__unsub3 = db.subscribeChildren('rounds/R1/scans', function () {});
    window.__esLive().forEach(function (es) { window.__esOpen(es); });
    const liveBefore = window.__esLive().length;
    window.__hookTimers();
    window.__esLive().forEach(function (es) { window.__esKill(es); });   /* ตายพร้อมกันทุกสาย */
    const delays = window.__timerDelays().filter(function (m) { return m === 2000; });
    const info = db.connInfo();
    window.__unhookTimers();
    return { liveBefore: liveBefore, scheduled: delays.length, info: info };
  });
  check('มีสายเปิดอยู่หลายสายจริง', r3.liveBefore >= 3, r3.liveBefore);
  check('ทุกสายตายพร้อมกันแต่นัดแค่รอบเดียว', r3.scheduled === 1, r3);
  check('ยังเริ่มที่ 2 วิ ไม่ใช่สะสมจากรอบก่อน', r3.info.retryDelay === 2000, r3.info);

  /* ---------- [5] สายหนึ่งตาย อีกสายยังดี ---------- */
  console.log('\n[5] สายหนึ่งตายแต่อีกสายยังส่งข้อมูล — นัดของสายที่ตายต้องไม่ถูกยกเลิก');
  const r5 = await page.evaluate(() => {
    window.__hookTimers();
    window.__runTimer(2000);                       /* เปิดใหม่ทุกสายที่ตาย */
    window.__unhookTimers();
    const live = window.__esLive();
    live.forEach(function (es) { window.__esOpen(es); });   /* ทุกสายกลับมาดี */

    window.__hookTimers();
    const one = window.__esLive()[0];
    window.__esKill(one);                          /* สายเดียวตาย */
    const afterKill = db.connInfo();
    /* สายอื่นยังส่งข้อมูลเข้ามาเรื่อย ๆ → streamOk ถูกเรียก */
    window.__esLive().forEach(function (es) { if (es.onopen) es.onopen(); });
    const afterOk = db.connInfo();
    window.__unhookTimers();
    return { afterKill: afterKill, afterOk: afterOk };
  });
  check('สายเดียวตายก็ยังนัดเปิดใหม่', r5.afterKill.retryPending === true && r5.afterKill.dead === 1, r5.afterKill);
  check('สายที่ดีส่งข้อมูลเข้ามาแล้วนัดของสายที่ตายยังอยู่',
        r5.afterOk.retryPending === true && r5.afterOk.dead === 1, r5.afterOk);

  /* ---------- [9] grace 6 วิเดิมยังอยู่ ---------- */
  console.log('\n[9] สายแค่สะดุด (ยัง CONNECTING) ต้องไม่เด้งออฟไลน์ทันที');
  const r9 = await page.evaluate(() => {
    /* เคลียร์สภาพก่อน: เปิดทุกสายให้ดีหมด */
    window.__hookTimers(); window.__runTimer(db.connInfo().retryDelay); window.__unhookTimers();
    window.__esLive().forEach(function (es) { window.__esOpen(es); });
    window.__status.length = 0;

    window.__hookTimers();
    window.__resetTimers();                         /* เริ่มนับนัดของบล็อกนี้ใหม่ */
    window.__esBlip(window.__esLive()[0]);          /* CONNECTING — เบราว์เซอร์ต่อใหม่ให้เอง */
    const delays = window.__timerDelays();
    const info = db.connInfo();
    const statusNow = window.__status.slice();
    window.__unhookTimers();
    return { delays: delays, info: info, statusNow: statusNow };
  });
  check('ยังไม่ประกาศออฟไลน์ทันที', r9.statusNow.length === 0, r9.statusNow);
  check('ตั้ง grace 6 วิไว้เหมือนเดิม', r9.delays.indexOf(6000) >= 0, r9.delays);
  /* ⭐ v2.9.5 — ลองเปิดสายใหม่ตั้งแต่ยังอยู่ใน grace ไม่ต้องรอให้ครบ 6 วิก่อน
     ยิ่งเปิดใหม่ได้เร็ว โอกาสที่ banner จะไม่ต้องเด้งเลยยิ่งสูง */
  check('นัดเปิดสายใหม่ทันทีแม้ยังอยู่ใน grace',
        r9.info.retryPending === true && r9.info.retryDelay === 2000, r9.info);

  console.log('\n[9b] เลย grace แล้วยังไม่กลับ → ประกาศออฟไลน์ + นัดเปิดใหม่');
  const r9b = await page.evaluate(() => {
    window.__hookTimers();
    window.__runTimer(6000);                        /* grace ครบ */
    const info = db.connInfo();
    const st = window.__status.slice();
    window.__unhookTimers();
    return { info: info, st: st };
  });
  check('ประกาศออฟไลน์หลัง grace',
        r9b.st.length >= 1 && r9b.st.every(s => s.ok === false && s.why === 'stream'), r9b.st);
  check('และยังมีนัดเปิดสายใหม่ค้างอยู่ ไม่ใช่ตั้งออฟไลน์แล้วจบ', r9b.info.retryPending === true, r9b.info);

  /* ---------- [9c] ต้นเหตุที่ v2.9.5 แก้ ---------- */
  console.log('\n[9c] สายหนึ่งตายแต่อีกสายยังส่งเฟรม — ห้ามเด้ง "ออฟไลน์"');
  const r9c = await page.evaluate(() => {
    /* พาทุกสายกลับมาดีก่อน — เปิดสายที่มีอยู่ตรง ๆ ไม่เรียก db.reconnect()
       เพราะมันจะกินพื้นเวลา 1.5 วิไปจนบล็อกการกดปุ่มในข้อถัดไป */
    window.__esLive().forEach(function (es) { window.__esOpen(es); });
    window.__status.length = 0;

    window.__hookTimers();
    window.__resetTimers();
    var live = window.__esLive();
    window.__esKill(live[0]);                       /* สายหนึ่งตาย */
    var right = window.__status.slice();            /* ต้องยังเงียบ */
    /* สายที่เหลือมีเฟรมข้อมูลวิ่งเข้ามาเรื่อย ๆ ภายใน grace */
    window.__esLive().forEach(function (es) { if (es.onopen) es.onopen(); });
    var afterFrames = window.__status.slice();
    var ran = window.__runTimer(6000);              /* grace ครบ */
    var afterGrace = window.__status.slice();
    window.__unhookTimers();
    return { right: right, afterFrames: afterFrames, afterGrace: afterGrace, ran: ran,
             info: db.connInfo() };
  });
  check('สายเดียวตายแล้วยังเงียบอยู่ ไม่เด้ง banner', r9c.right.length === 0, r9c.right);
  check('สายที่เหลือส่งเฟรมเข้ามา = ยังออนไลน์อยู่',
        r9c.afterFrames.every(s => s.ok === true), r9c.afterFrames);
  check('grace ครบแล้วก็ยังไม่เด้งออฟไลน์ เพราะมีสายกลับมาแล้ว',
        r9c.afterGrace.every(s => s.ok === true), r9c.afterGrace);
  check('แต่ยังนัดเปิดสายที่ตายใหม่อยู่', r9c.info.retryPending === true && r9c.info.dead === 1, r9c.info);

  /* ---------- [10] ออกจากระบบ ---------- */
  console.log('\n[10] ออกจากระบบแล้วต้องไม่มีนัดค้าง');
  const r10 = await page.evaluate(() => {
    db.closeAll();
    return db.connInfo();
  });
  check('ตัดทุกสายทิ้ง', r10.streams === 0, r10);
  check('ไม่มีนัดเปิดสายคืนค้างอยู่', r10.retryPending === false && r10.retryDelay === 0, r10);

  /* ---------- [6] ปุ่มเชื่อมต่อใหม่ ---------- */
  console.log('\n[6] ปุ่ม "เชื่อมต่อใหม่" บนแถบสถานะ');
  const btn = await page.evaluate(() => {
    window.__seedApp();
    state.connection = 'online';
    renderConnection();
    const b = document.getElementById('btnReconnect');
    const onlineShown = getComputedStyle(b).display !== 'none';
    state.connection = 'offline';
    renderConnection();
    const r = b.getBoundingClientRect();
    return {
      onlineShown: onlineShown,
      offlineShown: getComputedStyle(b).display !== 'none',
      label: b.textContent,
      inBar: b.parentElement.id === 'connBar',
      h: Math.round(r.height),
      wired: typeof b.onclick === 'function'
    };
  });
  check('ตอนออนไลน์ไม่โชว์ปุ่ม (ไม่ให้รกแถบ)', btn.onlineShown === false, btn);
  check('ตอนออฟไลน์โชว์ปุ่ม', btn.offlineShown === true, btn);
  check('ปุ่มอยู่บนแถบสถานะจริง', btn.inBar === true, btn);
  check('ป้ายปุ่มถูกต้อง', btn.label === '🔄 เชื่อมต่อใหม่', btn.label);
  check('ปุ่มแตะง่าย (>=36px)', btn.h >= 36, btn.h);
  check('ผูกปุ่มไว้แล้วตั้งแต่ init()', btn.wired === true, btn);

  console.log('\n[6b] กดปุ่มแล้วเปิดสายใหม่ + โหลดข้อมูลหน้าที่เปิดอยู่');
  const r6 = await page.evaluate(async () => {
    /* เปิดสายใหม่จำลองสภาพหลังล็อกอิน แล้วทำให้ตายทั้งหมด */
    window.__es.length = 0;
    db.subscribe('cycles', function () {});
    db.subscribe('roundIndex', function () {});
    window.__esLive().forEach(function (es) { window.__esOpen(es); });
    window.__esLive().forEach(function (es) { window.__esKill(es); });
    const esBefore = window.__es.length;

    window.__fetched.length = 0;
    window.__toasts.length = 0;
    state.connection = 'offline';
    state.cycleStats = { C1: { pieces: 1 } };
    state.cycleData = { cid: 'C1' };
    renderConnection();

    const ok = manualReconnect();
    /* ต้องอ่านทันที — รอไปแล้วแคชจะถูกเติมกลับเพราะโหลดใหม่สำเร็จ (ซึ่งคือสิ่งที่ต้องการ) */
    const clearedNow = { stats: Object.keys(state.cycleStats).length, data: state.cycleData };
    await new Promise(function (r) { setTimeout(r, 400); });
    const b = document.getElementById('btnReconnect');
    return {
      ok: ok,
      newStreams: window.__es.length - esBefore,
      disabledRightAfter: b.disabled,
      label: b.textContent,
      paths: window.__fetchedPaths(),
      cycleStatsCleared: clearedNow.stats === 0,
      cycleDataCleared: clearedNow.data === null,
      toast: (window.__toasts[0] || {}).m
    };
  });
  check('กดแล้วทำงาน', r6.ok === true, r6.ok);
  check('เปิด EventSource ใบใหม่ทุกสาย', r6.newStreams === 2, r6);
  check('ปิดปุ่มกันกดรัวทันที', r6.disabledRightAfter === true, r6);
  check('เปลี่ยนป้ายบอกว่ากำลังทำงาน', r6.label === '⏳ กำลังเชื่อมต่อ...', r6.label);
  check('ล้างแคชสถิติรอบให้โหลดใหม่', r6.cycleStatsCleared === true, r6);
  check('ล้างแคชยอดรวมทั้งรอบให้โหลดใหม่', r6.cycleDataCleared === true, r6);
  check('ยิงอ่านยอดระบบของรอบกลับมาจริง',
        r6.paths.some(p => /systemQty\.json$/.test(p)), r6.paths.slice(0, 8));
  check('ยิงอ่านสถิติใบนับกลับมาจริง (การ์ดจะได้ไม่ค้าง "...")',
        r6.paths.some(p => /rounds\/R1\/scans\.json$/.test(p)), r6.paths.slice(0, 8));
  check('บอกผู้ใช้ว่ากำลังทำอะไรอยู่', /เชื่อมต่อใหม่/.test(r6.toast || ''), r6.toast);

  console.log('\n[6c] กดรัวต้องไม่ยิงซ้ำ');
  const r6c = await page.evaluate(() => {
    const esBefore = window.__es.length;
    const fetchBefore = window.__fetched.length;
    const again = [manualReconnect(), manualReconnect(), manualReconnect()];
    return { again: again, newStreams: window.__es.length - esBefore,
             newFetch: window.__fetched.length - fetchBefore };
  });
  check('กดซ้ำตอนปุ่มยังปิดอยู่ = ไม่ทำอะไร', r6c.again.every(v => v === false), r6c.again);
  check('ไม่เปิดสายเพิ่ม', r6c.newStreams === 0, r6c);
  check('ไม่ยิงคำขอเพิ่ม', r6c.newFetch === 0, r6c);

  /* ---------- [7] event 'online' ---------- */
  console.log('\n[7] เน็ตเครื่องกลับมา (event online) ต้อง re-fetch ไม่ใช่แค่ flushQueue');
  const r7 = await page.evaluate(async () => {
    window.__seedApp();
    state.cycleStats = { C1: { pieces: 9 } };
    state.cycleData = { cid: 'C1' };
    window.__fetched.length = 0;
    /* ปุ่มถูกปิดค้างจากข้อก่อน — ปลดเองเพื่อไม่ให้เกี่ยวกับข้อนี้ */
    document.getElementById('btnReconnect').disabled = false;

    window.dispatchEvent(new Event('online'));
    await new Promise(function (r) { setTimeout(r, 1100); });   /* รอ debounce 700ms */
    return {
      paths: window.__fetchedPaths(),
      /* แคชยอดรวมทั้งรอบไม่มีใครเติมกลับให้เอง (โหลดตอนเปิดหน้าสรุป) จึงยังเช็คตรง ๆ ได้ */
      cycleDataCleared: state.cycleData === null
    };
  });
  check('โหลดยอดระบบของรอบกลับมา', r7.paths.some(p => /systemQty\.json$/.test(p)), r7.paths.slice(0, 8));
  check('โหลดสถิติใบนับกลับมา', r7.paths.some(p => /rounds\/R1\/scans\.json$/.test(p)), r7.paths.slice(0, 8));
  check('ล้างแคชยอดรวมทั้งรอบ', r7.cycleDataCleared === true, r7);

  console.log('\n[7b] สัญญาณกลับมารัว ๆ ต้องรวบเป็นการโหลดรอบเดียว');
  const r7b = await page.evaluate(async () => {
    window.__seedApp();
    window.__fetched.length = 0;
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('online'));
    await new Promise(function (r) { setTimeout(r, 1100); });
    const scans = window.__fetchedPaths().filter(p => /rounds\/R1\/scans\.json$/.test(p));
    return { scans: scans.length, total: window.__fetched.length };
  });
  check('ยิง 5 สัญญาณแต่โหลดสถิติรอบเดียว', r7b.scans === 1, r7b);

  /* ---------- [8] คิวที่ยังไม่ส่งต้องไม่หาย ---------- */
  console.log('\n[8] คิวที่ยังไม่ได้ส่งต้องไม่ถูกล้างตอน re-fetch');
  const r8 = await page.evaluate(async () => {
    window.__seedApp();
    /* ใส่คิวค้างไว้ตรง ๆ ที่ localStorage เหมือนของจริง แล้วห้าม flush ออก */
    const key = QUEUE_KEY;
    const rows = [
      { path: 'rounds/R1/scans', patch: { s1: { code: 'P1', delta: 1 } }, remote: true },
      { path: 'rounds/R1/scans', patch: { s2: { code: 'P1', delta: 2 } }, remote: true }
    ];
    localStorage.setItem(key, JSON.stringify(rows));
    const before = pendingCount();
    reloadCurrentPage();
    await new Promise(function (r) { setTimeout(r, 300); });
    const after = pendingCount();
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return { key: key, before: before, after: after, rows: raw.length,
             first: (raw[0] || {}).path, patchKeys: Object.keys((raw[0] || {}).patch || {}) };
  });
  check('หาคีย์คิวในเครื่องเจอ (ไม่งั้นเทสข้อนี้ไม่มีความหมาย)', r8.before === 2, r8);
  check('re-fetch แล้วคิวยังอยู่ครบ', r8.after === 2 && r8.rows === 2, r8);
  check('เนื้อในคิวไม่ถูกแตะ', r8.first === 'rounds/R1/scans' && r8.patchKeys[0] === 's1', r8);

  /* ---------- [11] โหมดทดสอบ (ไม่ต่อฐาน) ต้องไม่พัง ---------- */
  console.log('\n[11] ของที่ไม่เกี่ยวต้องไม่พัง');
  const r11 = await page.evaluate(() => {
    const saved = state.me;
    state.me = null;
    window.__fetched.length = 0;
    reloadCurrentPage();                 /* ยังไม่ได้ล็อกอิน = ต้องไม่ยิงอะไรเลย */
    const quiet = window.__fetched.length;
    state.me = saved;
    return { quiet: quiet };
  });
  check('ยังไม่ล็อกอินก็ไม่ยิงคำขอ', r11.quiet === 0, r11);

  /* ---------- [12] กลับมาเห็นหน้าจอ (v2.9.5) ---------- */
  console.log('\n[12] ปลุกจากล็อกจอ / กลับจาก bfcache ต้องเปิดสายใหม่ + อ่านข้อมูลกลับ');
  const r12 = await page.evaluate(async () => {
    /* headless บางโหมดรายงานว่าหน้าถูกซ่อนอยู่ — บังคับให้ "เห็นอยู่" เพื่อเทสเส้นทางจริง */
    Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
    window.__seedApp();
    window.__es.length = 0;
    db.subscribe('cycles', function () {});
    db.subscribe('roundIndex', function () {});
    const esBefore = window.__es.length;
    const tracked = db.connInfo().streams;     /* reopenStreams() เปิดใหม่ "ทุกสายในทะเบียน" */
    window.__fetched.length = 0;
    /* พื้นเวลา 1.5 วิของ db.reconnect() — รอให้พ้นก่อน ไม่งั้นวัดไม่ได้ว่ามันทำงานไหม */
    await new Promise(function (r) { setTimeout(r, 1600); });

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(function (r) { setTimeout(r, 1100); });   /* รอ debounce 700ms */
    const afterVis = { streams: window.__es.length - esBefore, tracked: tracked,
                       paths: window.__fetchedPaths() };

    const esMid = window.__es.length;
    window.__fetched.length = 0;
    await new Promise(function (r) { setTimeout(r, 1600); });
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await new Promise(function (r) { setTimeout(r, 1100); });
    const afterShow = { streams: window.__es.length - esMid, tracked: db.connInfo().streams,
                        paths: window.__fetchedPaths() };
    return { afterVis: afterVis, afterShow: afterShow };
  });
  check('กลับมาเห็นหน้าจอแล้วเปิดสายใหม่ครบทุกสาย',
        r12.afterVis.tracked > 0 && r12.afterVis.streams === r12.afterVis.tracked, r12.afterVis);
  check('และอ่านข้อมูลหน้าที่เปิดอยู่กลับมาด้วย',
        r12.afterVis.paths.some(p => /systemQty\.json$/.test(p)), r12.afterVis.paths.slice(0, 6));
  check('กลับจาก bfcache ก็เปิดสายใหม่ครบทุกสาย',
        r12.afterShow.tracked > 0 && r12.afterShow.streams === r12.afterShow.tracked, r12.afterShow);
  check('bfcache แล้วอ่านข้อมูลกลับมาด้วย',
        r12.afterShow.paths.some(p => /systemQty\.json$/.test(p)), r12.afterShow.paths.slice(0, 6));

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
