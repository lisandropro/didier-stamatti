import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { aEscala } from "@/lib/money";
import type { CamposLeidos } from "./lectura";

// Guardar el DETALLE que la lectura sacó del papel.
//
// **Por qué existe.** Al ir a construir el documento reconstruido apareció que
// nadie escribía nunca `DocumentLine`, `neto`, `iva` ni `percepciones`: la
// lectura los extraía y `leerComprobanteConIA` los tiraba, devolviendo solo
// cuántos renglones había. El documento habría salido con la tabla vacía y sin
// desglose — una función que parece terminada y está hueca. Es el mismo patrón
// que la auditoría encontró con `supplierId`.
//
// **Qué se guarda y qué NO.** Acá se guarda solamente el detalle: los renglones
// y el desglose de IVA. **No se toca `importeTotal`, ni el proveedor, ni las
// fechas** — esos son los que deciden cuánta plata sale, y siguen requiriendo
// que una persona los confirme en la pantalla de completar.
//
// La distinción no es formal. El detalle documenta; el total paga. Un renglón
// mal leído se ve al lado de la foto y no le cuesta nada a nadie; un total mal
// leído se transfiere.
//
// Queda con su rastro a nombre de la lectura, no de la persona: en el historial
// se tiene que poder distinguir lo que leyó una máquina de lo que confirmó
// alguien.

const ACTOR = { id: null as string | null, name: "Lectura automática" };

/**
 * Persiste el detalle de una lectura.
 *
 * Devuelve cuántos renglones quedaron guardados.
 */
export async function guardarDetalleLeido(
  documentId: string,
  campos: CamposLeidos,
): Promise<number> {
  const antes = await db.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { source: true, neto: true, iva: true, percepciones: true },
  });
  if (!antes) throw new Error("Ese comprobante no existe.");

  const renglones = (campos.renglones ?? []).filter((r) => r.descripcion.trim() !== "");

  // `source` pasa a LECTURA solo si no había nada mejor. Un comprobante cuya
  // cabecera salió del QR sigue diciendo QR: ese dato es el que distingue una
  // identidad fiscal firmada por AFIP de una leída de una foto, y perderlo por
  // haber leído además el detalle sería cambiar información buena por ninguna.
  const source = antes.source === "QR" || antes.source === "ARCA" ? undefined : "LECTURA";

  const cambios: { field: string; before: string | null; after: string | null }[] = [];
  const anotar = (field: string, before: bigint | null, after: bigint | undefined) => {
    if (after === undefined) return;
    const a = String(after);
    const b = before == null ? null : String(before);
    if (a !== b) cambios.push({ field, before: b, after: a });
  };
  anotar("neto", antes.neto, campos.subtotal);
  anotar("iva", antes.iva, campos.iva);
  anotar("percepciones", antes.percepciones, campos.percepciones);
  if (renglones.length > 0) {
    cambios.push({ field: "renglones", before: null, after: `${renglones.length} renglones leídos` });
  }

  await db.$transaction([
    // Los renglones se reemplazan enteros. Mezclar los de dos lecturas daría
    // una tabla que no es la de ningún papel.
    db.documentLine.deleteMany({ where: { documentId } }),
    ...(renglones.length > 0
      ? [
          db.documentLine.createMany({
            data: renglones.map((r, i) => ({
              documentId,
              orden: i + 1,
              codigo: r.codigo ?? null,
              descripcion: r.descripcion,
              cantidad: aMilesimas(r.cantidad),
              unidad: r.unidad ?? null,
              precioUnitario: aMilesimas(r.precioUnitario),
              subtotal: aCentavosDeTexto(r.subtotal),
            })),
          }),
        ]
      : []),
    db.document.update({
      where: { id: documentId },
      data: {
        neto: campos.subtotal,
        iva: campos.iva,
        percepciones: campos.percepciones,
        source,
      },
    }),
    ...(cambios.length > 0
      ? [
          db.documentChange.createMany({
            data: cambios.map((c) => ({
              documentId,
              actorId: ACTOR.id,
              actorName: ACTOR.name,
              ...c,
            })),
          }),
        ]
      : []),
  ]);

  return renglones.length;
}

/** Una cantidad o un precio unitario, a milésimas.
 *
 *  Tres decimales porque así vienen impresos los dos: un kilo se factura como
 *  "4,400 KG" y su precio como "31.574,674". Con dos decimales, `aEscala`
 *  rechazaría el precio y el renglón quedaría sin precio unitario. */
function aMilesimas(texto: string | undefined): bigint | null {
  return texto ? aEscala(texto, 3) : null;
}

/** Un importe a centavos. */
function aCentavosDeTexto(texto: string | undefined): bigint | null {
  return texto ? aEscala(texto, 2) : null;
}
