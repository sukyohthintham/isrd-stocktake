/* ============================================================
   สร้างผู้ใช้หลายคนพร้อมกัน (วางจาก Excel) — v2.26.0
   ============================================================

   กันอะไร (วัดด้วยการนับ db.update ต่อการสร้าง 1 คน ไม่ใช่เดา):
   [A] bulkResolveBranch — จับคู่สาขาได้ทั้งรหัสและชื่อ · ไม่พบ = null
   [B] bulkParseRows (ลำดับเดิม) — นับ ok/err · ข้ามหัว · จับอีเมลซ้ำ/ผิดรูป/ไม่มีสาขา
   [C] ⭐ writeUserRecord(...,branches) — role + สาขา ลงฐาน "ก้อนเดียว" (atomic)
   [D] เรียกแบบเดิม (ไม่ส่ง branches) ต้องไม่มีฟิลด์ branches — เพิ่มเดี่ยว/UID เท่าเดิม
   [E] bulkUserCreate เต็มเส้น: 2 คน → เขียน users พอดี 2 ครั้ง ทุกใบมี role+สาขาครบ
   [F] ⭐ อ่านจากหัวตาราง — เรียงคอลัมน์ยังไงก็ได้ (สาขาขึ้นก่อน) มีคอลัมน์เกิน (Zone) ข้ามให้
   [G] ⭐ หลายสาขาต่อคน — ช่องสาขาใส่ "LKB-01, RM9-02" ล็อกได้ทั้งคู่ในแถวเดียว
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: m, bad: bad }); };
  window.session.token = function () { return 'tok'; };
  hideLogin();
  window.renderUsers = function () {};

  window.__updates = [];
  window.db.update = function (path, patch) {
    window.__updates.push({ path: path, patch: JSON.parse(JSON.stringify(patch || {})) });
    return Promise.resolve();
  };

  var _n = 0;
  window.session.createUser = function (email, pass) {
    return Promise.resolve({ uid: 'new' + (++_n), email: email });
  };

  window.__seed = function () {
    state.me = { uid: 'admin1', name: 'แอดมิน', role: 'admin', branches: [] };
    state.counter = 'แอดมิน';
    state.users = {};
    state.branches = {
      'LKB-01': { code: 'LKB-01', name: 'สุวรรณภูมิ', active: true },
      'RM9-02': { code: 'RM9-02', name: 'โรบินสัน รัชดา', active: true },
      'NTV-01': { code: 'NTV-01', name: 'NTDS Central Northville FL.G', active: true },
      'NKP-01': { code: 'NKP-01', name: 'NTDS Central Nakhon Pathom FL.1', active: true },
      'SMS-01': { code: 'SMS-01', name: 'NTDS Siam Square', active: true }
    };
    window.__updates = []; window.__toasts = []; _n = 0;
  };

  window.__usersWrites = function () {
    return window.__updates.filter(function (u) { return u.path === 'users'; });
  };
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(APP_URL, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(HARNESS);

  /* ---------- [A] จับคู่สาขา ---------- */
  console.log('\n[A] bulkResolveBranch — รหัส/ชื่อ/ไม่พบ');
  const a = await page.evaluate(() => {
    window.__seed();
    return {
      byCode: bulkResolveBranch('LKB-01'),
      byCodeLower: bulkResolveBranch('lkb-01'),
      byName: bulkResolveBranch('โรบินสัน รัชดา'),
      bad: bulkResolveBranch('ZZZ')
    };
  });
  check('จับคู่ด้วยรหัสสาขา', a.byCode && a.byCode.code === 'LKB-01', a.byCode);
  check('รหัสพิมพ์เล็กก็เจอ', a.byCodeLower && a.byCodeLower.code === 'LKB-01', a.byCodeLower);
  check('จับคู่ด้วยชื่อสาขา', a.byName && a.byName.code === 'RM9-02', a.byName);
  check('สาขาไม่มีในทะเบียน = null', a.bad === null, a.bad);

  /* ---------- [B] แตกแถว + ตรวจความถูกต้อง (ลำดับเดิม) ---------- */
  console.log('\n[B] bulkParseRows (ลำดับเดิม) — นับ ok/err · ข้ามหัว · จับของเสีย');
  const b = await page.evaluate(() => {
    window.__seed();
    state.users = { exist1: { email: 'boss@isrd.local' } };
    const paste = [
      'ชื่อ\tเมล์\tรหัส\tสาขา',                                  // header -> ข้าม (ลำดับตรง = positional)
      'สมชาย ใจดี\tsomchai@isrd.local\t\tLKB-01',               // ok (รหัสว่าง)
      'สมหญิง รักงาน\tsomying@isrd.local\tpass1234\tโรบินสัน รัชดา', // ok (สาขาเป็นชื่อ)
      'ซ้ำ คน\tsomchai@isrd.local\t\tLKB-01',                   // อีเมลซ้ำในรายการ
      'ผิด เมล\tbademail\t\tLKB-01',                             // อีเมลผิดรูปแบบ
      'ไม่มีสาขา\tnobranch@isrd.local\t\t',                      // ไม่มีสาขา
      'ชนบอส\tboss@isrd.local\t\tLKB-01'                         // อีเมลมีผู้ใช้แล้ว
    ].join('\n');
    const p = bulkParseRows(paste);
    return {
      ok: p.okCount, err: p.errCount,
      r0: p.rows[0].branchCodes, r1: p.rows[1].branchCodes,
      dup: p.rows[2].errors, bad: p.rows[3].errors,
      nobr: p.rows[4].errors, taken: p.rows[5].errors
    };
  });
  check('นับ ok ถูก (2 คน)', b.ok === 2, b);
  check('นับ err ถูก (4 แถว)', b.err === 4, b);
  check('แถวแรกได้รหัสสาขา LKB-01', b.r0.length === 1 && b.r0[0] === 'LKB-01', b.r0);
  check('แถวสองแปลงชื่อ→รหัส RM9-02', b.r1.length === 1 && b.r1[0] === 'RM9-02', b.r1);
  check('จับอีเมลซ้ำในรายการ', b.dup.indexOf('อีเมลซ้ำในรายการ') >= 0, b.dup);
  check('จับอีเมลผิดรูปแบบ', b.bad.indexOf('อีเมลผิดรูปแบบ') >= 0, b.bad);
  check('จับไม่มีสาขา', b.nobr.indexOf('ไม่มีสาขา') >= 0, b.nobr);
  check('จับอีเมลที่มีผู้ใช้แล้ว', b.taken.indexOf('อีเมลนี้มีผู้ใช้แล้ว') >= 0, b.taken);

  /* ---------- [C] ⭐ atomic — role + สาขา เขียนก้อนเดียว ---------- */
  console.log('\n[C] ⭐ writeUserRecord(...,branches) → เขียน users ครั้งเดียว มี role+สาขาครบ');
  const c = await page.evaluate(async () => {
    window.__seed();
    await writeUserRecord('u9', 'สมปอง', 'sompong@isrd.local', 'scanner', ['LKB-01']);
    const w = window.__usersWrites();
    const rec = w.length === 1 ? w[0].patch['u9'] : null;
    return { count: w.length, role: rec && rec.role, branches: rec && rec.branches };
  });
  check('⭐ เขียน users ครั้งเดียว (เดิมแยกเป็น 2)', c.count === 1, c);
  check('ก้อนเดียวมี role = scanner', c.role === 'scanner', c);
  check('ก้อนเดียวมี branches = [LKB-01]',
        Array.isArray(c.branches) && c.branches.length === 1 && c.branches[0] === 'LKB-01', c.branches);

  /* ---------- [D] backward-compat — ไม่ส่งสาขาต้องไม่มีฟิลด์ branches ---------- */
  console.log('\n[D] เพิ่มเดี่ยว/UID (ไม่ส่ง branches) ต้องไม่มีฟิลด์ branches');
  const d = await page.evaluate(async () => {
    window.__seed();
    await writeUserRecord('u8', 'เก่า', 'old@isrd.local', 'counter');
    const rec = window.__usersWrites()[0].patch['u8'];
    return { hasBranches: Object.prototype.hasOwnProperty.call(rec, 'branches'), role: rec.role };
  });
  check('ไม่มีฟิลด์ branches ติดมา', d.hasBranches === false, d);
  check('role ยังเท่าเดิม (counter)', d.role === 'counter', d);

  /* ---------- [E] เต็มเส้น bulkUserCreate — 2 คน = เขียน users 2 ครั้ง ครบทุกคน ---------- */
  console.log('\n[E] bulkUserCreate เต็มเส้น → 2 คน เขียน users พอดี 2 ครั้ง ทุกใบมี role+สาขา');
  const e = await page.evaluate(async () => {
    window.__seed();
    $('bulkUserInput').value = [
      'เอ\ta@isrd.local\t\tLKB-01',
      'บี\tb@isrd.local\tpw123456\tRM9-02'
    ].join('\n');
    bulkUserCreate();
    await new Promise(r => setTimeout(r, 400));
    const uw = window.__usersWrites();
    const per = uw.map(function (u) {
      const uid = Object.keys(u.patch)[0];
      const rec = u.patch[uid];
      return { role: rec.role, nbr: (rec.branches || []).length, br: (rec.branches || [])[0] };
    });
    return { writes: uw.length, per: per };
  });
  check('⭐ สร้าง 2 คน → เขียน users พอดี 2 ครั้ง (ไม่ใช่ 4)', e.writes === 2, e);
  check('ทุกคนเป็น scanner', e.per.every(function (p) { return p.role === 'scanner'; }), e.per);
  check('ทุกคนล็อกสาขาในใบเดียว (1 สาขา/คน)',
        e.per.every(function (p) { return p.nbr === 1; }), e.per);
  check('สาขาตรงตามวาง (LKB-01, RM9-02)',
        e.per.length === 2 && e.per[0].br === 'LKB-01' && e.per[1].br === 'RM9-02', e.per);

  /* ---------- [F] ⭐ อ่านจากหัวตาราง — เรียงคอลัมน์ยังไงก็ได้ + ข้ามคอลัมน์เกิน ---------- */
  console.log('\n[F] ⭐ หัวตาราง: สาขาขึ้นก่อน · มีคอลัมน์ว่าง + Zone แทรก → map ถูกทุกคอลัมน์');
  const f = await page.evaluate(() => {
    window.__seed();
    /* เลียนแบบชีตจริง: สาขา · ชื่อพนักงาน · (ว่าง) · @isrd.local · PW · Zone */
    const paste = [
      'สาขา\tชื่อพนักงาน\t\t@isrd.local\tPW\tZone',
      'NTDS Central Northville FL.G\tNat1\t\tNat1@isrd.local\tNat11234\tBKK',
      'NTDS Central Nakhon Pathom FL.1\tNat2\t\tNat2@isrd.local\tNat21234\tBKK'
    ].join('\n');
    const p = bulkParseRows(paste);
    return {
      ok: p.okCount, err: p.errCount,
      n0: p.rows[0].name, e0: p.rows[0].email, p0: p.rows[0].pass, b0: p.rows[0].branchCodes,
      b1: p.rows[1].branchCodes
    };
  });
  check('อ่านครบ 2 คน ไม่มี error', f.ok === 2 && f.err === 0, f);
  check('map ชื่อถูก (ไม่เอาคอลัมน์สาขามาเป็นชื่อ)', f.n0 === 'Nat1', f.n0);
  check('map อีเมลถูก (คอลัมน์ @isrd.local)', f.e0 === 'Nat1@isrd.local', f.e0);
  check('map รหัสถูก (คอลัมน์ PW)', f.p0 === 'Nat11234', f.p0);
  check('map สาขาถูกจากชื่อสาขา (NTV-01)', f.b0.length === 1 && f.b0[0] === 'NTV-01', f.b0);
  check('แถวสองสาขา NKP-01', f.b1.length === 1 && f.b1[0] === 'NKP-01', f.b1);

  /* ---------- [G] ⭐ หลายสาขาต่อคน ---------- */
  console.log('\n[G] ⭐ ช่องสาขาใส่หลายอัน "LKB-01, RM9-02" → ล็อกทั้งคู่');
  const g = await page.evaluate(async () => {
    window.__seed();
    const p = bulkParseRows('สมชาย\tmulti@isrd.local\t\tLKB-01, RM9-02');
    const row = p.rows[0];
    /* สร้างจริงแล้วดูว่าเขียน branches ครบ 2 ในใบเดียว */
    $('bulkUserInput').value = 'สมชาย\tmulti@isrd.local\t\tLKB-01, RM9-02';
    bulkUserCreate();
    await new Promise(r => setTimeout(r, 300));
    const uw = window.__usersWrites();
    const rec = uw.length === 1 ? uw[0].patch[Object.keys(uw[0].patch)[0]] : null;
    return { parsed: row.branchCodes, err: row.errors, writes: uw.length, wrote: rec && rec.branches };
  });
  check('parse ได้ 2 สาขา', g.parsed.length === 2 && g.parsed[0] === 'LKB-01' && g.parsed[1] === 'RM9-02', g.parsed);
  check('ไม่มี error', g.err.length === 0, g.err);
  check('เขียน users ใบเดียว', g.writes === 1, g.writes);
  check('ใบเดียวมีครบ 2 สาขา', Array.isArray(g.wrote) && g.wrote.length === 2, g.wrote);

  /* ---------- [H] ⭐ ชีตจริง: 2 คอลัมน์สาขา (ชื่อ+รหัส) → ยึด code · code เพี้ยนถอยไปใช้ชื่อ ---------- */
  console.log('\n[H] ⭐ ชีตจริง: หัว ชื่อ·อีเมล์·รหัสผ่าน·สาขา·รหัสสาขา → ใช้ code เป็นหลัก, code เพี้ยน=ถอยไปชื่อ');
  const hh = await page.evaluate(() => {
    window.__seed();
    const paste = [
      'ชื่อ\tอีเมล์\tรหัสผ่าน\tสาขา\tรหัสสาขา',
      'Mark.SMS01\tMark.SMS01@isrd.local\tMark1234\tNTDS Siam Square\tSMS-01',           // ใช้ code SMS-01
      'Nat.NOV01\tNat.NOV01@isrd.local\tNat1234\tNTDS Central Northville FL.G\t2001-11-01 00:00:00' // code เพี้ยน→ถอยไปชื่อ
    ].join('\n');
    const map = bulkHeaderMap(bulkSplitLine('ชื่อ\tอีเมล์\tรหัสผ่าน\tสาขา\tรหัสสาขา'));
    const p = bulkParseRows(paste);
    return {
      map: map,
      ok: p.okCount, err: p.errCount,
      r0: p.rows[0].branchCodes, r0name: p.rows[0].name, r0pass: p.rows[0].pass, r0email: p.rows[0].email,
      r1: p.rows[1].branchCodes, r1err: p.rows[1].errors
    };
  });
  check('หัว map: branch=คอลัมน์รหัสสาขา(4), branchAlt=คอลัมน์ชื่อสาขา(3)',
        hh.map && hh.map.branch === 4 && hh.map.branchAlt === 3, hh.map);
  check('map ชื่อ/อีเมล/รหัส ไม่ชนกับคอลัมน์สาขา',
        hh.map && hh.map.name === 0 && hh.map.email === 1 && hh.map.pass === 2, hh.map);
  check('อ่าน 2 คน ไม่มี error', hh.ok === 2 && hh.err === 0, hh);
  check('แถวปกติใช้ code SMS-01', hh.r0.length === 1 && hh.r0[0] === 'SMS-01', hh.r0);
  check('ฟิลด์อื่นถูก (ชื่อ/อีเมล/รหัส)',
        hh.r0name === 'Mark.SMS01' && hh.r0email === 'Mark.SMS01@isrd.local' && hh.r0pass === 'Mark1234', hh);
  check('⭐ code เพี้ยนเป็นวันที่ → ถอยไปใช้ชื่อสาขา = NTV-01',
        hh.r1.length === 1 && hh.r1[0] === 'NTV-01', hh.r1);
  check('แถว code เพี้ยนไม่มี error (กู้ได้จากชื่อ)', hh.r1err.length === 0, hh.r1err);

  /* ---------- [K] ⭐ กดปุ่ม "ตรวจก่อน" จริง (เส้นที่ทำให้บั๊ก esc หลุด) + กัน HTML injection ---------- */
  console.log('\n[K] ⭐ กดปุ่ม "ตรวจก่อน" จริง → ตารางต้องขึ้น · ชื่อที่มี HTML ต้องไม่ถูกรัน');
  const kk = await page.evaluate(() => {
    window.__seed();
    $('bulkUserInput').value = [
      'ชื่อ\tเมล์\tรหัส\tสาขา',
      '<img src=x onerror=window.__xss=1>\txss@isrd.local\t\tLKB-01',  // ชื่อมี HTML
      'บี\tbademail\t\tXXX-99'                                          // อีเมลผิด + สาขาไม่พบ
    ].join('\n');
    window.__xss = 0;
    var wired = typeof $('btnBulkPreview').onclick === 'function';
    $('btnBulkPreview').click();                 // กดปุ่มจริง → เรียก handler ที่ถูก wire ไว้
    var host = $('bulkUserPreview');
    return {
      wired: wired,
      hasTable: !!host.querySelector('table'),
      rowCount: host.querySelectorAll('tbody tr').length,
      injectedImg: !!host.querySelector('img'),
      xssRan: window.__xss === 1,
      showsAsText: host.textContent.indexOf('<img') >= 0,
      createDisabled: $('btnBulkCreate').disabled
    };
  });
  check('ปุ่ม "ตรวจก่อน" ถูก wire ไว้จริง', kk.wired === true, kk);
  check('⭐ กดแล้วตารางขึ้น 2 แถว (renderBulkPreview ทำงานครบ ไม่พัง)', kk.hasTable && kk.rowCount === 2, kk);
  check('⭐ ชื่อที่มี HTML ไม่ถูกสร้างเป็น element', kk.injectedImg === false, kk);
  check('⭐ สคริปต์ใน onerror ไม่ถูกรัน', kk.xssRan === false, kk);
  check('ชื่อ HTML โชว์เป็นข้อความธรรมดา', kk.showsAsText === true, kk);
  check('มีแถว error → ปุ่มสร้างถูกปิด', kk.createDisabled === true, kk);

  /* ---------- [J] ⭐ คอลัมน์ "รหัสพนักงาน" ต้องไม่โดนอ่านเป็นรหัสผ่าน/ชื่อ ---------- */
  console.log('\n[J] ⭐ หัวมี "รหัสพนักงาน" ก่อน "รหัสผ่าน" → pass ต้องชี้คอลัมน์รหัสผ่านจริง ไม่ใช่ ID');
  const jj = await page.evaluate(() => {
    window.__seed();
    const head = 'ชื่อ\tรหัสพนักงาน\tอีเมล\tรหัสผ่าน\tสาขา';
    const map = bulkHeaderMap(bulkSplitLine(head));
    const p = bulkParseRows([
      head,
      'สมชาย\tEMP1\tsomchai@isrd.local\tRealPass123\tLKB-01'   // EMP1 สั้น ถ้าโดนอ่านเป็นรหัสจะ error
    ].join('\n'));
    return { map: map, ok: p.okCount, err: p.errCount, pass: p.rows[0] && p.rows[0].pass, name: p.rows[0] && p.rows[0].name };
  });
  check('pass ชี้คอลัมน์ "รหัสผ่าน" (3) ไม่ใช่ "รหัสพนักงาน" (1)', jj.map && jj.map.pass === 3, jj.map);
  check('name ชี้ "ชื่อ" (0) ไม่ใช่ "รหัสพนักงาน"', jj.map && jj.map.name === 0, jj.map);
  check('อ่านผ่าน ไม่ติด error (รหัสผ่านจริงยาวพอ)', jj.ok === 1 && jj.err === 0, jj);
  check('รหัสผ่าน = RealPass123 (ไม่ใช่ EMP1)', jj.pass === 'RealPass123', jj.pass);

  /* ---------- [I] ⭐ Fix 2: บัญชีสร้างแล้วแต่เขียนสิทธิ์พัง → โชว์ UID ให้ไปใช้ "เพิ่มด้วย UID" ---------- */
  console.log('\n[I] ⭐ Fix 2: createUser ผ่าน แต่ writeUserRecord ล้ม → แจ้ง UID + ใส่แถวกลับช่อง');
  const ii = await page.evaluate(async () => {
    window.__seed();
    window.writeUserRecord = function () { return Promise.reject(new Error('DB_FAIL')); };  // จำลองเขียนสิทธิ์พัง
    $('bulkUserInput').value = 'เอ\tfix2@isrd.local\t\tLKB-01';
    bulkUserCreate();
    await new Promise(r => setTimeout(r, 400));
    const modal = document.getElementById('modalDetail');
    return {
      usersWrites: window.__usersWrites().length,
      modalHasUID: !!modal && modal.textContent.indexOf('เพิ่มด้วย UID') >= 0,
      refilled: $('bulkUserInput').value.trim().length > 0
    };
  });
  check('ไม่มีการเขียน users (เพราะเขียนสิทธิ์ล้ม)', ii.usersWrites === 0, ii);
  check('⭐ กล่องผลแจ้ง "เพิ่มด้วย UID"', ii.modalHasUID === true, ii);
  check('ใส่แถวที่ล้มกลับช่องให้แก้ต่อ', ii.refilled === true, ii);

  check('ไม่มี error หลุดในหน้า', errors.length === 0, errors.slice(0, 3));

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
