import { test } from "node:test";
import assert from "node:assert/strict";
import { crearTurno } from "../lib/turno-db";

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("las operaciones sueltas corren varias a la vez", async () => {
  const turno = crearTurno();
  const a = await turno.entrarSuelta();
  const b = await turno.entrarSuelta();
  assert.deepEqual(turno.estado(), { sueltas: 2, transaccion: false, esperando: 0 });
  a();
  b();
  assert.deepEqual(turno.estado(), { sueltas: 0, transaccion: false, esperando: 0 });
});

test("una transacción espera a que terminen las sueltas en curso", async () => {
  const turno = crearTurno();
  const soltarSuelta = await turno.entrarSuelta();
  let entro = false;
  const tx = turno.entrarTransaccion().then((s) => {
    entro = true;
    return s;
  });
  await pausa(10);
  assert.equal(entro, false, "no puede empezar con una suelta a medio hacer");
  soltarSuelta();
  const soltarTx = await tx;
  assert.equal(turno.estado().transaccion, true);
  soltarTx();
});

test("una suelta que llega con una transacción abierta espera a que termine", async () => {
  const turno = crearTurno();
  const soltarTx = await turno.entrarTransaccion();
  const orden: string[] = [];
  const suelta = turno.entrarSuelta().then((s) => {
    orden.push("suelta");
    return s;
  });
  await pausa(10);
  orden.push("fin de la transaccion");
  soltarTx();
  (await suelta)();
  assert.deepEqual(orden, ["fin de la transaccion", "suelta"]);
});

test("dos transacciones no se pisan y corren en el orden en que llegaron", async () => {
  const turno = crearTurno();
  const orden: number[] = [];
  const correr = async (n: number) => {
    const soltar = await turno.entrarTransaccion();
    orden.push(n);
    await pausa(5);
    orden.push(-n);
    soltar();
  };
  await Promise.all([correr(1), correr(2), correr(3)]);
  assert.deepEqual(orden, [1, -1, 2, -2, 3, -3]);
});

test("con una transacción esperando, las sueltas nuevas no se le adelantan", async () => {
  const turno = crearTurno();
  const soltarPrimera = await turno.entrarSuelta();
  const orden: string[] = [];
  const tx = turno.entrarTransaccion().then((s) => {
    orden.push("transaccion");
    return s;
  });
  const tarde = turno.entrarSuelta().then((s) => {
    orden.push("suelta tardia");
    return s;
  });
  soltarPrimera();
  (await tx)();
  (await tarde)();
  assert.deepEqual(orden, ["transaccion", "suelta tardia"]);
});

test("al terminar una transacción, las sueltas que esperaban entran todas juntas", async () => {
  const turno = crearTurno();
  const soltarTx = await turno.entrarTransaccion();
  const esperas = [turno.entrarSuelta(), turno.entrarSuelta(), turno.entrarSuelta()];
  await pausa(5);
  assert.equal(turno.estado().esperando, 3);
  soltarTx();
  const soltar = await Promise.all(esperas);
  assert.deepEqual(turno.estado(), { sueltas: 3, transaccion: false, esperando: 0 });
  // Una transacción que llega ahora las tiene que ver, aunque recién entren.
  let entro = false;
  const tx = turno.entrarTransaccion().then((s) => {
    entro = true;
    return s;
  });
  await pausa(5);
  assert.equal(entro, false);
  for (const s of soltar) s();
  (await tx)();
});

test("soltar dos veces no desacomoda la cuenta", async () => {
  const turno = crearTurno();
  const a = await turno.entrarSuelta();
  const b = await turno.entrarSuelta();
  a();
  a();
  assert.equal(turno.estado().sueltas, 1);
  b();
  assert.equal(turno.estado().sueltas, 0);
});

test("quien espera demasiado pasa igual, y la fila queda limpia", async () => {
  const turno = crearTurno(30);
  const soltarTx = await turno.entrarTransaccion();
  const antes = Date.now();
  const soltarSuelta = await turno.entrarSuelta();
  assert.ok(Date.now() - antes >= 25, "esperó su tiempo antes de pasar");
  assert.equal(turno.estado().esperando, 0);
  // Pasó sin anotarse: soltar no puede restar de una cuenta en la que no está.
  soltarSuelta();
  assert.deepEqual(turno.estado(), { sueltas: 0, transaccion: true, esperando: 0 });
  soltarTx();
  assert.deepEqual(turno.estado(), { sueltas: 0, transaccion: false, esperando: 0 });
});
