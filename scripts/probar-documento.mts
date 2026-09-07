// Genera el documento reconstruido con datos reales, para mirarlo.
//
// Es el paso 7 del plan de la tarea 12. Lo que hay que comprobar a ojo:
//
//   - que las comas de los importes queden en columna;
//   - que el vencimiento se vea de lejos;
//   - que el pie de procedencia se lea sin buscarlo;
//   - y que, puesto al lado de la foto del original, **nadie pueda confundir
//     cuál es cuál**.
//
// Uso: npx tsx scripts/probar-documento.mts [carpeta de salida]

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { armarDatos } from "../lib/comprobantes/documento";
import { renderComprobantePdf } from "../lib/pdf/ComprobantePdf";

const salida = process.argv[2] ?? ".";
mkdirSync(salida, { recursive: true });

// La factura de Lácteos Don Ángel del 27/08/2026, de las fotos del depósito.
// Los totales son los impresos: 616.215,40 + 129.405,25 + 18.486,46 = 764.107,11
const DON_ANGEL = {
  kind: "FACTURA",
  source: "QR",
  cuitEmisor: "20135041379",
  tipoCbte: "A",
  puntoVenta: 6,
  numero: 57875,
  fechaEmision: "2026-08-27",
  vencimiento: "2026-09-11",
  importeTotal: 76410711n,
  neto: 61621540n,
  iva: 12940525n,
  percepciones: 1848646n,
  cae: "86350106990468",
  createdAt: new Date("2026-09-02T10:00:00"),
  destino: "DEPOSITO",
  destinoNota: null,
  conforme: true,
  faltantesNota: null,
  capturedByName: "Pablo",
  supplier: { name: "LACTEOS DON ANGEL — Laspina Miguel Angel" },
};

/**
 * Los renglones del papel.
 *
 * Los subtotales son los impresos y **suman exactamente el neto** ($616.215,40),
 * que es la mejor prueba de que están bien transcriptos.
 *
 * Los precios unitarios también son los del papel, y por eso
 * `cantidad × precio ≠ subtotal`: la factura tiene una columna de **19% de
 * descuento**. Es justamente el caso que rompía la primera versión del control
 * de renglones.
 *
 *     5,470 KG × $15.309,917 = $83.745,60  →  19% off  →  $67.833,65
 */
const DESCUENTO = 0.81;
const RENGLONES = (
  [
    ["000072", "Brie", "5,470", 6783365n],
    ["000094", "Messonier Ciervo Ahumado", "6,500", 7779582n],
    ["000125", "Messonier Al Ají Merken", "3,040", 3477886n],
    ["000216", "Messonier Raclette", "3,250", 3382436n],
    ["000218", "Messonier Finas Hierbas", "2,950", 3374922n],
    ["000225", "Messonier Orange Grove", "2,860", 3271958n],
    ["000291", "Queso Azul Don Angel", "9,200", 10030022n],
    ["000322", "Messonier Medio Oriente", "3,220", 3351214n],
    ["000351", "Messonier Arabe", "6,010", 6254905n],
    ["000016", "Messonier Ginger", "3,390", 3528141n],
    ["000021", "Messonier Pesto", "2,750", 3146114n],
    ["000062", "Messonier Epice Ahumado", "6,050", 7240995n],
  ] as [string, string, string, bigint][]
).map(([codigo, descripcion, cant, sub], i) => {
  const cantidad = BigInt(cant.replace(",", ""));
  // El precio de lista: el subtotal es el precio con el descuento aplicado.
  const precioUnitario = BigInt(Math.round((Number(sub) * 10_000) / Number(cantidad) / DESCUENTO));
  return { orden: i + 1, codigo, descripcion, cantidad, unidad: "KG", precioUnitario, subtotal: sub };
});

const NETO_IMPRESO = RENGLONES.reduce((a, r) => a + r.subtotal, 0n);
if (NETO_IMPRESO !== DON_ANGEL.neto) {
  console.error(`Los renglones suman ${NETO_IMPRESO} y el neto impreso es ${DON_ANGEL.neto}.`);
  process.exit(1);
}

async function generar(nombre: string, doc: typeof DON_ANGEL, lineas: typeof RENGLONES) {
  const datos = armarDatos(doc, lineas);
  const pdf = await renderComprobantePdf(datos);
  const destino = path.join(salida, `${nombre}.pdf`);
  writeFileSync(destino, pdf);
  console.log(
    `${destino}  ${(pdf.length / 1024).toFixed(0)} KB  ` +
      `verificado=${datos.procedencia.verificado}` +
      (datos.procedencia.advertencia ? `  aviso="${datos.procedencia.advertencia}"` : ""),
  );
}

// 1. El caso bueno: todo cierra.
await generar("documento-ok", DON_ANGEL, RENGLONES);

// 2. El caso que hay que ver bien: la aritmética no cierra. El pie tiene que
//    cambiar de color y decir qué revisar.
await generar("documento-no-cierra", { ...DON_ANGEL, importeTotal: 76410811n }, RENGLONES);

// 3. Un remito sin nada: ni identidad fiscal, ni importe, ni renglones. Tiene
//    que salir igual y no verse roto.
await generar(
  "documento-remito",
  {
    ...DON_ANGEL,
    kind: "REMITO",
    source: "MANUAL",
    cuitEmisor: null as unknown as string,
    tipoCbte: null as unknown as string,
    puntoVenta: null as unknown as number,
    numero: null as unknown as number,
    importeTotal: null as unknown as bigint,
    neto: null as unknown as bigint,
    iva: null as unknown as bigint,
    percepciones: null as unknown as bigint,
    cae: null as unknown as string,
    vencimiento: null as unknown as string,
    supplier: { name: "Verdulería del barrio" },
  },
  [],
);

// 4. Una nota de crédito: el total tiene que anunciarse como algo que RESTA.
await generar("documento-nota-credito", { ...DON_ANGEL, kind: "NOTA_CREDITO" }, RENGLONES.slice(0, 3));
