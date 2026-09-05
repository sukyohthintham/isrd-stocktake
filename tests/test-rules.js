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

const RULES_FILE = path.join(__dirname, '..', 'stocktake-rules-v2.1.1.json');
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
const ROLES = ['admin', 'counter', 'scanner', 'viewer'];
const STATUSES = ['counting', 'reviewing', 'closed'];

/* ---------- ตารางสิทธิ์ที่ตกลงกันไว้ ----------
   ค่าคือ "รายชื่อ role ที่เขียนได้" ในสถานะนั้น · [] = ห้ามทุกคน
   แถวไหนเขียนเป็นฟังก์ชัน = สิทธิ์เปลี่ยนตามสถานะ Job */
const A_C = ['admin', 'counter'];
const A_C_S = ['admin', 'counter', 'scanner'];

const MATRIX = [
  /* ---- ข้อมูลกลางของบริษัท: admin เท่านั้น ไม่เกี่ยวกับสถานะ Job ---- */
  { path: 'products',   rule: S.products['.write'],   want: function () { return ['admin']; } },
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
check('ตอนนับ scanner เขียนได้แค่ scans · unknown · reasons',
      JSON.stringify(scannerOk.sort()) === JSON.stringify(
        ['rounds/$id/reasons', 'rounds/$id/scans/$scanId', 'rounds/$id/unknown/$id']),
      scannerOk);
check('รอบส่งตรวจแล้ว scanner เขียนหมายเหตุไม่ได้',
      canWrite(R.reasons['.write'], 'scanner', 'reviewing') === false, 'reviewing');
check('รอบปิดแล้ว scanner เขียนหมายเหตุไม่ได้',
      canWrite(R.reasons['.write'], 'scanner', 'closed') === false, 'closed');

/* ---------- 4. Master เป็นของ admin คนเดียว ---------- */
console.log('\n[4] Master/Location/สาขา — admin เท่านั้น');
['products', 'locations', 'branches', 'settings'].forEach(function (p) {
  const others = ['counter', 'scanner', 'viewer'].filter(function (role) {
    return STATUSES.some(function (st) { return canWrite(S[p]['.write'], role, st); });
  });
  check(p + ': counter/scanner/viewer แก้ไม่ได้เลย', others.length === 0, others);
  check(p + ': admin แก้ได้', canWrite(S[p]['.write'], 'admin', 'counting') === true, p);
});

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

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
