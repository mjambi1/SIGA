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
  event.waitUntil(self.registration.showNotification(title, options));
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
