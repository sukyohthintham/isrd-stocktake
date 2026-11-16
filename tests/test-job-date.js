const { puppeteer, CHROME, APP_URL } = require('./_env');

/* ============================================================
   v2.47.4 — เลือกวันที่ตอนสร้าง Job ได้ (สร้างคืนนี้ ลงวันพรุ่งนี้)
   เช็คว่า:
   - มีช่อง #newJobDate และเปิดหน้า "สร้าง" แล้ว default เป็นวันนี้
   - jobPickedAt() อ่านวันที่ที่เลือกถูกต้อง (ว่าง = วันนี้)
   - วันที่ที่เลือกไหลเข้า makeJobCode (YYYYMMDD ค.ศ.) และ makeCycleId (พ.ศ.+เดือน)
   ============================================================ */

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

  /* ---------- 1. ช่องวันที่มีจริง + default วันนี้เมื่อเปิดหน้าสร้าง ---------- */
  console.log('\n[1] ช่อง #newJobDate + default วันนี้');
  const r1 = await page.evaluate(() => {
    const el0 = document.getElementById('newJobDate');
    const exists = !!el0;
    try { setJobView('create'); } catch (e) {}
    const el = document.getElementById('newJobDate');
    const t = new Date();
    const today = t.getFullYear() + '-' +
      String(t.getMonth() + 1).padStart(2, '0') + '-' +
      String(t.getDate()).padStart(2, '0');
    return { exists, type: el && el.type, defaulted: el && el.value === today, val: el && el.value, today };
  });
  check('มีช่อง #newJobDate', r1.exists, r1);
  check('ช่องเป็น type=date', r1.type === 'date', r1);
  check('เปิดหน้าสร้าง → default เป็นวันนี้', r1.defaulted, r1);

  /* ---------- 2. jobPickedAt() อ่านวันที่ที่เลือก ---------- */
  console.log('\n[2] jobPickedAt() อ่านวันที่ที่เลือก');
  const r2 = await page.evaluate(() => {
    const el = document.getElementById('newJobDate');
    el.value = '2026-01-15';
    const ms = jobPickedAt();
    const d = new Date(ms);
    return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
  });
  check('ปี 2026', r2.y === 2026, r2);
  check('เดือน มกราคม (0)', r2.m === 0, r2);
  check('วันที่ 15', r2.day === 15, r2);

  /* ---------- 3. วันที่เลือกไหลเข้า makeJobCode / makeCycleId ---------- */
  console.log('\n[3] วันที่เลือกไหลเข้ารหัส Job / รหัสรอบ');
  const r3 = await page.evaluate(() => {
    const at = jobPickedAt();
    const jc = makeJobCode('TST', at, 'STORE');
    const cy = makeCycleId('UBP01', at, 1);
    return { jc, cy };
  });
  check('jobCode ขึ้นต้นด้วยวันที่ที่เลือก (20260115)',
        r3.jc.indexOf('TST-STORE-20260115-') === 0, r3);
  check('cycleId เป็นเดือน พ.ศ.2569-01', r3.cy.indexOf('-256901-') >= 0, r3);

  /* ---------- 4. ช่องว่าง = วันนี้ (เข้ากันได้กับของเดิม) ---------- */
  console.log('\n[4] ช่องว่าง = วันนี้ (backward-compatible)');
  const r4 = await page.evaluate(() => {
    const el = document.getElementById('newJobDate');
    el.value = '';
    const ms = jobPickedAt();
    return { diff: Math.abs(Date.now() - ms) };
  });
  check('ช่องว่าง → jobPickedAt ≈ now', r4.diff < 5000, r4);

  /* ---------- 5. ขอบเขตวันที่ min=วันนี้ max=+7 (กันเลือกผิดเดือน/ย้อนหลัง) ---------- */
  console.log('\n[5] ขอบเขตวันที่ min/max');
  const r5 = await page.evaluate(() => {
    setJobView('create');
    const el = document.getElementById('newJobDate');
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const t = new Date(); const mx = new Date(); mx.setDate(mx.getDate() + 7);
    return { min: el.min, max: el.max, today: fmt(t), plus7: fmt(mx) };
  });
  check('min = วันนี้ (กันย้อนหลัง)', r5.min === r5.today, r5);
  check('max = วันนี้ +7 วัน', r5.max === r5.plus7, r5);

  console.log('\n[errors] ' + (errors.length ? errors.join('\n') : 'ไม่มี'));
  check('ไม่มี error บนหน้า', errors.length === 0, errors);

  console.log('\nสรุป: ผ่าน ' + pass + ' / ตก ' + fail);
  console.log('==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
