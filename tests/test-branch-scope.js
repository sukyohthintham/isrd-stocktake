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
    window.__saved = [];
    window.db.update = function (path, patch) { window.__saved.push({ path: path, patch: patch }); return Promise.resolve(); };
    window.db.get = function () { return Promise.resolve(null); };
    window.renderScanPage = function () {};
    window.renderStart = function () {};
    window.refreshDocMeta = function () {};
    hideLogin();

    /* ทะเบียนสาขา 3 สาขา + Job สาขาละใบ + Job เก่าที่ไม่มี branchCode */
    window.__seed = function (role, branches) {
      state.me = { uid: 'u1', email: 'x@y.z', name: 'สมชาย', role: role,
                   branches: normBranchCodes(branches) };
      state.counter = 'สมชาย';
      state.branches = {
        BR001: { code: 'BR001', name: 'เซ็นทรัลเวิลด์', active: true },
        BR002: { code: 'BR002', name: 'สยามพารากอน', active: true },
        BR003: { code: 'BR003', name: 'เอ็มควอเทียร์', active: true }
      };
      state.roundIndex = {
        JA: { id: 'JA', name: 'รอบ A', jobCode: 'A-01', branchCode: 'BR001',
              branchName: 'เซ็นทรัลเวิลด์', cycleId: 'C1', status: 'counting', createdAt: 3 },
        JB: { id: 'JB', name: 'รอบ B', jobCode: 'B-01', branchCode: 'BR002',
              branchName: 'สยามพารากอน', cycleId: 'C2', status: 'counting', createdAt: 2 },
        JC: { id: 'JC', name: 'รอบ C', jobCode: 'C-01', branchCode: 'BR003',
              branchName: 'เอ็มควอเทียร์', cycleId: 'C3', status: 'counting', createdAt: 1 },
        JOLD: { id: 'JOLD', name: 'รอบเก่า', jobCode: 'OLD-01', branch: 'สาขาเก่า',
                cycleId: 'C0', status: 'closed', createdAt: 0 }
      };
      state.roundId = null;
      state.jobFilter = 'all'; state.jobBranch = 'all'; state.exportPick = [];
      state.jobView = 'list';
      window.__toasts = []; window.__saved = [];
      renderJobs();
    };

    window.__listed = function () {
      return Array.prototype.map.call(document.querySelectorAll('#jobList .jobcard'), function (c) {
        var code = c.querySelector('.j-code');
        return code ? code.textContent.trim() : '?';
      });
    };
    window.__branchOptions = function () {
      return Array.prototype.map.call(document.getElementById('jobBranchFilter').options,
                                      function (o) { return o.value; });
    };
  });

  /* ---------- 1. helper ---------- */
  console.log('\n[1] normBranchCodes / canSeeBranch');
  const r1 = await page.evaluate(() => {
    window.__seed('scanner', ['BR001']);
    return {
      fromArray: normBranchCodes(['BR001', 'BR002']),
      fromObject: normBranchCodes({ a: 'BR001', b: 'BR002' }),
      dedup: normBranchCodes(['BR001', 'BR001', ' BR002 ', '', null]),
      empty: normBranchCodes(undefined),
      seeOwn: canSeeBranch('BR001'),
      seeOther: canSeeBranch('BR002'),
      seeBlank: canSeeBranch('')
    };
  });
  check('อ่านจาก array ได้', JSON.stringify(r1.fromArray) === '["BR001","BR002"]', r1.fromArray);
  check('อ่านจาก object ของ Firebase ได้', JSON.stringify(r1.fromObject) === '["BR001","BR002"]', r1.fromObject);
  check('ตัดซ้ำ/ช่องว่าง/ค่าว่างทิ้ง', JSON.stringify(r1.dedup) === '["BR001","BR002"]', r1.dedup);
  check('ไม่มีค่า = อาเรย์ว่าง', JSON.stringify(r1.empty) === '[]', r1.empty);
  check('เห็นสาขาตัวเอง', r1.seeOwn === true, r1.seeOwn);
  check('ไม่เห็นสาขาอื่น', r1.seeOther === false, r1.seeOther);
  check('Job ที่ไม่มีรหัสสาขา (ของเก่า) ยังเห็นได้', r1.seeBlank === true, r1.seeBlank);

  /* ---------- 2. scanner ถูกจำกัดสาขา ---------- */
  console.log('\n[2] scanner สาขา BR001');
  const r2 = await page.evaluate(() => {
    window.__seed('scanner', ['BR001']);
    return { listed: window.__listed(), branchOptions: window.__branchOptions() };
  });
  check('เห็นเฉพาะ Job สาขาตัวเอง + Job เก่าที่ไม่มีรหัสสาขา',
        JSON.stringify(r2.listed.sort()) === JSON.stringify(['A-01', 'OLD-01']), r2.listed);
  check('ดรอปดาวน์กรองสาขาไม่มีสาขาที่เข้าไม่ได้',
        r2.branchOptions.indexOf('สยามพารากอน') < 0 && r2.branchOptions.indexOf('เอ็มควอเทียร์') < 0,
        r2.branchOptions);

  /* ---------- 3. เลือก Job สาขาอื่นไม่ได้ ---------- */
  console.log('\n[3] กันเลือก Job นอกสาขา');
  const r3 = await page.evaluate(() => {
    window.__seed('scanner', ['BR001']);
    const out = {};
    window.__toasts = [];
    out.ok = selectRound('JA');
    out.roundAfterOk = state.roundId;

    window.__toasts = [];
    out.blocked = selectRound('JB');
    out.roundAfterBlock = state.roundId;
    out.toast = (window.__toasts[0] || {}).m;
    out.toastBad = (window.__toasts[0] || {}).bad;

    /* openJob ต้องไม่พาไปหน้าไหนเลยถ้าถูกปฏิเสธ */
    state.page = 'jobs';
    openJob('JC');
    out.pageAfterOpenOther = state.page;
    out.roundAfterOpenOther = state.roundId;
    return out;
  });
  check('เลือก Job สาขาตัวเองได้ (คืน true)', r3.ok === true && r3.roundAfterOk === 'JA', r3);
  check('เลือก Job สาขาอื่นถูกปฏิเสธ (คืน false)', r3.blocked === false, r3);
  check('state.roundId ไม่ถูกเปลี่ยนตาม', r3.roundAfterBlock === 'JA', r3);
  check('มี toast บอกว่าเป็นของสาขาไหน',
        /สยามพารากอน/.test(r3.toast || '') && r3.toastBad === true, r3.toast);
  check('openJob ของสาขาอื่นไม่พาไปหน้าไหน',
        r3.pageAfterOpenOther === 'jobs' && r3.roundAfterOpenOther === 'JA', r3);

  /* ---------- 4. admin เห็นทุกสาขา ---------- */
  console.log('\n[4] admin / คนไม่กำหนดสาขา');
  const r4 = await page.evaluate(() => {
    const out = {};
    /* admin ที่ถูกกำหนดสาขาไว้ ก็ยังต้องเห็นทุกสาขา */
    window.__seed('admin', ['BR001']);
    out.adminListed = window.__listed().sort();
    out.adminCanPickOther = selectRound('JB');

    /* counter ที่ไม่ได้กำหนดสาขา = เห็นหมด (บัญชีเก่า) */
    window.__seed('counter', []);
    out.openListed = window.__listed().sort();
    out.openCanPickAny = selectRound('JC');

    /* counter ที่กำหนดสองสาขา */
    window.__seed('counter', ['BR002', 'BR003']);
    out.twoListed = window.__listed().sort();
    return out;
  });
  check('admin เห็นทุกสาขาแม้ถูกกำหนดสาขาไว้',
        JSON.stringify(r4.adminListed) === JSON.stringify(['A-01', 'B-01', 'C-01', 'OLD-01']), r4.adminListed);
  check('admin เลือก Job สาขาไหนก็ได้', r4.adminCanPickOther === true, r4.adminCanPickOther);
  check('ผู้ใช้ที่ไม่กำหนดสาขา = เห็นทุกสาขา',
        JSON.stringify(r4.openListed) === JSON.stringify(['A-01', 'B-01', 'C-01', 'OLD-01']), r4.openListed);
  check('ผู้ใช้ที่ไม่กำหนดสาขา เลือกได้ทุกใบ', r4.openCanPickAny === true, r4.openCanPickAny);
  check('counter สองสาขา เห็นสองใบ + ของเก่า',
        JSON.stringify(r4.twoListed) === JSON.stringify(['B-01', 'C-01', 'OLD-01']), r4.twoListed);

  /* ---------- 5. ลิสต์ว่างต้องบอกเหตุผล ---------- */
  console.log('\n[5] ไม่มี Job ในสาขาที่ดูแล');
  const r5 = await page.evaluate(() => {
    window.__seed('scanner', ['BR999']);
    /* ตัด Job เก่าที่ไม่มีรหัสสาขาออก ให้ลิสต์ว่างจริง */
    delete state.roundIndex.JOLD;
    renderJobs();
    return { listed: window.__listed(), empty: document.querySelector('#jobList .empty').textContent };
  });
  check('ไม่มี Job ให้เห็นเลย', r5.listed.length === 0, r5.listed);
  check('ข้อความว่างบอกว่าเป็นเพราะสาขา',
        /สาขาที่คุณดูแล/.test(r5.empty) && /BR999/.test(r5.empty), r5.empty);

  /* ---------- 6. หน้าจัดการผู้ใช้ ---------- */
  console.log('\n[6] กล่องติ๊ก "สาขาที่ดูแล" ในหน้าจัดการผู้ใช้');
  const r6 = await page.evaluate(() => {
    window.__seed('admin', []);
    state.users = {
      u2: { name: 'สมหญิง', email: 'a@b.c', role: 'scanner', branches: ['BR002'] },
      u3: { name: 'สมปอง', email: 'd@e.f', role: 'counter' },
      u4: { name: 'สมศักดิ์', email: 'g@h.i', role: 'scanner', branches: ['BR404'] }
    };
    renderUsers();
    const boxes = function (uid) {
      return Array.prototype.slice.call(
        document.querySelectorAll('[data-user="' + uid + '"] [data-branchpick]'));
    };
    const ticked = function (uid) {
      return boxes(uid).filter(function (c) { return c.checked; })
        .map(function (c) { return c.getAttribute('data-branchpick'); });
    };
    const hint = function (uid) { return document.querySelector('[data-branchhint="' + uid + '"]').textContent; };
    const out = {
      exists: boxes('u2').length > 0,
      isCheckbox: boxes('u2')[0].type === 'checkbox',
      count: boxes('u2').length,
      hasSearch: !!document.querySelector('[data-user="u2"] [data-action="branchsearch"]'),
      /* โหลดค่าเดิมมาติ๊กให้ถูก */
      u2Ticked: ticked('u2'),
      u3Ticked: ticked('u3'),
      u3Hint: hint('u3'),
      u2Hint: hint('u2'),
      /* สาขาที่ถูกลบจากทะเบียนแล้ว ต้องยังโผล่และยังติ๊กอยู่ */
      u4Ticked: ticked('u4'),
      u4HasGhost: boxes('u4').some(function (c) {
        return c.getAttribute('data-branchpick') === 'BR404' &&
               /ไม่มีในทะเบียน/.test(c.parentNode.textContent);
      })
    };

    /* ติ๊กทีละอันได้หลายสาขา (ไม่ต้องกด Ctrl) */
    window.__saved = [];
    const b3 = boxes('u3');
    b3[0].checked = true; b3[0].onchange();
    out.afterFirst = window.__saved[0] && window.__saved[0].patch['u3/branches'];
    out.hintAfterFirst = hint('u3');

    window.__saved = [];
    b3[2].checked = true; b3[2].onchange();
    out.savedPath = window.__saved[0] && window.__saved[0].path;
    out.afterSecond = window.__saved[0] && window.__saved[0].patch['u3/branches'];
    out.hintAfterSecond = hint('u3');
    /* วาดใหม่ทั้งลิสต์หลังติ๊กไม่ได้ ไม่งั้นคำค้นหายทุกครั้ง */
    out.stillSameNode = boxes('u3')[0] === b3[0];

    /* เอาติ๊กออกทีละอัน */
    window.__saved = [];
    b3[0].checked = false; b3[0].onchange();
    out.afterUntick = window.__saved[0] && window.__saved[0].patch['u3/branches'];

    /* เอาออกหมด = ลบฟิลด์ (null) กลับไปเห็นทุกสาขา */
    window.__saved = [];
    b3[2].checked = false; b3[2].onchange();
    out.cleared = window.__saved[0] && window.__saved[0].patch['u3/branches'];
    out.hintCleared = hint('u3');

    /* ช่องค้นหากรองรายการ แต่ต้องไม่ล้างค่าที่ติ๊กไว้ */
    b3[1].checked = true; b3[1].onchange();          // ติ๊ก BR002 ไว้ก่อนค้นหา
    const search = document.querySelector('[data-user="u3"] [data-action="branchsearch"]');
    search.value = 'สยาม';
    search.oninput();
    out.filtered = boxes('u3').map(function (c) { return c.getAttribute('data-branchpick'); });
    out.filteredTicked = ticked('u3');
    search.value = 'ไม่มีสาขานี้';
    search.oninput();
    out.emptySearch = document.querySelector('[data-branchlist="u3"]').textContent;
    search.value = '';
    search.oninput();
    out.restored = ticked('u3');
    return out;
  });
  check('เป็นกล่องติ๊ก (checkbox) ไม่ใช่ select', r6.exists === true && r6.isCheckbox === true, r6);
  check('มีครบ 3 สาขาจากทะเบียน', r6.count === 3, r6.count);
  check('มีช่องค้นหาสาขา', r6.hasSearch === true, r6.hasSearch);
  check('โหลดค่าเดิมมาติ๊กให้ถูก', JSON.stringify(r6.u2Ticked) === '["BR002"]', r6.u2Ticked);
  check('คนที่ยังไม่กำหนด = ไม่ติ๊กอะไรเลย', JSON.stringify(r6.u3Ticked) === '[]', r6.u3Ticked);
  check('คำอธิบายบอกว่ายังไม่จำกัดสาขา', /ยังไม่จำกัดสาขา/.test(r6.u3Hint), r6.u3Hint);
  check('คำอธิบายบอกจำนวนสาขาที่จำกัด', /เห็น 1 สาขา: BR002/.test(r6.u2Hint), r6.u2Hint);
  check('สาขาที่ถูกลบจากทะเบียนยังติ๊กอยู่ ไม่หายตอนบันทึก',
        JSON.stringify(r6.u4Ticked) === '["BR404"]' && r6.u4HasGhost === true, r6);
  check('ติ๊กอันแรก → บันทึก 1 สาขา',
        JSON.stringify(r6.afterFirst) === '["BR001"]', r6.afterFirst);
  check('ติ๊กอันที่สอง → บันทึกครบทั้งสองสาขา (ไม่ทับของเดิม)',
        r6.savedPath === 'users' && JSON.stringify(r6.afterSecond) === '["BR001","BR003"]', r6);
  check('คำอธิบายอัปเดตตามทุกครั้งที่ติ๊ก',
        /เห็น 1 สาขา: BR001/.test(r6.hintAfterFirst) &&
        /เห็น 2 สาขา: BR001, BR003/.test(r6.hintAfterSecond), r6);
  check('ไม่วาดลิสต์ใหม่ทั้งดุ้นหลังติ๊ก (คำค้นไม่หาย)', r6.stillSameNode === true, r6.stillSameNode);
  check('เอาติ๊กออก → เหลือเฉพาะที่ยังติ๊กอยู่',
        JSON.stringify(r6.afterUntick) === '["BR003"]', r6.afterUntick);
  check('เอาออกหมด = เขียน null (กลับไปเห็นทุกสาขา)', r6.cleared === null, r6.cleared);
  check('คำอธิบายกลับไปบอกว่าไม่จำกัดสาขา', /ยังไม่จำกัดสาขา/.test(r6.hintCleared), r6.hintCleared);
  check('ค้นหาแล้วเหลือเฉพาะสาขาที่ตรง',
        JSON.stringify(r6.filtered) === '["BR002"]', r6.filtered);
  check('ค้นหาแล้วค่าที่ติ๊กไว้ไม่หาย',
        JSON.stringify(r6.filteredTicked) === '["BR002"]', r6.filteredTicked);
  check('ค้นหาไม่เจอ มีข้อความบอก', /ไม่มีสาขาที่ตรงกับคำค้น/.test(r6.emptySearch), r6.emptySearch);
  check('ล้างคำค้นแล้วค่าที่ติ๊กยังอยู่ครบ',
        JSON.stringify(r6.restored) === '["BR002"]', r6.restored);

  /* ---------- 7. แก้สาขาตัวเองแล้วมีผลทันที ---------- */
  console.log('\n[7] แก้สาขาของตัวเองต้องมีผลทันที ไม่ต้องล็อกอินใหม่');
  const r7 = await page.evaluate(async () => {
    /* saveUserField เป็นของ admin เท่านั้น และเป็น async — ต้อง await */
    window.__seed('admin', []);
    state.users = { u1: { name: 'สมชาย', email: 'x@y.z', role: 'admin' } };
    const before = state.me.branches.slice();
    await saveUserField('u1', { branches: ['BR002'] });
    const mid = state.me.branches.slice();
    await saveUserField('u1', { branches: null });
    const cleared = state.me.branches.slice();

    /* ฝั่งการมองเห็นทดสอบกับ counter (admin เห็นทุกสาขาเสมออยู่แล้ว) */
    state.me.role = 'counter';
    state.me.branches = ['BR002'];
    const seeA = canSeeBranch('BR001'), seeB = canSeeBranch('BR002');
    return { before: before, mid: mid, cleared: cleared, seeA: seeA, seeB: seeB };
  });
  check('state.me.branches อัปเดตทันทีหลังบันทึก',
        JSON.stringify(r7.before) === '[]' && JSON.stringify(r7.mid) === '["BR002"]', r7);
  check('ล้างค่า (null) แล้วกลับไปไม่จำกัดสาขา',
        JSON.stringify(r7.cleared) === '[]', r7.cleared);
  check('การมองเห็นเดินตาม state.me.branches ทันที',
        r7.seeA === false && r7.seeB === true, r7);

  /* ---------- 8. Job ที่ค้างใน localStorage นอกสาขา ---------- */
  console.log('\n[8] Job ที่ค้างไว้แต่ย้ายสาขาแล้ว');
  const r8 = await page.evaluate(() => {
    window.__seed('scanner', ['BR001']);
    return {
      allowed: canSeeJob(state.roundIndex.JA),
      blocked: canSeeJob(state.roundIndex.JB),
      legacy: canSeeJob(state.roundIndex.JOLD)
    };
  });
  check('canSeeJob: สาขาตัวเอง = true', r8.allowed === true, r8);
  check('canSeeJob: สาขาอื่น = false', r8.blocked === false, r8);
  check('canSeeJob: Job เก่าไม่มีรหัสสาขา = true', r8.legacy === true, r8);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
