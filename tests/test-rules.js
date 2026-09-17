/* ============================================================
   Database Rules — ตารางสิทธิ์ path × role × สถานะ Job (v2.9.0)
   ============================================================

   ทำไมต้องมีเทสนี้:
   การซ่อนปุ่มใน index.html เป็นแค่ความสะดวก ของจริงที่กันคนเขียนข้อมูลคือ
   Database Rules ฝั่ง Firebase ถ้าสองฝั่งไม่ตรงกันจะเจ็บสองแบบ
     Rules หลวมกว่า UI  = มีรูให้เขียนข้อมูลได้ทั้งที่จอไม่ให้ทำ
     Rules แน่นกว่า UI  = จอเปิดให้กด แต่กดแล้วเด้ง "ฐานข้อมูลปฏิเสธการเขียน"
   ทั้งสองเคยเกิดจริงมาแล้ว (v2.9.0 เปิดให้ scanner พิมพ์หมายเหตุที่จอ
   แต่ Rules ยังกันอยู่ — หมายเหตุขึ้นบนจอแล้วหายตอนรีเฟรช)

   เทสนี้ไม่ยิงฐานจริง แต่ "ประเมินนิพจน์ .write ตัวจริง" จากไฟล์ Rules
   โดยจำลอง root / auth / data / newData ตามที่ RTDB ส่งให้ แล้วเทียบกับ
   ตารางสิทธิ์ที่ตกลงกันไว้ ทุก path × ทุก role × ทุกสถานะ Job

   ต่างจากเทสไฟล์อื่น: ไม่ต้องใช้ Chrome เพราะไม่ได้แตะ DOM เลย
   รัน: node tests/test-rules.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  ' + JSON.stringify(got)); }
}

const RULES_FILE = path.join(__dirname, '..', 'stocktake-rules-v2.1.3.json');
const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));

/* ---------- จำลองฐานข้อมูลเท่าที่กฎอ้างถึง ---------- */
function makeDb(role, roundStatus) {
  return {
    stocktake2026: {
      users: { u_me: { name: 'ผู้ใช้ทดสอบ', role: role, active: true } },
      roundIndex: { R1: { jobCode: 'J1', branchCode: 'B1', status: roundStatus } },
      cycles: { C1: { status: 'counting' } }
    }
  };
}

/* ในภาษา Rules สตริงมีเมธอด matches() ให้ใช้ — JS ไม่มี ต้องเติมเอง */
String.prototype.matches = function (re) { return re.test(this.valueOf()); };

/* DataSnapshot จำลอง — รองรับเมธอดเท่าที่ไฟล์ Rules เรียกใช้จริง */
function snap(node) {
  return {
    child: function (p) {
      let cur = node;
      String(p).split('/').filter(Boolean).forEach(function (seg) {
        cur = (cur && typeof cur === 'object') ? cur[seg] : undefined;
      });
      return snap(cur);
    },
    val: function () { return node === undefined ? null : node; },
    exists: function () { return node !== undefined && node !== null; },
    hasChildren: function (keys) {
      return keys.every(function (k) { return node && node[k] !== undefined; });
    },
    isNumber: function () { return typeof node === 'number'; },
    isString: function () { return typeof node === 'string'; },
    isBoolean: function () { return typeof node === 'boolean'; }
  };
}

/* นิพจน์ Rules เขียนด้วยไวยากรณ์ย่อยของ JS จึงประเมินด้วย Function ได้ตรง ๆ */
function evalRule(expr, ctx) {
  const fn = new Function('root', 'auth', 'data', 'newData', '$roundId', '$cycleId', '$uid',
                          'return (' + expr + ');');
  return !!fn(snap(ctx.db), ctx.auth, snap(ctx.existing), snap(ctx.incoming),
              'R1', 'C1', 'u_me');
}

function canWrite(expr, role, roundStatus, extra) {
  extra = extra || {};
  return evalRule(expr, {
    db: makeDb(role, roundStatus),
    auth: { uid: 'u_me' },
    existing: extra.existing,
    incoming: extra.incoming === undefined ? { x: 1 } : extra.incoming
  });
}

const S = rules.rules.stocktake2026;
const R = S.rounds.$roundId;
const C = S.cycles.$cycleId;
const ROLES = ['admin', 'counter', 'scanner', 'viewer'];
const STATUSES = ['counting', 'reviewing', 'closed'];

/* ---------- ตารางสิทธิ์ที่ตกลงกันไว้ ----------
   ค่าคือ "รายชื่อ role ที่เขียนได้" ในสถานะนั้น · [] = ห้ามทุกคน
   แถวไหนเขียนเป็นฟังก์ชัน = สิทธิ์เปลี่ยนตามสถานะ Job */
const A_C = ['admin', 'counter'];
const A_C_S = ['admin', 'counter', 'scanner'];

const MATRIX = [
  /* ---- ข้อมูลกลางของบริษัท: admin เท่านั้น ไม่เกี่ยวกับสถานะ Job ---- */
  /* ⭐ v2.1.3 — counter ต้องเขียน products ได้ด้วย ไม่ใช่แค่ admin
     applyImport() เขียนสินค้าใหม่จากไฟล์ Zort ลง products เป็นก้าวแรกของการนำเข้ายอดระบบ
     ถ้าให้เฉพาะ admin ผู้นับสต๊อกทุกคนจะนำเข้าไม่ได้เลย (ดูข้อ [9]) */
  { path: 'products',   rule: S.products['.write'],   want: function () { return A_C; } },
  { path: 'branches',   rule: S.branches['.write'],   want: function () { return ['admin']; } },
  { path: 'locations',  rule: S.locations['.write'],  want: function () { return ['admin']; } },
  { path: 'settings',   rule: S.settings['.write'],   want: function () { return ['admin']; } },
  { path: 'users/$uid', rule: S.users.$uid['.write'], want: function () { return ['admin']; },
    extra: { incoming: { name: 'x', role: 'counter', active: true } } },

  /* ---- การนับ: เขียนได้เฉพาะรอบที่ยังนับอยู่ ----
     scans เป็น append-only (!data.exists()) ตามกฎบ้าน "ห้ามลบยอดที่นับไปแล้ว" */
  { path: 'rounds/$id/scans/$scanId', rule: R.scans.$scanId['.write'],
    want: function (st) { return st === 'counting' ? A_C_S : []; },
    extra: { existing: undefined,
             incoming: { code: 'A1', zone: 'no-zone', delta: 0, user: 'ผู้ใช้', ts: 1, mode: 'remark' } } },
  /* ⭐ v2.10.10 — ล้างยอดของผู้ใช้: admin "ลบ" แถว scan ได้ เฉพาะรอบที่ยังนับอยู่
     เป็นข้อยกเว้นเดียวของกฎ append-only (ดู CLAUDE.md) จึงต้องล็อกไว้แน่นที่สุด
     แถวนี้ตรวจ "การลบ" โดยเฉพาะ: data มีอยู่ + newData ไม่มี = เขียน null */
  { path: 'rounds/$id/scans/$scanId (ลบแถว)', rule: R.scans.$scanId['.write'],
    want: function (st) { return st === 'counting' ? ['admin'] : []; },
    /* incoming เป็น null ไม่ใช่ undefined — ตัวช่วยในไฟล์นี้แปลง undefined เป็นค่า default ให้
       null คือสิ่งที่ RTDB ส่งมาจริงตอนลบ (newData ไม่มีอยู่) */
    extra: { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
             incoming: null } },
  /* แก้ทับแถวเดิมต้องห้ามทุกคนทุกสถานะ — อันตรายกว่าลบ เพราะตรวจย้อนไม่เห็นว่าเลขเคยเป็นเท่าไหร่ */
  { path: 'rounds/$id/scans/$scanId (แก้ทับ)', rule: R.scans.$scanId['.write'],
    want: function () { return []; },
    extra: { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
             incoming: { code: 'A1', zone: 'no-zone', delta: 99, user: 'Gift', ts: 1 } } },
  { path: 'rounds/$id/purgeLog', rule: R.purgeLog['.write'],
    want: function (st) { return st === 'counting' ? ['admin'] : []; },
    extra: { incoming: { at: 1, by: 'isrd', targetUser: 'Gift' } } },

  /* ⭐ v2.10.0 — ยอดสรุปของรอบ (stat/skuQty) เงื่อนไขเดียวกับ scans เป๊ะ
     ต่างจุดเดียวคือเขียนทับได้ (ไม่มี !data.exists()) เพราะเป็นยอดสะสมที่ต้องอัปเดตเรื่อย ๆ
     ถ้าวันไหนสองอันนี้หลุดจากกัน = คนยิงได้แต่ยอดสรุปไม่ขึ้น (หรือกลับกัน) ต้องดังตรงนี้ */
  { path: 'rounds/$id/stat', rule: R.stat['.write'],
    want: function (st) { return st === 'counting' ? A_C_S : []; },
    extra: { existing: { pieces: 1 }, incoming: { pieces: 2, skus: 1, lastAt: 5, ver: 1 } } },
  { path: 'rounds/$id/skuQty', rule: R.skuQty['.write'],
    want: function (st) { return st === 'counting' ? A_C_S : []; },
    extra: { existing: { A1: 1 }, incoming: { A1: 2 } } },
  { path: 'rounds/$id/unknown/$id', rule: R.unknown.$id['.write'],
    want: function (st) { return st === 'counting' ? A_C_S : []; },
    extra: { existing: undefined, incoming: { value: 'X' } } },
  { path: 'rounds/$id/systemQty', rule: R.systemQty['.write'],
    want: function (st) { return st === 'counting' ? A_C : []; } },
  { path: 'rounds/$id/transfers', rule: R.transfers['.write'],
    want: function (st) { return st === 'counting' ? A_C : []; } },

  /* ---- หมายเหตุ ----
     v2.9.0: scanner พิมพ์ได้ "ตอนยิง" เท่านั้น ให้ตรงกับ canScan() ในแอป
     admin/counter ยังแก้ได้ถึงขั้นตรวจสอบ (เหมือน docNo/docType) */
  { path: 'rounds/$id/reasons', rule: R.reasons['.write'],
    want: function (st) {
      if (st === 'counting') return A_C_S;
      if (st === 'reviewing') return A_C;
      return [];
    },
    extra: { incoming: 'ของชำรุด 2 ชิ้น' } },

  /* ---- โซนและเอกสาร: ปิดรอบแล้วแก้ไม่ได้ ---- */
  { path: 'rounds/$id/zones', rule: R.zones['.write'],
    want: function (st) { return st === 'closed' ? [] : A_C; },
    extra: { incoming: { A: 1 } } },
  { path: 'rounds/$id/docNo', rule: R.docNo['.write'],
    want: function (st) { return st === 'closed' ? [] : A_C; },
    extra: { incoming: 'D-1' } },
  { path: 'rounds/$id/docType', rule: R.docType['.write'],
    want: function (st) { return st === 'closed' ? [] : A_C; },
    extra: { incoming: 'stockTake' } },
  { path: 'rounds/$id/transferNo', rule: R.transferNo['.write'],
    want: function (st) { return st === 'closed' ? [] : A_C; },
    extra: { incoming: 'T-1' } },

  /* ---- schema: จงใจไม่ล็อกตามสถานะ ----
     เป็นธงบอกเวอร์ชันโครงข้อมูล ที่ migrateRoundIfNeeded() เขียนตอนย้ายข้อมูลเก่า
     รอบเก่าก่อน v2.1.1 จำนวนมากปิดไปแล้ว ถ้าล็อกตามสถานะจะย้ายข้อมูลไม่ได้เลย
     ห้ามเผลอ "แก้ให้เหมือนพี่น้อง" — มันตั้งใจต่างตรงนี้ */
  { path: 'rounds/$id/schema', rule: R.schema['.write'],
    want: function () { return A_C; }, extra: { incoming: 2 } },

  /* ---- ของเก่าที่เลิกใช้แล้ว: ห้ามเขียนถาวร ---- */
  { path: 'rounds/$id/counts', rule: String(R.counts['.write']),
    want: function () { return []; } },
  { path: 'rounds/$id/items', rule: String(R.items['.write']),
    want: function () { return []; } }
];

/* ---------- 1. ตารางสิทธิ์ทั้งแผง ---------- */
console.log('\n[1] ตารางสิทธิ์ path × role × สถานะ Job');
STATUSES.forEach(function (st) {
  MATRIX.forEach(function (row) {
    const want = row.want(st).slice().sort();
    const got = ROLES.filter(function (role) {
      return canWrite(row.rule, role, st, row.extra);
    }).sort();
    check(row.path + ' @' + st + ' → ' + (want.length ? want.join('+') : 'ห้ามทุกคน'),
          JSON.stringify(got) === JSON.stringify(want), { got: got, want: want });
  });
});

/* ---------- 2. viewer ห้ามเขียนอะไรได้เลย ----------
   ข้อนี้แยกออกมาเพราะเป็นเส้นตายของสิทธิ์ "ดูอย่างเดียว"
   ถ้าวันหนึ่งมีคนเผลอเติม viewer ลงใน regex ของ path ไหน ต้องดังตรงนี้ทันที */
console.log('\n[2] viewer — ดูอย่างเดียว ห้ามเขียนทุก path ทุกสถานะ');
const leaks = [];
STATUSES.forEach(function (st) {
  MATRIX.forEach(function (row) {
    if (canWrite(row.rule, 'viewer', st, row.extra)) leaks.push(row.path + '@' + st);
  });
});
check('viewer เขียนไม่ได้เลยสักที่', leaks.length === 0, leaks);

/* ---------- 3. scanner เขียนได้เฉพาะที่ควรได้ ---------- */
console.log('\n[3] scanner — ยิงกับใส่หมายเหตุได้ นอกนั้นห้าม');
const scannerOk = [];
MATRIX.forEach(function (row) {
  if (canWrite(row.rule, 'scanner', 'counting', row.extra)) scannerOk.push(row.path);
});
/* v2.10.0 — stat/skuQty เข้ามาอยู่ในลิสต์นี้ด้วยโดยตั้งใจ
   scanner ยิงบาร์โค้ดได้ ก็ต้องอัปเดตยอดสรุปของรอบได้ ไม่งั้นเด็กหน้าร้านยิงไปทั้งวัน
   แล้วยอดสรุปไม่ขยับเลย (ยอดนับถูก แต่ตัวเลขบนการ์ดค้าง) */
check('ตอนนับ scanner เขียนได้แค่ scans · unknown · reasons · stat · skuQty',
      JSON.stringify(scannerOk.sort()) === JSON.stringify(
        ['rounds/$id/reasons', 'rounds/$id/scans/$scanId', 'rounds/$id/skuQty',
         'rounds/$id/stat', 'rounds/$id/unknown/$id']),
      scannerOk);
check('รอบส่งตรวจแล้ว scanner เขียนหมายเหตุไม่ได้',
      canWrite(R.reasons['.write'], 'scanner', 'reviewing') === false, 'reviewing');
check('รอบปิดแล้ว scanner เขียนหมายเหตุไม่ได้',
      canWrite(R.reasons['.write'], 'scanner', 'closed') === false, 'closed');

/* ---------- 4. Master เป็นของ admin คนเดียว ---------- */
console.log('\n[4] Location/สาขา/settings — admin เท่านั้น');
/* products ถูกย้ายออกจากกลุ่มนี้ตั้งแต่ v2.1.3 — counter ต้องเขียนได้เพื่อนำเข้ายอดระบบ
   สามตัวที่เหลือยังเป็นข้อมูลกลางที่ admin คุมคนเดียวจริง ๆ */
['locations', 'branches', 'settings'].forEach(function (p) {
  const others = ['counter', 'scanner', 'viewer'].filter(function (role) {
    return STATUSES.some(function (st) { return canWrite(S[p]['.write'], role, st); });
  });
  check(p + ': counter/scanner/viewer แก้ไม่ได้เลย', others.length === 0, others);
  check(p + ': admin แก้ได้', canWrite(S[p]['.write'], 'admin', 'counting') === true, p);
});
check('products: scanner/viewer ยังแก้ไม่ได้',
      ['scanner', 'viewer'].every(function (role) {
        return STATUSES.every(function (st) { return !canWrite(S.products['.write'], role, st); });
      }), 'products');

/* ---------- 5. บัญชีที่ถูกปิดใช้งาน เขียนไม่ได้แม้เป็น admin ----------
   active=false คือปุ่มถอนสิทธิ์ฉุกเฉิน ต้องได้ผลทันทีทุก path ไม่ใช่แค่ซ่อนปุ่ม */
console.log('\n[5] บัญชีถูกปิดใช้งาน (active=false) ต้องเขียนไม่ได้');
function canWriteInactive(expr, role, extra) {
  extra = extra || {};
  const db = makeDb(role, 'counting');
  db.stocktake2026.users.u_me.active = false;
  return evalRule(expr, {
    db: db, auth: { uid: 'u_me' },
    existing: extra.existing,
    incoming: extra.incoming === undefined ? { x: 1 } : extra.incoming
  });
}
const inactiveLeaks = [];
MATRIX.forEach(function (row) {
  ROLES.forEach(function (role) {
    if (canWriteInactive(row.rule, role, row.extra)) inactiveLeaks.push(row.path + '/' + role);
  });
});
check('ปิดใช้งานแล้วเขียนไม่ได้ทุก path ทุก role', inactiveLeaks.length === 0, inactiveLeaks);

/* ---------- 6. ไม่ได้ล็อกอิน เขียนไม่ได้ ---------- */
console.log('\n[6] ไม่ได้ล็อกอิน (auth = null)');
const anonLeaks = [];
MATRIX.forEach(function (row) {
  const extra = row.extra || {};
  let ok;
  try {
    ok = evalRule(row.rule, {
      db: makeDb('admin', 'counting'), auth: null,
      existing: extra.existing,
      incoming: extra.incoming === undefined ? { x: 1 } : extra.incoming
    });
  } catch (e) { ok = false; }      // auth.uid บน null โยน = เขียนไม่ได้อยู่ดี
  if (ok) anonLeaks.push(row.path);
});
check('คนไม่ได้ล็อกอินเขียนไม่ได้เลย', anonLeaks.length === 0, anonLeaks);

/* ---------- 7. โครงไฟล์ที่ต้องไม่หาย ---------- */
console.log('\n[7] โครงไฟล์ Rules');
check('รากปิดไว้ทั้ง read และ write',
      rules.rules['.read'] === false && rules.rules['.write'] === false, rules.rules['.read']);
check('stocktake2026 เขียนที่ระดับบนไม่ได้ (ต้องลงไปทีละ path)',
      S['.write'] === false, S['.write']);
check('อ่านได้เฉพาะผู้ใช้ที่ยัง active', /active/.test(String(S['.read'])), S['.read']);
/* WMS Dashboard ใช้ฐานเดียวกัน ถ้าบล็อกนี้หายตอนวาง Rules ใหม่ ระบบนั้นจะเขียนไม่ได้ทันที */
check('บล็อก wms2026 ยังอยู่ (ห้ามหายตอน publish)',
      !!rules.rules.wms2026 && rules.rules.wms2026['.write'] === true, rules.rules.wms2026);

/* ============================================================
   [8] สิทธิ์แบบติ๊กความสามารถ (perms) — v2.12.0
   ============================================================

   กติกาของ Rules ชุดนี้: เงื่อนไขทุก path เขียนเป็น
     (เงื่อนไข role เดิม) || (perms/<cap> === true)
   จงใจไม่ตัดท่อน role เดิมทิ้ง เพราะผู้ใช้ 15 คนเดิมยังไม่มีฟิลด์ perms ในฐาน
   ถ้าตัด พวกเขาจะหลุดสิทธิ์ทันทีที่กด Publish (ข้อ [1] ข้างบนคือตัวคุมเรื่องนี้)

   ส่วนข้อนี้คุมอีกด้าน: ติ๊ก cap ให้แล้วต้องเขียนได้จริง และติ๊กผิดช่องต้องเขียนไม่ได้
   ============================================================ */
console.log('\n[8] perms — ติ๊ก cap แล้วเขียนได้จริง (custom user)');

const ALL_CAPS = ['scan', 'seeSystemQty', 'createJob', 'closeJob', 'editMaster', 'editLocation',
                  'importSysQty', 'adjustCount', 'viewSummary', 'docs', 'editDoc', 'viewMasterLoc',
                  'deleteJob', 'reopenRound', 'purgeUser'];

/* ผู้ใช้ role 'custom' ที่ติ๊กเฉพาะ cap ที่ระบุ */
function canWriteCaps(expr, caps, roundStatus, extra, cycleStatus) {
  extra = extra || {};
  const db = makeDb('custom', roundStatus);
  const perms = {};
  caps.forEach(function (c) { perms[c] = true; });
  db.stocktake2026.users.u_me.perms = perms;
  if (cycleStatus) db.stocktake2026.cycles.C1.status = cycleStatus;
  return evalRule(expr, {
    db: db, auth: { uid: 'u_me' },
    existing: extra.existing,
    incoming: extra.incoming === undefined ? { x: 1 } : extra.incoming
  });
}

/* cap ที่ควรปลดล็อก path นั้น · สถานะ Job ที่ควรเขียนได้ */
const PERM_ROWS = [
  /* products ปลดล็อกได้สองทาง: editMaster (แก้ทะเบียนตรง ๆ)
     และ importSysQty เพราะ applyImport() เขียนสินค้าใหม่จากไฟล์ Zort ลง products ก่อนเสมอ */
  { path: 'products',   rule: S.products['.write'],   cap: 'editMaster',   st: STATUSES,
    also: ['importSysQty'] },
  { path: 'settings',   rule: S.settings['.write'],   cap: 'editMaster',   st: STATUSES },
  { path: 'locations',  rule: S.locations['.write'],  cap: 'editLocation', st: STATUSES },
  { path: 'branches',   rule: S.branches['.write'],   cap: 'editLocation', st: STATUSES },
  { path: 'rounds/$id/schema',    rule: R.schema['.write'],    cap: 'importSysQty', st: STATUSES,
    extra: { incoming: 2 } },
  { path: 'rounds/$id/systemQty', rule: R.systemQty['.write'], cap: 'importSysQty', st: ['counting'] },
  { path: 'rounds/$id/transfers', rule: R.transfers['.write'], cap: 'importSysQty', st: ['counting'] },
  { path: 'rounds/$id/docNo',     rule: R.docNo['.write'],     cap: 'editDoc',
    st: ['counting', 'reviewing'], extra: { incoming: 'D-1' } },
  { path: 'rounds/$id/docType',   rule: R.docType['.write'],   cap: 'editDoc',
    st: ['counting', 'reviewing'], extra: { incoming: 'stockTake' } },
  { path: 'rounds/$id/transferNo', rule: R.transferNo['.write'], cap: 'editDoc',
    st: ['counting', 'reviewing'], extra: { incoming: 'T-1' } },
  { path: 'rounds/$id/reasons',   rule: R.reasons['.write'],   cap: 'editDoc',
    st: ['counting', 'reviewing'], also: ['scan'], extra: { incoming: 'ของชำรุด' } },
  { path: 'rounds/$id/purgeLog',  rule: R.purgeLog['.write'],  cap: 'purgeUser', st: ['counting'],
    extra: { incoming: { at: 1, by: 'isrd', targetUser: 'Gift' } } },
  { path: 'rounds/$id/stat',      rule: R.stat['.write'],      cap: 'scan', st: ['counting'],
    also: ['adjustCount'],
    extra: { existing: { pieces: 1 }, incoming: { pieces: 2, skus: 1, lastAt: 5, ver: 1 } } },
  { path: 'rounds/$id/skuQty',    rule: R.skuQty['.write'],    cap: 'scan', st: ['counting'],
    also: ['adjustCount'],
    extra: { existing: { A1: 1 }, incoming: { A1: 2 } } },
  { path: 'rounds/$id/unknown/$id', rule: R.unknown.$id['.write'], cap: 'scan', st: ['counting'],
    also: ['adjustCount'],
    extra: { existing: undefined, incoming: { value: 'X' } } },
  { path: 'rounds/$id/scans/$scanId', rule: R.scans.$scanId['.write'], cap: 'scan', st: ['counting'],
    also: ['adjustCount'],
    extra: { existing: undefined,
             incoming: { code: 'A1', zone: 'no-zone', delta: 1, user: 'ท', ts: 1 } } },
  { path: 'rounds/$id/scans/$scanId (ลบแถว)', rule: R.scans.$scanId['.write'], cap: 'purgeUser',
    st: ['counting'],
    extra: { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
             incoming: null } },
  { path: 'docCounters/$b/$k/$ym', rule: S.docCounters.$branch.$kind.$yearMonth['.write'],
    cap: 'editDoc', st: STATUSES, extra: { incoming: 5 } }
];

PERM_ROWS.forEach(function (row) {
  const good = row.st.every(function (st) {
    return canWriteCaps(row.rule, [row.cap], st, row.extra);
  });
  check('ติ๊ก ' + row.cap + ' แล้วเขียน ' + row.path + ' ได้', good,
        { path: row.path, cap: row.cap, st: row.st });

  /* ติ๊กครบทุกช่อง "ยกเว้น" ช่องนี้ ต้องเขียนไม่ได้ — พิสูจน์ว่ากฎดูที่ cap ของตัวเองจริง
     ไม่ใช่บังเอิญผ่านเพราะ cap อื่นในนิพจน์เดียวกัน */
  const also = row.also || [];
  const others = ALL_CAPS.filter(function (c) { return c !== row.cap && also.indexOf(c) < 0; });
  const leaked = row.st.filter(function (st) {
    return canWriteCaps(row.rule, others, st, row.extra);
  });
  check('ไม่ติ๊ก ' + [row.cap].concat(also).join('/') + ' แล้วเขียน ' + row.path + ' ไม่ได้',
        leaked.length === 0, { path: row.path, leakedAt: leaked });
});

/* ⭐ บั๊กที่เจอตอน v2.1.2 — เคยให้เฉพาะ editMaster เขียน products ได้
   แต่ applyImport() (ด่าน importSysQty) เขียน products ก่อนเขียนยอดระบบเสมอ
   คนที่ติ๊กแค่ importSysQty จึงโดน 401 ตั้งแต่ก้าวแรก นำเข้ายอดระบบไม่ได้เลย
   ถ้าวันหลังมีคนไปตัดท่อน importSysQty ออกจาก products ต้องดังตรงนี้ */
console.log('\n[8a] ⭐ importSysQty ต้องเขียน products ได้ (applyImport เขียนสินค้าใหม่ลงทะเบียน)');
check('ติ๊กแค่ importSysQty ก็เขียน products ได้',
      canWriteCaps(S.products['.write'], ['importSysQty'], 'counting') === true, 'products');
check('เขียน cycles/systemQty ได้ในคำขอเดียวกัน',
      canWriteCaps(C.systemQty['.write'], ['importSysQty'], 'counting') === true, 'systemQty');
check('แต่ยังแก้ locations/branches ไม่ได้ (คนละ cap)',
      canWriteCaps(S.locations['.write'], ['importSysQty'], 'counting') === false &&
      canWriteCaps(S.branches['.write'], ['importSysQty'], 'counting') === false, 'loc/branch');
check('cap อื่นที่ไม่เกี่ยวยังเขียน products ไม่ได้',
      ['scan', 'closeJob', 'docs', 'purgeUser'].every(function (c) {
        return canWriteCaps(S.products['.write'], [c], 'counting') === false;
      }), 'others');

console.log('\n[8b] adjustCount — แก้ยอดที่นับไปแล้วต้องเขียน scans/stat/skuQty ได้');
['stat', 'skuQty'].forEach(function (k) {
  check('adjustCount เขียน rounds/$id/' + k + ' ได้',
        canWriteCaps(R[k]['.write'], ['adjustCount'], 'counting',
          { existing: { A1: 1 }, incoming: { A1: 2 } }) === true, k);
});
check('adjustCount เขียนแถว scan ใหม่ได้ (การหักยอดคือการเขียนแถวใหม่ ไม่ใช่ลบ)',
      canWriteCaps(R.scans.$scanId['.write'], ['adjustCount'], 'counting',
        { existing: undefined,
          incoming: { code: 'A1', zone: 'no-zone', delta: -1, user: 'ท', ts: 1 } }) === true, 'adjust');
check('⭐ adjustCount ลบแถว scan ไม่ได้ (ข้อยกเว้นเป็นของ purgeUser เท่านั้น)',
      canWriteCaps(R.scans.$scanId['.write'], ['adjustCount'], 'counting',
        { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
          incoming: null }) === false, 'adjust delete');

console.log('\n[8c] กฎบ้านที่ห้ามผ่อน — แก้ทับแถว scan');
check('⭐ ติ๊กครบทุก cap ก็ยังแก้ทับแถว scan ไม่ได้',
      STATUSES.every(function (st) {
        return canWriteCaps(R.scans.$scanId['.write'], ALL_CAPS, st,
          { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
            incoming: { code: 'A1', zone: 'no-zone', delta: 99, user: 'Gift', ts: 1 } }) === false;
      }), 'overwrite');
check('⭐ ติ๊กครบทุก cap ก็ยังลบแถว scan นอกรอบ counting ไม่ได้',
      ['reviewing', 'closed'].every(function (st) {
        return canWriteCaps(R.scans.$scanId['.write'], ALL_CAPS, st,
          { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
            incoming: null }) === false;
      }), 'delete outside counting');

console.log('\n[8d] ทะเบียนผู้ใช้ — ไม่มี cap ไหนปลดล็อกได้ (admin เท่านั้น)');
check('⭐ custom ที่ติ๊กครบทุกช่องก็เขียน users/ ไม่ได้',
      canWriteCaps(S.users.$uid['.write'], ALL_CAPS, 'counting',
        { incoming: { name: 'x', role: 'counter', active: true } }) === false, 'users');
check('นิพจน์ users/ ไม่มีการอ้าง perms เลย', !/perms\//.test(S.users.$uid['.write']),
      S.users.$uid['.write'].slice(0, 60));
check("role/.validate ยอมรับ custom",
      /custom/.test(S.users.$uid.role['.validate']), S.users.$uid.role['.validate']);
check('perms รับเฉพาะ boolean',
      S.users.$uid.perms.$cap['.validate'] === 'newData.isBoolean()', S.users.$uid.perms);

console.log('\n[8e] custom ที่ไม่ติ๊กอะไรเลย = เขียนไม่ได้สักที่');
const emptyLeaks = [];
STATUSES.forEach(function (st) {
  MATRIX.forEach(function (row) {
    if (canWriteCaps(row.rule, [], st, row.extra)) emptyLeaks.push(row.path + '@' + st);
  });
});
check('custom เปล่าเขียนไม่ได้เลย', emptyLeaks.length === 0, emptyLeaks);

console.log('\n[8f] cap ฝั่งแสดงผลต้องไม่ปลดล็อกการเขียนอะไรเลย');
/* viewSummary · docs · viewMasterLoc · seeSystemQty คุมที่จอพอ ตามที่ตกลงกันไว้
   ถ้าวันหนึ่งมีคนเผลอเอาไปใส่ในนิพจน์ .write ต้องดังตรงนี้ */
const VIEW_ONLY = ['viewSummary', 'docs', 'viewMasterLoc', 'seeSystemQty'];
const viewLeaks = [];
STATUSES.forEach(function (st) {
  MATRIX.forEach(function (row) {
    if (canWriteCaps(row.rule, VIEW_ONLY, st, row.extra)) viewLeaks.push(row.path + '@' + st);
  });
});
check('cap ดูอย่างเดียวเขียนไม่ได้เลย', viewLeaks.length === 0, viewLeaks);

console.log('\n[8g] รอบที่ปิดแล้ว + การลบ Job');
check('closeJob ปิดรอบได้ แต่เปิดรอบที่ปิดแล้วไม่ได้',
      canWriteCaps(C.status['.write'], ['closeJob'], 'counting', { existing: 'counting', incoming: 'closed' }) === true &&
      canWriteCaps(C.status['.write'], ['closeJob'], 'counting', { existing: 'closed', incoming: 'counting' }) === false,
      'closeJob');
check('⭐ reopenRound เปิดรอบที่ปิดแล้วได้',
      canWriteCaps(C.status['.write'], ['closeJob', 'reopenRound'], 'counting',
        { existing: 'closed', incoming: 'counting' }) === true, 'reopenRound');
check('createJob สร้าง Job ได้ แต่ลบไม่ได้',
      canWriteCaps(S.roundIndex.$roundId['.write'], ['createJob'], 'counting',
        { existing: undefined, incoming: { jobCode: 'J1', branchCode: 'B1', status: 'counting' } }) === true &&
      canWriteCaps(S.roundIndex.$roundId['.write'], ['createJob'], 'counting',
        { existing: { jobCode: 'J1', branchCode: 'B1', status: 'counting' }, incoming: null }) === false,
      'createJob');
check('⭐ deleteJob ลบ Job ได้',
      canWriteCaps(S.roundIndex.$roundId['.write'], ['createJob', 'deleteJob'], 'counting',
        { existing: { jobCode: 'J1', branchCode: 'B1', status: 'counting' }, incoming: null }) === true,
      'deleteJob');
check('ไม่มี reopenRound แล้วแตะ Job ที่ปิดแล้วไม่ได้',
      canWriteCaps(S.roundIndex.$roundId['.write'], ['createJob', 'closeJob', 'editDoc'], 'closed',
        { existing: { jobCode: 'J1', branchCode: 'B1', status: 'closed' },
          incoming: { jobCode: 'J1', branchCode: 'B1', status: 'counting' } }) === false, 'closed');

/* ============================================================
   [9] ⭐ ผู้ใช้ที่ได้สิทธิ์จาก role อย่างเดียว (ไม่มี perms node ในฐาน)
   ============================================================

   กติกาที่คุมตรงนี้ — และเป็นคลาสของบั๊กที่เทสเดิมมองไม่เห็นมาตลอด:

     ฝั่งแอป  myPerms() แปลง role เป็น perms ให้เองเมื่อฐานไม่มีฟิลด์ perms
     ฝั่ง Rules  อ่านได้เฉพาะสิ่งที่มีอยู่จริง — perms/<cap> ที่ไม่มี node = false เสมอ

   Rules จึง derive จาก role ไม่ได้ ทุก cap ที่แม่แบบของ role ไหนได้
   ต้องมีท่อน role.matches(...) ครอบคลุมใน Rules ด้วย ไม่งั้นได้อาการ
   "ปุ่มกดได้ แต่ฐานเด้ง 401" กับผู้ใช้เดิมทุกคนที่ยังไม่เคยถูกติ๊ก perms

   เคสจริง (v2.1.3): products ยอมแค่ role === 'admin' แต่ counter ได้ importSysQty
   จากแม่แบบ → applyImport() เขียน products เป็นก้าวแรก → ผู้นับสต๊อกทุกคนอัปไม่ได้

   ทำไมเทสเดิม 137 ข้อจับไม่ได้: fixture makeDb() สร้าง user แบบ role-only อยู่แล้ว
   (ไม่มี perms node) — ปัญหาไม่ได้อยู่ที่ fixture แต่อยู่ที่ค่า want ของแถว products
   ซึ่งเขียนไว้ว่า ['admin'] คือ "เอาสิ่งที่กฎทำอยู่มาเป็นคำตอบที่ถูก"
   แทนที่จะเขียนจาก "แอปต้องการอะไร" ข้อ [9] จึงไล่จากแม่แบบ role เป็นตัวตั้งแทน
   ============================================================ */
console.log('\n[9] ⭐ role-only (ไม่มี perms node) ต้องเขียนได้ครบตามแม่แบบ');

/* แม่แบบ role → cap ต้องตรงกับ ROLE_PERMS ใน index.html
   ตรวจซ้ำกับซอร์สข้างล่าง กันตารางนี้ล้าสมัยเงียบ ๆ เมื่อมีคนแก้แม่แบบในแอป */
const ROLE_TEMPLATE = {
  admin: ['scan', 'seeSystemQty', 'createJob', 'closeJob', 'editMaster', 'editLocation',
          'importSysQty', 'adjustCount', 'viewSummary', 'docs', 'editDoc', 'viewMasterLoc',
          'deleteJob', 'reopenRound', 'purgeUser'],
  counter: ['scan', 'seeSystemQty', 'createJob', 'closeJob', 'importSysQty',
            'viewSummary', 'docs', 'viewMasterLoc', 'editDoc', 'adjustCount'],
  scanner: ['scan'],
  viewer: ['docs']
};

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const counterLine = /counter: \[([^\]]*)\]/.exec(appSrc.replace(/\s+/g, ' '));
check('ตารางแม่แบบในเทสตรงกับ ROLE_PERMS ในแอป (counter)',
      !!counterLine && ROLE_TEMPLATE.counter.every(function (c) {
        return counterLine[1].indexOf("'" + c + "'") >= 0;
      }) && counterLine[1].split(',').length === ROLE_TEMPLATE.counter.length,
      counterLine && counterLine[1]);

/* path ที่แต่ละ cap "ต้องเขียนได้จริง" ตอนใช้งาน — ไล่จากโค้ดที่เขียนฐานจริง ไม่ใช่จากกฎ
   view-only cap (seeSystemQty · viewSummary · docs · viewMasterLoc) ไม่มี path เขียน จึงไม่มีในตาราง */
const ROUND_LIVE = { jobCode: 'J1', branchCode: 'B1', status: 'counting' };
const CAP_WRITES = {
  /* applyImport() เขียนสามที่เรียงกัน: products → cycles/systemQty → cycles/info
     ทั้งสามต้องผ่านด้วยสิทธิ์ชุดเดียวกัน ไม่งั้นนำเข้าค้างกลางคัน */
  importSysQty: [
    { label: 'products', rule: S.products['.write'] },
    { label: 'cycles/$cid/systemQty', rule: C.systemQty['.write'] },
    { label: 'cycles/$cid/transfers', rule: C.transfers['.write'] },
    { label: 'cycles/$cid/info', rule: C.info['.write'] },
    { label: 'rounds/$id/systemQty', rule: R.systemQty['.write'] },
    { label: 'rounds/$id/schema', rule: R.schema['.write'], extra: { incoming: 2 } },
    { label: 'rounds/$id/transfers', rule: R.transfers['.write'] },
    { label: 'roundIndex/$id (importedAt)', rule: S.roundIndex.$roundId['.write'],
      extra: { existing: ROUND_LIVE, incoming: ROUND_LIVE } }
  ],
  createJob: [
    { label: 'roundIndex/$id (สร้างใหม่)', rule: S.roundIndex.$roundId['.write'],
      extra: { existing: undefined, incoming: ROUND_LIVE } },
    { label: 'cycles/$cid/info', rule: C.info['.write'] }
  ],
  closeJob: [
    { label: 'roundIndex/$id (เปลี่ยนสถานะ)', rule: S.roundIndex.$roundId['.write'],
      extra: { existing: ROUND_LIVE, incoming: { jobCode: 'J1', branchCode: 'B1', status: 'closed' } } },
    { label: 'cycles/$cid/status', rule: C.status['.write'],
      extra: { existing: 'counting', incoming: 'closed' } }
  ],
  editDoc: [
    { label: 'rounds/$id/docNo', rule: R.docNo['.write'], extra: { incoming: 'D-1' } },
    { label: 'rounds/$id/docType', rule: R.docType['.write'], extra: { incoming: 'stockTake' } },
    { label: 'rounds/$id/transferNo', rule: R.transferNo['.write'], extra: { incoming: 'T-1' } },
    { label: 'rounds/$id/reasons', rule: R.reasons['.write'], extra: { incoming: 'ของชำรุด' } },
    { label: 'docCounters/$b/$k/$ym', rule: S.docCounters.$branch.$kind.$yearMonth['.write'],
      extra: { incoming: 5 } }
  ],
  scan: [
    { label: 'rounds/$id/scans/$scanId', rule: R.scans.$scanId['.write'],
      extra: { existing: undefined,
               incoming: { code: 'A1', zone: 'no-zone', delta: 1, user: 'ท', ts: 1 } } },
    { label: 'rounds/$id/stat', rule: R.stat['.write'],
      extra: { existing: { pieces: 1 }, incoming: { pieces: 2, skus: 1, lastAt: 5, ver: 1 } } },
    { label: 'rounds/$id/skuQty', rule: R.skuQty['.write'],
      extra: { existing: { A1: 1 }, incoming: { A1: 2 } } },
    { label: 'rounds/$id/unknown/$id', rule: R.unknown.$id['.write'],
      extra: { existing: undefined, incoming: { value: 'X' } } },
    { label: 'rounds/$id/reasons', rule: R.reasons['.write'], extra: { incoming: 'ของชำรุด' } }
  ],
  adjustCount: [
    { label: 'rounds/$id/scans/$scanId (หักยอด)', rule: R.scans.$scanId['.write'],
      extra: { existing: undefined,
               incoming: { code: 'A1', zone: 'no-zone', delta: -1, user: 'ท', ts: 1 } } },
    { label: 'rounds/$id/stat', rule: R.stat['.write'],
      extra: { existing: { pieces: 2 }, incoming: { pieces: 1, skus: 1, lastAt: 5, ver: 1 } } },
    { label: 'rounds/$id/skuQty', rule: R.skuQty['.write'],
      extra: { existing: { A1: 2 }, incoming: { A1: 1 } } }
  ],
  editMaster: [
    { label: 'products', rule: S.products['.write'] },
    { label: 'settings', rule: S.settings['.write'] }
  ],
  editLocation: [
    { label: 'locations', rule: S.locations['.write'] },
    { label: 'branches', rule: S.branches['.write'] }
  ],
  deleteJob: [
    { label: 'roundIndex/$id (ลบ)', rule: S.roundIndex.$roundId['.write'],
      extra: { existing: ROUND_LIVE, incoming: null } }
  ],
  reopenRound: [
    { label: 'cycles/$cid/status (เปิดรอบที่ปิด)', rule: C.status['.write'],
      extra: { existing: 'closed', incoming: 'counting' } }
  ],
  purgeUser: [
    { label: 'rounds/$id/purgeLog', rule: R.purgeLog['.write'],
      extra: { incoming: { at: 1, by: 'isrd', targetUser: 'Gift' } } },
    { label: 'rounds/$id/scans/$scanId (ลบแถว)', rule: R.scans.$scanId['.write'],
      extra: { existing: { code: 'A1', zone: 'no-zone', delta: 3, user: 'Gift', ts: 1 },
               incoming: null } }
  ]
};

Object.keys(ROLE_TEMPLATE).forEach(function (role) {
  const blocked = [];
  ROLE_TEMPLATE[role].forEach(function (cap) {
    (CAP_WRITES[cap] || []).forEach(function (w) {
      if (!canWrite(w.rule, role, 'counting', w.extra)) blocked.push(cap + ' → ' + w.label);
    });
  });
  check('⭐ ' + role + ' (role อย่างเดียว ไม่มี perms node) เขียนได้ครบทุก path ตามแม่แบบ',
        blocked.length === 0, blocked);
});

console.log('\n[9b] เคสบั๊กจริง — counter นำเข้ายอดระบบ');
check('⭐ counter role-only เขียน products ได้ (ก้าวแรกของ applyImport)',
      canWrite(S.products['.write'], 'counter', 'counting') === true, 'products');
check('⭐ counter role-only เขียน cycles/$cid/systemQty ได้ (ก้าวที่สอง)',
      canWrite(C.systemQty['.write'], 'counter', 'counting') === true, 'systemQty');
check('products กับ systemQty ยอมชุดผู้เขียนเดียวกันตอน import',
      ['admin', 'counter', 'scanner', 'viewer'].every(function (r) {
        return canWrite(S.products['.write'], r, 'counting') ===
               canWrite(C.systemQty['.write'], r, 'counting');
      }), 'ชุดผู้เขียนต้องตรงกัน');

console.log('\n[9c] เคสลบ — ใครที่ต้องเขียน products ไม่ได้');
check('scanner เขียน products ไม่ได้',
      canWrite(S.products['.write'], 'scanner', 'counting') === false, 'scanner');
check('viewer เขียน products ไม่ได้',
      canWrite(S.products['.write'], 'viewer', 'counting') === false, 'viewer');
check('custom ที่ติ๊กแค่ scan เขียน products ไม่ได้',
      canWriteCaps(S.products['.write'], ['scan'], 'counting') === false, 'custom scan');
check('custom ที่ไม่ติ๊กอะไรเลยก็เขียนไม่ได้',
      canWriteCaps(S.products['.write'], [], 'counting') === false, 'custom เปล่า');

console.log('\n[9d] เคสบวก — custom ที่ติ๊กมาเองต้องเขียน products ได้');
check('custom + importSysQty เขียน products ได้',
      canWriteCaps(S.products['.write'], ['importSysQty'], 'counting') === true, 'importSysQty');
check('custom + editMaster เขียน products ได้',
      canWriteCaps(S.products['.write'], ['editMaster'], 'counting') === true, 'editMaster');
check('custom + importSysQty เขียน systemQty ได้ในคำขอเดียวกัน',
      canWriteCaps(C.systemQty['.write'], ['importSysQty'], 'counting') === true, 'systemQty');

console.log('\n[9e] บัญชีถูกปิดใช้งาน — role-only ก็ต้องเขียนไม่ได้');
check('counter ที่ active=false เขียน products ไม่ได้',
      canWriteInactive(S.products['.write'], 'counter') === false, 'inactive counter');

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
