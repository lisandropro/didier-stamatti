import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bajaDe,
  esFaltaValida,
  esMotivoBaja,
  etiquetaDeMotivo,
  itemsDeLevante,
  linkDelLevante,
  notaDeBaja,
  ordenarLevante,
  paraMarcarSector,
  productoDeClave,
  resumenDeLevante,
  seccionesDeLevante,
  sonVistosDeLevante,
  stockDespuesDeBaja,
  cuantoBaja,
  TEXTO_DE_BAJA,
  textoDelLevante,
  vuelveDelEvento,
  type EstadoLevante,
  type LineaLevante,
  type Marca,
} from "../lib/levante";
import { instanteDe } from "../lib/dates";

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

/** Un ítem como lo mira el aviso: nombre, estado y cuántos faltan. */
const I = (itemName: string, estado: EstadoLevante, faltan = 0) => ({ itemName, estado, faltan });

test("el aviso nombra lo que faltó, con quién lo terminó en el push", () => {
  const t = textoDelLevante("MUSEO", [I("Copa vino", "FALTA", 5), I("Mantel redondo", "FALTA", 2), I("Plato", "VOLVIO")], "Pablo");
  assert.equal(t.mensaje, "Levante de MUSEO: faltaron 5 Copa vino y 2 Mantel redondo");
  assert.equal(t.title, "Levante de MUSEO");
  assert.equal(t.body, "Faltaron 5 Copa vino y 2 Mantel redondo\n— Pablo");
});

test("volvió todo solo si se revisó todo", () => {
  assert.equal(textoDelLevante("MUSEO", [I("Copa", "VOLVIO"), I("Plato", "VOLVIO")], "Pablo").mensaje, "Levante de MUSEO: volvió todo");
  assert.equal(
    textoDelLevante("MUSEO", [I("Copa", "VOLVIO"), I("Plato", "PENDIENTE"), I("Vaso", "PENDIENTE"), I("Silla", "PENDIENTE")], "Pablo").mensaje,
    "Levante de MUSEO: volvió todo lo revisado · 3 sin revisar",
  );
  assert.equal(textoDelLevante("MUSEO", [I("Copa", "PENDIENTE"), I("Plato", "PENDIENTE")], "Pablo").mensaje, "Levante de MUSEO: 2 sin revisar");
});

test("lo que faltó y lo que quedó sin revisar van juntos", () => {
  const t = textoDelLevante("MUSEO", [I("Copa vino", "FALTA", 5), I("Plato", "PENDIENTE")], "Pablo");
  assert.equal(t.mensaje, "Levante de MUSEO: faltaron 5 Copa vino · 1 sin revisar");
});

test("un solo faltante de uno se dice en singular", () => {
  assert.equal(textoDelLevante("MUSEO", [I("Brasero", "FALTA", 1)], "Pablo").mensaje, "Levante de MUSEO: faltó 1 Brasero");
});

test("más de tres faltantes: los tres primeros y cuántos más", () => {
  const items = [I("A", "FALTA", 1), I("B", "FALTA", 2), I("C", "FALTA", 3), I("D", "FALTA", 4), I("E", "FALTA", 5)];
  assert.equal(textoDelLevante("MUSEO", items, "Pablo").mensaje, "Levante de MUSEO: faltaron 1 A, 2 B, 3 C y 2 más");
});

test("el aviso no pasa del tope del push aunque el lugar y los nombres sean larguísimos", () => {
  const t = textoDelLevante("L".repeat(300), [I("X".repeat(400), "FALTA", 2), I("Y".repeat(400), "FALTA", 3)], "P".repeat(300));
  assert.ok(t.mensaje.length <= 500, `mensaje de ${t.mensaje.length}`);
  assert.ok(t.body.length <= 500, `cuerpo de ${t.body.length}`);
  assert.ok(t.title.length <= 80, `título de ${t.title.length}`);
  assert.ok(t.body.endsWith(`— ${"P".repeat(59)}…`), "se perdió la firma");
});

test("el aviso lleva al levante del evento", () => {
  assert.equal(linkDelLevante("ev-1"), "/preparar/ev-1/levante");
});

test("qué faltantes se pueden descontar del stock, y por qué no los otros", () => {
  const contado = { type: "REUTILIZABLE", stock: 250 };
  assert.equal(bajaDe("copa", contado), "DESCONTABLE");
  assert.equal(bajaDe("custom:linea-1", null), "SUELTO");
  assert.equal(bajaDe("hielo", { type: "CONSUMIBLE", stock: 0 }), "NO_LLEVA_STOCK");
  assert.equal(bajaDe("copa", null), "NO_LLEVA_STOCK", "el producto ya no existe");
  assert.equal(bajaDe("copa", { type: "REUTILIZABLE", stock: null }), "SIN_CONTAR");
  assert.equal(bajaDe("copa", { type: "REUTILIZABLE", stock: 0 }), "SIN_STOCK");
});

test("el stock baja lo que faltó, sin quedar negativo", () => {
  assert.equal(stockDespuesDeBaja(250, 5), 245);
  assert.equal(stockDespuesDeBaja(3, 5), 0);
});

test("la nota del movimiento dice el lugar y el día del evento en Argentina", () => {
  // 23:30 del 8/11 en Argentina ya es 9/11 en UTC: la nota tiene que decir 8/11.
  assert.equal(notaDeBaja("MUSEO", instanteDe("2026-11-08", "23:30")), "Levante de MUSEO 8/11");
  assert.ok(notaDeBaja("L".repeat(300), instanteDe("2026-11-08", "21:00")).length < 80);
});

test("cuánto baja de verdad: lo que faltó, sin pasar de lo que hay", () => {
  assert.equal(cuantoBaja(250, 5), 5);
  assert.equal(cuantoBaja(3, 5), 3);
  assert.equal(cuantoBaja(5, 5), 5);
});

test("nunca contado: no manda a contar, porque contar después del evento descuenta dos veces", () => {
  assert.equal(TEXTO_DE_BAJA.SIN_CONTAR, "Nunca se contó en el inventario: no hay de dónde descontar.");
});
