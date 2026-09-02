import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sesionVigente } from "@/lib/auth";
import { canVerImportes } from "@/lib/permissions";
import { prismaComprobantes as db } from "@/lib/db-comprobantes";

// Runtime de Node, explícito.
//
// Sin esto Next elige por su cuenta, y esta ruta usa paquetes que solo corren en
// Node. La ruta del PDF de pedidos ya lo declaraba; las de comprobantes no, y el
// síntoma fue opaco: **HTTP 500 con "Jest worker encountered child process
// exceptions"** al compilar, sin ninguna mención al runtime. No lo detectó ni el
// build, ni el typecheck, ni las pruebas — solo abrirla en la app corriendo.
//
// `force-dynamic` porque la respuesta depende de la sesión y de datos que
// cambian: cachearla serviría el documento de otro, o el de ayer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";


// La foto de un comprobante.
//
// Va por una ruta propia y no por una URL firmada del bucket a propósito: una
// URL firmada se puede reenviar por WhatsApp y sigue andando después. Acá el
// permiso se comprueba en cada pedido, y quien deja de tenerlo deja de ver.

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sesion = await sesionVigente();
  if (!sesion || !canVerImportes(sesion.role)) {
    return new Response("No autorizado", { status: 403 });
  }

  const { id } = await ctx.params;
  // Se prefiere la ESCANEADA —recortada y derecha— y se cae a la ORIGINAL si
  // todavía no hay. El orden por `variante` descendente pone ORIGINAL primero,
  // así que se ordena al revés.
  const adjunto = await db.attachment.findFirst({
    where: { documentId: id, document: { deletedAt: null } },
    orderBy: [{ page: "asc" }, { variante: "asc" }],
  });
  if (!adjunto) return new Response("No encontrado", { status: 404 });

  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return new Response("Almacenamiento no configurado", { status: 503 });
  }

  const s3 = new S3Client({
    endpoint,
    region: process.env.BACKUP_S3_REGION || "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });

  const objeto = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: adjunto.s3Key }));
  const cuerpo = await objeto.Body?.transformToByteArray();
  if (!cuerpo) return new Response("No se pudo leer la imagen", { status: 502 });

  return new Response(new Uint8Array(cuerpo), {
    headers: {
      "Content-Type": adjunto.mimeType,
      // Privado: la imagen de una factura no va a una caché compartida.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
