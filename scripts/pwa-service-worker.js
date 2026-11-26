const scope = new URL(self.registration.scope)
const cachePrefix = `moonweave-shell:${scope.href}:`
const cacheName = cachePrefix + BUILD_ID
const index = new URL('index.html', scope)
const appFiles = new Set(APP_FILES.map((path) => new URL(path, scope).href))

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) =>
    cache.addAll([...appFiles].map((url) => new Request(url, { cache: 'reload' }))),
  ))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  const navigation = request.mode === 'navigate' && url.origin === index.origin &&
    (url.pathname === index.pathname || url.pathname === scope.pathname)
  const cacheKey = navigation ? index.href : url.href
  if (appFiles.has(cacheKey)) {
    event.respondWith(caches.open(cacheName).then(async (cache) => (await cache.match(cacheKey)) ?? fetch(request)))
  }
})
