"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prismaComprobantes as comprobantesDb } from "@/lib/db-comprobantes";
import { leerCsvDeArca } from "@/lib/comprobantes/arca-csv";
import { importar as importarArcaFilas } from "@/lib/comprobantes/arca";
import { sesionVigente } from "@/lib/auth";
import { canCapturarComprobantes, canPagar, canAdministrarComprobantes } from "@/lib/permissions";
import { guardarCaptura } from "@/lib/comprobantes/documentos";
import { completarCabecera } from "@/lib/comprobantes/completar";
import { leerComprobante } from "@/lib/comprobantes/leer-documento";
import { guardarDetalleLeido } from "@/lib/comprobantes/guardar-lectura";
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
import { enderezarEnServidor } from "@/lib/comprobantes/enderezar-servidor";
import { quienRecibe } from "@/lib/comprobantes/qr";
import {
  activas as entidadesActivas,
  todas as todasLasEntidades,
  crear as crearEnt,
  editar as editarEnt,
  sinEntidad as sinEntidadCount,
  huerfanos as sinEntidadDocs,
  asignar as asignarEnt,
} from "@/lib/comprobantes/entidades";
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
    const pagina = paginaValida(fd.getAll("pagina")[i]);

    // La ORIGINAL va siempre. Es el seguro: lo que se archiva es la escaneada,
    // pero si el recorte se comió un borde, el papel de verdad sigue estando.
    const { s3Key, sizeBytes } = await subirFoto(bytes, tipo, hoy);
    adjuntos.push({ s3Key, mimeType: tipo, sizeBytes, variante: "ORIGINAL" as const, pagina });

    // **El enderezado se hace ACÁ y no en el teléfono.**
    //
    // Medido a la resolución real de captura, en el teléfono tardaba 1,2 s de
    // media y 1,8 s el peor caso: varios segundos de pantalla congelada por
    // foto. Con eso, encadenar cinco comprobantes de un reparto es
    // insoportable — y encadenarlos es justamente lo que hace falta.
    //
    // El teléfono manda la foto y las cuatro esquinas que ya venía siguiendo en
    // el visor; el trabajo pesado pasa a un lugar donde nadie lo mira suceder.
    if (tipo !== "application/pdf") {
      // Si no se pudo enderezar —sin esquinas, esquinas imposibles, imagen
      // ilegible— queda solo la original y el comprobante entra igual.
      const derecha = await enderezarEnServidor(bytes, fd.getAll("esquinas")[i]);
      if (derecha) {
        const sub = await subirFoto(derecha.jpeg, "image/jpeg", hoy);
        adjuntos.push({
          s3Key: sub.s3Key,
          mimeType: "image/jpeg",
          sizeBytes: sub.sizeBytes,
          variante: "ESCANEADA" as const,
          pagina,
        });
      }
    }
  }

  const destino = destinoValido(String(fd.get("destino") ?? ""));
  const conformeCrudo = fd.get("conforme");

  // A nombre de quién está.
  //
  // El QR trae `nroDocRec`, que es el CUIT de quien recibe, así que la entidad
  // se resuelve SOLA en las facturas que lo traen. Cuando no hay QR —12 de 18
  // en la medición sobre fotos reales— vale lo que eligió el teléfono.
  //
  // Si no hay ni una cosa ni la otra queda en NULL, que significa "no se sabe
  // de quién es". Es a propósito: asumir la de siempre es cómo una factura de
  // la UTE termina sumando en la deuda de Soluciones sin que nadie se entere.
  const nuestras = await entidadesActivas();
  const quien = quienRecibe(cabecera, nuestras);
  const elegida = String(fd.get("entidadId") ?? "") || undefined;
  const entidadId =
    quien.estado === "una-nuestra"
      ? quien.entidadId
      : nuestras.some((e) => e.id === elegida)
        ? elegida
        : undefined;

  let r;
  try {
    r = await guardarCaptura({
      clientKey,
      kind: kindDelComprobante(cabecera.tipoCbte, String(fd.get("kind") ?? "")),
      cabecera,
      entidadId,
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
          : quien.estado === "ajena"
            ? "Atención: esta factura no está a nombre de ninguna de tus entidades."
            : entidadId === undefined
              ? "Quedó sin entidad asignada. Ponésela desde la lista de pagos."
              : undefined,
  };
}

// `entidadId` sin pasar = todas. `null` = solo las que quedaron sin entidad,
// que es una pregunta distinta y es la que destraba esa bandeja.
export async function deudaPorProveedor(entidadId?: string | null) {
  const sesion = await sesionVigente();
  if (!puedeResponderImportes(sesion)) {
    // Se corta ANTES de consultar la base: el importe no se lee siquiera.
    return { ok: false, error: "No tenés permiso para ver importes." };
  }
  return { ok: true, filas: (await porProveedor(entidadId)).map(aFilaDeuda) };
}

export async function vencimientosEntre(desde: string, hasta: string, entidadId?: string | null) {
  const sesion = await sesionVigente();
  if (!puedeResponderImportes(sesion)) {
    return { ok: false, error: "No tenés permiso para ver importes." };
  }
  const docs = await queVence(desde, hasta, entidadId);
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

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------
//
// A nombre de quién está cada factura. Administrarlas es de ADMIN: dar de alta
// una entidad con el CUIT mal escrito no rompe nada visible — hace que las
// facturas de esa entidad nunca la encuentren y queden sueltas para siempre.

export async function listarEntidades() {
  const sesion = await sesionVigente();
  if (!sesion || !canAdministrarComprobantes(sesion.role)) {
    return { ok: false as const, error: "No tenés permiso para ver las entidades." };
  }
  return { ok: true as const, filas: await todasLasEntidades() };
}

export async function crearEntidad(nombre: string, cuit: string) {
  const sesion = await sesionVigente();
  if (!sesion || !canAdministrarComprobantes(sesion.role)) {
    return { ok: false as const, error: "No tenés permiso para dar de alta entidades." };
  }
  const r = await crearEnt(String(nombre ?? ""), String(cuit ?? ""));
  if (r.ok) {
    revalidatePath("/entidades");
    revalidatePath("/pagos");
  }
  return r;
}

export async function editarEntidad(
  id: string,
  cambios: { nombre?: string; cuit?: string; activa?: boolean },
) {
  const sesion = await sesionVigente();
  if (!sesion || !canAdministrarComprobantes(sesion.role)) {
    return { ok: false as const, error: "No tenés permiso para editar entidades." };
  }
  const r = await editarEnt(String(id ?? ""), cambios);
  if (r.ok) {
    revalidatePath("/entidades");
    revalidatePath("/pagos");
  }
  return r;
}

/**
 * Le pone entidad a un comprobante huérfano.
 *
 * Pide `canPagar` y no `canAdministrarComprobantes`: quien decide qué se paga es
 * quien sabe de qué entidad es la factura, y es quien está mirando la bandeja.
 * Pedir ADMIN acá dejaría el trabajo visible para alguien que no puede hacerlo,
 * que es justo el problema que esta pantalla viene a cerrar.
 */
export async function asignarEntidad(documentId: string, entidadId: string) {
  const sesion = await sesionVigente();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false as const, error: "No tenés permiso para cambiar la entidad." };
  }
  const r = await asignarEnt(String(documentId ?? ""), String(entidadId ?? ""), {
    id: sesion.id,
    name: sesion.name,
  });
  if (r.ok) revalidatePath("/pagos");
  return r;
}

// ---------------------------------------------------------------------------
// Importación de ARCA
// ---------------------------------------------------------------------------

/** Lo que las dos acciones necesitan comprobar antes de tocar el archivo. */
async function contextoDeImportacion(fd: FormData) {
  const sesion = await sesionVigente();
  if (!sesion || !canAdministrarComprobantes(sesion.role)) {
    return { ok: false as const, error: "No tenés permiso para importar comprobantes." };
  }
  const archivo = fd.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false as const, error: "Elegí el archivo CSV que bajaste de ARCA." };
  }
  // 8 MB: un mes de comprobantes son unos cientos de kilobytes. Un archivo
  // mucho más grande es otra cosa, y leerlo entero en memoria no es gratis.
  if (archivo.size > 8 * 1024 * 1024) {
    return { ok: false as const, error: "El archivo es demasiado grande para ser un CSV de ARCA." };
  }

  const entidadId = String(fd.get("entidadId") ?? "");
  const entidades = await entidadesActivas();
  const entidad = entidades.find((e) => e.id === entidadId) ?? entidades[0];
  if (!entidad) {
    return { ok: false as const, error: "Primero cargá una entidad en la pantalla de Entidades." };
  }

  // **El CSV de ARCA es UTF-8.** Se leía como windows-1252 por suposición, y
  // contra el archivo real eso rompía hasta el encabezado: "Fecha de Emisión"
  // se convertía en "Fecha de EmisiÃ³n" y no coincidía con nada. Los bytes lo
  // dicen sin ambigüedad: la `ó` viene como C3 B3.
  const texto = new TextDecoder("utf-8").decode(await archivo.arrayBuffer());
  return { ok: true as const, sesion, entidad, texto, nombre: archivo.name };
}

/**
 * Qué pasaría si se importa este archivo. **No escribe nada.**
 *
 * Sale del mismo código que la importación de verdad, así que no puede decir
 * una cosa y hacer otra.
 */
export async function previsualizarArca(fd: FormData) {
  const ctx = await contextoDeImportacion(fd);
  if (!ctx.ok) return { ok: false as const, error: ctx.error };

  try {
    const { filas, salteadas } = leerCsvDeArca(ctx.texto);
    const previa = await importarArcaFilas(
      filas,
      { entidadId: ctx.entidad.id, actor: { id: ctx.sesion.id, name: ctx.sesion.name } },
      { aplicar: false },
    );
    return { ok: true as const, previa, salteadas, entidad: ctx.entidad.nombre };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Importa de verdad. Se llama con el mismo archivo, después de mirar la previa. */
export async function importarArca(fd: FormData) {
  const ctx = await contextoDeImportacion(fd);
  if (!ctx.ok) return { ok: false as const, error: ctx.error };

  const hashArchivo = createHash("sha256").update(ctx.texto).digest("hex");
  const yaImportado = await comprobantesDb.arcaImport.findFirst({
    where: { hashArchivo },
    select: { createdAt: true, actorName: true },
  });
  if (yaImportado) {
    // No es un error de datos —reimportar es inofensivo, la clave fiscal lo
    // hace idempotente— pero decirlo evita el susto de ver "0 nuevas" sin
    // entender por qué.
    return {
      ok: false as const,
      error: `Este mismo archivo ya lo importó ${yaImportado.actorName}. Reimportarlo no agregaría nada.`,
    };
  }

  try {
    const { filas, salteadas } = leerCsvDeArca(ctx.texto);
    const r = await importarArcaFilas(filas, {
      entidadId: ctx.entidad.id,
      actor: { id: ctx.sesion.id, name: ctx.sesion.name },
    });
    await comprobantesDb.arcaImport.create({
      data: {
        entidadId: ctx.entidad.id,
        archivo: ctx.nombre,
        hashArchivo,
        filasLeidas: r.filasLeidas,
        completadas: r.completadas,
        creadas: r.creadas,
        sinRespaldo: r.sinRespaldo,
        discrepancias: r.discrepancias.length,
        desde: r.desde,
        hasta: r.hasta,
        actorId: ctx.sesion.id,
        actorName: ctx.sesion.name,
      },
    });
    revalidatePath("/pagos");
    revalidatePath("/importar");
    return { ok: true as const, resultado: r, salteadas };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Las que se pueden elegir al capturar. No lleva importes ni nada sensible:
 *  quien saca la foto tiene que poder decir a nombre de quién viene el papel. */
export async function entidadesParaElegir() {
  const sesion = await sesionVigente();
  if (!sesion || !canCapturarComprobantes(sesion.role)) {
    return { ok: false as const, error: "No tenés permiso." };
  }
  return { ok: true as const, filas: await entidadesActivas() };
}

/** Lo que falta resolver. Lleva importes en la respuesta, así que pide el mismo
 *  permiso que la deuda. */
export async function pendientes() {
  const sesion = await sesionVigente();
  if (!puedeResponderImportes(sesion)) {
    return { ok: false, error: "No tenés permiso para ver los pendientes." };
  }
  const [b, duplicados, faltantes, cuantosHuerfanos, losHuerfanos] = await Promise.all([
    bandejas(),
    posiblesDuplicados(),
    incompletos(),
    // Los que quedaron sin entidad. Van acá y no en `bandejas()` porque las de
    // ahí son de la base del stock; ésta es de la financiera.
    sinEntidadCount(),
    // Las filas, no solo el número: un contador sin lista es una bandeja que no
    // se puede abrir, y el número sube sin que nadie pueda bajarlo.
    sinEntidadDocs(),
  ]);
  return {
    ok: true,
    bandejas: b,
    sinEntidad: cuantosHuerfanos,
    huerfanos: losHuerfanos.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      kind: d.kind,
      fechaEmision: d.fechaEmision,
      // BigInt no cruza como JSON: va en texto, como el resto de la pantalla.
      // El NULL se conserva: "sin importe" es un dato, no un cero.
      importeTotal: d.importeTotal == null ? null : aTextoPlano(d.importeTotal),
    })),
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

  // **El detalle se guarda; la cabecera no.**
  //
  // Los renglones y el desglose de IVA documentan: se miran al lado de la foto y
  // no le cuestan plata a nadie. El total, el proveedor y las fechas deciden
  // cuánto sale y cuándo, y ésos siguen esperando que una persona los confirme
  // en el formulario.
  //
  // Sin esto la tabla de renglones no se llenaba nunca —nadie escribía
  // `DocumentLine`— y el documento reconstruido salía vacío.
  let renglonesGuardados = 0;
  try {
    renglonesGuardados = await guardarDetalleLeido(documentId, campos);
  } catch {
    // Que no se pueda guardar el detalle no puede impedir proponer la cabecera,
    // que es para lo que se tocó el botón.
  }

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
    renglones: renglonesGuardados,
  };
}
