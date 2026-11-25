/* ============================================================
   ⭐ v2.52.0 จัดการผู้ใช้แบบจำกัด (manageStaff) — หน้าจอ + ด่านชั้นฟังก์ชัน
   ============================================================
   กติกาจริงอยู่ที่ Rules v2.1.8 (test-rules [15]) และ staffWriteCheck (test-perms [15])
   ไฟล์นี้คุม "ชั้นจอ + ชั้นฟังก์ชัน" ตามกฎบ้าน ล็อกสองชั้นเสมอ:
   [1] delegate เห็นแท็บผู้ใช้ · ไม่เห็นแท็บออนไลน์ · แถว admin/ตัวเอง/delegate อื่น = อ่านอย่างเดียว
   [2] role ที่ตั้งได้ · ช่องติ๊ก cap ที่ไม่ถือ = ปิด · ช่อง manageStaff ซ่อน · บัญชีที่ปิดไว้ = เปิดคืนไม่ได้
   [3] เรียก saveUserField / createUserAccount / resetUserPassword ตรงจาก Console ข้ามข้อห้าม = ถูกกัน ไม่ยิงฐาน
   [4] delegate ที่ไม่มีสิทธิ์ดู Master เห็นแค่แท็บผู้ใช้
   [5] counter ปกติ (ไม่มี manageStaff) = เหมือนเดิม · admin = เหมือนเดิม (มีตัวเลือก admin · ไม่มีแถวล็อก)
   ============================================================ */

const { puppeteer, CHROME, APP_URL } = require('./_env');
const { COUNTER } = require('./_staff-cases');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const perms = list => list.reduce((o, c) => { o[c] = true; return o; }, {});

const USERS = {
  u_a:   { name: 'บอส', role: 'admin', active: true, email: 'a@x.co' },
  u_d:   { name: 'หัวหน้า', role: 'custom', active: true, email: 'd@x.co', perms: perms(COUNTER.concat(['manageStaff'])) },
  u_o:   { name: 'หัวหน้าอื่น', role: 'custom', active: true, email: 'o@x.co', perms: perms(['docs', 'manageStaff']) },
  u_v:   { name: 'วิว', role: 'viewer', active: true, email: 'v@x.co', perms: perms(['docs']) },
  u_c:   { name: 'นับ', role: 'counter', active: true, email: 'c@x.co', perms: perms(COUNTER) },
  u_off: { name: 'ปิดอยู่', role: 'viewer', active: false, email: 'off@x.co', perms: perms(['docs']) },
  u_big: { name: 'ใหญ่', role: 'custom', active: true, email: 'big@x.co', perms: perms(['docs', 'deleteJob']) }
};

const HARNESS = `
  window.__toasts = [];
  window.toast = function (m, bad) { window.__toasts.push({ m: String(m), bad: !!bad }); };
  window.__lastToast = function () { return (window.__toasts[window.__toasts.length - 1] || {}).m || ''; };
  hideLogin();
  window.__upd = [];
  window.db.update = function (path, patch) { window.__upd.push({ path: path, patch: JSON.parse(JSON.stringify(patch)) }); return Promise.resolve(); };
  window.__created = []; window.__resets = [];
  window.session.createUser = function (email, pw) { window.__created.push(email); return Promise.resolve({ uid: 'new_' + window.__created.length, email: email }); };
  window.session.sendPasswordReset = function (email) { window.__resets.push(email); return Promise.resolve(true); };
  window.__as = function (uid, rec, users) {
    setMe({ uid: uid, email: rec.email || '' }, rec);
    state.users = JSON.parse(JSON.stringify(users));
    window.__toasts = []; window.__upd = []; window.__created = []; window.__resets = [];
    renderAccount();
    renderUsers();
  };
  window.__row = function (uid) { return document.querySelector('#userList [data-user="' + uid + '"]'); };
`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await wait(800);
  await page.evaluate(HARNESS);

  /* ---------- 1. delegate เห็นอะไร ---------- */
  console.log('\n[1] delegate — แท็บผู้ใช้ + แถวที่แก้ไม่ได้เป็นอ่านอย่างเดียว');
  const r1 = await page.evaluate((U) => {
    window.__as('u_d', U.u_d, U);
    showPage('master');
    const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
    const locked = uid => !!(window.__row(uid) || {}).getAttribute && window.__row(uid).getAttribute('data-userlocked') === '1';
    const lockText = uid => ((document.querySelector('[data-userlock="' + uid + '"]') || {}).textContent || '');
    return {
      tabUsers: vis('tabUsers'), tabOnline: vis('tabOnline'), page: state.page,
      rows: document.querySelectorAll('#userList [data-user]').length,
      lockA: locked('u_a'), lockSelf: locked('u_d'), lockO: locked('u_o'),
      lockV: locked('u_v'), lockC: locked('u_c'), lockBig: locked('u_big'),
      txtA: lockText('u_a'), txtSelf: lockText('u_d'), txtO: lockText('u_o'),
      aInputs: Array.from(window.__row('u_a').querySelectorAll('input,select,button[data-action]')).filter(e => !e.disabled).length
    };
  }, USERS);
  check('delegate เข้าหน้า Master + เห็นแท็บผู้ใช้', r1.page === 'master' && r1.tabUsers, r1);
  check('ไม่เห็นแท็บผู้ใช้ออนไลน์ (admin เท่านั้น)', r1.tabOnline === false, r1);
  check('เห็นรายชื่อครบทุกคน', r1.rows === 7, r1.rows);
  check('แถว admin = อ่านอย่างเดียว + บอกเหตุผล', r1.lockA && /admin/.test(r1.txtA), r1);
  check('แถวตัวเอง = อ่านอย่างเดียว', r1.lockSelf && /ตัวเอง/.test(r1.txtSelf), r1);
  check('แถว delegate อื่น = อ่านอย่างเดียว', r1.lockO && /จัดการผู้ใช้/.test(r1.txtO), r1);
  check('แถว viewer / counter / custom ทั่วไป = แก้ได้', !r1.lockV && !r1.lockC && !r1.lockBig, r1);
  check('แถว admin ไม่มีช่อง/ปุ่มที่กดได้เลย', r1.aInputs === 0, r1.aInputs);

  /* ---------- 2. ตัวเลือกในแถวที่แก้ได้ ---------- */
  console.log('\n[2] role · ช่องติ๊ก · บัญชีที่ปิดไว้');
  const r2 = await page.evaluate(() => {
    const row = window.__row('u_v');
    const opts = Array.from(row.querySelectorAll('select[data-action="role"] option')).map(o => o.value);
    const cb = k => row.querySelector('[data-permpick="' + k + '"]');
    const off = window.__row('u_off').querySelector('[data-action="active"]');
    const newRole = Array.from(document.querySelectorAll('#newUserRole option')).filter(o => !o.disabled && !o.hidden).map(o => o.value);
    const linkRole = Array.from(document.querySelectorAll('#linkUserRole option')).filter(o => !o.disabled && !o.hidden).map(o => o.value);
    return { opts, docs: cb('docs') && !cb('docs').disabled, del: cb('deleteJob') && cb('deleteJob').disabled,
             msHidden: cb('manageStaff') && cb('manageStaff').closest('label').style.display === 'none',
             offDisabled: off && off.disabled, offText: off && off.textContent, newRole, linkRole };
  });
  check('role ที่ตั้งได้ = counter/scanner/viewer/custom (ไม่มี admin)',
        r2.opts.indexOf('admin') < 0 && ['counter', 'scanner', 'viewer', 'custom'].every(r => r2.opts.indexOf(r) >= 0), r2.opts);
  check('ช่อง cap ที่ตัวเองถือ (docs) ติ๊กได้ · ที่ไม่ถือ (deleteJob) ปิด', r2.docs && r2.del, r2);
  check('ช่อง manageStaff ถูกซ่อน', r2.msHidden, r2);
  check('บัญชีที่ปิดไว้ — ปุ่มเปิดคืนถูกปิด + บอกว่าเป็นงาน admin', r2.offDisabled && /ผู้ดูแลระบบ/.test(r2.offText || ''), r2);
  check('ฟอร์มสร้าง: ไม่มีตัวเลือก admin', r2.newRole.indexOf('admin') < 0 && r2.newRole.indexOf('scanner') >= 0, r2.newRole);
  check('ฟอร์มเพิ่มด้วย UID: ไม่มีตัวเลือก admin', r2.linkRole.indexOf('admin') < 0, r2.linkRole);

  /* delegate ที่ขาด approveRecheck → ตั้ง counter ไม่ได้ */
  const r2b = await page.evaluate((U) => {
    const me = JSON.parse(JSON.stringify(U.u_d)); delete me.perms.approveRecheck;
    const users = JSON.parse(JSON.stringify(U)); users.u_d = me;
    window.__as('u_d', me, users);
    const opts = Array.from(window.__row('u_v').querySelectorAll('select[data-action="role"] option')).map(o => o.value);
    const lockC = window.__row('u_c').getAttribute('data-userlocked') === '1';
    return { opts, lockC };
  }, USERS);
  check('ขาด approveRecheck → ไม่มีตัวเลือก counter', r2b.opts.indexOf('counter') < 0 && r2b.opts.indexOf('scanner') >= 0, r2b.opts);
  check('ขาด approveRecheck → แถว counter เดิมเป็นอ่านอย่างเดียว (ตรงกับ Rules)', r2b.lockC, r2b);

  /* ---------- 3. ชั้นฟังก์ชัน (เรียกตรงจาก Console) ---------- */
  console.log('\n[3] เรียกตรงจาก Console ข้ามข้อห้าม → ถูกกัน ไม่ยิงฐาน');
  const r3 = await page.evaluate(async (U) => {
    window.__as('u_d', U.u_d, U);
    const tryPatch = async (uid, p) => { window.__upd = []; window.__toasts = []; await saveUserField(uid, p);
      return { upd: window.__upd.length, toast: window.__lastToast() }; };
    const out = {};
    out.renameAdmin = await tryPatch('u_a', { name: 'x' });
    out.makeAdmin = await tryPatch('u_v', { role: 'admin' });
    out.grantMS = await tryPatch('u_v', { 'perms/manageStaff': true });
    out.grantDel = await tryPatch('u_v', { 'perms/deleteJob': true });
    out.self = await tryPatch('u_d', { name: 'ฉัน' });
    out.other = await tryPatch('u_o', { name: 'x' });
    out.reopen = await tryPatch('u_off', { active: true });
    out.okRename = await tryPatch('u_v', { name: 'วิวใหม่' });
    out.okRenamePath = (window.__upd[0] || {}).path;
    out.okRenameKeys = Object.keys((window.__upd[0] || {}).patch || {});
    out.okUntick = await tryPatch('u_big', { 'perms/deleteJob': null });
    out.okDocs = await tryPatch('u_c', { 'perms/docs': true });
    out.okDisable = await tryPatch('u_v', { active: false });
    return out;
  }, USERS);
  const denied = (r, re) => r.upd === 0 && re.test(r.toast);
  check('(ค) เปลี่ยนชื่อ admin → ถูกกัน', denied(r3.renameAdmin, /admin/), r3.renameAdmin);
  check('(ก) ตั้ง role admin → ถูกกัน', denied(r3.makeAdmin, /admin/), r3.makeAdmin);
  check('(ข) ติ๊ก manageStaff → ถูกกัน', denied(r3.grantMS, /จัดการผู้ใช้ทั่วไป/), r3.grantMS);
  check('(ง) ติ๊ก deleteJob (ตัวเองไม่มี) → ถูกกัน', denied(r3.grantDel, /ไม่มี/), r3.grantDel);
  check('(ฉ) แก้ตัวเอง → ถูกกัน', denied(r3.self, /ตัวเอง/), r3.self);
  check('(ช) แก้ delegate อื่น → ถูกกัน', denied(r3.other, /จัดการผู้ใช้/), r3.other);
  check('D13 เปิดบัญชีที่ปิดไว้ → ถูกกัน', denied(r3.reopen, /ปิดไว้/), r3.reopen);
  check('เปลี่ยนชื่อ viewer → เขียนจริง (update รายฟิลด์)', r3.okRename.upd === 1 && r3.okRenamePath === 'users' &&
        r3.okRenameKeys.indexOf('u_v/name') >= 0, r3);
  check('ปลด cap ที่ตัวเองไม่มีออกจากคนอื่น (ปิดได้) → เขียนได้', r3.okUntick.upd === 1, r3.okUntick);
  check('ติ๊ก cap ที่ตัวเองถือ → เขียนได้', r3.okDocs.upd === 1, r3.okDocs);
  check('ปิดบัญชี viewer → เขียนได้', r3.okDisable.upd === 1, r3.okDisable);

  const r3b = await page.evaluate(async (U) => {
    window.__as('u_d', U.u_d, U);
    const out = {};
    /* สร้างบัญชี: บังคับค่า admin ลงช่อง (เหมือนแก้ DOM) → ต้องไม่ไปสร้างบัญชี Auth เลย */
    $('newUserName').value = 'ใหม่'; $('newUserMail').value = 'new@x.co'; $('newUserPass').value = 'abcdef12';
    const sel = $('newUserRole'); sel.value = 'admin';
    createUserAccount(); await new Promise(r => setTimeout(r, 50));
    out.admin = { created: window.__created.length, upd: window.__upd.length, toast: window.__lastToast() };
    window.__toasts = []; window.__upd = []; window.__created = [];
    $('newUserName').value = 'ใหม่'; $('newUserMail').value = 'new2@x.co'; $('newUserPass').value = 'abcdef12';
    sel.value = 'scanner';
    createUserAccount(); await new Promise(r => setTimeout(r, 80));
    const w = window.__upd[0] || {}; const rec = (w.patch || {})[Object.keys(w.patch || {})[0]] || {};
    out.scanner = { created: window.__created.length, role: rec.role, perms: rec.perms, createdBy: rec.createdBy };
    try { closeModal && closeModal(); } catch (e) {}
    if (document.getElementById('modalBg').classList.contains('show')) document.getElementById('modalOk').click();
    /* รีเซ็ตรหัส */
    window.__resets = []; window.__toasts = [];
    resetUserPassword('u_a'); out.resetAdmin = { n: window.__resets.length, toast: window.__lastToast() };
    return out;
  }, USERS);
  check('สร้างบัญชี role admin (แก้ DOM) → ไม่สร้างบัญชี Auth ไม่เขียนฐาน', r3b.admin.created === 0 && r3b.admin.upd === 0 && /admin/.test(r3b.admin.toast), r3b.admin);
  check('สร้างพนักงานยิงได้ (perms ตามแม่แบบ · บันทึกผู้สร้าง)', r3b.scanner.created === 1 && r3b.scanner.role === 'scanner' &&
        JSON.stringify(r3b.scanner.perms) === '{"scan":true}' && r3b.scanner.createdBy === 'u_d', r3b.scanner);
  check('รีเซ็ตรหัส admin → ถูกกัน ไม่ส่งลิงก์', r3b.resetAdmin.n === 0 && /admin/.test(r3b.resetAdmin.toast), r3b.resetAdmin);

  /* ---------- 4. delegate ที่ไม่มีสิทธิ์ดู Master ---------- */
  console.log('\n[4] delegate ที่ไม่มีสิทธิ์ดู Master — เห็นแค่แท็บผู้ใช้');
  const r4 = await page.evaluate((U) => {
    const me = { name: 'หัวหน้าเล็ก', role: 'custom', active: true, email: 's@x.co', perms: { scan: true, manageStaff: true } };
    const users = JSON.parse(JSON.stringify(U)); users.u_s = me;
    window.__as('u_s', me, users);
    showPage('master');
    const vis = t => { const b = document.querySelector('[data-mtab="' + t + '"]'); return !!b && b.style.display !== 'none'; };
    return { page: state.page, tab: state.masterTab, users: vis('users'),
             data: ['products', 'branches', 'locations', 'shopzones'].filter(vis) };
  }, USERS);
  check('เข้าหน้า Master ได้ + อยู่แท็บผู้ใช้', r4.page === 'master' && r4.tab === 'users' && r4.users, r4);
  check('แท็บข้อมูล Master ถูกซ่อนทั้งหมด', r4.data.length === 0, r4.data);

  /* ---------- 5. ของเดิมไม่กระทบ ---------- */
  console.log('\n[5] counter ปกติ / admin — เหมือนเดิม');
  const r5 = await page.evaluate((U) => {
    window.__as('u_c', U.u_c, U);
    const counter = { tabUsers: $('tabUsers').style.display !== 'none', can: canManageStaff() };
    window.__toasts = []; window.__upd = [];
    saveUserField('u_v', { name: 'x' });
    counter.save = { upd: window.__upd.length, toast: window.__lastToast() };
    window.__as('u_a', U.u_a, U);
    const admin = {
      tabUsers: $('tabUsers').style.display !== 'none', tabOnline: $('tabOnline').style.display !== 'none',
      locked: document.querySelectorAll('#userList [data-userlocked]').length,
      roleOpts: Array.from(window.__row('u_v').querySelectorAll('select[data-action="role"] option')).map(o => o.value),
      ms: (function () { const c = window.__row('u_v').querySelector('[data-permpick="manageStaff"]'); return !!c && !c.disabled && c.closest('label').style.display !== 'none'; })(),
      newRole: Array.from(document.querySelectorAll('#newUserRole option')).filter(o => !o.disabled && !o.hidden).map(o => o.value)
    };
    return { counter, admin };
  }, USERS);
  check('counter ปกติ: ไม่เห็นแท็บผู้ใช้ · จัดการไม่ได้', !r5.counter.tabUsers && !r5.counter.can, r5.counter);
  check('counter ปกติ: เรียก saveUserField ตรง → ถูกกัน ไม่เขียน', r5.counter.save.upd === 0, r5.counter.save);
  check('admin: เห็นแท็บผู้ใช้ + ออนไลน์ · ไม่มีแถวล็อก', r5.admin.tabUsers && r5.admin.tabOnline && r5.admin.locked === 0, r5.admin);
  check('admin: มีตัวเลือก admin ครบ 5 role', ['admin', 'counter', 'scanner', 'viewer', 'custom'].every(r => r5.admin.roleOpts.indexOf(r) >= 0), r5.admin.roleOpts);
  check('admin: ติ๊กมอบ manageStaff ได้', r5.admin.ms, r5.admin);
  check('admin: ฟอร์มสร้างมีตัวเลือก admin', r5.admin.newRole.indexOf('admin') >= 0, r5.admin.newRole);

  console.log('\n[errors] ' + (errors.length ? errors.join('\n') : 'ไม่มี'));
  check('ไม่มี error บนหน้า', errors.length === 0, errors);
  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
