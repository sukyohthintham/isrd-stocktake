/* ============================================================
   v2.17.0 — โซนหน้าร้าน: หน้ายิงยึดโซนที่คนนับพิมพ์เอง
   ============================================================

   ที่มา: งาน Stock/Show หน้าร้าน เด็กเก็บของที่ชั้น SA-1 จริง แล้วพิมพ์ SA-1
   ในช่อง "เก็บทีละโซน" แต่หน้ายิงกลับโชว์ "D" เพราะคิดจาก Location หยิบ
   ซึ่งเป็นผังคลัง WH คนละเรื่องกับชั้นหน้าร้าน — คนนับไม่เข้าใจว่าพิมพ์ผิดตรงไหน

   ไฟล์นี้คุมสามเรื่องพร้อมกัน:
   [1] พิมพ์โซนเอง  → จอยึดโซนที่พิมพ์ (ป้าย · ยอด · แถบแยกโซน)
   [2] ไม่พิมพ์โซน  → จอเหมือน v2.16.8 ทุกตัว (งานคลัง WH ต้องไม่กระทบ)
   [3] writeScan    → zone / zoneName ยังมาจาก Location เสมอ ห้ามเอาโซนที่พิมพ์ไปเขียน
   [4] ผังโซน 180 รหัส + datalist ที่กรองตามชนิดงาน
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

  await page.evaluate(() => {
    window.toast = function () {};
    window.enqueueWrite = function () {};
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'g' + (++n); }; })();
    window.renderDoc = function () {};
    hideLogin();

    /* สินค้าสองตัวคนละโซนคลัง (D กับ H) + ตัวที่ไม่มี Location เลย
       ไว้พิสูจน์ว่าแถบแยกโซนตอนพิมพ์โซนจัดกลุ่มตามโซนที่พิมพ์ ไม่ใช่ D/H */
    window.__seed = function (storeType) {
      state.me = { uid: 'u1', name: 'สมชาย', role: 'admin', branches: [] };
      state.counter = 'สมชาย';
      state.page = 'scan';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1,
                                 storeType: storeType || 'STOCK' } };
      state.priceField = 'costPrice';
      state.products = {
        A1: { code: 'A1', name: 'ก', category: 'ห', type: 'product', costPrice: 10 },
        A2: { code: 'A2', name: 'ข', category: 'ห', type: 'product', costPrice: 20 },
        A3: { code: 'A3', name: 'ค', category: 'ห', type: 'product', costPrice: 30 }
      };
      state.systemQty = { A1: 100, A2: 50, A3: 5 };
      state.locations = { offline: { A1: { pick: 'D1-2-2' }, A2: { pick: 'H3-1-1' } }, online: {} };
      state.locationSet = 'offline';
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {}; state.transferQty = {};
      state.importTab = 'stock';
      state.zoneTotals = {};
      state.appliedScanIds = Object.create(null);
      state.lastZoneName = '';
      state.locationFilter = '';
      state.scanType = 'stock';          // ค่าเริ่มต้นเดียวกับ loadScanType
      state.customShopZones = [];        // ยังไม่เคยตั้งผังเอง = ใช้ built-in
      state.masterTab = 'shopzones';
      if ($('locFilter')) $('locFilter').value = '';
    };

    /* ภาพรวมของทุกอย่างบนหน้ายิงที่เกี่ยวกับโซน — ใช้เทียบ snapshot ก่อน-หลังได้ทั้งก้อน */
    window.__view = function () {
      const host = $('scanTotalAll');
      const pills = Array.prototype.map.call(host.querySelectorAll('.zone-pill'), function (p) {
        return { zone: p.getAttribute('data-zone'), text: p.textContent,
                 active: p.classList.contains('active'), total: p.hasAttribute('data-zone-total') };
      });
      const ref = $('zoneLockRef');
      return {
        letter: $('zoneLockLetter').textContent,
        letterClass: $('zoneLockLetter').className,
        lab: $('zoneLockLab').textContent,
        refText: ref.textContent,
        refShown: getComputedStyle(ref).display !== 'none',
        title: $('zoneLock').getAttribute('title'),
        big: $('scanTotal').textContent,
        totalLab: $('scanTotalLab').textContent,
        all: host.textContent,
        zones: pills.filter(function (p) { return !p.total; }).map(function (p) { return p.zone; }),
        activeZones: pills.filter(function (p) { return p.active; }).map(function (p) { return p.zone; })
      };
    };
    window.__draw = function () { renderZoneLock(); renderScanTotals(); };
  });

  /* ---------- 1. พิมพ์โซนเอง — จอต้องยึดโซนที่พิมพ์ ---------- */
  console.log('\n[1] พิมพ์ SA-1 ในช่อง "เก็บทีละโซน" แล้วยิงของที่บ้านอยู่โซน D');
  const r1 = await page.evaluate(() => {
    window.__seed('STOCK');
    setZoneFilter('SA-1');                    // เส้นทางจริงจากช่องกรอก/ปุ่มโซน
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    window.__draw();
    const v = window.__view();
    v.active = activeZone();
    v.fromLoc = zoneNameForKey('A1');
    return v;
  });
  check('activeZone() คืนโซนที่พิมพ์', r1.active === 'SA-1', r1.active);
  check('โซนจาก Location ของสินค้าตัวนี้ยังเป็น D (ของเดิมไม่ขยับ)', r1.fromLoc === 'D', r1.fromLoc);
  check('ป้ายตัวใหญ่โชว์ SA-1 ไม่ใช่ D', r1.letter === 'SA-1', r1.letter);
  check('ป้ายใต้ตัวใหญ่เปลี่ยนเป็น "โซนที่กำลังเก็บ"', r1.lab === 'โซนที่กำลังเก็บ', r1.lab);
  /* v2.17.0 เคยโชว์บรรทัด "อ้างอิงคลัง: D" ตรงนี้
     v2.20.0 ซ่อนเมื่อเป็นโซนแบบหน้าร้าน (SA-1) เพราะเด็กหน้าร้านไม่ได้ใช้ผังคลัง
     เคสตัวกรองแบบคลังที่ยังต้องโชว์อยู่ ไปคุมที่ข้อ [12] */
  check('โซนแบบหน้าร้าน = ไม่มีบรรทัดอ้างอิงโซนคลัง (v2.20.0)',
        r1.refShown === false && r1.refText === '', r1);
  check('รหัส 4 ตัวได้ขนาดกลาง ไม่ถูกย่อเหลือ 14px', r1.letterClass === 'long mid', r1.letterClass);
  check('ป้ายยอดบอกโซนที่พิมพ์', r1.totalLab === 'ชิ้นที่ยิงแล้วในโซน SA-1', r1.totalLab);
  check('ยอดใหญ่นับชิ้นที่ยิงในโซนที่พิมพ์ (3 ชิ้น)', r1.big === '3', r1.big);
  check('แถบแยกโซนจัดกลุ่มตามโซนที่พิมพ์ ไม่ใช่ D',
        r1.all === 'SA-1 3 · รวม 3', r1.all);
  check('โซนที่พิมพ์ติด active', JSON.stringify(r1.activeZones) === JSON.stringify(['SA-1']), r1.activeZones);

  /* ---------- 2. ย้ายไปโซนถัดไป — แถบต้องแยกตามโซนที่พิมพ์ ---------- */
  console.log('\n[2] ย้ายไปเก็บโซน SB-2 ต่อ (ของบ้านอยู่โซน H)');
  const r2 = await page.evaluate(() => {
    window.__seed('STOCK');
    setZoneFilter('SA-1');
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    setZoneFilter('SB-2');
    writeScan('A2', 1, 'scan', null);
    writeScan('A2', 1, 'scan', null);
    window.__draw();
    const v = window.__view();
    v.zoneTotals = JSON.parse(JSON.stringify(state.zoneTotals));
    return v;
  });
  check('แยกยอดตามโซนที่พิมพ์ครบทั้งสองโซน',
        r2.all === 'SA-1 3 · SB-2 2 · รวม 5', r2.all);
  check('ไม่มีโซนคลัง D/H โผล่ในแถบแยกโซน',
        r2.zones.indexOf('D') < 0 && r2.zones.indexOf('H') < 0, r2.zones);
  check('ยอดใหญ่ตามโซนที่กำลังเก็บ (SB-2 = 2)', r2.big === '2', r2.big);
  check('ป้ายยอดตาม SB-2', r2.totalLab === 'ชิ้นที่ยิงแล้วในโซน SB-2', r2.totalLab);
  check('ยังเป็นโซนหน้าร้าน (SB-2) → ไม่มีบรรทัดอ้างอิงโซนคลัง', r2.refText === '', r2.refText);
  /* ชั้นสะสมของเดิมต้องไม่ถูกแตะ ไม่งั้นรายงาน/Excel ที่อ่านผังคลังจะเพี้ยนตาม */
  check('state.zoneTotals ยังสะสมด้วยผังคลังเหมือนเดิม (D 3 · H 2)',
        JSON.stringify(r2.zoneTotals) === JSON.stringify({ D: 3, H: 2 }), r2.zoneTotals);

  /* ---------- 3. ไม่พิมพ์โซน — ต้องเหมือน v2.16.8 ทุกตัว ---------- */
  console.log('\n[3] งานคลัง WH ที่ไม่พิมพ์โซน — snapshot ก่อน-หลังต้องเท่ากัน');
  const r3 = await page.evaluate(() => {
    const out = {};
    window.__seed('STOCK');
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    writeScan('A1', 1, 'scan', null);
    writeScan('A2', 1, 'scan', null);
    writeScan('A2', 1, 'scan', null);
    window.__draw();
    out.before = window.__view();

    /* พิมพ์โซนแล้วลบทิ้ง — จอต้องกลับมาเป็นภาพเดิมเป๊ะ ไม่มีอะไรค้าง */
    setZoneFilter('SA-1');
    window.__draw();
    out.typed = window.__view();
    setZoneFilter('');
    window.__draw();
    out.after = window.__view();
    out.active = activeZone();
    return out;
  });
  check('ป้ายตัวใหญ่ = โซนคลังของชิ้นล่าสุด (A2 → H)', r3.before.letter === 'H', r3.before.letter);
  check('ป้ายใต้ตัวใหญ่เป็นข้อความเดิม',
        r3.before.lab === 'โซนของชิ้นนี้ (จาก Location หยิบ)', r3.before.lab);
  check('ไม่มีบรรทัดอ้างอิงคลังโผล่มา',
        r3.before.refShown === false && r3.before.refText === '', r3.before);
  check('ขนาดตัวอักษรเดิม (ไม่ติด long/mid)', r3.before.letterClass === '', r3.before.letterClass);
  check('ยอดและแถบแยกโซนยึดผังคลังเหมือนเดิม',
        r3.before.big === '2' && r3.before.totalLab === 'ชิ้นที่ยิงแล้วในโซน H' &&
        r3.before.all === 'D 3 · H 2 · รวม 5', r3.before);
  check('activeZone() ตอนไม่พิมพ์โซน = โซนจาก Location', r3.active === 'H', r3.active);
  check('snapshot ก่อน-หลัง (พิมพ์โซนแล้วลบทิ้ง) เท่ากันทุกฟิลด์',
        JSON.stringify(r3.before) === JSON.stringify(r3.after), { before: r3.before, after: r3.after });
  check('ระหว่างที่พิมพ์โซนอยู่ ภาพต้องต่างจริง (กันเทสผ่านเพราะไม่มีอะไรทำงาน)',
        JSON.stringify(r3.typed) !== JSON.stringify(r3.before), r3.typed);

  /* ---------- 4. writeScan ต้องบันทึกเหมือนเดิมทุกฟิลด์ ---------- */
  console.log('\n[4] แถวที่บันทึกลงฐาน — zone/zoneName ต้องมาจาก Location เสมอ');
  const r4 = await page.evaluate(() => {
    const out = {};
    window.__seed('STOCK');
    out.plain = writeScan('A1', 1, 'scan', null).rec;

    window.__seed('STOCK');
    setZoneFilter('SA-1');
    out.typed = writeScan('A1', 1, 'scan', null).rec;
    out.typedActive = activeZone();

    /* ของที่ไม่มี Location เลย — ต้องยังตกเป็น no-zone ไม่ใช่รหัสที่พิมพ์ */
    out.noLoc = writeScan('A3', 1, 'scan', null).rec;
    return out;
  });
  check('ไม่พิมพ์โซน: zone=D · zoneName=D · ไม่มี foundZone',
        r4.plain.zone === 'D' && r4.plain.zoneName === 'D' && r4.plain.foundZone === undefined, r4.plain);
  check('พิมพ์โซน: zone/zoneName ยังเป็น D ตามผังคลัง',
        r4.typed.zone === 'D' && r4.typed.zoneName === 'D', r4.typed);
  check('พิมพ์โซน: foundZone = รหัสที่พิมพ์ (ช่องเดิม ค่าเดิม)',
        r4.typed.foundZone === 'SA-1', r4.typed);
  check('โซนที่จอโชว์ต่างจากโซนที่บันทึกจริง — mutation ที่เอา activeZone ไปเขียน rec.zone จะตกข้อนี้',
        r4.typedActive === 'SA-1' && r4.typed.zoneName !== r4.typedActive, r4);
  check('ของที่ไม่มี Location ยังลง no-zone ไม่ใช่รหัสที่พิมพ์',
        r4.noLoc.zone === 'no-zone' && r4.noLoc.zoneName === '(ไม่ระบุโซน)' &&
        r4.noLoc.foundZone === 'SA-1', r4.noLoc);

  /* ---------- 5. ผังโซนหน้าร้าน 180 รหัส + กรองตามปุ่มประเภท (v2.18.0) ---------- */
  console.log('\n[5] SHOP_ZONES — 180 รหัส กรองตาม "ปุ่มประเภท" ไม่ใช่ชนิด Job');
  const r5 = await page.evaluate(() => {
    const out = {
      total: SHOP_ZONES.length,
      uniq: Object.keys(SHOP_ZONES.reduce(function (m, z) { m[z] = 1; return m; }, {})).length,
      first: SHOP_ZONES[0], last: SHOP_ZONES[SHOP_ZONES.length - 1],
      hasSA1: SHOP_ZONES.indexOf('SA-1') >= 0,
      hasDI10: SHOP_ZONES.indexOf('DI-10') >= 0
    };
    const grab = function (type) {
      window.__seed('STOCK');
      state.scanType = type;
      const a = shopZonesFor();
      return { n: a.length, first: a[0],
               allD: a.every(function (z) { return z.charAt(0) === 'D'; }),
               allS: a.every(function (z) { return z.charAt(0) === 'S'; }) };
    };
    out.display = grab('display');
    out.stock = grab('stock');
    out.asset = grab('asset');

    /* บั๊ก v2.17.0: Job เป็น STOCK แต่กดปุ่มโชว์ → ต้องได้ D ไม่ใช่ S
       (ของเดิมกรองด้วย storeTypeOf(job) จึงได้ S ตลอดไม่ว่ากดปุ่มไหน) */
    window.__seed('STOCK');
    state.scanType = 'display';
    const d = shopZonesFor();
    out.jobStockButDisplay = { first: d[0], allD: d.every(function (z) { return z.charAt(0) === 'D'; }) };
    return out;
  });
  check('มี 180 รหัส ไม่ซ้ำกันเลย', r5.total === 180 && r5.uniq === 180, r5);
  check('เริ่ม DA-1 จบ SI-10', r5.first === 'DA-1' && r5.last === 'SI-10', r5);
  check('มีทั้ง SA-1 และ DI-10 ครบ', r5.hasSA1 && r5.hasDI10, r5);
  check('ปุ่ม 🖼 โชว์ → เฉพาะรหัส D 90 รหัส',
        r5.display.n === 90 && r5.display.allD && r5.display.first === 'DA-1', r5.display);
  check('ปุ่ม 📦 สต็อก → เฉพาะรหัส S 90 รหัส',
        r5.stock.n === 90 && r5.stock.allS && r5.stock.first === 'SA-1', r5.stock);
  check('ปุ่ม 🔧 Asset → เห็นทั้ง 180 ไม่บังคับฝั่ง', r5.asset.n === 180, r5.asset);
  check('Job ชนิด STOCK แต่กดปุ่มโชว์ → ได้ D (นี่คือบั๊ก v2.17.0 ที่แก้)',
        r5.jobStockButDisplay.allD && r5.jobStockButDisplay.first === 'DA-1', r5.jobStockButDisplay);

  /* ---------- 6. datalist บนช่อง "เก็บทีละโซน" ---------- */
  console.log('\n[6] datalist ตามปุ่มประเภท และเป็นตัวช่วย ไม่ใช่ตัวบังคับ');
  const r6 = await page.evaluate(() => {
    const out = {};
    const opts = function () {
      return Array.prototype.map.call($('locZones').querySelectorAll('option'),
                                     function (o) { return o.value; });
    };
    out.listAttr = $('locFilter').getAttribute('list');

    /* กดปุ่มจริงผ่าน setScanType — ต้องอัปเดตลิสต์ให้ทันทีโดยไม่ต้องออกจากหน้า */
    window.__seed('STOCK');
    renderScanPage();
    out.startN = opts().length; out.startFirst = opts()[0];

    setScanType('display');
    const a = opts();
    out.showN = a.length; out.showFirst = a[0];
    out.showAllD = a.every(function (z) { return z.charAt(0) === 'D'; });

    setScanType('stock');
    const b = opts();
    out.stockN = b.length; out.stockFirst = b[0];
    out.stockAllS = b.every(function (z) { return z.charAt(0) === 'S'; });

    setScanType('asset');
    out.assetN = opts().length;

    /* วาดซ้ำต้องไม่สะสมของเก่า */
    setScanType('stock');
    renderZoneDatalist();
    out.redrawN = opts().length;

    /* อยู่หน้าอื่นแล้วกดปุ่มต้องไม่พัง (ไม่มีใครเห็น แต่ห้าม error) */
    state.page = 'jobs';
    setScanType('display');
    out.offPageN = opts().length;
    state.page = 'scan';

    /* รหัสนอกลิสต์ต้องพิมพ์แล้วใช้ได้ตามปกติ — datalist ห้ามกลายเป็นตัวจำกัดค่า */
    $('locFilter').value = 'zz-9';
    $('locFilter').dispatchEvent(new Event('input'));
    out.freeFilter = state.locationFilter;
    out.freeActive = activeZone();
    writeScan('A1', 1, 'scan', null);
    window.__draw();
    out.freeLetter = $('zoneLockLetter').textContent;
    out.freeFound = state.scanLog[state.scanLog.length - 1].rec.foundZone;
    return out;
  });
  check('ช่องกรอกผูกกับ datalist แล้ว', r6.listAttr === 'locZones', r6.listAttr);
  check('เปิดหน้ายิงมาเป็นสต็อก → ลิสต์รหัส S',
        r6.startN === 90 && r6.startFirst === 'SA-1', r6);
  check('กดปุ่มโชว์ → ลิสต์เปลี่ยนเป็น 90 รหัส D ทันที',
        r6.showN === 90 && r6.showFirst === 'DA-1' && r6.showAllD, r6);
  check('กดปุ่มสต็อก → กลับเป็น 90 รหัส S',
        r6.stockN === 90 && r6.stockFirst === 'SA-1' && r6.stockAllS, r6);
  check('กดปุ่ม Asset → เห็นทั้ง 180', r6.assetN === 180, r6.assetN);
  check('วาดซ้ำไม่สะสม option เก่า', r6.redrawN === 90, r6.redrawN);
  check('กดปุ่มตอนไม่ได้อยู่หน้ายิง = ไม่วาดใหม่ ไม่ error', r6.offPageN === 90, r6.offPageN);
  check('รหัสนอกลิสต์ยังใช้ได้ และถูก uppercase ตามกติกาเดิม',
        r6.freeFilter === 'ZZ-9' && r6.freeActive === 'ZZ-9', r6);
  check('รหัสนอกลิสต์ขึ้นป้ายและบันทึกเป็น foundZone ได้ปกติ',
        r6.freeLetter === 'ZZ-9' && r6.freeFound === 'ZZ-9', r6);

  /* ---------- 7. แถวที่ยิงก่อนพิมพ์โซน ต้องไม่หายไปจากยอดรวม ---------- */
  console.log('\n[7] ยิงไปก่อนแล้วค่อยพิมพ์โซน — ห้ามทำยอดหาย');
  const r7 = await page.evaluate(() => {
    window.__seed('STOCK');
    writeScan('A1', 1, 'scan', null);         // ยังไม่ได้พิมพ์โซน → ไม่มี foundZone
    writeScan('A1', 1, 'scan', null);
    setZoneFilter('SA-1');
    writeScan('A2', 1, 'scan', null);
    window.__draw();
    return window.__view();
  });
  check('แถวที่ไม่มี foundZone ลงกลุ่ม "ไม่ระบุโซน" ยอดรวมยังครบ 3',
        r7.all === '(ไม่ระบุโซน) 2 · SA-1 1 · รวม 3', r7.all);
  check('ยอดใหญ่ยังเป็นของโซนที่กำลังเก็บ (SA-1 = 1)', r7.big === '1', r7.big);

  /* ---------- 8. ตั้งผังโซนเอง (v2.18.0) ---------- */
  console.log('\n[8] จัดการผังโซนเอง — settings/shopZones');
  const r8 = await page.evaluate(() => {
    const out = {};
    /* ดัก db.update ไว้ดูว่าเขียนอะไรไปที่ไหน — ห้ามแตะโหนดอื่นนอกจาก settings */
    const writes = [];
    window.db.update = function (path, patch) {
      writes.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) });
      return Promise.resolve();
    };
    const toasts = [];
    window.toast = function (m, bad) { toasts.push({ m: m, bad: !!bad }); };

    window.__seed('STOCK');
    out.emptyUsesBuiltin = shopZonesAll().length;
    state.customShopZones = ['SA-1', 'SB-2'];
    out.customWins = shopZonesAll().slice();
    state.customShopZones = [];

    return saveShopZones('sa-1\n  db-10  \n\nSA-1\nSC-3\n')
      .then(function () {
        out.okWrites = writes.slice();
        out.okState = (state.customShopZones || []).slice();
        out.okToast = toasts[toasts.length - 1];
        writes.length = 0;

        /* รหัสผิดแบบ = ไม่บันทึกทั้งชุด ของเดิมต้องอยู่ครบ */
        return saveShopZones('SA-1\nโซนหน้าร้าน\nSB-2');
      })
      .then(function () {
        out.badWrites = writes.slice();
        out.badState = (state.customShopZones || []).slice();
        out.badToast = toasts[toasts.length - 1];
        writes.length = 0;

        return saveShopZones('   \n\n  ');       // ว่างล้วน
      })
      .then(function () {
        out.blankWrites = writes.slice();
        out.blankToast = toasts[toasts.length - 1];
        writes.length = 0;

        /* ไม่มีสิทธิ์ editMaster = เขียนไม่ได้เลย (ชั้นฟังก์ชัน ไม่ใช่แค่ซ่อนปุ่ม) */
        state.me = { uid: 'u9', name: 'เด็กยิง', role: 'scanner', branches: [] };
        return saveShopZones('SZ-9');
      })
      .then(function () {
        out.noPermWrites = writes.slice();
        out.noPermState = (state.customShopZones || []).slice();
        return out;
      });
  });
  check('ยังไม่เคยตั้งผัง → ใช้ built-in 180 รหัส', r8.emptyUsesBuiltin === 180, r8.emptyUsesBuiltin);
  check('ตั้งผังเองแล้ว → ใช้ผังนั้นแทน',
        JSON.stringify(r8.customWins) === JSON.stringify(['SA-1', 'SB-2']), r8.customWins);
  check('บันทึกลง settings/shopZones โหนดเดียว ไม่แตะที่อื่น',
        r8.okWrites.length === 1 && r8.okWrites[0].path === 'settings' &&
        Object.keys(r8.okWrites[0].patch).join() === 'shopZones', r8.okWrites);
  check('trim + uppercase + ตัดบรรทัดว่าง + กันซ้ำ (เหลือ 3 รหัส)',
        JSON.stringify(r8.okState) === JSON.stringify(['SA-1', 'DB-10', 'SC-3']), r8.okState);
  check('บอกด้วยว่าตัดรหัสซ้ำออกกี่ตัว',
        /บันทึกผังโซน 3 รหัส/.test(r8.okToast.m) && /ซ้ำ/.test(r8.okToast.m), r8.okToast);
  check('รหัสผิดแบบ → ไม่เขียนฐานเลย ผังเดิมอยู่ครบ',
        r8.badWrites.length === 0 &&
        JSON.stringify(r8.badState) === JSON.stringify(['SA-1', 'DB-10', 'SC-3']), r8);
  check('บอกเป็นภาษาคนว่ารหัสไหนผิด และยังไม่ได้บันทึก',
        r8.badToast.bad === true && /ยังไม่บันทึก/.test(r8.badToast.m) &&
        /โซนหน้าร้าน/.test(r8.badToast.m), r8.badToast);
  check('ผังว่างล้วน → ไม่เขียนฐาน และบอกว่าต้องมีอย่างน้อย 1 รหัส',
        r8.blankWrites.length === 0 && r8.blankToast.bad === true, r8);
  check('ไม่มีสิทธิ์ editMaster → เขียนไม่ได้ (ล็อกชั้นฟังก์ชัน)',
        r8.noPermWrites.length === 0 &&
        JSON.stringify(r8.noPermState) === JSON.stringify(['SA-1', 'DB-10', 'SC-3']), r8);

  /* ---------- 9. ผังที่ตั้งเองต้องไหลไปถึง datalist ---------- */
  console.log('\n[9] ผังที่ตั้งเอง → datalist บนหน้ายิง');
  const r9 = await page.evaluate(() => {
    const out = {};
    const opts = function () {
      return Array.prototype.map.call($('locZones').querySelectorAll('option'),
                                     function (o) { return o.value; });
    };
    window.__seed('STOCK');
    state.customShopZones = ['SA-1', 'SB-2', 'DA-1', 'ZZ-9'];

    state.scanType = 'stock';  renderZoneDatalist(); out.stock = opts();
    state.scanType = 'display'; renderZoneDatalist(); out.display = opts();
    state.scanType = 'asset';  renderZoneDatalist(); out.asset = opts();

    /* หน้าจัดการ: กล่องข้อความต้อง seed ด้วยผังที่ใช้อยู่ + นับแยก D/S ให้ถูก */
    state.page = 'master'; state.masterTab = 'shopzones';
    renderShopZones();
    out.boxCustom = $('shopZoneBox').value;
    out.statCustom = $('shopZoneStatus').textContent;
    out.canEdit = { save: $('btnSaveShopZones').style.display,
                    reset: $('btnResetShopZones').style.display,
                    ro: $('shopZoneBox').readOnly };

    /* ยังไม่เคยตั้ง → seed ด้วย built-in 180 ให้แก้ต่อได้เลย */
    state.customShopZones = [];
    renderShopZones();
    out.boxLines = $('shopZoneBox').value.split('\n').length;
    out.boxFirst = $('shopZoneBox').value.split('\n')[0];
    out.statBuiltin = $('shopZoneStatus').textContent;

    /* คนไม่มีสิทธิ์: เห็นรายการได้ แต่แก้ไม่ได้ และไม่มีปุ่มให้กด */
    state.me = { uid: 'u9', name: 'เด็กยิง', role: 'scanner', branches: [] };
    renderShopZones();
    out.locked = { save: $('btnSaveShopZones').style.display,
                   reset: $('btnResetShopZones').style.display,
                   ro: $('shopZoneBox').readOnly,
                   lines: $('shopZoneBox').value.split('\n').length };
    return out;
  });
  check('ผังที่ตั้งเอง + ปุ่มสต็อก → เห็นเฉพาะ S ของผังนั้น',
        JSON.stringify(r9.stock) === JSON.stringify(['SA-1', 'SB-2']), r9.stock);
  check('ปุ่มโชว์ → เห็นเฉพาะ D ของผังนั้น',
        JSON.stringify(r9.display) === JSON.stringify(['DA-1']), r9.display);
  check('ปุ่ม Asset → เห็นทั้งผัง รวมรหัสที่ไม่ใช่ D/S',
        JSON.stringify(r9.asset) === JSON.stringify(['SA-1', 'SB-2', 'DA-1', 'ZZ-9']), r9.asset);
  check('กล่องข้อความโชว์ผังที่ใช้อยู่ บรรทัดละรหัส',
        r9.boxCustom === 'SA-1\nSB-2\nDA-1\nZZ-9', r9.boxCustom);
  check('บอกจำนวน + แยก D / S / อื่น และบอกว่าเป็นผังที่ตั้งเอง',
        /ใช้อยู่ 4 รหัส/.test(r9.statCustom) && /โชว์ \(D\) 1/.test(r9.statCustom) &&
        /สต็อก \(S\) 2/.test(r9.statCustom) && /อื่น 1/.test(r9.statCustom) &&
        /ตั้งเอง/.test(r9.statCustom), r9.statCustom);
  check('admin แก้ได้ ปุ่มครบ', r9.canEdit.save === '' && r9.canEdit.reset === '' &&
        r9.canEdit.ro === false, r9.canEdit);
  check('ยังไม่เคยตั้งผัง → กล่อง seed ด้วย built-in 180 รหัส',
        r9.boxLines === 180 && r9.boxFirst === 'DA-1', r9);
  check('และบอกว่าเป็นผังเริ่มต้นของระบบ', /ผังเริ่มต้น/.test(r9.statBuiltin), r9.statBuiltin);
  check('คนไม่มีสิทธิ์: อ่านได้ แก้ไม่ได้ ไม่มีปุ่ม',
        r9.locked.ro === true && r9.locked.save === 'none' &&
        r9.locked.reset === 'none' && r9.locked.lines === 180, r9.locked);

  /* ---------- 10. ลำดับบนหน้ายิง: เลือกก่อน ยิงทีหลัง (v2.18.0) ---------- */
  console.log('\n[10] ปุ่มประเภท + ช่องโซน ต้องอยู่เหนือช่องยิง');
  await page.setViewport({ width: 390, height: 844 });
  const r10 = await page.evaluate(() => {
    window.__seed('STOCK');
    state.page = 'scan';
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    $('pageScan').classList.add('active');
    renderScanPage();

    const stage = $('scanStage');
    const ids = Array.prototype.map.call(stage.children, function (c) { return c.id || ''; });
    const order = function (id) { return ids.indexOf(id); };
    const top = function (id) { return $(id).getBoundingClientRect().top; };

    /* กดปุ่มแล้วยังทำงานครบ: toggle + ผังเปลี่ยน + โฟกัสกลับไปที่ช่องยิง */
    setScanType('display');
    const onBtn = stage.querySelector('[data-scantype="display"]');
    const out = {
      ids: ids,
      typeBeforeInput: order('scanTypeBtns') >= 0 && order('scanTypeBtns') < order('scanInput'),
      locInStage: !!stage.querySelector('#locFilter'),
      locBeforeInput: $('locFilter').compareDocumentPosition($('scanInput')) &
                      Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      infoBeforeInput: order('locFilterInfo') >= 0 && order('locFilterInfo') < order('scanInput'),
      totalFirst: order('scanTotal') === 0,
      typeAfterTotals: order('scanTypeBtns') > order('scanTotalAll'),
      /* บนจอจริงต้องอยู่สูงกว่าช่องยิงด้วย ไม่ใช่แค่ลำดับใน DOM */
      typeAboveOnScreen: top('scanTypeBtns') < top('scanInput'),
      locAboveOnScreen: top('locFilter') < top('scanInput'),
      toggled: onBtn.classList.contains('on'),
      pressed: onBtn.getAttribute('aria-pressed'),
      scanType: state.scanType,
      dlFirst: ($('locZones').querySelector('option') || {}).value,
      focused: document.activeElement === $('scanInput'),
      noOverflow: stage.scrollWidth <= stage.clientWidth + 1
    };
    /* ยิงจริงหลังย้าย DOM — ต้องยังบันทึกได้เหมือนเดิม */
    setZoneFilter('SA-1');
    const rec = writeScan('A1', 1, 'scan', null).rec;
    out.rec = { zone: rec.zone, zoneName: rec.zoneName,
                foundZone: rec.foundZone, stockType: rec.stockType };
    return out;
  });
  check('ปุ่มประเภทอยู่ใน scanStage และอยู่ก่อนช่องยิง', r10.typeBeforeInput === true, r10.ids);
  check('ช่องโซนย้ายเข้ามาใน scanStage แล้ว', r10.locInStage === true, r10.ids);
  check('ช่องโซนอยู่ก่อนช่องยิงใน DOM', r10.locBeforeInput === true, r10.ids);
  check('บรรทัดสรุปโซนตามมาด้วย ยังอยู่ก่อนช่องยิง', r10.infoBeforeInput === true, r10.ids);
  check('ยอดใหญ่ยังอยู่บนสุด แล้วค่อยถึงปุ่มประเภท',
        r10.totalFirst && r10.typeAfterTotals, r10.ids);
  check('บนจอ 390px จริง ทั้งสองอย่างอยู่เหนือช่องยิง',
        r10.typeAboveOnScreen && r10.locAboveOnScreen, r10);
  check('กดปุ่มยังทำงานครบ (ติด on + aria-pressed + state เปลี่ยน)',
        r10.toggled === true && r10.pressed === 'true' && r10.scanType === 'display', r10);
  check('กดปุ่มแล้วผังโซนเปลี่ยนตามทันที', r10.dlFirst === 'DA-1', r10.dlFirst);
  check('โฟกัสยังกลับไปที่ช่องยิงเสมอ', r10.focused === true, r10.focused);
  check('ไม่ล้นขอบกล่องยิงบนจอ 390px', r10.noOverflow === true, r10.noOverflow);
  check('ย้าย DOM แล้วยังยิงบันทึกได้ครบทุกฟิลด์เหมือนเดิม',
        r10.rec.zone === 'D' && r10.rec.zoneName === 'D' &&
        r10.rec.foundZone === 'SA-1' && r10.rec.stockType === 'display', r10.rec);
  await page.setViewport({ width: 1280, height: 900 });

  /* ---------- 11. จอเตี้ยสุดที่ต้องรองรับ: iPhone SE 390x667 (v2.18.1) ----------
     v2.18.0 ดันช่องยิงลงไป ~190px การ์ดสินค้าหลังยิงเลยตกใต้ขอบจอ คนยิงไม่เห็นผล
     ข้อนี้คุมทั้งการบีบระยะขอบและ revealScanCard() ที่เลื่อนการ์ดเข้ามา */
  console.log('\n[11] จอ 390x667 — ยิงแล้วต้องเห็นการ์ดสินค้ากับยอดนับ');
  await page.setViewport({ width: 390, height: 667 });
  const r11a = await page.evaluate(() => {
    /* เสียง/สั่น/เสียงพูด ไม่เกี่ยวกับเลย์เอาต์ ปิดไว้ไม่ให้ headless โวยใส่คอนโซล */
    window.beep = function () {}; window.beepNewCode = function () {};
    window.beepForeign = function () {}; window.beepSpecial = function () {};
    window.speak = function () {}; window.vibrate = function () {};

    window.__seed('STOCK');
    state.page = 'scan';
    state.products.A1.barcode = '111';
    state.scanIndex = null;                 // ให้สร้าง index ใหม่จาก products ที่เพิ่งใส่บาร์โค้ด
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    $('pageScan').classList.add('active');
    setZoneFilter('SA-1');
    renderScanPage();

    /* ความสูงของบล็อกเลือก (ปุ่มประเภท → ช่องยิง) คือสิ่งที่ v2.18.1 ไปบีบ
       วัดเป็นตัวเลขไว้เลย ไม่งั้นใครเผลอต่อข้อความ label ยาว ๆ กลับมาจะไม่มีอะไรร้อง */
    const gap = function () {
      return Math.round($('scanInput').getBoundingClientRect().top -
                        $('scanTypeBtns').getBoundingClientRect().top);
    };
    const out = {
      labelSpanH: Math.round($('locFilter').closest('label')
                    .querySelector('span').getBoundingClientRect().height),
      labelText: $('locFilter').closest('label').querySelector('span').textContent,
      gapWithInfo: gap(),
      infoText: $('locFilterInfo').textContent
    };
    /* บรรทัดสรุปตอนว่างต้องไม่กินที่เลย (ไม่มีทั้งความสูงและ margin ค้าง) */
    $('locFilterInfo').textContent = '';
    out.emptyDisplay = getComputedStyle($('locFilterInfo')).display;
    out.gapEmptyInfo = gap();
    renderLocFilter();                      // คืนข้อความเดิมก่อนไปวัดขั้นถัดไป

    /* ยิงผ่านทางเดียวกับเครื่องยิงจริง — Enter ในช่อง #scanInput */
    $('scanInput').focus();
    $('scanInput').value = '111';
    $('scanInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return out;
  });
  check('ป้ายช่องโซนเหลือบรรทัดเดียว ไม่ตกบรรทัด',
        r11a.labelSpanH < 30, { h: r11a.labelSpanH, text: r11a.labelText });
  /* v2.18.0 วัดได้ 196px · v2.18.1 บีบเหลือ 182px — ตั้งเพดาน 185 ให้เหลือช่องหายใจ 3px
     ใครถอยระยะขอบกลับไปเป็นค่าเดิมข้อนี้จะร้องทันที */
  check('บล็อกเลือก (ปุ่มประเภท → ช่องยิง) ไม่เกิน 185px บนจอ 390px',
        r11a.gapWithInfo <= 185, r11a);
  check('บรรทัดสรุปโซนตอนว่างไม่กินพื้นที่เลย',
        r11a.emptyDisplay === 'none' && r11a.gapEmptyInfo < r11a.gapWithInfo - 20, r11a);
  await new Promise(r => setTimeout(r, 900));      // รอ smooth scroll ให้นิ่งก่อนวัด
  const r11 = await page.evaluate(() => {
    const r = function (id) {
      const b = $(id).getBoundingClientRect();
      return { top: Math.round(b.top), bot: Math.round(b.bottom) };
    };
    const navTop = Math.round(document.querySelector('.nav').getBoundingClientRect().top);
    const barBot = Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom);
    const out = {
      vh: window.innerHeight, navTop: navTop, barBot: barBot,
      last: r('scanLast'), input: r('scanInput'),
      sysBox: r('slSysBox'), qty: r('slQty'),
      focused: document.activeElement === $('scanInput'),
      qtyText: $('slQty').textContent,
      noSideScroll: document.documentElement.scrollWidth <= 390
    };
    /* ยิงตัวถัดไปต่อได้ทันทีโดยไม่ต้องแตะอะไร — โฟกัสต้องยังอยู่ที่ช่องยิง */
    $('scanInput').value = '111';
    $('scanInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    out.qtyAfter2 = $('slQty').textContent;
    out.counts = state.counts.A1;

    /* ปุ่มประเภท/ช่องโซน/datalist ยังทำงานครบหลังบีบระยะ */
    setScanType('display');
    out.dlFirst = ($('locZones').querySelector('option') || {}).value;
    out.typeOn = $('scanTypeBtns').querySelector('[data-scantype="display"]').classList.contains('on');
    $('locFilter').value = 'sb-2';
    $('locFilter').dispatchEvent(new Event('input'));
    out.zone = state.locationFilter;
    return out;
  });
  check('การ์ดสินค้าโผล่เข้ามาในจอแล้ว (ไม่ได้อยู่ใต้ขอบล่าง)',
        r11.last.top < r11.vh && r11.last.top < r11.navTop, r11);
  check('ยอดระบบเห็นได้ ไม่ถูกแถบเมนูล่างบัง',
        r11.sysBox.bot <= r11.navTop, { sysBox: r11.sysBox, navTop: r11.navTop });
  check('ยอดที่ยิงสะสมเห็นได้ ไม่ถูกแถบเมนูล่างบัง',
        r11.qty.bot <= r11.navTop, { qty: r11.qty, navTop: r11.navTop });
  check('ช่องยิงยังอยู่ในจอ อ่านออก (ไม่จมใต้แถบบน ไม่ตกใต้แถบล่าง)',
        r11.input.bot > r11.barBot + 20 && r11.input.top < r11.navTop, r11);
  check('โฟกัสยังอยู่ที่ช่องยิง ยิงตัวถัดไปได้ทันที', r11.focused === true, r11.focused);
  check('ยิงซ้ำแล้วยอดเดินต่อจริง (1 → 2)',
        r11.qtyText === '1' && r11.qtyAfter2 === '2' && r11.counts === 2, r11);
  check('ปุ่มประเภทยังทำงาน + ผังโซนเปลี่ยนตาม',
        r11.typeOn === true && r11.dlFirst === 'DA-1', r11);
  check('ช่องโซนยังรับค่าและ uppercase ตามเดิม', r11.zone === 'SB-2', r11.zone);
  check('ไม่มีสกรอลล์แนวนอนบนจอ 390px', r11.noSideScroll === true, r11.noSideScroll);
  await page.setViewport({ width: 1280, height: 900 });

  /* ---------- 12. งานหน้าร้านไม่เห็น Location คลัง WH (v2.20.0) ----------
     เด็กหน้าร้านเลือกโซน SA-2 แล้วการ์ดขึ้น "หยิบ D1-2-2" = ชั้นที่หน้าร้านไม่มีอยู่จริง
     เขาจะเดินไปหาแล้วไม่เจอ · งานคลังยังต้องเห็นครบเหมือนเดิมทุกกรณี */
  console.log('\n[12] โหมดหน้าร้าน ซ่อน Location คลัง · โหมดคลังเห็นครบ');
  const r12 = await page.evaluate(() => {
    const out = {};
    /* ตัวแยกโหมดต้องตัดสินจากรหัสที่เลือกอย่างเดียว ไม่ใช่จากชนิด Job */
    window.__seed('STOCK');
    out.modes = {};
    [['SA-2', true], ['DB-10', true], ['sa-2', true],     // รหัสผังหน้าร้าน (ตัวพิมพ์เล็กก็ต้องเข้า)
     ['ZZ-9', true],                                      // รหัสนอกผังแต่รูปแบบเดียวกัน = หน้าร้าน
     ['A', false], ['B4', false],                         // ตัวกรองแบบคลัง
     ['I1-3-3', false],                                   // Location คลังเต็ม ๆ ไม่ใช่รหัสชั้นหน้าร้าน
     ['', false]].forEach(function (p) {
      state.locationFilter = p[0];
      out.modes[p[0] || '(ว่าง)'] = { got: isShopZoneMode(), want: p[1] };
    });

    /* ผังที่ตั้งเอง: รหัสที่ไม่เข้ารูปแบบ แต่อยู่ในผังจริง ต้องนับเป็นหน้าร้านด้วย */
    state.customShopZones = ['SHELF1'];
    state.locationFilter = 'SHELF1';
    out.customInPlan = isShopZoneMode();
    state.locationFilter = 'SHELF2';
    out.customNotInPlan = isShopZoneMode();
    state.customShopZones = [];

    /* การ์ดสินค้า — A1 มี Location D1-2-2 · A3 ไม่มี Location เลย */
    const badgeText = function () {
      return Array.prototype.map.call($('slBadges').querySelectorAll('.badge'),
                                      function (b) { return b.textContent; });
    };
    const shot = function (zone, key) {
      window.__seed('STOCK');
      state.page = 'scan';
      setZoneFilter(zone);
      writeScan(key, 1, 'scan', null);
      showScanHit(key);
      window.__draw();
      return { badges: badgeText(), ref: $('zoneLockRef').textContent,
               refShown: getComputedStyle($('zoneLockRef')).display !== 'none' };
    };
    out.shopHasLoc = shot('SA-2', 'A1');       // หน้าร้าน + สินค้ามี Location
    out.shopNoLoc = shot('SA-2', 'A3');        // หน้าร้าน + สินค้าไม่มี Location
    out.whFilter = shot('B4', 'A1');           // ตัวกรองแบบคลัง
    out.noFilter = shot('', 'A1');             // ไม่เลือกอะไรเลย
    return out;
  });
  const modeOk = Object.keys(r12.modes).every(function (k) {
    return r12.modes[k].got === r12.modes[k].want;
  });
  check('isShopZoneMode() แยกโหมดถูกทุกรูปแบบรหัส', modeOk === true, r12.modes);
  check('รหัสในผังที่ตั้งเองนับเป็นหน้าร้านด้วย แม้รูปแบบไม่เข้า regex',
        r12.customInPlan === true && r12.customNotInPlan === false, r12);
  check('⭐ โหมดหน้าร้าน: การ์ดไม่มีป้าย หยิบ / เติม',
        !r12.shopHasLoc.badges.some(function (t) { return /หยิบ|เติม/.test(t); }),
        r12.shopHasLoc.badges);
  check('โหมดหน้าร้าน: สินค้าที่ไม่มี Location ก็ไม่ขึ้น "ไม่มี Location" (ซ่อนทั้งก้อน)',
        !r12.shopNoLoc.badges.some(function (t) { return /Location/.test(t); }),
        r12.shopNoLoc.badges);
  check('โหมดหน้าร้าน: ป้ายอื่นบนการ์ดยังอยู่ครบ ไม่ได้ซ่อนมั่ว',
        r12.shopHasLoc.badges.length > 0, r12.shopHasLoc.badges);
  check('โหมดหน้าร้าน: ไม่มีบรรทัด "อ้างอิงคลัง"',
        r12.shopHasLoc.refShown === false && r12.shopHasLoc.ref === '', r12.shopHasLoc);
  check('⭐ ตัวกรองแบบคลัง (B4): การ์ดยังมี หยิบ D1-2-2 + เติม ครบเหมือนเดิม',
        r12.whFilter.badges.some(function (t) { return t.indexOf('หยิบ D1-2-2') >= 0; }) &&
        r12.whFilter.badges.some(function (t) { return /เติม/.test(t); }),
        r12.whFilter.badges);
  check('ตัวกรองแบบคลัง: บรรทัดอ้างอิงคลังยังโชว์เหมือน v2.17.0',
        r12.whFilter.refShown === true && r12.whFilter.ref === 'อ้างอิงคลัง: D', r12.whFilter);
  check('ไม่เลือกโซนเลย: การ์ดมี Location ครบ และไม่มีบรรทัดอ้างอิง (เหมือนเดิม)',
        r12.noFilter.badges.some(function (t) { return t.indexOf('หยิบ D1-2-2') >= 0; }) &&
        r12.noFilter.refShown === false, r12.noFilter);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
