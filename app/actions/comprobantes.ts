"use server";

import { revalidatePath } from "next/cache";
import { sesionVigente } from "@/lib/auth";
import { canCapturarComprobantes, canPagar } from "@/lib/permissions";
import { guardarCaptura } from "@/lib/comprobantes/documentos";
import { completarCabecera } from "@/lib/comprobantes/completar";
import { leerComprobante } from "@/lib/comprobantes/leer-documento";
import {
  porProveedor,
  queVence,
  marcarPagados,
  ponerVencimiento,
  bandejas,
  posiblesDuplicados,
  incompletos,
} from "@/lib/comprobantes/pagos";
import { subirFoto } from "@/lib/comprobantes/almacenamiento";
import { tipoReal } from "@/lib/comprobantes/archivos";
import { esParaNosotros } from "@/lib/comprobantes/qr";
import { aTextoPlano } from "@/lib/money";
import {
  puedeResponderImportes,
  aFilaDeuda,
  cabeceraDeLaCaptura,
  destinoValido,
  kindDelComprobante,
  paginaValida,
  fechaDePago,
  MAX_FOTOS,
} from "@/lib/comprobantes/politica";

// El borde del módulo. Acá se comprueban los permisos —del lado del servidor,
// que es el único que cuenta— y se convierten los BigInt a texto antes de que
// crucen al navegador.
//
// Las decisiones viven en `lib/comprobantes/politica.ts`: un archivo
// `"use server"` solo puede exportar funciones asíncronas, y además esas reglas
// merecen probarse sin levantar Next.

const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * Guarda una captura hecha desde el celular.
 *
 * Devuelve el id y avisos, nada más: quien captura tiene rol RECEPCION y no
 * puede recibir importes, ni siquiera el de la factura que acaba de fotografiar.
 */
export async function capturarComprobante(fd: FormData) {
  const sesion = await sesionVigente();
  if (!sesion) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canCapturarComprobantes(sesion.role)) {
    return { ok: false, error: "No tenés permiso para cargar comprobantes." };
  }

  const clientKey = String(fd.get("clientKey") ?? "");
  if (!clientKey) return { ok: false, error: "Falta la llave de la captura." };

  const archivos = fd.getAll("fotos").filter((f): f is File => f instanceof File);
  if (archivos.length === 0) return { ok: false, error: "No llegó ninguna foto." };
  if (archivos.length > MAX_FOTOS) {
    return { ok: false, error: `Son demasiadas fotos en una captura (máximo ${MAX_FOTOS}).` };
  }

  for (const f of archivos) {
    // Este primer filtro es por cortesia: rechaza rapido y con un mensaje claro
    // antes de leer 8 MB a memoria. El que MANDA es `tipoReal`, mas abajo.
    if (!TIPOS_OK.has(f.type)) return { ok: false, error: `Tipo de archivo no admitido: ${f.type}` };
    if (f.size > MAX_BYTES) return { ok: false, error: "La foto es demasiado grande." };
  }

  // Los QR vienen leídos del teléfono —se decodifican con la cámara apuntando,
  // antes de disparar— pero se vuelven a parsear acá: un navegador puede mandar
  // cualquier cosa.
  const cabecera = cabeceraDeLaCaptura(fd.getAll("qr").map(String));

  const hoy = new Date().toISOString().slice(0, 10);
  const adjuntos = [];
  for (const [i, f] of archivos.entries()) {
    const bytes = Buffer.from(await f.arrayBuffer());
    // El tipo lo decide el archivo, no el formulario. `f.type` sale de la
    // extension y lo puede poner cualquiera; lo que se guarda en el bucket
    // —y lo que despues se sirve como Content-Type— tiene que salir de los
    // bytes.
    const tipo = tipoReal(bytes);
    if (!tipo) {
      return { ok: false, error: `El archivo "${f.name}" no es una foto ni un PDF.` };
    }
    const { s3Key, sizeBytes } = await subirFoto(bytes, tipo, hoy);
    adjuntos.push({
      s3Key,
      mimeType: tipo,
      sizeBytes,
      variante: (String(fd.getAll("variante")[i] ?? "ORIGINAL") === "ESCANEADA"
        ? "ESCANEADA"
        : "ORIGINAL") as "ORIGINAL" | "ESCANEADA",
      pagina: paginaValida(fd.getAll("pagina")[i]),
    });
  }

  const destino = destinoValido(String(fd.get("destino") ?? ""));
  const conformeCrudo = fd.get("conforme");

  let r;
  try {
    r = await guardarCaptura({
      clientKey,
      kind: kindDelComprobante(cabecera.tipoCbte, String(fd.get("kind") ?? "")),
      cabecera,
      destino,
      destinoNota: destino === "OTRO" ? String(fd.get("destinoNota") ?? "") || undefined : undefined,
      // Sin respuesta queda NULL, que significa "nadie revisó" — distinto de
      // "revisó y faltaba algo".
      conforme: conformeCrudo == null ? undefined : conformeCrudo === "si",
      actor: { id: sesion.id, name: sesion.name },
      adjuntos,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  revalidatePath("/recepcion");
  revalidatePath("/pagos");

  return {
    ok: true,
    documentId: r.documentId,
    aviso: r.yaExistia
      ? "Este comprobante ya estaba cargado."
      : r.anulado
        ? "Atención: este comprobante figura anulado. La foto quedó guardada igual."
        : r.fusionado
          ? "Esta factura ya la había cargado otra persona. Se agregó tu foto."
          : esParaNosotros(cabecera) === false
            ? "Atención: esta factura no está a nombre de la empresa."
            : undefined,
  };
}

export async function deudaPorProveedor() {
  const sesion = await sesionVigente();
  if (!puedeResponderImportes(sesion)) {
    // Se corta ANTES de consultar la base: el importe no se lee siquiera.
    return { ok: false, error: "No tenés permiso para ver importes." };
  }
  return { ok: true, filas: (await porProveedor()).map(aFilaDeuda) };
}

export async function vencimientosEntre(desde: string, hasta: string) {
  const sesion = await sesionVigente();
  if (!puedeResponderImportes(sesion)) {
    return { ok: false, error: "No tenés permiso para ver importes." };
  }
  const docs = await queVence(desde, hasta);
  return {
    ok: true,
    filas: docs.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      kind: d.kind,
      vencimiento: d.vencimiento,
      total: d.importeTotal == null ? null : aTextoPlano(d.importeTotal),
    })),
  };
}

/**
 * Marca comprobantes como pagados.
 *
 * `dia` es opcional y va en "AAAA-MM-DD": a veces se transfiere primero y se
 * registra al otro día, y poner la fecha de hoy en un pago de ayer ensucia el
 * único dato que después dice cuándo salió la plata.
 */
/**
 * El resultado de marcar pagos.
 *
 * `ok` es `true`/`false` literal y no `boolean`: con `boolean` las dos ramas de
 * la union son indistinguibles para el compilador, y la pantalla no puede leer
 * `r.marcados` aunque haya comprobado `r.ok` antes. Escribir el tipo asi es lo
 * que obliga a mirar el error antes de tocar los numeros.
 */
export type ResultadoDePago =
  | { ok: false; error: string }
  | { ok: true; marcados: number; yaEstaban: number; noSePagan: number; noEncontrados: number };

export async function pagar(ids: string[], dia?: string): Promise<ResultadoDePago> {
  const sesion = await sesionVigente();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para marcar pagos." };
  }
  const cuando = fechaDePago(dia, new Date());
  if (!cuando) return { ok: false, error: "Esa fecha no existe. Revisá el día." };

  const r = await marcarPagados(ids, cuando, { id: sesion.id, name: sesion.name });
  revalidatePath("/pagos");
  return { ok: true, ...r };
}

export async function cargarVencimiento(id: string, vencimiento: string) {
  const sesion = await sesionVigente();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para cargar vencimientos." };
  }
  try {
    await ponerVencimiento(id, vencimiento, { id: sesion.id, name: sesion.name });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/pagos");
  return { ok: true };
}

/** Lo que falta resolver. Lleva importes en la respuesta, así que pide el mismo
 *  permiso que la deuda. */
export async function pendientes() {
  const sesion = await sesionVigente();
  if (!puedeResponderImportes(sesion)) {
    return { ok: false, error: "No tenés permiso para ver los pendientes." };
  }
  const [b, duplicados, faltantes] = await Promise.all([
    bandejas(),
    posiblesDuplicados(),
    incompletos(),
  ]);
  return {
    ok: true,
    bandejas: b,
    duplicados: duplicados.map((d) => ({
      supplierId: d.supplierId,
      nombre: d.nombre,
      importe: aTextoPlano(d.importe),
      documentIds: d.documentIds,
    })),
    // Las filas de verdad, no solo el contador: una bandeja que no se puede
    // abrir dice que hay trabajo pendiente y no deja hacerlo.
    incompletos: faltantes.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      kind: f.kind,
      falta: f.falta,
    })),
  };
}

export type ResultadoCompletado =
  | { ok: false; error: string }
  | { ok: true; posibleDuplicado: boolean };

/**
 * Completar a mano lo que no vino leído.
 *
 * Pide `canPagar` y no `canCapturarComprobantes` porque acá se tipea un
 * IMPORTE, y quien recibe la mercadería no maneja importes. El proveedor y la
 * fecha los podría cargar cualquiera; el importe no, y partir la pantalla en dos
 * por eso sería peor para todos.
 */
export async function completarAMano(id: string, fd: FormData): Promise<ResultadoCompletado> {
  const sesion = await sesionVigente();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para completar comprobantes." };
  }
  const texto = (k: string) => String(fd.get(k) ?? "").trim() || undefined;

  let r;
  try {
    r = await completarCabecera(
      id,
      {
        nombreProveedor: texto("nombreProveedor"),
        importeTexto: texto("importe"),
        fechaEmision: texto("fechaEmision"),
        vencimiento: texto("vencimiento"),
      },
      { id: sesion.id, name: sesion.name },
    );
  } catch (e) {
    // Los mensajes de `completarCabecera` estan escritos para leerse en
    // pantalla —dicen que pasa y que hacer—, asi que se pasan tal cual.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  revalidatePath("/pagos");
  revalidatePath("/recepcion");
  return { ok: true, posibleDuplicado: r.posibleDuplicado };
}

export type CampoLeido = string | undefined;

export type ResultadoLectura =
  | { ok: false; error: string }
  | {
      ok: true;
      campos: {
        nombreProveedor: CampoLeido;
        cuitEmisor: CampoLeido;
        fechaEmision: CampoLeido;
        vencimiento: CampoLeido;
        condicionPago: CampoLeido;
        // Los importes cruzan como TEXTO: BigInt no serializa a JSON.
        subtotal: CampoLeido;
        iva: CampoLeido;
        percepciones: CampoLeido;
        total: CampoLeido;
      };
      controles: {
        cierraLaCuenta: boolean | null;
        cierranLosRenglones: boolean | null;
        cuitValido: boolean | null;
      };
      renglones: number;
    };

/**
 * Lee la foto y PROPONE los campos. No escribe nada en la base.
 *
 * Lo que devuelve va al formulario para que una persona lo confirme. Guardar
 * sigue siendo `completarAMano`, que es la unica via de escritura y la que deja
 * el rastro en `DocumentChange`.
 *
 * Pide `canPagar` y no `canCapturarComprobantes`: esto devuelve importes.
 */
export async function leerComprobanteConIA(documentId: string): Promise<ResultadoLectura> {
  const sesion = await sesionVigente();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para leer comprobantes." };
  }

  let lectura;
  try {
    lectura = await leerComprobante(documentId);
  } catch (e) {
    // Una lectura fallida NO puede impedir cargar el comprobante: se avisa y la
    // pantalla queda como una carga a mano comun.
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer la foto." };
  }

  const { campos, controles } = lectura;
  const plata = (v: bigint | undefined) => (v == null ? undefined : aTextoPlano(v));

  return {
    ok: true,
    campos: {
      nombreProveedor: campos.nombreProveedor,
      cuitEmisor: campos.cuitEmisor,
      fechaEmision: campos.fechaEmision,
      vencimiento: campos.vencimiento,
      condicionPago: campos.condicionPago,
      subtotal: plata(campos.subtotal),
      iva: plata(campos.iva),
      percepciones: plata(campos.percepciones),
      total: plata(campos.total),
    },
    controles,
    renglones: campos.renglones?.length ?? 0,
  };
}
