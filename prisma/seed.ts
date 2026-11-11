import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { puedeSembrar } from "../lib/seed-guarda";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

function parseCatalog() {
  const tsv = readFileSync(join(process.cwd(), "prisma", "catalogo.tsv"), "utf8");
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length);
  lines.shift(); // header: Categoría Rubro Producto Tipo Unidad Stock Revisar
  return lines
    .map((l) => {
      const c = l.split("\t");
      const tipo = (c[3] ?? "").trim().toUpperCase();
      return {
        category: (c[0] ?? "").trim(),
        rubro: (c[1] ?? "").trim() || null,
        name: (c[2] ?? "").trim(),
        type: tipo.startsWith("REUT") ? "REUTILIZABLE" : "CONSUMIBLE",
        unit: (c[4] ?? "").trim() || "Unidad",
        stock: 0,
      };
    })
    .filter((p) => p.name && p.category);
}

async function main() {
  const products = parseCatalog();

  // Lo de abajo BORRA los renglones de todos los pedidos, todos los movimientos
  // de stock y el catalogo entero. Antes de tocar nada se mira contra que base
  // se esta por correr: en produccion, o sobre una base con trabajo cargado,
  // no corre sin --force (ver lib/seed-guarda.ts).
  const permiso = puedeSembrar(process.argv.slice(2), process.env, {
    eventos: await prisma.event.count(),
    renglones: await prisma.orderLine.count(),
    movimientos: await prisma.stockMovement.count(),
  });
  if (!permiso.ok) throw new Error(permiso.motivo);

  // Reseteo idempotente del catálogo (dev)
  await prisma.orderLine.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.product.deleteMany();
  await prisma.product.createMany({ data: products });

  // Usuario administrador inicial
  await prisma.user.deleteMany({ where: { email: "lisa@didier.com" } }); // limpia placeholder viejo
  const email = "lisa.lf2006@gmail.com";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    // La contrasena sale del entorno, no del repositorio.
    //
    // Habia una contrasena escrita aca, y el repositorio se clona, se respalda y
    // se lee. En ese momento el seed corria en cada despliegue, asi que la
    // contrasena del unico ADMIN quedaba fijada por el codigo fuente y no se
    // podia cambiar sin publicar una version.
    //
    // Hoy el seed NO corre al desplegar (`start:prod` solo aplica migraciones y
    // arranca): es un comando de desarrollo, `npm run db:seed`, para armar una
    // base local desde cero.
    //
    // Falla ruidoso a proposito: si no esta la variable, no se crea el usuario.
    // Un ADMIN con contrasena conocida es peor que no tener ADMIN — el segundo
    // problema se nota en cinco minutos, el primero no se nota nunca.
    const clave = process.env.SEED_ADMIN_PASSWORD;
    if (!clave || clave.length < 10) {
      throw new Error(
        "Falta SEED_ADMIN_PASSWORD (minimo 10 caracteres) para crear el usuario administrador inicial.",
      );
    }
    await prisma.user.create({
      data: {
        name: "Lisa",
        email,
        role: "ADMIN",
        passwordHash: bcrypt.hashSync(clave, 10),
      },
    });
    console.log(`Admin creado: ${email} (contrasena: la de SEED_ADMIN_PASSWORD)`);
  }

  const total = await prisma.product.count();
  const reut = await prisma.product.count({ where: { type: "REUTILIZABLE" } });
  const cons = await prisma.product.count({ where: { type: "CONSUMIBLE" } });
  console.log(`Seed OK -> ${total} productos (${reut} reutilizables, ${cons} consumibles).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
