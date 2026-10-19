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

function cargarSW() {
  const manejadores: Record<string, Manejador> = {};
  const pedidos: { url: string; init?: { method?: string; body?: string } }[] = [];
  const mostradas: { titulo: string; opciones: { data: { url: string; d?: string } } }[] = [];
  const navegadas: string[] = [];
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
      matchAll: async () => [{ focus: async () => {}, navigate: async (u: string) => { navegadas.push(u); } }],
      openWindow: async (u: string) => { navegadas.push(u); },
    },
  };
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    pedidos.push({ url, init });
    return { json: async () => ({ clave: "BClave" }) };
  };
  const codigo = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(codigo, { self, fetch, caches: { keys: async () => [], match: async () => undefined, open: async () => ({ put: async () => {} }), delete: async () => true }, URL });
  return { manejadores, pedidos, mostradas, navegadas };
}

async function disparar(m: Manejador, evento: Record<string, unknown>) {
  const promesas: Promise<unknown>[] = [];
  m({ ...evento, waitUntil: (p: Promise<unknown>) => promesas.push(p) });
  await Promise.all(promesas);
}

test("el push guarda la marca de entrega para cuando lo toquen", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.push, { data: { json: () => ({ title: "El Carmen", body: "Copa 10→24", url: "/aviso/1", d: "ent-1" }) } });
  assert.equal(sw.mostradas[0].titulo, "El Carmen");
  assert.equal(sw.mostradas[0].opciones.data.d, "ent-1");
  assert.equal(sw.mostradas[0].opciones.data.url, "/aviso/1");
});

test("tocar el aviso avisa que se abrió y lleva a su pantalla", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.notificationclick, { notification: { close: () => {}, data: { url: "/aviso/1", d: "ent-1" } } });
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
