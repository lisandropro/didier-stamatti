import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avancePorSector,
  cambiosParaAplicar,
  claveDeLinea,
  clavesParaTildarSector,
  estadoDeItems,
  textoDeAccion,
  type LineaPedido,
  type Tildado,
} from "../lib/preparacion";

/**
 * El estado de cada ítem en el depósito, calculado: lo tildado (lo que había
 * al tildar) contra el pedido de ahora. Es la tabla de la spec, caso por caso.
 */

const L = (clave: string, qty: number, note: string | null = null, category = "ENSERES"): LineaPedido => ({
  clave, itemName: `Item ${clave}`, unit: "Unidad", category, qty, note,
});
const T = (clave: string, qty: number, note: string | null = null, category = "ENSERES"): Tildado => ({
  clave, itemName: `Item ${clave}`, unit: "Unidad", category, qty, note, porName: "Pablo", at: new Date("2026-10-20T12:00:00Z"),
});
const uno = (lineas: LineaPedido[], tildados: Tildado[]) => {
  const r = estadoDeItems(lineas, tildados);
  assert.equal(r.length, 1);
  return r[0];
};

test("sin tildar: pendiente, sin acción", () => {
  const i = uno([L("a", 10)], []);
  assert.equal(i.estado, "PENDIENTE");
  assert.equal(i.accion, null);
  assert.equal(i.tildado, null);
});

test("tildado con la misma cantidad y nota: preparado", () => {
  assert.equal(uno([L("a", 10, "largos")], [T("a", 10, "largos")]).estado, "PREPARADO");
});

test("nota vacía y nota nula son la misma nota", () => {
  assert.equal(uno([L("a", 10, "")], [T("a", 10, null)]).estado, "PREPARADO");
});

test("el pedido subió después de tildar: sumá la diferencia", () => {
  const i = uno([L("a", 24)], [T("a", 10)]);
  assert.equal(i.estado, "CAMBIO");
  assert.equal(i.accion, "Sumá 14");
  assert.equal(i.tildado?.qty, 10);
});

test("el pedido bajó después de tildar: sacá la diferencia", () => {
  const i = uno([L("a", 4)], [T("a", 10)]);
  assert.equal(i.estado, "CAMBIO");
  assert.equal(i.accion, "Sacá 6");
});

test("cambió la cantidad y también la nota: manda la cantidad", () => {
  assert.equal(uno([L("a", 12, "otra")], [T("a", 10, "una")]).estado, "CAMBIO");
});

test("misma cantidad, otra nota: cambió la nota", () => {
  const i = uno([L("a", 10, "los largos")], [T("a", 10, null)]);
  assert.equal(i.estado, "NOTA");
  assert.equal(i.accion, "Cambió la nota");
});

test("tildado y ya no está en el pedido: sacar", () => {
  const i = uno([], [T("a", 3)]);
  assert.equal(i.estado, "SACAR");
  assert.equal(i.qty, 0);
  assert.equal(i.accion, "Sacá 3 · ya no va");
  assert.equal(i.itemName, "Item a", "lo tildado tiene que poder leerse solo");
});

test("un renglón en cero no es un pedido", () => {
  assert.deepEqual(estadoDeItems([L("a", 0)], []), []);
});

test("tildado y con el renglón en cero: también hay que sacarlo", () => {
  const i = uno([L("a", 0)], [T("a", 3)]);
  assert.equal(i.estado, "SACAR");
  assert.equal(i.accion, "Sacá 3 · ya no va");
});

test("el texto de las acciones que faltaban: bajar, nota borrada, nota de espacios", () => {
  assert.equal(textoDeAccion(uno([L("a", 4)], [T("a", 10)])), "Sacá 6 Item a");
  assert.equal(textoDeAccion(uno([L("a", 3, null)], [T("a", 3, "largos")])), "Item a: sin nota");
  assert.equal(estadoDeItems([L("a", 3, "  largos ")], [T("a", 3, "largos")])[0].estado, "PREPARADO", "los espacios de más no cambian la nota");
});

test("la clave es el producto, o custom:<renglón> para los sueltos", () => {
  assert.equal(claveDeLinea({ id: "l1", productId: "p1" }), "p1");
  assert.equal(claveDeLinea({ id: "l1", productId: null }), "custom:l1");
});

test("cambios para aplicar: lo que cambió, la nota y lo que hay que sacar", () => {
  const items = estadoDeItems(
    [L("pend", 1), L("prep", 2), L("camb", 5), L("nota", 3, "x")],
    [T("prep", 2), T("camb", 2), T("nota", 3), T("sacar", 7)],
  );
  assert.deepEqual(cambiosParaAplicar(items).map((i) => i.clave).sort(), ["camb", "nota", "sacar"]);
});

test("el texto de cada acción, como lo lee el que prepara", () => {
  // Ordenados por clave: camb, nota, sacar.
  const [camb, nota, sacar] = estadoDeItems([L("camb", 24), L("nota", 3, "los largos")], [T("camb", 10), T("sacar", 3), T("nota", 3)]).sort((a, b) => a.clave.localeCompare(b.clave));
  assert.equal(textoDeAccion(camb), "Sumá 14 Item camb");
  assert.equal(textoDeAccion(nota), 'Item nota: nota "los largos"');
  // En el push, sacar un ítem entero o parte es la misma acción física: "Sacá 3 Braseros".
  assert.equal(textoDeAccion(sacar), "Sacá 3 Item sacar");
});

test("avance por sector: lo al día sobre lo que hay que mover, incluido lo que hay que sacar", () => {
  const items = estadoDeItems(
    [L("a", 1), L("b", 1), L("m", 1, null, "MOBILIARIO")],
    [T("a", 1), T("z", 2), T("m", 1, null, "MOBILIARIO")],
  );
  assert.deepEqual(avancePorSector(items).get("ENSERES"), { listos: 1, total: 3 });
  assert.deepEqual(avancePorSector(items).get("MOBILIARIO"), { listos: 1, total: 1 });
});

test("tildar un sector entero toma solo lo pendiente de ese sector", () => {
  const items = estadoDeItems(
    [L("p1", 1), L("p2", 2), L("camb", 5), L("otro", 1, null, "BEBIDA")],
    [T("camb", 2), T("sacar", 3)],
  );
  assert.deepEqual(clavesParaTildarSector(items, "ENSERES").sort(), ["p1", "p2"]);
});
