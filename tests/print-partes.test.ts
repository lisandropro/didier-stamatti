import { test } from "node:test";
import assert from "node:assert/strict";
import { bloquesVisibles } from "../components/PrintablePedido";

/**
 * Qué sale por la impresora con cada botón.
 *
 * En el depósito son dos trabajos distintos: el pedido se lleva quien arma y
 * los cartelitos se pegan en cada sector. Antes salía todo junto y había que
 * separar las hojas a mano.
 *
 * El orden importa: las hojas salen en el mismo orden en que se ven en
 * pantalla, así nadie tiene que reordenarlas.
 */

type B = { clave: string; tipo: "cartel" | "seccion" };

// Un pedido normal: cartel de Enseres, Enseres, Mobiliario (sin cartel),
// cartel de Bebida, Bebida.
const PEDIDO: B[] = [
  { clave: "cartel-ENSERES", tipo: "cartel" },
  { clave: "sec-ENSERES", tipo: "seccion" },
  { clave: "sec-MOBILIARIO", tipo: "seccion" },
  { clave: "cartel-BEBIDA", tipo: "cartel" },
  { clave: "sec-BEBIDA", tipo: "seccion" },
];

test("en pantalla se sigue viendo todo, en el mismo orden", () => {
  assert.deepEqual(
    bloquesVisibles(PEDIDO, "todo").map((b) => b.clave),
    PEDIDO.map((b) => b.clave),
  );
});

test("el botón del pedido imprime las hojas del pedido y ningún cartel", () => {
  assert.deepEqual(
    bloquesVisibles(PEDIDO, "pedido").map((b) => b.clave),
    ["sec-ENSERES", "sec-MOBILIARIO", "sec-BEBIDA"],
  );
});

test("el botón de los cartelitos imprime solo los carteles", () => {
  assert.deepEqual(
    bloquesVisibles(PEDIDO, "carteles").map((b) => b.clave),
    ["cartel-ENSERES", "cartel-BEBIDA"],
  );
});

test("las dos partes juntas son el pedido entero, sin repetir ni perder nada", () => {
  const partes = [...bloquesVisibles(PEDIDO, "carteles"), ...bloquesVisibles(PEDIDO, "pedido")];
  assert.equal(partes.length, PEDIDO.length);
  assert.deepEqual(new Set(partes.map((b) => b.clave)), new Set(PEDIDO.map((b) => b.clave)));
});

test("un pedido de un solo sector con cartel imprime una hoja por parte", () => {
  const uno: B[] = [
    { clave: "cartel-BEBIDA", tipo: "cartel" },
    { clave: "sec-BEBIDA", tipo: "seccion" },
  ];
  assert.equal(bloquesVisibles(uno, "carteles").length, 1);
  assert.equal(bloquesVisibles(uno, "pedido").length, 1);
});

test("un pedido de puro mobiliario no tiene cartelitos para imprimir", () => {
  const soloMobiliario: B[] = [{ clave: "sec-MOBILIARIO", tipo: "seccion" }];
  assert.deepEqual(bloquesVisibles(soloMobiliario, "carteles"), []);
  assert.equal(bloquesVisibles(soloMobiliario, "pedido").length, 1);
});

test("nunca se toca la lista original", () => {
  const copia = PEDIDO.map((b) => ({ ...b }));
  bloquesVisibles(PEDIDO, "carteles");
  bloquesVisibles(PEDIDO, "pedido");
  assert.deepEqual(PEDIDO, copia);
});
