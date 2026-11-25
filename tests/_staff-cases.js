/* ============================================================
   ⭐ v2.52.0 ตารางเคส "จัดการผู้ใช้แบบจำกัด" (manageStaff) — ใช้ร่วมกันสองฝั่ง
   ============================================================
   tests/test-rules.js  ป้อนเข้า Rules v2.1.8 ตัวจริง (users/$uid .write + perms/$cap .validate)
   tests/test-perms.js  ป้อนเข้า staffWriteCheck() ในแอป
   ทั้งสองต้องตอบ "ตรงกันทุกเคส" — ถ้าจอกับฐานตอบไม่ตรงกันจะเจ็บสองแบบ
     จอใจดีกว่าฐาน = กดแล้วเด้ง "ฐานข้อมูลปฏิเสธการเขียน" · จอเข้มกว่าฐาน = มีรูที่จอไม่รู้ตัว

   รูปแบบเคส:
     me       = เรคอร์ดของผู้เขียน (uid u_me) ตามที่เก็บในฐานจริง — Rules ไม่แปลง role เป็น perms ให้
     target   = uid ที่ถูกเขียน ('u_me' = แก้ตัวเอง)
     old      = เรคอร์ดเดิม (null = สร้างใหม่) · next = เรคอร์ดหลังเขียน (null = ลบ)
     granted  = cap ที่ "เขียนเป็น true ในคำขอนี้" (Rules .validate ตรวจเฉพาะเส้นทางที่เขียน)
     want     = true เขียนได้ / false ต้องถูกปฏิเสธ
   ไฟล์นี้ขึ้นต้นด้วย _ → run-all ไม่รันตรง ๆ (เป็นข้อมูล ไม่ใช่เทส)
   ============================================================ */

const COUNTER = ['scan', 'seeSystemQty', 'createJob', 'closeJob', 'importSysQty', 'viewSummary', 'docs',
                 'viewMasterLoc', 'editDoc', 'adjustCount', 'approveRecheck'];
const perms = list => list.reduce((o, c) => { o[c] = true; return o; }, {});

const ME = {
  admin:   { name: 'แอดมิน', role: 'admin', active: true },                                           // admin เดิมไม่มี perms node
  D:       { name: 'หัวหน้า', role: 'custom', active: true, perms: perms(COUNTER.concat(['manageStaff'])) },
  Dnoappr: { name: 'หัวหน้า2', role: 'custom', active: true,
             perms: perms(COUNTER.filter(c => c !== 'approveRecheck').concat(['manageStaff'])) },
  Dnoscan: { name: 'หัวหน้า3', role: 'custom', active: true, perms: perms(['docs', 'manageStaff']) },
  Doff:    { name: 'หัวหน้าปิด', role: 'custom', active: false, perms: perms(COUNTER.concat(['manageStaff'])) },
  counter: { name: 'ผู้นับ', role: 'counter', active: true, perms: perms(COUNTER) }                // ไม่มี manageStaff
};
const REC = {
  viewer:   { name: 'วิว', role: 'viewer', active: true, perms: perms(['docs']) },
  scanner:  { name: 'ยิง', role: 'scanner', active: true, perms: perms(['scan']) },
  counter:  { name: 'นับ', role: 'counter', active: true, perms: perms(COUNTER) },
  customDoc:{ name: 'ซี', role: 'custom', active: true, perms: perms(['docs']) },
  admin:    { name: 'บอส', role: 'admin', active: true },
  delegate: { name: 'หัวหน้าอื่น', role: 'custom', active: true, perms: perms(['docs', 'manageStaff']) },
  bigCustom:{ name: 'ใหญ่', role: 'custom', active: true, perms: perms(['docs', 'deleteJob']) },
  offViewer:{ name: 'ปิดอยู่', role: 'viewer', active: false, perms: perms(['docs']) }
};
const merge = (a, b) => JSON.parse(JSON.stringify(Object.assign({}, a, b)));

const CASES = [
  /* R1 — admin เดิมทำได้ทุกอย่าง */
  { id: 'R1a', name: 'admin สร้าง admin ใหม่', me: ME.admin, target: 't1', old: null, next: REC.admin, granted: [], want: true },
  { id: 'R1b', name: 'admin มอบ manageStaff', me: ME.admin, target: 't1', old: REC.customDoc,
    next: merge(REC.customDoc, { perms: perms(['docs', 'manageStaff']) }), granted: ['manageStaff'], want: true },
  { id: 'R1c', name: 'admin แก้บัญชี admin อื่น', me: ME.admin, target: 't1', old: REC.admin, next: merge(REC.admin, { name: 'บอส2' }), granted: [], want: true },
  { id: 'R1d', name: 'admin ลบเรคอร์ด', me: ME.admin, target: 't1', old: REC.viewer, next: null, granted: [], want: true },
  { id: 'R1e', name: 'admin เปิดบัญชีที่ปิดไว้', me: ME.admin, target: 't1', old: REC.offViewer, next: merge(REC.offViewer, { active: true }), granted: [], want: true },
  /* R2 — delegate สร้าง/แก้ non-admin ด้วย cap ที่ตัวเองถือ */
  { id: 'R2a', name: 'delegate สร้าง custom (docs)', me: ME.D, target: 't1', old: null, next: REC.customDoc, granted: ['docs'], want: true },
  { id: 'R2b', name: 'delegate สร้าง viewer', me: ME.D, target: 't1', old: null, next: REC.viewer, granted: ['docs'], want: true },
  { id: 'R2c', name: 'delegate สร้าง scanner', me: ME.D, target: 't1', old: null, next: REC.scanner, granted: ['scan'], want: true },
  { id: 'R2d', name: 'delegate เปลี่ยนชื่อ viewer', me: ME.D, target: 't1', old: REC.viewer, next: merge(REC.viewer, { name: 'วิวใหม่' }), granted: [], want: true },
  { id: 'R2e', name: 'delegate ปิดบัญชี viewer', me: ME.D, target: 't1', old: REC.viewer, next: merge(REC.viewer, { active: false }), granted: [], want: true },
  /* R3 (ก) ตั้ง admin */
  { id: 'R3a', name: '(ก) delegate สร้าง admin', me: ME.D, target: 't1', old: null, next: REC.admin, granted: [], want: false },
  { id: 'R3b', name: '(ก) delegate เปลี่ยน counter เป็น admin', me: ME.D, target: 't1', old: REC.counter, next: merge(REC.counter, { role: 'admin' }), granted: [], want: false },
  /* R4 (ข) มอบ manageStaff */
  { id: 'R4a', name: '(ข) delegate มอบ manageStaff ให้คนใหม่', me: ME.D, target: 't1', old: null,
    next: merge(REC.customDoc, { perms: perms(['docs', 'manageStaff']) }), granted: ['docs', 'manageStaff'], want: false },
  { id: 'R4b', name: '(ข) delegate ติ๊ก manageStaff ให้คนเดิม', me: ME.D, target: 't1', old: REC.customDoc,
    next: merge(REC.customDoc, { perms: perms(['docs', 'manageStaff']) }), granted: ['manageStaff'], want: false },
  /* R4c — ชั้น .write ต้องกันได้เอง แม้ไม่นับว่า manageStaff ถูก "เขียน" (granted ว่าง → ไม่ผ่าน $cap validate)
     ใน RTDB จริงเคสนี้ต้องผ่าน validate อยู่แล้ว แต่ล็อกไว้ว่า "ถ้าวันหนึ่งใครถอดข้อนี้ใน .write" เทสต้องดัง
     (สองชั้นซ้อนกัน: .write กับ $cap validate — ถอดชั้นไหนก็ต้องมีเทสตก) */
  { id: 'R4c', name: '(ข) .write กันเอง: เรคอร์ดใหม่มี manageStaff', me: ME.D, target: 't1', old: REC.customDoc,
    next: merge(REC.customDoc, { perms: perms(['docs', 'manageStaff']) }), granted: [], want: false },
  /* R5 (ค) แตะบัญชี admin */
  { id: 'R5a', name: '(ค) delegate เปลี่ยนชื่อ admin', me: ME.D, target: 't1', old: REC.admin, next: merge(REC.admin, { name: 'x' }), granted: [], want: false },
  { id: 'R5b', name: '(ค) delegate ปิด admin', me: ME.D, target: 't1', old: REC.admin, next: merge(REC.admin, { active: false }), granted: [], want: false },
  { id: 'R5c', name: '(ค) delegate ลด admin เป็น viewer', me: ME.D, target: 't1', old: REC.admin, next: REC.viewer, granted: ['docs'], want: false },
  { id: 'R5d', name: '(ค) delegate ลบ admin', me: ME.D, target: 't1', old: REC.admin, next: null, granted: [], want: false },
  /* R6 (ฉ) ตัวเอง · (ช) delegate อื่น · ลบ */
  { id: 'R6a', name: '(ฉ) delegate แก้ชื่อตัวเอง', me: ME.D, target: 'u_me', old: ME.D, next: merge(ME.D, { name: 'x' }), granted: [], want: false },
  { id: 'R6b', name: '(ฉ) delegate เปลี่ยน role ตัวเองเป็น counter', me: ME.D, target: 'u_me', old: ME.D, next: merge(ME.D, { role: 'counter' }), granted: [], want: false },
  { id: 'R6c', name: '(ช) delegate แก้ delegate อื่น', me: ME.D, target: 't1', old: REC.delegate, next: merge(REC.delegate, { name: 'x' }), granted: [], want: false },
  { id: 'R6d', name: '(ช) delegate ถอด manageStaff ของ delegate อื่น', me: ME.D, target: 't1', old: REC.delegate,
    next: merge(REC.delegate, { perms: perms(['docs']) }), granted: [], want: false },
  { id: 'R6e', name: 'delegate ลบเรคอร์ด non-admin', me: ME.D, target: 't1', old: REC.viewer, next: null, granted: [], want: false },
  /* R7 (ง) มอบเกินตัวเอง */
  { id: 'R7a', name: '(ง) delegate มอบ deleteJob (ตัวเองไม่มี)', me: ME.D, target: 't1', old: null,
    next: merge(REC.customDoc, { perms: perms(['docs', 'deleteJob']) }), granted: ['docs', 'deleteJob'], want: false },
  { id: 'R7b', name: '(ง) delegate ติ๊ก purgeUser ให้คนเดิม', me: ME.D, target: 't1', old: REC.customDoc,
    next: merge(REC.customDoc, { perms: perms(['docs', 'purgeUser']) }), granted: ['purgeUser'], want: false },
  { id: 'R7c', name: '(ง) delegate ปลด deleteJob ของคนที่มี (ปิดได้)', me: ME.D, target: 't1', old: REC.bigCustom,
    next: merge(REC.bigCustom, { perms: perms(['docs']) }), granted: [], want: true },
  /* R8 (จ) role counter/scanner */
  { id: 'R8a', name: '(จ) delegate ถือครบ 11 → สร้าง counter ได้', me: ME.D, target: 't1', old: null, next: REC.counter, granted: COUNTER, want: true },
  { id: 'R8b', name: '(จ) delegate ขาด approveRecheck → สร้าง counter ไม่ได้', me: ME.Dnoappr, target: 't1', old: null,
    next: merge(REC.counter, { perms: perms(COUNTER.filter(c => c !== 'approveRecheck')) }),
    granted: COUNTER.filter(c => c !== 'approveRecheck'), want: false },
  { id: 'R8c', name: '(จ) delegate ขาด approveRecheck → เปลี่ยนชื่อ counter เดิมไม่ได้', me: ME.Dnoappr, target: 't1',
    old: REC.counter, next: merge(REC.counter, { name: 'x' }), granted: [], want: false },
  { id: 'R8d', name: '(จ) delegate ไม่มี scan → สร้าง scanner ไม่ได้', me: ME.Dnoscan, target: 't1', old: null,
    next: merge(REC.scanner, { perms: {} }), granted: [], want: false },
  { id: 'R8e', name: '(จ) delegate ไม่มี scan → สร้าง viewer ได้', me: ME.Dnoscan, target: 't1', old: null, next: REC.viewer, granted: ['docs'], want: true },
  { id: 'R8f', name: '(จ) delegate ขาด approveRecheck → สร้าง scanner ได้', me: ME.Dnoappr, target: 't1', old: null, next: REC.scanner, granted: ['scan'], want: true },
  /* R9 whitelist · inactive · ไม่มี manageStaff */
  { id: 'R9a', name: 'delegate ใส่คีย์ perms แปลก', me: ME.D, target: 't1', old: REC.customDoc,
    next: merge(REC.customDoc, { perms: Object.assign(perms(['docs']), { hackCap: true }) }), granted: ['hackCap'], want: false },
  { id: 'R9b', name: 'admin ใส่คีย์ perms แปลก (whitelist ใช้กับทุกคน)', me: ME.admin, target: 't1', old: REC.customDoc,
    next: merge(REC.customDoc, { perms: Object.assign(perms(['docs']), { manageUsers: true }) }), granted: ['manageUsers'], want: false },
  { id: 'R9c', name: 'delegate ที่ถูกปิดใช้งาน', me: ME.Doff, target: 't1', old: null, next: REC.viewer, granted: ['docs'], want: false },
  { id: 'R9d', name: 'counter ที่ไม่มี manageStaff', me: ME.counter, target: 't1', old: null, next: REC.viewer, granted: ['docs'], want: false },
  /* D13 เปิดบัญชีที่ปิดไว้ */
  { id: 'D13a', name: 'D13 delegate เปิดบัญชีที่ปิดไว้', me: ME.D, target: 't1', old: REC.offViewer, next: merge(REC.offViewer, { active: true }), granted: [], want: false },
  { id: 'D13b', name: 'D13 delegate แก้ชื่อบัญชีที่ปิดอยู่ (ยังปิด)', me: ME.D, target: 't1', old: REC.offViewer, next: merge(REC.offViewer, { name: 'x' }), granted: [], want: true },
  { id: 'D13c', name: 'D13 delegate เขียนทับบัญชีที่ปิดไว้ด้วยเรคอร์ดใหม่ active:true', me: ME.D, target: 't1', old: REC.offViewer, next: REC.viewer, granted: ['docs'], want: false }
];

module.exports = { CASES, COUNTER, ME, REC };
