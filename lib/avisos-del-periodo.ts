import { prisma } from "@/lib/db";
import { notifyOrderChange } from "@/lib/notify";

/**
 * Borrar o recuperar un período mueve a la papelera (o saca de ella) a todos sus
 * eventos de una vez. Para quien prepara, es lo mismo que si se hubiera borrado
 * cada evento: se avisa evento por evento por el mismo camino que el evento
 * suelto, así valen sus reglas (tanda de 2 minutos, lo hecho y deshecho no
 * avisa, los eventos que ya pasaron no suenan). Los eventos borrados por su
 * cuenta no se tocan: estaban en la papelera y siguen ahí. Nunca lanza.
 */
export async function avisarEventosDelPeriodo(
  actor: { id: string; name: string },
  periodId: string,
  de: "VIVO" | "BORRADO",
  a: "VIVO" | "BORRADO",
): Promise<number> {
  try {
    const eventos = await prisma.event.findMany({ where: { periodId, deletedAt: null }, select: { id: true }, orderBy: { date: "asc" } });
    for (const e of eventos) {
      await notifyOrderChange(actor, e.id, { itemName: "Evento", kind: "PAPELERA", before: de, after: a });
    }
    return eventos.length;
  } catch (e) {
    console.error("[avisos] no se pudo avisar el período", periodId, e instanceof Error ? e.message : String(e));
    return 0;
  }
}
