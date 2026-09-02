import { sesionVigente } from "@/lib/auth";
import { canVerImportes } from "@/lib/permissions";
import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { armarDatos } from "@/lib/comprobantes/documento";
import { renderComprobantePdf } from "@/lib/pdf/ComprobantePdf";

// El documento reconstruido, en PDF.
//
// **Se genera en cada pedido, no se guarda.** Si alguien corrige un importe, la
// próxima vez que se abra el documento sale corregido. Un PDF archivado de hace
// tres meses mostraría el dato viejo y nadie se enteraría — es la misma razón
// por la que en este módulo no hay columna de estado.
//
// Cuesta unos cientos de milisegundos y se abre pocas veces por día. Guardarlo
// ahorraría eso y crearía la posibilidad de que la hoja mienta.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  // El permiso se comprueba en cada pedido y no con una URL firmada: una URL
  // firmada se reenvía por WhatsApp y sigue andando después. Acá, quien deja de
  // tener permiso deja de ver.
  const sesion = await sesionVigente();
  if (!sesion || !canVerImportes(sesion.role)) {
    return new Response("No autorizado", { status: 403 });
  }

  const { id } = await ctx.params;
  const doc = await db.document.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { name: true } },
      lines: { orderBy: { orden: "asc" } },
    },
  });
  if (!doc) return new Response("No encontrado", { status: 404 });

  const datos = armarDatos(doc, doc.lines);

  let pdf: Buffer;
  try {
    pdf = await renderComprobantePdf(datos);
  } catch {
    // Que no se pueda dibujar el PDF no puede tumbar la pantalla de pagos: la
    // foto del original sigue estando, que es el documento que vale.
    return new Response("No se pudo generar el documento.", { status: 500 });
  }

  const nombre = [datos.encabezado.proveedor, datos.encabezado.comprobante]
    .filter((t) => t !== "")
    .join(" - ")
    .replace(/[^\w\s.-]/g, "")
    .trim();

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` y no `attachment`: se mira en pantalla, y bajarlo es un paso
      // más para algo que se consulta y se cierra.
      "Content-Disposition": `inline; filename="${nombre || "detalle"}.pdf"`,
      // Nunca se cachea: el documento se arma con los datos de ahora, y un
      // navegador guardando la versión de ayer anularía todo el punto.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
