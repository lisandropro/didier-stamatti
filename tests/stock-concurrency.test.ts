import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validQuantity } from "../lib/quantity";

const dir = mkdtempSync(path.join(tmpdir(), "didier-stock-audit-"));
process.env.DATABASE_URL = `file:${path.join(dir, "stock.db")}`;
let prisma: typeof import("../lib/db").prisma;
let saveStock: typeof import("../lib/stock").saveStock;
let userId: string;
before(async () => {
  writeFileSync(path.join(dir, "stock.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "inherit", timeout: 60_000 });
  ({ prisma } = await import("../lib/db"));
  ({ saveStock } = await import("../lib/stock"));
  userId = (await prisma.user.create({ data: { name: "Test", email: "audit@example.test", passwordHash: "fake", role: "ADMIN" } })).id;
});
after(async () => { await prisma?.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

test("rechaza fracciones, negativos, infinitos, texto y desbordes", () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 1.5, "10", null, undefined, 2147483648]) assert.equal(validQuantity(value), false);
  for (const value of [0, 1, 2147483647]) assert.equal(validQuantity(value), true);
});
test("dos formularios: el segundo no pisa el stock y el historial cuadra", async () => {
  const product = await prisma.product.create({ data: { name: "Platos", category: "ENSERES", type: "REUTILIZABLE", stock: 100 } });
  assert.equal((await saveStock({ productId: product.id, expectedStock: 100, newStock: 90, reason: "ROTURA" }, userId)).ok, true);
  const conflict = await saveStock({ productId: product.id, expectedStock: 100, newStock: 120, reason: "COMPRA" }, userId);
  assert.equal(conflict.ok, false); assert.match(conflict.error!, /cambió/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 90);
  const moves = await prisma.stockMovement.findMany({ where: { productId: product.id } });
  assert.equal(moves.length, 1); assert.equal(moves[0].delta, -10);
});
test("primer recuento cero se registra; reenviar el mismo valor no duplica movimientos", async () => {
  const product = await prisma.product.create({ data: { name: "Copas", category: "ENSERES", type: "REUTILIZABLE", stock: null } });
  assert.equal((await saveStock({ productId: product.id, expectedStock: null, newStock: 0, reason: "AJUSTE" }, userId)).ok, true);
  assert.equal((await saveStock({ productId: product.id, expectedStock: 0, newStock: 0, reason: "AJUSTE" }, userId)).ok, true);
  assert.equal(await prisma.stockMovement.count({ where: { productId: product.id } }), 1);
});
test("si falla el historial se revierte también la modificación de stock", async () => {
  const product = await prisma.product.create({ data: { name: "Sillas", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 10 } });
  await assert.rejects(saveStock({ productId: product.id, expectedStock: 10, newStock: 5, reason: "PERDIDA" }, "no-existe"));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 10);
});
