/* eslint-disable */
// Service Worker de mensageria (Web Push) do ERP Flow.
// NÃO faz cache de app shell — apenas recebe notificações push e abre o app.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "ERP Flow", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "ERP Flow";
  const options = {
    body: data.body || "",
    icon: "/app-icon-512.png",
    badge: "/favicon.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/aprovacoes?tab=pending" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin).href;
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try { await client.navigate(url); } catch (_e) { /* ignore */ }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
