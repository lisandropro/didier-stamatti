import { test } from "node:test";
import assert from "node:assert/strict";
import { computeShortage, necesitaRecuento, type ShortageInput } from "../lib/shortage-rule";

/**
 * "Hay cero" y "nunca lo contamos" son dos cosas distintas.
 *
 * Antes las dos eran el número 0 y el aviso de faltante no podía separarlas:
 * gritaba "faltan 130 almohadones" cuando lo cierto era que nadie había contado
 * los almohadones. Tres de cada cuatro avisos eran así, y un aviso que miente
 * deja de leerse — que es la peor forma de perder la alerta más útil de la app.
 *
 * La regla nueva: sin recuento no hay faltante que calcular. Se pide contar,
 * que es otra tarea y de otra persona.
 */

const base: ShortageInput = {
  productId: "p1",
  name: "Almohadón blanco",
  unit: "Unidad",
  rubro: "Sillas y almohadones",
  type: "REUTILIZABLE",
  stock: 100,
  requested: 10,
  otherRequested: 0,
};

test("con stock contado, el faltante se calcula como siempre", () => {
  const r = computeShortage({ ...base, stock: 2, requested: 5 });
  assert.ok(r);
  assert.equal(r.missing, 3);
  assert.equal(r.stock, 2);
});

test("sin recuento no se inventa un faltante", () => {
  assert.equal(computeShortage({ ...base, stock: null, requested: 130 }), null);
});

test("sin recuento, lo que se pide es contar", () => {
  assert.equal(necesitaRecuento({ ...base, stock: null, requested: 130 }), true);
});

test("un cero contado SÍ es un faltante: es un dato, no una ausencia", () => {
  // "Florero con pie" existe en producción con stock 0 y movimientos: alguien lo
  // contó y no hay ninguno. Si esto se rompe, la migración habría borrado un dato.
  const r = computeShortage({ ...base, stock: 0, requested: 4 });
  assert.ok(r, "pedir 4 de algo que se contó y dio cero es un faltante real");
  assert.equal(r.missing, 4);
  assert.equal(necesitaRecuento({ ...base, stock: 0, requested: 4 }), false);
});

test("un producto sin contar que este evento no pide no molesta a nadie", () => {
  assert.equal(necesitaRecuento({ ...base, stock: null, requested: 0 }), false);
});

test("los consumibles no llevan recuento ni faltante", () => {
  const consumible = { ...base, type: "CONSUMIBLE", stock: null, requested: 50 };
  assert.equal(computeShortage(consumible), null);
  assert.equal(necesitaRecuento(consumible), false);
});

test("lo que piden los otros eventos no convierte un sin-contar en faltante", () => {
  // El riesgo: que al sumar los otros eventos el null se trate como 0 y vuelva
  // el aviso falso por la puerta de atrás.
  assert.equal(computeShortage({ ...base, stock: null, requested: 1, otherRequested: 500 }), null);
});

test("el faltante de un producto contado no cambia por existir otros sin contar", () => {
  const r = computeShortage({ ...base, stock: 2, requested: 5, otherRequested: 0 });
  assert.equal(r?.missing, 3);
});

test("cada caso cae en exactamente un lado", () => {
  // Nunca puede ser faltante y sin-contar a la vez, ni quedar en ningún lado.
  const casos: ShortageInput[] = [
    { ...base, stock: null, requested: 5 },
    { ...base, stock: 0, requested: 5 },
    { ...base, stock: 3, requested: 5 },
    { ...base, stock: 50, requested: 5 },
  ];
  for (const c of casos) {
    const falta = computeShortage(c) !== null;
    const contar = necesitaRecuento(c);
    assert.equal(falta && contar, false, "no puede ser las dos cosas");
  }
  assert.deepEqual(
    casos.map((c) => (computeShortage(c) ? "falta" : necesitaRecuento(c) ? "contar" : "alcanza")),
    ["contar", "falta", "falta", "alcanza"],
  );
});
