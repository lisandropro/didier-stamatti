import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avancePorSector,
  cambiosParaAplicar,
  claveDeLinea,
  esClave,
  esEstado,
  esVisto,
  estadoDeItems,
  paraTildarSector,
  pideConfirmacion,
  sePuedeDestildar,
  seccionesDePantalla,
  sonVistosDeSector,
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

test("tildar un sector entero toma solo lo pendiente de ese sector, y solo lo que se vio", () => {
  const items = estadoDeItems(
    [L("p1", 1), L("p2", 2), L("camb", 5), L("otro", 1, null, "BEBIDA"), L("nuevo", 4)],
    [T("camb", 2), T("sacar", 3)],
  );
  // "nuevo" entró al pedido después de que se dibujó la pantalla: nadie lo vio.
  const r = paraTildarSector(items, "ENSERES", [
    { clave: "p1", qty: 1, note: null },
    { clave: "p2", qty: 2, note: null },
    // Lo que no está pendiente no se tilda aunque llegue en lo visto: lo que
    // cambió se confirma de a uno, y lo de otro sector no es de este sector.
    { clave: "camb", qty: 5, note: null },
    { clave: "otro", qty: 1, note: null },
  ]);
  assert.deepEqual(r, { claves: ["p1", "p2"], salteados: 2 });
});

test("tildar un sector saltea lo que cambió desde que se vio, y no cuenta lo que otro ya tildó así", () => {
  const items = estadoDeItems(
    [L("cant", 12), L("nota", 3, "las altas"), L("igual", 1), L("ya", 7)],
    [T("ya", 7)],
  );
  const r = paraTildarSector(items, "ENSERES", [
    { clave: "cant", qty: 10, note: null }, // la cantidad cambió
    { clave: "nota", qty: 3, note: "las bajas" }, // la nota cambió
    { clave: "igual", qty: 1, note: "  " }, // los espacios no cambian la nota
    { clave: "ya", qty: 7, note: null }, // otro teléfono lo tildó tal cual se veía
    { clave: "igual", qty: 1, note: null }, // repetido: cuenta una vez
    { clave: "fantasma", qty: 1, note: null }, // ya no está en el pedido
  ]);
  assert.deepEqual(r, { claves: ["igual"], salteados: 3 });
});

test("destildar solo deshace lo que se vio preparado y sigue igual", () => {
  const [prep] = estadoDeItems([L("a", 10, "largos")], [T("a", 10, "largos")]);
  assert.equal(sePuedeDestildar(prep, { estado: "PREPARADO", qty: 10, note: "largos " }), true);
  assert.equal(sePuedeDestildar(prep, { estado: "PREPARADO", qty: 9, note: "largos" }), false);
  assert.equal(sePuedeDestildar(prep, { estado: "PREPARADO", qty: 10, note: "cortos" }), false);
  assert.equal(sePuedeDestildar(prep, { estado: "PENDIENTE", qty: 10, note: "largos" }), false, "no se vio preparado");
  // Un ✓ viejo en la pantalla no puede borrar un "Sumá 14" que llegó después.
  const [camb] = estadoDeItems([L("a", 24)], [T("a", 10)]);
  assert.equal(sePuedeDestildar(camb, { estado: "PREPARADO", qty: 10, note: null }), false);
  assert.equal(sePuedeDestildar(undefined, { estado: "PREPARADO", qty: 10, note: null }), false);
});

test("de la pantalla se aceptan los cinco estados y nada más", () => {
  for (const e of ["PENDIENTE", "PREPARADO", "CAMBIO", "NOTA", "SACAR"]) assert.equal(esEstado(e), true, e);
  for (const e of ["", "preparado", "LISTO", null, undefined, 3]) assert.equal(esEstado(e), false, String(e));
});

test("lo visto que llega del teléfono se comprueba antes de guardarlo", () => {
  assert.equal(esVisto({ estado: "PENDIENTE", qty: 10, note: null }), true);
  assert.equal(esVisto({ estado: "SACAR", qty: 0, note: "x".repeat(1000) }), true, "sacar se ve en cero; la nota con el tope del pedido");
  for (const malo of [
    null,
    "PENDIENTE",
    { estado: "LISTO", qty: 1, note: null },
    { estado: "PENDIENTE", qty: -1, note: null },
    { estado: "PENDIENTE", qty: 1.5, note: null },
    { estado: "PENDIENTE", qty: "10", note: null },
    { estado: "PENDIENTE", qty: 1 },
    { estado: "PENDIENTE", qty: 1, note: 3 },
    { estado: "PENDIENTE", qty: 1, note: "x".repeat(1001) },
  ]) {
    assert.equal(esVisto(malo), false, JSON.stringify(malo));
  }
});

test("lo visto de un sector entero: cada fila con su clave, y con tope", () => {
  const fila = { clave: "p1", qty: 1, note: null };
  assert.equal(sonVistosDeSector([]), true);
  assert.equal(sonVistosDeSector([fila, { clave: "custom:l1", qty: 0, note: "las altas" }]), true);
  assert.equal(sonVistosDeSector(Array(500).fill(fila)), true);
  assert.equal(sonVistosDeSector(Array(501).fill(fila)), false);
  for (const malo of [null, fila, [null], [{ ...fila, clave: "" }], [{ ...fila, clave: "x".repeat(101) }], [{ ...fila, qty: -1 }], [{ ...fila, note: undefined }]]) {
    assert.equal(sonVistosDeSector(malo), false, JSON.stringify(malo));
  }
  assert.equal(esClave("p1"), true);
  assert.equal(esClave(""), false);
});

test("la pantalla reparte: arriba lo que hay que aplicar, y cada sector sin repetir esas filas", () => {
  const items = estadoDeItems(
    [L("pend", 1), L("prep", 2), L("camb", 5), L("nota", 3, "x"), L("m1", 1, null, "MOBILIARIO")],
    [T("prep", 2), T("camb", 2), T("nota", 3), T("sacar", 7)],
  );
  const { paraAplicar, sectores } = seccionesDePantalla(items);
  assert.deepEqual(paraAplicar.map((i) => i.clave).sort(), ["camb", "nota", "sacar"]);
  assert.deepEqual(sectores.map((s) => s.category), ["ENSERES", "MOBILIARIO"]);
  const enseres = sectores[0];
  assert.equal(enseres.label, "Enseres");
  assert.deepEqual(enseres.filas.map((i) => i.clave).sort(), ["pend", "prep"], "lo de arriba no se repite en el sector");
  assert.deepEqual(sectores[1].filas.map((i) => i.clave), ["m1"]);
});

test("la pantalla cuenta todo el sector, también lo que está arriba en 'Cambios para aplicar'", () => {
  const items = estadoDeItems(
    [L("pend", 1), L("prep", 2), L("camb", 5), L("nota", 3, "x")],
    [T("prep", 2), T("camb", 2), T("nota", 3), T("sacar", 7)],
  );
  const [enseres] = seccionesDePantalla(items).sectores;
  assert.equal(enseres.total, 5, "pendiente + preparado + cambio + nota + sacar");
  assert.equal(enseres.listos, 1);
  assert.equal(enseres.pendientes, 1);
  assert.equal(enseres.filas.length, 2);
});

test("un sector con todo en 'Cambios para aplicar' sigue existiendo, sin filas propias", () => {
  const [solo] = seccionesDePantalla(estadoDeItems([L("camb", 5)], [T("camb", 2)])).sectores;
  assert.equal(solo.total, 1);
  assert.equal(solo.listos, 0);
  assert.deepEqual(solo.filas, []);
});

test("una categoría desconocida sale como sector propio, al final y con su nombre", () => {
  const items = estadoDeItems(
    [L("v", 1, null, "VAJILLA_VIEJA"), L("e", 1), L("b", 1, null, "BEBIDA")],
    [],
  );
  const { sectores } = seccionesDePantalla(items);
  assert.deepEqual(sectores.map((s) => s.category), ["ENSERES", "BEBIDA", "VAJILLA_VIEJA"]);
  const vieja = sectores[2];
  assert.equal(vieja.label, "VAJILLA_VIEJA");
  assert.deepEqual(vieja.filas.map((i) => i.clave), ["v"], "se ve y se puede tildar");
});

test("los sectores salen en el orden de la lista de categorías, no en el de los ítems", () => {
  const items = estadoDeItems(
    [L("b", 1, null, "BEBIDA"), L("mo", 1, null, "MOBILIARIO"), L("ma", 1, null, "MANTELERIA"), L("e", 1)],
    [],
  );
  assert.deepEqual(seccionesDePantalla(items).sectores.map((s) => s.category), ["ENSERES", "MANTELERIA", "MOBILIARIO", "BEBIDA"]);
});

test("las categorías desconocidas van al final en orden alfabético, siempre igual", () => {
  const items = estadoDeItems([L("z", 1, null, "ZETA"), L("a", 1, null, "ALFA"), L("e", 1)], []);
  assert.deepEqual(seccionesDePantalla(items).sectores.map((s) => s.category), ["ENSERES", "ALFA", "ZETA"]);
});

test("sin ítems no hay nada que repartir", () => {
  assert.deepEqual(seccionesDePantalla([]), { paraAplicar: [], sectores: [] });
});

test("lo que pide confirmar es lo que hay que aplicar, y nada más", () => {
  // Lo decide el estado: si una fila con "sumá 14" se dibujara en otro lado,
  // tiene que seguir pidiendo confirmación.
  for (const estado of ["CAMBIO", "NOTA", "SACAR"] as const) assert.equal(pideConfirmacion(estado), true, estado);
  for (const estado of ["PENDIENTE", "PREPARADO"] as const) assert.equal(pideConfirmacion(estado), false, estado);
});

test("el avance de la pantalla es el mismo número que el de la lista de eventos", () => {
  const items = estadoDeItems(
    [L("a", 1), L("b", 2), L("c", 3, null, "BEBIDA"), L("x", 1, null, "VIEJA")],
    [T("a", 1), T("b", 5), T("z", 4)],
  );
  const avance = avancePorSector(items);
  for (const s of seccionesDePantalla(items).sectores) {
    assert.deepEqual({ listos: s.listos, total: s.total }, avance.get(s.category), s.category);
  }
});
