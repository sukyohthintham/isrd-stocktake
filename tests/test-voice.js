/* ============================================================
   v2.14.0 — เสียงพูดไทยตอนยิงบาร์โค้ด (Text-to-Speech)
   ============================================================

   ทำไมต้องมี: เสียงติ๊ดห้าแบบแยกออกจากกันได้ด้วยหูก็จริง แต่ต้อง "จำ" ว่าเสียงไหน
   แปลว่าอะไร คนเข้ากะใหม่จำไม่ทัน แล้วกลับไปมองจอทุกครั้งซึ่งช้ากว่าเดิม
   เสียงพูดบอกตรง ๆ ไม่ต้องจำและไม่ต้องมองจอ

   เส้นที่ห้ามข้าม:
   [1] เป็นของ "เพิ่ม" ไม่ใช่ "แทนที่" — เสียงติ๊ดทั้งห้าแบบต้องยังดังครบเหมือนเดิม
   [2] คำพูดต้องตรงกับผลการยิงทั้งห้ากรณี ไม่สลับกัน
   [3] ยิงรัวต้องพูดเฉพาะคำล่าสุด (cancel ก่อน speak) ไม่งั้นเสียงตามหลังของจริง
       แล้วคนฟังเข้าใจผิดว่าชิ้นที่เพิ่งยิงผิดสาขา ทั้งที่เป็นเสียงของชิ้นก่อน
   [4] ปิดเสียงพูดแล้วต้องเงียบจริง แต่เสียงติ๊ดยังทำงาน
   [5] เครื่องที่ไม่มี speechSynthesis ต้องยิงได้ปกติ ห้ามพังทั้งหน้า
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
    window.__toasts = [];
    window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
    window.enqueueWrite = function () {};
    window.db.update = function () { return Promise.resolve(); };
    window.db.newKey = (function () { let n = 0; return function () { return 'g' + (++n); }; })();
    hideLogin();

    /* ดัก speechSynthesis ทั้งก้อน — เป็น getter อ่านอย่างเดียวบน window จึงต้อง defineProperty
       จับทั้ง speak และ cancel เพราะลำดับของสองตัวนี้คือหัวใจของกติกา "พูดเฉพาะคำล่าสุด" */
    window.__spoken = [];
    window.__calls = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: function () { return []; },
        cancel: function () { window.__calls.push('cancel'); },
        speak: function (u) {
          window.__calls.push('speak');
          window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate, volume: u.volume });
        }
      }
    });

    /* นับเสียงติ๊ดแยกจากเสียงพูด — ข้อ [1] ต้องพิสูจน์ว่าทั้งสองอย่างดังคู่กัน ไม่ใช่แทนกัน */
    window.__beeps = [];
    window.beep = function (f, ms, t) { window.__beeps.push('beep:' + f + ':' + (t || '')); };
    window.beepNewCode = function () { window.__beeps.push('newcode'); };
    window.beepSpecial = function () { window.__beeps.push('special'); };
    window.beepForeign = function () { window.__beeps.push('foreign'); };
    window.vibrate = function () {};

    window.__seed = function (opts) {
      opts = opts || {};
      state.me = { uid: 'u1', name: 'สมชาย', role: 'counter', branches: [] };
      state.counter = 'สมชาย';
      state.roundId = 'R1'; state.cycleId = 'C1';
      state.roundIndex = { R1: { id: 'R1', branchCode: 'B1', jobCode: 'J1', cycleId: 'C1',
                                 status: opts.status || 'counting', createdAt: 1 } };
      state.products = {
        A1: { code: 'A1', name: 'สินค้า A', category: 'ห', type: 'product', costPrice: 10 },
        F9: { code: 'F9', name: 'ของสาขาอื่น', category: 'ห', type: 'product', costPrice: 10 },
        SP: { code: 'SP', name: 'ของพิเศษ', category: 'ห', type: 'product', costPrice: 10,
              status: 'ระงับการขาย' }
      };
      /* F9 จงใจไม่มีใน systemQty = รู้จักแต่ไม่ใช่ของสาขานี้ */
      state.systemQty = { A1: 10, SP: 5 };
      state.counts = {}; state.scanQty = {}; state.manualQty = {};
      state.zones = {}; state.zoneTotals = {}; state.transfers = {}; state.transferQty = {};
      state.locations = { offline: {}, online: {} }; state.locationSet = 'offline';
      state.unknown = {}; state.unknownKeys = {}; state.scanLog = []; state.manualLog = [];
      state.undoStack = []; state.appliedScanIds = Object.create(null);
      state.cycleData = null; state.page = 'scan';
      buildScanIndex();
      try { localStorage.removeItem('isrd_voice'); } catch (e) {}
      window.__spoken = []; window.__calls = []; window.__beeps = []; window.__toasts = [];
      syncVoiceBtn();
    };
  });

  /* ---------- [1] คำพูดตรงกับผลการยิงทั้ง 5 กรณี ---------- */
  console.log('\n[1] ⭐ คำพูดต้องตรงกับผลการยิงทั้ง 5 กรณี');
  const CASES = [
    ['A1',      {},                  'ยิงแล้ว',        'beep:1180:square'],
    ['F9',      {},                  'ผิดสาขา',        'foreign'],
    ['SP',      {},                  'สินค้าพิเศษ',     'special'],
    ['9999999', {},                  'บาร์โค้ดแปลก',    'newcode'],
    ['A1',      { status: 'closed' }, 'ยิงไม่ได้',      'beep:180:sawtooth']
  ];
  for (const c of CASES) {
    const r = await page.evaluate((code, opts) => {
      window.__seed(opts);
      handleScanValue(code);
      return { spoken: window.__spoken.map(function (s) { return s.text; }),
               beeps: window.__beeps, one: window.__spoken[0] || {} };
    }, c[0], c[1]);
    check('ยิง ' + c[0] + ' → พูดว่า "' + c[2] + '"', r.spoken.join(',') === c[2], r.spoken);
    check('ยิง ' + c[0] + ' → เสียงติ๊ดเดิมยังดัง (' + c[3] + ')',
          r.beeps.indexOf(c[3]) >= 0, r.beeps);
    check('ยิง ' + c[0] + ' → พูดภาษาไทย (th-TH)', r.one.lang === 'th-TH', r.one);
  }

  console.log('\n[1b] เสียงติ๊ดต้องครบทั้ง 5 แบบ ไม่ถูกแทนที่');
  const beepsAll = await page.evaluate(() => {
    const seen = [];
    [['A1', {}], ['F9', {}], ['SP', {}], ['777777', {}], ['A1', { status: 'closed' }]]
      .forEach(function (c) {
        window.__seed(c[1]);
        handleScanValue(c[0]);
        seen.push(window.__beeps.join('+'));
      });
    return seen;
  });
  check('ครบทั้ง 5 เสียง ไม่มีอันไหนหาย',
        beepsAll.join('|') === 'beep:1180:square|foreign|special|newcode|beep:180:sawtooth',
        beepsAll);

  /* ---------- [2] ยิงรัว = พูดเฉพาะคำล่าสุด ---------- */
  console.log('\n[2] ⭐ ยิงรัว — ต้อง cancel ก่อน speak ทุกครั้ง');
  const rapid = await page.evaluate(() => {
    window.__seed();
    handleScanValue('A1');
    handleScanValue('F9');
    handleScanValue('A1');
    return { calls: window.__calls, spoken: window.__spoken.map(function (s) { return s.text; }) };
  });
  check('ทุกครั้งที่พูด มี cancel นำหน้าเสมอ',
        rapid.calls.join(',') === 'cancel,speak,cancel,speak,cancel,speak', rapid.calls);
  check('ลำดับคำพูดตรงกับลำดับที่ยิง',
        rapid.spoken.join(',') === 'ยิงแล้ว,ผิดสาขา,ยิงแล้ว', rapid.spoken);

  /* ---------- [3] ปุ่มเปิด/ปิด ---------- */
  console.log('\n[3] ปุ่มเปิด/ปิดเสียงพูด');
  const tog = await page.evaluate(() => {
    window.__seed();
    const btn = document.getElementById('btnVoice');
    const out = { start: btn.textContent, startOn: voiceEnabled(),
                  pressedStart: btn.getAttribute('aria-pressed') };
    btn.onclick();
    out.afterOff = { label: btn.textContent, on: voiceEnabled(),
                     stored: localStorage.getItem('isrd_voice'),
                     pressed: btn.getAttribute('aria-pressed'),
                     toast: (window.__toasts[0] || {}).m };
    window.__spoken = []; window.__beeps = [];
    handleScanValue('A1');
    out.mutedSpoken = window.__spoken.length;
    out.mutedBeeps = window.__beeps.length;

    window.__toasts = [];
    btn.onclick();
    out.afterOn = { label: btn.textContent, on: voiceEnabled(),
                    stored: localStorage.getItem('isrd_voice'),
                    pressed: btn.getAttribute('aria-pressed'),
                    spoken: window.__spoken.map(function (s) { return s.text; }) };
    window.__spoken = [];
    handleScanValue('A1');
    out.backSpoken = window.__spoken.map(function (s) { return s.text; });
    return out;
  });
  check('ค่าเริ่มต้นเปิดอยู่', tog.startOn === true && /เปิด/.test(tog.start), tog);
  check('ปุ่มบอกสถานะด้วย aria-pressed', tog.pressedStart === 'true', tog);
  check('กดแล้วปิด + ป้ายเปลี่ยน', tog.afterOff.on === false && /ปิด/.test(tog.afterOff.label),
        tog.afterOff);
  check('จำไว้ที่ localStorage เป็น off', tog.afterOff.stored === 'off', tog.afterOff);
  check('aria-pressed ตามไปด้วย', tog.afterOff.pressed === 'false', tog.afterOff);
  check('⭐ ปิดแล้วเงียบจริง', tog.mutedSpoken === 0, tog.mutedSpoken);
  check('⭐ แต่เสียงติ๊ดยังดังเหมือนเดิม', tog.mutedBeeps > 0, tog.mutedBeeps);
  check('บอกผู้ใช้ว่าเสียงติ๊ดยังทำงาน', /เสียงติ๊ดยังทำงาน/.test(tog.afterOff.toast || ''),
        tog.afterOff.toast);
  check('กดกลับแล้วเปิด', tog.afterOn.on === true && /เปิด/.test(tog.afterOn.label), tog.afterOn);
  check('เปิด = ลบคีย์ทิ้ง ไม่เก็บค่า on ไว้', tog.afterOn.stored === null, tog.afterOn);
  /* กดปุ่มเป็น user gesture จึงเป็นจังหวะปลดล็อกเสียงด้วย ("  " เงียบ ๆ นำมาก่อน)
     คำยืนยันต้องเป็นคำสุดท้ายที่พูด ไม่งั้นคนกดจะไม่ได้ยินอะไรเลยแล้วนึกว่าปุ่มเสีย */
  check('กดเปิดแล้วพูดยืนยันให้ได้ยินทันที',
        tog.afterOn.spoken[tog.afterOn.spoken.length - 1] === 'เปิดเสียงพูดแล้ว', tog.afterOn);
  check('เปิดกลับแล้วพูดได้ตามปกติ', tog.backSpoken.join(',') === 'ยิงแล้ว', tog.backSpoken);

  console.log('\n[3b] สถานะปุ่มต้องตรงกับค่าที่จำไว้ตอนโหลดหน้า');
  const persist = await page.evaluate(() => {
    localStorage.setItem('isrd_voice', 'off');
    syncVoiceBtn();
    const off = { label: document.getElementById('btnVoice').textContent, on: voiceEnabled() };
    localStorage.removeItem('isrd_voice');
    syncVoiceBtn();
    const on = { label: document.getElementById('btnVoice').textContent, on: voiceEnabled() };
    return { off: off, on: on };
  });
  check('จำค่าปิดไว้ → ปุ่มขึ้นปิด', persist.off.on === false && /ปิด/.test(persist.off.label),
        persist.off);
  check('ไม่มีคีย์ → ปุ่มขึ้นเปิด', persist.on.on === true && /เปิด/.test(persist.on.label),
        persist.on);

  /* ---------- [4] warm-up สำหรับ iOS ---------- */
  console.log('\n[4] warm-up — iOS ต้องปลดล็อกด้วย user gesture ก่อน');
  const warm = await page.evaluate(() => {
    window.__seed();
    ttsWarmed = false;
    window.__spoken = [];
    document.getElementById('scanInput').dispatchEvent(new Event('focus'));
    const first = { spoken: window.__spoken.slice(), warmed: ttsWarmed };
    document.getElementById('scanInput').dispatchEvent(new Event('focus'));
    return { first: first, afterTwice: window.__spoken.length };
  });
  check('แตะช่องยิงแล้วปลดล็อกเสียงให้เลย', warm.first.warmed === true, warm.first);
  check('เสียงปลดล็อกเงียบสนิท (volume 0)',
        warm.first.spoken.length === 1 && warm.first.spoken[0].volume === 0, warm.first.spoken);
  check('ปลดล็อกครั้งเดียวพอ ไม่ยิงซ้ำทุกครั้งที่โฟกัส', warm.afterTwice === 1, warm.afterTwice);

  const warmSrc = require('fs').readFileSync(require('./_env').APP_FILE, 'utf8');
  check('ผูก warmVoice กับทั้ง focus และ keydown ของช่องยิง',
        /scanInput\.addEventListener\('focus', warmVoice\)/.test(warmSrc) &&
        /scanInput\.addEventListener\('keydown', warmVoice\)/.test(warmSrc), 'warm binding');

  /* ---------- [5] เครื่องที่ไม่มีเสียงพูด ---------- */
  console.log('\n[5] ⭐ เครื่องที่ไม่รองรับ ต้องยิงได้ปกติ');
  const noTts = await page.evaluate(() => {
    window.__seed();
    const real = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
    delete window.speechSynthesis;
    let threw = null;
    try { handleScanValue('A1'); } catch (e) { threw = String(e); }
    const out = { threw: threw, counts: state.counts.A1, beeps: window.__beeps.length };
    Object.defineProperty(window, 'speechSynthesis', real);
    return out;
  });
  check('ไม่โยน error', noTts.threw === null, noTts);
  check('ยอดยังถูกบันทึกตามปกติ', noTts.counts === 1, noTts);
  check('เสียงติ๊ดยังดัง', noTts.beeps > 0, noTts);

  /* ---------- [6] ไม่ไปแตะของเดิม ---------- */
  console.log('\n[6] ของเดิมต้องไม่หาย');
  check('beep 5 ตัวยังอยู่ครบในซอร์ส',
        /function beep\(/.test(warmSrc) && /function beepNewCode\(/.test(warmSrc) &&
        /function beepSpecial\(/.test(warmSrc) && /function beepForeign\(/.test(warmSrc) &&
        /function vibrate\(/.test(warmSrc), 'beeps');
  check('ไม่ได้โหลดไลบรารีหรือไฟล์เสียงเพิ่ม (ยังเป็นไฟล์เดียว)',
        !/<script[^>]+src=/i.test(warmSrc) && !/<audio/i.test(warmSrc), 'single file');
  check('ปุ่มเสียงพูดอยู่แถวเดียวกับปุ่มควบคุมอื่น',
        /id="btnKeyboard"[\s\S]{0,200}id="btnVoice"/.test(warmSrc), 'button row');

  console.log('\n--- console/page errors ---');
  check('ไม่มี error ในคอนโซล', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
