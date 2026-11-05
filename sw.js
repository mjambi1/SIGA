self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const BADGE_CACHE = 'siga-badge-v1';
const BADGE_KEY = '/__siga_unread_results__';
let badgeQueue = Promise.resolve();

async function updateBadge(increment = true) {
  const cache = await caches.open(BADGE_CACHE);
  if (!increment) {
    await cache.delete(BADGE_KEY);
    if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    else if ('setAppBadge' in navigator) await navigator.setAppBadge(0);
    return 0;
  }
  const stored = await cache.match(BADGE_KEY);
  const current = stored ? Number(await stored.text()) || 0 : 0;
  const next = current + 1;
  await cache.put(BADGE_KEY, new Response(String(next)));
  if ('setAppBadge' in navigator) await navigator.setAppBadge(next);
  return next;
}

self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_BADGE') {
    event.waitUntil(updateBadge(false));
  }
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  const title = data.title || 'مستفيد جديد أكمل مقياس SIGA';
  const options = {
    body: data.body || 'افتح لوحة الإدارة للاطلاع على النتيجة والتقرير.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.requestId ? `siga-${data.requestId}` : 'siga-new-result',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/#admin' }
  };
  badgeQueue = badgeQueue.then(() => updateBadge(true)).catch(() => {});
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badgeQueue]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#admin', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
