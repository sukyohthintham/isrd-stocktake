/* ============================================================
   v2.30.0 — คอลัมน์ "โซนสาขา" (foundZone) ในตาราง "ยิงไปแล้วในรอบนี้"
   ============================================================
   กติกาที่ต้องได้:
     [1] header ตารางมีคอลัมน์ "โซนสาขา" และอยู่ถัดจาก Location
     [2] header รวม 7 คอลัมน์ (เดิม 6)
     [3] แถวที่ record มี foundZone → โชว์โซน (ตัวพิมพ์ใหญ่)
     [4] แถวที่ไม่มี foundZone (งาน WH ปกติ) → โชว์ "-" ไม่พัง
     [5] คอลัมน์ +/- และ ผู้ยิง ยังอยู่ตำแหน่งถูกหลังแทรกคอลัมน์
   เป็นชั้นแสดงผลล้วน — ไม่แตะ writeScan / schema / การยิง
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

  const r = await page.evaluate(async () => {
    const out = {};
    state.products = {
      'A1': { code: 'A1', name: 'สินค้า A', barcode: 'BCA' },
      'B2': { code: 'B2', name: 'สินค้า B', barcode: 'BCB' }
    };
    state.counts = {};
    state.systemQty = state.systemQty || {};
    /* scanLog: ตัวแรก(เก่า) มีโซน da-3 · ตัวสอง(ใหม่) ไม่มีโซน (งาน WH) */
    state.scanLog = [
      { rec: { ts: Date.now() - 1000, code: 'A1', delta: 1, user: 'Tonliw', foundZone: 'da-3' } },
      { rec: { ts: Date.now(), code: 'B2', delta: 1, user: 'Khao' } }
    ];

    /* ทำให้ตาราง live มองเห็น (renderLivePanel return ทันทีถ้า offsetParent === null) */
    var el = document.getElementById('liveBody');
    out.hasLiveBody = !!el;
    for (var n = el; n && n !== document.body; n = n.parentElement) n.style.display = 'block';
    document.body.style.display = 'block';
    out.visible = el.offsetParent !== null;

    var ths = document.querySelectorAll('#liveTable thead th');
    out.headers = Array.prototype.map.call(ths, function (t) { return t.textContent; });

    renderLivePanel();

    var rows = document.querySelectorAll('#liveBody tr');
    out.rowCount = rows.length;
    /* reverse → row0 = B2(ใหม่,ไม่มีโซน) · row1 = A1(เก่า,โซน da-3) */
    out.r0 = Array.prototype.map.call(rows[0].querySelectorAll('td'), function (td) { return td.textContent; });
    out.r1 = Array.prototype.map.call(rows[1].querySelectorAll('td'), function (td) { return td.textContent; });
    return out;
  });

  check('[0] liveBody มีจริง', r.hasLiveBody, r);
  check('[0] ทำให้มองเห็นได้ (offsetParent)', r.visible, r);
  check('[1] header มีคอลัมน์ "โซนสาขา"', r.headers && r.headers.indexOf('โซนสาขา') >= 0, r.headers);
  check('[1] "โซนสาขา" อยู่ถัดจาก Location', r.headers && r.headers.indexOf('โซนสาขา') === r.headers.indexOf('Location') + 1, r.headers);
  check('[2] header รวม 7 คอลัมน์', r.headers && r.headers.length === 7, r.headers);
  check('[-] render ได้ 2 แถว', r.rowCount === 2, r);
  check('[4] แถวไม่มีโซน → col โซนสาขา = "-"', r.r0 && r.r0[4] === '-', r.r0);
  check('[3] แถวมีโซน → col โซนสาขา = "DA-3" (พิมพ์ใหญ่)', r.r1 && r.r1[4] === 'DA-3', r.r1);
  check('[5] คอลัมน์ +/- ยังถูกตำแหน่ง (index 5) = "+1"', r.r1 && r.r1[5] === '+1', r.r1);
  check('[5] คอลัมน์ ผู้ยิง ยังถูกตำแหน่ง (index 6) = "Khao"', r.r0 && r.r0[6] === 'Khao', r.r0);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
