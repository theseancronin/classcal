/**
 * Service worker.
 *
 * Two jobs: keep the app usable offline with yesterday's calendar, and show
 * push reminders.
 *
 * The cache strategy is deliberately network-first for data. Showing a stale
 * calendar is acceptable and the app says so on screen; showing a stale
 * calendar while *claiming* it is current is not, so the app shell is cached
 * but /api/events always tries the network before falling back.
 */

const SHELL_CACHE = 'classcal-shell-v1';
const DATA_CACHE = 'classcal-data-v1';

const SHELL_ASSETS = ['/', '/calendar', '/settings', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A missing asset must not abort the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Calendar data: network first, cache as a fallback for offline.
  if (url.pathname.startsWith('/api/events')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Never cache anything else under /api: a sync or a subscription write must
  // always reach the server.
  if (url.pathname.startsWith('/api/')) return;

  // App shell: cache first, refreshed in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'ClassCal', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'ClassCal', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Lets a re-sent reminder replace the earlier one rather than stack.
      tag: payload.tag || undefined,
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an open tab if there is one rather than opening a duplicate.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
