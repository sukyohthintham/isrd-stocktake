/* ============================================================
   รัน regression ทั้งชุด — node tests/run-all.js
   ============================================================

   ทำสองอย่าง:
   1. ตรวจ syntax ของก้อน <script> ใน index.html (แทน node --check)
   2. รันไฟล์ test-*.js ทุกไฟล์ในโฟลเดอร์นี้ แล้วรวมยอด ผ่าน/ตก

   ออกด้วย exit code 1 ถ้ามีข้อไหนตก จะได้เอาไปต่อกับอะไรก็ได้
   ต้องติดตั้ง puppeteer-core + Chrome ไว้ก่อน — ดูวิธีใน _env.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vm = require('vm');
const env = require('./_env');

/* ---------- 1. syntax ของแอป ---------- */
process.stdout.write('ตรวจ syntax ของ index.html ... ');
try {
  new vm.Script(env.appScript(), { filename: 'index.html <script>' });
  console.log('ผ่าน');
} catch (e) {
  console.log('ไม่ผ่าน\n' + e.message);
  process.exit(1);
}
console.log('Chrome: ' + env.CHROME + '\n');

/* ---------- 2. ไล่รันทีละไฟล์ ---------- */
const files = fs.readdirSync(__dirname)
  .filter(function (f) { return /^test-.*\.js$/.test(f); })
  .sort();

let totalPass = 0, totalFail = 0;
const broken = [];

files.forEach(function (f) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)],
                       { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    /* เทสตกทำให้ exit code ไม่ใช่ 0 — ยังต้องอ่านผลจาก stdout ต่อ */
    out = (e.stdout || '') + (e.stderr || '');
  }
  const last = out.trim().split('\n').pop().trim();
  const m = /(\d+) passed, (\d+) failed/.exec(last);
  if (!m) {
    broken.push({ file: f, out: out.trim().split('\n').slice(-6).join('\n') });
    console.log(pad(f) + '  รันไม่จบ / อ่านผลไม่ได้');
    return;
  }
  totalPass += Number(m[1]);
  totalFail += Number(m[2]);
  console.log(pad(f) + '  ' + last);
});

function pad(s) { return (s + '                          ').slice(0, 26); }

console.log('\n================================================');
console.log('ไฟล์เทสต์ ' + files.length + ' ไฟล์ · ผ่าน ' + totalPass + ' · ตก ' + totalFail);
console.log('================================================');

if (broken.length) {
  console.log('\nไฟล์ที่รันไม่จบ:');
  broken.forEach(function (b) { console.log('--- ' + b.file + ' ---\n' + b.out); });
}

process.exit((totalFail || broken.length) ? 1 : 0);
