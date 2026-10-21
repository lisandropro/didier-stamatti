import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { diaDe, instanteDe, sumarDias } from "../lib/dates";

/**
 * El barrido de faltantes contra una base de verdad: la primera corrida no
 * avisa, un faltante nuevo avisa una vez, empeorar avisa otra vez, resolverse
 * no avisa, y la regla es la misma que la del editor.
 */

const base = crearBaseDescartable("faltantes-db");
let prisma: typeof import("../lib/db").prisma;
let barrer: typeof import("../lib/faltantes-db").barrerFaltantes;
const enviados: { title: string; body: string; url?: string; tag?: string; endpoint: string }[] = [];
let ids: { periodo: string; evento: string; ana: string; pablo: string; dante: string; enrique: string; copa: string; mesa: string };

// "Ahora" fijo: el período y el evento son de hoy, y los cambios se fechan
// respecto de este instante para no depender del reloj.
const ahora = new Date();
const hoyDia = diaDe(ahora);
const haceMin = (min: number) => new Date(ahora.getTime() - min * 60_000);
const dentroDeMin = (min: number) => new Date(ahora.getTime() + min * 60_000);

before(async () => {
  ({ prisma } = await import("../lib/db"));
  ({ barrerFaltantes: barrer } = await import("../lib/faltantes-db"));
  const push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (destino, cuerpo) => {
    enviados.push({ ...JSON.parse(cuerpo), endpoint: destino.endpoint });
    return { statusCode: 201 };
  };
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: "x" } });
  const ana = await mk("Ana", "ADMIN");
  const pablo = await mk("Pablo", "LOGISTICA");
  const dante = await mk("Dante", "DEPOSITO");
  const enrique = await mk("Enrique", "ARMADOR");
  for (const u of [pablo, dante]) {
    await prisma.pushSubscription.create({ data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${u.name}`, p256dh: "k", auth: "a" } });
  }
  // Sin `faltantesDesde`: como un período que ya existía al desplegar el aviso.
  const periodo = await prisma.operationalPeriod.create({ data: { label: "Finde", startDay: hoyDia, endDay: sumarDias(hoyDia, 2) } });
  const evento = await prisma.event.create({ data: { periodId: periodo.id, lugar: "El Carmen", date: instanteDe(hoyDia, "21:00") } });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mesa = await prisma.product.create({ data: { name: "Mesa", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 10 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 300 } });
  ids = { periodo: periodo.id, evento: evento.id, ana: ana.id, pablo: pablo.id, dante: dante.id, enrique: enrique.id, copa: copa.id, mesa: mesa.id };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const filas = () => prisma.faltanteAvisado.findMany({ where: { periodId: ids.periodo }, orderBy: { productId: "asc" } });
const cambio = (itemName: string, createdAt: Date) =>
  prisma.orderChange.create({ data: { eventId: ids.evento, actorName: "Enrique", itemName, kind: "CANTIDAD", createdAt } });

test("la primera corrida registra lo que ya falta sin avisar", async () => {
  // Media hora antes de "ahora": la causa de un aviso tiene que ser un cambio
  // posterior a lo último que se registró de ese producto, y las pruebas que
  // siguen fechan sus cambios unos minutos antes de "ahora".
  const r = await barrer(haceMin(30));
  assert.equal(r.avisos, 0);
  assert.equal(r.registrados, 1);
  assert.deepEqual((await filas()).map((f) => [f.productId, f.missing]), [[ids.copa, 50]]);
  assert.ok((await prisma.operationalPeriod.findUnique({ where: { id: ids.periodo } }))?.faltantesDesde);
  assert.equal(enviados.length, 0);
});

test("un faltante nuevo avisa una vez, a todos, con prioridad y con su causa", async () => {
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: ids.mesa, qty: 12 } });
  await cambio("Mesa", haceMin(5));
  const r = await barrer(ahora);
  assert.equal(r.avisos, 4, "uno por persona: nadie queda afuera, ni quien hizo el cambio");
  assert.equal(enviados.length, 2, "Pablo y Dante tienen teléfono");
  for (const p of enviados) {
    assert.equal(p.title, "Falta stock · Finde");
    assert.equal(p.body, "Mesa: faltan 2 (piden 12, hay 10). Lo empujó el pedido de El Carmen.");
    assert.equal(p.tag, `faltante-${ids.periodo}`);
  }
  const deDante = enviados.find((p) => p.endpoint.endsWith("Dante"))!;
  const dePablo = enviados.find((p) => p.endpoint.endsWith("Pablo"))!;
  assert.equal(deDante.url, `/preparar/${ids.evento}#faltantes`, "el depósito va a los faltantes de Preparar");
  assert.equal(dePablo.url, `/?w=${ids.periodo}`, "quien ve el stock va a la portada del período");
  const entregas = await prisma.pushDelivery.findMany({ where: { kind: "FALTANTE" } });
  assert.ok(entregas.length === 2 && entregas.every((e) => e.urgency === "high"));
  const avisos = await prisma.notification.findMany({ where: { type: "FALTANTE" } });
  assert.equal(avisos.length, 4);
  assert.ok(avisos.every((a) => a.pushedAt !== null && a.message === "Falta stock en Finde: Mesa (faltan 2)"));

  enviados.length = 0;
  assert.equal((await barrer(ahora)).avisos, 0, "el mismo faltante no se avisa dos veces");
  assert.equal(enviados.length, 0);
});

test("empeorar avisa otra vez; mejorar no avisa ni baja lo guardado", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 320 } });
  await cambio("Copa de agua", haceMin(5));
  assert.equal((await barrer(ahora)).avisos, 4);
  assert.equal(enviados[0].body, "Copa de agua: faltan 70 (piden 320, hay 250). Lo empujó el pedido de El Carmen.");

  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 310 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).find((f) => f.productId === ids.copa)?.missing, 70);
});

test("resolverse no avisa y borra la fila", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.mesa }, data: { qty: 10 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).some((f) => f.productId === ids.mesa), false);
  assert.equal(enviados.length, 0);
});

test("mientras alguien sigue cambiando pedidos del período, el barrido espera", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 330 } });
  // Diez minutos después de la prueba anterior: el cambio tiene que ser posterior
  // al último aviso de la copa para ser su causa.
  const t = dentroDeMin(10);
  const reciente = await cambio("Copa de agua", new Date(t.getTime() - 30_000));
  assert.equal((await barrer(t)).avisos, 0, "hace 30 segundos que se cambió: todavía no");
  await prisma.orderChange.update({ where: { id: reciente.id }, data: { createdAt: new Date(t.getTime() - 3 * 60_000) } });
  assert.equal((await barrer(t)).avisos, 4, "pasada la quietud, sale");
  assert.match(enviados[0].body, /^Copa de agua: faltan 80 \(piden 330, hay 250\)\. Lo empujó el pedido de El Carmen\.$/);
});

test("sin un cambio de pedido reciente, la causa es un ajuste de stock", async () => {
  enviados.length = 0;
  await prisma.orderChange.updateMany({ data: { createdAt: haceMin(120) } });
  await prisma.product.update({ where: { id: ids.copa }, data: { stock: 200 } });
  assert.equal((await barrer(dentroDeMin(20))).avisos, 4);
  assert.match(enviados[0].body, /Copa de agua: faltan 130 \(piden 330, hay 200\)\. Por un ajuste de stock\.$/);
  const deDante = enviados.find((p) => p.endpoint.endsWith("Dante"))!;
  assert.equal(deDante.url, `/preparar/${ids.evento}#faltantes`, "sin causa, el primer evento del período");
});

test("la regla es la del editor: un consumible o un producto sin contar no avisan", async () => {
  enviados.length = 0;
  const vaso = await prisma.product.create({ data: { name: "Vaso descartable", category: "ENSERES", type: "CONSUMIBLE", stock: 1 } });
  const plato = await prisma.product.create({ data: { name: "Plato", category: "ENSERES", type: "REUTILIZABLE", stock: null } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: vaso.id, qty: 1000 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: plato.id, qty: 50 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).some((f) => f.productId === vaso.id || f.productId === plato.id), false);
});

test("un período que ya terminó no se barre", async () => {
  enviados.length = 0;
  const viejo = await prisma.operationalPeriod.create({
    data: { label: "Viejo", startDay: sumarDias(hoyDia, -5), endDay: sumarDias(hoyDia, -3), faltantesDesde: haceMin(9999) },
  });
  const ev = await prisma.event.create({ data: { periodId: viejo.id, lugar: "Pasado", date: instanteDe(sumarDias(hoyDia, -4), "21:00") } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: ids.mesa, qty: 500 } });
  await barrer(ahora);
  assert.equal(await prisma.faltanteAvisado.count({ where: { periodId: viejo.id } }), 0);
  assert.equal(enviados.length, 0);
});

// Las pruebas que siguen arman su propio período y sus propios productos: así no
// dependen del estado que dejaron las anteriores (filas avisadas, cambios,
// stock) ni el orden las afecta. Cada una lo retira en su `finally`.
const nuevoPeriodo = (label: string, dia = hoyDia, hasta = sumarDias(hoyDia, 2)) =>
  prisma.operationalPeriod.create({ data: { label, startDay: dia, endDay: hasta, faltantesDesde: haceMin(9999) } });
const nuevoEvento = (periodId: string, lugar: string, hora = "21:00", dia = hoyDia) =>
  prisma.event.create({ data: { periodId, lugar, date: instanteDe(dia, hora) } });
const nuevoProducto = (name: string, stock: number) =>
  prisma.product.create({ data: { name, category: "ENSERES", type: "REUTILIZABLE", stock } });
const piden = (eventId: string, productId: string, qty: number) => prisma.orderLine.create({ data: { eventId, productId, qty } });
const cambioEn = (eventId: string, itemName: string, createdAt: Date, kind = "CANTIDAD") =>
  prisma.orderChange.create({ data: { eventId, actorName: "Enrique", itemName, kind, createdAt } });
/** Lo último que se avisó de un producto, como si ya hubiera habido un aviso. */
const avisadoAntes = (periodId: string, productId: string, missing: number, at = haceMin(120)) =>
  prisma.faltanteAvisado.create({ data: { periodId, productId, missing, at } });
const retirar = async (periodIds: string[], productIds: string[]) => {
  for (const id of periodIds) await prisma.operationalPeriod.delete({ where: { id } });
  for (const id of productIds) await prisma.product.delete({ where: { id } });
};
const pushesDe = (periodId: string) => enviados.filter((p) => p.tag === `faltante-${periodId}`);
const avisosDe = (label: string) => prisma.notification.findMany({ where: { type: "FALTANTE", message: { contains: label } } });

test("la causa nunca es un evento borrado, ni el aviso lleva a él", async () => {
  enviados.length = 0;
  const periodo = await nuevoPeriodo("Aparte borrado");
  const producto = await nuevoProducto("Silla aparte borrado", 10);
  try {
    const vivo = await nuevoEvento(periodo.id, "El Carmen", "21:00");
    const borrado = await nuevoEvento(periodo.id, "Quinta Borrada", "18:00");
    await piden(vivo.id, producto.id, 12);
    await avisadoAntes(periodo.id, producto.id, 2);
    await cambioEn(vivo.id, producto.name, haceMin(20));
    // El cambio más nuevo sobre la silla es del evento que después se borra.
    await cambioEn(borrado.id, producto.name, haceMin(10));
    await prisma.event.update({ where: { id: borrado.id }, data: { deletedAt: new Date() } });
    await prisma.orderLine.updateMany({ where: { eventId: vivo.id }, data: { qty: 15 } });

    assert.equal((await barrer(ahora)).avisos, 4);
    const dante = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(dante.body, /Lo empujó el pedido de El Carmen\.$/, "la causa es el evento vivo, no el borrado");
    assert.doesNotMatch(dante.body, /Quinta Borrada/);
    assert.equal(dante.url, `/preparar/${vivo.id}#faltantes`);
    assert.ok((await avisosDe("Aparte borrado")).every((a) => a.eventId === vivo.id && !a.linkUrl?.includes(borrado.id)));

    // Y si el único cambio reciente era del evento borrado, no hay causa de pedido.
    enviados.length = 0;
    await prisma.orderChange.deleteMany({ where: { eventId: vivo.id } });
    await prisma.orderLine.updateMany({ where: { eventId: vivo.id }, data: { qty: 20 } });
    assert.equal((await barrer(dentroDeMin(5))).avisos, 4);
    const segundo = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(segundo.body, /Por un ajuste de stock\.$/);
    assert.equal(segundo.url, `/preparar/${vivo.id}#faltantes`, "sin causa, el primer evento VIVO del período");
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});

test("el depósito va al evento de la causa, no al primero por fecha", async () => {
  enviados.length = 0;
  const periodo = await nuevoPeriodo("Aparte dos eventos");
  const producto = await nuevoProducto("Mesa aparte dos eventos", 10);
  try {
    const primero = await nuevoEvento(periodo.id, "Almuerzo", "12:00");
    const segundo = await nuevoEvento(periodo.id, "Cena", "21:00");
    await piden(segundo.id, producto.id, 12);
    await cambioEn(segundo.id, producto.name, haceMin(5));

    assert.equal((await barrer(ahora)).avisos, 4);
    const dante = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(dante.body, /Lo empujó el pedido de Cena\.$/);
    assert.equal(dante.url, `/preparar/${segundo.id}#faltantes`);
    assert.notEqual(dante.url, `/preparar/${primero.id}#faltantes`);
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});

test("sin un cambio sobre el producto, un 'Todo el pedido' reciente es la causa", async () => {
  enviados.length = 0;
  const periodo = await nuevoPeriodo("Aparte todo el pedido");
  const producto = await nuevoProducto("Banco aparte todo el pedido", 10);
  try {
    const primero = await nuevoEvento(periodo.id, "Almuerzo", "12:00");
    const copiado = await nuevoEvento(periodo.id, "Cena", "21:00");
    await piden(copiado.id, producto.id, 12);
    // Otro producto cambió antes, y el pedido entero se copió después: nada
    // nombra al banco, pero la copia es lo que lo empujó.
    await cambioEn(primero.id, "Otra cosa", haceMin(30));
    await cambioEn(copiado.id, "Todo el pedido", haceMin(10), "COPIADO");

    assert.equal((await barrer(ahora)).avisos, 4);
    const dante = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(dante.body, /Lo empujó el pedido de Cena\.$/);
    assert.equal(dante.url, `/preparar/${copiado.id}#faltantes`);
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});

test("la causa tiene que ser posterior al último aviso del producto", async () => {
  enviados.length = 0;
  const periodo = await nuevoPeriodo("Aparte ancla");
  const producto = await nuevoProducto("Copa aparte ancla", 10);
  try {
    const primero = await nuevoEvento(periodo.id, "Almuerzo", "12:00");
    const carmen = await nuevoEvento(periodo.id, "El Carmen", "21:00");
    await piden(carmen.id, producto.id, 12);
    await cambioEn(carmen.id, producto.name, haceMin(5));

    assert.equal((await barrer(ahora)).avisos, 4);
    const uno = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(uno.body, /Lo empujó el pedido de El Carmen\.$/);

    // Diez minutos después baja el stock, sin ningún cambio de pedido nuevo. El
    // de El Carmen sigue dentro de la hora, pero ya se explicó en el aviso de
    // arriba: este empeoramiento lo causó el stock.
    enviados.length = 0;
    await prisma.product.update({ where: { id: producto.id }, data: { stock: 5 } });
    assert.equal((await barrer(dentroDeMin(10))).avisos, 4);
    const dos = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(dos.body, /faltan 7 \(piden 12, hay 5\)\. Por un ajuste de stock\.$/);
    assert.equal(dos.url, `/preparar/${primero.id}#faltantes`, "sin causa, el primer evento del período");

    // Un cambio de pedido nuevo, posterior al aviso, vuelve a ser causa.
    enviados.length = 0;
    await cambioEn(carmen.id, producto.name, dentroDeMin(12));
    await prisma.product.update({ where: { id: producto.id }, data: { stock: 2 } });
    assert.equal((await barrer(dentroDeMin(15))).avisos, 4);
    const tres = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.match(tres.body, /faltan 10 \(piden 12, hay 2\)\. Lo empujó el pedido de El Carmen\.$/);
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});

test("la espera por la quietud tiene techo: si los cambios no paran, se barre igual", async () => {
  enviados.length = 0;
  const periodo = await nuevoPeriodo("Aparte techo");
  const producto = await nuevoProducto("Plato aparte techo", 10);
  try {
    const evento = await nuevoEvento(periodo.id, "El Carmen");
    await piden(evento.id, producto.id, 14);
    await avisadoAntes(periodo.id, producto.id, 2);
    const haceSegundos = (t: Date) => new Date(t.getTime() - 30_000);

    // Cada barrido encuentra un cambio de hace 30 segundos: alguien no deja de editar.
    await cambioEn(evento.id, producto.name, haceSegundos(ahora));
    assert.equal((await barrer(ahora)).avisos, 0, "arranca la espera");
    const alos30 = dentroDeMin(30);
    await cambioEn(evento.id, producto.name, haceSegundos(alos30));
    assert.equal((await barrer(alos30)).avisos, 0, "media hora después, sigue esperando");
    assert.equal(pushesDe(periodo.id).length, 0);

    const alos61 = dentroDeMin(61);
    await cambioEn(evento.id, producto.name, haceSegundos(alos61));
    assert.equal((await barrer(alos61)).avisos, 4, "pasada la hora de espera, sale aunque sigan los cambios");
    assert.equal((await avisosDe("Aparte techo")).length, 4);

    // Al barrerse, la espera se olvida: si los cambios siguen, arranca otra desde cero.
    await prisma.orderLine.updateMany({ where: { eventId: evento.id }, data: { qty: 16 } });
    const alos62 = dentroDeMin(62);
    await cambioEn(evento.id, producto.name, haceSegundos(alos62));
    assert.equal((await barrer(alos62)).avisos, 0, "la espera nueva arranca de cero");
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});

test("dos barridos a la vez avisan una sola vez", async () => {
  enviados.length = 0;
  const periodo = await nuevoPeriodo("Aparte simultaneo");
  const producto = await nuevoProducto("Jarra aparte simultaneo", 10);
  try {
    const evento = await nuevoEvento(periodo.id, "El Carmen");
    await piden(evento.id, producto.id, 12);

    const [uno, dos] = await Promise.all([barrer(ahora), barrer(ahora)]);
    assert.equal(uno.avisos + dos.avisos, 4, "el segundo se descarta mientras el primero barre");
    assert.equal((await avisosDe("Aparte simultaneo")).length, 4);
    assert.equal(pushesDe(periodo.id).length, 2, "Pablo y Dante, una vez cada uno");
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});

test("un período que termina hoy se barre; uno que terminó ayer, no", async () => {
  enviados.length = 0;
  const ayer = sumarDias(hoyDia, -1);
  const hasta = await nuevoPeriodo("Aparte termina hoy", hoyDia, hoyDia);
  const termino = await nuevoPeriodo("Aparte termino ayer", ayer, ayer);
  const producto = await nuevoProducto("Bandeja aparte bordes", 10);
  try {
    const deHoy = await nuevoEvento(hasta.id, "Hoy", "21:00");
    const deAyer = await nuevoEvento(termino.id, "Ayer", "21:00", ayer);
    await piden(deHoy.id, producto.id, 12);
    await piden(deAyer.id, producto.id, 12);

    assert.equal((await barrer(ahora)).avisos, 4);
    assert.equal(await prisma.faltanteAvisado.count({ where: { periodId: hasta.id } }), 1);
    assert.equal(await prisma.faltanteAvisado.count({ where: { periodId: termino.id } }), 0);
    assert.equal(pushesDe(hasta.id).length, 2);
    assert.equal(pushesDe(termino.id).length, 0);
  } finally {
    await retirar([hasta.id, termino.id], [producto.id]);
  }
});

test("un período creado después del deploy avisa los faltantes de su primer pedido", async () => {
  enviados.length = 0;
  // Como lo crea `createPeriod`: nace con `faltantesDesde`. El primer barrido
  // sin avisar es solo para los períodos que ya existían al desplegar.
  const periodo = await prisma.operationalPeriod.create({
    data: { label: "Aparte recien creado", startDay: hoyDia, endDay: sumarDias(hoyDia, 2), faltantesDesde: ahora },
  });
  const producto = await nuevoProducto("Silla aparte recien creado", 100);
  try {
    // Se crea el evento y se le copia un pedido de otro: un toque, enseguida.
    const evento = await nuevoEvento(periodo.id, "Quinta");
    await piden(evento.id, producto.id, 180);
    await cambioEn(evento.id, "Todo el pedido", ahora, "COPIADO");

    const r1 = await barrer(new Date(ahora.getTime() + 30_000));
    assert.equal(r1.avisos, 0, "30 segundos después de copiar: todavía no");
    const r2 = await barrer(dentroDeMin(3));
    assert.equal(r2.registrados, 0, "no se registra en silencio como un faltante viejo");
    assert.equal(r2.avisos, 4);
    const dante = pushesDe(periodo.id).find((p) => p.endpoint.endsWith("Dante"))!;
    assert.equal(dante.body, "Silla aparte recien creado: faltan 80 (piden 180, hay 100). Lo empujó el pedido de Quinta.");
    assert.equal(dante.url, `/preparar/${evento.id}#faltantes`);
  } finally {
    await retirar([periodo.id], [producto.id]);
  }
});
