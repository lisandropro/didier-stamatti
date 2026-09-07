// Prueba la lectura automática contra comprobantes reales.
//
// **Esto gasta plata: una llamada al modelo por archivo.** Por eso no es una
// prueba automática — una prueba que cuesta en cada corrida se termina
// desactivando, y una desactivada no prueba nada.
//
// Uso:
//
//   ANTHROPIC_API_KEY=sk-... npx tsx scripts/probar-lectura.mts foto1.jpg foto2.pdf
//
// Lo que hay que mirar, en este orden:
//
// 1. El **total**, el **CUIT** y el **vencimiento**, comparados con el papel.
// 2. Y sobre todo: **cuántas veces los controles dieron verde estando el dato
//    mal.** Ese número es el único que importa de verdad, porque es la única
//    forma en que un dato equivocado llega a la pantalla de quien paga sin que
//    nadie lo mire. Si aparece aunque sea uno, hay que subir el umbral: que la
//    confirmación de un toque exija además que el proveedor ya exista con ese
//    CUIT.

import { readFileSync } from "node:fs";
import path from "node:path";
import { leerFoto, MODELO } from "../lib/comprobantes/lectura";
import { formatear } from "../lib/money";
import type { Kind } from "../lib/comprobantes/tipos";

const TIPOS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

const archivos = process.argv.slice(2);
if (archivos.length === 0) {
  console.error("Uso: npx tsx scripts/probar-lectura.mts <archivo> [archivo...]");
  console.error("Formatos: .jpg .jpeg .png .webp .pdf");
  console.error("");
  console.error("Las fotos .HEIC del iPhone NO sirven: hay que convertirlas a JPG");
  console.error("primero. La app tampoco las acepta al subir, por el mismo motivo.");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY.");
  process.exit(1);
}

console.log(`Modelo: ${MODELO} · ${archivos.length} archivo(s) · una llamada por archivo\n`);

const plata = (v: bigint | undefined) => (v == null ? "—" : formatear(v));
const semaforo = (v: boolean | null) => (v === true ? "✓" : v === false ? "✗" : "·");

for (const ruta of archivos) {
  const ext = path.extname(ruta).toLowerCase();
  const mime = TIPOS[ext];
  if (!mime) {
    console.log(`${path.basename(ruta)}: formato no admitido (${ext})\n`);
    continue;
  }

  // El tipo se asume FACTURA: es lo que hay que leer bien. Para probar un remito
  // se cambia acá a mano.
  const kind: Kind = "FACTURA";

  try {
    const { campos, controles } = await leerFoto(readFileSync(ruta), mime, kind);
    console.log(`── ${path.basename(ruta)}`);
    console.log(`   Proveedor    ${campos.nombreProveedor ?? "—"}`);
    console.log(`   CUIT         ${campos.cuitEmisor ?? "—"}`);
    console.log(`   Emisión      ${campos.fechaEmision ?? "—"}`);
    console.log(
      `   Vencimiento  ${campos.vencimiento ?? (campos.condicionPago ? `(${campos.condicionPago})` : "—")}`,
    );
    console.log(`   Subtotal     ${plata(campos.subtotal)}`);
    console.log(`   IVA          ${plata(campos.iva)}`);
    console.log(`   Percepciones ${plata(campos.percepciones)}`);
    console.log(`   TOTAL        ${plata(campos.total)}`);
    console.log(`   Renglones    ${campos.renglones?.length ?? 0}`);
    console.log(
      `   Controles    cuenta ${semaforo(controles.cierraLaCuenta)}` +
        `  renglones ${semaforo(controles.cierranLosRenglones)}` +
        `  CUIT ${semaforo(controles.cuitValido)}`,
    );
    const verde =
      controles.cierraLaCuenta !== false &&
      controles.cierranLosRenglones !== false &&
      controles.cuitValido !== false;
    console.log(
      verde
        ? "   → Se confirmaría de un toque. COMPARÁ EL TOTAL CON EL PAPEL."
        : "   → Pide revisión: algún control dio rojo.",
    );
    console.log("");
  } catch (e) {
    console.log(`── ${path.basename(ruta)}`);
    console.log(`   ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
