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
  check('มีบรรทัดอ้างอิงโซนคลังตัวเล็กใต้ป้าย',
        r1.refShown === true && r1.refText === 'อ้างอิงคลัง: D', r1);
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
  check('อ้างอิงคลังตามของชิ้นล่าสุด (A2 → H)', r2.refText === 'อ้างอิงคลัง: H', r2.refText);
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

  /* ---------- 5. ผังโซนหน้าร้าน 180 รหัส ---------- */
  console.log('\n[5] SHOP_ZONES — 180 รหัส กรองตามชนิดงาน');
  const r5 = await page.evaluate(() => {
    const show = shopZonesFor({ storeType: 'SHOW' });
    const stock = shopZonesFor({ storeType: 'STOCK' });
    const other = shopZonesFor({ storeType: 'SHOWCASE' });
    return {
      total: SHOP_ZONES.length,
      uniq: Object.keys(SHOP_ZONES.reduce(function (m, z) { m[z] = 1; return m; }, {})).length,
      first: SHOP_ZONES[0], last: SHOP_ZONES[SHOP_ZONES.length - 1],
      hasSA1: SHOP_ZONES.indexOf('SA-1') >= 0,
      hasDI10: SHOP_ZONES.indexOf('DI-10') >= 0,
      showN: show.length, showAllD: show.every(function (z) { return z.charAt(0) === 'D'; }),
      stockN: stock.length, stockAllS: stock.every(function (z) { return z.charAt(0) === 'S'; }),
      otherN: other.length,
      noJobN: shopZonesFor(null).length          // ไม่มี Job = ถือเป็น STOCK ตาม storeTypeOf
    };
  });
  check('มี 180 รหัส ไม่ซ้ำกันเลย', r5.total === 180 && r5.uniq === 180, r5);
  check('เริ่ม DA-1 จบ SI-10', r5.first === 'DA-1' && r5.last === 'SI-10', r5);
  check('มีทั้ง SA-1 และ DI-10 ครบ', r5.hasSA1 && r5.hasDI10, r5);
  check('งานโชว์ (SHOW) เห็นเฉพาะรหัส D 90 รหัส', r5.showN === 90 && r5.showAllD, r5);
  check('งานสต็อก (STOCK) เห็นเฉพาะรหัส S 90 รหัส', r5.stockN === 90 && r5.stockAllS, r5);
  check('ชนิดงานที่ตั้งเอง = เห็นทั้ง 180 ไม่บังคับผังผิด', r5.otherN === 180, r5.otherN);
  check('ไม่มี Job ถือเป็น STOCK ตาม storeTypeOf เดิม', r5.noJobN === 90, r5.noJobN);

  /* ---------- 6. datalist บนช่อง "เก็บทีละโซน" ---------- */
  console.log('\n[6] datalist เป็นตัวช่วย ไม่ใช่ตัวบังคับ');
  const r6 = await page.evaluate(() => {
    const out = {};
    const opts = function () {
      return Array.prototype.map.call($('locZones').querySelectorAll('option'),
                                     function (o) { return o.value; });
    };
    out.listAttr = $('locFilter').getAttribute('list');

    window.__seed('SHOW');
    renderZoneDatalist();
    const a = opts();
    out.showN = a.length; out.showFirst = a[0];
    out.showAllD = a.every(function (z) { return z.charAt(0) === 'D'; });

    window.__seed('STOCK');
    renderZoneDatalist();
    const b = opts();
    out.stockN = b.length; out.stockFirst = b[0];
    out.stockAllS = b.every(function (z) { return z.charAt(0) === 'S'; });

    /* วาดซ้ำต้องไม่สะสมของเก่า */
    renderZoneDatalist();
    out.redrawN = opts().length;

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
  check('งานโชว์ → ลิสต์ 90 รหัส D เริ่มที่ DA-1',
        r6.showN === 90 && r6.showFirst === 'DA-1' && r6.showAllD, r6);
  check('งานสต็อก → ลิสต์ 90 รหัส S เริ่มที่ SA-1',
        r6.stockN === 90 && r6.stockFirst === 'SA-1' && r6.stockAllS, r6);
  check('วาดซ้ำไม่สะสม option เก่า', r6.redrawN === 90, r6.redrawN);
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

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  check('ไม่มี error ในคอนโซลเลยสักข้อ', errors.length === 0, errors.slice(0, 3));
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
