// 덧니 양치 대작전 서비스 워커: 한 번 열어 두면 오프라인에서도 실행됩니다.
const CACHE = 'deotni-v5';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './brush-analyzer.js', './mouth-motion.js',
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

// 페이지·스크립트·매니페스트는 네트워크 우선(새 버전이 함께 반영되도록), 이미지·모델·wasm은 캐시 우선
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const path = new URL(req.url).pathname;
  const isPage = req.mode === 'navigate' || req.destination === 'document';
  const networkFirst = isPage || /\.(js|mjs|html|webmanifest|json)$/.test(path);
  if (networkFirst) {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(isPage ? './index.html' : req, copy)); return res; })
        .catch(() => caches.match(isPage ? './index.html' : req))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }))
  );
});
