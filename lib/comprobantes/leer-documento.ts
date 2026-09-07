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

  // La ESCANEADA cuando existe: enderezada y con el fondo blanco es justamente
  // lo que sube la tasa de extracción, y el recorte lo confirmó una persona en
  // la pantalla de captura, así que no hay riesgo de que se haya comido un borde
  // sin que nadie lo viera.
  //
  // `ESCANEADA` va antes que `ORIGINAL` alfabéticamente, así que el orden
  // ascendente la pone primero y cae sola a la original cuando no hay escaneo.
  const adjunto = await db.attachment.findFirst({
    where: { documentId },
    orderBy: [{ page: "asc" }, { variante: "asc" }],
    select: { s3Key: true, mimeType: true },
  });
  if (!adjunto) throw new Error("Ese comprobante no tiene foto para leer.");

  const bytes = await bajarFoto(adjunto.s3Key);
  return leerFoto(bytes, adjunto.mimeType, doc.kind as Kind);
}
