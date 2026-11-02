import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * El service worker, corrido en una caja de arena con un `self` falso.
 *
 * Es el único código de la app que corre cuando la app está cerrada, y un
 * error acá no se ve en ninguna pantalla: el teléfono simplemente deja de
 * avisar. Por eso se prueba igual que el resto.
 */

type Manejador = (evento: Record<string, unknown>) => void;
type Pedido = { url: string; init?: { method?: string; body?: string } };

type Opciones = {
  /** Sin ventanas abiertas: tocar el aviso tiene que abrir una nueva. */
  sinVentanas?: boolean;
  /** Cómo responde el servidor. Por defecto, todo bien. */
  fetch?: (pedido: Pedido) => Promise<unknown>;
  /** La ventana abierta tarda para siempre en cargar la pantalla nueva. */
  navegacionColgada?: boolean;
  /** Traer la ventana al frente falla. */
  focoFalla?: boolean;
  /** El caché del teléfono está vacío: /sin-conexion.html no se guardó nunca. */
  sinPaginaGuardada?: boolean;
  /** Guardar la página sin conexión al instalar falla (sin espacio, red caída). */
  guardarFalla?: boolean;
};

const respuestaOk = { ok: true, json: async () => ({ clave: "BClave" }) };

/** Lo que dice la página sin conexión que el teléfono tiene guardada. */
const PAGINA_SIN_CONEXION = "<h1>Sin conexión</h1>";

function cargarSW(opciones: Opciones = {}) {
  const manejadores: Record<string, Manejador> = {};
  const pedidos: Pedido[] = [];
  const mostradas: { titulo: string; opciones: { data: { url: string; d?: string } } }[] = [];
  const navegadas: string[] = [];
  const abiertas: string[] = [];
  let enfocadas = 0;
  let activadas = 0;
  let reclamadas = 0;
  // Se puede "arreglar" después de instalar: el guardado falla solo mientras el
  // teléfono está sin espacio o sin red, y al activarse puede haber vuelto.
  let guardarFalla = Boolean(opciones.guardarFalla);
  const ventana = {
    focus: async () => {
      enfocadas++;
      if (opciones.focoFalla) throw new Error("no se pudo enfocar");
    },
    navigate: (u: string) => {
      navegadas.push(u);
      return opciones.navegacionColgada ? new Promise<void>(() => {}) : Promise.resolve();
    },
  };
  const self = {
    addEventListener: (tipo: string, fn: Manejador) => (manejadores[tipo] = fn),
    skipWaiting: () => { activadas++; },
    location: { origin: "https://app.test" },
    registration: {
      showNotification: async (titulo: string, opciones: { data: { url: string; d?: string } }) => {
        mostradas.push({ titulo, opciones });
      },
      pushManager: {
        subscribe: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/nueva", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/nueva" }) }),
      },
    },
    clients: {
      claim: async () => { reclamadas++; },
      matchAll: async () => (opciones.sinVentanas ? [] : [ventana]),
      openWindow: async (u: string) => { abiertas.push(u); },
    },
  };
  // `fetch` recibe un texto (las llamadas del propio service worker) o el pedido
  // del navegador (una navegación): en los dos casos se anota solo la dirección.
  const dirDe = (x: string | { url: string }) => (typeof x === "string" ? x : x.url);
  const fetch = async (entrada: string | { url: string }, init?: { method?: string; body?: string }) => {
    const pedido = { url: dirDe(entrada), init };
    pedidos.push(pedido);
    return opciones.fetch ? opciones.fetch(pedido) : respuestaOk;
  };
  // El caché del teléfono. `guardados` es todo lo que el service worker le
  // escribió, con `add` o con `put`: la regla es que ahí solo entre la página sin
  // conexión (y los archivos de diseño con hash, que acá no se piden).
  const guardados: string[] = [];
  // Cada vez que el service worker pidió guardar con `add`, haya salido bien o no.
  const intentosAdd: string[] = [];
  const enCache = new Map<string, Response>();
  if (!opciones.sinPaginaGuardada) enCache.set("/sin-conexion.html", new Response(PAGINA_SIN_CONEXION));
  const caches = {
    keys: async () => [],
    delete: async () => true,
    match: async (x: string | { url: string }) => enCache.get(dirDe(x))?.clone(),
    open: async () => ({
      match: async (x: string | { url: string }) => enCache.get(dirDe(x))?.clone(),
      put: async (x: string | { url: string }, res: Response) => {
        guardados.push(dirDe(x));
        enCache.set(dirDe(x), res);
      },
      add: async (x: string | { url: string }) => {
        intentosAdd.push(dirDe(x));
        if (guardarFalla) throw new TypeError("no se pudo guardar");
        guardados.push(dirDe(x));
        enCache.set(dirDe(x), new Response(PAGINA_SIN_CONEXION));
      },
    }),
  };
  const codigo = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  // `Response` hay que pasarla: la caja de arena no hereda los globales de Node.
  vm.runInNewContext(codigo, { self, fetch, caches, URL, Response });
  return {
    manejadores, pedidos, mostradas, navegadas, abiertas, guardados, intentosAdd,
    enfocadas: () => enfocadas,
    activadas: () => activadas,
    reclamadas: () => reclamadas,
    arreglarGuardado: () => { guardarFalla = false; },
  };
}

/**
 * Abre una pantalla (o hace otro pedido) como lo haría el navegador, y devuelve
 * lo que el service worker contestó, o `null` si no se metió en el pedido.
 */
async function navegar(sw: ReturnType<typeof cargarSW>, url = "https://app.test/preparar", modo = "navigate") {
  const salida: { respuesta?: Promise<unknown> } = {};
  const promesas: Promise<unknown>[] = [];
  sw.manejadores.fetch({
    request: { method: "GET", url, mode: modo },
    respondWith: (p: Promise<unknown>) => (salida.respuesta = Promise.resolve(p)),
    waitUntil: (p: Promise<unknown>) => promesas.push(p),
  });
  const r = salida.respuesta ? await salida.respuesta : null;
  await Promise.all(promesas);
  return r;
}

/** Dispara el evento y devuelve lo que el service worker pidió mantener vivo. */
function lanzar(m: Manejador, evento: Record<string, unknown>) {
  const promesas: Promise<unknown>[] = [];
  m({ ...evento, waitUntil: (p: Promise<unknown>) => promesas.push(p) });
  return promesas;
}

async function disparar(m: Manejador, evento: Record<string, unknown>) {
  await Promise.all(lanzar(m, evento));
}

/** Deja correr todo lo que no depende de la red (las promesas ya resueltas). */
const soltar = () => new Promise((r) => setImmediate(r));

const tocar = (d?: string) => ({ notification: { close: () => {}, data: { url: "/aviso/1", ...(d ? { d } : {}) } } });

test("el push guarda la marca de entrega para cuando lo toquen", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.push, { data: { json: () => ({ title: "El Carmen", body: "Copa 10→24", url: "/aviso/1", d: "ent-1" }) } });
  assert.equal(sw.mostradas[0].titulo, "El Carmen");
  assert.equal(sw.mostradas[0].opciones.data.d, "ent-1");
  assert.equal(sw.mostradas[0].opciones.data.url, "/aviso/1");
});

test("tocar el aviso avisa que se abrió y lleva a su pantalla", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.notificationclick, tocar("ent-1"));
  const abierto = sw.pedidos.find((p) => p.url === "/api/notifications/abierto");
  assert.ok(abierto, "no avisó que se abrió");
  assert.equal(abierto.init?.method, "POST");
  assert.deepEqual(JSON.parse(abierto.init?.body ?? "{}"), { d: "ent-1" });
  assert.deepEqual(sw.navegadas, ["/aviso/1"]);
});

test("un aviso sin marca igual abre, sin avisar nada", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.notificationclick, { notification: { close: () => {}, data: { url: "/notificaciones" } } });
  assert.equal(sw.pedidos.length, 0);
  assert.deepEqual(sw.navegadas, ["/notificaciones"]);
});

test("sin ninguna ventana abierta, tocar el aviso abre una nueva", async () => {
  const sw = cargarSW({ sinVentanas: true });
  await disparar(sw.manejadores.notificationclick, tocar("ent-1"));
  assert.deepEqual(sw.abiertas, ["/aviso/1"]);
  assert.deepEqual(sw.navegadas, []);
});

test("si el servidor no contesta, tocar el aviso abre igual sin esperarlo", async () => {
  // El pedido de "se abrió" queda colgado para siempre: la pantalla no puede
  // depender de él (el navegador solo deja abrir una ventana poco después del
  // toque).
  const sw = cargarSW({ fetch: () => new Promise(() => {}) });
  lanzar(sw.manejadores.notificationclick, tocar("ent-1"));
  await soltar();
  assert.ok(sw.pedidos.some((p) => p.url === "/api/notifications/abierto"), "no avisó que se abrió");
  assert.deepEqual(sw.navegadas, ["/aviso/1"], "esperó al servidor antes de abrir");
});

test("si el servidor no contesta y no hay ventanas, también abre una nueva sin esperarlo", async () => {
  const sw = cargarSW({ sinVentanas: true, fetch: () => new Promise(() => {}) });
  lanzar(sw.manejadores.notificationclick, tocar("ent-1"));
  await soltar();
  assert.deepEqual(sw.abiertas, ["/aviso/1"], "esperó al servidor antes de abrir");
});

test("con la app abierta, tocar el aviso la trae al frente sin esperar a que cargue", async () => {
  // La pantalla nueva tarda para siempre en cargar (señal mala): el foco no
  // puede esperarla, porque el navegador solo deja enfocar poco después del toque.
  const sw = cargarSW({ navegacionColgada: true });
  lanzar(sw.manejadores.notificationclick, tocar("ent-1"));
  await soltar();
  assert.deepEqual(sw.navegadas, ["/aviso/1"], "no empezó a ir a la pantalla del aviso");
  assert.equal(sw.enfocadas(), 1, "esperó a que cargue la pantalla antes de traer la app al frente");
});

test("si traer la app al frente falla, igual termina bien y avisa que se abrió", async () => {
  const sw = cargarSW({ focoFalla: true });
  await disparar(sw.manejadores.notificationclick, tocar("ent-1"));
  assert.deepEqual(sw.navegadas, ["/aviso/1"]);
  assert.ok(sw.pedidos.some((p) => p.url === "/api/notifications/abierto"), "no avisó que se abrió");
});

test("el service worker sigue vivo hasta que termina el aviso de apertura", async () => {
  // Abrir va primero y no espera, pero el pedido de "se abrió" no se puede
  // cortar a la mitad: el aviso queda sin leer si el navegador apaga el
  // service worker antes de que llegue.
  let responder: (r: unknown) => void = () => {};
  const sw = cargarSW({ fetch: () => new Promise((r) => { responder = r; }) });
  let terminado = false;
  const todo = Promise.all(lanzar(sw.manejadores.notificationclick, tocar("ent-1"))).then(() => { terminado = true; });
  await soltar();
  assert.deepEqual(sw.navegadas, ["/aviso/1"], "no abrió");
  assert.equal(terminado, false, "dio por terminado el evento con el aviso de apertura todavía en vuelo");
  responder(respuestaOk);
  await todo;
  assert.equal(terminado, true);
});

test("si el aviso de apertura falla por la red, igual abre", async () => {
  const sw = cargarSW({ fetch: async () => { throw new Error("sin red"); } });
  await disparar(sw.manejadores.notificationclick, tocar("ent-1"));
  assert.deepEqual(sw.navegadas, ["/aviso/1"]);
});

test("si el navegador cambia la suscripción, se vuelve a anotar sola", async () => {
  const sw = cargarSW();
  assert.ok(sw.manejadores.pushsubscriptionchange, "no maneja pushsubscriptionchange");
  await disparar(sw.manejadores.pushsubscriptionchange, { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/vieja", options: {} } });
  const alta = sw.pedidos.find((p) => p.url === "/api/notifications/subscribe" && p.init?.method === "POST");
  const baja = sw.pedidos.find((p) => p.url === "/api/notifications/subscribe" && p.init?.method === "DELETE");
  assert.ok(alta, "no anotó la suscripción nueva");
  assert.match(alta.init?.body ?? "", /nueva/);
  assert.ok(baja, "no dio de baja la vieja");
  assert.match(baja.init?.body ?? "", /vieja/);
});

test("si el servidor no anotó la suscripción nueva, la vieja no se da de baja", async () => {
  const sw = cargarSW({
    fetch: async (p) =>
      p.url === "/api/notifications/subscribe" && p.init?.method === "POST" ? { ok: false, json: async () => ({}) } : respuestaOk,
  });
  await disparar(sw.manejadores.pushsubscriptionchange, { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/vieja", options: {} } });
  assert.ok(sw.pedidos.some((p) => p.init?.method === "POST" && p.url === "/api/notifications/subscribe"), "ni siquiera intentó anotar la nueva");
  assert.equal(sw.pedidos.some((p) => p.init?.method === "DELETE"), false, "dio de baja la vieja sin tener la nueva");
});

/**
 * Abrir una pantalla sin señal (23/10). La regla de fondo: el service worker
 * nunca guarda pantallas ni datos (el stock y los pedidos jamás se ven viejos);
 * lo único que tiene guardado es /sin-conexion.html. Se prueba corriendo el
 * código, no leyendo el texto: así un cambio que empiece a guardar páginas, o
 * que tape un error del servidor con la página de "sin conexión", se nota.
 */
test("al instalarse, guarda la página sin conexión para tenerla cuando falte la señal", async () => {
  const sw = cargarSW({ sinPaginaGuardada: true });
  await disparar(sw.manejadores.install, {});
  assert.deepEqual(sw.guardados, ["/sin-conexion.html"]);
  assert.equal(sw.activadas(), 1, "no se activó después de guardar la página");
});

test("si no se puede guardar la página sin conexión, el service worker se instala igual", async () => {
  // Guardar esa página es un extra: si falla (sin espacio, red caída justo al
  // instalar), la instalación no puede rechazarse, porque con ella se caen
  // también los avisos push, que son lo importante de este archivo.
  const sw = cargarSW({ sinPaginaGuardada: true, guardarFalla: true });
  await disparar(sw.manejadores.install, {});
  assert.equal(sw.activadas(), 1, "la instalación quedó trabada por no poder guardar la página");
  assert.deepEqual(sw.guardados, []);
});

test("si la página sin conexión no se pudo guardar al instalar, la próxima pantalla con señal la guarda", async () => {
  // Sin esto, tolerar el fallo de la instalación dejaba al teléfono sin la página
  // hasta el próximo cambio del archivo: sin señal, la pantalla de error del
  // navegador en vez de la propia.
  const servida = new Response("<h1>Preparar</h1>");
  const sw = cargarSW({ sinPaginaGuardada: true, guardarFalla: true, fetch: async () => servida });
  await disparar(sw.manejadores.install, {});
  assert.deepEqual(sw.guardados, [], "la instalación no debería haber guardado nada");
  sw.arreglarGuardado();
  const r = await navegar(sw);
  assert.equal(r, servida, "no devolvió lo que contestó el servidor");
  assert.deepEqual(sw.guardados, ["/sin-conexion.html"], "con señal no volvió a guardar la página");
});

test("activarse no pide nada a la red, aunque falte la página sin conexión", async () => {
  // Con "señal pero sin datos" un pedido colgado demoraría la activación, y
  // mientras tanto la app no abre.
  const sw = cargarSW({ sinPaginaGuardada: true });
  await disparar(sw.manejadores.activate, {});
  assert.deepEqual(sw.intentosAdd, [], "la activación pidió la página a la red");
  assert.equal(sw.reclamadas(), 1);
});

test("si guardarla al abrir una pantalla falla, la pantalla se muestra igual", async () => {
  const servida = new Response("<h1>Preparar</h1>");
  const sw = cargarSW({ sinPaginaGuardada: true, guardarFalla: true, fetch: async () => servida });
  const r = await navegar(sw);
  assert.equal(r, servida);
  assert.deepEqual(sw.intentosAdd, ["/sin-conexion.html"]);
  assert.deepEqual(sw.guardados, []);
});

test("con la página sin conexión ya guardada, abrir pantallas no la vuelve a pedir", async () => {
  const sw = cargarSW({ fetch: async () => new Response("<h1>Preparar</h1>") });
  await navegar(sw);
  assert.deepEqual(sw.intentosAdd, [], "volvió a bajar una página que el teléfono ya tiene");
});

test("sin señal no intenta guardar la página sin conexión", async () => {
  const sw = cargarSW({ sinPaginaGuardada: true, fetch: async () => { throw new TypeError("Failed to fetch"); } });
  await navegar(sw);
  assert.deepEqual(sw.intentosAdd, []);
});

test("abrir una pantalla con señal trae la del servidor y no guarda nada", async () => {
  const servida = new Response("<h1>Preparar</h1>");
  const sw = cargarSW({ fetch: async () => servida });
  const r = await navegar(sw);
  assert.equal(r, servida, "no devolvió lo que contestó el servidor");
  assert.deepEqual(sw.guardados, [], "guardó una pantalla en el teléfono");
});

test("si el servidor contesta con error, se muestra ese error y no la página sin conexión", async () => {
  // Un 500 es el servidor andando mal, no el teléfono sin señal: taparlo con
  // "sin conexión" mandaría a la persona a buscar la señal en vez de avisar.
  const caida = new Response("falló", { status: 500 });
  const sw = cargarSW({ fetch: async () => caida });
  const r = (await navegar(sw)) as Response;
  assert.equal(r, caida);
  assert.equal(r.status, 500);
  assert.deepEqual(sw.guardados, []);
});

test("abrir una pantalla sin señal muestra la página sin conexión guardada", async () => {
  const sw = cargarSW({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
  const r = (await navegar(sw)) as Response;
  assert.equal(await r.text(), PAGINA_SIN_CONEXION);
  assert.deepEqual(sw.guardados, [], "guardó algo al quedarse sin señal");
});

test("sin señal y sin la página guardada, falla como siempre en vez de inventar una respuesta", async () => {
  const sw = cargarSW({ sinPaginaGuardada: true, fetch: async () => { throw new TypeError("Failed to fetch"); } });
  const r = (await navegar(sw)) as Response;
  assert.equal(r.type, "error", "devolvió una respuesta común en vez del error de red");
});

test("los datos y el resto de los pedidos no se atienden ni se guardan", async () => {
  // Solo las pantallas tienen la salida de "sin conexión". Un pedido de datos
  // (el stock, los pedidos) pasa derecho al servidor: sin señal tiene que fallar,
  // nunca devolver algo guardado.
  const sw = cargarSW({ fetch: async () => new Response("{}") });
  const r = await navegar(sw, "https://app.test/api/stock", "cors");
  assert.equal(r, null, "se metió en un pedido de datos");
  assert.deepEqual(sw.guardados, []);
});
