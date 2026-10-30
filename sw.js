// Service worker ของ "hub" เท่านั้น — ตั้งใจแตะเฉพาะไฟล์ของหน้า hub
// ⚠️ ห้ามแคช index.html (แอปนับสต๊อก) หรือไฟล์อื่น ไม่งั้นจะ "แช่แข็ง" แอปเก่าในเครื่อง
//    push เวอร์ชันใหม่ไปไม่ถึง — ไฟล์นอก allowlist ให้ผ่านเน็ตตามปกติ (return เฉยๆ)
const CACHE = 'isrd-hub-v2';
const PRECACHE = ['./hub.html', './manifest.json', './icon-192.png', './icon-512.png'];
// เฉพาะไฟล์ของ hub (ไม่รวม sw.js — ให้เบราว์เซอร์จัดการอัปเดต SW เอง)
const HUB = /\/(hub\.html|manifest\.json|icon-[\w-]+\.png|apple-touch-icon\.png)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // ข้าม: ข้ามโดเมน (Firebase/dashboard) · non-GET · ไฟล์ที่ไม่ใช่ของ hub (รวม index.html)
  if (u.origin !== location.origin || e.request.method !== 'GET' || !HUB.test(u.pathname)) return;

  // hub.html = network-first → แก้ลิงก์/หน้า hub แล้วถึงเครื่องทันที, ออฟไลน์ค่อยใช้แคช
  if (/\/hub\.html$/.test(u.pathname)) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./hub.html')))
    );
    return;
  }

  // ไอคอน/manifest = cache-first (แทบไม่เปลี่ยน)
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
        return res;
      })
    )
  );
});
