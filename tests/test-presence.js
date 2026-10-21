/* ============================================================
   v2.33.0 — Presence "ผู้ใช้ออนไลน์ + เตะ"
   ============================================================
   แอปเป็น REST ล้วน ไม่มี onDisconnect → ใช้ heartbeat ทุก 45 วิ + ถือว่าออฟไลน์เมื่อเงียบเกิน 90 วิ
   ห้ามใช้ db.subscribe เด็ดขาด (EventSource = กิน connection = ทำลาย LITE_MODE v2.32.0)

   กติกาที่ต้องได้:
     [1]  เวอร์ชัน 2.44.0 ครบ 3 จุด · โหลดแอปไม่มี error
     [2]  presencePatch มีฟิลด์ครบ และ "ไม่มี kickAt" (ไม่งั้นทับคำสั่งเตะ)
     [3]  tick: kickAt > sessionStart = เตะ · kickAt < sessionStart = ไม่เตะ (เข้าใหม่ต้องไม่โดนซ้ำ)
     [4]  tick: autoKick ปิด = ไม่เตะ · เปิด + idle เกิน = เตะ · มีคิวค้าง = รอส่งก่อน
     [5]  tick: เน็ตหลุด = ไม่เตะ ไม่ throw
     [6]  noteActivity throttle 5 วิ
     [7]  presenceStatus: เงียบเกิน 90 วิ / online:false = ⚫ · idle ≥ warn = 🟡 · นอกนั้น 🟢
     [8]  ตาราง admin: แถวเหลือง · ปุ่มเตะตัวเอง disabled · KPI
     [9]  kickUser เขียนแค่ { kickAt } ที่ presence/<uid> · เตะตัวเองไม่ได้ · non-admin ไม่ได้
     [10] startPresence: server timestamp · ไม่ซ้อน interval · stopPresence ล้างได้
     [11] savePresenceConfig ตรวจค่า · เขียน settings { presence }
     [12] source: ไม่มี db.subscribe ในโค้ด presence · hook ใน startApp/forceSignOut/doLogout/boot
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
    const real = {
      update: db.update, getQuiet: db.getQuiet, forceSignOut: window.forceSignOut,
      pendingCount: window.pendingCount, flushQueue: window.flushQueue,
      ensureRoleFresh: window.ensureRoleFresh, ask: window.ask, remote: db.remote
    };
    function restore() {
      db.update = real.update; db.getQuiet = real.getQuiet; db.remote = real.remote;
      window.forceSignOut = real.forceSignOut; window.pendingCount = real.pendingCount;
      window.flushQueue = real.flushQueue; window.ensureRoleFresh = real.ensureRoleFresh;
      window.ask = real.ask;
    }

    out.ver = [document.querySelector('meta[name="version"]').content,
               document.title, APP_VERSION];

    state.me = { uid: 'u_me', name: 'แอดมินทดสอบ', role: 'admin', branches: ['B01', 'B02'], perms: {} };

    /* [2] */
    const p = presencePatch(1234);
    out.patchKeys = Object.keys(p).sort();
    out.patchNoKick = !('kickAt' in p);
    out.patchIdle = p.idleMs === 1234 && p.online === true && p.branch === 'B01,B02';

    /* ตัวจำลองฐานสำหรับ tick */
    function rig(node, opts) {
      opts = opts || {};
      const log = { updates: [], kicked: 0, flushed: 0 };
      db.remote = true;                              // presenceMarkOffline ทำงานเฉพาะฐานจริง
      db.update = function (path, patch) {
        log.updates.push({ path: path, patch: patch });
        return opts.failUpdate ? Promise.reject(new Error('net')) : Promise.resolve(patch);
      };
      db.getQuiet = function (path) {
        if (path === 'settings/presence') return Promise.resolve(opts.cfg || null);
        return Promise.resolve(node);
      };
      window.forceSignOut = function () { log.kicked++; };
      window.pendingCount = function () { return opts.pending || 0; };
      window.flushQueue = function () { log.flushed++; };
      presenceState.kicking = false;
      presenceState.cfgAt = 0;                       // บังคับอ่าน config ใหม่ทุกเคส
      return log;
    }

    /* [3] เตะด้วยมือ */
    presenceState.sessionStart = 1000;
    presenceState.lastActivity = Date.now();
    let log = rig({ lastSeen: 5000, kickAt: 2000 });
    try { sessionStorage.removeItem(PRESENCE_KICK_KEY); } catch (e) {}
    await presenceTick();
    out.kickNewer = log.kicked === 1;
    out.kickMsg = sessionStorage.getItem(PRESENCE_KICK_KEY) === PRESENCE_MSG_ADMIN;
    out.hbFirst = log.updates[0] && log.updates[0].path === 'presence/u_me' && !('kickAt' in log.updates[0].patch);
    out.offlineBeforeOut = log.updates.some(u => u.patch.online === false);
    out.offset = presenceState.offset;

    log = rig({ lastSeen: 5000, kickAt: 500 });
    await presenceTick();
    out.kickOlder = log.kicked === 0;

    /* kicking ค้างอยู่ = tick ไม่ทำอะไรเลย (กันเตะซ้อน) */
    log = rig({ lastSeen: 5000, kickAt: 2000 });
    presenceState.kicking = true;
    await presenceTick();
    out.kickingGuard = log.kicked === 0 && log.updates.length === 0;
    presenceState.kicking = false;

    /* [4] เตะอัตโนมัติ — ใช้ scanner เพราะ admin ได้ยกเว้น (ดูเคส admin ท้ายข้อ) */
    state.me.role = 'scanner';
    presenceState.lastActivity = Date.now() - 40 * 60000;         // นิ่งมา 40 นาที
    log = rig({ lastSeen: 5000 }, { cfg: { autoKick: false, idleKickMin: 30, idleWarnMin: 5 } });
    await presenceTick();
    out.autoOff = log.kicked === 0;

    log = rig({ lastSeen: 5000 }, { cfg: { autoKick: true, idleKickMin: 30, idleWarnMin: 5 } });
    try { sessionStorage.removeItem(PRESENCE_KICK_KEY); } catch (e) {}
    await presenceTick();
    out.autoOn = log.kicked === 1 && sessionStorage.getItem(PRESENCE_KICK_KEY) === PRESENCE_MSG_IDLE;

    log = rig({ lastSeen: 5000 }, { cfg: { autoKick: true, idleKickMin: 30, idleWarnMin: 5 }, pending: 3 });
    await presenceTick();
    out.autoWaitQueue = log.kicked === 0 && log.flushed === 1;

    presenceState.lastActivity = Date.now() - 10 * 60000;         // นิ่ง 10 นาที < 30
    log = rig({ lastSeen: 5000 }, { cfg: { autoKick: true, idleKickMin: 30, idleWarnMin: 5 } });
    await presenceTick();
    out.autoUnder = log.kicked === 0;

    /* admin นิ่งเกินเวลา + autoKick เปิด → ไม่โดนเตะอัตโนมัติ */
    state.me.role = 'admin';
    presenceState.lastActivity = Date.now() - 40 * 60000;
    log = rig({ lastSeen: 5000 }, { cfg: { autoKick: true, idleKickMin: 30, idleWarnMin: 5 } });
    await presenceTick();
    out.autoAdminExempt = log.kicked === 0;
    /* แต่เตะด้วยมือยังได้ */
    log = rig({ lastSeen: 5000, kickAt: 2000 });
    await presenceTick();
    out.manualAdminStill = log.kicked === 1;

    /* [5] เน็ตหลุด */
    presenceState.lastActivity = Date.now() - 40 * 60000;
    log = rig({ lastSeen: 5000, kickAt: 9999 }, { failUpdate: true, cfg: { autoKick: true, idleKickMin: 30, idleWarnMin: 5 } });
    let threw = false;
    try { await presenceTick(); } catch (e) { threw = true; }
    out.netDown = !threw && log.kicked === 0;
    presenceState.lastActivity = Date.now();
    restore();

    /* [6] throttle */
    presenceState.lastActivity = Date.now() - 2000;
    const before = presenceState.lastActivity;
    noteActivity();
    out.throttleHold = presenceState.lastActivity === before;
    presenceState.lastActivity = Date.now() - 6000;
    noteActivity();
    out.throttleMove = Date.now() - presenceState.lastActivity < 1000;
    /* listener ระดับ document ต้องจับ keydown ได้ (เครื่องยิง HID ส่ง keydown) */
    presenceState.lastActivity = Date.now() - 60000;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    out.keydownCaught = Date.now() - presenceState.lastActivity < 1000;

    /* [7] สถานะ */
    const cfg = { autoKick: false, idleKickMin: 30, idleWarnMin: 5 };
    const now = 10000000;
    out.stStale = presenceStatus({ lastSeen: now - 91000, idleMs: 0, online: true }, now, cfg);
    out.stOffFlag = presenceStatus({ lastSeen: now, idleMs: 0, online: false }, now, cfg);
    out.stIdle = presenceStatus({ lastSeen: now - 10000, idleMs: 5 * 60000, online: true }, now, cfg);
    out.stActive = presenceStatus({ lastSeen: now - 10000, idleMs: 60000, online: true }, now, cfg);

    /* [8] ตาราง admin */
    state.users = { u_me: { active: true }, u2: { active: true }, u3: { active: true }, u4: { active: true } };
    presenceState.offset = 0;
    presenceState.cfg = cfg;
    const t = Date.now();
    presenceState.data = {
      u_me: { name: 'แอดมินทดสอบ', role: 'admin', lastSeen: t, idleMs: 0, online: true, sessionStart: t - 3600000, page: 'หน้า Master' },
      u2:   { name: '<b>เอ</b>', role: 'scanner', lastSeen: t, idleMs: 20 * 60000, online: true, sessionStart: t - 7200000, page: 'กำลังยิง · J1 สาขา', ver: '2.33.0' },
      u3:   { name: 'บี', role: 'counter', lastSeen: t - 200000, idleMs: 0, online: true }
    };
    renderPresence();
    const rows = Array.from(document.querySelectorAll('#presBody tr'));
    out.rowCount = rows.length;
    out.firstIdle = rows[0] && rows[0].className === 'pres-idle';
    out.nameSafe = rows[0] && rows[0].querySelector('b') === null && rows[0].textContent.indexOf('<b>เอ</b>') >= 0;
    const selfBtn = document.querySelector('#presBody [data-kick="u_me"]');
    const u2Btn = document.querySelector('#presBody [data-kick="u2"]');
    const u3Btn = document.querySelector('#presBody [data-kick="u3"]');
    out.selfDisabled = !!selfBtn && selfBtn.disabled === true;
    out.otherEnabled = !!u2Btn && u2Btn.disabled === false;
    out.offDisabled = !!u3Btn && u3Btn.disabled === true;
    out.kpi = Array.from(document.querySelectorAll('#presKpi .s-num')).map(e => e.textContent);

    /* [9] kickUser */
    const writes = [];
    db.update = function (path, patch) { writes.push({ path: path, patch: patch }); return Promise.resolve(); };
    db.getQuiet = function () { return Promise.resolve(null); };
    window.ensureRoleFresh = function () { return Promise.resolve(); };
    window.ask = function () { return Promise.resolve(true); };
    await kickUser('u2');
    out.kickWrite = writes[0] && writes[0].path === 'presence/u2' &&
                    JSON.stringify(Object.keys(writes[0].patch)) === '["kickAt"]' &&
                    typeof writes[0].patch.kickAt === 'number';
    writes.length = 0;
    await kickUser('u_me');
    out.kickSelfBlocked = writes.length === 0;
    state.me.role = 'scanner';
    await kickUser('u2');
    out.kickNonAdmin = writes.length === 0;
    if (typeof renderAccount === 'function') renderAccount();
    out.tabHiddenNonAdmin = document.getElementById('tabOnline').style.display === 'none';
    state.me.role = 'admin';
    renderAccount();
    out.tabShownAdmin = document.getElementById('tabOnline').style.display === '';
    restore();

    /* [10] startPresence */
    const w2 = [];
    db.remote = true;
    db.update = function (path, patch) { w2.push({ path: path, patch: patch }); return Promise.resolve(); };
    db.getQuiet = function (path) {
      return Promise.resolve(path === 'settings/presence' ? null : { sessionStart: 777, lastSeen: 777 });
    };
    stopPresence();
    presenceState.sessionStart = null;
    startPresence();
    const t1 = presenceState.timer;
    startPresence();
    out.noDoubleTimer = !!t1 && presenceState.timer === t1;
    out.serverTs = w2[0] && w2[0].patch.sessionStart && w2[0].patch.sessionStart['.sv'] === 'timestamp' &&
                   w2[0].patch.lastSeen['.sv'] === 'timestamp';
    await new Promise(r => setTimeout(r, 50));
    out.sessionFromServer = presenceState.sessionStart === 777;
    stopPresence();
    out.stopped = presenceState.timer === null;
    restore();
    db.remote = false;
    startPresence();
    out.noLocalStart = presenceState.timer === null;
    db.remote = real.remote;

    /* [11] ตั้งค่า */
    const w3 = [];
    db.update = function (path, patch) { w3.push({ path: path, patch: patch }); return Promise.resolve(); };
    document.getElementById('presAutoKick').checked = true;
    document.getElementById('presKickMin').value = '5';
    document.getElementById('presWarnMin').value = '10';
    await savePresenceConfig();
    out.cfgRejectOrder = w3.length === 0;
    document.getElementById('presKickMin').value = 'abc';
    await savePresenceConfig();
    out.cfgRejectText = w3.length === 0;
    document.getElementById('presKickMin').value = '30';
    document.getElementById('presWarnMin').value = '5';
    await savePresenceConfig();
    out.cfgWrite = w3[0] && w3[0].path === 'settings' &&
                   JSON.stringify(w3[0].patch) === JSON.stringify({ presence: { autoKick: true, idleKickMin: 30, idleWarnMin: 5 } });
    out.cfgNorm = JSON.stringify(normPresenceConfig({ autoKick: 'true', idleKickMin: -3 })) ===
                  JSON.stringify({ autoKick: false, idleKickMin: 30, idleWarnMin: 5 });
    restore();

    /* [12] source */
    const presSrc = [presenceTick, startPresence, presenceKick, presenceMarkOffline, refreshPresence,
                     startPresenceWatch, kickUser, savePresenceConfig, loadPresenceConfig]
                    .map(f => f.toString()).join('\n');
    out.noSubscribe = !/subscribe/.test(presSrc);
    out.noFirebaseSet = !/\.set\(/.test(presSrc);
    out.hookStart = /startPresence\(\)/.test(startApp.toString());
    out.hookForce = /stopPresence\(\)/.test(real.forceSignOut.toString());
    out.hookLogout = /presenceMarkOffline\(\)/.test(doLogout.toString()) && /stopPresence\(\)/.test(doLogout.toString());
    out.hookBoot = /takeKickMessage\(\)/.test(boot.toString());
    out.watchStopsOnTab = /stopPresenceWatch\(\)/.test(renderMaster.toString());

    return out;
  });

  console.log('\n[1] เวอร์ชัน + โหลดแอป');
  check('เวอร์ชัน 2.44.0 ครบ 3 จุด',
        r.ver[0] === '2.44.0' && /v2\.44\.0/.test(r.ver[1]) && r.ver[2] === '2.44.0', r.ver);

  console.log('\n[2] presencePatch');
  check('ไม่มี kickAt ใน heartbeat', r.patchNoKick, r.patchKeys);
  check('ฟิลด์ครบ', JSON.stringify(r.patchKeys) ===
        JSON.stringify(['branch', 'idleMs', 'lastSeen', 'name', 'online', 'page', 'role', 'ver']), r.patchKeys);
  check('idleMs / online / branch ถูก', r.patchIdle, r.patchIdle);

  console.log('\n[3] เตะด้วยมือ');
  check('kickAt ใหม่กว่า sessionStart → ออกจากระบบ', r.kickNewer, r.kickNewer);
  check('ฝากข้อความ "ถูกให้ออกโดยผู้ดูแล" ไว้ให้หน้าล็อกอิน', r.kickMsg, r.kickMsg);
  check('heartbeat แรกเขียน presence/<uid> และไม่มี kickAt', r.hbFirst, r.hbFirst);
  check('บอก online:false ก่อนออก', r.offlineBeforeOut, r.offlineBeforeOut);
  check('kickAt เก่ากว่า sessionStart (เข้าใหม่แล้ว) → ไม่เตะซ้ำ', r.kickOlder, r.kickOlder);
  check('กำลังเตะอยู่ → tick ไม่ทำอะไรซ้อน', r.kickingGuard, r.kickingGuard);

  console.log('\n[4] เตะอัตโนมัติ');
  check('autoKick ปิด → ไม่เตะแม้นิ่ง 40 นาที', r.autoOff, r.autoOff);
  check('autoKick เปิด + นิ่งเกิน 30 นาที → เตะ พร้อมข้อความอัตโนมัติ', r.autoOn, r.autoOn);
  check('มีคิวค้างส่ง → ยังไม่เตะ สั่งส่งคิวก่อน', r.autoWaitQueue, r.autoWaitQueue);
  check('นิ่ง 10 นาที (< 30) → ไม่เตะ', r.autoUnder, r.autoUnder);
  check('admin นิ่งเกินเวลา + autoKick เปิด → ไม่โดนเตะอัตโนมัติ', r.autoAdminExempt, r.autoAdminExempt);
  check('admin ยังโดนเตะด้วยมือได้', r.manualAdminStill, r.manualAdminStill);

  console.log('\n[5] เน็ตหลุด');
  check('heartbeat ส่งไม่ได้ → ไม่เตะ ไม่ throw', r.netDown, r.netDown);

  console.log('\n[6] จับการขยับ');
  check('ขยับซ้ำภายใน 5 วิ ไม่อัปเดต (throttle)', r.throttleHold, r.throttleHold);
  check('เกิน 5 วิ อัปเดต', r.throttleMove, r.throttleMove);
  check('keydown ระดับ document ถูกจับ (เครื่องยิง HID)', r.keydownCaught, r.keydownCaught);

  console.log('\n[7] สถานะ');
  check('เงียบเกิน 90 วิ = off', r.stStale === 'off', r.stStale);
  check('online:false = off ทันที', r.stOffFlag === 'off', r.stOffFlag);
  check('นิ่ง ≥ idleWarnMin = idle (เหลือง)', r.stIdle === 'idle', r.stIdle);
  check('นิ่งน้อยกว่า = active', r.stActive === 'active', r.stActive);

  console.log('\n[8] ตาราง admin');
  check('3 แถว', r.rowCount === 3, r.rowCount);
  check('แถวเหลืองขึ้นก่อน + พื้นเหลือง', r.firstIdle, r.firstIdle);
  check('ชื่อผู้ใช้เป็น textContent (ไม่ตีความ HTML)', r.nameSafe, r.nameSafe);
  check('ปุ่มเตะตัวเอง disabled', r.selfDisabled, r.selfDisabled);
  check('ปุ่มเตะคนอื่นกดได้', r.otherEnabled, r.otherEnabled);
  check('คนที่ออฟไลน์แล้ว ปุ่มเตะ disabled', r.offDisabled, r.offDisabled);
  check('KPI 🟢1 🟡1 ⚫2 · 2 / 4 คน', JSON.stringify(r.kpi) === JSON.stringify(['1', '1', '2', '2 / 4 คน']), r.kpi);

  console.log('\n[9] kickUser');
  check('เขียนเฉพาะ { kickAt } ที่ presence/u2', r.kickWrite, r.kickWrite);
  check('เตะตัวเองไม่ได้', r.kickSelfBlocked, r.kickSelfBlocked);
  check('non-admin เตะไม่ได้ (ชั้นฟังก์ชัน)', r.kickNonAdmin, r.kickNonAdmin);
  check('non-admin ไม่เห็นแท็บผู้ใช้ออนไลน์ (ชั้นจอ)', r.tabHiddenNonAdmin, r.tabHiddenNonAdmin);
  check('admin เห็นแท็บ', r.tabShownAdmin, r.tabShownAdmin);

  console.log('\n[10] startPresence');
  check('ใช้ server timestamp กับ sessionStart/lastSeen', r.serverTs, r.serverTs);
  check('เรียกซ้ำไม่ซ้อน interval', r.noDoubleTimer, r.noDoubleTimer);
  check('จำ sessionStart จากเวลา server', r.sessionFromServer, r.sessionFromServer);
  check('stopPresence ล้าง timer', r.stopped, r.stopped);
  check('โหมดทดสอบ (ไม่ต่อฐานจริง) ไม่เริ่ม heartbeat', r.noLocalStart, r.noLocalStart);

  console.log('\n[11] ตั้งค่าเตะอัตโนมัติ');
  check('เหลือง ≥ เตะ → ไม่บันทึก', r.cfgRejectOrder, r.cfgRejectOrder);
  check('ตัวหนังสือ → ไม่บันทึก', r.cfgRejectText, r.cfgRejectText);
  check('ค่าถูก → เขียน settings { presence }', r.cfgWrite, r.cfgWrite);
  check('ค่าเพี้ยนในฐาน → ถอยไปค่าเริ่มต้น', r.cfgNorm, r.cfgNorm);

  console.log('\n[12] โครงโค้ด');
  check('โค้ด presence ไม่ใช้ db.subscribe (ไม่เปิดสายเพิ่ม)', r.noSubscribe, r.noSubscribe);
  check('โค้ด presence ไม่มี .set(', r.noFirebaseSet, r.noFirebaseSet);
  check('startApp เรียก startPresence', r.hookStart, r.hookStart);
  check('forceSignOut เรียก stopPresence', r.hookForce, r.hookForce);
  check('doLogout หยุด heartbeat + บอกออฟไลน์', r.hookLogout, r.hookLogout);
  check('boot โชว์เหตุผลที่ถูกเตะบนหน้าล็อกอิน', r.hookBoot, r.hookBoot);
  check('ออกจากแท็บแล้วหยุด poll', r.watchStopsOnTab, r.watchStopsOnTab);

  check('ไม่มี error ตอนโหลด/รันเทส', errors.length === 0, errors);

  await browser.close();
  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
