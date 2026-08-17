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
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.__writes = [];
    window.enqueueWrite = function (path, patch) { window.__writes.push({ path: path, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    hideLogin();

    /* รอบทดสอบ: 3 ตรง / 2 ขาด / 2 เกิน (หนึ่งในนั้นเป็นของสาขาอื่น) */
    window.__setup = function (role) {
      state.me = { uid: 'u1', email: 'x@y.z', name: 'สมชาย', role: role };
      state.counter = 'สมชาย';
      state.roundId = 'R1';
      state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branch: 'B1', jobCode: 'J1',
                                 cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.priceField = 'costPrice';
      state.summaryTab = 'job';
      state.products = {};
      state.systemQty = {}; state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.unknownKeys = {}; state.unknown = {}; state.manualLog = []; state.scanLog = [];
      state.zones = {}; state.transfers = {};
      const add = function (code, type, sys, act, price) {
        state.products[code] = { code: code, name: 'ชื่อ ' + code, category: 'หมวด',
                                 type: type, costPrice: price, sellPrice: price };
        if (sys !== null) state.systemQty[code] = sys;
        if (act) { state.counts[code] = act; state.scanQty[code] = act; }
      };
      add('M1', 'product', 5, 5, 100);          // ตรง
      add('M2', 'product', 3, 3, 100);          // ตรง
      add('M3', 'notProduct', 2, 2, 10);        // ตรง
      add('S1', 'product', 10, 6, 50);          // ขาด -4  → -200
      add('S2', 'product', 8, 7, 25);           // ขาด -1  → -25
      add('O1', 'product', 4, 9, 20);           // เกิน +5 → +100
      add('F1', 'product', null, 3, 30);        // ของสาขาอื่น เกิน +3 → +90
      /* scanLog ให้ scannerStats มีข้อมูลของ "สมชาย" */
      state.scanLog = [
        { id: 's1', rec: { code: 'S1', delta: 6, user: 'สมชาย', ts: 100, zone: 'A', zoneName: 'A' } },
        { id: 's2', rec: { code: 'O1', delta: 9, user: 'สมชาย', ts: 200, zone: 'A', zoneName: 'A' } },
        { id: 's3', rec: { code: 'M1', delta: 5, user: 'สมศรี', ts: 300, zone: 'B', zoneName: 'B' } }
      ];
      window.__toasts = []; window.__writes = [];
      renderSummary();
    };
  });

  const vis = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && getComputedStyle(el).display !== 'none';
  }, id);

  const ADMIN_ONLY = ['sumCards', 'sumTableWrap', 'costNote', 'foreignCard', 'unknownCard',
                      'statusCard', 'manualCard', 'btnExport', 'priceFilters'];
  const SCAN_ADMIN_ONLY = ['scanDiffCards', 'btnScanExport'];

  /* ---------- FOUC: ต้องซ่อนตั้งแต่ HTML ก่อน render ตัวไหนจะทำงาน ---------- */
  console.log('\n[0] ก่อน renderSummary ทำงานเลย (กันเห็นแวบ)');
  const fresh = await browser.newPage();
  await fresh.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  const raw = await fresh.evaluate((ids) => {
    /* eslint-disable */
    /* อ่านจาก inline style ตรง ๆ ไม่พึ่ง computed — หน้ายังถูก .page ซ่อนอยู่ตอนนี้
       ค่านี้คือสิ่งที่ browser เห็นตั้งแต่ parse HTML เสร็จ ก่อน JS ตัวไหนแตะ */
    const out = {};
    ids.forEach(function (id) {
      const el = document.getElementById(id);
      out[id] = el ? el.style.display : 'MISSING';
    });
    return out;
  }, ADMIN_ONLY.concat(SCAN_ADMIN_ONLY));
  ADMIN_ONLY.concat(SCAN_ADMIN_ONLY).forEach(id => {
    check('#' + id + ' ซ่อนไว้ใน HTML ตั้งแต่แรก', raw[id] === 'none', raw[id]);
  });
  await fresh.close();

  /* ================= ADMIN ================= */
  console.log('\n[A] role = admin');
  const a1 = await page.evaluate(() => {
    window.__setup('admin');
    return {
      match: $('cardMatchNum').textContent,
      matchVal: $('cardMatchVal').textContent.trim(),
      short: $('cardShortNum').textContent,
      shortVal: $('cardShortVal').textContent,
      over: $('cardOverNum').textContent,
      overVal: $('cardOverVal').textContent,
      exportDisabled: $('btnExport').disabled
    };
  });
  check('การ์ดตรง = 3 SKU', a1.match === '3', a1.match);
  check('การ์ดตรงไม่มีบรรทัดมูลค่า', a1.matchVal === '', JSON.stringify(a1.matchVal));
  check('การ์ดขาด = 2 SKU', a1.short === '2', a1.short);
  check('การ์ดขาดโชว์ -฿225.00', a1.shortVal === '-฿225.00', a1.shortVal);
  check('การ์ดเกิน = 2 SKU', a1.over === '2', a1.over);
  check('การ์ดเกินโชว์ +฿190.00', a1.overVal === '+฿190.00', a1.overVal);
  check('ปุ่ม Excel กดได้', a1.exportDisabled === false, a1.exportDisabled);

  for (const id of ['sumCards', 'sumTableWrap', 'foreignCard', 'unknownCard',
                    'statusCard', 'manualCard', 'btnExport', 'sumHead', 'priceFilters']) {
    check('admin เห็น #' + id, await vis(id) === true, id);
  }
  check('admin ไม่เห็นบรรทัด progress ส่วนตัว', await vis('myProgress') === false, 'myProgress');

  /* popup */
  console.log('\n[A2] popup ของ admin');
  const a2 = await page.evaluate(async () => {
    openSumCard('short');
    const list = document.querySelector('[data-sumcard-list="short"]');
    const rows = Array.prototype.map.call(list.querySelectorAll('.srow'), function (row) {
      const cell = n => row.querySelector('[data-cell="' + n + '"]').textContent;
      return { sku: row.getAttribute('data-sku'), sys: cell('sys'), act: cell('act'),
               diff: cell('diff'), value: cell('value'),
               hasRemove: !!row.querySelector('[data-removeover]') };
    });
    const out = { title: $('modalTitle').textContent, msg: $('modalMsg').textContent,
                  shown: $('modalBg').classList.contains('show'), rows: rows };
    $('modalOk').click();
    return out;
  });
  check('popup เปิดจริง', a2.shown === true, a2.shown);
  check('หัวข้อ popup ขาด', a2.title === '❌ สินค้าที่ขาด', a2.title);
  check('บอกจำนวน + มูลค่ารวม', /2 รายการ · มูลค่าผลต่างรวม -฿225\.00/.test(a2.msg), a2.msg);
  check('เรียงขาดหนักสุดขึ้นก่อน (S1 แล้ว S2)',
        a2.rows.map(r => r.sku).join(',') === 'S1,S2', a2.rows.map(r => r.sku));
  check('แถว S1 โชว์ครบ ระบบ/ยิงจริง/ผลต่าง/มูลค่า',
        a2.rows[0].sys === '10' && a2.rows[0].act === '6' &&
        a2.rows[0].diff === '-4' && a2.rows[0].value === '-฿200.00', a2.rows[0]);
  check('กลุ่มขาดก็มีปุ่มเอาออกด้วย (ยิงไปแล้ว act > 0)',
        a2.rows.every(r => r.hasRemove), a2.rows);

  const a3 = await page.evaluate(async () => {
    openSumCard('over');
    const list = document.querySelector('[data-sumcard-list="over"]');
    const rows = Array.prototype.map.call(list.querySelectorAll('.srow'), function (row) {
      const btn = row.querySelector('[data-removeover]');
      return { sku: row.getAttribute('data-sku'),
               diff: row.querySelector('[data-cell="diff"]').textContent,
               value: row.querySelector('[data-cell="value"]').textContent,
               btn: btn ? btn.textContent : null, btnDisabled: btn ? btn.disabled : null };
    });
    const msg = $('modalMsg').textContent;
    $('modalOk').click();
    return { rows: rows, msg: msg };
  });
  check('กลุ่มเกินเรียงเยอะสุดก่อน (O1 แล้ว F1)',
        a3.rows.map(r => r.sku).join(',') === 'O1,F1', a3.rows.map(r => r.sku));
  check('ทุกแถวในกลุ่มเกินมีปุ่มเอาออก (admin)',
        a3.rows.every(r => r.btn === '➖ เอาออก 1 ชิ้น' && r.btnDisabled === false), a3.rows);
  check('ของสาขาอื่นที่ยิงเกินก็อยู่ในกลุ่มนี้ด้วย',
        a3.rows[1].sku === 'F1' && a3.rows[1].diff === '+3' && a3.rows[1].value === '+฿90.00', a3.rows[1]);
  check('popup เกินบอกวิธีใช้ปุ่ม', /เอาออก 1 ชิ้น/.test(a3.msg) && /ไม่ได้ลบยอดเดิม/.test(a3.msg), a3.msg);

  /* ---------- ปุ่มเอาออก ---------- */
  console.log('\n[A3] กดปุ่มเอาออก');
  const a4 = await page.evaluate(() => {
    window.__writes = []; window.__toasts = [];
    const before = state.counts.O1;
    openSumCard('over');
    document.querySelector('[data-removeover="O1"]').click();
    const rec = window.__writes.length ? Object.keys(window.__writes[0].patch)
      .map(k => window.__writes[0].patch[k])[0] : null;
    const out = {
      before: before, after: state.counts.O1,
      writes: window.__writes.length,
      path: window.__writes[0] && window.__writes[0].path,
      isScansKey: window.__writes[0] && Object.keys(window.__writes[0].patch)[0].indexOf('scans/') === 0,
      delta: rec && rec.delta, reason: rec && rec.reason, mode: rec && rec.mode, user: rec && rec.user,
      hasTs: !!(rec && rec.ts),
      cardOver: $('cardOverNum').textContent,
      cardOverVal: $('cardOverVal').textContent,
      popupStillOpen: $('modalBg').classList.contains('show'),
      popupDiff: (document.querySelector('[data-sumcard-list="over"] [data-sku="O1"] [data-cell="diff"]') || {}).textContent,
      toast: (window.__toasts[0] || {}).m
    };
    $('modalOk').click();
    return out;
  });
  check('ยอดในเครื่องลดลง 1 (9 → 8)', a4.before === 9 && a4.after === 8, a4);
  check('เขียน 1 เรคอร์ดลง rounds/R1/scans (ไม่ได้ลบของเดิม)',
        a4.writes === 1 && a4.path === 'rounds/R1' && a4.isScansKey === true, a4);
  check('delta = -1 · mode = scan · มีเหตุผลกำกับ',
        a4.delta === -1 && a4.mode === 'scan' && a4.reason === 'เอาออกจากสรุป (ยิงเกิน)', a4);
  check('บันทึกว่าใครทำและเมื่อไหร่', a4.user === 'สมชาย' && a4.hasTs === true, a4);
  check('การ์ดเกินอัปเดตทันที (+฿190 → +฿170)', a4.cardOverVal === '+฿170.00', a4.cardOverVal);
  check('popup เปิดใหม่ให้เห็นค่าที่เปลี่ยน (+5 → +4)',
        a4.popupStillOpen === true && a4.popupDiff === '+4', a4);
  check('toast บอกว่าไม่ได้ลบยอดเดิม', /ไม่ได้ลบยอดเดิม/.test(a4.toast || ''), a4.toast);

  /* ---------- Job ปิดแล้วต้องเอาออกไม่ได้ ---------- */
  const a5 = await page.evaluate(() => {
    state.roundIndex.R1.status = 'closed';
    renderSummary();
    openSumCard('over');
    const btn = document.querySelector('[data-removeover="O1"]');
    const out = { disabled: btn.disabled, title: btn.title };
    $('modalOk').click();
    state.roundIndex.R1.status = 'counting';
    return out;
  });
  check('Job ปิดแล้ว ปุ่มเอาออกถูกล็อก', a5.disabled === true, a5);
  check('ปุ่มที่ล็อกบอกเหตุผล', /ปิดแล้ว/.test(a5.title || ''), a5.title);

  /* ---------- เอาออกจากกลุ่ม "ตรง" → ต้องเด้งไปกลุ่ม "ขาด" ---------- */
  console.log('\n[A4] เอาออกจากกลุ่ม "ตรง" แล้ว SKU ต้องย้ายกลุ่ม');
  const a6 = await page.evaluate(() => {
    window.__setup('admin');
    window.__writes = [];
    const before = { count: state.counts.M1, card: $('cardMatchNum').textContent };
    openSumCard('match');
    const hadBtn = !!document.querySelector('[data-sumcard-list="match"] [data-removeover="M1"]');
    document.querySelector('[data-removeover="M1"]').click();
    const rec = Object.keys(window.__writes[0].patch).map(k => window.__writes[0].patch[k])[0];
    const out = {
      hadBtn: hadBtn,
      before: before.count, after: state.counts.M1,
      delta: rec.delta, reason: rec.reason, user: rec.user, hasTs: !!rec.ts,
      writes: window.__writes.length,
      /* ป๊อปอัปต้องเปิดกลุ่ม "ตรง" กลับ (ไม่ใช่เด้งไปกลุ่มเกิน) และ M1 ต้องหายจากลิสต์ */
      reopenedList: !!document.querySelector('[data-sumcard-list="match"]'),
      stillInMatch: !!document.querySelector('[data-sumcard-list="match"] [data-sku="M1"]'),
      cardMatch: $('cardMatchNum').textContent,
      cardShort: $('cardShortNum').textContent
    };
    $('modalOk').click();
    /* ไปดูว่าตอนนี้อยู่กลุ่มขาดจริง */
    openSumCard('short');
    out.nowInShort = !!document.querySelector('[data-sumcard-list="short"] [data-sku="M1"]');
    out.shortDiff = (document.querySelector('[data-sumcard-list="short"] [data-sku="M1"] [data-cell="diff"]') || {}).textContent;
    $('modalOk').click();
    return out;
  });
  check('กลุ่ม "ตรง" มีปุ่มเอาออก', a6.hadBtn === true, a6.hadBtn);
  check('ยอดลดลง 1 (5 → 4)', a6.before === 5 && a6.after === 4, a6);
  check('มี log 1 แถว delta -1 พร้อมคนทำและเวลา',
        a6.writes === 1 && a6.delta === -1 && a6.user === 'สมชาย' && a6.hasTs === true &&
        a6.reason === 'เอาออกจากสรุป (ยิงเกิน)', a6);
  check('ป๊อปอัปเปิดกลุ่มเดิมกลับ (ตรง) ไม่ใช่เด้งไปกลุ่มเกิน', a6.reopenedList === true, a6);
  check('M1 หายจากกลุ่ม "ตรง"', a6.stillInMatch === false, a6);
  check('การ์ดขยับ ตรง 3→2 · ขาด 2→3',
        a6.cardMatch === '2' && a6.cardShort === '3', a6);
  check('M1 ไปโผล่ในกลุ่ม "ขาด" ที่ -1', a6.nowInShort === true && a6.shortDiff === '-1', a6);
  /* ================= COUNTER — เห็นผลต่างครบเหมือน admin ================= */
  console.log('\n[B] role = counter (ผู้นับสต๊อก) — ต้องเห็นตัวเลขผลต่างครบ');
  await page.evaluate(() => { window.__setup('counter'); });
  for (const id of ADMIN_ONLY.concat(['sumHead'])) {
    check('counter เห็น #' + id, await vis(id) === true, id);
  }
  check('counter ไม่เห็นบรรทัด progress ส่วนตัว (เห็นตัวเลขจริงแทน)',
        await vis('myProgress') === false, 'myProgress');

  const b1 = await page.evaluate(() => ({
    exportDisabled: $('btnExport').disabled,
    match: $('cardMatchNum').textContent,
    short: $('cardShortNum').textContent,
    over: $('cardOverNum').textContent,
    shortVal: $('cardShortVal').textContent
  }));
  check('counter กดปุ่ม Excel ได้', b1.exportDisabled === false, b1.exportDisabled);
  check('counter เห็นตัวเลขการ์ดครบ (3 / 2 / 2)',
        b1.match === '3' && b1.short === '2' && b1.over === '2', b1);
  check('counter เห็นมูลค่าผลต่างด้วย', b1.shortVal === '-฿225.00', b1.shortVal);

  const b2 = await page.evaluate(() => {
    window.__toasts = [];
    openSumCard('short');
    const out = { shown: $('modalBg').classList.contains('show'),
                  rows: document.querySelectorAll('[data-sumcard-list="short"] .srow').length,
                  hasBtn: !!document.querySelector('[data-sumcard-list="short"] [data-removeover]') };
    $('modalOk').click();
    return out;
  });
  check('counter เปิด popup ผลต่างได้', b2.shown === true && b2.rows === 2, b2);
  check('counter เห็นปุ่มเอาออกในกลุ่มขาด', b2.hasBtn === true, b2);

  /* counter กดเอาออกได้จริง — ทดสอบครบทุกกลุ่ม */
  const b3 = await page.evaluate(() => {
    const out = {};
    ['match', 'short', 'over'].forEach(function (kind) {
      window.__setup('counter');
      window.__writes = [];
      const sku = { match: 'M1', short: 'S1', over: 'O1' }[kind];
      const before = state.counts[sku];
      openSumCard(kind);
      const btn = document.querySelector('[data-removeover="' + sku + '"]');
      if (!btn) { out[kind] = { noButton: true }; $('modalOk').click(); return; }
      btn.click();
      const rec = window.__writes.length
        ? Object.keys(window.__writes[0].patch).map(k => window.__writes[0].patch[k])[0] : null;
      out[kind] = { sku: sku, before: before, after: state.counts[sku],
                    writes: window.__writes.length, delta: rec && rec.delta,
                    user: rec && rec.user, reason: rec && rec.reason };
      $('modalOk').click();
    });
    return out;
  });
  ['match', 'short', 'over'].forEach(kind => {
    const g = b3[kind];
    check('counter เอาออกจากกลุ่ม "' + kind + '" ได้ (ยอด -1 + มี log)',
          !g.noButton && g.after === g.before - 1 && g.writes === 1 &&
          g.delta === -1 && g.user === 'สมชาย' &&
          g.reason === 'เอาออกจากสรุป (ยิงเกิน)', g);
  });

  /* ---------- หน้าเอกสาร: counter เข้าได้ ---------- */
  console.log('\n[C] หน้าเอกสาร — admin + counter เข้าได้ · scanner ไม่ได้');
  const c1 = await page.evaluate(() => {
    window.renderDoc = function () {}; window.refreshDocMeta = function () {};
    window.renderScanPage = function () {};
    const out = {};
    ['admin', 'counter'].forEach(function (role) {
      window.__setup(role);
      applyNavVisibility(); refreshNav();
      out[role] = {
        navShown: getComputedStyle($('navDoc')).display !== 'none',
        navDisabled: $('navDoc').disabled,
        canSee: canSeePage('doc')
      };
      showPage('doc');
      out[role].landedOn = state.page;
      showPage('summary');
    });
    window.__setup('scanner');
    applyNavVisibility(); refreshNav();
    out.scanner = {
      navHidden: getComputedStyle($('navDoc')).display === 'none',
      navDisabled: $('navDoc').disabled,
      canSee: canSeePage('doc')
    };
    window.__toasts = [];
    showPage('doc');
    out.scanner.landedOn = state.page;
    out.scanner.toast = (window.__toasts[0] || {}).m;
    return out;
  });
  ['admin', 'counter'].forEach(role => {
    const g = c1[role];
    check(role + ': ปุ่มเอกสารกดได้ + เข้าหน้าเอกสารได้',
          g.navShown === true && g.navDisabled === false && g.canSee === true &&
          g.landedOn === 'doc', g);
  });
  check('scanner: ปุ่มเอกสารถูกซ่อน + disable',
        c1.scanner.navHidden === true && c1.scanner.navDisabled === true, c1.scanner);
  check('scanner: canSeePage(doc) = false', c1.scanner.canSee === false, c1.scanner);
  check('scanner: เรียก showPage(doc) ตรง ๆ ก็เข้าไม่ได้',
        c1.scanner.landedOn !== 'doc', c1.scanner.landedOn);
  check('scanner: มี toast บอกเหตุผล',
        /เฉพาะผู้ดูแลระบบและผู้นับสต๊อก/.test(c1.scanner.toast || ''), c1.scanner.toast);

  /* ================= SCANNER — ไม่เห็น variance อะไรเลย ================= */
  console.log('\n[D] role = scanner (เด็กหน้าร้าน)');
  await page.evaluate(() => { window.__setup('scanner'); });
  for (const id of ADMIN_ONLY) {
    check('scanner ไม่เห็น #' + id, await vis(id) === false, id);
  }
  check('scanner ยังเห็น sumHead', await vis('sumHead') === true, 'sumHead');
  check('scanner เห็นบรรทัด progress ตัวเอง', await vis('myProgress') === true, 'myProgress');

  const d1 = await page.evaluate(() => {
    applyNavVisibility();
    return {
      text: $('myProgress').textContent,
      exportDisabled: $('btnExport').disabled,
      navDoc: getComputedStyle($('navDoc')).display === 'none',
      navSummary: getComputedStyle($('navSummary')).display === 'none',
      navMaster: getComputedStyle($('navMaster')).display === 'none'
    };
  });
  check('progress นับเฉพาะของตัวเอง (15 ชิ้น / 2 SKU)',
        /คุณยิงไปแล้ว 15 ชิ้น \/ 2 SKU/.test(d1.text), d1.text);
  check('progress บอกว่าใครเห็นตัวเลขผลต่างได้',
        /เฉพาะผู้ดูแลระบบและผู้นับสต๊อก/.test(d1.text), d1.text);
  check('ปุ่ม Excel ถูก disable ด้วย ไม่ใช่แค่ซ่อน', d1.exportDisabled === true, d1.exportDisabled);
  check('scanner ไม่เห็นปุ่มเอกสาร', d1.navDoc === true, d1);
  check('scanner ไม่เห็นปุ่มสรุป', d1.navSummary === true, d1);
  check('scanner ไม่เห็นปุ่ม Master', d1.navMaster === true, d1);

  const d2 = await page.evaluate(() => {
    window.__toasts = [];
    openSumCard('short');
    return { shown: $('modalBg').classList.contains('show'),
             toast: (window.__toasts[0] || {}).m, bad: (window.__toasts[0] || {}).bad };
  });
  check('scanner เรียก openSumCard ตรง ๆ ก็ไม่เปิด', d2.shown === false, d2);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(d2.toast || '') && d2.bad === true, d2);

  const d3 = await page.evaluate(() => {
    window.__toasts = []; window.__writes = [];
    const before = state.counts.O1;
    removeOverScan({ key: 'O1', code: 'O1' }, 'over');
    return { writes: window.__writes.length, toast: (window.__toasts[0] || {}).m,
             before: before, after: state.counts.O1 };
  });
  check('scanner เรียก removeOverScan ตรง ๆ ก็ไม่เขียนอะไร', d3.writes === 0, d3);
  check('ยอดไม่ถูกแตะ', d3.after === d3.before, d3);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(d3.toast || ''), d3.toast);

  /* ================= scanner เลือก Job ได้ ================= */
  console.log('\n[J] scanner เข้าหน้า Job เพื่อเลือกงานที่จะยิง');
  const j1 = await page.evaluate(() => {
    window.renderScanPage = function () {};
    /* Job จริง 1 ใบ ให้ renderJobs มีอะไรวาด */
    state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branch: 'B1', branchName: 'สาขาทดสอบ',
                               jobCode: 'J1', cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.jobFilter = 'all'; state.jobBranch = 'all'; state.exportPick = [];

    const snap = function (role) {
      window.__setup(role);
      state.roundIndex = { R1: { id: 'R1', name: 'รอบทดสอบ', branch: 'B1', branchName: 'สาขาทดสอบ',
                                 jobCode: 'J1', cycleId: 'C1', status: 'counting', createdAt: 1 } };
      state.jobFilter = 'all'; state.jobBranch = 'all'; state.exportPick = ['R1'];
      applyNavVisibility();
      renderJobs();
      return {
        canSeeJobs: canSeePage('jobs'),
        navJobs: getComputedStyle($('navJobs')).display !== 'none',
        tabs: getComputedStyle($('jobViewTabs')).display !== 'none',
        createForm: getComputedStyle($('jobViewCreate')).display !== 'none',
        exportBar: getComputedStyle($('exportBar')).display !== 'none',
        cards: document.querySelectorAll('#jobList .jobcard').length,
        pickBoxes: document.querySelectorAll('#jobList [data-jobpick]').length,
        excelBtns: document.querySelectorAll('#jobList [data-cardact="excel"]').length,
        menuBtns: document.querySelectorAll('#jobList [data-cardact="menu"]').length,
        /* เมนู "จัดการ ▾" ของ scanner ต้องเหลือแค่ "เริ่มนับ" ไม่มีปุ่มจัดการรอบ */
        actionIds: jobActions().map(function (a) { return a.id; }),
        view: state.jobView
      };
    };
    return { scanner: snap('scanner'), counter: snap('counter'), admin: snap('admin') };
  });
  check('scanner: canSeePage(jobs) = true', j1.scanner.canSeeJobs === true, j1.scanner);
  check('scanner: ปุ่ม Job ในแถบล่างไม่ถูกซ่อน', j1.scanner.navJobs === true, j1.scanner);
  check('scanner: เห็นรายการ Job อย่างน้อย 1 ใบ', j1.scanner.cards > 0, j1.scanner);
  check('scanner: เมนูจัดการเหลือแค่ "เริ่มนับ" ไม่มีปุ่มจัดการรอบ',
        JSON.stringify(j1.scanner.actionIds) === JSON.stringify(['start']), j1.scanner.actionIds);
  check('counter/admin: เมนูจัดการมีปุ่มส่งตรวจ/ปิดรอบตามเดิม',
        j1.counter.actionIds.length > 1 && j1.admin.actionIds.length > 1,
        { counter: j1.counter.actionIds, admin: j1.admin.actionIds });
  check('scanner: ไม่เห็นแท็บ "สร้าง Job"', j1.scanner.tabs === false, j1.scanner);
  check('scanner: ฟอร์มสร้าง Job ถูกซ่อน', j1.scanner.createForm === false, j1.scanner);
  check('scanner: ถูกบังคับอยู่แท็บรายการ', j1.scanner.view === 'list', j1.scanner);
  check('scanner: ไม่มีช่องติ๊กเลือกไฟล์รวม', j1.scanner.pickBoxes === 0, j1.scanner);
  check('scanner: ไม่มีปุ่ม Excel รายใบ', j1.scanner.excelBtns === 0, j1.scanner);
  check('scanner: แถบดาวน์โหลดรวมไม่โผล่แม้มีของค้างใน exportPick',
        j1.scanner.exportBar === false, j1.scanner);
  ['counter', 'admin'].forEach(role => {
    const g = j1[role];
    check(role + ': ยังเห็นแท็บสร้าง Job + ช่องติ๊ก + ปุ่ม Excel ครบ',
          g.tabs === true && g.pickBoxes > 0 && g.excelBtns > 0 && g.exportBar === true, g);
  });

  /* วงจรจริง: scanner แตะการ์ด Job → ต้องไปโผล่หน้ายิงพร้อม Job ที่เลือก */
  const j2 = await page.evaluate(() => {
    window.renderScanPage = function () {};
    window.__setup('scanner');
    state.roundId = null;
    state.roundIndex = { R7: { id: 'R7', name: 'รอบทดสอบ', branch: 'B1', branchName: 'สาขาทดสอบ',
                               jobCode: 'J7', cycleId: 'C1', status: 'counting', createdAt: 1 } };
    state.jobFilter = 'all'; state.jobBranch = 'all';
    renderJobs();
    showPage('jobs');
    const landedJobs = state.page;
    document.querySelector('#jobList .jobcard').click();
    return { landedJobs: landedJobs, page: state.page, roundId: state.roundId };
  });
  check('scanner: เข้าหน้า Job ได้จริง (ไม่ถูกเด้งออก)', j2.landedJobs === 'jobs', j2);
  check('scanner: แตะการ์ด Job แล้วไปหน้ายิงพร้อม Job ที่เลือก',
        j2.page === 'scan' && j2.roundId === 'R7', j2);

  /* ================= หน้ายิงสด ================= */
  console.log('\n[S] ผลต่างสดบนหน้ายิง (#pageScan) — วัดบนจอมือถือจริง 390px');
  /* จอแคบระดับมือถือ เพื่อพิสูจน์ว่าการ์ดไม่ได้ติดอยู่ใน .scan-col-side ที่ซ่อนต่ำกว่า 1024px */
  await page.setViewport({ width: 390, height: 780 });
  await page.evaluate(() => {
    hideLogin();
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('pageScan').classList.add('active');
  });
  /* เห็นจริงบนจอ ไม่ใช่แค่ค่า display ของตัวเอง — ต้องนับรวมบรรพบุรุษที่ซ่อนอยู่ด้วย */
  const onScreen = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.getClientRects().length > 0;
  }, id);

  const sideHidden = await page.evaluate(() =>
    document.querySelector('.scan-col-side').getClientRects().length === 0);
  check('จอ 390px: คอลัมน์ข้าง (.scan-col-side) ถูกซ่อนจริง', sideHidden === true, sideHidden);

  const s1 = await page.evaluate(() => {
    window.__setup('admin');
    renderScanTotals();
    return {
      cards: getComputedStyle($('scanDiffCards')).display !== 'none',
      btn: getComputedStyle($('btnScanExport')).display !== 'none',
      match: $('scanCardMatchNum').textContent,
      short: $('scanCardShortNum').textContent,
      over: $('scanCardOverNum').textContent
    };
  });
  check('admin เห็นการ์ดผลต่างบนหน้ายิง', s1.cards === true, s1);
  check('admin เห็นปุ่ม Export บนหน้ายิง', s1.btn === true, s1);
  check('จอ 390px: admin เห็นการ์ดบนจอจริง', await onScreen('scanDiffCards') === true, 'scanDiffCards');
  check('จอ 390px: admin เห็นปุ่ม Export บนจอจริง', await onScreen('btnScanExport') === true, 'btnScanExport');
  check('การ์ดอยู่ในคอลัมน์หลัก ไม่ใช่คอลัมน์ข้าง',
        await page.evaluate(() =>
          !!document.querySelector('.scan-col-main #scanDiffCards') &&
          !document.querySelector('.scan-col-side #scanDiffCards') &&
          !!document.querySelector('.scan-col-main #btnScanExport')), true);
  check('นับตรง 3 SKU', s1.match === '3', s1.match);
  check('นับขาด 2 SKU', s1.short === '2', s1.short);
  check('นับเกิน 2 SKU', s1.over === '2', s1.over);

  /* ยิงเพิ่มแล้วตัวเลขต้องขยับเอง */
  const s2 = await page.evaluate(() => {
    const before = $('scanCardOverNum').textContent;
    state.counts.M1 = 9;              // M1 เคยตรงที่ 5 → กลายเป็นเกิน
    renderScanTotals();
    return { before: before, matchAfter: $('scanCardMatchNum').textContent,
             overAfter: $('scanCardOverNum').textContent };
  });
  check('ยิงเพิ่มแล้วการ์ดขยับตาม (ตรง 3→2, เกิน 2→3)',
        s2.matchAfter === '2' && s2.overAfter === '3', s2);

  /* กดการ์ดบนหน้ายิงต้องเปิด popup ตัวเดียวกับหน้าสรุป */
  const s3 = await page.evaluate(() => {
    $('scanCardShort').click();
    const out = { shown: $('modalBg').classList.contains('show'),
                  title: $('modalTitle').textContent,
                  list: !!document.querySelector('[data-sumcard-list="short"]') };
    $('modalOk').click();
    return out;
  });
  check('กดการ์ดบนหน้ายิงเปิด popup เดิม',
        s3.shown === true && s3.title === '❌ สินค้าที่ขาด' && s3.list === true, s3);

  /* counter ต้องเห็นการ์ดผลต่างบนหน้ายิงเหมือน admin */
  const s4 = await page.evaluate(() => {
    window.__setup('counter');
    renderScanTotals();
    const out = {
      cards: getComputedStyle($('scanDiffCards')).display !== 'none',
      btn: getComputedStyle($('btnScanExport')).display !== 'none',
      btnDisabled: $('btnScanExport').disabled,
      match: $('scanCardMatchNum').textContent,
      short: $('scanCardShortNum').textContent,
      over: $('scanCardOverNum').textContent
    };
    $('scanCardShort').click();
    out.popupOpen = $('modalBg').classList.contains('show');
    out.popupTitle = $('modalTitle').textContent;
    $('modalOk').click();
    return out;
  });
  check('counter เห็นการ์ดผลต่างบนหน้ายิง', s4.cards === true, s4);
  check('counter เห็นปุ่ม Export บนหน้ายิง (กดได้)',
        s4.btn === true && s4.btnDisabled === false, s4);
  check('จอ 390px: counter เห็นการ์ดบนจอจริง',
        await onScreen('scanDiffCards') === true, 'scanDiffCards');
  check('counter ได้ตัวเลขจริง ไม่ใช่ค่าค้าง (3 / 2 / 2)',
        s4.match === '3' && s4.short === '2' && s4.over === '2', s4);
  check('counter กดการ์ดบนหน้ายิงเปิด popup ได้',
        s4.popupOpen === true && s4.popupTitle === '❌ สินค้าที่ขาด', s4);

  /* scanner คือคนเดียวที่ไม่เห็นอะไรเลย */
  const s5 = await page.evaluate(() => {
    window.__setup('scanner');
    $('scanCardMatchNum').textContent = 'ค่าค้าง';   // ถ้ามีการคำนวณ ค่านี้จะถูกทับ
    renderScanTotals();
    const out = {
      cards: getComputedStyle($('scanDiffCards')).display === 'none',
      btn: getComputedStyle($('btnScanExport')).display === 'none',
      btnDisabled: $('btnScanExport').disabled,
      /* ไม่ใช่ staff ต้องไม่เรียก summaryData() เลย ตัวเลขจึงต้องค้างค่าเดิม */
      untouched: $('scanCardMatchNum').textContent,
      live: !!document.getElementById('liveStats').children.length
    };
    window.__toasts = [];
    $('scanCardShort').click();
    out.popupBlocked = !$('modalBg').classList.contains('show');
    out.toast = (window.__toasts[0] || {}).m;
    return out;
  });
  check('scanner ไม่เห็นการ์ดผลต่างบนหน้ายิง', s5.cards === true, s5);
  check('scanner ไม่เห็นปุ่ม Export บนหน้ายิง (ล็อกด้วย)',
        s5.btn === true && s5.btnDisabled === true, s5);
  check('scanner ไม่ถูกคำนวณ summaryData() ทิ้ง (ตัวเลขค้างค่าเดิม)',
        s5.untouched === 'ค่าค้าง', s5.untouched);
  check('scanner กดการ์ด (ที่ซ่อนอยู่) ก็ไม่เปิด popup', s5.popupBlocked === true, s5);
  check('บอกเหตุผลว่าสิทธิ์ไม่พอ', /สิทธิ์/.test(s5.toast || ''), s5.toast);
  check('จอ 390px: scanner ไม่เห็นการ์ดบนจอจริง',
        await onScreen('scanDiffCards') === false, 'scanDiffCards');
  check('จอ 390px: scanner ไม่เห็นปุ่ม Export บนจอจริง',
        await onScreen('btnScanExport') === false, 'btnScanExport');

  /* คืนจอกว้างให้หมวดที่เหลือทำงานตามเดิม */
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('pageSummary').classList.add('active');
  });

  /* ---------- สลับ counter → admin ต้อง reveal กลับมาได้ ---------- */
  console.log('\n[D2] สลับกลับเป็น admin ต้องเห็นทุกอย่างอีกครั้ง');
  await page.evaluate(() => { window.__setup('admin'); });
  for (const id of ADMIN_ONLY) {
    check('reveal #' + id + ' กลับมาหลังเคยถูกซ่อน', await vis(id) === true, id);
  }

  /* ================= เวอร์ชัน ================= */
  console.log('\n[E] เวอร์ชัน');
  const e1 = await page.evaluate(() => ({
    v: APP_VERSION, meta: document.querySelector('meta[name=version]').content, title: document.title
  }));
  check('เวอร์ชันตรงกันครบ 3 จุด',
        e1.v === e1.meta && e1.title === 'ISRD Stocktake v' + e1.meta, e1);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
