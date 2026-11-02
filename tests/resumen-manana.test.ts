import { test } from "node:test";
import assert from "node:assert/strict";
import { esHoraDelResumen, textoDelResumen, type DatosDelResumen } from "../lib/resumen-manana";

const ev = (lugar: string, renglones = 10, listo = false) => ({ lugar, renglones, listo });
const base: DatosDelResumen = { hoy: [ev("MUSEO", 41, true)], manana: [ev("PUERTO ABAJO", 0), ev("GUALEGUYCHU", 50)], faltan: 13, sinAvisos: ["Pablo"] };

test("sale entre las 7 y las 11", () => {
  assert.equal(esHoraDelResumen(6), false);
  assert.equal(esHoraDelResumen(7), true);
  assert.equal(esHoraDelResumen(10), true);
  assert.equal(esHoraDelResumen(11), false);
});

test("sin eventos hoy ni mañana no hay resumen", () => {
  assert.equal(textoDelResumen("ADMIN", { hoy: [], manana: [], faltan: 0, sinAvisos: ["Pablo"] }), null);
});

test("todos ven los eventos de hoy y de mañana y los faltantes", () => {
  const r = textoDelResumen("DEPOSITO", base)!;
  assert.match(r.body, /Hoy: MUSEO/);
  assert.match(r.body, /Mañana: PUERTO ABAJO y GUALEGUYCHU/);
  assert.match(r.body, /Faltan 13 productos/);
});

test("el depósito no ve lo de armar pedidos ni quién no tiene avisos, y va a Preparar", () => {
  const r = textoDelResumen("DEPOSITO", base)!;
  assert.doesNotMatch(r.body, /Sin pedido|Sin marcar listo|Sin avisos/);
  assert.equal(r.url, "/preparar");
});

test("quien arma pedidos ve los que no tienen pedido y los que falta marcar listos", () => {
  const r = textoDelResumen("ARMADOR", base)!;
  assert.match(r.body, /Sin pedido: 1/);
  assert.match(r.body, /Sin marcar listo: 1/);
  assert.doesNotMatch(r.body, /Sin avisos/);
  assert.equal(r.url, "/");
});

test("la administradora ve además quién no tiene los avisos activados", () => {
  assert.match(textoDelResumen("ADMIN", base)!.body, /Sin avisos en el celular: Pablo/);
});

test("más de tres eventos en un día se resumen", () => {
  const r = textoDelResumen("DEPOSITO", { ...base, hoy: [ev("A"), ev("B"), ev("C"), ev("D"), ev("E")] })!;
  assert.match(r.body, /Hoy: A, B, C y 2 más/);
});

test("un día sin eventos lo dice, si el otro tiene", () => {
  assert.match(textoDelResumen("DEPOSITO", { ...base, hoy: [] })!.body, /Hoy no hay eventos/);
});

test("el cuerpo nunca pasa de 500 caracteres", () => {
  const largo = Array.from({ length: 40 }, (_, i) => ev(`EVENTO CON UN NOMBRE MUY LARGO NÚMERO ${i}`));
  const r = textoDelResumen("ADMIN", { hoy: largo, manana: largo, faltan: 999, sinAvisos: largo.map((e) => e.lugar) })!;
  assert.ok(r.body.length <= 500);
});
