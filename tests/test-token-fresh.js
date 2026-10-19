/* ============================================================
   v2.28.0 — ต่ออายุ token เชิงรุก (session.ensureFresh)
   ============================================================
   ปัญหาเดิม: schedule() ต่ออายุ idToken ด้วย setTimeout ซึ่งเบราว์เซอร์
   แช่แข็งตอนล็อกจอ/สลับแอป → token หมดเงียบ ๆ → PATCH โดน 401 → คิวค้าง

   แก้: session.ensureFresh() ต่ออายุเชิงรุกก่อน "ใช้งานจริง"
   (เขียน remoteUpdate · ปลุกแท็บ online/visibility/focus/pageshow · รอบ flush 15 วิ)

   กติกาที่ต้องได้:
     [A] token ยังสด (เหลือ >5 นาที)  = คืนทันที ไม่ยิง securetoken
     [B] token ใกล้หมด (<5 นาที)/หมด  = ต่ออายุ 1 ครั้ง
     [C] เรียกพร้อมกันหลายที่           = ยิง securetoken ครั้งเดียว (single-flight กันพายุ refresh token)
     [D] ต่ออายุแล้ว token สดใหม่       = เรียกซ้ำไม่ยิงอีก
     [E] remoteUpdate (db.update)      = ต่ออายุก่อนเขียนถ้าใกล้หมด
     [F] ยังไม่ล็อกอิน                   = ไม่ยิง securetoken (กัน interval/flush ยิงก่อนมี session)
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

  await forceLive(page);                              // REMOTE_MODE = true (ไม่งั้น ensureFresh ลัดออกทันที)
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));

  const r = await page.evaluate(async () => {
    const out = {};

    /* mock fetch — ไม่ยิงเน็ตจริง · ดัก signin / securetoken(refresh) / firebasedatabase(PATCH) */
    window.__refreshCount = 0;
    window.__signinExp = 3600;                         // ปรับ expiresIn ของ signin ต่อเทส
    const realFetch = window.fetch;
    window.fetch = function (url) {
      url = String(url);
      if (url.indexOf('securetoken.googleapis.com') >= 0) {      // ต่ออายุ (refresh)
        window.__refreshCount++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          id_token: 'ID' + window.__refreshCount, refresh_token: 'RT' + window.__refreshCount,
          expires_in: '3600', user_id: 'u1'
        }) });
      }
      if (url.indexOf('identitytoolkit.googleapis.com') >= 0) {  // ล็อกอิน (signInWithPassword)
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          idToken: 'ID0', refreshToken: 'RT0', localId: 'u1', email: 'a@b.co',
          expiresIn: String(window.__signinExp)
        }) });
      }
      if (url.indexOf('firebasedatabase') >= 0) {               // PATCH/GET ฐาน — คืน 200 กัน hang
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return realFetch.apply(this, arguments);
    };

    async function login(exp) { window.__signinExp = exp; await session.signIn('a@b.co', 'x'); }

    /* [F] ก่อนล็อกอิน (refreshToken ว่าง) — ensureFresh ต้องไม่ยิง securetoken */
    window.__refreshCount = 0;
    await session.ensureFresh();
    out.preLoginNoRefresh = (window.__refreshCount === 0);

    /* [A] token สด (expiresIn 3600) → signIn ไม่เรียก refresh + ensureFresh ไม่ยิง */
    window.__refreshCount = 0;
    await login(3600);
    out.signInNoRefresh = (window.__refreshCount === 0);
    await session.ensureFresh();
    out.freshNoRefresh = (window.__refreshCount === 0);

    /* [B] token ใกล้หมด (expiresIn 60 < 5 นาที) → ensureFresh ต่ออายุ 1 ครั้ง */
    await login(60);
    window.__refreshCount = 0;
    await session.ensureFresh();
    out.nearExpiryRefresh1 = (window.__refreshCount === 1);

    /* [D] หลังต่ออายุ securetoken คืน expires_in 3600 → token สดใหม่ → เรียกซ้ำไม่ยิง */
    window.__refreshCount = 0;
    await session.ensureFresh();
    out.afterRefreshFresh = (window.__refreshCount === 0);

    /* [C] single-flight — ใกล้หมด เรียกพร้อมกัน 5 ที่ → ยิง securetoken ครั้งเดียว */
    await login(60);
    window.__refreshCount = 0;
    await Promise.all([0, 1, 2, 3, 4].map(function () { return session.ensureFresh(); }));
    out.singleFlight = (window.__refreshCount === 1);

    /* [E] remoteUpdate (db.update) ต่ออายุก่อนเขียนถ้าใกล้หมด */
    await login(60);
    window.__refreshCount = 0;
    try { await db.update('rounds/x', { 'k': 1 }); } catch (e) { out._updErr = String(e); }
    out.updateCallsEnsure = (window.__refreshCount >= 1);

    return out;
  });

  check('[F] ก่อนล็อกอิน: ไม่ยิง securetoken', r.preLoginNoRefresh, r);
  check('[A] signIn ไม่เรียก refresh', r.signInNoRefresh, r);
  check('[A] token สด: ensureFresh ไม่ยิง', r.freshNoRefresh, r);
  check('[B] ใกล้หมด(<5นาที): ต่ออายุ 1 ครั้ง', r.nearExpiryRefresh1, r);
  check('[D] หลังต่ออายุแล้วสด: ไม่ยิงซ้ำ', r.afterRefreshFresh, r);
  check('[C] single-flight เรียกพร้อม 5 = ยิงครั้งเดียว', r.singleFlight, r);
  check('[E] remoteUpdate ต่ออายุก่อนเขียน', r.updateCallsEnsure, r);

  if (errors.length) { console.log('  (console/page errors):'); errors.forEach(e => console.log('    ' + e)); }
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
