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
  } catch {
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
    // `d` es la marca de esta entrega: se devuelve al tocarla.
    data: { url: data.url || "/notificaciones", d: data.d || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const datos = event.notification.data || {};
  const url = datos.url || "/";
  event.waitUntil(
    (async () => {
      // Que quede registrado que se abrió, y el aviso leído. Arranca ya pero NO
      // se espera antes de abrir: el navegador solo deja abrir una ventana poco
      // después del toque, y en un teléfono lento o recién despertado un pedido
      // sin tope dejaba el toque sin hacer nada. Si falla, se abre igual: no
      // saberlo no puede impedir llegar a la pantalla.
      const aviso = datos.d
        ? fetch("/api/notifications/abierto", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ d: datos.d }),
          }).catch(() => {})
        : null;
      try {
        const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of list) {
          if ("focus" in client) {
            if ("navigate" in client) await client.navigate(url).catch(() => {});
            return await client.focus();
          }
        }
        if (self.clients.openWindow) return await self.clients.openWindow(url);
      } finally {
        // Recién al final, y aun si abrir falló: el service worker no se apaga
        // antes de que el pedido termine.
        if (aviso) await aviso;
      }
    })()
  );
});

// El navegador puede cambiar la suscripción por su cuenta (rotación de claves,
// limpieza). Sin esto el teléfono quedaba mudo sin que nadie lo supiera, hasta
// que la persona volviera a tocar "Activar notificaciones".
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const vieja = event.oldSubscription || null;
        let clave = vieja && vieja.options && vieja.options.applicationServerKey;
        if (!clave) {
          const r = await fetch("/api/notifications/clave");
          clave = (await r.json()).clave;
        }
        if (!clave) return;
        const nueva =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave }));
        const alta = await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nueva.toJSON()),
        });
        // Si la nueva no quedó anotada, la vieja no se toca: mejor un endpoint
        // de más que quedarse sin ninguno.
        if (!alta.ok) return;
        if (vieja && vieja.endpoint !== nueva.endpoint) {
          await fetch("/api/notifications/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: vieja.endpoint }),
          });
        }
      } catch {
        // Si no se pudo, queda como antes: la persona lo ve en "Probar en este teléfono".
      }
    })()
  );
});
