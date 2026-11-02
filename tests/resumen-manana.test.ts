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

test("los nombres largos no se comen las líneas de cada rol", () => {
  // El lugar es texto libre y puede ser una dirección entera. Si no se acota
  // cada nombre, el recorte del final se lleva primero lo que más le importa
  // a cada rol (Sin pedido, Faltan, Sin avisos) y deja solo la lista de eventos.
  const direccion = "SALÓN DE EVENTOS LOS ALAMOS, RUTA PROVINCIAL 11 KILÓMETRO 214, ENTRE RÍOS, ENTRADA POR EL PORTÓN LATERAL";
  const largo = Array.from({ length: 40 }, (_, i) => ev(`${direccion} ${i}`, 0));
  const r = textoDelResumen("ADMIN", { hoy: largo, manana: largo, faltan: 999, sinAvisos: largo.map((e) => e.lugar) })!;
  assert.match(r.body, /Sin pedido/);
  assert.match(r.body, /Faltan 999 productos/);
  assert.match(r.body, /Sin avisos en el celular/);
  assert.ok(r.body.length <= 500);
});

test("un lugar sin nombre no deja una línea vacía", () => {
  assert.match(textoDelResumen("DEPOSITO", { ...base, hoy: [ev("   ")] })!.body, /Hoy: \(sin nombre\)/);
});

test("con un solo producto faltante dice Falta, en singular", () => {
  const uno = textoDelResumen("DEPOSITO", { ...base, faltan: 1 })!;
  assert.match(uno.body, /Falta 1 producto en el depósito\./);
  assert.doesNotMatch(uno.body, /Faltan/);
  assert.match(textoDelResumen("DEPOSITO", { ...base, faltan: 2 })!.body, /Faltan 2 productos en el depósito\./);
});

test("sin faltantes no hay línea de faltantes", () => {
  assert.doesNotMatch(textoDelResumen("DEPOSITO", { ...base, faltan: 0 })!.body, /Falta/);
});

test("el encargado de logística ve hoy, mañana y faltantes, pero no lo de armar pedidos ni quién no tiene avisos", () => {
  // Mira todo pero no arma pedidos (canEditOrders es solo ADMIN y ARMADOR), y
  // el depósito es el único que va a Preparar: él entra por el inicio.
  const r = textoDelResumen("LOGISTICA", base)!;
  assert.match(r.body, /Hoy: MUSEO/);
  assert.match(r.body, /Mañana: PUERTO ABAJO y GUALEGUYCHU/);
  assert.match(r.body, /Faltan 13 productos/);
  assert.doesNotMatch(r.body, /Sin pedido|Sin marcar listo|Sin avisos/);
  assert.equal(r.url, "/");
});

test("con exactamente tres eventos en un día se nombran los tres, sin 'más'", () => {
  const r = textoDelResumen("DEPOSITO", { ...base, hoy: [ev("A"), ev("B"), ev("C")] })!;
  assert.match(r.body, /Hoy: A, B y C(\n|$)/);
  assert.doesNotMatch(r.body, /Hoy:.* más/);
});

test("quien arma pedidos ve las dos cuentas juntas en una sola línea", () => {
  const r = textoDelResumen("ADMIN", base)!;
  assert.ok(r.body.split("\n").includes("Sin pedido: 1 · Sin marcar listo: 1"));
});

test("quien no tiene avisos se nombra hasta tres, y el resto se cuenta", () => {
  const nombres = ["Ana", "Beto", "Carla", "Diego", "Eva"];
  assert.match(textoDelResumen("ADMIN", { ...base, sinAvisos: nombres })!.body, /Sin avisos en el celular: Ana, Beto, Carla y 2 más/);
  assert.match(textoDelResumen("ADMIN", { ...base, sinAvisos: ["Ana", "Beto"] })!.body, /Sin avisos en el celular: Ana y Beto/);
  assert.doesNotMatch(textoDelResumen("ADMIN", { ...base, sinAvisos: [] })!.body, /Sin avisos/);
});

test("el nombre de quien no tiene avisos también se acota", () => {
  const r = textoDelResumen("ADMIN", { ...base, sinAvisos: ["N".repeat(100)] })!;
  const linea = r.body.split("\n").find((l) => l.startsWith("Sin avisos en el celular: "))!;
  assert.equal(linea.length, "Sin avisos en el celular: ".length + 30);
  assert.ok(linea.endsWith("…"));
});
