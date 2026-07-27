/* Service worker de Didier Stamatti — recibe las notificaciones push y las
   muestra en el celular aunque la app esté cerrada. */

const CACHE = "didier-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  )
);

// Guarda en el teléfono SOLO los archivos de diseño/código, que llevan un hash
// de contenido en la URL (una versión nueva = URL nueva, nunca sirve algo viejo).
// El HTML, las páginas y los datos NO se tocan: siempre se piden al servidor,
// así el stock y los pedidos jamás se ven desactualizados.
const isImmutableAsset = (url) => url.pathname.startsWith("/_next/static/");
const isIcon = (url) => /^\/(icon-|apple-touch-icon|favicon)/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const immutable = isImmutableAsset(url);
  if (!immutable && !isIcon(url)) return;

  const task = (async () => {
    const hit = await caches.match(req);
    // Los íconos no llevan hash: se sirve el guardado y se refresca de fondo.
    if (hit && immutable) return hit;

    const res = await fetch(req).catch(() => null);
    if (!res) {
      if (hit) return hit;
      throw new Error("sin red");
    }
    if (res.ok) {
      // Se clona ANTES de entregarla: después el cuerpo ya está consumido.
      const copy = res.clone();
      await caches
        .open(CACHE)
        .then((c) => c.put(req, copy))
        .catch(() => {});
    }
    return res;
  })();

  // waitUntil debe llamarse sincrónicamente o el service worker se apaga
  // antes de terminar de guardar.
  event.waitUntil(task);
  event.respondWith(task);
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Didier Stamatti";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    lang: "es-AR",
    tag: data.tag || undefined, // mismo evento => reemplaza el aviso anterior en el celular
    renotify: Boolean(data.tag),
    data: { url: data.url || "/notificaciones" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
