// 덧니 양치 대작전 서비스 워커: 한 번 열어 두면 오프라인에서도 실행됩니다.
const CACHE = 'deotni-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './brush-analyzer.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
  './assets/deotni/hero.webp', './assets/deotni/sleep.webp', './assets/deotni/wand.webp', './assets/deotni/book.webp',
  './assets/deotni/notepad.webp', './assets/deotni/laugh.webp', './assets/deotni/smile.png', './assets/deotni/party.png',
  './assets/deotni/wink.png', './assets/deotni/mug.png', './assets/deotni/run.png', './assets/deotni/angry.png',
  './assets/deotni/cry.png', './assets/deotni/giggle.png', './assets/deotni/ok.png', './assets/deotni/confused.png',
  './assets/deotni/cheer.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// 페이지(HTML)는 네트워크 우선(새 버전 반영), 나머지는 캐시 우선
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isPage = req.mode === 'navigate' || req.destination === 'document';
  if (isPage) {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }))
  );
});
