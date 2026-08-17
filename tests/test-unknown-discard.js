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
    window.__toasts = []; window.__writes = []; window.__asks = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'gen' + (++n); }; })();
    window.renderDoc = function () {};
    hideLogin();

    window.__seed = function (role, answer) {
      state.me = { uid: 'u1', name: 'สมชาย', role: role, branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branchCode: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice'; state.summaryTab = 'job';
      state.products = {
        K1: { code: 'K1', name: 'ของจริง', category: 'ห', type: 'product', costPrice: 10 }
      };
      state.systemQty = { K1: 5 };
      state.counts = { K1: 5, BAD1: 3, BAD2: 1 };
      state.scanQty = { K1: 5, BAD1: 3, BAD2: 1 };
      state.manualQty = {}; state.manualLog = []; state.zones = {}; state.transfers = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {};
      state.unknownKeys = {
        BAD1: { key: 'BAD1', value: '8850999999999', qty: 3, firstTs: 100, zone: 'A', user: 'สมชาย', note: '' },
        BAD2: { key: 'BAD2', value: '9999999999999', qty: 1, firstTs: 200, zone: 'A', user: 'สมชาย', note: '' }
      };
      state.scanLog = [];
      state.masterTab = 'newcodes';
      window.__toasts = []; window.__writes = []; window.__asks = [];
      window.ask = function (t, b, ok) {
        window.__asks.push({ t: t, b: b, ok: ok });
        return Promise.resolve(answer === undefined ? true : answer);
      };
      renderSummary();
    };

    window.__docUnknownCodes = function () {
      const t = buildUnknownDocTable();
      if (!t) return [];
      return Array.prototype.map.call(t.querySelectorAll('tbody tr'), function (tr) {
        return (tr.children[1] || {}).textContent;
      });
    };
  });

  /* ---------- 1. ปุ่มโผล่ตามสิทธิ์ ---------- */
  console.log('\n[1] ปุ่มลบทิ้งตามสิทธิ์');
  const r1 = await page.evaluate(() => {
    const out = {};
    ['admin', 'counter', 'scanner'].forEach(function (role) {
      window.__seed(role);
      out[role] = document.querySelectorAll('#unknownList [data-discard]').length;
    });
    window.__seed('admin');
    out.label = (document.querySelector('#unknownList [data-discard]') || {}).textContent;
    return out;
  });
  check('admin เห็นปุ่มครบ 2 รายการ', r1.admin === 2, r1.admin);
  check('counter เห็นปุ่มครบ 2 รายการ', r1.counter === 2, r1.counter);
  check('scanner ไม่เห็นปุ่มเลย', r1.scanner === 0, r1.scanner);
  check('ป้ายปุ่มถูกต้อง', r1.label === '🗑 ลบทิ้ง (ยิงหลุด/บาร์โค้ดขยะ)', r1.label);

  /* ---------- 2. กดลบ ---------- */
  console.log('\n[2] กดลบทิ้ง');
  const r2 = await page.evaluate(async () => {
    window.__seed('counter');
    const beforeDoc = window.__docUnknownCodes();
    const beforePending = unknownPending();
    const beforeK1 = state.counts.K1;

    await discardUnknown({ key: 'BAD1', value: '8850999999999', qty: 3 });

    const rec = window.__writes.length
      ? Object.keys(window.__writes[0].patch).map(k => window.__writes[0].patch[k])[0] : null;
    return {
      beforeDoc: beforeDoc, afterDoc: window.__docUnknownCodes(),
      beforePending: beforePending, afterPending: unknownPending(),
      writes: window.__writes.length,
      path: window.__writes[0] && window.__writes[0].path,
      isScan: window.__writes[0] && Object.keys(window.__writes[0].patch)[0].indexOf('scans/') === 0,
      delta: rec && rec.delta, mode: rec && rec.mode, reason: rec && rec.reason,
      discard: rec && rec.discard, unknown: rec && rec.unknown, raw: rec && rec.raw,
      user: rec && rec.user, hasTs: !!(rec && rec.ts),
      qtyAfter: state.unknownKeys.BAD1.qty,
      discardedFlag: state.unknownKeys.BAD1.discarded,
      beforeK1: beforeK1, afterK1: state.counts.K1,
      askTitle: (window.__asks[0] || {}).t,
      askBody: (window.__asks[0] || {}).b,
      toast: (window.__toasts[0] || {}).m
    };
  });
  check('ก่อนลบ เอกสารมี 2 บาร์โค้ด',
        r2.beforeDoc.length === 2 && r2.beforeDoc.indexOf('8850999999999') >= 0, r2.beforeDoc);
  check('หลังลบ หลุดจากเอกสาร เหลือ 1',
        r2.afterDoc.length === 1 && r2.afterDoc.indexOf('8850999999999') < 0, r2.afterDoc);
  check('หลุดจากรายการที่ต้องจัดการ (2 → 1)',
        r2.beforePending === 2 && r2.afterPending === 1, r2);
  check('เขียน 1 เรคอร์ดที่ rounds/R1/scans (ไม่ได้ลบของเดิม)',
        r2.writes === 1 && r2.path === 'rounds/R1' && r2.isScan === true, r2);
  check('delta = -3 (หักให้เหลือ 0)', r2.delta === -3 && r2.qtyAfter === 0, r2);
  check('mode = resolve · เหตุผล "ลบทิ้ง (ยิงหลุด)"',
        r2.mode === 'resolve' && r2.reason === 'ลบทิ้ง (ยิงหลุด)', r2);
  check('ติดธง discard + unknown + raw ครบ',
        r2.discard === true && r2.unknown === true && r2.raw === '8850999999999', r2);
  check('บันทึกว่าใครลบและเมื่อไหร่', r2.user === 'สมชาย' && r2.hasTs === true, r2);
  check('ธง discarded ขึ้นใน state', r2.discardedFlag === true, r2.discardedFlag);
  check('ยอดสินค้าจริง (K1) ไม่กระทบ', r2.beforeK1 === 5 && r2.afterK1 === 5, r2);
  check('กล่องยืนยันบอกว่าใช้กับของยิงหลุด',
        /ใช้กับของที่ยิงหลุดหรือบาร์โค้ดขยะเท่านั้น/.test(r2.askBody || '') &&
        /ลบ "8850999999999" ออกจากรายการที่ต้องจัดการ/.test(r2.askBody || ''), r2.askBody);
  check('กล่องยืนยันบอกว่าไม่ได้ลบยอดเดิม',
        /ไม่ได้ลบยอดเดิมทิ้ง ตรวจย้อนหลังได้เสมอ/.test(r2.askBody || ''), r2.askBody);
  check('toast ย้ำว่าบันทึกเป็นประวัติไว้', /ไม่ได้ลบยอดเดิม/.test(r2.toast || ''), r2.toast);

  /* ---------- 3. กดยกเลิก ---------- */
  console.log('\n[3] กดยกเลิกในกล่องยืนยัน');
  const r3 = await page.evaluate(async () => {
    window.__seed('counter', false);
    const ok = await discardUnknown({ key: 'BAD1', value: '8850999999999', qty: 3 });
    return { ok: ok, writes: window.__writes.length, qty: state.unknownKeys.BAD1.qty,
             pending: unknownPending() };
  });
  check('ยกเลิกแล้วคืน false + ไม่เขียนอะไร', r3.ok === false && r3.writes === 0, r3);
  check('ยอดไม่ถูกแตะ', r3.qty === 3 && r3.pending === 2, r3);

  /* ---------- 4. สิทธิ์กันในตัวฟังก์ชัน ---------- */
  console.log('\n[4] เรียกฟังก์ชันตรง ๆ');
  const r4 = await page.evaluate(async () => {
    window.__seed('scanner');
    const ok = await discardUnknown({ key: 'BAD1', value: '8850999999999', qty: 3 });
    return { ok: ok, writes: window.__writes.length, qty: state.unknownKeys.BAD1.qty,
             toast: (window.__toasts[0] || {}).m, asks: window.__asks.length };
  });
  check('scanner เรียกตรง ๆ ก็ไม่ผ่าน', r4.ok === false && r4.writes === 0, r4);
  check('ไม่แม้แต่จะเปิดกล่องยืนยัน', r4.asks === 0, r4.asks);
  check('ยอดไม่ถูกแตะ', r4.qty === 3, r4.qty);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(r4.toast || ''), r4.toast);

  /* ---------- 5. Job ปิดแล้ว ---------- */
  console.log('\n[5] Job ที่ไม่ได้อยู่ขั้นนับ');
  const r5 = await page.evaluate(async () => {
    window.__seed('admin');
    state.roundIndex.R1.status = 'closed';
    renderSummary();
    const btn = document.querySelector('#unknownList [data-discard]');
    const out = { disabled: btn.disabled, title: btn.title };
    const ok = await discardUnknown({ key: 'BAD1', value: '8850999999999', qty: 3 });
    out.ok = ok; out.writes = window.__writes.length;
    out.toast = (window.__toasts[0] || {}).m;
    state.roundIndex.R1.status = 'counting';
    return out;
  });
  check('ปุ่มถูกล็อกพร้อมบอกเหตุผล',
        r5.disabled === true && /ปิดแล้ว/.test(r5.title || ''), r5);
  check('เรียกตรง ๆ ก็ไม่เขียน', r5.ok === false && r5.writes === 0, r5);
  check('บอกว่ารอบปิดแล้ว', /ปิดแล้ว/.test(r5.toast || ''), r5.toast);

  /* ---------- 6. ตัวที่ผูก/สร้างสินค้าแล้วยังอยู่ในเอกสาร ---------- */
  console.log('\n[6] ตัวที่จัดการด้วยวิธีอื่นต้องยังอยู่ในเอกสาร');
  const r6 = await page.evaluate(() => {
    window.__seed('admin');
    /* จำลองว่า BAD2 ถูกสร้างเป็นสินค้าใหม่ (products มีคีย์นี้ = resolved แต่ไม่ discarded) */
    state.products.BAD2 = { code: '9999999999999', name: 'ของใหม่', type: 'product' };
    return { doc: window.__docUnknownCodes(), pending: unknownPending() };
  });
  check('ตัวที่สร้างเป็นสินค้าแล้วยังอยู่ในเอกสาร (เป็นหลักฐาน)',
        r6.doc.indexOf('9999999999999') >= 0, r6.doc);
  check('แต่หลุดจากรายการที่ต้องจัดการแล้ว', r6.pending === 1, r6.pending);

  /* ---------- 7. ปุ่มที่ 3 ในแท็บบาร์โค้ดใหม่ ---------- */
  console.log('\n[7] ปุ่มที่ 3 ในแท็บ "บาร์โค้ดใหม่" (Master)');
  const r7 = await page.evaluate(() => {
    window.__seed('admin');
    renderNewCodes();
    const card = document.querySelector('#ncList [data-newcode]');
    const acts = Array.prototype.map.call(card.querySelectorAll('[data-action]'),
                                          function (b) { return b.getAttribute('data-action'); });
    return { acts: acts,
             label: (card.querySelector('[data-action="discard"]') || {}).textContent };
  });
  check('เรียงเป็นปุ่มที่ 3 ต่อจาก link / new',
        JSON.stringify(r7.acts) === JSON.stringify(['link', 'new', 'discard']), r7.acts);
  check('ป้ายปุ่มเหมือนกัน', r7.label === '🗑 ลบทิ้ง (ยิงหลุด/บาร์โค้ดขยะ)', r7.label);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
