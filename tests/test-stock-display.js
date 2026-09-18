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
  check('บอกผู้ใช้ว่าโหลดแล้วกี่รายการ', /2 รายการ/.test(r4.toast || ''), r4.toast);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
