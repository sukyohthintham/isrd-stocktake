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
    /* ปูสภาพแวดล้อมให้ renderDoc วิ่งได้แบบ Job เดียว ไม่ต้องแตะ Firebase */
    window.__setup = function (spec) {
      state.roundId = 'R1';
      state.roundIndex = { R1: { id: 'R1', name: 'ทดสอบ', branch: 'B1', jobCode: 'J1', cycleId: 'C1', status: 'open' } };
      state.docScope = 'job'; state.docScopeTouched = true;
      state.itemTab = 'items'; state.priceField = 'costPrice';
      state.printImages = false; state.compactImages = false;
      state.products = {}; state.systemQty = {}; state.counts = {};
      state.scanQty = {}; state.manualQty = {}; state.unknownKeys = {}; state.unknown = {};
      state.transfers = state.transfers || {};
      spec.forEach(function (s) {
        if (s.unknownBarcode) {
          state.unknownKeys[s.key] = { value: s.key, qty: s.act, note: '', firstTs: 1, zone: 'Z', user: 'u' };
          state.counts[s.key] = s.act;
          return;
        }
        state.products[s.key] = {
          code: s.key, name: 'ชื่อ ' + s.key, category: 'หมวด',
          type: s.type, costPrice: 10, typeSource: 'manual', needsReview: false
        };
        if (s.sys !== undefined) state.systemQty[s.key] = s.sys;
        if (s.act !== undefined) state.counts[s.key] = s.act;
      });
      renderDoc();
    };

    /* อ่านลำดับกล่องในเอกสารตามที่ปรากฏจริง + จำนวนแถวของแต่ละตาราง */
    window.__layout = function () {
      const host = document.getElementById('docItemTables');
      const out = [];
      Array.prototype.forEach.call(host.children, function (el) {
        if (el.classList.contains('doc-group-title')) {
          out.push({ kind: 'group', text: el.textContent });
          return;
        }
        const title = el.querySelector('.tbl-title');
        const table = el.querySelector('table.items');
        if (!title) return;
        out.push({
          kind: el.hasAttribute('data-unknown-table') ? 'unknown' : 'table',
          text: title.textContent,
          rows: table ? table.querySelectorAll('tbody tr[data-code]').length
                      : (table ? 0 : el.querySelectorAll('tbody tr').length),
          codes: table ? Array.prototype.map.call(table.querySelectorAll('tbody tr[data-code]'),
                                                  function (tr) { return tr.getAttribute('data-code'); })
                       : []
        });
      });
      return out;
    };
  });

  /* ---------- 1. คอลัมน์ลำดับ ---------- */
  console.log('\n[1] คอลัมน์ลำดับ (#) กว้างขึ้นและไม่ตัดบรรทัด');
  const r1 = await page.evaluate(() => {
    window.__setup([{ key: 'P1', type: 'product', sys: 10, act: 8 }]);
    const table = document.querySelector('#docItemTables table.items');
    const cols = Array.prototype.map.call(table.querySelectorAll('colgroup col'),
                                          c => parseFloat(c.style.width));
    const td = table.querySelector('tbody tr td:first-child');
    const th = table.querySelector('thead th:first-child');
    return {
      cols: cols,
      total: Math.round(cols.reduce((a, b) => a + b, 0) * 100) / 100,
      tdWrap: getComputedStyle(td).whiteSpace,
      thWrap: getComputedStyle(th).whiteSpace,
      nameCol: cols[3]
    };
  });
  check('คอลัมน์ # = 4%', r1.cols[0] === 4, r1.cols[0]);
  check('คอลัมน์ชื่อสินค้า = 13.5%', r1.nameCol === 13.5, r1.nameCol);
  check('ความกว้างรวม = 100%', r1.total === 100, r1.total);
  check('td แรก nowrap', r1.tdWrap === 'nowrap', r1.tdWrap);
  check('th แรก nowrap', r1.thWrap === 'nowrap', r1.thWrap);

  /* ---------- 2. ลำดับกลุ่มใหญ่และตารางย่อย ---------- */
  console.log('\n[2] ลำดับกลุ่มใหญ่ Product / Not Product และตารางย่อย');
  const r2 = await page.evaluate(() => {
    window.__setup([
      { key: 'P1', type: 'product', sys: 10, act: 8 },      // Product ขาด
      { key: 'P2', type: 'product', sys: 5, act: 7 },       // Product เกิน
      { key: 'P3', type: 'product', sys: 3, act: 3 },       // Product ตรง
      { key: 'N1', type: 'notProduct', sys: 4, act: 1 },    // Not Product ขาด
      { key: 'N2', type: 'notProduct', sys: 2, act: 2 },    // Not Product ตรง (ไม่มี "เกิน")
      { key: 'F1', type: 'product', act: 5 },               // ไม่ใช่ของสาขานี้
      { key: 'U1', unknownBarcode: true, act: 2 }           // ไม่มีในระบบ
    ]);
    return window.__layout();
  });
  const seq2 = r2.map(x => x.kind + ':' + x.text.split(' — ')[0]);
  check('ลำดับถูกต้องทั้งเอกสาร',
    JSON.stringify(seq2) === JSON.stringify([
      'group:📦 Product',
      'table:รายการสินค้า (ขาด)',
      'table:รายการสินค้า (เกิน)',
      'table:รายการสินค้า (ตรง)',
      'group:🏷 Not Product',
      'table:รายการสินค้า (ขาด)',
      'table:รายการสินค้า (ตรง)',
      'table:รายการที่พบแต่ไม่ใช่ของสาขานี้',
      'unknown:รายการที่พบแต่ไม่มีในระบบ'
    ]), seq2);
  check('Not Product ไม่มีของเกิน → ไม่มีตาราง (เกิน) ในกลุ่มนั้น',
    seq2.filter(s => s === 'table:รายการสินค้า (เกิน)').length === 1, seq2);
  check('หัวข้อกลุ่ม Product นับ 3 รายการ', /📦 Product — 3 รายการ/.test(r2[0].text), r2[0].text);
  check('หัวข้อกลุ่ม Not Product นับ 2 รายการ', /🏷 Not Product — 2 รายการ/.test(r2[4].text), r2[4].text);
  check('Product(ขาด) = [P1]', JSON.stringify(r2[1].codes) === '["P1"]', r2[1].codes);
  check('Product(เกิน) = [P2]', JSON.stringify(r2[2].codes) === '["P2"]', r2[2].codes);
  check('Product(ตรง) = [P3]', JSON.stringify(r2[3].codes) === '["P3"]', r2[3].codes);
  check('NotProduct(ขาด) = [N1]', JSON.stringify(r2[5].codes) === '["N1"]', r2[5].codes);
  check('NotProduct(ตรง) = [N2]', JSON.stringify(r2[6].codes) === '["N2"]', r2[6].codes);
  check('ตาราง foreign = [F1]', JSON.stringify(r2[7].codes) === '["F1"]', r2[7].codes);

  /* ---------- 3. กันซ้ำ / กันหาย ---------- */
  console.log('\n[3] กันซ้ำ / กันของหาย (เทียบก่อน-หลัง)');
  const r3 = await page.evaluate(() => {
    const data = summaryData();
    const layout = window.__layout();
    /* หลัง: ทุกรหัสที่ปรากฏในตารางสินค้า (กลุ่มใหญ่ + foreign) */
    const shown = [];
    layout.forEach(function (b) { if (b.codes) shown.push.apply(shown, b.codes); });
    /* ก่อน: short/over/match ไม่กรอง inRound = data.rows ทั้งหมด + foreign ซ้ำอีกรอบ */
    const beforeAll = data.rows.map(function (r) { return r.code; });
    const beforeForeign = foreignRows(data).map(function (r) { return r.code; });
    const dup = {};
    const dupes = shown.filter(function (c) { return dup[c] ? true : (dup[c] = 1, false); });
    const unknownKeys = Object.keys(state.unknownKeys);
    /* แถวที่เดิมโผล่สองที่: foreign (ตารางสินค้า + ตาราง foreign)
       และ unknown (ตารางสินค้า + ตาราง "ไม่มีในระบบ") */
    const beforeUnknownDup = data.rows.filter(function (r) {
      return unknownKeys.indexOf(r.key) >= 0;
    }).length;
    const lost = data.rows.filter(function (r) {
      return shown.indexOf(r.code) < 0 &&
             beforeForeign.indexOf(r.code) < 0 &&
             unknownKeys.indexOf(r.key) < 0;
    }).map(function (r) { return r.code; });
    return {
      beforeItemRows: beforeAll.length,            // จำนวนแถวในสามตารางเดิม
      beforeForeignRows: beforeForeign.length,     // ที่ซ้ำอีกรอบในตาราง foreign
      beforeUnknownDup: beforeUnknownDup,          // ที่ซ้ำอีกรอบในตาราง unknown
      beforeTotal: beforeAll.length + beforeForeign.length,
      afterTotal: shown.length,
      dupes: dupes,
      lost: lost,
      unknownShown: unknownKeys.length
    };
  });
  console.log('       ก่อน: ตารางสินค้า ' + r3.beforeItemRows + ' แถว (ในนั้นซ้ำกับตารางท้ายเอกสาร ' +
              (r3.beforeForeignRows + r3.beforeUnknownDup) + ' แถว) | ' +
              'หลัง: ตารางสินค้า ' + r3.afterTotal + ' แถว + ตารางท้ายเอกสารเท่าเดิม');
  check('ไม่มีรหัสซ้ำสองตารางอีกแล้ว', r3.dupes.length === 0, r3.dupes);
  check('ก่อนมีของซ้ำจริง 2 รหัส (F1 foreign + U1 unknown)',
        r3.beforeForeignRows === 1 && r3.beforeUnknownDup === 1,
        { foreign: r3.beforeForeignRows, unknown: r3.beforeUnknownDup });
  /* หลัง = แถวในกลุ่มใหญ่ + แถวในตาราง foreign (นับจาก DOM จริง)
     ต่างจากก่อนแค่ตัว unknown ที่เลิกโผล่ซ้ำในตารางสินค้า */
  check('หลังแก้ = ก่อนแก้ ลบเฉพาะตัวที่เคยซ้ำ',
        r3.afterTotal === r3.beforeItemRows - r3.beforeUnknownDup,
        { after: r3.afterTotal, expect: r3.beforeItemRows - r3.beforeUnknownDup });
  check('ไม่มีรหัสไหนหายจากเอกสาร', r3.lost.length === 0, r3.lost);

  /* ---------- 4. แถวผี 0/0 ต้องหายทั้งจากตารางและจากยอดรวม (v2.8.0) ----------
     ระบบ 0 + นับ 0 = ไม่มีของจริงและไม่ได้นับ ไม่ใช่แถวที่ต้องรายงาน
     ก่อน v2.8.0 กฎเขียนไว้คนละแบบระหว่างเอกสารกับยอดรวม แถวแบบนี้จึงหายจากตาราง
     แต่ยังถูกนับเป็น "SKU ที่ตรง" ในยอดรวม ทำให้ %Success เฟ้อ — ต้องไม่เกิดขึ้นอีก */
  console.log('\n[4] แถวผี 0/0 — ต้องไม่โผล่ทั้งในตารางและในยอดรวม');
  const r4 = await page.evaluate(() => {
    window.__setup([
      { key: 'P1', type: 'product', sys: 10, act: 8 },
      { key: 'F0', type: 'product', act: 0 }      // known · ไม่ inRound · act 0 = แถวผี
    ]);
    const data = summaryData();
    const shown = [];
    window.__layout().forEach(function (b) { if (b.codes) shown.push.apply(shown, b.codes); });
    const g = data.groups.product;
    return {
      hasRow: data.rows.some(function (r) { return r.code === 'F0'; }),
      inForeign: foreignRows(data).some(function (r) { return r.code === 'F0'; }),
      inUnknown: !!state.unknownKeys.F0,
      shown: shown,
      skuTotal: g.skuTotal, skuMatch: g.skuMatch, pctSku: pctSkuOf(g)
    };
  });
  check('summaryData ตัดแถวผีตั้งแต่ต้นทาง (ไม่มี F0 ใน rows)', r4.hasRow === false, r4.hasRow);
  check('F0 ไม่เข้าตาราง foreign (act = 0)', r4.inForeign === false, r4.inForeign);
  check('F0 ไม่เข้าตาราง unknown', r4.inUnknown === false, r4.inUnknown);
  check('F0 ไม่โผล่ในเอกสาร', r4.shown.indexOf('F0') < 0, r4.shown);
  /* หัวใจของ v2.8.0 — ยอดรวมต้องเห็นแค่ P1 ใบเดียว ไม่นับ F0 เป็น SKU ที่ตรง
     ถ้า skuTotal กลายเป็น 2 หรือ pctSku กลายเป็น 50 แปลว่ากฎกลับไปแยกกันอีกแล้ว */
  check('ยอดรวมไม่นับแถวผี (skuTotal 1 · skuMatch 0 · %Success 0)',
        r4.skuTotal === 1 && r4.skuMatch === 0 && r4.pctSku === 0,
        { skuTotal: r4.skuTotal, skuMatch: r4.skuMatch, pctSku: r4.pctSku });

  /* ---------- 4b. กันยอดหาย: ตัดได้เฉพาะ 0/0 สุทธิเท่านั้น ----------
     กฎแถวผีตัดเฉพาะตอน "ระบบ 0 และนับ 0" พร้อมกัน ของสาขาอื่นที่ยังมียอดนับค้างอยู่
     ต้องโผล่ครบทุกที่เหมือนเดิม ไม่งั้นกฎนี้จะกลายเป็นตัวทำยอดหายเสียเอง */
  console.log('\n[4b] กันยอดหาย — ของสาขาอื่นที่ยังมียอดนับจริงต้องไม่ถูกตัด');
  const r4b = await page.evaluate(() => {
    window.__setup([
      { key: 'P1', type: 'product', sys: 10, act: 8 },
      { key: 'F5', type: 'product', act: 5 }      // known · ไม่ inRound · act 5 = ของจริง
    ]);
    const data = summaryData();
    const shown = [];
    window.__layout().forEach(function (b) { if (b.codes) shown.push.apply(shown, b.codes); });
    const g = data.groups.product;
    return {
      hasRow: data.rows.some(function (r) { return r.code === 'F5'; }),
      inForeign: foreignRows(data).some(function (r) { return r.code === 'F5'; }),
      shown: shown,
      skuTotal: g.skuTotal, actQty: g.actQty
    };
  });
  check('F5 ยังอยู่ใน summaryData', r4b.hasRow === true, r4b.hasRow);
  check('F5 เข้าตาราง foreign ตามเดิม', r4b.inForeign === true, r4b.inForeign);
  check('F5 ยังปรากฏในเอกสาร', r4b.shown.indexOf('F5') >= 0, r4b.shown);
  check('ยอดรวมยังนับ F5 ครบ (skuTotal 2 · ยอดจริงรวม 13 ชิ้น)',
        r4b.skuTotal === 2 && r4b.actQty === 13,
        { skuTotal: r4b.skuTotal, actQty: r4b.actQty });

  /* ---------- 5. กลุ่มใหญ่ที่ไม่มีของ = ไม่มีหัวข้อ ---------- */
  console.log('\n[5] กลุ่มใหญ่ที่ไม่มีของ');
  const r5 = await page.evaluate(() => {
    window.__setup([{ key: 'P1', type: 'product', sys: 10, act: 8 }]);
    return window.__layout().map(x => x.kind + ':' + x.text.split(' — ')[0]);
  });
  check('มีแต่ Product → ไม่มีหัวข้อ Not Product',
    JSON.stringify(r5) === JSON.stringify(['group:📦 Product', 'table:รายการสินค้า (ขาด)']), r5);

  const r5b = await page.evaluate(() => {
    window.__setup([{ key: 'N1', type: 'notProduct', sys: 4, act: 4 }]);
    return window.__layout().map(x => x.kind + ':' + x.text.split(' — ')[0]);
  });
  check('มีแต่ Not Product → ไม่มีหัวข้อ Product',
    JSON.stringify(r5b) === JSON.stringify(['group:🏷 Not Product', 'table:รายการสินค้า (ตรง)']), r5b);

  const r5c = await page.evaluate(() => {
    window.__setup([]);
    return window.__layout();
  });
  check('ไม่มีรายการเลย → ไม่มีหัวข้อกลุ่มใด ๆ', r5c.length === 0, r5c);

  /* ---------- 6. หัวข้อกลุ่มใหญ่เด่นกว่าหัวตารางย่อย ---------- */
  console.log('\n[6] หัวข้อกลุ่มใหญ่เด่นกว่าหัวตารางย่อย');
  const r6 = await page.evaluate(() => {
    window.__setup([{ key: 'P1', type: 'product', sys: 10, act: 8 }]);
    const g = document.querySelector('#docItemTables .doc-group-title');
    const t = document.querySelector('#docItemTables .tbl-title');
    const gs = getComputedStyle(g), ts = getComputedStyle(t);
    return {
      groupSize: parseFloat(gs.fontSize), titleSize: parseFloat(ts.fontSize),
      border: gs.borderBottomWidth, weight: gs.fontWeight
    };
  });
  check('ตัวอักษรหัวกลุ่มใหญ่กว่าหัวตารางย่อย', r6.groupSize > r6.titleSize,
        { group: r6.groupSize, title: r6.titleSize });
  check('หัวกลุ่มมีเส้นคาดใต้หัวข้อ', parseFloat(r6.border) > 0, r6.border);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
