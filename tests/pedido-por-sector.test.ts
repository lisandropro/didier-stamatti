import { test } from "node:test";
import assert from "node:assert/strict";
import { nombreDeArchivo, sePuedeDespachar, sectoresConPedido, type LineaDePedido } from "../lib/order-sections";

/**
 * Despachar el pedido de un sector solo.
 *
 * A quien prepara la bebida no le sirven las hojas de mobiliario. Lo que se
 * cuida acá es que el botón y el archivo digan lo mismo: si la pantalla ofrece
 * un sector, el PDF de ese sector tiene que traer renglones. Ofrecer uno vacío
 * es peor que no ofrecerlo, porque quien lo recibe cree que no falta cargar.
 */

const l = (categoria: string, esDeCatalogo = true): LineaDePedido => ({ categoria, esDeCatalogo });

const PEDIDO: LineaDePedido[] = [
  l("BEBIDA"),
  l("ENSERES"),
  l("ENSERES"),
  l("MANTELERIA"),
  l("ENSERES", false), // un ítem suelto cuenta igual: también hay que ir a buscarlo
];

test("solo se ofrecen los sectores que tienen algo pedido", () => {
  assert.deepEqual(
    sectoresConPedido(PEDIDO).map((s) => s.key),
    ["ENSERES", "MANTELERIA", "BEBIDA"],
  );
});

test("mobiliario no aparece si no se pidió mobiliario", () => {
  assert.equal(sectoresConPedido(PEDIDO).some((s) => s.key === "MOBILIARIO"), false);
  assert.equal(sePuedeDespachar(PEDIDO, "MOBILIARIO"), false);
});

test("los sectores salen en el mismo orden que en el pedido impreso", () => {
  // Enseres, Mantelería, Mobiliario, Bebida. Si la pantalla los ordenara por su
  // cuenta, el PDF y los botones dirían cosas distintas.
  const todos = sectoresConPedido([l("BEBIDA"), l("MOBILIARIO"), l("MANTELERIA"), l("ENSERES")]);
  assert.deepEqual(todos.map((s) => s.key), ["ENSERES", "MANTELERIA", "MOBILIARIO", "BEBIDA"]);
});

test("se cuenta cuántas líneas lleva cada sector", () => {
  const porSector = new Map(sectoresConPedido(PEDIDO).map((s) => [s.key, s.lineas]));
  assert.equal(porSector.get("ENSERES"), 3, "dos de catálogo y un ítem suelto");
  assert.equal(porSector.get("MANTELERIA"), 1);
  assert.equal(porSector.get("BEBIDA"), 1);
});

test("un ítem suelto alcanza para que el sector se pueda despachar", () => {
  assert.equal(sePuedeDespachar([l("MOBILIARIO", false)], "MOBILIARIO"), true);
});

test("un pedido vacío no ofrece ningún sector", () => {
  assert.deepEqual(sectoresConPedido([]), []);
  assert.equal(sePuedeDespachar([], "ENSERES"), false);
});

test("una categoría inventada no se cuela como sector", () => {
  assert.deepEqual(sectoresConPedido([l("VAJILLA"), l("")]), []);
  assert.equal(sePuedeDespachar([l("VAJILLA")], "VAJILLA"), false);
});

test("el nombre del archivo dice de qué sector es, y va adelante", () => {
  // La barra de la fecha se limpia: es separador de rutas y no puede ir en un
  // nombre de archivo, ni en Windows ni en Android.
  // En el celular el nombre se corta: lo que distingue tiene que estar al principio.
  assert.equal(
    nombreDeArchivo("El Carmen Center", "Sáb 16/8", "BEBIDA"),
    "Pedido - Bebida - El Carmen Center - Sáb 16 8",
  );
});

test("sin sector, el nombre es el del pedido entero — el de siempre", () => {
  assert.equal(
    nombreDeArchivo("El Carmen Center", "Sáb 16/8"),
    "Pedido - El Carmen Center - Sáb 16 8",
  );
  assert.equal(nombreDeArchivo("El Carmen Center", "Sáb 16/8", null), "Pedido - El Carmen Center - Sáb 16 8");
});

test("un lugar con caracteres que rompen nombres de archivo se limpia", () => {
  // Windows y Android rechazan / \\ : * ? \" < > |. Un lugar escrito con barra
  // —"Salón A/B"— no puede impedir que se descargue el pedido.
  assert.equal(
    nombreDeArchivo('Salón A/B: "el grande"', "Vie 1/5", "MANTELERIA"),
    "Pedido - Mantelería - Salón A B el grande - Vie 1 5",
  );
});

test("el acento del sector se conserva en el nombre", () => {
  assert.match(nombreDeArchivo("Puerto", "Mar 3/2", "MANTELERIA"), /Mantelería/);
});
