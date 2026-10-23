import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDeStock, avisosDeFila } from "../lib/fila-de-pedido";

/**
 * Lo que cada fila del armador dice de su stock.
 *
 * La pantalla ancha lo muestra como chip y barra. La fila compacta del celular
 * lo muestra como una segunda línea chica que aparece SOLO cuando hay algo que
 * decir: si cada fila dijera "Alcanza", todas medirían el doble y volverían a
 * entrar 2 productos por pantalla, que es lo que esta etapa vino a arreglar.
 */

const base = { type: "REUTILIZABLE", stock: 10, qty: 0, reserved: 0, note: "" };

test("un consumible no tiene estado de stock", () => {
  assert.equal(estadoDeStock({ ...base, type: "CONSUMIBLE", qty: 5 }), null);
});

test("sin recuento dice Sin contar, no un número inventado", () => {
  assert.deepEqual(estadoDeStock({ ...base, stock: null, qty: 4 }), { cls: "neutral", txt: "Sin contar" });
});

test("si lo que piden todos supera el stock, dice cuánto falta", () => {
  assert.deepEqual(estadoDeStock({ ...base, qty: 6, reserved: 7 }), { cls: "crit", txt: "Faltan 3" });
});

test("justo lo que hay es al límite", () => {
  assert.deepEqual(estadoDeStock({ ...base, qty: 4, reserved: 6 }), { cls: "warn", txt: "Al límite" });
});

test("pedido y con lugar, alcanza", () => {
  assert.deepEqual(estadoDeStock({ ...base, qty: 3 }), { cls: "ok", txt: "Alcanza" });
});

test("un reutilizable que nadie pide y alcanza no tiene nada que decir", () => {
  assert.equal(estadoDeStock({ ...base, reserved: 2 }), null);
});

test("la fila compacta no repite Alcanza", () => {
  assert.deepEqual(avisosDeFila({ ...base, qty: 3 }), []);
});

test("la fila compacta avisa el faltante aunque este evento no lo pida", () => {
  assert.deepEqual(avisosDeFila({ ...base, reserved: 12 }), [{ cls: "crit", txt: "Faltan 2" }]);
});

test("sin contar se avisa solo si este pedido lo usa", () => {
  assert.deepEqual(avisosDeFila({ ...base, stock: null }), []);
  assert.deepEqual(avisosDeFila({ ...base, stock: null, qty: 2 }), [{ cls: "neutral", txt: "Sin contar" }]);
});

test("la nota va en la segunda línea", () => {
  assert.deepEqual(avisosDeFila({ ...base, type: "CONSUMIBLE", qty: 5, note: "doradas" }), [{ cls: "nota", txt: "✎ doradas" }]);
});

test("un producto dado de baja dice primero qué hacer con él", () => {
  assert.deepEqual(avisosDeFila({ ...base, stock: 1, qty: 3, deBaja: true }), [
    { cls: "crit", txt: "Ya no está en el catálogo: poné 0" },
    { cls: "crit", txt: "Faltan 2" },
  ]);
});
