import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7 usa un "driver adapter" para SQLite. En local, dev.db vive en la raíz
// del proyecto; en producción, DATABASE_URL apunta al disco persistente del hosting.
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// WAL: los lectores dejan de bloquear al escritor.
//
// En el modo por defecto, el `VACUUM INTO` del respaldo toma un lock de lectura
// sobre toda la base y **bloquea las escrituras** mientras dura. Con la base
// chica son segundos; con un par de GB es una ventana en la que una captura del
// depósito puede fallar. `busy_timeout` hace que el que llega segundo espere en
// vez de morir.
void prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
void prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => {});
