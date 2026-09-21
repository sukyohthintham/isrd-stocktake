/* ============================================================
   v2.16.0 — โหมดทดสอบ · ประเภทตอนยิง · รายงาน "มีสต็อก ไม่มีโชว์"
   ============================================================

   ที่มา: เดิมต้องแยก Job คนละใบ (SHOW / STOCK / STOCKASSET) เพื่อให้รู้ว่า
   ของอยู่ฝั่งไหน สาขาหนึ่งจึงมีสามใบ ยอดกระจาย ต้องไล่เปิดทีละใบ
   ตอนนี้ใบเดียวพอ แล้วติดประเภทไปกับทุกแถวที่ยิงแทน

   สิ่งที่ต้องคุม:
   [1] เปิดจากไฟล์ในเครื่อง = ห้ามแตะ production เด็ดขาด (ไม่ใช่แค่ "ไม่ค่อยแตะ")
   [2] ประเภทที่เลือกต้องติดไปกับแถว scan จริง และจำแยกรายรอบ
   [3] จำแนกถูก + ถอยไปเดาจาก foundZone ได้เมื่อแถวเก่าไม่มี stockType
       + ยอดโชว์ + ยอดสต็อก ต้องเท่าจำนวนจริง (ยกเว้นที่ยังระบุไม่ได้)
   [4] ไฟล์ Excel ออกครบ 4 ชีทด้วย buildXlsx เดิม ไม่มีไลบรารีนอก
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
  const netHits = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('request', r => {
    if (/firebasedatabase\.app|identitytoolkit|securetoken/.test(r.url())) netHits.push(r.url());
  });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  /* ---------- [1] โหมดทดสอบ ---------- */
  console.log('\n[1] ⭐ เปิดจากไฟล์ในเครื่อง = ห้ามแตะ production');
  const r1 = await page.evaluate(() => ({
    preview: PREVIEW_MODE,
    remote: REMOTE_MODE,
    dbRemote: db.remote,
    url: FIREBASE_CONFIG.databaseURL,
    protocol: location.protocol,
    bannerHost: document.getElementById('modeBannerHost').style.display,
    banner: (document.getElementById('previewBanner') || {}).textContent || ''
  }));
  check('PREVIEW_MODE เปิดเองเมื่อ protocol เป็น file:', r1.preview === true, r1);
  check('⭐ databaseURL ถูกล้างทิ้ง', r1.url === '', r1.url);
  check('⭐ REMOTE_MODE เป็นเท็จ', r1.remote === false && r1.dbRemote === false, r1);
  check('⭐ ไม่มีคำขอไป Firebase เลยสักใบ', netHits.length === 0, netHits.slice(0, 3));
  check('แบนเนอร์โผล่ตลอดเวลา (นอก #modeBanner ที่ถูกล้างตอนวาดหน้า Job)',
        r1.bannerHost !== 'none', r1.bannerHost);
  check('แบนเนอร์บอกว่าไม่กระทบ production',
        /โหมดทดสอบ/.test(r1.banner) && /ไม่กระทบ production/.test(r1.banner), r1.banner);

  const r1b = await page.evaluate(async () => {
    /* ครบวง: เขียน → อ่านกลับ → ต้องอยู่ใน localStorage ไม่ใช่บนเน็ต */
    try { localStorage.removeItem('isrd_stocktake_v1'); } catch (e) {}
    await db.update('roundIndex', { RP: { id: 'RP', jobCode: 'PREV', branchCode: 'B1',
                                          cycleId: 'CP', status: 'counting', createdAt: 1 } });
    const back = await db.get('roundIndex/RP');
    return { wrote: !!back, code: back && back.jobCode,
             inStore: (localStorage.getItem('isrd_stocktake_v1') || '').indexOf('PREV') >= 0 };
  });
  check('สร้าง Job ในโหมดทดสอบได้', r1b.wrote === true && r1b.code === 'PREV', r1b);
  check('⭐ ข้อมูลลง localStorage (รอด reload)', r1b.inStore === true, r1b);

  /* ---------- ตัวช่วย seed ---------- */
  await page.evaluate(() => {
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.__writes = [];
    window.enqueueWrite = function (p, patch) { window.__writes.push({ path: p, patch: patch }); };
    window.db.newKey = (function () { let i = 0; return function () { return 'g' + (++i); }; })();
    hideLogin();

    window.__seed = function (scans) {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'STOCK-01',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.products = {
        NTBG001: { code: 'NTBG001', name: 'กระเป๋า', type: 'product', costPrice: 100 },
        NTOV002: { code: 'NTOV002', name: 'เสื้อโค้ต', type: 'product', costPrice: 50 },
        NTBG003: { code: 'NTBG003', name: 'กระเป๋าใบเล็ก', type: 'product', costPrice: 20 },
        SOSALE9: { code: 'SOSALE9', name: 'ของลดราคา', type: 'product', costPrice: 10 },
        NTOV004: { code: 'NTOV004', name: 'ของยังไม่ระบุ', type: 'product', costPrice: 5 }
      };
      state.systemQty = { NTBG001: 9, NTOV002: 9, NTBG003: 9, SOSALE9: 9, NTOV004: 9 };
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.cycleData = null; state.priceField = 'costPrice'; state.summaryTab = 'sd';
      state.sdSort = 'value';
      state.scanLog = (scans || []).map(function (r, i) {
        return { id: 's' + i, rec: r };
      });
      buildScanIndex();
      window.__toasts = []; window.__writes = [];
    };

    window.__SCANS = [
      /* มีสต็อกไม่มีโชว์ — มูลค่าสูงสุด (5 × 100) */
      { code: 'NTBG001', delta: 5, mode: 'scan', user: 'ท', ts: 1, stockType: 'stock', foundZone: 'SA-2' },
      /* มีทั้งสองฝั่ง */
      { code: 'NTOV002', delta: 2, mode: 'scan', user: 'ท', ts: 2, stockType: 'stock' },
      { code: 'NTOV002', delta: 3, mode: 'scan', user: 'ท', ts: 3, stockType: 'display' },
      /* มีโชว์ไม่มีสต็อก */
      { code: 'NTBG003', delta: 4, mode: 'scan', user: 'ท', ts: 4, stockType: 'display' },
      /* แถวเก่าไม่มี stockType — ต้องถอยไปเดาจาก foundZone (S = สต็อก) */
      { code: 'SOSALE9', delta: 7, mode: 'scan', user: 'ท', ts: 5, foundZone: 'SB-1' },
      /* เดาไม่ได้เลย — ต้องไปอยู่กลุ่มยังไม่ระบุ ไม่ใช่เดามั่ว */
      { code: 'NTOV004', delta: 6, mode: 'scan', user: 'ท', ts: 6 }
    ];
  });

  /* ---------- [2] ปุ่มประเภทตอนยิง ---------- */
  console.log('\n[2] ปุ่มเลือกประเภทตอนยิง');
  const r2 = await page.evaluate(() => {
    window.__seed([]);
    try { localStorage.removeItem('isrd_scantype_R1'); } catch (e) {}
    loadScanType();
    const read = function () {
      return Array.prototype.map.call(document.querySelectorAll('[data-scantype]'), function (b) {
        return { t: b.getAttribute('data-scantype'), on: b.classList.contains('on'),
                 label: b.textContent };
      });
    };
    const start = { btns: read(), state: state.scanType };
    document.querySelector('[data-scantype="display"]').click();
    const afterClick = { btns: read(), state: state.scanType,
                         saved: localStorage.getItem('isrd_scantype_R1') };
    /* ยิงจริงแล้วดูว่าแถวติดประเภทไปด้วยไหม */
    window.__writes = [];
    writeScan('NTBG001', 1, 'scan', null);
    const rec = window.__writes[0].patch[Object.keys(window.__writes[0].patch)[0]];

    /* เปลี่ยน Job แล้วค่าต้องเป็นของใบใหม่ ไม่ติดมาจากใบเก่า */
    state.roundId = 'R2';
    loadScanType();
    const otherRound = state.scanType;
    state.roundId = 'R1';
    loadScanType();
    const backAgain = state.scanType;
    return { start: start, afterClick: afterClick, rec: rec,
             otherRound: otherRound, backAgain: backAgain };
  });
  check('มีปุ่ม 3 ตัว: โชว์ / สต็อก / Asset',
        r2.start.btns.map(function (b) { return b.t; }).join(',') === 'display,stock,asset',
        r2.start.btns);
  check('ป้ายปุ่มอ่านออก', /โชว์/.test(r2.start.btns[0].label) &&
        /สต็อก/.test(r2.start.btns[1].label) && /Asset/.test(r2.start.btns[2].label),
        r2.start.btns.map(function (b) { return b.label; }));
  check('⭐ ค่าเริ่มต้นเป็น "สต็อก"', r2.start.state === 'stock' && r2.start.btns[1].on === true,
        r2.start);
  check('กดแล้วสลับ + ไฮไลต์ตาม',
        r2.afterClick.state === 'display' && r2.afterClick.btns[0].on === true &&
        r2.afterClick.btns[1].on === false, r2.afterClick);
  check('⭐ จำไว้ใน localStorage รายรอบ', r2.afterClick.saved === 'display', r2.afterClick.saved);
  check('⭐ แถวที่ยิงติด stockType ไปด้วย', r2.rec.stockType === 'display', r2.rec);
  check('ฟิลด์เดิมยังครบ (Rules บังคับ code/zone/delta/user/ts)',
        !!r2.rec.code && !!r2.rec.zone && r2.rec.delta === 1 && !!r2.rec.user && !!r2.rec.ts,
        r2.rec);
  check('⭐ เปลี่ยน Job แล้วค่าไม่ติดมาจากใบเก่า', r2.otherRound === 'stock', r2.otherRound);
  check('กลับมาใบเดิมแล้วได้ค่าเดิมคืน', r2.backAgain === 'display', r2.backAgain);

  /* ---------- [3] การจำแนก ---------- */
  console.log('\n[3] ⭐ จำแนก โชว์ / สต็อก');
  const r3 = await page.evaluate(() => {
    window.__seed(window.__SCANS);
    const rep = stockDisplayReport();
    const by = {};
    rep.rows.forEach(function (r) { by[r.code] = r; });
    return { rep: { counts: rep.counts, pct: rep.pct, total: rep.total,
                    groups: rep.groups.map(function (g) { return g.group + ':' + g.skus; }) },
             by: by };
  });
  check('จำแนกจาก stockType ตรง ๆ (NTBG001 = มีสต็อกไม่มีโชว์)',
        r3.by.NTBG001.status === 'stock_no_display' && r3.by.NTBG001.stockQty === 5 &&
        r3.by.NTBG001.dispQty === 0, r3.by.NTBG001);
  check('ของที่มีทั้งสองฝั่ง (NTOV002)',
        r3.by.NTOV002.status === 'both' && r3.by.NTOV002.stockQty === 2 &&
        r3.by.NTOV002.dispQty === 3, r3.by.NTOV002);
  check('มีโชว์ไม่มีสต็อก (NTBG003)',
        r3.by.NTBG003.status === 'display_no_stock' && r3.by.NTBG003.dispQty === 4,
        r3.by.NTBG003);
  check('⭐ แถวเก่าไม่มี stockType → ถอยไปเดาจาก foundZone (SB-1 = สต็อก)',
        r3.by.SOSALE9.status === 'stock_no_display' && r3.by.SOSALE9.stockQty === 7,
        r3.by.SOSALE9);
  check('⭐ เดาไม่ได้เลย → ยังไม่ระบุ ไม่ใช่เดามั่ว',
        r3.by.NTOV004.status === 'uncategorized' &&
        r3.by.NTOV004.dispQty === 0 && r3.by.NTOV004.stockQty === 0, r3.by.NTOV004);
  check('⭐ โชว์ + สต็อก = จำนวนจริง (ยกเว้นที่ยังระบุไม่ได้)',
        Object.keys(r3.by).every(function (c) {
          const r = r3.by[c];
          if (r.status === 'uncategorized') return true;
          return r.dispQty + r.stockQty === r.act;
        }), r3.by);
  check('กลุ่มสินค้าตัดคำนำหน้า NT/SO ออก (NTBG001 → BG)',
        r3.by.NTBG001.group === 'BG' && r3.by.NTBG003.group === 'BG' &&
        r3.by.NTOV002.group === 'OV', r3.by);
  check('รหัสที่มีคำว่า SALE เป็นกลุ่ม SALE', r3.by.SOSALE9.group === 'SALE', r3.by.SOSALE9);
  check('มูลค่า = Stock × ราคา (5 × 100 = 500)', r3.by.NTBG001.value === 500, r3.by.NTBG001);
  check('นับครบทุกกลุ่ม', r3.rep.total === 5 &&
        r3.rep.counts.stock_no_display === 2 && r3.rep.counts.display_no_stock === 1 &&
        r3.rep.counts.both === 1 && r3.rep.counts.uncategorized === 1, r3.rep.counts);
  check('⭐ สัดส่วน % รวมกันได้ 100',
        Math.round((r3.rep.pct.stock_no_display + r3.rep.pct.display_no_stock +
                    r3.rep.pct.both + r3.rep.pct.uncategorized) * 10) / 10 === 100, r3.rep.pct);
  check('บอกว่ากระจุกกลุ่มไหน (BG มากสุด)',
        r3.rep.groups[0].indexOf('BG:') === 0, r3.rep.groups);

  /* 5 รายการหารลงตัว เลยไม่เจอเศษการปัด — ต้องลองชุดที่หารไม่ลง
     3/7 + 1/7 + 2/7 + 1/7 ปัดทีละตัวได้ 42.9+14.3+28.6+14.3 = 100.1 ถ้าไม่ยกเศษ */
  const r3pct = await page.evaluate(() => {
    window.__seed([]);
    state.products.NTOV005 = { code: 'NTOV005', name: 'ของเพิ่ม', type: 'product', costPrice: 1 };
    state.products.NTBG006 = { code: 'NTBG006', name: 'ของเพิ่มสอง', type: 'product', costPrice: 1 };
    state.systemQty.NTOV005 = 9; state.systemQty.NTBG006 = 9;
    state.scanLog = [
      { code: 'NTBG001', delta: 1, mode: 'scan', user: 'ท', ts: 1, stockType: 'stock' },
      { code: 'SOSALE9', delta: 1, mode: 'scan', user: 'ท', ts: 2, stockType: 'stock' },
      { code: 'NTOV005', delta: 1, mode: 'scan', user: 'ท', ts: 3, stockType: 'stock' },
      { code: 'NTBG003', delta: 1, mode: 'scan', user: 'ท', ts: 4, stockType: 'display' },
      { code: 'NTOV002', delta: 1, mode: 'scan', user: 'ท', ts: 5, stockType: 'stock' },
      { code: 'NTOV002', delta: 1, mode: 'scan', user: 'ท', ts: 6, stockType: 'display' },
      { code: 'NTBG006', delta: 1, mode: 'scan', user: 'ท', ts: 7, stockType: 'stock' },
      { code: 'NTBG006', delta: 1, mode: 'scan', user: 'ท', ts: 8, stockType: 'display' },
      { code: 'NTOV004', delta: 1, mode: 'scan', user: 'ท', ts: 9 }
    ].map(function (r, i) { return { id: 'x' + i, rec: r }; });
    state.counts = {}; state.scanQty = {}; state.appliedScanIds = Object.create(null);
    buildScanIndex();
    const rep = stockDisplayReport();
    return { counts: rep.counts, pct: rep.pct, total: rep.total };
  });
  check('ชุดที่หารไม่ลงตัวจำแนกได้ 3/1/2/1', r3pct.total === 7 &&
        r3pct.counts.stock_no_display === 3 && r3pct.counts.display_no_stock === 1 &&
        r3pct.counts.both === 2 && r3pct.counts.uncategorized === 1, r3pct.counts);
  check('⭐ ปัดแล้วยังรวมได้ 100 พอดี ไม่ใช่ 100.1',
        Math.round((r3pct.pct.stock_no_display + r3pct.pct.display_no_stock +
                    r3pct.pct.both + r3pct.pct.uncategorized) * 10) / 10 === 100, r3pct.pct);
  check('⭐ เศษไปลงกลุ่มใหญ่สุด กลุ่มเล็กยังตรงตามจริง',
        r3pct.pct.stock_no_display === 42.8 && r3pct.pct.display_no_stock === 14.3 &&
        r3pct.pct.both === 28.6 && r3pct.pct.uncategorized === 14.3, r3pct.pct);

  /* ---------- [3b] หน้าจอ ---------- */
  console.log('\n[3b] แท็บรายงานบนหน้าสรุป');
  const r3b = await page.evaluate(() => {
    window.__seed(window.__SCANS);
    setSummaryTab('sd');
    const cards = Array.prototype.map.call(document.querySelectorAll('[data-sdcard]'), function (c) {
      return { k: c.getAttribute('data-sdcard'),
               n: c.querySelector('[data-sdnum]').textContent,
               pct: c.querySelector('[data-sdpct]').textContent };
    });
    const rows = Array.prototype.map.call(document.querySelectorAll('#sdBody [data-sdrow]'),
      function (tr) { return tr.getAttribute('data-sdrow'); });
    return {
      tabShown: document.getElementById('sumSd').style.display,
      jobHidden: document.getElementById('sumJob').style.display,
      cards: cards,
      donuts: document.querySelectorAll('#sdDonut [data-sddonut]').length,
      donutPct: Array.prototype.map.call(document.querySelectorAll('#sdDonut text'),
        function (t) { return t.textContent; }),
      legend: Array.prototype.map.call(document.querySelectorAll('[data-sdlegend]'),
        function (e) { return e.textContent; }),
      rows: rows,
      chip: document.getElementById('sdChip').textContent,
      branch: document.getElementById('sdBranchLine').textContent,
      date: document.getElementById('sdAuditDate').textContent,
      groups: document.querySelectorAll('[data-sdgroup]').length
    };
  });
  check('สลับมาแท็บนี้แล้วโชว์', r3b.tabShown === 'block' && r3b.jobHidden === 'none', r3b);
  check('การ์ด 4 ใบครบ', r3b.cards.length === 4, r3b.cards);
  check('การ์ดมี % ทุกใบ', r3b.cards.every(function (c) { return /%$/.test(c.pct); }), r3b.cards);
  check('โดนัทมี % ตรงกลาง', r3b.donutPct.every(function (t) { return /%$/.test(t); }),
        r3b.donutPct);
  check('legend บอกทั้งจำนวนและ %',
        r3b.legend.every(function (t) { return /SKU/.test(t) && /%/.test(t); }), r3b.legend);
  check('⭐ ตารางโชว์เฉพาะ "มีสต็อกไม่มีโชว์" 2 รายการ',
        r3b.rows.length === 2 && r3b.chip === '2', r3b.rows);
  check('เรียงมูลค่ามาก→น้อย (NTBG001 500 มาก่อน SOSALE9 70)',
        r3b.rows[0] === 'NTBG001', r3b.rows);
  check('มีชื่อสาขา + วันที่ Audit ไว้แคปส่งทีม',
        /^สาขา: .+/.test(r3b.branch) && /^วันที่ Audit: .+/.test(r3b.date) &&
        !/undefined|NaN/.test(r3b.branch + r3b.date), { b: r3b.branch, d: r3b.date });
  check('มีแถบกระจุกกลุ่มไหน', r3b.groups > 0, r3b.groups);

  const r3c = await page.evaluate(() => {
    setSummaryTab('sd');
    const rows = function () {
      return Array.prototype.map.call(document.querySelectorAll('#sdBody [data-sdrow]'),
        function (tr) { return tr.getAttribute('data-sdrow'); });
    };
    document.getElementById('sdSearch').value = 'SALE';
    document.getElementById('sdSearch').oninput();
    const searched = rows();
    document.getElementById('sdSearch').value = '';
    document.getElementById('sdSearch').oninput();
    document.querySelector('[data-sdsort="qty"]').click();
    const byQty = rows();
    document.querySelector('[data-sdsort="code"]').click();
    const byCode = rows();
    document.getElementById('sdSearch').value = 'ไม่มีคำนี้';
    document.getElementById('sdSearch').oninput();
    const none = rows();
    document.getElementById('sdSearch').value = '';
    document.getElementById('sdSearch').oninput();
    return { searched: searched, byQty: byQty, byCode: byCode, none: none };
  });
  check('ค้นหาได้', r3c.searched.join(',') === 'SOSALE9', r3c.searched);
  check('เรียงตามจำนวนได้ (SOSALE9 7 ชิ้น มาก่อน NTBG001 5 ชิ้น)',
        r3c.byQty[0] === 'SOSALE9', r3c.byQty);
  check('เรียงตามรหัสได้', r3c.byCode[0] === 'NTBG001', r3c.byCode);
  check('ไม่เจอ = ไม่เหลือแถว', r3c.none.length === 0, r3c.none);

  /* ---------- [4] Excel 4 ชีท ---------- */
  console.log('\n[4] ไฟล์ Excel 4 ชีท');
  const r4 = await page.evaluate(() => {
    window.__seed(window.__SCANS);
    let sheets = null, fileName = null;
    const realBuild = window.buildXlsx;
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.buildXlsx = function (s) { sheets = s; return realBuild(s); };
    URL.createObjectURL = function () { return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    exportStockDisplayExcel();
    window.buildXlsx = realBuild;
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return {
      names: sheets.map(function (s) { return s.name; }),
      head2: sheets[1].rows[0],
      head3: sheets[2].rows[0],
      head4: sheets[3].rows[0],
      s2rows: sheets[1].rows.slice(1).map(function (r) { return r[0] + ':' + r[6]; }),
      s3rows: sheets[2].rows.slice(1).map(function (r) { return r[0]; }),
      s4count: sheets[3].rows.length - 1,
      summary: sheets[0].rows.filter(function (r) { return r.length === 4 && r[0] !== 'สถานะ'; }),
      widths: sheets.map(function (s) { return s.widths.length; }),
      fileName: fileName,
      toast: (window.__toasts[0] || {}).m
    };
  });
  check('ได้ 4 ชีทตามที่ตกลง',
        r4.names.join(',') === 'สรุป,มีสต็อกไม่มีโชว์,มีโชว์ไม่มีสต็อก,ทั้งหมด-จำแนก', r4.names);
  check('ชีท 2 หัวครบ 7 ช่อง',
        r4.head2.join(',') === 'รหัสสินค้า,ชื่อสินค้า,กลุ่ม,Stock (ชิ้น),โซน,ราคาต้นทุน,มูลค่า',
        r4.head2);
  check('ชีท 3 หัวครบ 5 ช่อง',
        r4.head3.join(',') === 'รหัสสินค้า,ชื่อสินค้า,กลุ่ม,โชว์ (ชิ้น),โซน', r4.head3);
  check('ชีท 4 หัวครบ 8 ช่อง',
        r4.head4.join(',') === 'รหัสสินค้า,ชื่อสินค้า,กลุ่ม,สถานะ,โชว์ (ชิ้น),Stock (ชิ้น),จำนวนจริง,โซน',
        r4.head4);
  check('⭐ ชีท 2 เรียงมูลค่ามาก→น้อย', r4.s2rows.join(' | ') === 'NTBG001:500 | SOSALE9:70',
        r4.s2rows);
  check('ชีท 3 มีเฉพาะของที่มีโชว์ไม่มีสต็อก', r4.s3rows.join(',') === 'NTBG003', r4.s3rows);
  check('ชีท 4 มีครบทุก SKU', r4.s4count === 5, r4.s4count);
  check('ชีทสรุปมี 4 บรรทัดสถานะพร้อม % และมูลค่า',
        r4.summary.length === 4 && r4.summary.every(function (r) { return typeof r[2] === 'number'; }),
        r4.summary);
  check('ความกว้างคอลัมน์ครบทุกชีท',
        r4.widths.join(',') === '4,7,5,8', r4.widths);
  check('ชื่อไฟล์บอก Job', /^stock-no-display-STOCK-01-/.test(r4.fileName || ''), r4.fileName);
  check('นามสกุล .xlsx', /\.xlsx$/.test(r4.fileName || ''), r4.fileName);
  /* เคยพลาดมาแล้ว: เอา thaiDate() มาแทนอักษรไทยด้วยขีด ได้ชื่อ 18---------2569
     เทสเดิมดูแค่หัวกับนามสกุล เลยผ่านทั้งที่ชื่อเสีย — ต้องล็อกทั้งเส้น */
  check('⭐ วันที่ในชื่อไฟล์เป็นตัวเลข 8 หลัก ไม่มีขีดรัว',
        /^stock-no-display-STOCK-01-25\d{6}\.xlsx$/.test(r4.fileName || ''), r4.fileName);
  check('บอกผู้ใช้ว่าโหลดแล้วกี่รายการ', /2 รายการ/.test(r4.toast || ''), r4.toast);

  /* ---------- [5] รอบหลายใบต้องรวมยอดทั้งรอบ ---------- */
  console.log('\n[5] ⭐ รอบหลายใบ — ต้องรวมทั้งรอบ ไม่ใช่ใบที่เปิดอยู่');
  await page.evaluate(() => {
    /* ของจริง: ใบ STOCK มีแต่ของฝั่ง S ใบ SHOW มีแต่ของฝั่ง D
       ดูใบเดียวจึงตอบไม่ได้เลยว่าอะไร "มีทั้งคู่" — ต้องรวมสองใบก่อน */
    window.__SDJOBS = {
      'R-SD-STOCK': [{ code: 'P1', delta: 10, stockType: 'stock' },
                     { code: 'P2', delta: 5, stockType: 'stock' },
                     { code: 'P4', delta: 3, stockType: 'stock' }],
      'R-SD-SHOW':  [{ code: 'P1', delta: 4, stockType: 'display' },
                     { code: 'P3', delta: 7, stockType: 'display' }]
    };
    window.__sdReads = [];
    window.__sdFail = false;
    const fake = function (path) {
      window.__sdReads.push(path);
      if (window.__sdFail) return Promise.reject(new Error('เน็ตล่ม'));
      const m = /^rounds\/([^/]+)\/scans$/.exec(path);
      if (m) {
        const out = {};
        (window.__SDJOBS[m[1]] || []).forEach(function (r, i) {
          out['s' + i] = { code: r.code, delta: r.delta, mode: 'scan',
                           user: 'ท', ts: 100 + i, stockType: r.stockType };
        });
        return Promise.resolve(out);
      }
      if (/systemQty$/.test(path)) return Promise.resolve({ P1: 14, P2: 5, P3: 7, P4: 3 });
      return Promise.resolve(null);
    };
    window.db.get = fake; window.db.getQuiet = fake;

    window.__seedCycle = function (openId) {
      window.__seed([]);
      state.page = 'summary'; state.summaryTab = 'sd';
      state.products = {
        P1: { code: 'P1', name: 'ของคู่', type: 'product', costPrice: 10 },
        P2: { code: 'P2', name: 'ของสต็อกล้วน', type: 'product', costPrice: 10 },
        P3: { code: 'P3', name: 'ของโชว์ล้วน', type: 'product', costPrice: 10 },
        P4: { code: 'P4', name: 'ของสต็อกล้วนสอง', type: 'product', costPrice: 10 }
      };
      state.systemQty = { P1: 14, P2: 5, P3: 7, P4: 3 };
      state.roundIndex = {
        'R-SD-STOCK': { id: 'R-SD-STOCK', name: 'ใบสต็อก', branchCode: 'B1',
                        jobCode: 'SD-STOCK', cycleId: 'CYC-SD', status: 'counting', createdAt: 1 },
        'R-SD-SHOW': { id: 'R-SD-SHOW', name: 'ใบโชว์', branchCode: 'B1',
                       jobCode: 'SD-SHOW', cycleId: 'CYC-SD', status: 'counting', createdAt: 2 }
      };
      state.roundId = openId; state.cycleId = 'CYC-SD';
      /* state.scanLog = ของใบที่เปิดอยู่เท่านั้น ตรงตามที่แอปจริงถือ */
      state.scanLog = (window.__SDJOBS[openId] || []).map(function (r, i) {
        return { id: 'o' + i, rec: { code: r.code, delta: r.delta, mode: 'scan',
                                     user: 'ท', ts: 100 + i, stockType: r.stockType } };
      });
      state.counts = {}; state.scanQty = {}; state.appliedScanIds = Object.create(null);
      state.cycleData = null;
      buildScanIndex();
      window.__sdReads = []; window.__toasts = [];
    };
    window.__sdCards = function () {
      const o = {};
      Array.prototype.forEach.call(document.querySelectorAll('[data-sdcard]'), function (c) {
        o[c.getAttribute('data-sdcard')] = Number(c.querySelector('[data-sdnum]').textContent);
      });
      return o;
    };
  });

  const r5 = await page.evaluate(async () => {
    window.__seedCycle('R-SD-STOCK');
    const scope = cycleScope();
    const before = stockDisplayReport().counts;          // อาการที่ผู้ใช้เจอ
    renderStockDisplay();
    const drawnFirst = window.__sdCards();
    const infoBusy = document.getElementById('sdScopeInfo').textContent;
    await new Promise(function (r) { setTimeout(r, 120); });   // รอรวมยอดเสร็จแล้ววาดทับ
    return { multi: scope.multi, before: before, drawnFirst: drawnFirst,
             infoBusy: infoBusy,
             after: window.__sdCards(),
             rolled: stockDisplayReport().counts,
             infoDone: document.getElementById('sdScopeInfo').textContent,
             reads: window.__sdReads.slice() };
  });
  check('รอบนี้เป็นรอบหลายใบจริง', r5.multi === true, r5.multi);
  check('อาการเดิม: ดูใบเดียวได้ both = 0 · โชว์ไม่มีสต็อก = 0',
        r5.before.stock_no_display === 3 && r5.before.both === 0 &&
        r5.before.display_no_stock === 0, r5.before);
  check('วาดของที่มีในมือก่อน จอไม่ว่างระหว่างรอ', r5.drawnFirst.stock_no_display === 3,
        r5.drawnFirst);
  check('บอกผู้ใช้ว่ากำลังรวม + เลขที่เห็นยังเป็นของใบเดียว',
        /กำลังรวมยอดทุกใบ/.test(r5.infoBusy) && /ใบนี้ใบเดียว/.test(r5.infoBusy), r5.infoBusy);
  check('⭐ ไปอ่าน scans ของใบอื่นในรอบด้วย',
        r5.reads.indexOf('rounds/R-SD-SHOW/scans') >= 0, r5.reads);
  check('⭐ วาดทับด้วยยอดรวมทั้งรอบ (both/สต็อกล้วน/โชว์ล้วน > 0 ทุกตัว)',
        r5.after.both === 1 && r5.after.stock_no_display === 2 &&
        r5.after.display_no_stock === 1 && r5.after.uncategorized === 0, r5.after);
  check('ตัวเลขบนจอตรงกับ stockDisplayReport หลังรวม',
        JSON.stringify(r5.after) === JSON.stringify({
          stock_no_display: r5.rolled.stock_no_display,
          display_no_stock: r5.rolled.display_no_stock,
          both: r5.rolled.both, uncategorized: r5.rolled.uncategorized
        }), { จอ: r5.after, รายงาน: r5.rolled });
  check('รวมเสร็จแล้วบอกว่ารวมครบกี่ใบ',
        /รวมทุก Job/.test(r5.infoDone) && /2 ใบ/.test(r5.infoDone), r5.infoDone);

  /* วาดทับต้องเกิดเฉพาะตอนยังอยู่แท็บนี้ ไม่ใช่เด้งกลับมาทับหน้าที่ผู้ใช้เปลี่ยนไปแล้ว */
  const r5b = await page.evaluate(async () => {
    window.__seedCycle('R-SD-STOCK');
    renderStockDisplay();
    state.summaryTab = 'job';                 // ผู้ใช้สลับแท็บหนีระหว่างรอ
    await new Promise(function (r) { setTimeout(r, 120); });
    return { cards: window.__sdCards() };
  });
  check('⭐ สลับแท็บหนีระหว่างรอ = ไม่วาดทับข้ามหน้า', r5b.cards.stock_no_display === 3,
        r5b.cards);

  /* รวมไม่สำเร็จต้องบอกตรง ๆ ว่าเลขที่เห็นเป็นของใบเดียว ไม่ใช่ปล่อยให้เข้าใจผิด */
  const r5c = await page.evaluate(async () => {
    window.__seedCycle('R-SD-STOCK');
    window.__sdFail = true;
    renderStockDisplay();
    await new Promise(function (r) { setTimeout(r, 120); });
    window.__sdFail = false;
    return { info: document.getElementById('sdScopeInfo').textContent,
             cards: window.__sdCards() };
  });
  check('รวมไม่สำเร็จ = เตือนว่าเลขเป็นของใบเดียว ไม่ใช่จอค้าง',
        /ไม่สำเร็จ/.test(r5c.info) && /Job นี้ใบเดียว/.test(r5c.info) &&
        r5c.cards.stock_no_display === 3, r5c);

  /* ไฟล์ Excel ที่ส่งหัวหน้าต้องรอยอดรวมเหมือนกัน ไม่ใช่ได้ไฟล์ both = 0 */
  const r5d = await page.evaluate(async () => {
    window.__seedCycle('R-SD-STOCK');
    let sheets = null, fileName = null;
    const realBuild = window.buildXlsx, realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.buildXlsx = function (x) { sheets = x; return realBuild(x); };
    URL.createObjectURL = function () { return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    const ret = exportStockDisplayExcel();
    const syncSheets = sheets;                 // ต้องยังไม่สร้างไฟล์ ณ จุดนี้
    await ret;
    window.buildXlsx = realBuild; URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return { thenable: !!(ret && typeof ret.then === 'function'), syncSheets: syncSheets,
             s4: sheets ? sheets[3].rows.length - 1 : 0,
             s3: sheets ? sheets[2].rows.slice(1).map(function (r) { return r[0]; }) : [],
             fileName: fileName, toast: (window.__toasts[0] || {}).m };
  });
  check('รอบหลายใบ: Export รอรวมยอดก่อน ไม่สร้างไฟล์ทันที',
        r5d.thenable === true && r5d.syncSheets === null, r5d);
  check('บอกผู้ใช้ว่ากำลังรวมยอดก่อนสร้างไฟล์', /กำลังรวมยอดทุก Job/.test(r5d.toast || ''),
        r5d.toast);
  check('⭐ ไฟล์ได้ครบทั้งรอบ 4 SKU ไม่ใช่ 3 ของใบเดียว', r5d.s4 === 4, r5d.s4);
  check('⭐ ชีท "มีโชว์ไม่มีสต็อก" มี P3 จากใบอื่น', r5d.s3.join(',') === 'P3', r5d.s3);
  check('ยังได้ไฟล์ออกมาจริง', /\.xlsx$/.test(r5d.fileName || ''), r5d.fileName);

  /* กฎเดิมตั้งแต่ v2.7.x — รอบใบเดียวต้องไม่ถูกลากไปรอ promise */
  const r5e = await page.evaluate(() => {
    window.__seed(window.__SCANS);
    let fileName = null;
    const realCreate = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function () { return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    const ret = exportStockDisplayExcel();
    URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick;
    return { thenable: !!(ret && typeof ret.then === 'function'), fileName: fileName };
  });
  check('⭐ รอบใบเดียวยังทำงานทันทีแบบเดิม ไม่แตะเน็ต',
        r5e.thenable === false && /\.xlsx$/.test(r5e.fileName || ''), r5e);

  /* ---------- [6] นับเฉพาะสินค้า (Product) ---------- */
  console.log('\n[6] ⭐ ตัด Not Product ออกจากรายงาน');
  await page.evaluate(() => {
    /* ของที่ต้องนับ 4 ตัว · ของที่ต้องตัด 4 ตัว — จงใจวาง Not Product ให้ตกคนละกลุ่ม
       ถ้าตัวกรองหลุด จะเห็นทันทีว่ากลุ่มไหนบวม ไม่ใช่เห็นแค่ยอดรวมเพี้ยน */
    window.__seedType = function () {
      window.__seed([
        { code: 'P_OK', delta: 5, mode: 'scan', user: 'ท', ts: 1, stockType: 'stock' },
        { code: 'P_BOTH', delta: 2, mode: 'scan', user: 'ท', ts: 2, stockType: 'stock' },
        { code: 'P_BOTH', delta: 3, mode: 'scan', user: 'ท', ts: 3, stockType: 'display' },
        { code: 'P_INACT', delta: 4, mode: 'scan', user: 'ท', ts: 4, stockType: 'display' },
        { code: 'NOMASTER', delta: 1, mode: 'scan', user: 'ท', ts: 5, stockType: 'stock' },
        { code: 'NP_S', delta: 9, mode: 'scan', user: 'ท', ts: 6, stockType: 'stock' },
        { code: 'NP_D', delta: 9, mode: 'scan', user: 'ท', ts: 7, stockType: 'display' },
        { code: 'NP_B', delta: 9, mode: 'scan', user: 'ท', ts: 8, stockType: 'stock' },
        { code: 'NP_B', delta: 9, mode: 'scan', user: 'ท', ts: 9, stockType: 'display' },
        { code: 'NP_U', delta: 9, mode: 'scan', user: 'ท', ts: 10 }
      ]);
      state.products = {
        P_OK: { code: 'P_OK', name: 'สินค้าปกติ', type: 'product', costPrice: 10 },
        P_BOTH: { code: 'P_BOTH', name: 'สินค้ามีทั้งสองฝั่ง', type: 'product', costPrice: 10 },
        /* ปิดใช้งานแล้วแต่ยังนับเจอของจริง — ห้ามตัด ต้องตามเก็บให้ครบเหมือนเดิม */
        P_INACT: { code: 'P_INACT', name: 'สินค้าปิดใช้งาน', type: 'inactive', costPrice: 10 },
        NP_S: { code: 'NP_S', name: 'ถุงกระดาษ', type: 'notProduct', costPrice: 1 },
        NP_D: { code: 'NP_D', name: 'ป้ายราคา', type: 'notProduct', costPrice: 1 },
        NP_B: { code: 'NP_B', name: 'ชั้นวางของ', type: 'notProduct', costPrice: 1 },
        NP_U: { code: 'NP_U', name: 'ของเบ็ดเตล็ด', type: 'notProduct', costPrice: 1 }
        /* NOMASTER จงใจไม่ใส่ในทะเบียน — ของที่ยังไม่มีใน Master ต้องไม่ถูกตัด */
      };
      state.systemQty = { P_OK: 5, P_BOTH: 5, P_INACT: 4, NP_S: 9, NP_D: 9, NP_B: 18, NP_U: 9 };
      state.counts = {}; state.scanQty = {}; state.appliedScanIds = Object.create(null);
      buildScanIndex();
    };
  });

  const r6 = await page.evaluate(() => {
    window.__seedType();
    const rep = stockDisplayReport();
    return { counts: rep.counts, total: rep.total,
             codes: rep.rows.map(function (r) { return r.code; }).sort(),
             groups: rep.groups.map(function (g) { return g.group; }) };
  });
  check('⭐ Not Product ไม่โผล่ในรายงานเลยสักตัว',
        r6.codes.join(',').indexOf('NP_') < 0, r6.codes);
  check('⭐ สินค้าจริงยังนับครบเหมือนเดิม',
        r6.codes.join(',') === 'NOMASTER,P_BOTH,P_INACT,P_OK', r6.codes);
  check('⭐ ตัดแล้วยอดแต่ละกลุ่มถูกต้อง',
        r6.total === 4 && r6.counts.stock_no_display === 2 &&
        r6.counts.display_no_stock === 1 && r6.counts.both === 1, r6.counts);
  check('⭐ กอง "ยังไม่ระบุประเภท" ยุบเหลือ 0 (เดิมเป็น Not Product ซะส่วนใหญ่)',
        r6.counts.uncategorized === 0, r6.counts);
  check('ของที่ปิดใช้งานแล้วไม่ถูกตัดไปด้วย', r6.codes.indexOf('P_INACT') >= 0, r6.codes);
  check('ของที่ยังไม่มีในทะเบียน Master ไม่ถูกตัดไปด้วย',
        r6.codes.indexOf('NOMASTER') >= 0, r6.codes);
  check('แถบกระจุกกลุ่มไหนก็ไม่มี Not Product ปน',
        r6.groups.join(',').indexOf('NP_') < 0, r6.groups);

  /* ตัดจาก p.type เท่านั้น ห้ามไปเดาจากรหัสหรือชื่อ — สลับ type แล้วต้องกลับมานับ */
  const r6b = await page.evaluate(() => {
    window.__seedType();
    state.products.NP_S.type = 'product';
    const rep = stockDisplayReport();
    return { codes: rep.rows.map(function (r) { return r.code; }).sort(), total: rep.total };
  });
  check('⭐ ตัดจาก type ไม่ใช่เดาจากรหัส (เปลี่ยนเป็น product แล้วต้องกลับมานับ)',
        r6b.codes.indexOf('NP_S') >= 0 && r6b.total === 5, r6b);

  /* ไฟล์ที่ส่งหัวหน้าต้องสะอาดเหมือนบนจอ ทุกชีท */
  const r6c = await page.evaluate(() => {
    window.__seedType();
    let sheets = null;
    const realBuild = window.buildXlsx, realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.buildXlsx = function (x) { sheets = x; return realBuild(x); };
    URL.createObjectURL = function () { return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () {};
    exportStockDisplayExcel();
    window.buildXlsx = realBuild; URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return {
      dump: JSON.stringify(sheets),
      s4count: sheets[3].rows.length - 1,
      skuSum: sheets[0].rows.filter(function (r) { return r.length === 4 && r[0] !== 'สถานะ'; })
        .reduce(function (a, r) { return a + r[1]; }, 0)
    };
  });
  check('⭐ ไม่มี Not Product ในไฟล์ Excel เลยสักช่อง ทั้ง 4 ชีท',
        r6c.dump.indexOf('NP_') < 0 && r6c.dump.indexOf('ถุงกระดาษ') < 0 &&
        r6c.dump.indexOf('ชั้นวางของ') < 0, r6c.dump.slice(0, 200));
  check('ชีท "ทั้งหมด-จำแนก" เหลือ 4 แถว', r6c.s4count === 4, r6c.s4count);
  check('ชีทสรุปรวมจำนวน SKU ได้ 4 ตรงกับบนจอ', r6c.skuSum === 4, r6c.skuSum);

  /* ข้อความกำกับ — ไม่งั้นคนอ่านไปเทียบกับหน้าสรุปแล้วนึกว่ายอดหาย */
  const r6d = await page.evaluate(() => {
    return { head: document.getElementById('sdShareHead').textContent };
  });
  check('⭐ บอกบนหัวรายงานว่านับเฉพาะสินค้า',
        /นับเฉพาะสินค้า \(Product\)/.test(r6d.head) && /ไม่รวม Not Product/.test(r6d.head),
        r6d.head);

  /* ---------- [7] ของที่ลบไปแล้ว (ยอดสุทธิ <= 0) ---------- */
  console.log('\n[7] ⭐ ยอดสุทธิ 0 หรือติดลบ = ของที่ลบไปแล้ว ต้องไม่โผล่');
  const r7 = await page.evaluate(() => {
    window.__seed([
      { code: 'POS1', delta: 5, mode: 'scan', user: 'ท', ts: 1, stockType: 'stock' },
      /* ยิงแล้วลบทับจนติดลบ — ไม่มีฝั่งไหนเป็นบวก เคยไปกองใน "ยังไม่ระบุประเภท" */
      { code: 'NEG1', delta: 3, mode: 'scan', user: 'ท', ts: 2 },
      { code: 'NEG1', delta: -4, mode: 'scan', user: 'ท', ts: 3 },
      /* ติดลบทั้งที่ติดประเภทมาด้วย — ต้องตัดเหมือนกัน */
      { code: 'NEG2', delta: 2, mode: 'scan', user: 'ท', ts: 4, stockType: 'stock' },
      { code: 'NEG2', delta: -5, mode: 'scan', user: 'ท', ts: 5, stockType: 'stock' },
      /* หักคืนจนเหลือ 0 พอดี — กติกาเดิมตั้งแต่แรก ต้องยังตัดอยู่ */
      { code: 'ZERO1', delta: 4, mode: 'scan', user: 'ท', ts: 6, stockType: 'stock' },
      { code: 'ZERO1', delta: -4, mode: 'scan', user: 'ท', ts: 7, stockType: 'stock' }
    ]);
    state.products = {
      POS1: { code: 'POS1', name: 'ของที่ยังอยู่', type: 'product', costPrice: 10 },
      NEG1: { code: 'NEG1', name: 'ของที่ลบแล้ว', type: 'product', costPrice: 10 },
      NEG2: { code: 'NEG2', name: 'ของที่ลบแล้วสอง', type: 'product', costPrice: 10 },
      ZERO1: { code: 'ZERO1', name: 'ของที่หักคืนหมด', type: 'product', costPrice: 10 }
    };
    state.systemQty = { POS1: 5, NEG1: 0, NEG2: 0, ZERO1: 4 };
    state.counts = {}; state.scanQty = {}; state.appliedScanIds = Object.create(null);
    buildScanIndex();
    const rep = stockDisplayReport();
    let sheets = null;
    const realBuild = window.buildXlsx, realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.buildXlsx = function (x) { sheets = x; return realBuild(x); };
    URL.createObjectURL = function () { return 'blob:fake'; };
    URL.revokeObjectURL = function () {};
    HTMLAnchorElement.prototype.click = function () {};
    exportStockDisplayExcel();
    window.buildXlsx = realBuild; URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return { total: rep.total, counts: rep.counts,
             codes: rep.rows.map(function (r) { return r.code; }).sort(),
             net: (function () {                     // ยอดสุทธิจากแถวดิบ พิสูจน์ว่าฉากที่จัดไว้ติดลบจริง
               const o = {};
               state.scanLog.forEach(function (x) {
                 o[x.rec.code] = (o[x.rec.code] || 0) + x.rec.delta;
               });
               return o;
             })(),
             dump: JSON.stringify(sheets) };
  });
  check('ยอดดิบติดลบจริงตามที่จัดฉากไว้',
        r7.net.NEG1 === -1 && r7.net.NEG2 === -3 && r7.net.ZERO1 === 0, r7.net);
  check('⭐ ของที่ลบไปแล้วไม่โผล่ในรายงาน', r7.codes.join(',') === 'POS1', r7.codes);
  check('⭐ กอง "ยังไม่ระบุประเภท" ไม่มีของติดลบค้างอยู่',
        r7.counts.uncategorized === 0 && r7.total === 1, r7.counts);
  check('ของยอดบวกยังนับครบเหมือนเดิม', r7.counts.stock_no_display === 1, r7.counts);
  check('⭐ ไฟล์ Excel ก็ไม่มีของที่ลบแล้วปน',
        r7.dump.indexOf('NEG1') < 0 && r7.dump.indexOf('NEG2') < 0 &&
        r7.dump.indexOf('ZERO1') < 0, r7.dump.slice(0, 160));

  /* ---------- [8] กดการ์ดเพื่อกรองตาราง ---------- */
  console.log('\n[8] ⭐ กดการ์ดแล้วตารางสลับกลุ่ม');
  await page.evaluate(() => {
    /* ราคาต่างกันทุกตัว และจงใจให้ "จำนวนมากสุด" กับ "มูลค่ามากสุด" เป็นคนละตัว
       จะได้รู้ว่าปุ่มเรียงใช้เลขของกลุ่มที่กำลังดูจริง ไม่ใช่ไปหยิบยอดฝั่งสต็อกมาตลอด */
    window.__seedView = function () {
      window.__seed([
        { code: 'S1', delta: 10, mode: 'scan', user: 'ท', ts: 1, stockType: 'stock' },
        { code: 'S2', delta: 3, mode: 'scan', user: 'ท', ts: 2, stockType: 'stock' },
        { code: 'D1', delta: 7, mode: 'scan', user: 'ท', ts: 3, stockType: 'display' },
        { code: 'D2', delta: 2, mode: 'scan', user: 'ท', ts: 4, stockType: 'display' },
        { code: 'B1', delta: 4, mode: 'scan', user: 'ท', ts: 5, stockType: 'stock' },
        { code: 'B1', delta: 6, mode: 'scan', user: 'ท', ts: 6, stockType: 'display' },
        { code: 'U1', delta: 9, mode: 'scan', user: 'ท', ts: 7 }
      ]);
      state.products = {
        S1: { code: 'S1', name: 'สต็อกล้วนถูก', type: 'product', costPrice: 10 },
        S2: { code: 'S2', name: 'สต็อกล้วนแพง', type: 'product', costPrice: 100 },
        D1: { code: 'D1', name: 'โชว์ล้วนหนึ่ง', type: 'product', costPrice: 20 },
        D2: { code: 'D2', name: 'โชว์ล้วนสอง', type: 'product', costPrice: 5 },
        B1: { code: 'B1', name: 'มีทั้งสองฝั่ง', type: 'product', costPrice: 10 },
        U1: { code: 'U1', name: 'ยังระบุไม่ได้', type: 'product', costPrice: 3 }
      };
      state.systemQty = { S1: 10, S2: 3, D1: 7, D2: 2, B1: 10, U1: 9 };
      state.counts = {}; state.scanQty = {}; state.appliedScanIds = Object.create(null);
      state.sdView = 'stock_no_display'; state.sdSort = 'value';
      if ($('sdSearch')) $('sdSearch').value = '';
      buildScanIndex();
    };
    window.__sdTable = function () {
      return {
        title: ($('sdTableTitle') || {}).textContent,
        chip: ($('sdChip') || {}).textContent,
        rows: Array.prototype.map.call(document.querySelectorAll('#sdBody [data-sdrow]'),
          function (tr) {
            const td = tr.querySelectorAll('td');
            return td[0].textContent + ':' + td[3].textContent + ':' + td[5].textContent;
          }),
        active: Array.prototype.filter.call(document.querySelectorAll('[data-sdcard]'),
          function (c) { return c.classList.contains('sd-active'); })
          .map(function (c) { return c.getAttribute('data-sdcard'); }),
        pressed: Array.prototype.filter.call(document.querySelectorAll('[data-sdcard]'),
          function (c) { return c.getAttribute('aria-pressed') === 'true'; })
          .map(function (c) { return c.getAttribute('data-sdcard'); })
      };
    };
  });

  const r8 = await page.evaluate(() => {
    window.__seedView();
    const rep = stockDisplayReport();
    const out = {};
    ['stock_no_display', 'display_no_stock', 'both', 'uncategorized'].forEach(function (v) {
      state.sdView = v;
      out[v] = sdVisibleRows(rep).map(function (r) {
        return r.code + ':' + sdRowQty(r, v) + ':' + sdRowValue(r, v);
      });
    });
    return out;
  });
  check('⭐ กลุ่มมีสต็อกไม่มีโชว์ — ใช้ยอดฝั่งสต็อก เรียงตามมูลค่า',
        r8.stock_no_display.join(' | ') === 'S2:3:300 | S1:10:100', r8.stock_no_display);
  check('⭐ กลุ่มมีโชว์ไม่มีสต็อก — ใช้ยอดฝั่งโชว์ ไม่ใช่ 0 ทั้งคอลัมน์',
        r8.display_no_stock.join(' | ') === 'D1:7:140 | D2:2:10', r8.display_no_stock);
  check('⭐ กลุ่มมีทั้งสองฝั่ง — ใช้ยอดรวมสองฝั่ง (4+6)',
        r8.both.join(' | ') === 'B1:10:100', r8.both);
  check('⭐ กลุ่มยังไม่ระบุ — ใช้ยอดดิบ ไม่งั้นตารางขึ้น 0 หมด',
        r8.uncategorized.join(' | ') === 'U1:9:27', r8.uncategorized);

  const r8b = await page.evaluate(() => {
    window.__seedView();
    const rep = stockDisplayReport();
    state.sdView = 'display_no_stock';
    state.sdSort = 'qty';
    const byQty = sdVisibleRows(rep).map(function (r) { return r.code; });
    state.sdSort = 'value';
    const byValue = sdVisibleRows(rep).map(function (r) { return r.code; });
    state.sdView = 'stock_no_display';
    state.sdSort = 'qty';
    const stockByQty = sdVisibleRows(rep).map(function (r) { return r.code; });
    return { byQty: byQty, byValue: byValue, stockByQty: stockByQty };
  });
  check('เรียงตามจำนวนในกลุ่มโชว์ใช้ยอดโชว์ (7 มาก่อน 2)',
        r8b.byQty.join(',') === 'D1,D2', r8b.byQty);
  check('เรียงตามมูลค่าในกลุ่มโชว์ใช้ยอดโชว์ × ราคา (140 มาก่อน 10)',
        r8b.byValue.join(',') === 'D1,D2', r8b.byValue);
  check('เรียงตามจำนวนในกลุ่มสต็อกยังใช้ยอดสต็อกเหมือนเดิม (10 มาก่อน 3)',
        r8b.stockByQty.join(',') === 'S1,S2', r8b.stockByQty);

  const r8c = await page.evaluate(() => {
    window.__seedView();
    renderStockDisplay();
    const start = window.__sdTable();
    /* กดการ์ด "มีโชว์ ไม่มีสต็อก" เหมือนผู้ใช้กดจริง */
    document.querySelector('[data-sdcard="display_no_stock"]').click();
    const afterClick = window.__sdTable();
    const viewState = state.sdView;
    document.querySelector('[data-sdcard="uncategorized"]').click();
    const afterSecond = window.__sdTable();
    /* ค้นหาต้องยังทำงานภายในกลุ่มที่เลือกอยู่ */
    document.querySelector('[data-sdcard="stock_no_display"]').click();
    $('sdSearch').value = 'แพง';
    renderSdTable();
    const searched = window.__sdTable();
    $('sdSearch').value = '';
    return { start: start, afterClick: afterClick, viewState: viewState,
             afterSecond: afterSecond, searched: searched,
             tag: document.querySelector('[data-sdcard]').tagName };
  });
  check('เริ่มต้นอยู่กลุ่ม "มีสต็อก ไม่มีโชว์" เหมือนเดิม',
        r8c.start.title === 'มีสต็อก ไม่มีโชว์' && r8c.start.chip === '2' &&
        r8c.start.active.join(',') === 'stock_no_display', r8c.start);
  check('⭐ กดการ์ดแล้วตารางสลับกลุ่มตาม',
        r8c.viewState === 'display_no_stock' &&
        r8c.afterClick.title === 'มีโชว์ ไม่มีสต็อก' && r8c.afterClick.chip === '2' &&
        r8c.afterClick.rows.join(' | ') === 'D1:7:140.00 | D2:2:10.00', r8c.afterClick);
  check('⭐ ไฮไลต์ย้ายไปการ์ดที่กด ใบเดียวเท่านั้น',
        r8c.afterClick.active.join(',') === 'display_no_stock' &&
        r8c.afterClick.pressed.join(',') === 'display_no_stock', r8c.afterClick);
  check('กดใบ "ยังไม่ระบุประเภท" ก็ได้',
        r8c.afterSecond.title === 'ยังไม่ระบุประเภท' &&
        r8c.afterSecond.rows.join(' | ') === 'U1:9:27.00', r8c.afterSecond);
  check('ค้นหายังกรองอยู่ในกลุ่มที่เลือก',
        r8c.searched.rows.join(' | ') === 'S2:3:300.00' && r8c.searched.chip === '1',
        r8c.searched);
  check('การ์ดเป็น <button> จริง กดด้วยคีย์บอร์ดได้', r8c.tag === 'BUTTON', r8c.tag);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
