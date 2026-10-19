import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidarCambios, describirCambio, textoDePush, type Cambio } from "../lib/aviso-texto";

/**
 * El texto del push: lo que el depósito tiene que hacer, no cuántas veces se
 * tocó algo. Enrique ajusta y reajusta (10→12, 12→24): al depósito le importa
 * que quedó en 24.
 */

const c = (itemName: string, kind: string, before: string | null, after: string | null): Cambio => ({ itemName, kind, before, after });

test("dos cambios de cantidad del mismo ítem son uno solo, de punta a punta", () => {
  assert.deepEqual(consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "CANTIDAD", "12", "24")]), [
    c("Copa", "CANTIDAD", "10", "24"),
  ]);
});

test("agregar y después sacar lo mismo no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Hielo", "AGREGADO", null, "20"), c("Hielo", "QUITADO", "20", null)]), []);
});

test("subir y volver a la cantidad original no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "CANTIDAD", "12", "10")]), []);
});

test("sacar y volver a agregar con otra cantidad es un cambio de cantidad", () => {
  assert.deepEqual(consolidarCambios([c("Brasero", "QUITADO", "3", null), c("Brasero", "AGREGADO", null, "5")]), [
    c("Brasero", "CANTIDAD", "3", "5"),
  ]);
});

test("agregar y después cambiar la cantidad es un agregado con la cantidad final", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "AGREGADO", null, "4"), c("Mantel", "CANTIDAD", "4", "6")]), [
    c("Mantel", "AGREGADO", null, "6"),
  ]);
});

test("una nota que vuelve a ser la de antes no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "NOTA", null, "largos"), c("Mantel", "NOTA", "largos", null)]), []);
});

test("se respeta el orden en que aparece cada ítem", () => {
  const r = consolidarCambios([c("B", "AGREGADO", null, "1"), c("A", "AGREGADO", null, "1"), c("B", "CANTIDAD", "1", "2")]);
  assert.deepEqual(r.map((x) => x.itemName), ["B", "A"]);
});

test("cómo se describe cada clase de cambio", () => {
  assert.equal(describirCambio(c("Copa de agua", "CANTIDAD", "10", "24")), "Copa de agua 10→24");
  assert.equal(describirCambio(c("Servilletas", "AGREGADO", null, "50")), "Servilletas +50");
  assert.equal(describirCambio(c("Brasero", "QUITADO", "3", null)), "Brasero quitado");
  assert.equal(describirCambio(c("Mantel", "NOTA", null, "los largos")), 'Mantel: nota "los largos"');
  assert.equal(describirCambio(c("Mantel", "NOTA", "los largos", null)), "Mantel: nota borrada");
  assert.equal(describirCambio(c("Responsable de la fiesta", "RESPONSABLE", null, "Pablo")), "Responsable: Pablo");
  assert.equal(describirCambio(c("Evento", "FECHA", "sáb 24/10", "dom 25/10")), "Fecha: dom 25/10");
});

test("el push: lugar de título, tres cambios, cuántos más y quién", () => {
  const t = textoDePush("El Carmen Center", "Enrique", [
    c("Copa de agua", "CANTIDAD", "10", "24"),
    c("Servilletas", "AGREGADO", null, "50"),
    c("Brasero", "QUITADO", "3", null),
    c("Mantel", "NOTA", "", "los largos"),
    c("Hielo", "AGREGADO", null, "20"),
  ]);
  assert.deepEqual(t, {
    title: "El Carmen Center",
    body: "Copa de agua 10→24 · Servilletas +50 · Brasero quitado · y 2 más\n— Enrique",
  });
});

test("si todo se compensó, no hay push", () => {
  assert.equal(textoDePush("X", "Enrique", [c("Hielo", "AGREGADO", null, "20"), c("Hielo", "QUITADO", "20", null)]), null);
});

test("el cuerpo nunca pasa de 500 caracteres", () => {
  const largo = "x".repeat(400);
  const t = textoDePush("X", "Enrique", [c(largo, "AGREGADO", null, "1"), c(largo + "y", "AGREGADO", null, "1")]);
  assert.ok(t && t.body.length <= 500);
});

// --- Tope de 500: ni el nombre de quién lo hizo lo puede romper ---

test("un nombre de 600 caracteres se recorta a 60 y el cuerpo sigue en 500 o menos", () => {
  const quien = "N".repeat(600);
  const t = textoDePush("X", quien, [c("Copa", "AGREGADO", null, "5")]);
  assert.ok(t);
  assert.ok(t.body.length <= 500);
  assert.ok(t.body.endsWith("\n— " + quien.slice(0, 59) + "…"));
  assert.ok(t.body.startsWith("Copa +5"));
});

test("muchos ítems largos y un nombre largo no pasan de 500", () => {
  const largo = "x".repeat(300);
  const t = textoDePush("X", "N".repeat(600), [
    c(largo + "1", "AGREGADO", null, "1"),
    c(largo + "2", "AGREGADO", null, "1"),
    c(largo + "3", "AGREGADO", null, "1"),
    c(largo + "4", "AGREGADO", null, "1"),
    c(largo + "5", "AGREGADO", null, "1"),
  ]);
  assert.ok(t);
  assert.ok(t.body.length <= 500);
  assert.ok(t.body.includes(" · y 2 más\n— "));
});

test("al recortar se conserva el 'y N más' y el pie, lo que se corta es el detalle", () => {
  const largo = "x".repeat(200);
  const t = textoDePush("X", "Enrique", [
    c(largo + "1", "AGREGADO", null, "1"),
    c(largo + "2", "AGREGADO", null, "1"),
    c(largo + "3", "AGREGADO", null, "1"),
    c(largo + "4", "AGREGADO", null, "1"),
    c(largo + "5", "AGREGADO", null, "1"),
  ]);
  assert.ok(t);
  assert.ok(t.body.length <= 500);
  assert.ok(t.body.endsWith("… · y 2 más\n— Enrique"));
});

test("el corte no parte un emoji por la mitad", () => {
  const sueltoAlto = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
  const sueltoBajo = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  // El corte del detalle cae justo en el medio del primer emoji.
  const t = textoDePush("X", "Enrique", [c("x".repeat(488) + "😀😀😀", "AGREGADO", null, "1")]);
  assert.ok(t);
  assert.ok(t.body.length <= 500);
  assert.ok(!sueltoAlto.test(t.body));
  assert.ok(!sueltoBajo.test(t.body));
  // Lo mismo con el nombre de quién lo hizo: el corte a 60 cae en el medio del emoji.
  const u = textoDePush("X", "y".repeat(58) + "😀😀", [c("Copa", "AGREGADO", null, "5")]);
  assert.ok(u);
  assert.ok(!sueltoAlto.test(u.body));
  assert.ok(!sueltoBajo.test(u.body));
  assert.ok(u.body.endsWith("\n— " + "y".repeat(58) + "…"));
});

// --- Una nota no sobrevive al ítem ---

test("agregar un ítem, ponerle nota y sacarlo no deja nada, y no suena el teléfono", () => {
  const cambios = [c("Mantel", "AGREGADO", null, "4"), c("Mantel", "NOTA", null, "largos"), c("Mantel", "QUITADO", "4", null)];
  assert.deepEqual(consolidarCambios(cambios), []);
  assert.equal(textoDePush("X", "Enrique", cambios), null);
});

test("ponerle nota a un ítem que existía y sacarlo deja solo el quitado", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "NOTA", null, "largos"), c("Mantel", "QUITADO", "4", null)]), [
    c("Mantel", "QUITADO", "4", null),
  ]);
});

test("la nota de un ítem que sigue existiendo se avisa aunque la cantidad haya vuelto a la de antes", () => {
  assert.deepEqual(
    consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "NOTA", null, "con pie"), c("Copa", "CANTIDAD", "12", "10")]),
    [c("Copa", "NOTA", null, "con pie")],
  );
});

test("la nota de un ítem no se pierde por otro ítem que se sacó", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "NOTA", null, "largos"), c("Hielo", "QUITADO", "20", null)]), [
    c("Mantel", "NOTA", null, "largos"),
    c("Hielo", "QUITADO", "20", null),
  ]);
});

// --- Copiar el pedido de otro evento reemplaza lo que se había tocado antes ---

test("lo que se tocó antes de copiar el pedido ya no cuenta", () => {
  assert.deepEqual(
    consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Mantel", "NOTA", null, "largos"), c("Evento", "COPIADO", null, "Pedido copiado de Boda")]),
    [c("Evento", "COPIADO", null, "Pedido copiado de Boda")],
  );
});

test("lo que se toca después de copiar el pedido sí cuenta", () => {
  assert.deepEqual(
    consolidarCambios([c("Evento", "COPIADO", null, "Pedido copiado de Boda"), c("Copa", "CANTIDAD", "10", "12")]),
    [c("Evento", "COPIADO", null, "Pedido copiado de Boda"), c("Copa", "CANTIDAD", "10", "12")],
  );
});

test("copiar no borra los datos del evento tocados antes", () => {
  assert.deepEqual(
    consolidarCambios([c("Evento", "FECHA", "sáb 24/10", "dom 25/10"), c("Evento", "COPIADO", null, null)]),
    [c("Evento", "FECHA", "sáb 24/10", "dom 25/10"), c("Evento", "COPIADO", null, null)],
  );
});

// --- Datos del evento: se juntan por tipo ---

test("un responsable que vuelve a ser el de antes no deja nada", () => {
  assert.deepEqual(
    consolidarCambios([c("Evento", "RESPONSABLE", "A", "B"), c("Evento", "RESPONSABLE", "B", "A")]),
    [],
  );
});

test("tres cambios de fecha son uno solo, del primer antes al último después", () => {
  assert.deepEqual(
    consolidarCambios([c("Evento", "FECHA", "a", "b"), c("Evento", "FECHA", "b", "c")]),
    [c("Evento", "FECHA", "a", "c")],
  );
});

// --- describirCambio: lo que no cubría la prueba de las clases ---

test("describirCambio con los datos del evento, copiado y lo desconocido", () => {
  assert.equal(describirCambio(c("Evento", "COPIADO", null, "Pedido copiado de Boda")), "Pedido copiado de Boda");
  assert.equal(describirCambio(c("Evento", "COPIADO", null, null)), "Pedido copiado de otro evento");
  assert.equal(describirCambio(c("Evento", "LUGAR", "Salón A", "Salón B")), "Lugar: Salón B");
  assert.equal(describirCambio(c("Evento", "INVITADOS", "100", "120")), "Invitados: 120");
  assert.equal(describirCambio(c("Evento", "PERIODO", "mañana", "noche")), "Período: noche");
  assert.equal(describirCambio(c("Evento", "RESPONSABLE", "Pablo", null)), "Responsable: sin responsable");
  assert.equal(describirCambio(c("Algo raro", "OTRA_COSA", "a", "b")), "Algo raro");
});

test("describirCambio no escribe 'null' cuando un dato del evento quedó vacío", () => {
  assert.equal(describirCambio(c("Evento", "LUGAR", "Salón A", null)), "Lugar: (sin dato)");
  assert.equal(describirCambio(c("Evento", "FECHA", "sáb 24/10", null)), "Fecha: (sin dato)");
  assert.equal(describirCambio(c("Evento", "INVITADOS", "100", null)), "Invitados: (sin dato)");
  assert.equal(describirCambio(c("Evento", "PERIODO", "mañana", null)), "Período: (sin dato)");
});
