/**
 * 오프라인 캐시. 지하철 등 네트워크가 끊긴 곳에서도 앱 셸이 뜨도록 합니다.
 *
 * - 앱 셸(HTML): 네트워크 우선 → 실패 시 캐시. 배포 직후 낡은 화면이 고정되지 않습니다.
 * - 단어 JSON: 네트워크 우선 → 실패 시 캐시. 캐시 무효화 쿼리(?_=…)를 무시하고 찾습니다.
 * - 해시가 붙은 정적 자산: 캐시 우선. 내용이 바뀌면 파일명이 바뀌므로 안전합니다.
 *
 * 빌드 산출물 목록을 미리 알 수 없으므로 사전 캐시 대신 런타임 캐시를 사용합니다.
 * 즉 최초 1회는 온라인 접속이 필요합니다.
 */
const VERSION = 'v1';
const CACHE = `vocab-listener-${VERSION}`;
const SHELL = './';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.add(new Request(SHELL, { cache: 'reload' })))
      .catch(() => undefined) // 셸 사전 캐시 실패가 설치를 막지 않도록 합니다.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** 네트워크를 먼저 시도하고, 성공하면 캐시를 갱신합니다. */
async function networkFirst(request, matchOptions) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, matchOptions);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // 오프라인이면 캐시된 셸로 되돌립니다. 주소가 달라도 같은 단일 페이지입니다.
    event.respondWith(
      networkFirst(request).catch(() =>
        caches.open(CACHE).then(cache => cache.match(SHELL)).then(cached =>
          cached ?? new Response('오프라인 상태이며 저장된 화면이 없습니다.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }))),
    );
    return;
  }

  if (url.pathname.endsWith('/data/words.json')) {
    // data.ts가 ?_=타임스탬프를 붙이므로 쿼리를 무시하고 캐시를 찾습니다.
    event.respondWith(networkFirst(request, { ignoreSearch: true }));
    return;
  }

  event.respondWith(cacheFirst(request));
});
