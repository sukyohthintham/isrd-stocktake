/* ============================================================
   ตัวช่วยกลางของชุดเทส — หาที่อยู่ puppeteer-core และ Chrome ให้เอง
   ============================================================

   ทำไมต้องมีไฟล์นี้:
   เทสทุกไฟล์ขับ headless Chrome จริงเพื่อตรวจ DOM ของ index.html
   จึงต้องพึ่ง puppeteer-core + ตัว Chrome ซึ่งเป็น "เครื่องมือทดสอบ"
   ไม่ใช่ส่วนหนึ่งของแอป — ตามกฎบ้าน (CLAUDE.md) แอปต้องเป็น index.html
   ไฟล์เดียว ไม่มี npm ไม่มี build step ดังนั้น dependency พวกนี้จึง
   "ติดตั้งไว้นอกรีโป" แล้วให้ไฟล์นี้ไปหาให้ ไม่มี package.json ในรีโปเลย

   ติดตั้งครั้งแรก (ทำครั้งเดียวต่อเครื่อง):
     mkdir %USERPROFILE%\.isrd-test-deps
     cd %USERPROFILE%\.isrd-test-deps
     npm init -y && npm i puppeteer-core
     npx @puppeteer/browsers install chrome-headless-shell@stable

   สั่งรันทั้งชุด:  node tests/run-all.js
   สั่งรันไฟล์เดียว: node tests/test-price.js

   ทับที่อยู่เองได้ด้วย env:
     ISRD_CHROME=<path ของ chrome-headless-shell.exe>
     ISRD_PUPPETEER=<path ของโฟลเดอร์ puppeteer-core>
   ============================================================ */

const fs = require('fs');
const path = require('path');
const os = require('os');

/* ---------- 1. puppeteer-core ---------- */
function loadPuppeteer() {
  const tries = [];
  if (process.env.ISRD_PUPPETEER) tries.push(process.env.ISRD_PUPPETEER);
  tries.push('puppeteer-core');                                        // ติดตั้งแบบ global / NODE_PATH
  tries.push(path.join(os.homedir(), '.isrd-test-deps', 'node_modules', 'puppeteer-core'));
  tries.push(path.join(os.homedir(), 'node_modules', 'puppeteer-core'));

  for (const t of tries) {
    try { return require(t); } catch (e) { /* ลองที่ถัดไป */ }
  }
  throw new Error(
    'หา puppeteer-core ไม่เจอ — ติดตั้งก่อนด้วย:\n' +
    '  mkdir "' + path.join(os.homedir(), '.isrd-test-deps') + '"\n' +
    '  cd /d "' + path.join(os.homedir(), '.isrd-test-deps') + '" && npm init -y && npm i puppeteer-core\n' +
    '(ติดตั้งนอกรีโป ไม่ต้องมี package.json ในโปรเจกต์)'
  );
}

/* ---------- 2. ตัว Chrome ----------
   ไม่ hardcode เลขเวอร์ชัน — โฟลเดอร์ cache เปลี่ยนทุกครั้งที่อัปเดตเบราว์เซอร์
   เลือกอันใหม่สุดที่เจอ ถ้าไม่เจอค่อยบอกวิธีติดตั้ง */
function findChrome() {
  if (process.env.ISRD_CHROME) return process.env.ISRD_CHROME;

  const cache = path.join(os.homedir(), '.cache', 'puppeteer');
  const flavours = [
    { dir: 'chrome-headless-shell', sub: 'chrome-headless-shell-win64', exe: 'chrome-headless-shell.exe' },
    { dir: 'chrome', sub: 'chrome-win64', exe: 'chrome.exe' }
  ];
  for (const f of flavours) {
    const root = path.join(cache, f.dir);
    let builds = [];
    try { builds = fs.readdirSync(root).sort().reverse(); } catch (e) { continue; }
    for (const b of builds) {
      const exe = path.join(root, b, f.sub, f.exe);
      if (fs.existsSync(exe)) return exe;
    }
  }
  /* เผื่อเครื่องที่ใช้ Chrome ที่ลงไว้ปกติ */
  const installed = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of installed) if (fs.existsSync(p)) return p;

  throw new Error(
    'หา Chrome ไม่เจอ — ติดตั้งก่อนด้วย:\n' +
    '  npx @puppeteer/browsers install chrome-headless-shell@stable\n' +
    'หรือชี้เองด้วย env ISRD_CHROME=<path ของ chrome-headless-shell.exe>'
  );
}

/* ---------- 3. index.html ของรีโป ----------
   อ้างแบบ relative จากตำแหน่งไฟล์นี้ ย้ายรีโปไปไว้ไหนก็ยังรันได้ */
const APP_FILE = path.join(__dirname, '..', 'index.html');
const APP_URL = 'file:///' + APP_FILE.replace(/\\/g, '/');

/* ---------- 4. อ่านเฉพาะก้อน <script> ของแอป ----------
   ใช้ตรวจ syntax ด้วย node --check โดยไม่ต้องแตะไฟล์จริง */
function appScript() {
  const html = fs.readFileSync(APP_FILE, 'utf8');
  const m = /<script(?!\s[^>]*src=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('อ่านก้อน <script> ใน index.html ไม่ได้');
  return m[1];
}

module.exports = {
  puppeteer: loadPuppeteer(),
  CHROME: findChrome(),
  APP_FILE: APP_FILE,
  APP_URL: APP_URL,
  appScript: appScript
};
