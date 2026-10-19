/* ============================================================
   v2.29.0 — cache Master (products) ด้วย IndexedDB
   ============================================================
   กติกาที่ต้องได้:
     [1] ไม่มีสำเนา (cache miss)        = ดึงสด 1 ครั้ง + เขียนสำเนาลงเครื่อง
     [2] สำเนาสด (<10 นาที)            = ใช้สำเนาทันที ไม่ดึงสด (ประหยัดโควตา 7.6MB)
     [3] สำเนาเก่า (>10 นาที)          = ดึงสดใหม่
     [4] refreshProducts               = อัปเดตสำเนาในเครื่องเสมอ
     [5] forceRefreshMaster debounce   = เรียกซ้ำใน 15 วิ ไม่ดึงซ้ำ (กันยิงรัว)
     [6] forceRefreshMaster('manual')  = ข้าม debounce ดึงสดทันที (ปุ่มโหลดใหม่)
   ใช้ IndexedDB จริงของ headless Chrome — ไม่ mock ชั้นเก็บ
   ============================================================ */

const { puppeteer, CHROME, APP_URL, forceLive } = require('./_env');

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

  await forceLive(page);
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  const r = await page.evaluate(async () => {
    const out = {};
    function clearIdb() {
      return new Promise(function (res) {
        try { var d = indexedDB.deleteDatabase('isrd_cache'); d.onsuccess = d.onerror = d.onblocked = function () { res(); }; }
        catch (e) { res(); }
      });
    }
    var SAMPLE = { SKU1: { code: 'SKU1', barcode: 'BC1', name: 'สินค้า A', type: 'product' } };
    window.__get = 0;
    window.db.get = function (p) {
      if (p === 'products') { window.__get++; return Promise.resolve(SAMPLE); }
      return Promise.resolve({});
    };

    /* [1] cache miss → ดึงสด 1 ครั้ง + เขียนสำเนา */
    await clearIdb(); state.products = {}; window.__get = 0;
    await cacheFirstProducts();
    out.missFetch = (window.__get === 1 && !!state.products.SKU1);
    var c1 = await idbGet('products');
    out.missCached = !!(c1 && c1.data && c1.data.SKU1 && c1.at);

    /* [2] สำเนาสด → ไม่ดึง ใช้สำเนา */
    await clearIdb();
    await idbSet('products', { data: { SKU9: { code: 'SKU9', barcode: 'B9', name: 'Z' } }, at: Date.now() });
    state.products = {}; window.__get = 0;
    await cacheFirstProducts();
    out.freshNoFetch = (window.__get === 0 && !!state.products.SKU9);

    /* [3] สำเนาเก่า >10 นาที → ดึงสด */
    await clearIdb();
    await idbSet('products', { data: { SKU9: { code: 'SKU9' } }, at: Date.now() - 11 * 60 * 1000 });
    state.products = {}; window.__get = 0;
    await cacheFirstProducts();
    out.staleFetch = (window.__get === 1);

    /* [4] refreshProducts เขียนสำเนาเสมอ */
    await clearIdb(); window.__get = 0;
    await refreshProducts();
    await new Promise(function (r) { setTimeout(r, 150); });   // cacheProducts() เขียนแบบ fire-and-forget
    var c4 = await idbGet('products');
    out.refreshCaches = !!(c4 && c4.data && c4.data.SKU1);

    /* [5] forceRefreshMaster debounce (เรียกซ้ำใน 15 วิ ไม่ดึงซ้ำ) */
    masterSyncAt = 0; masterSyncing = false; window.__get = 0;
    await forceRefreshMaster('unknown-scan');
    var g1 = window.__get;
    await forceRefreshMaster('unknown-scan');
    var g2 = window.__get;
    out.debounce = (g1 === 1 && g2 === 1);

    /* [6] manual ข้าม debounce */
    window.__get = 0;
    await forceRefreshMaster('manual');
    out.manualBypass = (window.__get === 1);

    /* [7] แยกผล ok / debounced / failed (กันข้อความหลอกตอนเน็ตหลุด) */
    masterSyncAt = 0; masterSyncing = false;
    var resOk = await forceRefreshMaster('card-reload', 0);           // โหลดสำเร็จ
    out.resOk = (resOk === 'ok');
    var resDeb = await forceRefreshMaster('card-reload', 60000);      // ติดเพดาน 60 วิ
    out.resDebounced = (resDeb === 'debounced');
    window.db.get = function (p) { if (p === 'products') return Promise.reject(new Error('net')); return Promise.resolve({}); };
    masterSyncAt = 0; masterSyncing = false;
    var resFail = await forceRefreshMaster('card-reload', 0);         // db.get พัง (เน็ตหลุด)
    out.resFailed = (resFail === 'failed');

    return out;
  });

  check('[1] cache miss: ดึงสด 1 ครั้ง', r.missFetch, r);
  check('[1] cache miss: เขียนสำเนาลงเครื่อง', r.missCached, r);
  check('[2] สำเนาสด: ไม่ดึง ใช้สำเนา (ประหยัด 7.6MB)', r.freshNoFetch, r);
  check('[3] สำเนาเก่า >10 นาที: ดึงสด', r.staleFetch, r);
  check('[4] refreshProducts: อัปเดตสำเนาเสมอ', r.refreshCaches, r);
  check('[5] forceRefreshMaster: debounce กันยิงรัว', r.debounce, r);
  check('[6] forceRefreshMaster(manual): ข้าม debounce', r.manualBypass, r);
  check('[7] ผลลัพธ์ ok (โหลดสำเร็จ)', r.resOk, r);
  check('[7] ผลลัพธ์ debounced (ติดเพดาน)', r.resDebounced, r);
  check('[7] ผลลัพธ์ failed (เน็ตหลุด) แยกจาก debounced', r.resFailed, r);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
