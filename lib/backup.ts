import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";

const RETENTION_DAYS = 14;
const PREFIX = "backups/";

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
export async function runBackup(): Promise<{ ok: boolean; key?: string; error?: string; pruned?: number }> {
  const client = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!client || !bucket) return { ok: false, error: "Respaldo no configurado (faltan variables BACKUP_S3_*)." };

  const tmpPath = join(tmpdir(), `backup-${Date.now()}.db`).replace(/\\/g, "/");
  try {
    // VACUUM INTO es la forma segura de SQLite de copiar la base mientras
    // sigue recibiendo lecturas/escrituras (a diferencia de copiar el archivo a mano).
    await prisma.$executeRawUnsafe(`VACUUM INTO '${tmpPath}'`);

    const data = await readFile(tmpPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${PREFIX}dev-${stamp}.db`;

    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));

    const pruned = await pruneOld(client, bucket);
    return { ok: true, key, pruned };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

async function pruneOld(client: S3Client, bucket: string): Promise<number> {
  const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }));
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
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
