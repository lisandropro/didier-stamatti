import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

// Las fotos de los comprobantes viven en S3, no en la base.
//
// Usan las mismas credenciales que el respaldo (`BACKUP_S3_*`) pero **otro
// prefijo**: `comprobantes/`. El respaldo borra lo que pasa de 14 días dentro
// de `backups/`, y una foto de una factura no se puede borrar a los 14 días.

const PREFIJO = "comprobantes/";

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

const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Sube una foto y devuelve su clave.
 *
 * Tira si no puede, a propósito: quien llama tiene que enterarse, porque un
 * comprobante sin foto es justo lo que este módulo vino a evitar. Lo que NO
 * puede pasar es que la foto se pierda en silencio.
 */
export async function subirFoto(
  bytes: Buffer,
  mimeType: string,
  hoy: string,
): Promise<{ s3Key: string; sizeBytes: number }> {
  const ext = EXTENSIONES[mimeType];
  if (!ext) throw new Error(`Tipo de archivo no admitido: ${mimeType}`);

  const cliente = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!cliente || !bucket) {
    throw new Error("Almacenamiento no configurado (faltan variables BACKUP_S3_*).");
  }

  // Carpeta por año y mes: hace navegable el bucket a mano el día que haga
  // falta, sin depender de la base.
  const [anio, mes] = hoy.split("-");
  const s3Key = `${PREFIJO}${anio}/${mes}/${randomUUID()}.${ext}`;

  await cliente.send(
    new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: bytes, ContentType: mimeType }),
  );
  return { s3Key, sizeBytes: bytes.byteLength };
}
