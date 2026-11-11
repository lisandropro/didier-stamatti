// La papelera se vacía sola los lunes.
//
// No está escrito como "andá el lunes a las tal hora": la tarea diaria del
// servidor arranca cuando arranca el contenedor, y el contenedor se reinicia
// con cada despliegue, así que un disparo atado al reloj se puede saltear justo
// el lunes. Acá la regla se enuncia sobre los datos — *qué debería estar
// borrado ya* — y el barrido la aplica cada vez que corre. Si el servidor
// estuvo apagado todo el lunes, el martes limpia igual; si corre tres veces el
// mismo día, la segunda y la tercera no encuentran nada.

import { prisma } from "@/lib/db";
import { hoy, instanteDe, lunesMasReciente } from "@/lib/dates";

// El corte es el lunes más reciente a la medianoche: lo que se tiró antes se
// borra definitivamente. Algo tirado un lunes sobrevive hasta el lunes
// siguiente.
//
// Y además, nada se borra con menos de un día en la papelera. Solo con la regla
// del lunes, lo tirado un domingo a las 23:30 se iba para siempre en el primer
// barrido del lunes —que puede ser un arranque a las 00:05—, y el domingo a la
// noche es justo cuando alguien ordena lo del fin de semana y se equivoca. El
// comentario de acá decía "nunca con menos de un día de margen" y no era cierto.

/** Lo mínimo que algo pasa en la papelera antes de poder borrarse para siempre. */
export const MARGEN_MS = 24 * 60 * 60 * 1000;

export type Vaciado = { periodos: number; eventos: number; avisos: number; corte: string };

/** El instante de corte: se borra lo tirado ANTES de esto. Es el lunes más
 *  reciente a la medianoche, o 24 horas atrás, lo que sea más viejo. */
export function corteDeLaPapelera(diaDeHoy: string, ahora: Date): Date {
  const lunes = instanteDe(lunesMasReciente(diaDeHoy), "00:00");
  const margen = new Date(ahora.getTime() - MARGEN_MS);
  return margen < lunes ? margen : lunes;
}

/**
 * Borra para siempre lo que estaba en la papelera desde antes del último lunes
 * (y desde hace más de un día).
 *
 * Se lleva los períodos y los eventos tirados. Lo que colgaba de ellos —el
 * pedido, su historial de cambios, las copias del período— se va con ellos por
 * las cascadas del esquema: es lo que había adentro de lo que se tiró.
 *
 * No toca nada que no esté en la papelera: ni el stock, ni los movimientos, ni
 * los productos, ni los usuarios, ni las sugerencias. Las copias guardadas de
 * un período vivo tampoco: no son basura, son la única forma de deshacer un
 * cambio en un pedido en uso.
 *
 * Todo va en una transacción. Eran cuatro pasos sueltos: si el proceso se
 * cortaba entre borrar los eventos y borrar sus avisos, esos avisos quedaban
 * para siempre llevando a una pantalla que no existe, porque el barrido
 * siguiente ya no encontraba los eventos para saber cuáles eran.
 */
export async function vaciarPapelera(diaDeHoy = hoy(), ahora: Date = new Date()): Promise<Vaciado> {
  const lunes = lunesMasReciente(diaDeHoy);
  const corte = corteDeLaPapelera(diaDeHoy, ahora);

  return prisma.$transaction(async (tx) => {
    // Los eventos que están por desaparecer, para poder limpiar después los
    // avisos que los apuntan. `Notification.eventId` no es una clave foránea, así
    // que nadie los borra por nosotros y quedarían llevando a una pantalla que ya
    // no existe.
    const condenados = await tx.event.findMany({
      where: {
        OR: [
          { deletedAt: { lt: corte } },
          { period: { deletedAt: { lt: corte } } },
        ],
      },
      select: { id: true },
    });

    const periodos = await tx.operationalPeriod.deleteMany({
      where: { deletedAt: { lt: corte } },
    });
    // Los que colgaban de un período recién borrado ya no están: deleteMany
    // devuelve solo los que quedaban sueltos, que es justo lo que se quiere
    // contar aparte.
    const eventos = await tx.event.deleteMany({
      where: { deletedAt: { lt: corte } },
    });

    // Solo los avisos de los que de verdad se fueron. Entre la lista de arriba y
    // los borrados alguien pudo recuperar uno (las escrituras sueltas no esperan
    // a la transacción): ese sigue existiendo y sus avisos también.
    const ids = condenados.map((e) => e.id);
    const siguen = new Set(
      (ids.length === 0 ? [] : await tx.event.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
    );
    const idos = ids.filter((id) => !siguen.has(id));
    const avisos = idos.length
      ? await tx.notification.deleteMany({ where: { eventId: { in: idos } } })
      : { count: 0 };

    return { periodos: periodos.count, eventos: eventos.count, avisos: avisos.count, corte: lunes };
  });
}
