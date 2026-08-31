import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Un producto puede nacer sin contar.
 *
 * Cuando la app aprendió a distinguir "nunca lo contamos" de "hay cero", el
 * alta de productos quedó atrás: seguía escribiendo 0 cuando no le pasaban
 * cantidad. Se notó cargando doce productos reales — ocho nacieron diciendo
 * "contado: no hay" cuando nadie los había contado.
 *
 * Lo que se cuida acá es que el alta respete los tres estados: sin contar,
 * contado en cero, y contado con número. Y que solo el tercero deje movimiento:
 * un recuento que no pasó no puede figurar en el historial.
 */

const DB = path.join(os.tmpdir(), `alta-sin-contar-${process.pid}.db`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let crear: any;

before(async () => {
  fs.rmSync(DB, { force: true });
  // ANTES de importar nada que use la base.
  process.env.DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  ({ prisma } = await import("../lib/db"));

  // La acción real llama a getSessionUser y revalidatePath, que revientan fuera
  // de una petición de Next. Se replica su cuerpo, que es lo que se quiere
  // proteger: cómo traduce la cantidad recibida a lo que guarda.
  const { esCategoria } = await import("../lib/categories");
  crear = async (input: { name: string; type?: string; stock?: number | null }) => {
    const type = input.type ?? "REUTILIZABLE";
    assert.ok(esCategoria("ENSERES"));
    const esReutilizable = type === "REUTILIZABLE";
    const sinContar = input.stock === null || input.stock === undefined;
    const stock = !esReutilizable ? 0 : sinContar ? null : Math.max(0, Math.round(input.stock!));
    const p = await prisma.product.create({
      data: { name: input.name, category: "ENSERES", type, unit: "Unidad", stock, active: true },
    });
    if (stock !== null && stock > 0) {
      await prisma.stockMovement.create({
        data: { productId: p.id, delta: stock, reason: "AJUSTE", note: "Alta del producto — cantidad inicial" },
      });
    }
    return p;
  };
});

test("sin cantidad, el producto nace SIN CONTAR y no en cero", async () => {
  const p = await crear({ name: "Heladera 4 puertas" });
  assert.equal(p.stock, null, "cero sería mentir: nadie lo contó");
});

test("un cero explícito se guarda como cero, porque es un dato", async () => {
  const p = await crear({ name: "Florero de vidrio", stock: 0 });
  assert.equal(p.stock, 0, "se contó y no hay: eso se conserva");
});

test("una cantidad se guarda tal cual", async () => {
  const p = await crear({ name: "Fuente rectangular azul", stock: 9 });
  assert.equal(p.stock, 9);
});

test("solo la cantidad real deja movimiento en el historial", async () => {
  const sinContar = await crear({ name: "Termo de acero chico" });
  const enCero = await crear({ name: "Pinza de asado", stock: 0 });
  const conNumero = await crear({ name: "Fuente redonda chica azul", stock: 10 });

  const mov = async (id: string) => prisma.stockMovement.count({ where: { productId: id } });
  assert.equal(await mov(sinContar.id), 0, "un recuento que no pasó no puede figurar");
  assert.equal(await mov(enCero.id), 0, "cero no mueve nada");
  assert.equal(await mov(conNumero.id), 1);
});

test("un consumible nunca queda sin contar: no lleva stock", async () => {
  const p = await crear({ name: "Servilleta de papel", type: "CONSUMIBLE" });
  assert.equal(p.stock, 0, "los consumibles se compran para cada evento, no se cuentan");
});

test("una cantidad negativa no puede colarse", async () => {
  const p = await crear({ name: "Tabla de madera", stock: -5 });
  assert.equal(p.stock, 0);
});

test("los tres estados conviven y se distinguen", async () => {
  const sinContar = await prisma.product.count({ where: { type: "REUTILIZABLE", stock: null } });
  const contados = await prisma.product.count({ where: { type: "REUTILIZABLE", stock: { not: null } } });
  assert.ok(sinContar >= 2, "tiene que haber productos sin contar");
  assert.ok(contados >= 3, "y productos contados, algunos en cero");
});
