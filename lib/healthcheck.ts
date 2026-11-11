import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
// La misma lista que usa el respaldo. Vigilar y respaldar tienen que mirar los
// mismos conjuntos, o se respalda algo que nadie controla.
import { CONJUNTOS } from "@/lib/backup";
import { verificarRespaldos } from "@/lib/verificar-respaldo";
import { listarTodo, masNueva, respaldoConfigurado } from "@/lib/s3-respaldo";
import { mensajeDe } from "@/lib/mensaje-de";

/** Cada cuántos días se puede repetir un aviso idéntico. Evita que el mismo
 *  problema moleste todos los días: si no cambió nada, se calla. */
const REPEAT_DAYS = 7;
/** Un respaldo se hace por día; se avisa recién pasado este margen. */
const BACKUP_MAX_AGE_HOURS = 30;

/**
 * Un problema de la revision diaria.
 *
 * **`gravedad` decide quien te interrumpe.** Solo las `alta` mandan un push;
 * las demas quedan en /notificaciones, que es donde vive el trabajo pendiente.
 *
 * La razon es concreta: la revision reportaba siete cosas por dia, seis de
 * ellas trabajo que hoy no hay tiempo de hacer. Un aviso que pide horas que no
 * existen se ignora igual que uno falso — y al ignorarse entrena a ignorar
 * TODOS, incluido el dia que falle el respaldo.
 *
 * El campo no es nuevo: `checks.ts` ya lo asignaba hallazgo por hallazgo y solo
 * lo usaba para ordenar. Acá pasa a significar algo.
 */
export type HealthProblem = { code: string; message: string; gravedad: Gravedad; url?: string };

export type Gravedad = "alta" | "media" | "baja";

/**
 * ¿Se hizo un respaldo hace poco? Es la revisión más importante: sin respaldo
 * fresco, un problema de datos no tendría vuelta atrás.
 *
 * Los conjuntos salen de `CONJUNTOS`, la misma lista que usa el respaldo: de
 * nada sirve respaldar una base si no se vigila. El 03/09 pasó exactamente eso
 * —se respaldaban dos bases y se miraba una sola—, y por eso no hay una lista
 * propia acá. Si mañana aparece otra base, se vigila sola.
 */
async function checkBackup(): Promise<HealthProblem[]> {
  const s3 = respaldoConfigurado();
  if (!s3) return []; // sin configurar (desarrollo local): no es un problema

  const problemas: HealthProblem[] = [];

  for (const conjunto of CONJUNTOS) {
    try {
      // Todo el prefijo, no la primera página: con más de mil copias la primera
      // página son las más viejas y la más nueva no estaría entre ellas.
      const newest = masNueva(await listarTodo(s3.cliente, s3.bucket, conjunto.prefijo))?.modificado?.getTime() ?? 0;

      if (newest === 0) {
        problemas.push({
          code: `backup-none-${conjunto.etiqueta}`,
          gravedad: "alta",
          message: `no hay ningún respaldo guardado de ${conjunto.etiqueta}`,
        });
        continue;
      }

      const hours = Math.floor((Date.now() - newest) / (60 * 60 * 1000));
      if (hours > BACKUP_MAX_AGE_HOURS) {
        const dias = Math.floor(hours / 24);
        problemas.push({
          code: `backup-old-${conjunto.etiqueta}`,
          gravedad: "alta",
          message: `el último respaldo de ${conjunto.etiqueta} es de hace ${dias > 0 ? `${dias} día${dias === 1 ? "" : "s"}` : `${hours} horas`}`,
        });
      }
    } catch (e) {
      console.error(`[revision] no se pudo listar el respaldo de ${conjunto.etiqueta}: ${mensajeDe(e)}`);
      problemas.push({
        code: `backup-unreachable-${conjunto.etiqueta}`,
        gravedad: "alta",
        message: `no se pudo verificar el respaldo de ${conjunto.etiqueta}`,
      });
    }
  }

  return problemas;
}

/** Productos que deberían llevar control de stock pero están en cero: para
 *  esos, la app no puede avisar si falta mercadería. */
async function checkStockLoaded(): Promise<HealthProblem | null> {
  // `null` = nunca se contó. Un cero contado NO es un problema: es un dato.
  const sinContar = await prisma.product.count({
    where: { active: true, type: "REUTILIZABLE", stock: null },
  });
  if (sinContar === 0) return null;
  return {
    code: "stock-empty",
    // MEDIA: contar el stock son horas de trabajo, no minutos. Es real y hay
    // que hacerlo, pero interrumpir todos los días por algo que no se puede
    // resolver hoy es cómo se enseña a ignorar los avisos.
    gravedad: "media",
    message: `${sinContar} producto${sinContar === 1 ? "" : "s"} sin contar (hasta contarlos no se puede avisar si faltan)`,
  };
}

/**
 * Junta los hallazgos por código: tres eventos con el mismo problema son un
 * solo renglón. Conserva el link del primero.
 *
 * El grupo se queda con la gravedad (y la url) del primer hallazgo: la gravedad
 * viaja con el hallazgo en vez de aplanarse a una sola para todos los controles.
 *
 * Antes el agrupado descartaba el link y "Para revisar" mostraba todo como
 * texto suelto, sin forma de ir a arreglarlo.
 */
export function agruparHallazgos(
  hallazgos: { code: string; message: string; gravedad: Gravedad; url?: string }[],
): HealthProblem[] {
  const porCodigo = new Map<string, { mensajes: string[]; gravedad: Gravedad; url?: string }>();
  for (const h of hallazgos) {
    const previo = porCodigo.get(h.code);
    if (previo) previo.mensajes.push(h.message);
    else porCodigo.set(h.code, { mensajes: [h.message], gravedad: h.gravedad, url: h.url });
  }
  return [...porCodigo].map(([code, { mensajes, gravedad, url }]) => ({
    code,
    gravedad,
    url,
    message: mensajes.length === 1 ? mensajes[0] : `${mensajes.length} avisos: ${mensajes[0]} (y ${mensajes.length - 1} más)`,
  }));
}

/**
 * Todos los problemas del sistema, no solo los que interrumpen.
 *
 * `verificarRestauracion: false` saltea la bajada del respaldo. Lo usa la
 * pantalla: mostrar el estado no puede costar decenas de megas por visita.
 */
export async function collectProblems(
  opciones: { verificarRestauracion?: boolean } = {},
): Promise<HealthProblem[]> {
  // `checkBackup` devuelve una lista —uno por conjunto de respaldo— y
  // `checkStockLoaded` uno solo o nada. Se aplanan juntos.
  //
  // La verificación de restauración va acá y no adentro de `checkBackup` porque
  // son dos preguntas distintas: una es "¿hay copia reciente?" y la otra
  // "¿esa copia sirve?". La segunda baja decenas de megas, así que si algún día
  // hay que espaciarla, conviene que esté separada.
  //
  // Cada control con su propia red: si uno lanza, los otros igual se informan y
  // el que falló queda como un problema más (`revision-fallida`). Antes un
  // fallo de cualquiera tumbaba el `Promise.all`, la revisión entera devolvía
  // una lista vacía y el log decía "todo en orden".
  const fallidos: HealthProblem[] = [];
  const intentar = async <T>(que: string, control: () => Promise<T>, siFalla: T): Promise<T> => {
    try {
      return await control();
    } catch (e) {
      fallidos.push(problemaDeRevisionFallida(que, e));
      return siFalla;
    }
  };
  const [respaldos, restaurables, stock] = await Promise.all([
    intentar("la antigüedad del respaldo", checkBackup, []),
    // La verificación de restauración BAJA decenas de megas. Va en la revisión
    // diaria y no cuando alguien abre una pantalla: es la diferencia entre
    // costar una vez por día y costar una vez por visita.
    opciones.verificarRestauracion === false ? Promise.resolve([]) : intentar("la restauración del respaldo", verificarRespaldos, []),
    intentar("el stock sin contar", checkStockLoaded, null),
  ]);
  // Todo lo del respaldo es ALTA: son minutos de trabajo y no hacerlos cuesta
  // la base entera. Es la unica familia de problemas que justifica interrumpir.
  const base: HealthProblem[] = [
    ...respaldos,
    ...restaurables.map((r) => ({ ...r, gravedad: "alta" as const })),
    ...(stock ? [stock] : []),
  ];

  // Los controles de datos y de avisos. Van acá y no aparte para heredar lo que
  // esta revisión ya resuelve bien: avisa solo a las administradoras, no repite
  // un aviso idéntico antes de una semana, y un fallo suyo nunca afecta a la app.
  // Se agrupan por código: si tres eventos tienen el mismo problema, es un solo
  // aviso — la revisión diaria no puede convertirse en algo que se ignora.
  //
  // Un control que falla no puede tumbar la revisión entera, pero tampoco pasar
  // callado: queda anotado como un problema.
  const hallazgos = await intentar(
    "los controles de datos",
    async () => {
      const { revisarTodo } = await import("@/lib/checks");
      return agruparHallazgos(await revisarTodo());
    },
    [],
  );
  base.push(...hallazgos);
  return [...base, ...agruparHallazgos(fallidos)];
}

/**
 * Un control de la revisión que no se pudo correr.
 *
 * Es un problema ALTO a propósito: una revisión que no pudo mirar no sabe si el
 * respaldo está bien, y "no sé" contado como "todo en orden" es justo el
 * silencio que la revisión existe para evitar. El código es uno solo
 * (`revision-fallida`), así varios controles caídos son un único aviso y la
 * firma no cambia —ni vuelve a avisar— según cuál falle cada día.
 *
 * Deja el error en el log: el mensaje para la administradora dice qué no se
 * pudo revisar, no el texto técnico.
 */
export function problemaDeRevisionFallida(que: string, e: unknown): HealthProblem {
  console.error(`[revision] no se pudo revisar ${que}: ${mensajeDe(e)}`);
  return { code: "revision-fallida", gravedad: "alta", message: `no se pudo revisar ${que}`, url: "/notificaciones" };
}

/**
 * Qué push corresponde mandar, si es que corresponde alguno.
 *
 * **Solo lo urgente interrumpe.** El resto queda en `/notificaciones`, que es
 * donde vive el trabajo pendiente y donde se mira cuando hay tiempo.
 *
 * Antes iban los siete juntos en una sola frase, y el costo que importa no era
 * el largo: el urgente quedaba enterrado en el medio de la oración y el aviso
 * entero se volvía ignorable. Con lo cual el día que falle el respaldo, ese
 * aviso llega por un canal ya desacreditado.
 *
 * **La firma se arma SOLO con los urgentes**, y ése es el otro arreglo. Antes
 * era el conjunto de TODOS los códigos: cargar un producto sin contar cambiaba
 * la firma y volvía a avisar de todo, y al revés, un respaldo roto que persistía
 * quedaba callado siete días porque el conjunto no había cambiado. Ahora lo
 * pendiente no puede ni disparar ni tapar.
 *
 * Vive separado y es puro para poder probarlo: es una decisión sobre a quién se
 * interrumpe, y ésas se prueban.
 */
export function avisoDe(
  problems: HealthProblem[],
): { message: string; signature: string } | null {
  const urgentes = problems.filter((p) => p.gravedad === "alta");
  if (urgentes.length === 0) return null;
  return {
    message: `Revisión del sistema: ${urgentes.map((p) => p.message).join(" · ")}`,
    // Se agrupa por TIPO y no por el texto: mientras se va resolviendo, el
    // número puede cambiar sin que el aviso se repita todos los días.
    signature: `SISTEMA:${urgentes.map((p) => p.code).sort().join(",")}`,
  };
}

/** Revisión diaria. Sólo avisa a los administradores si hay algo mal, y no
 *  repite un aviso idéntico antes de REPEAT_DAYS. Nunca lanza error.
 *
 *  Tampoco calla: si la revisión misma falla, eso es un problema
 *  (`revision-fallida`) y se informa como cualquier otro. Antes un error acá
 *  adentro devolvía una lista vacía, y quien llama anotaba "todo en orden".
 *
 *  `recolectar` se puede reemplazar para probar qué pasa cuando falla. */
export async function runHealthCheck(
  recolectar: () => Promise<HealthProblem[]> = collectProblems,
): Promise<{ problems: HealthProblem[]; notified: boolean }> {
  let problems: HealthProblem[];
  try {
    problems = await recolectar();
  } catch (e) {
    problems = [problemaDeRevisionFallida("el sistema", e)];
  }
  try {
    if (problems.length === 0) return { problems: [], notified: false };

    const av = avisoDe(problems);
    if (!av) return { problems, notified: false };
    const { message, signature } = av;
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    const cutoff = new Date(Date.now() - REPEAT_DAYS * 24 * 60 * 60 * 1000);

    let notified = false;
    for (const admin of admins) {
      const yaAvisado = await prisma.notification.findFirst({
        where: { recipientId: admin.id, type: signature, createdAt: { gte: cutoff } },
      });
      if (yaAvisado) continue;

      const aviso = await prisma.notification.create({
        // El push sale acá mismo: la fila nace marcada como enviada. Sin esto
        // quedaba para siempre como "pendiente", mintiendo sobre lo que pasó.
        // `linkUrl`: sin él, tocarlo abría "Qué cambió", que es de pedidos.
        data: { recipientId: admin.id, actorName: "Sistema", type: signature, message, pushedAt: new Date(), linkUrl: "/notificaciones" },
      });
      await sendPushToUser(
        admin.id,
        { title: "Didier Stamatti", body: message, url: "/notificaciones", tag: "sistema" },
        { kind: "SISTEMA", notificationId: aviso.id },
      );
      notified = true;
    }
    return { problems, notified };
  } catch (e) {
    // Una revisión fallida nunca debe afectar el funcionamiento de la app. Lo
    // que falló acá es avisar (la base, casi seguro): los problemas se
    // devuelven igual, para que el log del servidor los nombre.
    console.error(`[revision] se encontraron problemas pero no se pudo avisar: ${mensajeDe(e)}`);
    return { problems, notified: false };
  }
}
