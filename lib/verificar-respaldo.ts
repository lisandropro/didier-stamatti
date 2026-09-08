import Database from "better-sqlite3";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONJUNTOS } from "@/lib/backup";

// Comprobar que el respaldo se puede restaurar.
//
// **Por qué existe.** Había copias diarias de las dos bases y vigilancia de que
// fueran recientes. Al preguntar si alguna se había restaurado alguna vez, la
// respuesta fue "no sabría decirte" — que en la práctica es que no.
//
// Un archivo que nadie abrió nunca no es un respaldo: es un archivo con la
// extensión correcta. Los modos en que un respaldo se rompe callado son
// concretos y ninguno lo detecta mirar la fecha:
//
//   - la subida se corta a la mitad y queda un archivo truncado
//   - `VACUUM INTO` corre sobre una base que ya estaba corrupta
//   - se respalda una base recién creada y vacía, y pesa poco pero existe
//
// Los tres pasan el control de antigüedad. Ninguno pasa éste.
//
// **Se verifica la copia MÁS NUEVA**, que es la que se restauraría de verdad.
// Y se hace sola, todos los días, dentro de la revisión: la alternativa era un
// script que alguien tuviera que acordarse de correr, y acordarse es
// exactamente lo que no hay tiempo de hacer acá.

/** Lo mismo que un `HealthProblem`. Se declara acá para no importar desde
 *  `healthcheck`, que ya importa este archivo. */
type Problema = { code: string; message: string };

/** Cuánto puede tardar la bajada antes de darla por perdida. La base del stock
 *  ronda los 55 MB; un minuto es holgado y evita colgar la revisión diaria. */
const TIMEOUT_MS = 60_000;

/**
 * Abre un archivo SQLite y dice si es un respaldo de verdad.
 *
 * Vive separado de la bajada para poder probarlo: se le pueden dar archivos
 * rotos a propósito —truncados, vacíos, que no son SQLite— y comprobar que los
 * rechaza. Probar que la función "corre sin error" no prueba nada; lo que hay
 * que probar es que **detecta lo que está mal**.
 */
export function revisarArchivo(ruta: string, tablaTestigo: string): Problema | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(ruta, { readonly: true, fileMustExist: true });

    // `integrity_check` recorre las páginas y agarra el archivo truncado o con
    // páginas rotas, que es el modo de falla más probable de una subida.
    const integridad = db.pragma("integrity_check", { simple: true });
    if (integridad !== "ok") {
      return { code: "corrupta", message: `la base no pasa el control de integridad (${integridad})` };
    }

    const existe = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tablaTestigo);
    if (!existe) {
      return { code: "sin-tabla", message: `abre, pero no tiene la tabla ${tablaTestigo}` };
    }

    // Una base vacía pasa `integrity_check` sin quejarse. Contar es lo único que
    // distingue un respaldo de un archivo bien formado y sin nada adentro.
    const fila = db.prepare(`SELECT COUNT(*) AS n FROM "${tablaTestigo}"`).get() as { n: number };
    if (!fila || fila.n === 0) {
      return { code: "vacia", message: `abre, pero ${tablaTestigo} no tiene ninguna fila` };
    }

    return null;
  } catch (e) {
    return { code: "no-abre", message: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      db?.close();
    } catch {
      /* ya estaba cerrada o nunca abrió */
    }
  }
}

function s3(): S3Client | null {
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
 * Baja la copia más nueva de cada conjunto y comprueba que se pueda restaurar.
 *
 * Devuelve un problema por conjunto que falle. Un fallo bajando **también es un
 * problema**: si no se puede bajar el respaldo hoy, tampoco se va a poder el
 * día que haga falta.
 */
export async function verificarRespaldos(): Promise<Problema[]> {
  const client = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!client || !bucket) return []; // sin configurar (desarrollo local): no es un problema

  const problemas: Problema[] = [];

  for (const conjunto of CONJUNTOS) {
    const tmp = join(tmpdir(), `verificar-${conjunto.etiqueta}-${Date.now()}.db`).replace(/\\/g, "/");
    try {
      const lista = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: conjunto.prefijo }),
      );
      const masNueva = (lista.Contents ?? [])
        .filter((o) => o.Key)
        .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))[0];

      // Que no haya ninguna ya lo reporta el control de antigüedad. Acá se calla
      // para no decir dos veces lo mismo con palabras distintas.
      if (!masNueva?.Key) continue;

      const obj = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: masNueva.Key }),
        { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      const bytes = await obj.Body?.transformToByteArray();
      if (!bytes || bytes.length === 0) {
        problemas.push({
          code: `restauracion-fallida-${conjunto.etiqueta}`,
          message: `el último respaldo de ${conjunto.etiqueta} se bajó vacío`,
        });
        continue;
      }

      await writeFile(tmp, bytes);
      const malo = revisarArchivo(tmp, conjunto.tablaTestigo);
      if (malo) {
        problemas.push({
          code: `restauracion-fallida-${conjunto.etiqueta}`,
          message: `el último respaldo de ${conjunto.etiqueta} no se puede restaurar: ${malo.message}`,
        });
      }
    } catch (e) {
      problemas.push({
        code: `restauracion-sin-probar-${conjunto.etiqueta}`,
        message: `no se pudo probar el respaldo de ${conjunto.etiqueta}: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      // El archivo temporal se borra pase lo que pase: son decenas de megas y
      // esto corre todos los días.
      await unlink(tmp).catch(() => {});
    }
  }

  return problemas;
}
