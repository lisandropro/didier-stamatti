"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { canCapturarComprobantes, canPagar } from "@/lib/permissions";
import { guardarCaptura } from "@/lib/comprobantes/documentos";
import {
  porProveedor,
  queVence,
  marcarPagados,
  ponerVencimiento,
  bandejas,
  posiblesDuplicados,
} from "@/lib/comprobantes/pagos";
import { subirFoto } from "@/lib/comprobantes/almacenamiento";
import { esParaNosotros } from "@/lib/comprobantes/qr";
import { aTextoPlano } from "@/lib/money";
import {
  puedeResponderImportes,
  aFilaDeuda,
  cabeceraDeLaCaptura,
  destinoValido,
  kindValido,
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
  const sesion = await getSessionUser();
  if (!sesion) return { ok: false, error: "Tenés que iniciar sesión." };
  if (!canCapturarComprobantes(sesion.role)) {
    return { ok: false, error: "No tenés permiso para cargar comprobantes." };
  }

  const clientKey = String(fd.get("clientKey") ?? "");
  if (!clientKey) return { ok: false, error: "Falta la llave de la captura." };

  const archivos = fd.getAll("fotos").filter((f): f is File => f instanceof File);
  if (archivos.length === 0) return { ok: false, error: "No llegó ninguna foto." };

  for (const f of archivos) {
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
    const { s3Key, sizeBytes } = await subirFoto(bytes, f.type, hoy);
    adjuntos.push({
      s3Key,
      mimeType: f.type,
      sizeBytes,
      variante: (String(fd.getAll("variante")[i] ?? "ORIGINAL") === "ESCANEADA"
        ? "ESCANEADA"
        : "ORIGINAL") as "ORIGINAL" | "ESCANEADA",
      pagina: Number(fd.getAll("pagina")[i] ?? 1) || 1,
    });
  }

  const destino = destinoValido(String(fd.get("destino") ?? ""));
  const conformeCrudo = fd.get("conforme");

  let r;
  try {
    r = await guardarCaptura({
      clientKey,
      kind: kindValido(String(fd.get("kind") ?? "")),
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
  const sesion = await getSessionUser();
  if (!puedeResponderImportes(sesion)) {
    // Se corta ANTES de consultar la base: el importe no se lee siquiera.
    return { ok: false, error: "No tenés permiso para ver importes." };
  }
  return { ok: true, filas: (await porProveedor()).map(aFilaDeuda) };
}

export async function vencimientosEntre(desde: string, hasta: string) {
  const sesion = await getSessionUser();
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

export async function pagar(ids: string[]) {
  const sesion = await getSessionUser();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para marcar pagos." };
  }
  const cuantos = await marcarPagados(ids, new Date(), { id: sesion.id, name: sesion.name });
  revalidatePath("/pagos");
  return { ok: true, cuantos };
}

export async function cargarVencimiento(id: string, vencimiento: string) {
  const sesion = await getSessionUser();
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
  const sesion = await getSessionUser();
  if (!puedeResponderImportes(sesion)) {
    return { ok: false, error: "No tenés permiso para ver los pendientes." };
  }
  const [b, duplicados] = await Promise.all([bandejas(), posiblesDuplicados()]);
  return {
    ok: true,
    bandejas: b,
    duplicados: duplicados.map((d) => ({
      supplierId: d.supplierId,
      nombre: d.nombre,
      importe: aTextoPlano(d.importe),
      documentIds: d.documentIds,
    })),
  };
}
