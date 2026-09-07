import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { aCentavos } from "@/lib/money";
import { esDia } from "@/lib/dates";

// La carga a mano: el último peldaño de la cascada.
//
// Primero se intenta el QR, después ARCA, y lo que no tiene ninguno de los dos
// llega acá. Según el usuario eso es buena parte de lo que entra —de 18
// facturas reales ninguna traía el código de barras y varias no traían QR—, así
// que esta pantalla no es el caso raro: es el caso común, y se diseña como tal.

export type DatosACompletar = {
  supplierId?: string;
  /** Cuando el proveedor no existe todavía. Los informales no tienen CUIT. */
  nombreProveedor?: string;
  /** Como lo tipeó la persona. Se convierte acá, en un solo lugar. */
  importeTexto?: string;
  fechaEmision?: string;
  vencimiento?: string;
};

export type ResultadoCompletar = {
  /**
   * Ya hay otro comprobante del mismo proveedor por el mismo importe.
   *
   * Se avisa **acá**, mientras se carga, y no después en la pantalla de pagos.
   * Es lo que hacen las apps del rubro y la razón es de tiempo: en el momento de
   * tipear, quien carga tiene el papel en la mano y decide en dos segundos. Dos
   * semanas más tarde, frente a dos filas iguales en una tabla, ya no se
   * acuerda — y la salida fácil es transferir las dos.
   *
   * No bloquea: dos facturas iguales el mismo mes existen. Solo avisa.
   */
  posibleDuplicado: boolean;
};

/**
 * Para comparar nombres de proveedor, no para guardarlos.
 *
 * El mismo proveedor entrando como "Ferretería Sur", "FERRETERIA SUR" y
 * "  Ferreteria  Sur " parte la deuda en tres, y una deuda partida en tres no
 * se paga junta. Es exactamente lo que resuelve la normalización de proveedores
 * en las apps del rubro.
 *
 * Se compara sin acentos, sin mayúsculas y con los espacios colapsados. **Lo
 * que se GUARDA es el texto original del primero**: quien lo cargó bien la
 * primera vez le puso los acentos; el segundo lo tipeó apurado.
 */
export function paraComparar(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Completa a mano lo que no vino leído.
 *
 * Son pocos campos a propósito, y cambian según el tipo: un remito no pide CAE.
 * Preguntarle datos fiscales a un remito es cómo se consigue que la gente cargue
 * cualquier cosa con tal de pasar de pantalla.
 *
 * Tira en vez de guardar a medias. Un importe que no se entiende, una fecha que
 * no existe, un comprobante ya pagado: cualquiera de esos frena la operación
 * entera. En plata, "se guardó una parte" es el peor de los tres resultados
 * posibles, porque es el único que nadie mira dos veces.
 */
export async function completarCabecera(
  id: string,
  datos: DatosACompletar,
  actor: { id: string; name: string },
): Promise<ResultadoCompletar> {
  const antes = await db.document.findUniqueOrThrow({ where: { id } });

  // Un anulado no se toca: si vuelve, se recupera primero y se completa después.
  if (antes.deletedAt) throw new Error("Ese comprobante está anulado.");

  let importeTotal: bigint | undefined;
  if (datos.importeTexto != null && datos.importeTexto.trim() !== "") {
    // Sin `puntoEsDecimal`: esto lo tipeó una persona en formato argentino, no
    // salió de un QR ni de un CSV de ARCA.
    const centavos = aCentavos(datos.importeTexto);
    // Si no se entiende, se rechaza. Guardar cero sería inventar un dato, y un
    // cero inventado dentro de una suma de deuda es peor que un campo vacío: el
    // vacío aparece en la bandeja, el cero no aparece en ningún lado.
    if (centavos === null) throw new Error(`No se entiende el importe: "${datos.importeTexto}"`);
    importeTotal = centavos;
  }

  // La plata ya salió. Cambiar el importe de algo transferido deja la pantalla
  // diciendo una cosa y el resumen del banco otra, sin que nada avise. Se
  // revierte el pago primero —que deja rastro— y recién después se corrige.
  if (antes.pagadoAt && importeTotal != null && importeTotal !== antes.importeTotal) {
    throw new Error("Ese comprobante ya está pagado. Revertí el pago antes de cambiar el importe.");
  }

  for (const [campo, valor] of [
    ["fechaEmision", datos.fechaEmision],
    ["vencimiento", datos.vencimiento],
  ] as const) {
    // `esDia` y no una expresión regular de forma: "2026-02-30" tiene la forma
    // correcta y no es una fecha. `new Date` la acepta y la corre al 2 de marzo.
    if (valor != null && valor !== "" && !esDia(valor)) {
      const cual = campo === "vencimiento" ? "vencimiento" : "emisión";
      throw new Error(`La fecha de ${cual} no existe. Va en AAAA-MM-DD.`);
    }
  }

  let supplierId = datos.supplierId;
  if (!supplierId && datos.nombreProveedor?.trim()) {
    const nombre = datos.nombreProveedor.trim();
    const clave = paraComparar(nombre);
    // SQLite no compara sin acentos por su cuenta, así que la comparación se
    // hace acá. Son decenas de proveedores, no millones: traerlos es barato y
    // más honesto que un LIKE que igual no resolvería los acentos.
    const todos = await db.supplier.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const existente = todos.find((s) => paraComparar(s.name) === clave);
    supplierId = existente?.id ?? (await db.supplier.create({ data: { name: nombre } })).id;
  }

  const cambios: { field: string; before: string | null; after: string | null }[] = [];
  const anotar = (field: string, before: unknown, after: unknown) => {
    if (after === undefined) return;
    const a = after == null ? null : String(after);
    const b = before == null ? null : String(before);
    if (a !== b) cambios.push({ field, before: b, after: a });
  };

  anotar("supplierId", antes.supplierId, supplierId);
  anotar("importeTotal", antes.importeTotal, importeTotal);
  anotar("fechaEmision", antes.fechaEmision, datos.fechaEmision || undefined);
  anotar("vencimiento", antes.vencimiento, datos.vencimiento || undefined);

  // De dónde vino el comprobante NO se pisa.
  //
  // Marcarlo MANUAL siempre borraba el único dato que dice que la cabecera la
  // firmó AFIP y no una persona apurada: cargarle el vencimiento a una factura
  // leída del QR la degradaba a carga manual. `source` pasa a MANUAL solo cuando
  // no había nada mejor que defender.
  const source = antes.source === "QR" || antes.source === "ARCA" ? undefined : "MANUAL";

  await db.$transaction([
    db.document.update({
      where: { id },
      data: {
        supplierId,
        importeTotal,
        fechaEmision: datos.fechaEmision || undefined,
        vencimiento: datos.vencimiento || undefined,
        source,
      },
    }),
    ...(cambios.length > 0
      ? [
          db.documentChange.createMany({
            data: cambios.map((c) => ({
              documentId: id,
              actorId: actor.id,
              actorName: actor.name,
              ...c,
            })),
          }),
        ]
      : []),
  ]);

  const importeFinal = importeTotal ?? antes.importeTotal;
  return { posibleDuplicado: await hayOtroIgual(id, supplierId, importeFinal) };
}

/** Otro comprobante vivo, del mismo proveedor, por el mismo importe. */
async function hayOtroIgual(
  id: string,
  supplierId: string | undefined,
  importeTotal: bigint | null,
): Promise<boolean> {
  if (!supplierId || importeTotal == null) return false;
  const otro = await db.document.findFirst({
    where: { id: { not: id }, supplierId, importeTotal, deletedAt: null },
    select: { id: true },
  });
  return otro !== null;
}
