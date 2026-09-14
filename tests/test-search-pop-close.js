/* ============================================================
   หน้า Master: ป็อปอัปผลค้นหาต้องมีปุ่มปิดบนการ์ด (v2.9.3)
   ============================================================

   กันอะไร:
   [1] เปิดป็อปอัปแล้วต้องมีปุ่ม ✕ อยู่ "ในตัวการ์ด" ไม่ใช่ลอยมุมจอ
       ปุ่มลอยของเดิม (#searchPopClose) ถูกถอดออกแล้ว ต้องไม่กลับมา
   [2] ปุ่มต้องรอดการ rebuild — renderMaster/renderLocationMaster ล้าง innerHTML
       ของลิสต์ทิ้งทุกครั้งที่พิมพ์ ปุ่มต้องยังอยู่หลังพิมพ์ต่อ
   [3] ปิดได้ครบสามทางเหมือนเดิม: ✕ · คลิก backdrop · กด Esc
   [4] ปิดแล้วต้องเคลียร์คำค้น + ถอดแถบหัวออกจากลิสต์ ไม่ค้างอยู่ตอนกลับมาแสดงในหน้า
   [5] ทั้งแท็บสินค้าและแท็บ Location ได้ปุ่มแบบเดียวกัน
   [6] แท็บ "คลังสินค้า/สาขา" กับ "บาร์โค้ด" ไม่ได้เด้งป็อปอัป — ต้องไม่มีแถบหัวไปโผล่
   [7] งานนี้เป็นงาน display ล้วน — ห้ามเขียนอะไรลงฐานข้อมูล
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const SEED = `
  window.__toasts = []; window.__writes = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.enqueueWrite = function (p, patch) { window.__writes.push({ p: p, patch: patch }); };
  window.db.update = function (p, patch) {
    window.__writes.push({ p: p, patch: patch });
    return Promise.resolve();
  };
  hideLogin();

  window.__seed = function () {
    state.me = { uid: 'u1', name: 'แอดมิน', role: 'admin', branches: [] };
    state.counter = 'แอดมิน';
    state.products = {
      A001: { code: 'A001', name: 'เสื้อยืดคอกลม', barcode: '8850001', type: 'product',
              category: 'เสื้อผ้า', status: 'Normal', sellPrice: 199, costPrice: 90 },
      A002: { code: 'A002', name: 'กางเกงยีนส์', barcode: '8850002', type: 'product',
              category: 'เสื้อผ้า', status: 'Normal', sellPrice: 590, costPrice: 300 },
      B001: { code: 'B001', name: 'ถุงหิ้วใบใหญ่', barcode: '8850003', type: 'notProduct',
              category: 'บรรจุภัณฑ์', status: 'Normal', sellPrice: 5, costPrice: 2 }
    };
    state.locations = {
      offline: {
        A001: { sku: 'A001', name: 'เสื้อยืดคอกลม', pick: 'A1-01', refill: 'R1-01' },
        A002: { sku: 'A002', name: 'กางเกงยีนส์', pick: 'A2-07', refill: '' }
      },
      online: {}
    };
    state.locationSet = 'offline';
    locViewSet = 'offline';
    state.systemQty = {}; state.counts = {}; state.unknown = {};
    state.masterFilter = 'all';
    state.masterTab = 'products';
    state.page = 'master';
    $('masterSearch').value = '';
    $('locSearch').value = '';
    window.__toasts = []; window.__writes = [];
    showPage('master');
  };

  /* พิมพ์ค้นหาแบบที่ผู้ใช้ทำจริง — ยิง event input ให้ตัวฟังของแอปทำงานเอง
     ไม่เรียก renderMaster() ตรง ๆ จะได้เทสเส้นทางจริงทั้งเส้น */
  window.__type = function (id, text) {
    var el = document.getElementById(id);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /* สภาพป็อปอัปของลิสต์ใบหนึ่ง */
  window.__pop = function (id) {
    var el = document.getElementById(id);
    var head = el.querySelector('.pop-head');
    var x = el.querySelector('.pop-x');
    var r = x ? x.getBoundingClientRect() : null;
    var er = el.getBoundingClientRect();
    return {
      popped: el.classList.contains('search-pop'),
      hasHead: !!head,
      /* แถบหัวต้องเป็นลูกตัวแรก ไม่งั้นมันจะไปแทรกกลางผลค้น */
      headFirst: !!head && el.firstElementChild === head,
      headSticky: head ? getComputedStyle(head).position : null,
      hasX: !!x,
      xLabel: x ? x.getAttribute('aria-label') : null,
      xText: x ? x.textContent : null,
      xW: r ? Math.round(r.width) : 0,
      xH: r ? Math.round(r.height) : 0,
      /* ปุ่มต้องอยู่ในกรอบการ์ด ไม่ใช่ลอยไปมุมจอ */
      xInsideCard: !!r && r.top >= er.top - 1 && r.bottom <= er.bottom + 1 &&
                   r.left >= er.left - 1 && r.right <= er.right + 1,
      title: (el.querySelector('.pop-title') || {}).textContent || null,
      backdrop: getComputedStyle(document.getElementById('searchBackdrop')).display,
      rows: el.querySelectorAll('.mrow').length,
      search: (document.getElementById('masterSearch') || {}).value,
      locSearch: (document.getElementById('locSearch') || {}).value
    };
  };
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 780 });   // มือถือเป็นหลัก
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(SEED);
  await page.evaluate(() => window.__seed());

  /* ---------- [0] ปุ่มลอยมุมจอต้องไม่มีอีกแล้ว ---------- */
  console.log('\n[0] ปุ่มปิดลอยมุมจอถูกถอดออกแล้ว');
  const gone = await page.evaluate(() => ({
    el: !!document.getElementById('searchPopClose'),
    css: Array.prototype.some.call(document.styleSheets[0].cssRules,
                                   r => (r.selectorText || '').indexOf('#searchPopClose') >= 0)
  }));
  check('ไม่มี #searchPopClose ใน DOM แล้ว', gone.el === false, gone);
  check('ไม่มี CSS ของปุ่มลอยค้างอยู่', gone.css === false, gone);

  /* ---------- [1] แท็บสินค้า ---------- */
  console.log('\n[1] ค้นหาสินค้า → ป็อปอัปมีปุ่ม ✕ บนการ์ด');
  const before = await page.evaluate(() => window.__pop('masterList'));
  check('ยังไม่ค้น = ยังไม่เด้งป็อปอัป', before.popped === false && before.hasHead === false, before);
  check('ยังไม่ค้น = ไม่มี backdrop', before.backdrop === 'none', before.backdrop);

  const p1 = await page.evaluate(() => { window.__type('masterSearch', 'เสื้อ'); return window.__pop('masterList'); });
  check('เด้งเป็นป็อปอัป', p1.popped === true, p1);
  check('มีแถบหัวเป็นลูกตัวแรกของการ์ด', p1.hasHead && p1.headFirst, p1);
  check('แถบหัวเป็น sticky (เลื่อนผลค้นแล้วปุ่มไม่หนี)', p1.headSticky === 'sticky', p1.headSticky);
  check('มีปุ่ม ✕', p1.hasX && p1.xText === '✕', p1);
  check('ปุ่มมี aria-label="ปิด"', p1.xLabel === 'ปิด', p1.xLabel);
  check('ปุ่มแตะง่ายบนมือถือ (>=40px)', p1.xW >= 40 && p1.xH >= 40, p1);
  check('ปุ่มอยู่ในกรอบการ์ด ไม่ลอยมุมจอ', p1.xInsideCard === true, p1);
  check('หัวบอกว่ากำลังดูผลค้นของอะไร', p1.title === 'ผลการค้นหาสินค้า', p1.title);
  check('backdrop โผล่แล้ว', p1.backdrop === 'block', p1.backdrop);
  check('ผลค้นยังวาดครบ', p1.rows === 1, p1.rows);

  /* ---------- [2] rebuild แล้วปุ่มต้องรอด ---------- */
  console.log('\n[2] พิมพ์ต่อ (ลิสต์ถูกวาดใหม่) ปุ่มต้องยังอยู่');
  const p2 = await page.evaluate(() => { window.__type('masterSearch', 'เสื้อยืด'); return window.__pop('masterList'); });
  check('พิมพ์ต่อแล้วปุ่ม ✕ ยังอยู่', p2.hasX === true && p2.headFirst === true, p2);
  const dup = await page.evaluate(() => {
    window.__type('masterSearch', 'เสื้อยืดค');
    window.__type('masterSearch', 'เสื้อยืดคอ');
    return document.querySelectorAll('#masterList .pop-head').length;
  });
  check('พิมพ์รัว ๆ แล้วแถบหัวไม่ซ้อนกันหลายอัน', dup === 1, dup);

  console.log('\n[2b] ค้นแล้วไม่เจออะไรเลย ก็ยังต้องปิดได้');
  const p2b = await page.evaluate(() => { window.__type('masterSearch', 'ไม่มีสินค้านี้แน่นอน'); return window.__pop('masterList'); });
  check('ผลว่างแต่ยังมีปุ่ม ✕', p2b.popped === true && p2b.hasX === true, p2b);
  check('ผลว่างจริง (ไม่มีการ์ดสินค้า)', p2b.rows === 0, p2b.rows);

  /* ---------- [3] ปิดด้วยปุ่ม ✕ ---------- */
  console.log('\n[3] กดปุ่ม ✕ ด้วยเมาส์จริง');
  await page.evaluate(() => window.__type('masterSearch', 'เสื้อ'));
  const xy = await page.evaluate(() => {
    const r = document.querySelector('#masterList .pop-x').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(xy.x, xy.y);
  const afterX = await page.evaluate(() => window.__pop('masterList'));
  check('กด ✕ แล้วป็อปอัปปิด', afterX.popped === false, afterX);
  check('กด ✕ แล้วแถบหัวถูกถอดออกจากลิสต์', afterX.hasHead === false, afterX);
  check('กด ✕ แล้ว backdrop หาย', afterX.backdrop === 'none', afterX.backdrop);
  check('กด ✕ แล้วคำค้นถูกเคลียร์', afterX.search === '', afterX.search);

  /* ---------- [4] ปิดด้วย backdrop ---------- */
  console.log('\n[4] คลิกพื้นหลังปิดได้เหมือนเดิม');
  const afterBd = await page.evaluate(() => {
    window.__type('masterSearch', 'เสื้อ');
    const opened = window.__pop('masterList').popped;
    document.getElementById('searchBackdrop').click();
    const closed = window.__pop('masterList');
    return { opened: opened, closed: closed };
  });
  check('เปิดได้ก่อน', afterBd.opened === true, afterBd.opened);
  check('คลิกพื้นหลังแล้วปิด', afterBd.closed.popped === false && afterBd.closed.hasHead === false, afterBd.closed);
  check('คลิกพื้นหลังแล้วคำค้นถูกเคลียร์', afterBd.closed.search === '', afterBd.closed.search);

  /* ---------- [5] ปิดด้วย Esc ---------- */
  console.log('\n[5] กด Esc ปิดได้เหมือนเดิม');
  await page.evaluate(() => window.__type('masterSearch', 'เสื้อ'));
  const openedEsc = await page.evaluate(() => window.__pop('masterList').popped);
  await page.keyboard.press('Escape');
  const afterEsc = await page.evaluate(() => window.__pop('masterList'));
  check('เปิดได้ก่อน', openedEsc === true, openedEsc);
  check('กด Esc แล้วปิด', afterEsc.popped === false && afterEsc.hasHead === false, afterEsc);
  check('กด Esc แล้วคำค้นถูกเคลียร์', afterEsc.search === '', afterEsc.search);

  /* ---------- [6] แท็บ Location ---------- */
  console.log('\n[6] แท็บ Location ได้ปุ่มแบบเดียวกัน');
  await page.evaluate(() => { state.masterTab = 'locations'; renderMaster(); });
  const l0 = await page.evaluate(() => window.__pop('locList'));
  check('ยังไม่ค้น = ยังไม่เด้ง', l0.popped === false && l0.hasHead === false, l0);

  const l1 = await page.evaluate(() => { window.__type('locSearch', 'A1-01'); return window.__pop('locList'); });
  check('ค้น Location แล้วเด้งป็อปอัป', l1.popped === true, l1);
  check('มีปุ่ม ✕ บนการ์ด', l1.hasX && l1.headFirst && l1.xInsideCard, l1);
  check('ปุ่มแตะง่าย (>=40px)', l1.xW >= 40 && l1.xH >= 40, l1);
  check('หัวบอกว่าเป็นผลค้น Location', l1.title === 'ผลการค้นหา Location', l1.title);
  check('backdrop โผล่', l1.backdrop === 'block', l1.backdrop);

  const lx = await page.evaluate(() => {
    const r = document.querySelector('#locList .pop-x').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(lx.x, lx.y);
  const l2 = await page.evaluate(() => window.__pop('locList'));
  check('กด ✕ แล้วปิด', l2.popped === false && l2.hasHead === false, l2);
  check('คำค้น Location ถูกเคลียร์', l2.locSearch === '', l2.locSearch);

  console.log('\n[6b] Esc ปิดแท็บ Location ได้ด้วย');
  await page.evaluate(() => window.__type('locSearch', 'A2-07'));
  const lEscOpen = await page.evaluate(() => window.__pop('locList').popped);
  await page.keyboard.press('Escape');
  const lEsc = await page.evaluate(() => window.__pop('locList'));
  check('เปิดได้ก่อน', lEscOpen === true, lEscOpen);
  check('Esc ปิดได้', lEsc.popped === false && lEsc.hasHead === false, lEsc);

  /* ---------- [7] สลับแท็บทั้งที่ยังเปิดป็อปอัปค้างอยู่ ---------- */
  console.log('\n[7] สลับแท็บตอนป็อปอัปเปิดค้าง ต้องไม่มีอะไรค้างลอย');
  const swap = await page.evaluate(() => {
    state.masterTab = 'products'; renderMaster();
    window.__type('masterSearch', 'เสื้อ');
    var opened = window.__pop('masterList').popped;
    state.masterTab = 'locations'; renderMaster();     // ออกจากแท็บทั้งที่ยังเปิดอยู่
    var m = window.__pop('masterList');
    return { opened: opened, popped: m.popped, head: m.hasHead, backdrop: m.backdrop,
             heads: document.querySelectorAll('.pop-head').length };
  });
  check('เปิดได้ก่อน', swap.opened === true, swap.opened);
  check('ออกจากแท็บแล้วป็อปอัปถูกปิด', swap.popped === false, swap);
  check('แถบหัวถูกถอดออกไปด้วย ไม่ค้างในลิสต์', swap.head === false && swap.heads === 0, swap);
  check('backdrop หายตาม', swap.backdrop === 'none', swap.backdrop);

  /* ---------- [8] แท็บที่ไม่ได้ใช้ป็อปอัป ---------- */
  console.log('\n[8] แท็บสาขา/บาร์โค้ด ค้นแบบ inline ไม่เด้งป็อปอัป');
  const inline = await page.evaluate(() => {
    const out = {};
    ['branches', 'newcodes'].forEach(function (t) {
      state.masterTab = t; renderMaster();
      const id = t === 'branches' ? 'branchList' : 'ncList';
      const el = document.getElementById(id);
      out[t] = { popped: el.classList.contains('search-pop'),
                 head: !!el.querySelector('.pop-head') };
    });
    out.backdrop = getComputedStyle(document.getElementById('searchBackdrop')).display;
    return out;
  });
  check('แท็บสาขาไม่เด้งป็อปอัป', inline.branches.popped === false && inline.branches.head === false, inline.branches);
  check('แท็บบาร์โค้ดไม่เด้งป็อปอัป', inline.newcodes.popped === false && inline.newcodes.head === false, inline.newcodes);
  check('ไม่มี backdrop ค้างไว้', inline.backdrop === 'none', inline.backdrop);

  /* ---------- [9] ไม่เขียนฐานข้อมูล ---------- */
  console.log('\n[9] งาน display ล้วน');
  const writes = await page.evaluate(() => window.__writes.length);
  check('เปิด/ปิดป็อปอัปไม่เขียนอะไรลงฐาน', writes === 0, writes);
  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
