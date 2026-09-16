/* ============================================================
   หน้ายิง: เด็กหน้าร้านต้องนับแบบไม่เห็นเฉลย (blind count) — v2.10.8
   ============================================================

   ทำไมต้องมี: ถ้า scanner เห็น "ยอดระบบ" ตอนยิง จะเกิดแรงจูงใจให้ยิงให้ครบ
   ตามที่ระบบบอก แทนที่จะนับของที่มีอยู่จริง — ผลต่างหายไปทั้งที่ของขาดจริง
   v2.12.0 — ย้ายจาก "เช็ค role = scanner" มาเป็นความสามารถ seeSystemQty
   แม่แบบให้ admin/counter ติ๊กไว้ · scanner ไม่ติ๊ก (blind) · viewer ไม่ติ๊ก
   viewer ไม่กระทบของจริง เพราะเข้าหน้ายิงไม่ได้อยู่แล้ว (PAGE_ROLES.scan = perm scan)
   ข้อดีคือตอนนี้เปิดให้ scanner คนไหนเห็นยอดระบบได้เป็นราย ๆ โดยไม่ต้องเลื่อนเป็น counter

   กันอะไร:
   [1] scanner → กล่อง "ยอดระบบ" บนการ์ดสินค้าถูกซ่อน
       ต้องซ่อนทั้งสองทางที่การ์ดถูกวาด (สินค้าปกติ + บาร์โค้ดที่ไม่มีในระบบ)
   [2] scanner → บรรทัด "SKU ที่ยิงแล้ว" ไม่มีตัวหาร (ยอดรวมทั้งรอบ)
   [3] counter/admin/viewer → เห็นครบเหมือนเดิมทุกอย่าง
   [4] ช่อง "ค้างส่ง" มีคำอธิบายเป็นภาษาคน + แตะแล้วเด้งให้มือถืออ่านได้
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.enqueueWrite = function () {};
  window.db.update = function () { return Promise.resolve(); };
  window.session.token = function () { return 'tok'; };
  hideLogin();

  window.__seed = function (role) {
    state.me = { uid: 'u1', name: 'สมชาย', role: role, branches: [] };
    state.counter = 'สมชาย';
    state.roundId = 'R1'; state.cycleId = 'C1';
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', jobCode: 'J1', branchCode: 'B1',
                               cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.cycles = { C1: { status: 'counting', info: {} } };
    state.products = {
      A1: { code: 'A1', name: 'สินค้า A1', type: 'product', category: 'หมวด',
            costPrice: 10, sellPrice: 20 }
    };
    /* ยอดระบบ 3 SKU — ตัวหารที่ scanner ต้องไม่เห็น */
    state.systemQty = { A1: 25, A2: 10, A3: 5 };
    state.counts = { A1: 4 };
    state.scanQty = { A1: 4 }; state.manualQty = {};
    state.zones = {}; state.zoneTotals = {}; state.foundZones = {};
    state.unknown = {}; state.unknownKeys = {};
    state.locations = { offline: {}, online: {} };
    state.locationSet = 'offline'; state.locationFilter = '';
    state.scanLog = []; state.manualLog = [];
    window.__toasts = [];
    showPage('scan');
  };

  window.__card = function () {
    var box = document.getElementById('slSysBox');
    return {
      exists: !!box,
      shown: !!box && getComputedStyle(box).display !== 'none',
      inline: box ? box.style.display : 'MISSING',
      sysText: $('slSys').textContent,
      qtyText: $('slQty').textContent
    };
  };

  window.__live = function () {
    renderLivePanel();
    var cells = Array.prototype.map.call(
      document.querySelectorAll('#liveStats .live-cell'), function (d) {
        return { label: d.querySelector('span').textContent,
                 value: d.querySelector('b').textContent,
                 title: d.title || '',
                 clickable: typeof d.onclick === 'function' };
      });
    return cells;
  };
  window.__skuCell = function () {
    return window.__live().filter(function (c) { return /^SKU ที่ยิงแล้ว/.test(c.label); })[0];
  };
  window.__pendCell = function () {
    return window.__live().filter(function (c) { return /^ค้างส่ง/.test(c.label); })[0];
  };
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  /* แผงสรุปสด (liveStats) เป็นคอลัมน์ฝั่งขวาของเลย์เอาต์ Laptop
     renderLivePanel() มี early-return ถ้าแผงถูกซ่อน จอแคบจึงวาดไม่ออกเลย
     ใช้จอกว้างทั้งไฟล์ — ส่วนที่ตรวจการ์ดสินค้าไม่ขึ้นกับความกว้างอยู่แล้ว */
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(HARNESS);

  /* หา renderLivePanel ให้เจอก่อน — ถ้าชื่อฟังก์ชันเปลี่ยน เทสทั้งไฟล์จะไร้ความหมาย */
  const liveFn = await page.evaluate(() => typeof renderLivePanel === 'function');
  check('มีฟังก์ชันวาดสรุปสดให้เรียก', liveFn === true, 'renderLivePanel');

  /* ---------- [1] scanner — การ์ดสินค้า ---------- */
  console.log('\n[1] ⭐ scanner ต้องไม่เห็น "ยอดระบบ" บนการ์ดสินค้า');
  const scProd = await page.evaluate(() => {
    window.__seed('scanner');
    showScanHit('A1');
    return window.__card();
  });
  check('มีกล่องยอดระบบอยู่ใน DOM', scProd.exists === true, scProd);
  check('⭐ สินค้าปกติ: กล่องยอดระบบถูกซ่อน', scProd.shown === false, scProd);
  check('แต่ยอดที่ยิงเองยังเห็น (4 ชิ้น)', scProd.qtyText === '4', scProd);

  const scNew = await page.evaluate(() => {
    window.__seed('scanner');
    showScanNewCode('8850999999999', safeKey('8850999999999'));
    return window.__card();
  });
  check('⭐ บาร์โค้ดที่ไม่มีในระบบ: กล่องยอดระบบถูกซ่อนด้วย', scNew.shown === false, scNew);

  console.log('\n[1b] ยิงสลับสองแบบต่อกัน ต้องไม่รั่วกลับมา');
  const mix = await page.evaluate(() => {
    window.__seed('scanner');
    showScanHit('A1');
    const a = window.__card().shown;
    showScanNewCode('8851111111111', safeKey('8851111111111'));
    const b = window.__card().shown;
    showScanHit('A1');
    const c = window.__card().shown;
    return { a: a, b: b, c: c };
  });
  check('ซ่อนตลอดทุกจังหวะ', mix.a === false && mix.b === false && mix.c === false, mix);

  /* ---------- [2] scanner — บรรทัด SKU ---------- */
  console.log('\n[2] ⭐ scanner ต้องไม่เห็นตัวหาร (ยอดรวมทั้งรอบ)');
  const scSku = await page.evaluate(() => { window.__seed('scanner'); return window.__skuCell(); });
  check('⭐ ไม่มี " / " ในค่า', scSku.value.indexOf(' / ') < 0, scSku);
  check('ไม่มีเลข 3 (จำนวน SKU ทั้งรอบ) โผล่', scSku.value.indexOf('3') < 0, scSku);
  check('ยังบอกจำนวนที่ตัวเองยิงได้ (1 SKU)', scSku.value === '1', scSku);

  /* ---------- [3] คนที่ติ๊ก seeSystemQty ไว้ต้องเห็นครบเหมือนเดิม ---------- */
  console.log('\n[3] counter / admin — เห็นครบเหมือนเดิม');
  for (const role of ['counter', 'admin']) {
    const v = await page.evaluate(r => {
      window.__seed(r);
      showScanHit('A1');
      return { card: window.__card(), sku: window.__skuCell() };
    }, role);
    check(role + ' เห็นกล่องยอดระบบ', v.card.shown === true, { role, card: v.card });
    check(role + ' เห็นยอดระบบจริง (25)', v.card.sysText === '25', { role, card: v.card });
    check(role + ' เห็นตัวหารใน SKU (1 / 3)', v.sku.value === '1 / 3', { role, sku: v.sku });
  }

  console.log('\n[3b] บาร์โค้ดไม่มีในระบบ — role อื่นยังเห็นกล่อง (โชว์ 0)');
  const cnNew = await page.evaluate(() => {
    window.__seed('counter');
    showScanNewCode('8850999999999', safeKey('8850999999999'));
    return window.__card();
  });
  check('counter ยังเห็นกล่องยอดระบบ', cnNew.shown === true, cnNew);
  check('ค่าเป็น 0 ตามเดิม', cnNew.sysText === '0', cnNew);

  /* ---------- [4] คำอธิบาย "ค้างส่ง" ---------- */
  console.log('\n[4] ช่อง "ค้างส่ง" ต้องอธิบายเป็นภาษาคน');
  const pend = await page.evaluate(() => { window.__seed('counter'); return window.__pendCell(); });
  check('มีไอคอนบอกว่ากดดูได้', /ⓘ/.test(pend.label), pend.label);
  check('มีคำอธิบายใน title', pend.title.length > 40, pend.title);
  check('อธิบายว่ายังไม่ถูกบันทึกขึ้นเซิร์ฟเวอร์',
        /ยังไม่ถูกบันทึกขึ้นเซิร์ฟเวอร์/.test(pend.title), pend.title);
  check('บอกว่าปกติควรเป็น 0', /ปกติควรเป็น 0/.test(pend.title), pend.title);
  check('บอกให้ทำอะไรต่อ (เช็กเน็ตแล้วลองใหม่)',
        /เช็กเน็ตแล้วลองใหม่/.test(pend.title), pend.title);
  check('กดได้', pend.clickable === true, pend);

  const tapped = await page.evaluate(() => {
    window.__seed('counter');
    renderLivePanel();
    const cells = document.querySelectorAll('#liveStats .live-cell');
    let hit = null;
    Array.prototype.forEach.call(cells, function (d) {
      if (/^ค้างส่ง/.test(d.querySelector('span').textContent)) hit = d;
    });
    window.__toasts = [];
    hit.click();
    return { toast: (window.__toasts[0] || {}).m, title: hit.title };
  });
  check('⭐ แตะแล้วเด้งข้อความให้มือถืออ่านได้', !!tapped.toast, tapped);
  check('ข้อความที่เด้งตรงกับ title', tapped.toast === tapped.title, tapped);

  console.log('\n[4b] ช่องอื่นต้องไม่กลายเป็นปุ่มไปด้วย');
  const others = await page.evaluate(() => {
    window.__seed('counter');
    return window.__live().filter(function (c) { return !/^ค้างส่ง/.test(c.label); });
  });
  check('ช่องอื่นไม่มี title', others.every(c => c.title === ''), others.map(c => c.label));
  check('ช่องอื่นกดไม่ได้', others.every(c => c.clickable === false), others.map(c => c.label));
  check('ช่องอื่นไม่มีไอคอน ⓘ ติดมา', others.every(c => !/ⓘ/.test(c.label)), others.map(c => c.label));

  /* ---------- [5] ต้องผูกกับ hasPerm('seeSystemQty') ที่เดียว ---------- */
  console.log('\n[5] ต้องผูกกับ hasPerm(seeSystemQty) ไม่ใช่เขียนเงื่อนไข role ซ้ำเอง');
  const src = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  check('ซ่อนกล่องยอดระบบด้วย hasPerm(seeSystemQty)',
        (src.match(/slSysBox'\)\.style\.display = hasPerm\('seeSystemQty'\)/g) || []).length === 2,
        'slSysBox x2');
  check('บรรทัด SKU ใช้ hasPerm(seeSystemQty)',
        /var skuCell = !hasPerm\('seeSystemQty'\)/.test(src), 'skuCell');
  check('ไม่มีใครเขียนเงื่อนไข role = scanner ซ้ำเองนอก hasPerm',
        !/isScannerOnly\(\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no isScannerOnly');

  /* viewer ไม่ได้ติ๊ก seeSystemQty แล้ว แต่ต้องพิสูจน์ว่าเข้าหน้ายิงไม่ได้อยู่ดี
     ไม่งั้นการถอด viewer ออกจากข้อ [3] จะกลายเป็นการลดสิทธิ์ที่มีคนเห็นจริง */
  const vw = await page.evaluate(() => {
    window.__seed('viewer');
    return { see: hasPerm('seeSystemQty'), scanPage: canSeePage('scan'), doc: hasPerm('docs') };
  });
  check('viewer ไม่มี seeSystemQty', vw.see === false, vw);
  check('viewer เข้าหน้ายิงไม่ได้อยู่แล้ว จึงไม่กระทบของจริง', vw.scanPage === false, vw);
  check('viewer ยังเปิดเอกสารได้เหมือนเดิม', vw.doc === true, vw);

  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
