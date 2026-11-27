/* ============================================================
   v2.52.4 — ยิงบาร์โค้ดตอนแป้นค้างภาษาไทย (Kedmanee) + กู้คืน/ลบทั้งหมด
   ============================================================
   เครื่องยิงเป็น keyboard wedge: Windows ค้างแป้นไทย = ตัวอักษร ASCII ในบาร์โค้ด
   กลายเป็นตัวไทยตามตำแหน่งปุ่ม

   ทำไมไม่แปลงไทย→อังกฤษทีละตัว: สระ/เครื่องหมายซ้อน (ฺ ุ ่ ฯลฯ) ถูก Unicode
   จัดลำดับใหม่ได้ทุกครั้งที่ข้อความถูก normalize (ฺ ccc=9 ไปก่อน ุ ccc=103)
   เคสจริง: SOOV0086BN00FF กดปุ่ม 8,6,B,N = ค ุ ฺ ์ แต่ค่าที่ได้จากข้อมูลจริงเป็น ค ฺ ุ ์
   แปลงทีละตัวได้ SOOV008B6N00FF (ผิด) — จึงแปลงรหัส Master → ไทย แล้วเทียบหลัง NFC ทั้งสองฝั่ง

   กติกาที่ต้องได้:
     [1] resolveThaiScan(ค่าไทยจริง) → key ของ SOOV0086BN00FF
     [1b] ค่าไทยลำดับตามปุ่มเป๊ะ → key เดียวกัน (ทนทั้งสองลำดับ)
     [2] normThai(enToThai(code)) === normThai(ค่าไทยจริง)
     [3] ผูก altBarcode แล้ว → thaiRecoverList ข้าม (กันนับซ้ำ)
     [3b] ลบทิ้ง→ยิงซ้ำ→ผูก (มี discardedQty ค้าง) → ข้าม (คุม guard scanIndex)
     [4] สร้างเป็นสินค้าแล้ว (products[key]) → ข้าม
     [5] pending: counts=2 → q=2 cur=2 · กู้แล้ว SKU จริง +2 ตัวขยะ -2
     [6] เผลอลบไปแล้ว: counts=0 discardedQty=3 → q=3 cur=0 · SKU จริง +3 ไม่หักซ้ำ
     [7] ยิง 3 undo 1 (undo ไม่ติดธง unknown): counts=2 u.qty=3 → q=2 ไม่ใช่ 3
     [8] recovered=true แล้ว → ข้าม · กดกู้คืนรอบสอง → ยอดไม่ขยับ
     [9] ตัวไทยที่ไม่ตรง Master → handleScanValue บล็อก ไม่เขียนอะไร
     [10] ตัวไทยที่ตรง Master → handleScanValue นับเข้า SKU จริงทันที
     [11] buildScanIndex ล้าง thaiIndex (Master เปลี่ยน → ดัชนีไทยสร้างใหม่)
     [12] โหลดแอปไม่มี error
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

/* ค่าไทยจากข้อมูลจริง (ฆฯฯฮจจคฺุ์จจโโ) — เก็บเป็น code point ตามที่ได้รับ ห้ามพิมพ์ใหม่ */
const REAL = 'ฆฯฯฮจจคฺุ์จจโโ';
/* ลำดับตามการกดปุ่มจริง S O O V 0 0 8 6 B N 0 0 F F (ุ ก่อน ฺ) */
const KEYED = 'ฆฯฯฮจจคฺุ์จจโโ';

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

  const r = await page.evaluate(async (REAL, KEYED) => {
    const out = {};
    const tick = () => new Promise(res => setTimeout(res, 50));

    window.__writes = [];
    window.enqueueWrite = function (p, patch) { window.__writes.push({ p: p, patch: patch }); };
    window.db.update = function () { return Promise.resolve(); };
    window.ask = function () { return Promise.resolve(true); };
    state.me = { uid: 'u1', name: 'แอดมิน', role: 'admin', branches: [] };
    state.roundIndex = state.roundIndex || {};
    state.roundIndex.__t = { jobCode: 'TEST-TH-01', status: 'counting', storeType: 'STOCKASSET', branch: 'WHS-15' };
    state.roundId = '__t';

    /* Master จริง: key = safeKey(code) · state.counts อิง safeKey(rec.code) */
    function resetMaster(extra) {
      state.products = {
        SOOV0086BN00FF: { code: 'SOOV0086BN00FF', name: 'สินค้า A' },
        ABC123: { code: 'ABC123', name: 'สินค้า B' }
      };
      if (extra) Object.keys(extra).forEach(function (k) { state.products[k] = extra[k]; });
      state.counts = {}; state.unknownKeys = {}; state.appliedScanIds = {};
      state.scanIndex = null; state.thaiIndex = null;
      buildScanIndex();
    }
    function unk(value, delta, ex) {
      var e = { unknown: true, raw: value };
      if (ex) Object.keys(ex).forEach(function (k) { e[k] = ex[k]; });
      return writeScan(safeKey(value), delta, delta > 0 ? 'scan' : 'resolve', null, e);
    }
    const thB = enToThai('ABC123');
    const kA = safeKey(REAL), kB = safeKey(thB);
    const listOf = () => thaiRecoverList().map(x => ({ rk: x.realKey, cur: x.cur, q: x.q }));

    /* [1][1b][2] — ใช้ seed ตามบรีฟ: products[kreal] + scanIndex แบบ Map ตรง ๆ */
    state.products = { kreal: { code: 'SOOV0086BN00FF' } };
    state.scanIndex = new Map([['SOOV0086BN00FF', 'kreal']]);
    state.thaiIndex = null;
    out.r1 = resolveThaiScan(REAL);
    out.r1b = resolveThaiScan(KEYED);
    out.r2 = normThai(enToThai('SOOV0086BN00FF')) === normThai(REAL);
    out.r2raw = enToThai('SOOV0086BN00FF') === REAL;   // ลำดับดิบต่างกันจริง (พิสูจน์ว่าเคสนี้ต้องพึ่ง normalize)

    /* [11] buildScanIndex ล้าง thaiIndex */
    resetMaster();
    ensureThaiIndex();
    const hadIdx = !!state.thaiIndex;
    buildScanIndex();
    out.r11 = hadIdx && state.thaiIndex === null;

    /* [3] ผูก altBarcode: ยิงไทย 2 → ผูก (ย้ายยอดแบบเดิม) → scanIndex รู้จักค่าไทยแล้ว */
    resetMaster();
    unk(thB, 1); unk(thB, 1);
    unk(thB, -2); writeScan('ABC123', 2, 'resolve', 'ย้ายมาจากบาร์โค้ด ' + thB);
    state.scanIndex.set(thB.toUpperCase(), 'ABC123');
    out.r3 = { list: listOf(), kb: state.counts.ABC123 };
    recoverThaiUnknowns(); await tick();
    out.r3.kbAfter = state.counts.ABC123;

    /* [3b] ลบทิ้งไป 3 → ยิงซ้ำ 2 → ผูก: ค่าไทยนี้จัดการด้วยการผูกแล้ว ห้ามเอา discardedQty มากู้อีก
       (ไม่มี guard ผูก = q=3 โผล่มาให้กด → ยอดจริงเกิน) */
    resetMaster();
    unk(thB, 1); unk(thB, 1); unk(thB, 1); unk(thB, -3, { discard: true });
    unk(thB, 1); unk(thB, 1); unk(thB, -2); writeScan('ABC123', 2, 'resolve', 'ย้ายมาจากบาร์โค้ด ' + thB);
    state.scanIndex.set(thB.toUpperCase(), 'ABC123');
    out.r3b = { list: listOf(), disc: (state.unknownKeys[kB] || {}).discardedQty };

    /* [4] สร้างเป็นสินค้าใหม่แล้ว → products[key] มี */
    resetMaster();
    unk(thB, 1);
    state.products[kB] = { code: thB, name: 'สร้างจากบาร์โค้ด' };
    out.r4 = listOf();

    /* [5] pending: ยิงไทย 2 */
    resetMaster();
    unk(REAL, 1); unk(REAL, 1);
    out.r5 = { list: listOf() };
    recoverThaiUnknowns(); await tick();
    out.r5.real = state.counts.SOOV0086BN00FF || 0; out.r5.junk = state.counts[kA] || 0;

    /* [6] เผลอลบไปแล้ว: ยิง 3 → ลบทิ้ง (discard -3) */
    resetMaster();
    unk(thB, 1); unk(thB, 1); unk(thB, 1);
    unk(thB, -3, { discard: true });
    const uB = state.unknownKeys[kB] || {};
    out.r6 = { list: listOf(), disc: uB.discardedQty, row: (unknownRows(true).find(u => u.key === kB) || {}).discardedQty };
    recoverThaiUnknowns(); await tick();
    out.r6.real = state.counts.ABC123 || 0; out.r6.junk = state.counts[kB] || 0;

    /* [7] ยิง 3 undo 1 — undoLastScan เขียน -1 ที่ key เดิมโดยไม่ติดธง unknown */
    resetMaster();
    unk(REAL, 1); unk(REAL, 1); unk(REAL, 1);
    writeScan(kA, -1, 'scan', 'ยกเลิกการยิงล่าสุด');
    out.r7 = { uqty: (state.unknownKeys[kA] || {}).qty, cnt: state.counts[kA], list: listOf() };
    recoverThaiUnknowns(); await tick();
    out.r7.real = state.counts.SOOV0086BN00FF || 0; out.r7.junk = state.counts[kA] || 0;

    /* [8] recovered แล้ว → ข้าม + กดซ้ำไม่ขยับ (ต่อจาก [7]) */
    out.r8 = { list: listOf(), resolved: unknownResolved(state.unknownKeys[kA]) };
    recoverThaiUnknowns(); await tick();
    out.r8.real = state.counts.SOOV0086BN00FF || 0;

    /* [9] ตัวไทยไม่ตรง Master → บล็อก */
    resetMaster();
    const miss = enToThai('ZZZ999');
    let before = window.__writes.length;
    try { handleScanValue(miss); } catch (e) { out.err9 = String(e); }
    out.r9 = { writes: window.__writes.length - before, unknown: !!state.unknownKeys[safeKey(miss)] };

    /* [10] ตัวไทยตรง Master (ลำดับจากข้อมูลจริง) → นับเข้า SKU จริง */
    before = window.__writes.length;
    try { handleScanValue(REAL); } catch (e) { out.err10 = String(e); }
    out.r10 = { writes: window.__writes.length - before, real: state.counts.SOOV0086BN00FF || 0, unknown: !!state.unknownKeys[kA] };
    return out;
  }, REAL, KEYED);

  check('[1] resolveThaiScan(ค่าไทยจริง) → kreal', r.r1 === 'kreal', r.r1);
  check('[1b] ค่าไทยลำดับตามปุ่ม → kreal', r.r1b === 'kreal', r.r1b);
  check('[2] normThai(enToThai(code)) === normThai(ค่าจริง) (ลำดับดิบต่างกัน)', r.r2 === true && r.r2raw === false, { r2: r.r2, raw: r.r2raw });
  check('[3] ผูก altBarcode แล้ว → ข้าม ยอดไม่เพิ่มซ้ำ', r.r3.list.length === 0 && r.r3.kb === 2 && r.r3.kbAfter === 2, r.r3);
  check('[3b] ลบ→ยิงซ้ำ→ผูก (discardedQty=3) → ข้าม', r.r3b.disc === 3 && r.r3b.list.length === 0, r.r3b);
  check('[4] สร้างเป็นสินค้าแล้ว → ข้าม', r.r4.length === 0, r.r4);
  check('[5] pending: q=2 cur=2 · SKU จริง +2 ตัวขยะ 0',
    r.r5.list.length === 1 && r.r5.list[0].rk === 'SOOV0086BN00FF' && r.r5.list[0].q === 2 && r.r5.list[0].cur === 2 && r.r5.real === 2 && r.r5.junk === 0, r.r5);
  check('[6] เผลอลบ: discardedQty=3 q=3 cur=0 · SKU จริง +3 ไม่หักซ้ำ',
    r.r6.disc === 3 && r.r6.row === 3 && r.r6.list.length === 1 && r.r6.list[0].q === 3 && r.r6.list[0].cur === 0 && r.r6.real === 3 && r.r6.junk === 0, r.r6);
  check('[7] ยิง3 undo1: u.qty=3 counts=2 → q=2 · SKU จริง +2 ตัวขยะ 0',
    r.r7.uqty === 3 && r.r7.cnt === 2 && r.r7.list.length === 1 && r.r7.list[0].q === 2 && r.r7.real === 2 && r.r7.junk === 0, r.r7);
  check('[8] recovered แล้ว → ข้าม · กดซ้ำยอดไม่ขยับ', r.r8.list.length === 0 && r.r8.resolved === true && r.r8.real === 2, r.r8);
  check('[9] ไทยไม่ตรง Master → บล็อก ไม่เขียน', r.r9.writes === 0 && !r.r9.unknown && !r.err9, { r9: r.r9, err: r.err9 });
  check('[10] ไทยตรง Master → นับเข้า SKU จริง ไม่เป็น unknown', r.r10.writes === 1 && r.r10.real === 1 && !r.r10.unknown && !r.err10, { r10: r.r10, err: r.err10 });
  check('[11] buildScanIndex ล้าง thaiIndex', r.r11 === true, r.r11);
  check('[12] โหลดแอปไม่มี error', errors.length === 0, errors);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
