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

  await page.evaluate(() => {
    window.toast = function () {};
    window.enqueueWrite = function () {};
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'g' + (++n); }; })();
    window.renderDoc = function () {};
    hideLogin();

    window.__seed = function (role) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role || 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice';
      state.products = {
        A1: { code: 'A1', name: 'ก', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { A1: 100 };
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.zoneTotals = {};
      state.lastZoneName = '';
    };
    window.__view = function () {
      const host = $('scanTotalAll');
      const pills = Array.prototype.map.call(host.querySelectorAll('.zone-pill'), function (p) {
        return { text: p.textContent, zone: p.getAttribute('data-zone'),
                 active: p.classList.contains('active'),
                 total: p.hasAttribute('data-zone-total') };
      });
      return {
        big: $('scanTotal').textContent,
        lab: $('scanTotalLab').textContent,
        all: host.textContent,
        pills: pills,
        zones: pills.filter(function (p) { return !p.total; }).map(function (p) { return p.zone; }),
        activeZones: pills.filter(function (p) { return p.active; }).map(function (p) { return p.zone; }),
        totalPill: (pills.filter(function (p) { return p.total; })[0] || {}).text || null,
        html: host.innerHTML
      };
    };
  });

  /* ---------- 1. ยังไม่ได้ยิงอะไร ---------- */
  console.log('\n[1] ยังไม่ได้ยิงอะไรเลย');
  const r1 = await page.evaluate(() => {
    window.__seed('admin');
    renderScanTotals();
    return window.__view();
  });
  check('ตัวเลขใหญ่ = 0', r1.big === '0', r1.big);
  check('บรรทัดรวมทุกโซนว่างไว้ ไม่โชว์ "รวมทุกโซน 0 ชิ้น"', r1.all === '', r1.all);

  /* ---------- 2. ยิงหลายโซน ---------- */
  console.log('\n[2] ยิงข้ามหลายโซน');
  const r2 = await page.evaluate(() => {
    window.__seed('admin');
    state.zoneTotals = { A: 120, B: 45, '(ไม่ระบุโซน)': 7 };
    state.lastZoneName = 'B';
    renderScanTotals();
    return window.__view();
  });
  check('ตัวเลขใหญ่ยังเป็นยอดโซนล่าสุด (B = 45) ไม่ใช่ยอดรวม',
        r2.big === '45', r2.big);
  check('ป้ายใต้ตัวเลขใหญ่ยังบอกชื่อโซนเหมือนเดิม',
        r2.lab === 'ชิ้นที่ยิงแล้วในโซน B', r2.lab);
  check('แจกแจงครบทุกโซนที่มีของ + ปิดท้ายด้วยยอดรวม',
        r2.all === '(ไม่ระบุโซน) 7 · A 120 · B 45 · รวม 172', r2.all);
  check('เรียงชื่อโซน A→Z',
        JSON.stringify(r2.zones) === JSON.stringify(['(ไม่ระบุโซน)', 'A', 'B']), r2.zones);
  check('โซนล่าสุด (B) ตัวเดียวที่ติด active',
        JSON.stringify(r2.activeZones) === JSON.stringify(['B']), r2.activeZones);
  check('มี pill ยอดรวมปิดท้าย', r2.totalPill === 'รวม 172', r2.totalPill);

  /* ---------- 3. ยิงเพิ่มแล้วขยับตาม ---------- */
  console.log('\n[3] ยิงเพิ่ม / ยกเลิกการยิง');
  const r3 = await page.evaluate(() => {
    window.__seed('admin');
    const out = {};
    /* ยิงจริงผ่าน writeScan ให้ zoneTotals เดินตามของจริง ไม่ใช่ยัดค่าเอง */
    writeScan('A1', 1, 'scan', null);
    renderScanTotals(); out.after1 = window.__view().all;
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    renderScanTotals(); out.after3 = window.__view().all;
    /* ยกเลิกการยิง = delta ติดลบ ยอดรวมต้องหักตาม */
    writeScan('A1', -1, 'scan', 'ยกเลิก');
    renderScanTotals(); out.afterUndo = window.__view().all;
    out.zoneTotals = JSON.parse(JSON.stringify(state.zoneTotals));
    return out;
  });
  check('ยิง 1 ครั้ง → โซนนั้น 1 · รวม 1',
        /1 · รวม 1$/.test(r3.after1), r3.after1);
  check('ยิงครบ 3 ครั้ง → โซนนั้น 3 · รวม 3',
        /3 · รวม 3$/.test(r3.after3), r3.after3);
  check('ยกเลิกการยิง → หักเหลือ 2 (zoneTotals เป็น net delta อยู่แล้ว)',
        /2 · รวม 2$/.test(r3.afterUndo), { all: r3.afterUndo, zoneTotals: r3.zoneTotals });

  /* ---------- 4. คิดจาก zoneTotals ไม่ใช่ counts/scanQty ---------- */
  console.log('\n[4] ฐานที่ใช้คำนวณ');
  const r4 = await page.evaluate(() => {
    window.__seed('admin');
    /* จงใจให้ counts กับ scanQty ไม่ตรงกับ zoneTotals — ผลลัพธ์ต้องยึด zoneTotals */
    state.zoneTotals = { A: 10 };
    state.counts = { A1: 999 };
    state.scanQty = { A1: 888 };
    state.manualQty = { A1: 777 };
    state.lastZoneName = 'A';
    renderScanTotals();
    return window.__view().all;
  });
  check('ยึด zoneTotals อย่างเดียว ไม่ปนกับ counts/scanQty/manualQty',
        r4 === 'A 10 · รวม 10', r4);

  /* ---------- 5. โซนที่ยอดไม่เป็นบวก ---------- */
  console.log('\n[5] โซนที่ยอดเป็น 0 หรือติดลบ');
  const r5 = await page.evaluate(() => {
    const out = {};
    window.__seed('admin');
    /* B ถูกยกเลิกจนหมด — ไม่ต้องโชว์ แต่ยอดรวมยังหักตาม */
    state.zoneTotals = { A: 10, B: 0, C: -3 };
    state.lastZoneName = 'A';
    renderScanTotals();
    const v = window.__view();
    out.zones = v.zones; out.all = v.all;

    /* ไม่มีโซนไหน qty>0 เลย → บรรทัดว่าง */
    state.zoneTotals = { A: 0, B: -3 };
    state.lastZoneName = 'A';
    renderScanTotals(); out.allZero = window.__view();

    /* ยอดรวมเป็น 0 แต่ยังมีโซนที่เหลือของ → ต้องโชว์ ไม่ใช่ซ่อนทั้งบรรทัด
       คนนับต้องรู้ว่าโซน A ยังมี 3 ชิ้นอยู่ แม้ยอดสุทธิทั้งรอบจะเป็นศูนย์ */
    state.zoneTotals = { A: 3, B: -3 };
    state.lastZoneName = 'A';
    renderScanTotals(); out.netZeroButHasZone = window.__view().all;

    state.zoneTotals = { A: -2 };
    renderScanTotals(); out.negative = window.__view().all;

    /* ป้ายชื่อโซนต้องยังอัปเดตแม้บรรทัดโซนว่าง (ห้าม return ทิ้งกลางฟังก์ชัน) */
    state.zoneTotals = {};
    state.lastZoneName = 'D';
    renderScanTotals(); out.labWhenEmpty = window.__view().lab;
    return out;
  });
  check('โชว์เฉพาะโซนที่ qty > 0 (ข้าม B=0 กับ C=-3)',
        JSON.stringify(r5.zones) === JSON.stringify(['A']), r5.zones);
  check('ยอดรวมยังนับโซนติดลบด้วย (10+0-3 = 7)', r5.all === 'A 10 · รวม 7', r5.all);
  check('ไม่มีโซนไหน qty>0 → บรรทัดว่าง ไม่มี pill',
        r5.allZero.all === '' && r5.allZero.pills.length === 0, r5.allZero);
  check('ยอดสุทธิ 0 แต่ยังมีโซนที่เหลือของ → ยังโชว์โซนนั้น',
        r5.netZeroButHasZone === 'A 3 · รวม 0', r5.netZeroButHasZone);
  check('ทุกโซนติดลบ → บรรทัดว่าง', r5.negative === '', r5.negative);
  check('บรรทัดโซนว่างแล้วป้ายชื่อโซนยังอัปเดตตามปกติ',
        r5.labWhenEmpty === 'ชิ้นที่ยิงแล้วในโซน D', r5.labWhenEmpty);

  /* ---------- 6. ตัวคั่นหลักพัน + กัน HTML injection ---------- */
  console.log('\n[6] ตัวเลขหลักพัน + ชื่อโซนที่มีอักขระพิเศษ');
  const r6 = await page.evaluate(() => {
    const out = {};
    window.__seed('admin');
    state.zoneTotals = { A: 12000, B: 345 };
    state.lastZoneName = 'A';
    renderScanTotals();
    out.thousands = window.__view().all;

    /* ชื่อโซนมาจากไฟล์ Location ที่คนอัปโหลด — ต้องไม่กลายเป็น HTML */
    window.__seed('admin');
    state.zoneTotals = { '<img src=x onerror=1>': 5 };
    state.lastZoneName = '<img src=x onerror=1>';
    renderScanTotals();
    const v = window.__view();
    out.injectedHtml = v.html;
    out.injectedText = v.all;
    out.imgCount = $('scanTotalAll').querySelectorAll('img').length;
    return out;
  });
  check('ใช้ fmtNum มีตัวคั่นหลักพัน (12,000 + 345 → รวม 12,345)',
        r6.thousands === 'A 12,000 · B 345 · รวม 12,345', r6.thousands);
  check('ชื่อโซนที่มีแท็ก HTML ถูก escape ไม่กลายเป็น element',
        r6.imgCount === 0 && /&lt;img/.test(r6.injectedHtml), r6.injectedHtml);
  check('ยังอ่านเป็นข้อความได้ตามปกติ',
        r6.injectedText === '<img src=x onerror=1> 5 · รวม 5', r6.injectedText);

  /* ---------- 7. ทุก role เห็นบรรทัดนี้ ---------- */
  console.log('\n[7] ทุก role เห็นได้ (ไม่ใช่ตัวเลขผลต่าง)');
  const r7 = await page.evaluate(() => {
    const out = {};
    ['admin', 'counter', 'scanner'].forEach(function (role) {
      window.__seed(role);
      state.zoneTotals = { A: 50 };
      state.lastZoneName = 'A';
      renderScanTotals();
      out[role] = window.__view().all;
    });
    return out;
  });
  check('admin / counter / scanner เห็นยอดเหมือนกัน',
        r7.admin === 'A 50 · รวม 50' && r7.counter === r7.admin && r7.scanner === r7.admin, r7);

  /* ---------- 8. ตำแหน่งบนจอ + สไตล์ ---------- */
  console.log('\n[8] ตำแหน่งและสไตล์');
  const r8 = await page.evaluate(() => {
    window.__seed('admin');
    state.zoneTotals = { A: 50 };
    state.lastZoneName = 'A';
    renderScanTotals();
    const stage = document.getElementById('scanStage');
    const order = Array.prototype.map.call(stage.children, function (c) { return c.id || c.className; });
    const cs = getComputedStyle(document.getElementById('scanTotalAll'));
    return {
      order: order.slice(0, 4),
      inStage: !!stage.querySelector('#scanTotalAll'),
      size: cs.fontSize, align: cs.textAlign,
      smallerThanLab: parseFloat(cs.fontSize) <
        parseFloat(getComputedStyle(document.getElementById('scanTotalLab')).fontSize)
    };
  });
  check('อยู่ใต้ป้ายโซน ก่อนช่องยิง',
        JSON.stringify(r8.order) === JSON.stringify(
          ['scanTotal', 'scanTotalLab', 'scanTotalAll', 'scanInput']), r8.order);
  check('อยู่ในกล่องยิง (scanStage)', r8.inStage === true, r8.inStage);
  check('ตัวเล็กกว่าป้ายโซน ไม่แย่งสายตาตัวเลขใหญ่',
        r8.smallerThanLab === true && r8.size === '12px', r8);
  check('จัดกึ่งกลางเหมือนตัวเลขใหญ่', r8.align === 'center', r8.align);

  /* ---------- 9. หลายโซนบนจอมือถือจริง 390px ---------- */
  console.log('\n[9] หลายโซนบนจอ 390px ต้องพับบรรทัด ไม่ล้นขอบ');
  await page.setViewport({ width: 390, height: 800 });
  const r9 = await page.evaluate(() => {
    window.__seed('admin');
    state.zoneTotals = { A: 120, B: 45, C: 1200, D: 8, E: 76, F: 340, G: 12 };
    state.lastZoneName = 'D';
    renderScanTotals();
    hideLogin();
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('pageScan').classList.add('active');
    const host = document.getElementById('scanTotalAll');
    const stage = document.getElementById('scanStage');
    const pill = host.querySelector('.zone-pill');
    return {
      zones: window.__view().zones,
      active: window.__view().activeZones,
      wrapped: host.getBoundingClientRect().height > 20,       // พับมากกว่าหนึ่งบรรทัด
      fitsWidth: host.scrollWidth <= stage.clientWidth + 1,     // ไม่ล้นขอบกล่อง
      pillNowrap: getComputedStyle(pill).whiteSpace === 'nowrap',
      activeBold: getComputedStyle(host.querySelector('.zone-pill.active')).fontWeight === '800'
    };
  });
  check('7 โซนเรียง A→G ครบ',
        JSON.stringify(r9.zones) === JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G']), r9.zones);
  check('โซนล่าสุด D ติด active ตัวเดียว',
        JSON.stringify(r9.active) === JSON.stringify(['D']), r9.active);
  check('พับลงมามากกว่าหนึ่งบรรทัด', r9.wrapped === true, r9.wrapped);
  check('ไม่ล้นขอบกล่องยิงบนจอ 390px', r9.fitsWidth === true, r9.fitsWidth);
  check('แต่ละโซนไม่ตกบรรทัดกลางชื่อ (nowrap)', r9.pillNowrap === true, r9.pillNowrap);
  check('โซนล่าสุดตัวหนาให้เห็นชัด', r9.activeBold === true, r9.activeBold);
  await page.setViewport({ width: 1280, height: 900 });

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
