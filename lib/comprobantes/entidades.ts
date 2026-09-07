import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { cuitValido } from "./cuit";

// A nombre de quién está cada factura.
//
// **Por qué existe este archivo.** El módulo nació con el CUIT de la empresa
// escrito en `qr.ts`, como una constante. Alcanzaba mientras hubiera una sola
// empresa. Con la UTE de los Juegos Suramericanos —Soluciones para Eventos +
// Transfluvial— hay **dos contribuyentes**: dos CUIT, dos claves fiscales y dos
// libros de IVA.
//
// Lo que rompía sin esto no era estético: la deuda por proveedor y la pantalla
// de pagos sumaban las facturas de las dos entidades en un mismo total, y ese
// total no le sirve a ninguna de las dos.
//
// Las entidades se dan de alta desde la app y no desde el código, para que
// sumar una tercera —o corregir un dígito de un CUIT— no dependa de un
// despliegue.

/** Una entidad como la ve la pantalla. */
export type EntidadVista = {
  id: string;
  nombre: string;
  cuit: string;
  activa: boolean;
  /** Cuántos comprobantes tiene. Es lo que hace visible el costo de desactivarla. */
  comprobantes: number;
};

/** Las que se pueden elegir al capturar. Las desactivadas no aparecen. */
export async function activas(): Promise<{ id: string; nombre: string; cuit: string }[]> {
  return db.entidad.findMany({
    where: { activa: true, deletedAt: null },
    select: { id: true, nombre: true, cuit: true },
    orderBy: { nombre: "asc" },
  });
}

/**
 * Todas, con cuántos comprobantes tiene cada una.
 *
 * Incluye las desactivadas: esconderlas dejaría sin explicación los
 * comprobantes que les pertenecen.
 */
export async function todas(): Promise<EntidadVista[]> {
  const filas = await db.entidad.findMany({
    where: { deletedAt: null },
    orderBy: [{ activa: "desc" }, { nombre: "asc" }],
    select: {
      id: true,
      nombre: true,
      cuit: true,
      activa: true,
      _count: { select: { documents: true } },
    },
  });
  return filas.map((e) => ({
    id: e.id,
    nombre: e.nombre,
    cuit: e.cuit,
    activa: e.activa,
    comprobantes: e._count.documents,
  }));
}

/** Los dígitos del CUIT, sin guiones ni espacios. En el papel casi siempre
 *  viene como `30-71773748-9`, y el QR lo trae pelado. */
export function normalizarCuit(cuit: string): string {
  return typeof cuit === "string" ? cuit.replace(/\D/g, "") : "";
}

export type ResultadoEntidad =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Da de alta una entidad.
 *
 * El CUIT se valida por dígito verificador antes de tocar la base. No es
 * burocracia: **el CUIT es lo que hace que una factura se asigne sola**, así
 * que uno mal tipeado no da un error visible — da facturas que nunca encuentran
 * su entidad y quedan sueltas para siempre.
 */
export async function crear(nombre: string, cuit: string): Promise<ResultadoEntidad> {
  const n = (nombre ?? "").trim();
  if (!n) return { ok: false, error: "Poné el nombre de la entidad." };

  const c = normalizarCuit(cuit);
  if (!cuitValido(c)) return { ok: false, error: "Ese CUIT no es válido. Revisá los dígitos." };

  const repetida = await db.entidad.findUnique({ where: { cuit: c }, select: { nombre: true } });
  if (repetida) return { ok: false, error: `Ese CUIT ya está cargado como "${repetida.nombre}".` };

  const creada = await db.entidad.create({ data: { nombre: n, cuit: c }, select: { id: true } });
  return { ok: true, id: creada.id };
}

/**
 * Cambia el nombre, el CUIT o si está activa.
 *
 * **Cambiar el CUIT de una entidad que ya tiene comprobantes está permitido**, y
 * a propósito: el caso real es haber tipeado mal un dígito, y obligar a crear
 * otra entidad dejaría las facturas repartidas entre una entidad correcta y una
 * fantasma. Los comprobantes ya asignados no se tocan — siguen siendo de esta
 * entidad, que ahora tiene el CUIT bien.
 */
export async function editar(
  id: string,
  cambios: { nombre?: string; cuit?: string; activa?: boolean },
): Promise<ResultadoEntidad> {
  const actual = await db.entidad.findFirst({ where: { id, deletedAt: null } });
  if (!actual) return { ok: false, error: "Esa entidad no existe." };

  const data: { nombre?: string; cuit?: string; activa?: boolean } = {};

  if (cambios.nombre !== undefined) {
    const n = cambios.nombre.trim();
    if (!n) return { ok: false, error: "Poné el nombre de la entidad." };
    data.nombre = n;
  }

  if (cambios.cuit !== undefined) {
    const c = normalizarCuit(cambios.cuit);
    if (!cuitValido(c)) return { ok: false, error: "Ese CUIT no es válido. Revisá los dígitos." };
    if (c !== actual.cuit) {
      const otra = await db.entidad.findUnique({ where: { cuit: c }, select: { nombre: true } });
      if (otra) return { ok: false, error: `Ese CUIT ya está cargado como "${otra.nombre}".` };
    }
    data.cuit = c;
  }

  if (cambios.activa !== undefined) data.activa = cambios.activa;

  await db.entidad.update({ where: { id }, data });
  return { ok: true, id };
}

/**
 * Comprobantes sin entidad.
 *
 * `entidadId` en NULL significa "no se sabe de quién es", que es distinto de
 * asumir la de siempre. Esta consulta es la que impide que ese "no se sabe" se
 * quede a vivir: alimenta una bandeja, igual que las de proveedor y vencimiento
 * que ya existen.
 */
export async function sinEntidad(): Promise<number> {
  return db.document.count({ where: { entidadId: null, deletedAt: null } });
}
