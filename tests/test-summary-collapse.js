/* ============================================================
   หน้าสรุป: การ์ดลิสต์ยาวยุบ/กางได้ + แถบเครื่องมือ sticky (v2.9.2)
   ============================================================

   กันอะไร:
   [1] การ์ดลิสต์ SKU ยาวต้อง "ยุบเป็นค่าเริ่มต้น" ทั้ง 5 ใบ
       การ์ดสั้น (ผู้ยิงในรอบนี้ / จัดการรอบนับ) กับ KPI ต้องไม่ถูกยุบไปด้วย
   [2] หัวการ์ดกดได้ทั้งแถบ และสูงพอสำหรับคนใส่ถุงมือ (>= 44px)
   [3] สถานะยุบ/กางถูกจำรายใบใน localStorage แล้วเอากลับมาใช้ตอนเปิดใหม่
   [4] หัวการ์ดตอนยุบต้องบอกจำนวน + สรุปหนึ่งบรรทัด (ไม่ต้องกางก็รู้เรื่อง)
   [5] การ์ดที่ไม่มีของต้องจาง (.faint) ไม่แย่งสายตาใบที่มีเรื่องให้ทำ
   [6] ปุ่มดาวน์โหลด Excel ต้องอยู่บนแถบ sticky และล็อกตามสิทธิ์เหมือนปุ่มเดิม
   [7] ชิปด้านบนพาไปการ์ด (กางให้ด้วย) และไม่โผล่ให้คนที่ไม่มีสิทธิ์
   [8] งานนี้เป็นงาน display ล้วน — ยอดในตารางสรุปต้องไม่ขยับ
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

/* ทุกใบที่ต้องยุบได้ — ต้องตรงกับ SUMMARY_CARDS ในแอป */
const CARDS = ['tfCard', 'foreignCard', 'unknownCard', 'statusCard', 'manualCard'];

const SEED = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.__writes = [];
  window.enqueueWrite = function (p, patch) { window.__writes.push({ p: p, patch: patch }); };
  window.db.update = function () { return Promise.resolve(); };
  hideLogin();

  window.__seed = function (role) {
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
    state.zones = {}; state.transfers = {}; state.transferQty = {};

    var add = function (code, type, sys, act, price) {
      state.products[code] = { code: code, name: 'ชื่อ ' + code, category: 'หมวด',
                               type: type, costPrice: price, sellPrice: price };
      if (sys !== null) state.systemQty[code] = sys;
      if (act) { state.counts[code] = act; state.scanQty[code] = act; }
    };
    add('M1', 'product', 5, 5, 100);        // ตรง
    add('S1', 'product', 10, 6, 50);        // ขาด
    add('F1', 'product', null, 3, 30);      // ไม่ใช่ของสาขานี้ 3 ชิ้น
    add('F2', 'product', null, 7, 30);      // ไม่ใช่ของสาขานี้ 7 ชิ้น  → รวม 10 ชิ้น

    /* สินค้าสถานะพิเศษ 1 ตัว 4 ชิ้น */
    state.products.X1 = { code: 'X1', name: 'ชื่อ X1', category: 'หมวด', type: 'product',
                          status: 'ยกเลิกขาย', costPrice: 10, sellPrice: 10 };
    state.systemQty.X1 = 4; state.counts.X1 = 4; state.scanQty.X1 = 4;

    /* ยอดกรอกมือ +5 แล้ว -2 → สุทธิ +3 */
    state.manualLog = [
      { id: 'm1', rec: { code: 'M1', delta: 5, reason: 'นับเพิ่ม', user: 'สมชาย', ts: 10 } },
      { id: 'm2', rec: { code: 'S1', delta: -2, reason: 'นับเกิน', user: 'สมชาย', ts: 20 } }
    ];
    state.scanLog = [
      { id: 's1', rec: { code: 'S1', delta: 6, user: 'สมชาย', ts: 100, zone: 'A', zoneName: 'A' } }
    ];
    window.__toasts = []; window.__writes = [];
    renderSummary();
  };
`;

/* อ่านสภาพการ์ดใบเดียว — ใช้ computed style จริง ไม่ใช่เดาจาก class */
const READ_CARD = `
  window.__card = function (id) {
    var card = document.getElementById(id);
    if (!card) return { missing: true };
    var hd = card.querySelector('.card-hd');
    var bd = card.querySelector('.card-bd');
    return {
      open: card.classList.contains('open'),
      faint: card.classList.contains('faint'),
      bodyShown: !!bd && getComputedStyle(bd).display !== 'none',
      arrow: (card.querySelector('.hd-ar') || {}).textContent,
      sum: (card.querySelector('.hd-sum') || {}).textContent,
      chip: (card.querySelector('.chip') || {}).textContent,
      aria: hd ? hd.getAttribute('aria-expanded') : null,
      hdHeight: hd ? Math.round(hd.getBoundingClientRect().height) : 0,
      ls: localStorage.getItem('summaryCollapse.' + id)
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
  await page.evaluate(SEED + READ_CARD);
  await page.evaluate(() => { localStorage.clear(); window.__seed('admin'); showPage('summary'); });

  /* ---------- [1] ยุบเป็นค่าเริ่มต้น ---------- */
  console.log('\n[1] เปิดมาครั้งแรกต้องยุบทุกใบ');
  const first = await page.evaluate(ids => ids.map(window.__card), CARDS);
  CARDS.forEach((id, i) => {
    check(id + ' ยุบไว้ตั้งแต่แรก', first[i].bodyShown === false && first[i].open === false, first[i]);
    check(id + ' ลูกศรเป็น ▸', first[i].arrow === '▸', first[i].arrow);
    check(id + ' บอก aria-expanded=false', first[i].aria === 'false', first[i].aria);
  });

  console.log('\n[1b] การ์ดสั้นกับ KPI ต้องไม่ถูกยุบไปด้วย');
  const keep = await page.evaluate(() => {
    const list = ['jobManageCard', 'sumCards', 'sumTableWrap'];
    const out = {};
    list.forEach(id => {
      const el = document.getElementById(id);
      out[id] = { collapsible: el.classList.contains('collapsible'),
                  shown: getComputedStyle(el).display !== 'none' };
    });
    /* การ์ด "ผู้ยิงในรอบนี้" ไม่มี id — หาจากลิสต์ข้างในแทน */
    const sc = document.getElementById('scannerList').closest('.card');
    out.scannerCard = { collapsible: sc.classList.contains('collapsible'),
                        shown: getComputedStyle(sc).display !== 'none' };
    return out;
  });
  check('การ์ดจัดการรอบนับยังกางอยู่', keep.jobManageCard.collapsible === false && keep.jobManageCard.shown, keep.jobManageCard);
  check('Dashboard KPI ยังกางอยู่', keep.sumCards.collapsible === false && keep.sumCards.shown, keep.sumCards);
  check('ตารางสรุปยังกางอยู่', keep.sumTableWrap.collapsible === false && keep.sumTableWrap.shown, keep.sumTableWrap);
  check('การ์ดผู้ยิงในรอบนี้ยังกางอยู่', keep.scannerCard.collapsible === false && keep.scannerCard.shown, keep.scannerCard);

  /* ---------- [2] หัวการ์ดกดได้ทั้งแถบ ---------- */
  console.log('\n[2] หัวการ์ดกดง่ายบนมือถือ');
  const hdBox = await page.evaluate(() => {
    const card = document.getElementById('foreignCard');
    const hd = card.querySelector('.card-hd');
    const cb = card.getBoundingClientRect(), hb = hd.getBoundingClientRect();
    return { h: Math.round(hb.height), cursor: getComputedStyle(hd).cursor,
             /* กินเต็มความกว้างการ์ดจริงไหม — margin ติดลบกิน padding 16px ซ้ายขวา
                เหลือต่างได้แค่เส้นขอบการ์ดข้างละ 1px เท่านั้น */
             fullWidth: Math.round(cb.width) - Math.round(hb.width) <= 2 };
  });
  check('หัวการ์ดสูงพอสำหรับคนใส่ถุงมือ (>=44px)', hdBox.h >= 44, hdBox);
  check('หัวการ์ดเป็น cursor:pointer', hdBox.cursor === 'pointer', hdBox.cursor);
  check('กดได้ทั้งแถบ ไม่ใช่แค่ลูกศร', hdBox.fullWidth === true, hdBox);

  /* กดที่ขอบซ้ายสุดของหัวการ์ด (นอกตัวหนังสือ) ก็ต้องกางได้ */
  console.log('\n[2b] กดจริงด้วยเมาส์ที่ขอบหัวการ์ด');
  await page.evaluate(() => document.getElementById('foreignCard').scrollIntoView());
  const box = await page.evaluate(() => {
    const r = document.querySelector('#foreignCard > .card-hd').getBoundingClientRect();
    return { x: r.left + 4, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  let f = await page.evaluate(() => window.__card('foreignCard'));
  check('กดขอบซ้ายแล้วกางออก', f.open === true && f.bodyShown === true, f);
  check('ลูกศรเปลี่ยนเป็น ▾', f.arrow === '▾', f.arrow);
  check('aria-expanded=true', f.aria === 'true', f.aria);
  check('จำลง localStorage ว่า open', f.ls === 'open', f.ls);

  await page.mouse.click(box.x, box.y);
  f = await page.evaluate(() => window.__card('foreignCard'));
  check('กดซ้ำแล้วยุบกลับ', f.open === false && f.bodyShown === false, f);
  check('จำลง localStorage ว่า closed', f.ls === 'closed', f.ls);

  /* ---------- [3] จำสถานะข้ามการเปิดหน้าใหม่ ---------- */
  console.log('\n[3] เปิดหน้าใหม่แล้วต้องอยู่ตามที่ตั้งไว้');
  await page.evaluate(() => {
    /* กางไว้ 2 ใบ ปิดไว้ 1 ใบ แล้ววัดว่าโหลดใหม่จำได้ครบ */
    revealCard('statusCard');
    toggleCard('manualCard');
    rememberCard('unknownCard', false);
  });
  const before = await page.evaluate(ids => ids.map(i => window.__card(i).ls), CARDS);

  const page2 = await browser.newPage();
  await page2.setViewport({ width: 390, height: 780 });
  page2.on('pageerror', e => errors.push('PAGEERROR(2): ' + e.message));
  await page2.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page2.evaluate(SEED + READ_CARD);
  await page2.evaluate(() => { window.__seed('admin'); showPage('summary'); });
  const after = await page2.evaluate(ids => ids.map(window.__card), CARDS);
  const lsShared = before.some(v => v !== null);
  check('localStorage ข้ามหน้าใช้ร่วมกันได้ (ไม่งั้นเทสข้อนี้ไม่มีความหมาย)', lsShared === true, before);
  check('statusCard ที่กางไว้ยังกางอยู่', after[CARDS.indexOf('statusCard')].bodyShown === true, after[3]);
  check('manualCard ที่กางไว้ยังกางอยู่', after[CARDS.indexOf('manualCard')].bodyShown === true, after[4]);
  check('unknownCard ที่ยุบไว้ยังยุบอยู่', after[CARDS.indexOf('unknownCard')].bodyShown === false, after[2]);
  check('tfCard ที่ไม่เคยแตะยังยุบตามค่าเริ่มต้น', after[CARDS.indexOf('tfCard')].bodyShown === false, after[0]);
  await page2.close();

  /* ---------- [4] หัวการ์ดตอนยุบต้องอ่านรู้เรื่อง ---------- */
  console.log('\n[4] จำนวน + สรุปหนึ่งบรรทัดบนหัวการ์ด');
  await page.evaluate(() => { localStorage.clear(); window.__seed('admin'); });
  const meta = await page.evaluate(ids => {
    const o = {};
    ids.forEach(i => { o[i] = window.__card(i); });
    return o;
  }, CARDS);
  check('ไม่ใช่ของสาขานี้: badge = 2 SKU', meta.foreignCard.chip === '2', meta.foreignCard.chip);
  check('ไม่ใช่ของสาขานี้: สรุป "รวม 10 ชิ้น"', meta.foreignCard.sum === 'รวม 10 ชิ้น', meta.foreignCard.sum);
  check('สถานะพิเศษ: badge = 1 SKU', meta.statusCard.chip === '1', meta.statusCard.chip);
  check('สถานะพิเศษ: สรุป "รวม 4 ชิ้น"', meta.statusCard.sum === 'รวม 4 ชิ้น', meta.statusCard.sum);
  check('กรอกมือ: badge = 2 ครั้ง', meta.manualCard.chip === '2', meta.manualCard.chip);
  check('กรอกมือ: สรุปเป็นยอดสุทธิ +3 ชิ้น', meta.manualCard.sum === 'สุทธิ +3 ชิ้น', meta.manualCard.sum);
  check('ไม่มีในระบบ: badge = 0', meta.unknownCard.chip === '0', meta.unknownCard.chip);

  /* ---------- [5] การ์ดว่างต้องจาง ---------- */
  console.log('\n[5] การ์ดที่ไม่มีของต้องจางและยุบไว้');
  check('unknownCard (0 รายการ) จาง', meta.unknownCard.faint === true, meta.unknownCard);
  check('tfCard (0 รายการ) จาง', meta.tfCard.faint === true, meta.tfCard);
  check('foreignCard (มีของ) ไม่จาง', meta.foreignCard.faint === false, meta.foreignCard);
  check('statusCard (มีของ) ไม่จาง', meta.statusCard.faint === false, meta.statusCard);
  const faintOpacity = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#unknownCard > .card-hd')).opacity);
  check('การ์ดจางจางจริงในสายตา (opacity < 1)', Number(faintOpacity) < 1, faintOpacity);

  /* ---------- [6] แถบเครื่องมือ sticky ---------- */
  console.log('\n[6] ปุ่มดาวน์โหลด Excel บนแถบ sticky');
  const bar = await page.evaluate(() => {
    const el = document.getElementById('sumBar');
    const cs = getComputedStyle(el);
    const job = document.getElementById('sumJob');
    return {
      exists: !!el,
      sticky: cs.position,
      top: cs.top,
      topbarVar: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
      shown: cs.display !== 'none',
      /* ต้องเป็นอันแรกของแท็บสรุป ไม่งั้นเลื่อนลงมาแล้วมันหลุดขึ้นไปก่อน */
      firstInTab: job.firstElementChild === el || job.children[0] === el,
      underTopbar: Number(cs.zIndex) < Number(getComputedStyle(document.querySelector('.topbar')).zIndex),
      btnHeight: Math.round(document.getElementById('btnExportTop').getBoundingClientRect().height)
    };
  });
  check('มีแถบ sticky อยู่บนสุดของแท็บสรุป', bar.exists && bar.firstInTab, bar);
  check('เป็น position:sticky', bar.sticky === 'sticky', bar.sticky);
  check('วัดความสูงแถบหัวเว็บได้จริง', /^\d+px$/.test(bar.topbarVar) && parseInt(bar.topbarVar, 10) > 0, bar.topbarVar);
  check('หยุดใต้แถบหัวเว็บพอดี ไม่ทับกัน', bar.top === bar.topbarVar, bar);
  check('ซ้อนอยู่ใต้แถบหัวเว็บ (z-index ต่ำกว่า)', bar.underTopbar === true, bar);
  check('ปุ่มสูงพอสำหรับคนใส่ถุงมือ', bar.btnHeight >= 44, bar.btnHeight);

  /* ปุ่มติดอยู่บนจอจริงแม้เลื่อนไปท้ายหน้า */
  const stuck = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 120));
    const r = document.getElementById('btnExportTop').getBoundingClientRect();
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom),
             tbBottom: Math.round(tb.bottom), vh: window.innerHeight, y: Math.round(window.scrollY) };
  });
  check('เลื่อนถึงท้ายหน้าแล้วปุ่มยังอยู่บนจอ',
        stuck.top >= 0 && stuck.bottom <= stuck.vh, stuck);
  check('ปุ่มไม่ไปซ้อนใต้แถบหัวเว็บ', stuck.top >= stuck.tbBottom - 1, stuck);
  await page.evaluate(() => window.scrollTo(0, 0));

  console.log('\n[6b] ปุ่มบนแถบผูกกับ exportExcel ตัวเดียวกับปุ่มเดิม');
  const wired = await page.evaluate(() => {
    let called = 0;
    const real = window.exportExcel;
    window.exportExcel = function () { called++; return Promise.resolve(); };
    /* ผูกใหม่ให้ชี้ตัวหลอก เลียนแบบสิ่งที่ init() ทำ */
    document.getElementById('btnExportTop').onclick = window.exportExcel;
    document.getElementById('btnExportTop').click();
    window.exportExcel = real;
    return called;
  });
  check('กดปุ่มบนแถบแล้วเรียกสร้างไฟล์', wired === 1, wired);
  const sameFn = await page.evaluate(() =>
    document.getElementById('btnExport').onclick === exportExcel);
  check('ปุ่มเดิมท้ายหน้ายังอยู่และยังเรียก exportExcel', sameFn === true, sameFn);

  /* ---------- [7] สิทธิ์: แถบ + ชิป ---------- */
  console.log('\n[7] แถบ sticky และชิปต้องเดินตามสิทธิ์เดิม');
  for (const role of ['admin', 'counter', 'scanner', 'viewer']) {
    const r = await page.evaluate(rl => {
      window.__seed(rl);
      const barEl = document.getElementById('sumBar');
      return {
        barShown: getComputedStyle(barEl).display !== 'none',
        btnDisabled: document.getElementById('btnExportTop').disabled,
        oldDisabled: document.getElementById('btnExport').disabled,
        chips: document.querySelectorAll('#sumChips button').length
      };
    }, role);
    const staff = role === 'admin' || role === 'counter';
    check(role + ' เห็นแถบ Export = ' + staff, r.barShown === staff, r);
    check(role + ' ปุ่มบนแถบล็อกตรงกับปุ่มเดิม', r.btnDisabled === r.oldDisabled, r);
    check(role + (staff ? ' เห็นชิป' : ' ไม่เห็นชิป'), (r.chips > 0) === staff, r);
  }

  console.log('\n[7b] ชิปบอกจำนวนตรงกับ badge และกดแล้วกางการ์ดให้');
  await page.evaluate(() => { localStorage.clear(); window.__seed('admin'); });
  const chips = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#sumChips button'), b => ({
      id: b.getAttribute('data-sumchip'),
      text: b.textContent,
      zero: b.className === 'zero',
      h: Math.round(b.getBoundingClientRect().height)
    })));
  check('มีชิปครบทุกการ์ดที่ยุบได้', chips.length === CARDS.length, chips.map(c => c.id));
  check('ชิปเรียงตรงกับลำดับการ์ด',
        chips.map(c => c.id).join(',') === CARDS.join(','), chips.map(c => c.id));
  const foreignChip = chips.filter(c => c.id === 'foreignCard')[0];
  check('ชิป "ไม่ใช่ของสาขานี้ 2"', foreignChip && foreignChip.text === 'ไม่ใช่ของสาขานี้ 2', foreignChip);
  const unknownChip = chips.filter(c => c.id === 'unknownCard')[0];
  check('ชิปของการ์ดว่างจางลง', unknownChip && unknownChip.zero === true, unknownChip);
  check('ชิปสูงพอให้แตะโดน (>=36px)', chips.every(c => c.h >= 36), chips.map(c => c.h));

  const jumped = await page.evaluate(async () => {
    const btn = document.querySelector('#sumChips [data-sumchip="statusCard"]');
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    const card = document.getElementById('statusCard');
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    const cb = card.getBoundingClientRect();
    return { open: card.classList.contains('open'),
             ls: localStorage.getItem('summaryCollapse.statusCard'),
             visible: cb.top >= tb.bottom - 2 && cb.top < window.innerHeight };
  });
  check('กดชิปแล้วการ์ดกางออก', jumped.open === true && jumped.ls === 'open', jumped);
  check('กดชิปแล้วเลื่อนไปเห็นหัวการ์ดจริง', jumped.visible === true, jumped);

  /* ---------- [8] งาน display ล้วน — ยอดต้องไม่ขยับ ---------- */
  console.log('\n[8] ยอดสรุปต้องไม่ขยับจากงานนี้');
  const totals = await page.evaluate(() => {
    window.__seed('admin');
    const row = document.querySelector('#sumBody [data-group="total"]');
    const cells = Array.prototype.map.call(row.children, td => td.textContent);
    return {
      cells: cells,
      match: $('cardMatchNum').textContent,
      short: $('cardShortNum').textContent,
      over: $('cardOverNum').textContent,
      writes: window.__writes.length
    };
  });
  /* รวม: M1 5/5 ตรง · S1 10/6 ขาด · X1 4/4 ตรง · F1+F2 ไม่มียอดระบบ = เกิน 2 ตัว */
  check('SKU ตรง = 2', totals.match === '2', totals.match);
  check('SKU ขาด = 1', totals.short === '1', totals.short);
  check('SKU เกิน = 2', totals.over === '2', totals.over);
  check('แถวรวมยังมีครบ 12 ช่อง', totals.cells.length === 12, totals.cells);
  check('ยุบ/กางไม่เขียนอะไรลงฐานข้อมูล', totals.writes === 0, totals.writes);

  /* ---------- ไม่มี error หลุด ---------- */
  console.log('\n[9] ไม่มี error ในคอนโซล');
  check('ไม่มี error', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
