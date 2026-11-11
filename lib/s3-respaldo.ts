import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

// El almacenamiento de los respaldos, en un solo lugar.
//
// Había tres copias de `s3()` —en el respaldo, en la revisión y en la prueba de
// restauración— y tres listados de un solo llamado. `ListObjectsV2` devuelve
// como mucho 1000 objetos por llamado, en orden de clave; como las claves llevan
// la fecha, la primera página son los MÁS VIEJOS. Con más de mil copias la
// revisión habría dicho "el último respaldo es de hace meses" y la prueba de
// restauración habría probado una copia vieja, sin que nada lo avisara. Hoy no
// se llega ni cerca (14 días de retención), pero el listado completo cuesta lo
// mismo que el incompleto.

/** El cliente, o null si el respaldo no está configurado (desarrollo local). */
export function clienteS3(): S3Client | null {
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

/** Cliente y bucket juntos, o null si falta algo: quien llama no tiene que
 *  acordarse de mirar las dos cosas. */
export function respaldoConfigurado(): { cliente: S3Client; bucket: string } | null {
  const cliente = clienteS3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  return cliente && bucket ? { cliente, bucket } : null;
}

export type ObjetoDeRespaldo = { key: string; modificado: Date | null; bytes: number | null };

/** Lo único que hace falta del cliente para listar. Así la paginación se puede
 *  probar con uno de mentira, sin red. */
export type Listador = {
  send(comando: ListObjectsV2Command): Promise<{
    Contents?: { Key?: string; LastModified?: Date; Size?: number }[];
    IsTruncated?: boolean;
    NextContinuationToken?: string;
  }>;
};

/** Tope de páginas: 200 mil objetos. No es un límite del negocio, es para que
 *  un servicio que conteste siempre "hay más" no deje el barrido dando vueltas. */
const MAX_PAGINAS = 200;

/**
 * TODOS los objetos de un prefijo, siguiendo `ContinuationToken` hasta el final.
 *
 * Si se llega al tope de páginas, lanza: una lista cortada en silencio es
 * exactamente el problema que esto vino a sacar.
 */
export async function listarTodo(cliente: Listador, bucket: string, prefijo: string): Promise<ObjetoDeRespaldo[]> {
  const todos: ObjetoDeRespaldo[] = [];
  let token: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const r = await cliente.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefijo, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      if (o.Key) todos.push({ key: o.Key, modificado: o.LastModified ?? null, bytes: o.Size ?? null });
    }
    if (!r.IsTruncated) return todos;
    // "Hay más" sin decir por dónde seguir: repetir el pedido daría la misma
    // página para siempre.
    if (!r.NextContinuationToken || r.NextContinuationToken === token) {
      throw new Error("el listado del respaldo dice que hay más objetos pero no por dónde seguir");
    }
    token = r.NextContinuationToken;
  }
  throw new Error(`el listado del respaldo no termina después de ${MAX_PAGINAS} páginas`);
}

/** La copia más nueva de una lista, o null si no hay ninguna con fecha. */
export function masNueva(objetos: ObjetoDeRespaldo[]): ObjetoDeRespaldo | null {
  let mejor: ObjetoDeRespaldo | null = null;
  for (const o of objetos) {
    if (!o.modificado) continue;
    if (!mejor || o.modificado.getTime() > mejor.modificado!.getTime()) mejor = o;
  }
  return mejor;
}
