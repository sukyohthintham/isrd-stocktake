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
    window.__toasts = []; window.__writes = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
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
      state.priceField = 'costPrice'; state.summaryTab = 'job';
      state.products = {}; state.systemQty = {}; state.counts = {};
      state.scanQty = {}; state.manualQty = {}; state.unknownKeys = {}; state.unknown = {};
      state.manualLog = []; state.scanLog = []; state.zones = {}; state.transfers = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.zoneTotals = {};
      var add = function (code, name, sys, act, price) {
        state.products[code] = { code: code, name: name, category: 'ห', type: 'product',
                                 costPrice: price, sellPrice: price };
        if (sys !== null) state.systemQty[code] = sys;
        if (act) { state.counts[code] = act; state.scanQty[code] = act; }
      };
      /* กลุ่มเกิน 4 ตัว — ONE1 act=1 (ไม่มีปุ่มเอาออกทั้งหมด) · OVR9 act=9 · อีกสองตัวไว้ทดสอบค้นหา */
      add('OVR9', 'หมวกแก๊ปปักโลโก้', 4, 9, 20);
      add('ONE1', 'ถุงเท้าข้อสั้น', 0, 1, 15);
      add('OVR2', 'เสื้อยืดคอกลม', 3, 6, 50);
      add('ZZZ7', 'กางเกงยีนส์ขายาว', 1, 4, 90);
      add('SHT1', 'เสื้อเชิ้ตแขนยาว', 10, 3, 40);   // กลุ่มขาด ไว้เช็คว่ากลุ่มอื่นก็มีช่องค้นหา
      renderSummary();
    };

    window.__popup = function (kind) {
      const box = document.querySelector('[data-sumcard-list="' + kind + '"]');
      if (!box) return null;
      const rows = Array.prototype.map.call(box.querySelectorAll('.srow'), function (r) {
        return { sku: r.getAttribute('data-sku'),
                 one: !!r.querySelector('[data-removeover]'),
                 all: !!r.querySelector('[data-removeall]'),
                 allText: (r.querySelector('[data-removeall]') || {}).textContent || null,
                 allDisabled: (r.querySelector('[data-removeall]') || {}).disabled };
      });
      const s = box.querySelector('[data-sumcard-search]');
      return { rows: rows, skus: rows.map(function (r) { return r.sku; }),
               hasSearch: !!s, placeholder: s ? s.placeholder : null,
               empty: !!box.querySelector('[data-sumcard-empty]'),
               emptyText: (box.querySelector('[data-sumcard-empty]') || {}).textContent || null,
               searchBeforeList: !!box.querySelector('[data-sumcard-search] ~ [data-sumcard-rows]') };
    };
    window.__type = function (kind, t) {
      const s = document.querySelector('[data-sumcard-search="' + kind + '"]');
      s.value = t;
      s.oninput.call(s);
      return window.__popup(kind);
    };
  });

  /* ---------- 1. ช่องค้นหาในป๊อปอัป ---------- */
  console.log('\n[1] ช่องค้นหาในป๊อปอัป');
  const r1 = await page.evaluate(() => {
    window.__seed('admin');
    openSumCard('over');
    return window.__popup('over');
  });
  check('มีช่องค้นหา', r1.hasSearch === true, r1.hasSearch);
  check('placeholder ตรงตามสเปก',
        r1.placeholder === '🔍 พิมพ์รหัส/ชื่อ กรองรายการ', r1.placeholder);
  check('ช่องค้นหาอยู่เหนือลิสต์', r1.searchBeforeList === true, r1.searchBeforeList);
  check('เปิดมาโชว์ครบทั้ง 4 รายการ', r1.rows.length === 4, r1.skus);

  /* ---------- 2. กรองด้วยรหัส / ชื่อ ---------- */
  console.log('\n[2] กรองรายการ');
  const r2 = await page.evaluate(() => {
    const out = {};
    out.byCode = window.__type('over', 'OVR');
    out.byName = window.__type('over', 'หมวก');
    out.lower = window.__type('over', 'zzz7');
    out.partialName = window.__type('over', 'ยีนส์');
    out.miss = window.__type('over', 'ไม่มีคำนี้');
    out.cleared = window.__type('over', '');
    out.spaces = window.__type('over', '   ');
    return out;
  });
  check('ค้นด้วยรหัสบางส่วน (OVR → 2 ตัว)',
        JSON.stringify(r2.byCode.skus.sort()) === JSON.stringify(['OVR2', 'OVR9']), r2.byCode.skus);
  check('ค้นด้วยชื่อไทย', JSON.stringify(r2.byName.skus) === JSON.stringify(['OVR9']), r2.byName.skus);
  check('พิมพ์ตัวเล็กก็เจอ (zzz7 → ZZZ7)',
        JSON.stringify(r2.lower.skus) === JSON.stringify(['ZZZ7']), r2.lower.skus);
  check('ค้นชื่อบางส่วนกลางคำ', JSON.stringify(r2.partialName.skus) === JSON.stringify(['ZZZ7']),
        r2.partialName.skus);
  check('ไม่พบ → ขึ้น "ไม่พบรายการที่ค้น" ไม่ใช่ลิสต์ว่าง',
        r2.miss.rows.length === 0 && r2.miss.empty === true &&
        r2.miss.emptyText === 'ไม่พบรายการที่ค้น', r2.miss);
  check('ล้างคำค้น → กลับมาครบ 4', r2.cleared.rows.length === 4, r2.cleared.skus);
  check('พิมพ์เว้นวรรคล้วน = ไม่กรอง', r2.spaces.rows.length === 4, r2.spaces.skus);

  /* ---------- 3. ปุ่มเอาออกทั้งหมด โผล่เฉพาะ act > 1 ---------- */
  console.log('\n[3] ปุ่ม "เอาออกทั้งหมด"');
  const r3 = await page.evaluate(() => {
    const v = window.__type('over', '');
    const by = {};
    v.rows.forEach(function (r) { by[r.sku] = r; });
    return by;
  });
  check('OVR9 (act 9) มีทั้งสองปุ่ม', r3.OVR9.one === true && r3.OVR9.all === true, r3.OVR9);
  check('ป้ายปุ่มบอกจำนวน', r3.OVR9.allText === '🗑 เอาออกทั้งหมด (9 ชิ้น)', r3.OVR9.allText);
  check('ONE1 (act 1) มีแค่ปุ่มเอาออก 1 ชิ้น',
        r3.ONE1.one === true && r3.ONE1.all === false, r3.ONE1);
  check('ปุ่มไม่ถูก disable ตอน Job กำลังนับ', r3.OVR9.allDisabled === false, r3.OVR9.allDisabled);

  /* ---------- 4. กดเอาออกทั้งหมด → ต้องถามยืนยันก่อน ---------- */
  console.log('\n[4] เอาออกทั้งหมด — ยืนยันก่อนเขียน');
  const r4 = await page.evaluate(async () => {
    window.__seed('admin');
    openSumCard('over');
    window.__writes = []; window.__toasts = [];
    document.querySelector('[data-removeall="OVR9"]').click();
    /* กล่องยืนยันต้องขึ้นมาก่อน ยังไม่เขียนอะไร */
    const mid = { title: $('modalTitle').textContent, msg: $('modalMsg').textContent,
                  ok: $('modalOk').textContent, writes: window.__writes.length,
                  danger: $('modalOk').className.indexOf('danger') >= 0 };
    $('modalOk').click();                       // ยืนยัน
    await new Promise(function (r) { setTimeout(r, 60); });
    const rec = window.__writes.length
      ? Object.keys(window.__writes[0].patch).map(function (k) { return window.__writes[0].patch[k]; })[0]
      : null;
    return { mid: mid, writes: window.__writes.length, delta: rec && rec.delta,
             reason: rec && rec.reason, mode: rec && rec.mode, user: rec && rec.user,
             hasTs: !!(rec && rec.ts),
             counts: state.counts.OVR9,
             toast: (window.__toasts[0] || {}).m,
             reopened: !!document.querySelector('[data-sumcard-list="over"]') };
  });
  check('ยังไม่เขียนก่อนยืนยัน', r4.mid.writes === 0, r4.mid.writes);
  check('กล่องยืนยันบอกชื่อ SKU + จำนวน',
        r4.mid.title === 'เอาออกทั้งหมด?' &&
        /เอา OVR9 ออกทั้งหมด 9 ชิ้น\?/.test(r4.mid.msg), r4.mid);
  check('บอกชื่อสินค้าด้วย', /หมวกแก๊ปปักโลโก้/.test(r4.mid.msg), r4.mid.msg);
  check('ย้ำว่าไม่ได้ลบยอดเดิม', /ไม่ได้ลบยอดเดิมทิ้ง/.test(r4.mid.msg), r4.mid.msg);
  check('ปุ่มยืนยันเป็นสีอันตราย', r4.mid.danger === true, r4.mid.danger);
  check('ปุ่มยืนยันบอกจำนวน', r4.mid.ok === 'เอาออก 9 ชิ้น', r4.mid.ok);
  check('ยืนยันแล้วเขียน 1 เรคอร์ด delta -9', r4.writes === 1 && r4.delta === -9, r4);
  check('เหตุผลเป็น "เอาออกทั้งหมดจากสรุป"', r4.reason === 'เอาออกทั้งหมดจากสรุป', r4.reason);
  check('ยังเป็น writeScan ปกติ (mode scan + มีคนทำ/เวลา)',
        r4.mode === 'scan' && r4.user === 'สมชาย' && r4.hasTs === true, r4);
  check('ยอดในเครื่องเหลือ 0', r4.counts === 0, r4.counts);
  check('toast บอกจำนวนที่เอาออก + ไม่ได้ลบยอดเดิม',
        /เอา OVR9 ออก 9 ชิ้นแล้ว/.test(r4.toast || '') && /ไม่ได้ลบยอดเดิม/.test(r4.toast || ''),
        r4.toast);
  check('ป๊อปอัปกลุ่มเดิมเปิดกลับให้', r4.reopened === true, r4.reopened);

  /* ---------- 5. กดยกเลิกในกล่องยืนยัน ---------- */
  console.log('\n[5] ยกเลิกกล่องยืนยัน');
  const r5 = await page.evaluate(async () => {
    window.__seed('admin');
    openSumCard('over');
    window.__writes = [];
    document.querySelector('[data-removeall="OVR9"]').click();
    $('modalCancel').click();                   // ยกเลิก
    await new Promise(function (r) { setTimeout(r, 60); });
    return { writes: window.__writes.length, counts: state.counts.OVR9,
             backToList: !!document.querySelector('[data-sumcard-list="over"]'),
             modalOpen: $('modalBg').classList.contains('show') };
  });
  check('ยกเลิกแล้วไม่เขียนอะไร', r5.writes === 0, r5.writes);
  check('ยอดไม่ถูกแตะ', r5.counts === 9, r5.counts);
  check('กลับเข้าลิสต์เดิม ไม่เด้งออกไปหน้าสรุป',
        r5.backToList === true && r5.modalOpen === true, r5);

  /* ---------- 6. ปุ่มเอาออก 1 ชิ้น ยังไม่ถามยืนยัน ---------- */
  console.log('\n[6] ปุ่มเอาออก 1 ชิ้น (ของเดิม) ต้องไม่ถามซ้ำ');
  const r6 = await page.evaluate(async () => {
    window.__seed('admin');
    openSumCard('over');
    window.__writes = [];
    document.querySelector('[data-removeover="OVR9"]').click();
    await new Promise(function (r) { setTimeout(r, 60); });
    const rec = Object.keys(window.__writes[0].patch)
      .map(function (k) { return window.__writes[0].patch[k]; })[0];
    return { writes: window.__writes.length, delta: rec.delta, reason: rec.reason,
             counts: state.counts.OVR9 };
  });
  check('กดแล้วเขียนทันที ไม่มีกล่องยืนยันคั่น',
        r6.writes === 1 && r6.delta === -1, r6);
  check('เหตุผลยังเป็นข้อความเดิม', r6.reason === 'เอาออกจากสรุป (ยิงเกิน)', r6.reason);
  check('ยอดลด 1 (9 → 8)', r6.counts === 8, r6.counts);

  /* ---------- 7. สิทธิ์ + Job ปิด ---------- */
  console.log('\n[7] สิทธิ์และสถานะ Job');
  const r7 = await page.evaluate(async () => {
    const out = {};
    /* Job ปิดแล้ว → ปุ่มทั้งสองถูกล็อก */
    window.__seed('admin');
    state.roundIndex.R1.status = 'closed';
    renderSummary();
    openSumCard('over');
    const v = window.__popup('over').rows.filter(function (r) { return r.sku === 'OVR9'; })[0];
    out.closedDisabled = v.allDisabled;
    $('modalOk').click();
    state.roundIndex.R1.status = 'counting';

    /* scanner เรียกตรง ๆ พร้อม qty ก้อนใหญ่ ต้องไม่ผ่าน */
    window.__seed('scanner');
    window.__writes = []; window.__toasts = [];
    removeOverScan({ key: 'OVR9', code: 'OVR9', act: 9 }, 'over', 9);
    await new Promise(function (r) { setTimeout(r, 60); });
    out.scannerWrites = window.__writes.length;
    out.scannerCounts = state.counts.OVR9;
    out.scannerToast = (window.__toasts[0] || {}).m;
    return out;
  });
  check('Job ปิดแล้ว ปุ่มเอาออกทั้งหมดถูกล็อก', r7.closedDisabled === true, r7.closedDisabled);
  check('scanner เรียกตรง ๆ ก็ไม่เขียน', r7.scannerWrites === 0, r7.scannerWrites);
  check('ยอดไม่ถูกแตะ', r7.scannerCounts === 9, r7.scannerCounts);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(r7.scannerToast || ''), r7.scannerToast);

  /* ---------- 8. กลุ่มอื่นก็มีช่องค้นหา + ลิสต์ว่าง ---------- */
  console.log('\n[8] กลุ่มอื่น ๆ');
  const r8 = await page.evaluate(() => {
    const out = {};
    window.__seed('admin');
    openSumCard('short');
    out.short = window.__popup('short');
    $('modalOk').click();

    /* กลุ่มที่ไม่มีรายการเลย → ไม่ต้องมีช่องค้นหา */
    state.products = {}; state.systemQty = {}; state.counts = {};
    renderSummary();
    openSumCard('match');
    out.emptyGroup = window.__popup('match');
    $('modalOk').click();
    return out;
  });
  check('กลุ่มขาดก็มีช่องค้นหา', r8.short.hasSearch === true, r8.short.hasSearch);
  check('กลุ่มที่ไม่มีรายการ ไม่มีช่องค้นหา', r8.emptyGroup.hasSearch === false, r8.emptyGroup);
  check('กลุ่มว่างขึ้นข้อความของกลุ่มนั้น ไม่ใช่ "ไม่พบรายการที่ค้น"',
        r8.emptyGroup.empty === true && r8.emptyGroup.emptyText === 'รอบนี้ยังไม่มีสินค้าที่นับตรง',
        r8.emptyGroup.emptyText);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
