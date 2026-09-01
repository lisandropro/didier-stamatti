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
function urlDeLaBase(): string {
  const url = process.env.COMPROBANTES_DATABASE_URL;
  if (url) {
    // Las dos bases en el mismo archivo mezclaría comprobantes fiscales con el
    // inventario, y el respaldo de uno pisaría al del otro.
    if (url === process.env.DATABASE_URL) {
      throw new Error("COMPROBANTES_DATABASE_URL no puede apuntar al mismo archivo que DATABASE_URL.");
    }
    return url;
  }
  // En producción se cae con ruido. Antes caía a un archivo dentro del
  // contenedor: la app arrancaba sin un solo error y perdía TODOS los
  // comprobantes en cada despliegue, en silencio.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Falta COMPROBANTES_DATABASE_URL. Sin esa variable los comprobantes se escribirían en un disco efímero y se perderían en el próximo despliegue.",
    );
  }
  return "file:./dev-comprobantes.db";
}

// El cliente se construye en el PRIMER uso, no al importar el modulo.
//
// No es un detalle de estilo: `next build` importa cada ruta para recolectar sus
// datos, con NODE_ENV en "production" y sin las variables de entorno del
// servidor. Con la construccion al importar, la guarda de arriba tiraba durante
// el build y rompia el despliegue entero — una guarda pensada para proteger los
// datos terminaba impidiendo publicar.
//
// Diferirlo mantiene la guarda intacta donde importa: sigue tirando en
// produccion, con la misma frase, la primera vez que alguien consulta de
// verdad. Lo que ya no hace es opinar durante la compilacion.
const globalForPrisma = globalThis as unknown as { prismaComprobantes?: PrismaClient };

function construir(): PrismaClient {
  const cliente = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: urlDeLaBase() }) });

  // WAL: los lectores dejan de bloquear al escritor.
  //
  // En el modo por defecto, el `VACUUM INTO` del respaldo toma un lock de
  // lectura sobre toda la base y **bloquea las escrituras** mientras dura. Con
  // la base chica son segundos; con un par de GB es una ventana en la que una
  // captura del deposito puede fallar. `busy_timeout` hace que el que llega
  // segundo espere en vez de morir.
  void cliente.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
  void cliente.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => {});

  return cliente;
}

function cliente(): PrismaClient {
  const yaHay = globalForPrisma.prismaComprobantes;
  if (yaHay) return yaHay;
  const nuevo = construir();
  // El singleton en `globalThis` es para que el recargado en caliente de
  // desarrollo no abra una conexion nueva por cada cambio de archivo — mismo
  // motivo que en `lib/db.ts`, pero con su propia variable para no pisar la del
  // stock. En produccion el modulo se carga una sola vez y la constante alcanza.
  if (process.env.NODE_ENV !== "production") globalForPrisma.prismaComprobantes = nuevo;
  return nuevo;
}

let memo: PrismaClient | undefined;

/**
 * El cliente de comprobantes.
 *
 * Es un Proxy para que el resto del codigo lo siga usando como un objeto comun
 * —`prismaComprobantes.document.findMany(...)`— sin que nadie tenga que
 * acordarse de llamar a una funcion. La unica diferencia es CUANDO se conecta.
 */
export const prismaComprobantes = new Proxy({} as PrismaClient, {
  get(_t, prop, receiver) {
    memo ??= cliente();
    const v = Reflect.get(memo as object, prop, receiver);
    return typeof v === "function" ? v.bind(memo) : v;
  },
});
