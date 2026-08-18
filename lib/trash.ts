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
// siguiente, así que nunca se pierde nada con menos de un día de margen.

export type Vaciado = { periodos: number; eventos: number; avisos: number; corte: string };

/**
 * Borra para siempre lo que estaba en la papelera desde antes del último lunes.
 *
 * Se lleva los períodos y los eventos tirados. Lo que colgaba de ellos —el
 * pedido, su historial de cambios, las copias del período— se va con ellos por
 * las cascadas del esquema: es lo que había adentro de lo que se tiró.
 *
 * No toca nada que no esté en la papelera: ni el stock, ni los movimientos, ni
 * los productos, ni los usuarios, ni las sugerencias. Las copias guardadas de
 * un período vivo tampoco: no son basura, son la única forma de deshacer un
 * cambio en un pedido en uso.
 */
export async function vaciarPapelera(diaDeHoy = hoy()): Promise<Vaciado> {
  const lunes = lunesMasReciente(diaDeHoy);
  const corte = instanteDe(lunes, "00:00");

  // Los eventos que están por desaparecer, para poder limpiar después los
  // avisos que los apuntan. `Notification.eventId` no es una clave foránea, así
  // que nadie los borra por nosotros y quedarían llevando a una pantalla que ya
  // no existe.
  const condenados = await prisma.event.findMany({
    where: {
      OR: [
        { deletedAt: { lt: corte } },
        { period: { deletedAt: { lt: corte } } },
      ],
    },
    select: { id: true },
  });

  const periodos = await prisma.operationalPeriod.deleteMany({
    where: { deletedAt: { lt: corte } },
  });
  // Los que colgaban de un período recién borrado ya no están: deleteMany
  // devuelve solo los que quedaban sueltos, que es justo lo que se quiere
  // contar aparte.
  const eventos = await prisma.event.deleteMany({
    where: { deletedAt: { lt: corte } },
  });

  const ids = condenados.map((e) => e.id);
  const avisos = ids.length
    ? await prisma.notification.deleteMany({ where: { eventId: { in: ids } } })
    : { count: 0 };

  return { periodos: periodos.count, eventos: eventos.count, avisos: avisos.count, corte: lunes };
}
