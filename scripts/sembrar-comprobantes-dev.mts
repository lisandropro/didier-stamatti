// Siembra la base de comprobantes de DESARROLLO con casos realistas.
//
// Existe para poder mirar la pantalla de pagos y la de completar con datos que
// se parezcan a los de verdad, sin depender de sacar fotos con el teléfono.
//
// Los casos elegidos no son decorativos: son los que tienen forma de romperse.
//
//   1. Una factura completa y verificable  → el camino feliz
//   2. Una factura VENCIDA                 → la sección que se mira primero
//   3. Una sin proveedor ni importe        → la bandeja "Falta resolver"
//   4. Un remito                           → sin importe, no se paga nunca
//   5. Una nota de crédito                 → RESTA de la deuda
//   6. Dos facturas iguales                → el aviso de duplicado
//
// NO corre contra producción: aborta si la URL no es un archivo local.
//
// Uso: npx tsx scripts/sembrar-comprobantes-dev.mts

import "dotenv/config";
import { PrismaClient } from "../app/generated/comprobantes/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const url = process.env.COMPROBANTES_DATABASE_URL ?? "file:./dev-comprobantes.db";
if (!/^file:\.?\//.test(url) || url.includes("/app/data")) {
  console.error(`Esto solo corre contra una base local. URL: ${url}`);
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

/** Días desde hoy, en "AAAA-MM-DD". */
function dia(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

await db.documentChange.deleteMany();
await db.capturaVista.deleteMany();
await db.attachment.deleteMany();
await db.documentLine.deleteMany();
await db.document.deleteMany();
await db.supplier.deleteMany();

const donAngel = await db.supplier.create({
  data: { name: "LACTEOS DON ANGEL", cuit: "20135041379", diasPago: 15 },
});
const dinamark = await db.supplier.create({
  data: { name: "DINAMARK SRL", cuit: "30718089413" },
});
const verduleria = await db.supplier.create({ data: { name: "Verdulería del barrio" } });

const PABLO = { capturedById: "u-pablo", capturedByName: "Pablo" };

// 1. Factura completa: el desglose cierra y los renglones suman el neto.
const completa = await db.document.create({
  data: {
    kind: "FACTURA",
    source: "QR",
    supplierId: donAngel.id,
    cuitEmisor: "20135041379",
    tipoCbte: "A",
    puntoVenta: 6,
    numero: 57875,
    fechaEmision: dia(-6),
    vencimiento: dia(9),
    importeTotal: 76410711n,
    neto: 61621540n,
    iva: 12940525n,
    percepciones: 1848646n,
    cae: "86350106990468",
    destino: "DEPOSITO",
    conforme: true,
    ...PABLO,
  },
});

const RENGLONES: [string, string, string, bigint][] = [
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
];

await db.documentLine.createMany({
  data: RENGLONES.map(([codigo, descripcion, cant, subtotal], i) => {
    const cantidad = BigInt(cant.replace(",", ""));
    // Precio de lista: el subtotal ya trae el 19% de descuento aplicado.
    const precioUnitario = BigInt(Math.round((Number(subtotal) * 10_000) / Number(cantidad) / 0.81));
    return {
      documentId: completa.id,
      orden: i + 1,
      codigo,
      descripcion,
      cantidad,
      unidad: "KG",
      precioUnitario,
      subtotal,
    };
  }),
});

// 2. Vencida hace una semana: va arriba de todo y en su propia sección.
await db.document.create({
  data: {
    kind: "FACTURA",
    source: "QR",
    supplierId: dinamark.id,
    cuitEmisor: "30718089413",
    tipoCbte: "A",
    puntoVenta: 2,
    numero: 28897,
    fechaEmision: dia(-38),
    vencimiento: dia(-7),
    importeTotal: 77286775n,
    neto: 63873368n,
    iva: 13413407n,
    percepciones: 0n,
    cae: "86305704041463",
    destino: "COCINA",
    conforme: true,
    ...PABLO,
  },
});

// 3. Sin proveedor ni importe: tiene que aparecer en "Falta resolver" con el
//    motivo escrito, y su fila tiene que llevar a la pantalla de completar.
await db.document.create({
  data: { kind: "FACTURA", source: "SIN_CODIGO", destino: "DEPOSITO", ...PABLO },
});

// 4. Remito: sin importe y sin vencimiento, y NO se paga nunca. Sirve para
//    comprobar que no infla ninguna bandeja.
await db.document.create({
  data: {
    kind: "REMITO",
    source: "MANUAL",
    supplierId: verduleria.id,
    fechaEmision: dia(-2),
    destino: "COCINA",
    // El caso que importa: en el depósito faltaban cosas.
    conforme: false,
    faltantesNota: "faltaron 2 cajones de tomate",
    ...PABLO,
  },
});

// 5. Nota de crédito: RESTA de la deuda con Don Ángel.
await db.document.create({
  data: {
    kind: "NOTA_CREDITO",
    source: "QR",
    supplierId: donAngel.id,
    cuitEmisor: "20135041379",
    tipoCbte: "NOTA_CREDITO_A",
    puntoVenta: 6,
    numero: 1204,
    fechaEmision: dia(-3),
    vencimiento: dia(9),
    importeTotal: 4500000n,
    destino: "DEPOSITO",
    ...PABLO,
  },
});

// 6. La MISMA factura cargada dos veces: dispara el aviso de duplicado.
//
// Van SIN número de comprobante a propósito. `posiblesDuplicados` excluye los
// que tienen número fiscal propio, y tiene razón: dos facturas con números
// distintos no son un pago doble, son dos facturas — y el índice único ya
// impide cargar dos veces la misma. El caso ambiguo de verdad es este: una foto
// sin QR legible, cargada dos veces, sin identidad fiscal que las distinga.
//
// La primera versión de esta semilla les puso 9001 y 9002 y el aviso no
// aparecía. El dato estaba mal, no el detector.
for (let i = 0; i < 2; i++) {
  await db.document.create({
    data: {
      kind: "FACTURA",
      source: "MANUAL",
      supplierId: dinamark.id,
      fechaEmision: dia(-4 - i),
      vencimiento: dia(3),
      importeTotal: 12450080n,
      ...PABLO,
    },
  });
}

const total = await db.document.count();
const lineas = await db.documentLine.count();
console.log(`Sembrados ${total} comprobantes y ${lineas} renglones en ${url}`);
console.log("Entrá a http://localhost:3000/pagos");

await db.$disconnect();
