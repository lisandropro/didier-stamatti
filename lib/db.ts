import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { crearTurno } from "./turno-db";

// Prisma 7 usa un "driver adapter" para SQLite. En local, dev.db vive en la raíz
// del proyecto; en producción, DATABASE_URL apunta al disco persistente del hosting.

/**
 * El cliente, con turnos para usar la conexión.
 *
 * El adaptador tiene UNA conexión. Sin esto, una escritura suelta que llega
 * mientras otra acción tiene una transacción abierta se ejecuta adentro de esa
 * transacción, y si la transacción vuelve atrás la escritura se pierde aunque a
 * la persona se le haya dicho "guardado" (ver lib/turno-db.ts y la prueba
 * tests/db-turnos.test.ts, que lo reproduce).
 *
 * Cómo se distingue lo que es de la transacción de lo que no: todo lo que se
 * llama desde adentro de `$transaction` corre con una marca (AsyncLocalStorage)
 * y pasa directo; lo que no tiene la marca espera a que la transacción termine.
 */
function crearCliente(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
  const base = new PrismaClient({ adapter });
  const turno = crearTurno();
  const dentroDeTransaccion = new AsyncLocalStorage<true>();

  const conTurnos = base.$extends({
    name: "turnos",
    query: {
      $allOperations({ args, query }) {
        // Es parte de una transacción en curso: va por la conexión ya abierta.
        if (dentroDeTransaccion.getStore()) return query(args);
        return turno.entrarSuelta().then(async (soltar) => {
          try {
            return await query(args);
          } finally {
            soltar();
          }
        });
      },
    },
  });

  // Tanto la forma con función como la de lista: las dos abren BEGIN y lo
  // dejan abierto mientras esperan.
  const original = (conTurnos.$transaction as (...a: unknown[]) => Promise<unknown>).bind(conTurnos);
  const transaccion = (...argumentos: unknown[]): Promise<unknown> => {
    // Una transacción pedida desde adentro de otra: como siempre, sin turno
    // nuevo (pedirlo sería esperarse a sí misma).
    if (dentroDeTransaccion.getStore()) return original(...argumentos);
    return turno.entrarTransaccion().then(async (soltar) => {
      try {
        return await dentroDeTransaccion.run(true, () => original(...argumentos));
      } finally {
        soltar();
      }
    });
  };

  // La extensión no cambia qué métodos hay ni qué devuelven: solo cuándo
  // corren. Por eso el tipo que se exporta sigue siendo el del cliente común.
  return new Proxy(conTurnos, {
    get(objetivo, propiedad) {
      if (propiedad === "$transaction") return transaccion;
      return Reflect.get(objetivo, propiedad, objetivo);
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? crearCliente();

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
