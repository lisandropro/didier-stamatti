import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";

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

/** ¿Se hizo un respaldo hace poco? Es la revisión más importante: sin respaldo
 *  fresco, un problema de datos no tendría vuelta atrás. */
async function checkBackup(): Promise<HealthProblem | null> {
  const client = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!client || !bucket) return null; // sin configurar (desarrollo local): no es un problema

  try {
    const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/" }));
    const newest = (list.Contents ?? [])
      .map((o) => o.LastModified?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);

    if (newest === 0) return { code: "backup-none", message: "no hay ningún respaldo guardado" };

    const hours = Math.floor((Date.now() - newest) / (60 * 60 * 1000));
    if (hours > BACKUP_MAX_AGE_HOURS) {
      const dias = Math.floor(hours / 24);
      return { code: "backup-old", message: `el último respaldo es de hace ${dias > 0 ? `${dias} día${dias === 1 ? "" : "s"}` : `${hours} horas`}` };
    }
    return null;
  } catch {
    return { code: "backup-unreachable", message: "no se pudo verificar el respaldo" };
  }
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
  const results = await Promise.all([checkBackup(), checkStockLoaded()]);
  const base = results.filter((r): r is HealthProblem => r !== null);

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
