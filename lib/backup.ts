import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { listarTodo, respaldoConfigurado } from "@/lib/s3-respaldo";
import { mensajeDe } from "@/lib/mensaje-de";

const RETENTION_DAYS = 14;
const PREFIX = "backups/";

/**
 * Los conjuntos de respaldo. Es una lista para que el healthcheck y la
 * verificación de restauración recorran exactamente lo que se respalda.
 *
 * Hasta el 19/10/2026 había un segundo conjunto: la base de comprobantes, en
 * `backups-comprobantes/`. Se retiró con el módulo financiero. Sus copias
 * quedan en el bucket SIN podar y archivadas aparte, porque son retención
 * fiscal: nada de esta app las toca.
 */
const CONJUNTOS = [
  {
    etiqueta: "stock",
    prefijo: PREFIX,
    retencionDias: RETENTION_DAYS,
    // La tabla testigo: si la copia abre pero ESTA tabla no existe o vino
    // vacía, no es un respaldo — es un archivo con la extensión correcta.
    // `User` porque siempre tiene filas: sin usuarios nadie entraría a la app.
    tablaTestigo: "User",
  },
] as const;

export { CONJUNTOS };

/** Copia segura de la base SQLite (mientras la app sigue escribiendo), la sube
 *  al almacenamiento de respaldo, y borra las copias más viejas que RETENTION_DAYS. */
/** Respalda UNA base. `retencionDias: null` = no se poda nunca. */
async function respaldarUna(
  cliente: S3Client,
  bucket: string,
  base: { $executeRawUnsafe(sql: string): Promise<unknown> },
  prefijo: string,
  retencionDias: number | null,
): Promise<{ ok: boolean; key?: string; error?: string; pruned?: number }> {
  const tmpPath = join(tmpdir(), `backup-${prefijo.replace(/[^a-z]/g, "")}-${Date.now()}.db`).replace(/\\/g, "/");
  let key: string;
  try {
    // VACUUM INTO es la forma segura de SQLite de copiar la base mientras
    // sigue recibiendo lecturas/escrituras (a diferencia de copiar el archivo a mano).
    await base.$executeRawUnsafe(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);

    const data = await readFile(tmpPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    key = `${prefijo}dev-${stamp}.db`;

    await cliente.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
  } catch (e) {
    return { ok: false, error: mensajeDe(e) };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }

  // La poda va aparte: la copia de hoy YA está arriba. Antes, un fallo al
  // listar o al borrar las viejas hacía que el respaldo entero figurara como
  // fallido, y la revisión avisaba de un respaldo que sí se había hecho.
  if (retencionDias == null) return { ok: true, key, pruned: 0 };
  try {
    return { ok: true, key, pruned: await pruneOld(cliente, bucket, prefijo, retencionDias) };
  } catch (e) {
    console.error(`[backup] la copia ${key} se subió, pero no se pudieron podar las viejas: ${mensajeDe(e)}`);
    return { ok: true, key, pruned: 0 };
  }
}

/**
 * Respalda cada conjunto. Si uno falla, los demás se intentan igual y el error
 * dice cuál fue: un respaldo parcial que se reporta como éxito es peor que uno
 * que falla entero.
 */
export async function runBackup(): Promise<{ ok: boolean; key?: string; error?: string; pruned?: number }> {
  const s3 = respaldoConfigurado();
  if (!s3) return { ok: false, error: "Respaldo no configurado (faltan variables BACKUP_S3_*)." };
  const { cliente, bucket } = s3;

  const bases = [prisma] as unknown as {
    $executeRawUnsafe(sql: string): Promise<unknown>;
  }[];

  const resultados = await Promise.all(
    CONJUNTOS.map((c, i) => respaldarUna(cliente, bucket, bases[i], c.prefijo, c.retencionDias)),
  );

  const fallados = resultados
    .map((r, i) => (r.ok ? null : `${CONJUNTOS[i].etiqueta}: ${r.error}`))
    .filter(Boolean);

  return {
    ok: fallados.length === 0,
    key: resultados.map((r) => r.key).filter(Boolean).join(" · "),
    error: fallados.length > 0 ? fallados.join(" | ") : undefined,
    pruned: resultados.reduce((a, r) => a + (r.pruned ?? 0), 0),
  };
}

/** Borra las copias de más de `retencionDias` días. Lista TODO el prefijo
 *  (`listarTodo` pagina): con un solo llamado se veían como mucho 1000. */
async function pruneOld(
  client: S3Client,
  bucket: string,
  prefijo: string,
  retencionDias: number,
): Promise<number> {
  const objetos = await listarTodo(client, bucket, prefijo);
  const cutoff = Date.now() - retencionDias * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const obj of objetos) {
    if (!obj.modificado) continue;
    if (obj.modificado.getTime() < cutoff) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.key }));
      pruned++;
    }
  }
  return pruned;
}
