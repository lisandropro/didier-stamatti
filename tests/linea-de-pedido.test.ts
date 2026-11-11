import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { esVistoDeLinea, resolverLinea } from "../lib/linea-de-pedido";
import { validQuantity } from "../lib/quantity";

/**
 * Guardar un renglón sin pisar lo que cargó otro teléfono.
 *
 * El caso: A sube Copa de agua de 100 a 150. B tiene el pedido abierto desde
 * antes, sigue viendo 100, y le agrega una nota. El guardado de B manda la fila
 * entera (`qty: 100`), y hasta este arreglo la cantidad volvía a 100 con un
 * cambio "150 → 100" a nombre de B, que B nunca hizo.
 */

const COPA = "Copa de agua";
const tipos = (r: { cambios: { kind: string }[] }) => r.cambios.map((c) => c.kind);

test("cambiar solo la nota no pisa la cantidad que cargó otro teléfono", () => {
  const r = resolverLinea(COPA, { qty: 150, note: null }, { qty: 100, note: "con pie" }, { qty: 100, note: "" });
  assert.equal(r.accion, "actualizar");
  assert.deepEqual(r.accion === "actualizar" && [r.qty, r.note], [150, "con pie"]);
  assert.deepEqual(tipos(r), ["NOTA"], "quedó registrado un cambio de cantidad que nadie hizo");
});

test("cambiar solo la cantidad no pisa la nota que cargó otro teléfono", () => {
  const r = resolverLinea(COPA, { qty: 100, note: "las altas" }, { qty: 120, note: "" }, { qty: 100, note: "" });
  assert.deepEqual(r.accion === "actualizar" && [r.qty, r.note], [120, "las altas"]);
  assert.deepEqual(tipos(r), ["CANTIDAD"]);
  assert.deepEqual(r.cambios[0], { itemName: COPA, kind: "CANTIDAD", before: "100", after: "120", tardio: false });
});

test("si las dos personas tocaron la cantidad gana la última, y el historial dice desde qué número", () => {
  const r = resolverLinea(COPA, { qty: 150, note: null }, { qty: 80, note: "" }, { qty: 100, note: "" });
  assert.deepEqual(r.accion === "actualizar" && r.qty, 80);
  assert.equal(r.cambios[0].before, "150", "el 'antes' tiene que ser lo que había en la base, no lo que veía el teléfono");
});

test("cantidad y nota tocadas en el mismo guardado: se escriben y se registran las dos", () => {
  const r = resolverLinea(COPA, { qty: 100, note: null }, { qty: 110, note: " sin pie " }, { qty: 100, note: "" }, true);
  assert.deepEqual(r.accion === "actualizar" && [r.qty, r.note], [110, "sin pie"]);
  assert.deepEqual(tipos(r), ["CANTIDAD", "NOTA"]);
  assert.ok(r.cambios.every((c) => c.tardio === true), "lo tardío viaja en cada cambio");
});

test("guardar lo mismo que ya había no escribe ni avisa", () => {
  assert.equal(resolverLinea(COPA, { qty: 100, note: "x" }, { qty: 100, note: "x" }, { qty: 100, note: "x" }).accion, "nada");
  // Una nota vacía y una nula son lo mismo.
  assert.equal(resolverLinea(COPA, { qty: 100, note: null }, { qty: 100, note: "  " }, null).accion, "nada");
  // El otro teléfono ya dejó lo mismo que este quería.
  assert.equal(resolverLinea(COPA, { qty: 120, note: null }, { qty: 120, note: "" }, { qty: 100, note: "" }).accion, "nada");
});

test("agregar un producto que no estaba lo crea con su nota", () => {
  const r = resolverLinea(COPA, null, { qty: 30, note: "las bajas" }, { qty: 0, note: "" });
  assert.deepEqual(r.accion === "crear" && [r.qty, r.note], [30, "las bajas"]);
  assert.deepEqual(r.cambios, [{ itemName: COPA, kind: "AGREGADO", before: null, after: "30", tardio: false }]);
});

test("poner la cantidad en cero saca el renglón; si ya no estaba, no pasa nada", () => {
  const r = resolverLinea(COPA, { qty: 40, note: "x" }, { qty: 0, note: "x" }, { qty: 40, note: "x" });
  assert.equal(r.accion, "borrar");
  assert.deepEqual(r.cambios, [{ itemName: COPA, kind: "QUITADO", before: "40", after: null, tardio: false }]);
  assert.equal(resolverLinea(COPA, null, { qty: 0, note: "" }, { qty: 40, note: "" }).accion, "nada");
});

test("cambiar solo la nota de un renglón que otro teléfono sacó no lo revive", () => {
  // Revivirlo sería deshacer lo del otro con una cantidad que esta persona no eligió.
  assert.equal(resolverLinea(COPA, null, { qty: 40, note: "con pie" }, { qty: 40, note: "" }).accion, "ya-no-esta");
  // Sin haber tocado nada, tampoco: no hay nada que guardar.
  assert.equal(resolverLinea(COPA, null, { qty: 40, note: "" }, { qty: 40, note: "" }).accion, "nada");
  // Si le cambió la cantidad, sí: lo está pidiendo de nuevo, con un número que eligió.
  assert.equal(resolverLinea(COPA, null, { qty: 45, note: "" }, { qty: 40, note: "" }).accion, "crear");
});

test("una pestaña vieja que no manda lo visto guarda la fila entera, como antes", () => {
  const r = resolverLinea(COPA, { qty: 150, note: "a" }, { qty: 100, note: "b" }, null);
  assert.deepEqual(r.accion === "actualizar" && [r.qty, r.note], [100, "b"]);
  assert.deepEqual(tipos(r), ["CANTIDAD", "NOTA"]);
  assert.equal(resolverLinea(COPA, null, { qty: 10, note: "" }, null).accion, "crear");
  assert.equal(resolverLinea(COPA, { qty: 10, note: null }, { qty: 0, note: "" }, null).accion, "borrar");
});

test("un renglón que el teléfono veía en cero y otro agregó: la nota sola se aplica, no lo borra", () => {
  const r = resolverLinea(COPA, { qty: 60, note: null }, { qty: 0, note: "ojo" }, { qty: 0, note: "" });
  assert.deepEqual(r.accion === "actualizar" && [r.qty, r.note], [60, "ojo"]);
});

test("lo visto se comprueba como cualquier dato de afuera", () => {
  const cant = (v: unknown) => validQuantity(v);
  assert.equal(esVistoDeLinea({ qty: 10, note: "" }, cant, 1000), true);
  assert.equal(esVistoDeLinea({ qty: 0, note: null }, cant, 1000), true);
  for (const malo of [null, undefined, "x", 7, {}, { qty: "10", note: "" }, { qty: 1.5, note: "" }, { qty: -1, note: "" }, { qty: 1 }, { qty: 1, note: 3 }, { qty: 1, note: "x".repeat(1001) }]) {
    assert.equal(esVistoDeLinea(malo, cant, 1000), false, `aceptó ${JSON.stringify(malo)}`);
  }
});

// ---------------------------------------------------------------------------
// Que la acción y la pantalla de verdad lo usen
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, "..");
const fuente = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

test("setLine decide con resolverLinea y el armador manda lo visto", () => {
  const accion = fuente("app/actions/order.ts");
  assert.match(accion, /resolverLinea\(/);
  assert.match(accion, /esVistoDeLinea\(/, "lo visto se guarda sin comprobar");
  assert.match(fuente("components/OrderBuilder.tsx"), /setLine\(\{[^}]*visto:/, "el autoguardado no manda lo visto: vuelve a pisar la fila entera");
});
