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

  /* ---------- 1. โครงสร้าง div — เบราว์เซอร์ปิดแท็กให้เองถ้าเราเขียนเกิน ต้องเช็คว่าอยู่ถูกที่ ---------- */
  console.log('\n[1] โครงสร้าง div ครอบถูกกลุ่ม');
  const r1 = await page.evaluate(() => {
    const sec = document.getElementById('pageJobs');
    const L = document.getElementById('jobViewList');
    const C = document.getElementById('jobViewCreate');
    const inside = (host, id) => !!(host && document.getElementById(id) &&
                                    host.contains(document.getElementById(id)));
    return {
      tabsInSection: sec.contains(document.getElementById('jobViewTabs')),
      tabsOutsideBoth: !L.contains(document.getElementById('jobViewTabs')) &&
                       !C.contains(document.getElementById('jobViewTabs')),
      /* กลุ่มรายการ */
      statusFilters: inside(L, 'jobStatusFilters'),
      branchFilter: inside(L, 'jobBranchFilter'),
      exportBar: inside(L, 'exportBar'),
      jobList: inside(L, 'jobList'),
      /* กลุ่มฟอร์มสร้าง */
      branchSearch: inside(C, 'branchSearch'),
      newJobAbbr: inside(C, 'newJobAbbr'),
      newRoundName: inside(C, 'newRoundName'),
      newJobStoreType: inside(C, 'newJobStoreType'),
      newJobLocSet: inside(C, 'newJobLocSet'),
      btnAddRound: inside(C, 'btnAddRound'),
      jobCodePreview: inside(C, 'jobCodePreview'),
      /* ต้องไม่ปนกัน */
      listHasForm: L.contains(document.getElementById('btnAddRound')),
      createHasList: C.contains(document.getElementById('jobList')),
      /* .foot อยู่นอกทั้งสอง แต่ยังอยู่ใน section */
      footInSection: sec.contains(sec.querySelector('.foot')),
      footOutsideL: !L.contains(sec.querySelector('.foot')),
      footOutsideC: !C.contains(sec.querySelector('.foot')),
      footIsLast: sec.lastElementChild.className === 'foot',
      /* modeBanner ยังอยู่บนสุด ก่อนแท็บ */
      bannerBeforeTabs: sec.children[0].id === 'modeBanner' && sec.children[1].id === 'jobViewTabs',
      order: Array.prototype.map.call(sec.children, c => c.id || c.className)
    };
  });
  check('แท็บอยู่ใน section และอยู่นอก div ทั้งสอง',
        r1.tabsInSection && r1.tabsOutsideBoth, r1);
  check('modeBanner อยู่บนสุด แล้วตามด้วยแท็บ', r1.bannerBeforeTabs, r1.order);
  check('กลุ่มรายการครบ (ตัวกรอง + สาขา + exportBar + jobList)',
        r1.statusFilters && r1.branchFilter && r1.exportBar && r1.jobList, r1);
  check('กลุ่มฟอร์มครบทุกช่อง',
        r1.branchSearch && r1.newJobAbbr && r1.newRoundName && r1.newJobStoreType &&
        r1.newJobLocSet && r1.btnAddRound && r1.jobCodePreview, r1);
  check('ฟอร์มไม่หลุดไปอยู่ในกลุ่มรายการ', r1.listHasForm === false, r1.listHasForm);
  check('รายการไม่หลุดไปอยู่ในกลุ่มฟอร์ม', r1.createHasList === false, r1.createHasList);
  check('.foot อยู่นอกทั้งสอง div และเป็นตัวสุดท้ายของ section',
        r1.footInSection && r1.footOutsideL && r1.footOutsideC && r1.footIsLast, r1);

  /* ---------- 2. ค่าเริ่มต้น ---------- */
  console.log('\n[2] ค่าเริ่มต้นตอนเปิดแอป');
  const r2 = await page.evaluate(() => ({
    listShown: getComputedStyle(document.getElementById('jobViewList')).display !== 'none',
    createHidden: getComputedStyle(document.getElementById('jobViewCreate')).display === 'none',
    stateDefault: state.jobView,
    listBtnActive: !document.querySelector('#jobViewTabs [data-jobview="list"]').classList.contains('grey'),
    createBtnGrey: document.querySelector('#jobViewTabs [data-jobview="create"]').classList.contains('grey'),
    labels: Array.prototype.map.call(document.querySelectorAll('#jobViewTabs [data-jobview]'),
                                     b => b.textContent)
  }));
  check('เปิดมาเห็นรายการ ฟอร์มถูกซ่อน', r2.listShown && r2.createHidden, r2);
  check('state.jobView ตั้งต้นเป็น list', r2.stateDefault === 'list', r2.stateDefault);
  check('ปุ่มแท็บรายการเป็นสีเข้ม ปุ่มสร้างเป็นสีเทา',
        r2.listBtnActive && r2.createBtnGrey, r2);
  check('ป้ายปุ่มถูกต้อง',
        JSON.stringify(r2.labels) === JSON.stringify(['📋 Job งาน', '➕ สร้าง Job']), r2.labels);

  /* ---------- 3. กดสลับ ---------- */
  console.log('\n[3] กดสลับแท็บ');
  const r3 = await page.evaluate(() => {
    const L = document.getElementById('jobViewList');
    const C = document.getElementById('jobViewCreate');
    const btnL = document.querySelector('#jobViewTabs [data-jobview="list"]');
    const btnC = document.querySelector('#jobViewTabs [data-jobview="create"]');
    const snap = () => ({
      list: getComputedStyle(L).display !== 'none',
      create: getComputedStyle(C).display !== 'none',
      listGrey: btnL.classList.contains('grey'),
      createGrey: btnC.classList.contains('grey'),
      view: state.jobView
    });
    btnC.click(); const afterCreate = snap();
    btnL.click(); const afterList = snap();
    btnC.click(); btnC.click(); const twice = snap();   // กดซ้ำแท็บเดิมต้องไม่พัง
    return { afterCreate: afterCreate, afterList: afterList, twice: twice };
  });
  check('กด "สร้าง Job" → เห็นฟอร์ม ซ่อนรายการ',
        r3.afterCreate.create && !r3.afterCreate.list && r3.afterCreate.view === 'create', r3.afterCreate);
  check('กดแล้วปุ่มสลับสีถูกด้าน',
        r3.afterCreate.listGrey && !r3.afterCreate.createGrey, r3.afterCreate);
  check('กด "Job งาน" → กลับมาเห็นรายการ',
        r3.afterList.list && !r3.afterList.create && r3.afterList.view === 'list', r3.afterList);
  check('กดแท็บเดิมซ้ำสองครั้งยังปกติ',
        r3.twice.create && !r3.twice.list, r3.twice);

  /* ---------- 4. ออกจากหน้าแล้วกลับมา ต้องรีเซ็ตเป็นรายการ ---------- */
  console.log('\n[4] ออกจากหน้า Job แล้วกลับเข้ามา');
  const r4 = await page.evaluate(() => {
    /* กันฟังก์ชันวาดหน้าอื่นไปเรียก Firebase — เราสนใจแค่ showPage('jobs') */
    window.renderJobs = function () {};
    window.renderMaster = function () {};
    setJobView('create');
    const before = state.jobView;
    showPage('master');
    showPage('jobs');
    return {
      before: before,
      after: state.jobView,
      list: getComputedStyle(document.getElementById('jobViewList')).display !== 'none',
      create: getComputedStyle(document.getElementById('jobViewCreate')).display === 'none',
      createGrey: document.querySelector('#jobViewTabs [data-jobview="create"]').classList.contains('grey')
    };
  });
  check('ค้างไว้ที่แท็บฟอร์มก่อนออกจากหน้า', r4.before === 'create', r4.before);
  check('กลับเข้าหน้า Job แล้วเด้งกลับแท็บรายการ', r4.after === 'list', r4.after);
  check('รายการโผล่ ฟอร์มถูกซ่อนอีกครั้ง', r4.list && r4.create, r4);
  check('สีปุ่มถูกรีเซ็ตตาม', r4.createGrey === true, r4.createGrey);

  /* ---------- 5. ค่าที่กรอกค้างในฟอร์มต้องไม่หายตอนสลับแท็บ ---------- */
  console.log('\n[5] สลับแท็บแล้วค่าที่กรอกไว้ไม่หาย');
  const r5 = await page.evaluate(() => {
    setJobView('create');
    document.getElementById('newRoundName').value = 'รอบนับ ส.ค. 2569';
    document.getElementById('newJobAbbr').value = 'CTW';
    setJobView('list');
    setJobView('create');
    return {
      name: document.getElementById('newRoundName').value,
      abbr: document.getElementById('newJobAbbr').value
    };
  });
  check('ชื่อรอบที่พิมพ์ไว้ยังอยู่', r5.name === 'รอบนับ ส.ค. 2569', r5.name);
  check('อักษรย่อสาขาที่พิมพ์ไว้ยังอยู่', r5.abbr === 'CTW', r5.abbr);

  /* ---------- 6. เวอร์ชัน ---------- */
  console.log('\n[6] เวอร์ชัน');
  const r6 = await page.evaluate(() => ({
    v: APP_VERSION,
    meta: document.querySelector('meta[name=version]').content,
    title: document.title,
    foot: document.getElementById('verText').textContent
  }));
  check('APP_VERSION / meta / title ตรงกันทั้ง 3 จุด',
        r6.v === r6.meta && r6.title === 'ISRD Stocktake v' + r6.meta, r6);
  check('เลขเวอร์ชันท้ายหน้า Job แสดงตรงกัน', r6.foot === r6.meta, r6);

  console.log('\n--- console/page errors ---');
  console.log(errors.slice(0, 10).join('\n') || '(none)');
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
