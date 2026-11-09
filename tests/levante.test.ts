import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esFaltaValida,
  esMotivoBaja,
  etiquetaDeMotivo,
  itemsDeLevante,
  ordenarLevante,
  paraMarcarSector,
  productoDeClave,
  resumenDeLevante,
  seccionesDeLevante,
  sonVistosDeLevante,
  vuelveDelEvento,
  type LineaLevante,
  type Marca,
} from "../lib/levante";

/**
 * El levante calculado: qué entra en la lista, cómo se cruza con lo marcado y
 * cómo se reparte en la pantalla. Sin base de datos.
 */

const L = (clave: string, qty: number, category = "ENSERES", itemName = `Item ${clave}`): LineaLevante => ({
  clave, itemName, unit: "Unidad", category, qty, note: null,
});
const M = (clave: string, qty: number, faltan: number, extra: Partial<Marca> = {}): Marca => ({
  clave, itemName: `Item ${clave}`, unit: "Unidad", category: "ENSERES", qty, faltan,
  porName: "Pablo", at: new Date("2026-11-09T05:00:00Z"), descontado: null, ...extra,
});
const DESCONTADO = { motivo: "ROTURA", porName: "Ana", at: new Date("2026-11-09T12:00:00Z") };

test("vuelve lo reutilizable y lo suelto que se mandó; lo consumible y lo que está en cero, no", () => {
  assert.equal(vuelveDelEvento({ productId: "copa", productType: "REUTILIZABLE", qty: 40 }), true);
  assert.equal(vuelveDelEvento({ productId: null, productType: null, qty: 3 }), true, "un suelto vuelve");
  assert.equal(vuelveDelEvento({ productId: "hielo", productType: "CONSUMIBLE", qty: 20 }), false);
  assert.equal(vuelveDelEvento({ productId: "copa", productType: "REUTILIZABLE", qty: 0 }), false);
  assert.equal(vuelveDelEvento({ productId: null, productType: null, qty: 0 }), false);
});

test("la clave de un producto es su id; la de un suelto no tiene producto", () => {
  assert.equal(productoDeClave("prod-1"), "prod-1");
  assert.equal(productoDeClave("custom:linea-9"), null);
});

test("sin marca: pendiente; volvió todo: VOLVIO; con faltantes: FALTA con cuántos", () => {
  const items = itemsDeLevante([L("a", 10), L("b", 40), L("c", 5)], [M("b", 40, 0), M("c", 5, 2)]);
  assert.deepEqual(items.map((i) => [i.clave, i.estado, i.faltan]), [["a", "PENDIENTE", 0], ["b", "VOLVIO", 0], ["c", "FALTA", 2]]);
  assert.equal(items[0].marca, null);
  assert.deepEqual(items[2].marca, { porName: "Pablo", at: new Date("2026-11-09T05:00:00Z") });
});

test("si el pedido cambió después de marcar, la marca no vale y el ítem vuelve a pendiente", () => {
  const [i] = itemsDeLevante([L("a", 50)], [M("a", 40, 2)]);
  assert.equal(i.estado, "PENDIENTE");
  assert.equal(i.qty, 50);
  assert.equal(i.faltan, 0);
});

test("lo descontado se muestra como se marcó, aunque el pedido haya cambiado o ya no esté", () => {
  const items = itemsDeLevante([L("a", 50)], [M("a", 40, 2, { descontado: DESCONTADO }), M("b", 3, 1, { descontado: DESCONTADO })]);
  assert.deepEqual(items.map((i) => [i.clave, i.estado, i.qty, i.faltan]), [["a", "FALTA", 40, 2], ["b", "FALTA", 3, 1]]);
  assert.deepEqual(items[1].descontado, DESCONTADO);
});

test("una marca sin descontar de algo que ya no está en el pedido no se muestra", () => {
  assert.deepEqual(itemsDeLevante([], [M("a", 40, 2)]), []);
});

test("el orden de llegada: por sector y por nombre", () => {
  const items = ordenarLevante([L("m", 1, "MOBILIARIO", "Mesa"), L("v", 1, "ENSERES", "Vaso"), L("c", 1, "ENSERES", "Copa")]);
  assert.deepEqual(items.map((i) => i.itemName), ["Copa", "Vaso", "Mesa"]);
});

test("la pantalla reparte por sector, con lo pendiente arriba y lo marcado al final", () => {
  const items = itemsDeLevante(
    [L("a", 1), L("b", 1), L("c", 1), L("m", 1, "MOBILIARIO")],
    [M("a", 1, 0), M("b", 1, 1)],
  );
  const s = seccionesDeLevante(items);
  assert.deepEqual(s.map((x) => [x.category, x.label, x.total, x.marcados, x.pendientes]), [
    ["ENSERES", "Enseres", 3, 2, 1],
    ["MOBILIARIO", "Mobiliario", 1, 0, 1],
  ]);
  assert.deepEqual(s[0].filas.map((i) => i.clave), ["c", "a", "b"], "lo pendiente no quedó arriba");
});

test("un sector desconocido sale al final, con su nombre tal cual", () => {
  const s = seccionesDeLevante([...itemsDeLevante([L("x", 1, "VAJILLA_VIEJA"), L("a", 1)], [])]);
  assert.deepEqual(s.map((x) => x.label), ["Enseres", "VAJILLA_VIEJA"]);
});

test("el resumen cuenta lo marcado, lo sin revisar y lo que no volvió", () => {
  const items = itemsDeLevante([L("a", 10), L("b", 40), L("c", 5)], [M("b", 40, 0), M("c", 5, 2)]);
  assert.deepEqual(resumenDeLevante(items), {
    total: 3,
    marcados: 2,
    sinRevisar: 1,
    faltantes: [{ itemName: "Item c", faltan: 2 }],
  });
});

test("cuántos faltan: de 1 a lo que se mandó, enteros", () => {
  assert.equal(esFaltaValida(1, 40), true);
  assert.equal(esFaltaValida(40, 40), true);
  for (const [f, m] of [[0, 40], [41, 40], [1.5, 40], ["2", 40], [1, 0], [null, 40]] as const) {
    assert.equal(esFaltaValida(f, m), false, `${f} de ${m}`);
  }
});

test("lo visto de un sector se comprueba antes de usarlo", () => {
  assert.equal(sonVistosDeLevante([{ clave: "a", qty: 3 }]), true);
  assert.equal(sonVistosDeLevante([]), true);
  assert.equal(sonVistosDeLevante([{ clave: "", qty: 3 }]), false);
  assert.equal(sonVistosDeLevante([{ clave: "a", qty: -1 }]), false);
  assert.equal(sonVistosDeLevante("a"), false);
  assert.equal(sonVistosDeLevante(Array.from({ length: 501 }, () => ({ clave: "a", qty: 1 }))), false);
});

test("tachar un sector toma solo lo pendiente que se vio igual; lo que cambió se avisa", () => {
  const items = itemsDeLevante(
    [L("a", 1), L("b", 5), L("c", 2), L("d", 1), L("m", 1, "MOBILIARIO")],
    [M("c", 2, 0), M("d", 1, 1)],
  );
  const r = paraMarcarSector(items, "ENSERES", [
    { clave: "a", qty: 1 }, // pendiente e igual: se marca
    { clave: "a", qty: 1 }, // repetido: no cuenta dos veces
    { clave: "b", qty: 4 }, // el pedido cambió: se avisa
    { clave: "c", qty: 2 }, // otro teléfono ya marcó que volvió: nada
    { clave: "d", qty: 1 }, // otro teléfono marcó un faltante: se avisa
    { clave: "m", qty: 1 }, // de otro sector: se avisa
    { clave: "z", qty: 1 }, // ya no está: se avisa
  ]);
  assert.deepEqual(r, { claves: ["a"], salteados: 4 });
});

test("los motivos de baja son rotura y pérdida, con su nombre", () => {
  assert.equal(esMotivoBaja("ROTURA"), true);
  assert.equal(esMotivoBaja("PERDIDA"), true);
  assert.equal(esMotivoBaja("COMPRA"), false);
  assert.equal(etiquetaDeMotivo("PERDIDA"), "Pérdida");
  assert.equal(etiquetaDeMotivo("OTRO"), "OTRO");
});
