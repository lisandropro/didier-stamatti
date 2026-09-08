import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
// La misma lista que usa el respaldo. Vigilar y respaldar tienen que mirar los
// mismos conjuntos, o se respalda algo que nadie controla.
import { CONJUNTOS } from "@/lib/backup";
import { verificarRespaldos } from "@/lib/verificar-respaldo";

/** Cada cuántos días se puede repetir un aviso idéntico. Evita que el mismo
 *  problema moleste todos los días: si no cambió nada, se calla. */
const REPEAT_DAYS = 7;
/** Un respaldo se hace por día; se avisa recién pasado este margen. */
const BACKUP_MAX_AGE_HOURS = 30;

export type HealthProblem = { code: string; message: string };

function s3() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    endpoint,
    region: process.env.BACKUP_S3_REGION || "auto",
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * ¿Se hizo un respaldo hace poco? Es la revisión más importante: sin respaldo
 * fresco, un problema de datos no tendría vuelta atrás.
 *
 * **Se revisan LOS DOS conjuntos, y esa es la corrección.** Antes miraba solo
 * `backups/`, el prefijo del stock. Los comprobantes se respaldan aparte en
 * `backups-comprobantes/` —con retención distinta, porque una factura hay que
 * guardarla años— y no los miraba nadie: si ese respaldo empezaba a fallar, la
 * revisión seguía diciendo que todo estaba en orden.
 *
 * Es el mismo error que ya se había encontrado y arreglado en `runBackup` el
 * 03/09. El arreglo no había llegado hasta acá, que es donde importa: de nada
 * sirve respaldar las dos bases si solo se vigila una.
 *
 * Los conjuntos salen de `CONJUNTOS`, que es la lista que usa el respaldo. Si
 * mañana aparece una tercera base, se vigila sola.
 */
async function checkBackup(): Promise<HealthProblem[]> {
  const client = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!client || !bucket) return []; // sin configurar (desarrollo local): no es un problema

  const problemas: HealthProblem[] = [];

  for (const conjunto of CONJUNTOS) {
    try {
      const list = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: conjunto.prefijo }),
      );
      const newest = (list.Contents ?? [])
        .map((o) => o.LastModified?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);

      if (newest === 0) {
        problemas.push({
          code: `backup-none-${conjunto.etiqueta}`,
          message: `no hay ningún respaldo guardado de ${conjunto.etiqueta}`,
        });
        continue;
      }

      const hours = Math.floor((Date.now() - newest) / (60 * 60 * 1000));
      if (hours > BACKUP_MAX_AGE_HOURS) {
        const dias = Math.floor(hours / 24);
        problemas.push({
          code: `backup-old-${conjunto.etiqueta}`,
          message: `el último respaldo de ${conjunto.etiqueta} es de hace ${dias > 0 ? `${dias} día${dias === 1 ? "" : "s"}` : `${hours} horas`}`,
        });
      }
    } catch {
      problemas.push({
        code: `backup-unreachable-${conjunto.etiqueta}`,
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
    message: `${sinContar} producto${sinContar === 1 ? "" : "s"} sin contar (hasta contarlos no se puede avisar si faltan)`,
  };
}

export async function collectProblems(): Promise<HealthProblem[]> {
  // `checkBackup` devuelve una lista —uno por conjunto de respaldo— y
  // `checkStockLoaded` uno solo o nada. Se aplanan juntos.
  //
  // La verificación de restauración va acá y no adentro de `checkBackup` porque
  // son dos preguntas distintas: una es "¿hay copia reciente?" y la otra
  // "¿esa copia sirve?". La segunda baja decenas de megas, así que si algún día
  // hay que espaciarla, conviene que esté separada.
  const [respaldos, restaurables, stock] = await Promise.all([
    checkBackup(),
    verificarRespaldos(),
    checkStockLoaded(),
  ]);
  const base = [...respaldos, ...restaurables, ...(stock ? [stock] : [])];

  // Los controles de datos y de avisos. Van acá y no aparte para heredar lo que
  // esta revisión ya resuelve bien: avisa solo a las administradoras, no repite
  // un aviso idéntico antes de una semana, y un fallo suyo nunca afecta a la app.
  // Se agrupan por código: si tres eventos tienen el mismo problema, es un solo
  // aviso — la revisión diaria no puede convertirse en algo que se ignora.
  try {
    const { revisarTodo } = await import("@/lib/checks");
    const hallazgos = await revisarTodo();
    const porCodigo = new Map<string, string[]>();
    for (const h of hallazgos) {
      if (!porCodigo.has(h.code)) porCodigo.set(h.code, []);
      porCodigo.get(h.code)!.push(h.message);
    }
    for (const [code, mensajes] of porCodigo) {
      base.push({
        code,
        message: mensajes.length === 1 ? mensajes[0] : `${mensajes.length} avisos: ${mensajes[0]} (y ${mensajes.length - 1} más)`,
      });
    }
  } catch {
    // Un control que falla no puede tumbar la revisión entera.
  }
  return base;
}

/** Revisión diaria. Sólo avisa a los administradores si hay algo mal, y no
 *  repite un aviso idéntico antes de REPEAT_DAYS. Nunca lanza error. */
export async function runHealthCheck(): Promise<{ problems: HealthProblem[]; notified: boolean }> {
  try {
    const problems = await collectProblems();
    if (problems.length === 0) return { problems: [], notified: false };

    const message = `Revisión del sistema: ${problems.map((p) => p.message).join(" · ")}`;
    // Se agrupa por TIPO de problema, no por el texto: así, mientras va cargando
    // stock, el número puede cambiar sin que el aviso se repita todos los días.
    // Un problema nuevo sí cambia la firma y vuelve a avisar.
    const signature = `SISTEMA:${problems.map((p) => p.code).sort().join(",")}`;
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    const cutoff = new Date(Date.now() - REPEAT_DAYS * 24 * 60 * 60 * 1000);

    let notified = false;
    for (const admin of admins) {
      const yaAvisado = await prisma.notification.findFirst({
        where: { recipientId: admin.id, type: signature, createdAt: { gte: cutoff } },
      });
      if (yaAvisado) continue;

      await prisma.notification.create({
        // El push sale acá mismo: la fila nace marcada como enviada. Sin esto
        // quedaba para siempre como "pendiente", mintiendo sobre lo que pasó.
        data: { recipientId: admin.id, actorName: "Sistema", type: signature, message, pushedAt: new Date() },
      });
      await sendPushToUser(admin.id, {
        title: "Didier Stamatti",
        body: message,
        url: "/notificaciones",
        tag: "sistema",
      });
      notified = true;
    }
    return { problems, notified };
  } catch {
    // Una revisión fallida nunca debe afectar el funcionamiento de la app.
    return { problems: [], notified: false };
  }
}
