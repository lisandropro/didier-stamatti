import { test } from "node:test";
import assert from "node:assert/strict";
import { bloquesVisibles } from "../components/PrintablePedido";

/**
 * Qué sale por la impresora con cada botón.
 *
 * En el depósito son trabajos distintos: el pedido se lo lleva quien arma, los
 * cartelitos se pegan en cada sector, y a quien prepara la bebida no le sirven
 * las hojas de mobiliario. Antes salía todo junto y había que separar las hojas
 * a mano.
 *
 * El orden importa: las hojas salen en el mismo orden en que se ven en
 * pantalla, así nadie tiene que reordenarlas.
 */

type B = { clave: string; tipo: "cartel" | "seccion"; sector: string };

// Un pedido normal: cartel de Enseres, Enseres, Mantelería, Mobiliario (sin
// cartel), cartel de Bebida, Bebida.
const PEDIDO: B[] = [
  { clave: "cartel-ENSERES", tipo: "cartel", sector: "ENSERES" },
  { clave: "sec-ENSERES", tipo: "seccion", sector: "ENSERES" },
  { clave: "sec-MANTELERIA", tipo: "seccion", sector: "MANTELERIA" },
  { clave: "sec-MOBILIARIO", tipo: "seccion", sector: "MOBILIARIO" },
  { clave: "cartel-BEBIDA", tipo: "cartel", sector: "BEBIDA" },
  { clave: "sec-BEBIDA", tipo: "seccion", sector: "BEBIDA" },
];

const claves = (bs: B[]) => bs.map((b) => b.clave);

test("en pantalla se sigue viendo todo, en el mismo orden", () => {
  assert.deepEqual(claves(bloquesVisibles(PEDIDO, { que: "todo" })), claves(PEDIDO));
});

test("el botón del pedido imprime las hojas del pedido y ningún cartel", () => {
  assert.deepEqual(claves(bloquesVisibles(PEDIDO, { que: "pedido" })), [
    "sec-ENSERES",
    "sec-MANTELERIA",
    "sec-MOBILIARIO",
    "sec-BEBIDA",
  ]);
});

test("el botón de los cartelitos imprime solo los carteles", () => {
  assert.deepEqual(claves(bloquesVisibles(PEDIDO, { que: "carteles" })), ["cartel-ENSERES", "cartel-BEBIDA"]);
});

test("las dos partes juntas son el pedido entero, sin repetir ni perder nada", () => {
  const partes = [
    ...bloquesVisibles(PEDIDO, { que: "carteles" }),
    ...bloquesVisibles(PEDIDO, { que: "pedido" }),
  ];
  assert.equal(partes.length, PEDIDO.length);
  assert.deepEqual(new Set(claves(partes)), new Set(claves(PEDIDO)));
});

// ---------------------------------------------------------------------------
// Un sector solo
// ---------------------------------------------------------------------------

test("imprimir un sector trae su hoja y ninguna otra", () => {
  assert.deepEqual(claves(bloquesVisibles(PEDIDO, { que: "pedido", sector: "BEBIDA" })), ["sec-BEBIDA"]);
  assert.deepEqual(claves(bloquesVisibles(PEDIDO, { que: "pedido", sector: "MANTELERIA" })), ["sec-MANTELERIA"]);
});

test("imprimir un sector no arrastra su cartel", () => {
  // El cartel es otra cosa: la hoja apaisada que se pega en el depósito. Quien
  // pide la hoja del pedido no quiere que salga también el cartel.
  const salida = bloquesVisibles(PEDIDO, { que: "pedido", sector: "ENSERES" });
  assert.deepEqual(claves(salida), ["sec-ENSERES"]);
  assert.equal(salida.some((b) => b.tipo === "cartel"), false);
});

test("el cartel de un sector se puede pedir solo", () => {
  assert.deepEqual(claves(bloquesVisibles(PEDIDO, { que: "carteles", sector: "BEBIDA" })), ["cartel-BEBIDA"]);
});

test("un sector sin nada pedido no imprime nada, en vez de imprimir todo", () => {
  // El riesgo real: que un filtro que no encuentra nada caiga en "mostrar todo"
  // y le mande el pedido entero a quien pidió una sola hoja.
  assert.deepEqual(bloquesVisibles(PEDIDO, { que: "pedido", sector: "VAJILLA" }), []);
  assert.deepEqual(bloquesVisibles(PEDIDO, { que: "carteles", sector: "MOBILIARIO" }), []);
});

test("cada sector por separado suma exactamente el pedido completo", () => {
  const porSector = ["ENSERES", "MANTELERIA", "MOBILIARIO", "BEBIDA"].flatMap((s) =>
    bloquesVisibles(PEDIDO, { que: "pedido", sector: s })
  );
  assert.deepEqual(claves(porSector), claves(bloquesVisibles(PEDIDO, { que: "pedido" })));
});

test("un pedido de un solo sector con cartel imprime una hoja por parte", () => {
  const uno: B[] = [
    { clave: "cartel-BEBIDA", tipo: "cartel", sector: "BEBIDA" },
    { clave: "sec-BEBIDA", tipo: "seccion", sector: "BEBIDA" },
  ];
  assert.equal(bloquesVisibles(uno, { que: "carteles" }).length, 1);
  assert.equal(bloquesVisibles(uno, { que: "pedido" }).length, 1);
});

test("un pedido de puro mobiliario no tiene cartelitos para imprimir", () => {
  const soloMobiliario: B[] = [{ clave: "sec-MOBILIARIO", tipo: "seccion", sector: "MOBILIARIO" }];
  assert.deepEqual(bloquesVisibles(soloMobiliario, { que: "carteles" }), []);
  assert.equal(bloquesVisibles(soloMobiliario, { que: "pedido" }).length, 1);
});

test("nunca se toca la lista original", () => {
  const copia = PEDIDO.map((b) => ({ ...b }));
  bloquesVisibles(PEDIDO, { que: "carteles" });
  bloquesVisibles(PEDIDO, { que: "pedido", sector: "BEBIDA" });
  assert.deepEqual(PEDIDO, copia);
});
