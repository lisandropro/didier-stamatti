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
};

const respuestaOk = { ok: true, json: async () => ({ clave: "BClave" }) };

function cargarSW(opciones: Opciones = {}) {
  const manejadores: Record<string, Manejador> = {};
  const pedidos: Pedido[] = [];
  const mostradas: { titulo: string; opciones: { data: { url: string; d?: string } } }[] = [];
  const navegadas: string[] = [];
  const abiertas: string[] = [];
  const self = {
    addEventListener: (tipo: string, fn: Manejador) => (manejadores[tipo] = fn),
    skipWaiting: () => {},
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
      claim: async () => {},
      matchAll: async () =>
        opciones.sinVentanas ? [] : [{ focus: async () => {}, navigate: async (u: string) => { navegadas.push(u); } }],
      openWindow: async (u: string) => { abiertas.push(u); },
    },
  };
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const pedido = { url, init };
    pedidos.push(pedido);
    return opciones.fetch ? opciones.fetch(pedido) : respuestaOk;
  };
  const codigo = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(codigo, { self, fetch, caches: { keys: async () => [], match: async () => undefined, open: async () => ({ put: async () => {} }), delete: async () => true }, URL });
  return { manejadores, pedidos, mostradas, navegadas, abiertas };
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
