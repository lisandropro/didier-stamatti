import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirFaltantes, type Faltante } from "../lib/faltantes";

/**
 * Qué hacer con los faltantes de un período en cada barrido: la tabla de la
 * spec, caso por caso. Sin base de datos.
 */

const F = (productId: string, missing: number): Faltante => ({
  productId, name: `Producto ${productId}`, totalRequested: 100 + missing, stock: 100, missing,
});

test("la primera corrida registra todo lo que falta y no avisa nada", () => {
  const d = decidirFaltantes([F("a", 50), F("b", 3)], [], true);
  assert.deepEqual(d.avisar, []);
  assert.deepEqual(d.guardar, [{ productId: "a", missing: 50 }, { productId: "b", missing: 3 }]);
  assert.deepEqual(d.borrar, []);
});

test("un faltante nuevo se avisa y se guarda", () => {
  const d = decidirFaltantes([F("a", 50)], [], false);
  assert.deepEqual(d.avisar.map((f) => f.productId), ["a"]);
  assert.deepEqual(d.guardar, [{ productId: "a", missing: 50 }]);
});

test("ya avisado y faltando lo mismo: nada", () => {
  const d = decidirFaltantes([F("a", 50)], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d, { avisar: [], guardar: [], borrar: [] });
});

test("falta más que lo avisado: se avisa otra vez y se guarda lo nuevo", () => {
  const d = decidirFaltantes([F("a", 70)], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d.avisar.map((f) => f.missing), [70]);
  assert.deepEqual(d.guardar, [{ productId: "a", missing: 70 }]);
});

test("falta menos que lo avisado: no se avisa ni se baja lo guardado", () => {
  // Lo guardado es lo que se avisó: si después vuelve a subir sin pasar ese
  // número, el depósito ya sabía que faltaba al menos eso.
  const d = decidirFaltantes([F("a", 30)], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d, { avisar: [], guardar: [], borrar: [] });
});

test("dejó de faltar: se borra la fila, sin aviso", () => {
  const d = decidirFaltantes([], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d, { avisar: [], guardar: [], borrar: ["a"] });
});

test("la primera corrida también borra lo que ya no falta", () => {
  // Una fila puede quedar de antes si el período se recuperó de la papelera.
  const d = decidirFaltantes([F("a", 1)], [{ productId: "z", missing: 9 }], true);
  assert.deepEqual(d.borrar, ["z"]);
  assert.deepEqual(d.avisar, []);
});

test("un barrido con todo mezclado: cada lista lleva solo lo suyo y en el orden de lo que falta", () => {
  // Nuevo (b), igual (a), peor (c), mejor (d) y resuelto (e), en un solo barrido.
  const actuales = [F("c", 40), F("b", 9), F("a", 10), F("d", 2)];
  const avisados = [
    { productId: "a", missing: 10 },
    { productId: "c", missing: 30 },
    { productId: "d", missing: 5 },
    { productId: "e", missing: 7 },
  ];
  const d = decidirFaltantes(actuales, avisados, false);
  // El orden de `actuales` se respeta: el barrido los recibe de mayor a menor faltante.
  assert.deepEqual(d.avisar.map((f) => f.productId), ["c", "b"]);
  assert.deepEqual(d.guardar, [{ productId: "c", missing: 40 }, { productId: "b", missing: 9 }]);
  assert.deepEqual(d.borrar, ["e"]);
});
