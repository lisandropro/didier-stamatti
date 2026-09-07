import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { prismaComprobantes } from "@/lib/db-comprobantes";

const RETENTION_DAYS = 14;
const PREFIX = "backups/";

/**
 * Los dos conjuntos de respaldo, con retenciones distintas a propósito.
 *
 * La base de comprobantes **no se poda**. La razón entera de separarla del
 * stock fue que un comprobante fiscal hay que conservarlo años y el respaldo
 * del stock se pisa cada catorce días. La separación se había hecho y el
 * respaldo no: la base nueva tenía CERO copias, y el healthcheck decía que
 * todo estaba en orden porque miraba solo el prefijo del stock.
 */
const CONJUNTOS = [
  { etiqueta: "stock", prefijo: PREFIX, retencionDias: RETENTION_DAYS },
  { etiqueta: "comprobantes", prefijo: "backups-comprobantes/", retencionDias: null },
] as const;

export { CONJUNTOS };

function s3() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    endpoint,
    region: process.env.BACKUP_S3_REGION || "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });
}

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
  try {
    // VACUUM INTO es la forma segura de SQLite de copiar la base mientras
    // sigue recibiendo lecturas/escrituras (a diferencia de copiar el archivo a mano).
    await base.$executeRawUnsafe(`VACUUM INTO '${tmpPath}'`);

    const data = await readFile(tmpPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${prefijo}dev-${stamp}.db`;

    await cliente.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));

    const pruned = retencionDias == null ? 0 : await pruneOld(cliente, bucket, prefijo, retencionDias);
    return { ok: true, key, pruned };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Respalda LAS DOS bases. Si una falla, la otra se intenta igual y el error
 * dice cuál fue: un respaldo parcial que se reporta como éxito es peor que uno
 * que falla entero.
 */
export async function runBackup(): Promise<{ ok: boolean; key?: string; error?: string; pruned?: number }> {
  const client = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!client || !bucket) return { ok: false, error: "Respaldo no configurado (faltan variables BACKUP_S3_*)." };

  const bases = [prisma, prismaComprobantes] as unknown as {
    $executeRawUnsafe(sql: string): Promise<unknown>;
  }[];

  const resultados = await Promise.all(
    CONJUNTOS.map((c, i) => respaldarUna(client, bucket, bases[i], c.prefijo, c.retencionDias)),
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

async function pruneOld(
  client: S3Client,
  bucket: string,
  prefijo: string,
  retencionDias: number,
): Promise<number> {
  const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefijo }));
  const cutoff = Date.now() - retencionDias * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const obj of list.Contents ?? []) {
    if (!obj.Key || !obj.LastModified) continue;
    if (obj.LastModified.getTime() < cutoff) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      pruned++;
    }
  }
  return pruned;
}
