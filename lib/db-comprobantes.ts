import { PrismaClient } from "@/app/generated/comprobantes/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Segundo cliente, apuntando a la base de comprobantes. Es una base aparte de
// la del stock a propósito: el respaldo del stock retiene 14 días y un
// comprobante fiscal hay que guardarlo años.
//
// El singleton en `globalThis` es para que el recargado en caliente de
// desarrollo no abra una conexión nueva por cada cambio de archivo — mismo
// motivo que en `lib/db.ts`, pero con su propia variable para no pisar la del
// stock.
const adapter = new PrismaBetterSqlite3({
  url: process.env.COMPROBANTES_DATABASE_URL ?? "file:./dev-comprobantes.db",
});

const globalForPrisma = globalThis as unknown as { prismaComprobantes?: PrismaClient };

export const prismaComprobantes = globalForPrisma.prismaComprobantes ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaComprobantes = prismaComprobantes;
