// Imported into the Workbox-generated service worker (see vite.config workbox.importScripts).
// Displays incoming web-push notifications (login alerts, etc.) and handles clicks.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  var title = data.title || 'Metflux';
  var options = {
    body: data.body || '',
    icon: '/s/admin/icons/icon.svg',
    badge: '/s/admin/icons/icon.svg',
    vibrate: [200, 100, 200],
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/s/admin/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/s/admin/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
      for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if ('focus' in w) { try { w.navigate(url); } catch (e) { /* ignore */ } return w.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
