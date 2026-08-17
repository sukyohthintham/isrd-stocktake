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
    window.renderDoc = function () {};
    hideLogin();

    /* ตรง 3 SKU = 5+3+2 = 10 ชิ้น
       ขาด 2 SKU = (10-6) + (8-7) = 5 ชิ้น · มูลค่า -(4*50) - (1*25) = -225
       เกิน 2 SKU = (9-4) + (3-0) = 8 ชิ้น · มูลค่า (5*20) + (3*30) = +190 */
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
      var add = function (code, sys, act, price) {
        state.products[code] = { code: code, name: 'ชื่อ ' + code, category: 'ห',
                                 type: 'product', costPrice: price, sellPrice: price };
        if (sys !== null) state.systemQty[code] = sys;
        if (act) { state.counts[code] = act; state.scanQty[code] = act; }
      };
      add('M1', 5, 5, 100); add('M2', 3, 3, 100); add('M3', 2, 2, 10);
      add('S1', 10, 6, 50); add('S2', 8, 7, 25);
      add('O1', 4, 9, 20);  add('F1', null, 3, 30);
      renderSummary();
      renderScanTotals();
    };
    window.__cards = function (prefix) {
      var pick = function (kind) {
        var cap = kind.charAt(0).toUpperCase() + kind.slice(1);
        return {
          sku: document.getElementById(prefix + cap + (prefix === 'card' ? 'Num' : 'Num')).textContent,
          sub: document.getElementById(prefix + cap + 'Pc').textContent,
          money: prefix === 'card' ? document.getElementById(prefix + cap + 'Val').textContent : null
        };
      };
      return { match: pick('match'), short: pick('short'), over: pick('over') };
    };
  });

  /* ---------- 1. sumCardPieces คิดถูกตามสูตร ---------- */
  console.log('\n[1] sumCardPieces');
  const r1 = await page.evaluate(() => {
    window.__seed('admin');
    const data = summaryData();
    const out = {};
    ['match', 'short', 'over'].forEach(function (kind) {
      const rows = sumCardRows(data, kind);
      out[kind] = { skus: rows.length, pieces: sumCardPieces(rows, kind) };
      /* คิดซ้ำด้วยสูตรตรงตามสเปก เทียบกันอีกชั้น */
      out[kind].bySpec = rows.reduce(function (s, r) {
        if (kind === 'match') return s + r.act;
        return s + (kind === 'short' ? (r.sys - r.act) : (r.act - r.sys));
      }, 0);
    });
    return out;
  });
  check('ตรง: 3 SKU · 10 ชิ้น (ผลรวม act)',
        r1.match.skus === 3 && r1.match.pieces === 10, r1.match);
  check('ขาด: 2 SKU · 5 ชิ้น (ผลรวม sys-act)',
        r1.short.skus === 2 && r1.short.pieces === 5, r1.short);
  check('เกิน: 2 SKU · 8 ชิ้น (ผลรวม act-sys)',
        r1.over.skus === 2 && r1.over.pieces === 8, r1.over);
  check('ตรงกับสูตรในสเปกทุกกลุ่ม',
        r1.match.pieces === r1.match.bySpec && r1.short.pieces === r1.short.bySpec &&
        r1.over.pieces === r1.over.bySpec, r1);

  /* ---------- 2. การ์ดหน้าสรุป ---------- */
  console.log('\n[2] การ์ดหน้าสรุป — SKU ตัวใหญ่ + ชิ้น/มูลค่า ตัวเล็ก');
  const r2 = await page.evaluate(() => window.__cards('card'));
  check('ตรง: 3 SKU · 10 ชิ้น · ไม่มีบรรทัดมูลค่า',
        r2.match.sku === '3' && r2.match.sub === '10 ชิ้น' &&
        r2.match.money.trim() === '', r2.match);
  check('ขาด: 2 SKU · 5 ชิ้น · -฿225.00',
        r2.short.sku === '2' && r2.short.sub === '5 ชิ้น' &&
        r2.short.money === '-฿225.00', r2.short);
  check('เกิน: 2 SKU · 8 ชิ้น · +฿190.00',
        r2.over.sku === '2' && r2.over.sub === '8 ชิ้น' &&
        r2.over.money === '+฿190.00', r2.over);

  /* บรรทัดชิ้นต้องมาก่อนบรรทัดมูลค่าในการ์ด และเงินต้องไม่ตัดบรรทัดจนเครื่องหมายลบหลุด */
  const r2b = await page.evaluate(() => {
    const card = document.getElementById('cardShort');
    const subs = Array.prototype.map.call(card.querySelectorAll('.s-sub'), function (e) { return e.id; });
    return { order: subs, wrap: getComputedStyle(document.getElementById('cardShortVal')).whiteSpace };
  });
  check('จำนวนชิ้นอยู่บรรทัดก่อนมูลค่า',
        JSON.stringify(r2b.order) === JSON.stringify(['cardShortPc', 'cardShortVal']), r2b.order);
  check('บรรทัดมูลค่าเป็น nowrap (เครื่องหมายลบไม่หลุดคนละบรรทัด)',
        r2b.wrap === 'nowrap', r2b.wrap);

  /* ---------- 3. การ์ดหน้ายิง ---------- */
  console.log('\n[3] การ์ดหน้ายิง');
  const r3 = await page.evaluate(() => window.__cards('scanCard'));
  check('ตรง: 3 SKU · 10 ชิ้น', r3.match.sku === '3' && r3.match.sub === '10 ชิ้น', r3.match);
  check('ขาด: 2 SKU · 5 ชิ้น', r3.short.sku === '2' && r3.short.sub === '5 ชิ้น', r3.short);
  check('เกิน: 2 SKU · 8 ชิ้น', r3.over.sku === '2' && r3.over.sub === '8 ชิ้น', r3.over);

  /* ---------- 4. สองหน้าตรงกันเสมอ ---------- */
  console.log('\n[4] หน้าสรุปกับหน้ายิงต้องตรงกัน');
  const r4 = await page.evaluate(() => {
    const before = { sum: window.__cards('card'), scan: window.__cards('scanCard') };
    /* ยิงเพิ่ม 2 ชิ้นเข้า M1 (ตรง → เกิน) แล้ววาดใหม่ทั้งสองหน้า */
    state.counts.M1 = 7;
    renderSummary();
    renderScanTotals();
    const after = { sum: window.__cards('card'), scan: window.__cards('scanCard') };
    return { before: before, after: after };
  });
  /* เทียบเฉพาะ SKU กับจำนวนชิ้น — การ์ดหน้ายิงไม่มีบรรทัดมูลค่า */
  const sameBefore = ['match', 'short', 'over'].every(function (k) {
    return r4.before.sum[k].sku === r4.before.scan[k].sku &&
           r4.before.sum[k].sub === r4.before.scan[k].sub;
  });
  check('ก่อนยิง: SKU + ชิ้น ตรงกันทั้งสองหน้า', sameBefore, r4.before);
  check('ยิงเพิ่มแล้ว ตรง 3→2 SKU · 10→5 ชิ้น',
        r4.after.sum.match.sku === '2' && r4.after.sum.match.sub === '5 ชิ้น', r4.after.sum.match);
  check('เกิน 2→3 SKU · 8→10 ชิ้น (บวก 2 ที่เพิ่งยิง)',
        r4.after.sum.over.sku === '3' && r4.after.sum.over.sub === '10 ชิ้น',
        r4.after.sum.over);
  check('หน้ายิงขยับตามเท่ากัน',
        r4.after.scan.match.sub === '5 ชิ้น' && r4.after.scan.over.sub === '10 ชิ้น',
        r4.after.scan);

  /* ---------- 5. ป้ายบอกหน่วยชัด ---------- */
  console.log('\n[5] ป้ายบอกว่าตัวใหญ่ = SKU ตัวเล็ก = ชิ้น');
  const r5 = await page.evaluate(() => {
    const labs = function (id) {
      return Array.prototype.map.call(
        document.querySelectorAll('#' + id + ' .s-lab'), function (e) { return e.textContent; });
    };
    const pcLines = document.querySelectorAll('#sumCards [id$="Pc"], #scanDiffCards [id$="Pc"]');
    return { sum: labs('sumCards'), scan: labs('scanDiffCards'),
             pcCount: pcLines.length,
             subsHaveUnit: Array.prototype.every.call(pcLines,
               function (e) { return /ชิ้น/.test(e.textContent); }) };
  });
  check('ป้ายหน้าสรุปบอก (SKU) ครบ 3 ใบ',
        JSON.stringify(r5.sum) === JSON.stringify(['✅ ตรง (SKU)', '❌ ขาด (SKU)', '➕ เกิน (SKU)']),
        r5.sum);
  check('ป้ายหน้ายิงบอก (SKU) ครบ 3 ใบ',
        JSON.stringify(r5.scan) === JSON.stringify(['✅ ตรง (SKU)', '❌ ขาด (SKU)', '➕ เกิน (SKU)']),
        r5.scan);
  check('บรรทัดจำนวนชิ้นมีครบ 6 การ์ด และมีคำว่า "ชิ้น" ทุกอัน',
        r5.pcCount === 6 && r5.subsHaveUnit === true, r5);

  /* ---------- 6. ไม่มีข้อมูลเลย ---------- */
  console.log('\n[6] รอบที่ยังไม่มีอะไรเลย');
  const r6 = await page.evaluate(() => {
    window.__seed('admin');
    state.products = {}; state.systemQty = {}; state.counts = {};
    renderSummary(); renderScanTotals();
    return { sum: window.__cards('card'), scan: window.__cards('scanCard') };
  });
  check('ทุกการ์ดเป็น 0 SKU · 0 ชิ้น ไม่ใช่ค่าว่างหรือ NaN',
        r6.sum.match.sku === '0' && r6.sum.match.sub === '0 ชิ้น' &&
        r6.sum.short.sub === '0 ชิ้น' && r6.sum.short.money === '฿0.00' &&
        r6.scan.over.sub === '0 ชิ้น', r6);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
