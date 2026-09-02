// Mide el escaneo contra comprobantes reales.
//
// Es el paso 7 del plan de la etapa 1, que pedía "comprobar a ojo". Mirar hace
// falta, pero lo que de verdad decide si esto sirve se puede medir, y es esto:
//
//   **¿el QR sigue leyéndose después del realce?**
//
// Un escaneo lindo que rompe el código empeora el sistema en vez de mejorarlo:
// el QR es el peldaño 1 de la cascada, y perderlo manda el comprobante a carga
// manual — justo lo que este módulo vino a evitar.
//
// Corre en Node y no en el navegador a propósito: las funciones de
// `lib/comprobantes/escaneo.ts` que hacen el trabajo son puras y toman píxeles,
// así que se miden acá sin depender de que un canvas colabore. Lo único que no
// se prueba así es el arrastre de esquinas, que es interfaz.
//
// Uso:
//   npx tsx scripts/probar-escaneo.mts <carpeta con .rgba>
//
// Los .rgba salen de convertir las fotos con:
//   uv run --with pillow python  (ver la Bitácora de la sesión 25)

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import {
  recuadroDeContenido,
  ordenarEsquinas,
  medidaDeSalida,
  enderezarPixeles,
  type Esquina,
  ANCHO_MAXIMO,
  type Mapa,
} from "../lib/comprobantes/escaneo";

const carpeta = process.argv[2];
if (!carpeta) {
  console.error("Uso: npx tsx scripts/probar-escaneo.mts <carpeta con .rgba>");
  process.exit(1);
}

function leerRgba(ruta: string): Mapa {
  const b = readFileSync(ruta);
  const width = b.readUInt32LE(0);
  const height = b.readUInt32LE(4);
  return { data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, width * height * 4), width, height };
}

/** Achica una imagen promediando bloques. Se usa para el análisis, igual que
 *  hace `proponerEsquinas` en el navegador. */
function achicar(m: Mapa, anchoDestino: number): Mapa {
  const escala = Math.min(1, anchoDestino / m.width);
  const w = Math.max(8, Math.round(m.width * escala));
  const h = Math.max(8, Math.round(m.height * escala));
  const data = new Uint8ClampedArray(w * h * 4);
  const fx = m.width / w;
  const fy = m.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(m.width - 1, Math.floor(x * fx));
      const sy = Math.min(m.height - 1, Math.floor(y * fy));
      const s = (sy * m.width + sx) * 4;
      const d = (y * w + x) * 4;
      data[d] = m.data[s];
      data[d + 1] = m.data[s + 1];
      data[d + 2] = m.data[s + 2];
      data[d + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** Las mismas esquinas que propondría `proponerEsquinas` en el navegador. */
function proponer(m: Mapa): Esquina[] | null {
  const chico = achicar(m, 240);
  const r = recuadroDeContenido(chico.data, chico.width, chico.height);
  if (!r) return null;
  const escala = chico.width / m.width;
  const aire = Math.round(Math.min(chico.width, chico.height) * 0.02);
  const x0 = Math.max(0, r.x0 - aire) / escala;
  const y0 = Math.max(0, r.y0 - aire) / escala;
  const x1 = Math.min(chico.width - 1, r.x1 + aire) / escala;
  const y1 = Math.min(chico.height - 1, r.y1 + aire) / escala;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function marcoPorDefecto(ancho: number, alto: number): Esquina[] {
  const mx = ancho * 0.05;
  const my = alto * 0.05;
  return [
    { x: mx, y: my },
    { x: ancho - mx, y: my },
    { x: ancho - mx, y: alto - my },
    { x: mx, y: alto - my },
  ];
}

/**
 * Si se lee un QR. **Es una cota inferior, no la verdad.**
 *
 * jsQR es lo que hay en JavaScript y es notablemente mas debil que un
 * decodificador serio: contra las 18 fotos reales encontro 1 QR donde zxing
 * encuentra 5 — incluido uno grande y nitido que cualquiera ve a simple vista.
 * Sirve para comparar antes contra despues con el mismo criterio; no sirve para
 * afirmar cuantos comprobantes traen codigo.
 */
function hayQr(m: Mapa): string | null {
  const r = jsQR(m.data, m.width, m.height, { inversionAttempts: "attemptBoth" });
  return r ? r.data.slice(0, 60) : null;
}

type Fila = {
  nombre: string;
  auto: boolean;
  qrOrig: boolean;
  qrEsc: boolean;
  cobertura: number;
  ms: number;
  salida: string;
};

const archivos = readdirSync(carpeta).filter((f) => f.endsWith(".rgba")).sort();
const filas: Fila[] = [];
const salidaPng = path.join(carpeta, "..", "escaneadas");
mkdirSync(salidaPng, { recursive: true });

for (const f of archivos) {
  const m = leerRgba(path.join(carpeta, f));
  const nombre = f.replace(".rgba", "");

  const qrOrig = hayQr(m);

  const propuestas = proponer(m);
  const esquinas = ordenarEsquinas(propuestas ?? marcoPorDefecto(m.width, m.height))!;
  const medida = medidaDeSalida(esquinas);
  const escala = Math.min(1, ANCHO_MAXIMO / medida.ancho);
  const ancho = Math.round(medida.ancho * escala);
  const alto = Math.round(medida.alto * escala);

  const t0 = performance.now();
  const esc = enderezarPixeles(m, esquinas, ancho, alto);
  const ms = performance.now() - t0;
  if (!esc) {
    console.log(`${nombre}: enderezarPixeles devolvió null`);
    continue;
  }

  const qrEsc = hayQr(esc);

  // Se guarda el crudo para poder mirarlo después.
  const cab = Buffer.alloc(8);
  cab.writeUInt32LE(esc.width, 0);
  cab.writeUInt32LE(esc.height, 4);
  writeFileSync(path.join(salidaPng, `${nombre}.rgba`), Buffer.concat([cab, Buffer.from(esc.data)]));

  filas.push({
    nombre,
    auto: propuestas !== null,
    qrOrig: qrOrig !== null,
    qrEsc: qrEsc !== null,
    cobertura: (medida.ancho * medida.alto) / (m.width * m.height),
    ms,
    salida: `${m.width}×${m.height} → ${ancho}×${alto}`,
  });
}

const si = (b: boolean) => (b ? "sí" : "— ");
console.log("\nfoto        auto  QRorig QResc  cobert   ms     medida");
console.log("─".repeat(72));
for (const f of filas) {
  console.log(
    `${f.nombre}  ${si(f.auto)}    ${si(f.qrOrig)}     ${si(f.qrEsc)}    ` +
      `${(f.cobertura * 100).toFixed(0).padStart(3)}%  ${Math.round(f.ms).toString().padStart(5)}  ${f.salida}`,
  );
}

const conQr = filas.filter((f) => f.qrOrig);
const perdidos = conQr.filter((f) => !f.qrEsc);
const ganados = filas.filter((f) => !f.qrOrig && f.qrEsc);

console.log("\n" + "═".repeat(72));
console.log(`fotos              ${filas.length}`);
console.log(`autodetectadas     ${filas.filter((f) => f.auto).length}/${filas.length}`);
console.log(`QR en la original  ${conQr.length}`);
console.log(`QR en la escaneada ${filas.filter((f) => f.qrEsc).length}`);
console.log(`QR PERDIDOS        ${perdidos.length}${perdidos.length ? "  " + perdidos.map((f) => f.nombre).join(" ") : ""}`);
console.log(`QR GANADOS         ${ganados.length}${ganados.length ? "  " + ganados.map((f) => f.nombre).join(" ") : ""}`);
console.log(`escaneo medio      ${Math.round(filas.reduce((a, f) => a + f.ms, 0) / (filas.length || 1))} ms`);
console.log(`escaneo peor       ${Math.round(Math.max(...filas.map((f) => f.ms)))} ms`);
console.log(
  perdidos.length === 0
    ? "\n→ El realce NO rompe ningún QR."
    : `\n→ ATENCIÓN: el realce rompe ${perdidos.length} QR que se leían. Bajar la agresividad.`,
);
