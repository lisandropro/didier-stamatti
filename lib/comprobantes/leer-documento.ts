import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { bajarFoto } from "./almacenamiento";
import { leerFoto, type Lectura } from "./lectura";
import type { Kind } from "./tipos";

// Une el documento guardado con el lector: busca la foto, la baja y la lee.
//
// Vive aparte de `lectura.ts` para que ese archivo no sepa nada de la base ni
// del bucket, y se pueda probar con respuestas guardadas sin levantar nada.

/**
 * Lee la foto de un comprobante y devuelve los campos PROPUESTOS.
 *
 * No escribe nada. Lo que devuelve va al formulario para que una persona lo
 * confirme, y guardar sigue pasando por `completarCabecera`, que es la única vía
 * de escritura y la que deja el rastro. La lectura no tiene vía propia a
 * propósito: una fuente probabilística no debería poder escribir sola en una
 * base de plata.
 */
export async function leerComprobante(documentId: string): Promise<Lectura> {
  const doc = await db.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { kind: true },
  });
  if (!doc) throw new Error("Ese comprobante no existe.");

  // La ORIGINAL y no la ESCANEADA: el recorte automático puede haberse comido un
  // borde, y lo que se le manda al lector conviene que sea la foto completa.
  // El orden por `variante` descendente pone ORIGINAL primero.
  const adjunto = await db.attachment.findFirst({
    where: { documentId },
    orderBy: [{ page: "asc" }, { variante: "desc" }],
    select: { s3Key: true, mimeType: true },
  });
  if (!adjunto) throw new Error("Ese comprobante no tiene foto para leer.");

  const bytes = await bajarFoto(adjunto.s3Key);
  return leerFoto(bytes, adjunto.mimeType, doc.kind as Kind);
}
