import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";

// La conexión a la base es una sola. Antes de los turnos (lib/turno-db.ts), una
// escritura suelta que llegaba con una transacción abierta se ejecutaba adentro
// de ella, y si la transacción volvía atrás la escritura se perdía aunque
// hubiera devuelto OK. Esta prueba lo reproduce contra una base de verdad.

const base = crearBaseDescartable("db-turnos");
let prisma: typeof import("../lib/db").prisma;

before(async () => {
  ({ prisma } = await import("../lib/db"));
});

after(async () => {
  await prisma.$disconnect();
  base.borrar();
});

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const producto = (name: string) => ({ name, category: "ENSERES", type: "REUTILIZABLE" });

test("una escritura suelta no se pierde cuando la transacción de otro vuelve atrás", async () => {
  const afuera = (async () => {
    await pausa(30);
    return prisma.product.create({ data: producto("afuera") });
  })();
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.product.create({ data: producto("dentro") });
      await pausa(120);
      throw new Error("vuelta atras");
    }),
    /vuelta atras/,
  );
  await afuera;
  const nombres = (await prisma.product.findMany({ select: { name: true } })).map((p) => p.name);
  assert.deepEqual(nombres, ["afuera"], "queda la de afuera y no la de la transacción deshecha");
});

test("muchas escrituras sueltas a la vez que transacciones que fallan: no se pierde ninguna", async () => {
  let perdidas = 0;
  for (let ronda = 0; ronda < 8; ronda++) {
    const tx = prisma
      .$transaction(async (t) => {
        for (let i = 0; i < 4; i++) await t.product.count();
        await t.product.create({ data: producto(`dentro-r${ronda}`) });
        for (let i = 0; i < 4; i++) await t.product.count();
        throw new Error("vuelta atras");
      })
      .catch(() => {});
    const sueltas: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) sueltas.push(prisma.product.create({ data: producto(`suelta-r${ronda}-${i}`) }));
    const resultados = await Promise.allSettled(sueltas);
    await tx;
    const dijeronOk = resultados.filter((r) => r.status === "fulfilled").length;
    const enLaBase = await prisma.product.count({ where: { name: { startsWith: `suelta-r${ronda}-` } } });
    assert.equal(dijeronOk, 20);
    perdidas += dijeronOk - enLaBase;
  }
  assert.equal(perdidas, 0);
  assert.equal(await prisma.product.count({ where: { name: { startsWith: "dentro-" } } }), 0);
});

test("una transacción que termina bien guarda lo suyo, y lo de afuera también", async () => {
  const afuera = prisma.product.create({ data: producto("afuera-ok") });
  await prisma.$transaction(async (tx) => {
    await tx.product.create({ data: producto("dentro-ok") });
    await pausa(20);
  });
  await afuera;
  assert.equal(await prisma.product.count({ where: { name: { in: ["afuera-ok", "dentro-ok"] } } }), 2);
});

test("usar el cliente común adentro de una transacción no la deja colgada", async () => {
  // Hay helpers que reciben el cliente por defecto. Llamados desde adentro de
  // una transacción tienen que seguir andando, no esperarse a sí mismos.
  const antes = Date.now();
  await prisma.$transaction(async (tx) => {
    await tx.product.create({ data: producto("con-tx") });
    await prisma.product.count();
  });
  assert.ok(Date.now() - antes < 3000, "no esperó el tiempo máximo del turno");
});

test("la transacción en forma de lista es atómica y deja pasar lo de afuera después", async () => {
  await assert.rejects(
    prisma.$transaction([
      prisma.product.create({ data: producto("lista-1") }),
      // Falla: el id ya existe en la misma lista.
      prisma.product.create({ data: { ...producto("lista-2"), id: "repetido" } }),
      prisma.product.create({ data: { ...producto("lista-3"), id: "repetido" } }),
    ]),
  );
  assert.equal(await prisma.product.count({ where: { name: { startsWith: "lista-" } } }), 0);
  await prisma.$transaction([
    prisma.product.create({ data: producto("lista-ok-1") }),
    prisma.product.create({ data: producto("lista-ok-2") }),
  ]);
  assert.equal(await prisma.product.count({ where: { name: { startsWith: "lista-ok-" } } }), 2);
});

test("el respaldo (VACUUM INTO) espera a que termine la transacción en vez de fallar", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const destino = path.join(os.tmpdir(), `didier-test-vacuum-${process.pid}.db`);
  fs.rmSync(destino, { force: true });
  const tx = prisma.$transaction(async (t) => {
    await t.product.count();
    await pausa(80);
    await t.product.create({ data: producto("antes-del-respaldo") });
  });
  await pausa(20);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  await tx;
  assert.ok(fs.statSync(destino).size > 0);
  fs.rmSync(destino, { force: true });
});
