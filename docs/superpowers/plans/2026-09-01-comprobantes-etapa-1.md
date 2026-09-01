# Comprobantes · Etapa 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un comprobante en papel se fotografíe en el depósito y aparezca al instante en la pantalla de Aldana, con su importe y su vencimiento, sin que nadie lo tipee en una planilla y sin darle acceso a ARCA.

**Architecture:** Un módulo nuevo dentro de la app `didier-catering`, con **base de datos propia** (segundo esquema Prisma, segundo cliente, respaldo aparte). La foto se guarda siempre; la identificación es una cascada que empieza por el QR de AFIP y degrada a una carga manual corta. Los permisos se comprueban del lado del servidor: el rol de depósito nunca recibe un importe.

**Medido antes de escribir esto:** sobre 18 comprobantes reales, 5 traen QR de factura y **2 de esos 5 no son JSON válido**. Ninguno trae el código de barras de la RG 1702. Por eso el lector de QR es tolerante y no hay lector de código de barras — ver "Lo que dijeron 18 comprobantes reales" en el diseño.

**Tech Stack:** Next.js 16 (App Router, server actions) · Prisma 7 + SQLite (`better-sqlite3`) · TypeScript · `node:test` · S3 en Railway · `BarcodeDetector` del navegador.

**Diseño de referencia:** `docs/superpowers/specs/2026-09-01-comprobantes-design.md`. Ante cualquier duda de *por qué*, gana el diseño.

## Global Constraints

- **Los importes van SIEMPRE en centavos, como `BigInt`, y siempre positivos.** El signo lo decide `kind`. Nunca `number`, nunca decimal.
- **`BigInt` no serializa a JSON.** Verificado: `JSON.stringify` tira `Do not know how to serialize a BigInt`. Toda server action que devuelva un importe lo convierte a `string` antes de retornar.
- **Las fechas de día son texto `"AAAA-MM-DD"`**, nunca `DateTime`. Solo son `DateTime` los instantes (`createdAt`, `pagadoAt`).
- **`vencimiento` jamás se autocompleta desde `cae` ni `caeVence`.** Son fechas distintas y confundirlas ya pasó (`Bitácora.md:415`).
- **Los permisos se comprueban en la server action**, no en la pantalla. Esconder un botón no es un permiso (`lib/permissions.ts`, regla del archivo).
- **Nada se borra de verdad:** `deletedAt`. Un comprobante fiscal no lo borra ni el admin.
- **Comentarios en español y explicando el *por qué***, siguiendo el estilo del repo. Un comentario que repite lo que dice el código sobra.
- **No se modifica ninguna tabla existente.** El único archivo existente que se toca es `lib/permissions.ts`.
- **Node 20.19+**, como declara `package.json`.

---

## File Structure

**Base de datos propia**
- `prisma/comprobantes/schema.prisma` — el esquema del módulo
- `prisma-comprobantes.config.ts` — config de Prisma para ese esquema
- `lib/db-comprobantes.ts` — el cliente, con el mismo patrón de singleton que `lib/db.ts`

**Lógica pura (sin base de datos, fácil de probar)**
- `lib/money.ts` — centavos: parsear, formatear, serializar
- `lib/comprobantes/qr.ts` — decodificar el QR de AFIP (RG 4892)
- `lib/comprobantes/tipos.ts` — los tipos que cruzan capas

**Lógica con base de datos**
- `lib/comprobantes/documentos.ts` — alta, fusión por índice único, bandejas
- `lib/comprobantes/pagos.ts` — total por proveedor, marcar pagado
- `lib/comprobantes/almacenamiento.ts` — subir y firmar las fotos en S3

**Bordes**
- `lib/comprobantes/politica.ts` — las decisiones que toman las actions: a quién se le da un importe, qué se acepta del navegador
- `app/actions/comprobantes.ts` — las server actions, que son la barrera de permisos
- `app/(app)/recepcion/page.tsx` + `captura-cliente.tsx` — la cámara
- `app/(app)/pagos/page.tsx` + `lista-pagos.tsx` — la pantalla de Aldana

**Pruebas** — una por unidad, en `tests/`, con el prefijo `comprobantes-`.

Cada archivo hace una cosa. `documentos.ts` no sabe de S3; `almacenamiento.ts` no sabe de Prisma; los lectores de códigos no saben de nada.

---

### Task 1: La segunda base de datos

Es la primera porque todo lo demás se apoya acá, y porque ya está verificado que funciona: `prisma migrate dev --config` aplicó una migración y `prisma generate --config` produjo un cliente en su propia carpeta.

**Files:**
- Create: `prisma/comprobantes/schema.prisma`
- Create: `prisma-comprobantes.config.ts`
- Create: `lib/db-comprobantes.ts`
- Modify: `package.json` (scripts `postinstall` y `start:prod`)
- Modify: `.gitignore` (agregar `app/generated/comprobantes`, si `app/generated` no está ya ignorado)
- Test: `tests/comprobantes-esquema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `prismaComprobantes` (cliente Prisma) desde `lib/db-comprobantes.ts`. Los modelos `Supplier`, `Document`, `Attachment`, `DocumentChange` con los campos del diseño.

- [ ] **Step 1: Crear el esquema**

Crear `prisma/comprobantes/schema.prisma`:

```prisma
// Comprobantes de proveedores: facturas, remitos, tickets y notas.
//
// Vive en su propia base, aparte del stock, por tres razones: el respaldo del
// stock retiene 14 días y un comprobante fiscal hay que guardarlo años;
// restaurar un período de pedidos jamás debe poder tocar una factura; y los
// ciclos de vida no se parecen — el inventario se resetea, un comprobante no
// se toca nunca más.
//
// No hay claves foráneas hacia la base del stock. Los ids de usuario viajan
// con el nombre al lado, como ya hace `Suggestion`.

generator client {
  provider = "prisma-client"
  output   = "../../app/generated/comprobantes"
}

datasource db {
  provider = "sqlite"
}

// Un proveedor. El CUIT es la identidad real; el nombre en el papel varía
// ("DON ANGEL", "Don Angel SRL", "DONANGEL") y no sirve para identificar.
model Supplier {
  id        String     @id @default(cuid())
  name      String
  // Único cuando existe. NULL = proveedor informal sin CUIT (verdulería,
  // ferretería de barrio). SQLite admite varios NULL en un índice único.
  cuit      String?    @unique
  alias     String?
  // Dias para pagar, cuando el proveedor factura con una condicion en vez de
  // una fecha ("7 DIAS" en la de Dinamark). Sirve para PROPONER el vencimiento;
  // si el papel trae una fecha, gana la fecha. NULL = contado o no se sabe.
  diasPago  Int?
  active    Boolean    @default(true)
  createdAt DateTime   @default(now())
  deletedAt DateTime?
  documents Document[]
}

model Document {
  id   String @id @default(cuid())
  kind String // FACTURA | REMITO | TICKET | NOTA_CREDITO | NOTA_DEBITO | OTRO

  // Cómo se resolvió la cabecera la primera vez, no de dónde salió la foto.
  // Un valor por peldaño de la cascada:
  //   ARCA | QR | EMPAREJADO | LECTURA | MANUAL
  // Sirve además como medición: en producción dice qué peldaño está
  // funcionando de verdad, que es hoy el número más incierto del proyecto.
  source String

  // --- Identidad fiscal. Se copia de un código o de ARCA; NUNCA se tipea. ---
  cuitEmisor   String?
  tipoCbte     String?
  puntoVenta   Int?
  numero       Int?
  fechaEmision String? // "AAAA-MM-DD"
  importeTotal BigInt? // CENTAVOS, siempre positivo
  cae          String?
  // Se guarda pero NO se le muestra a quien paga: es la fecha que ya se
  // confundió una vez con el vencimiento del pago.
  caeVence     String?

  // --- Vínculos, corregibles sin tocar el dato crudo ---
  supplierId String?
  supplier   Supplier? @relation(fields: [supplierId], references: [id])

  // A dónde entró la mercadería. La factura NO pertenece a una fiesta.
  destino     String? // COCINA | DEPOSITO | OTRO
  destinoNota String?

  // NULL = nadie revisó. Distinto de "revisado y estaba bien".
  conforme      Boolean?
  faltantesNota String?

  // Sale del "Vto:" del papel. NUNCA se autocompleta desde el CAE.
  vencimiento String?
  pagadoAt    DateTime?

  // NULL = todavía no se cruzó contra ARCA.
  enArca Boolean?

  // Los tres van en NULL cuando el comprobante entró por el CSV de ARCA: no lo
  // capturó nadie. Que `capturedByName` esté vacío es información, no un hueco.
  capturedById   String?
  capturedByName String?
  clientKey      String?  @unique
  createdAt      DateTime @default(now())
  deletedAt      DateTime?

  // Cuando una foto suelta se empareja con una fila de ARCA, las fotos se
  // mudan y esta fila queda borrada apuntando a la que quedó viva.
  mergedIntoId String?

  attachments Attachment[]
  lines       DocumentLine[]
  changes     DocumentChange[]

  // Los cuatro campos juntos son la identidad de una factura electrónica
  // argentina. Es lo que impide cargar dos veces la misma, venga por foto o
  // por ARCA. Los remitos y tickets van en NULL y no deduplican, que es lo
  // correcto: no tienen identidad única.
  @@unique([cuitEmisor, tipoCbte, puntoVenta, numero])
  @@index([supplierId, pagadoAt])
  @@index([vencimiento, pagadoAt])
  @@index([deletedAt])
}

// Una foto, o varias: la factura de tres hojas. El archivo vive en S3.
model Attachment {
  id           String   @id @default(cuid())
  // ORIGINAL = la foto tal como salió de la cámara.
  // ESCANEADA = la misma, recortada al borde del papel, enderezada y con el
  // fondo blanqueado. Es la que se muestra y la que se archiva.
  //
  // Se guardan LAS DOS. Un recorte automático mal hecho puede comerse el CAE o
  // un renglón entero, y de la escaneada eso no se recupera.
  variante     String   @default("ORIGINAL")
  documentId   String
  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  s3Key        String   @unique
  mimeType     String
  sizeBytes    Int
  page         Int      @default(1)
  uploadedById String?
  createdAt    DateTime @default(now())

  @@index([documentId, page])
}

// Un renglón de la factura. Es lo que convierte un comprobante en algo que se
// puede preguntar: "cuánto pagamos por queso reggianito en seis meses".
//
// El detalle además VERIFICA la cabecera: cada renglón cumple
// `cantidad × precio = subtotal`, y la suma de todos da el subtotal general.
// Con el detalle adentro el documento queda sobredeterminado, así que un dígito
// mal leído rompe alguna de esas cuentas y se nota.
model DocumentLine {
  id             String   @id @default(cuid())
  documentId     String
  document       Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  orden          Int
  codigo         String?
  descripcion    String
  cantidad       BigInt?  // MILÉSIMAS: 4,40 KG = 4400
  unidad         String?
  precioUnitario BigInt?  // CENTAVOS
  subtotal       BigInt?  // CENTAVOS, tal como está impreso

  @@index([documentId, orden])
  @@index([descripcion])
}

// Historial campo por campo. Mismo patrón que ProductChange en la otra base.
model DocumentChange {
  id         String   @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  actorId    String?
  actorName  String
  field      String
  before     String?
  after      String?
  createdAt  DateTime @default(now())

  @@index([documentId, createdAt])
}
```

- [ ] **Step 2: Crear la config de Prisma**

Crear `prisma-comprobantes.config.ts`. Es un archivo aparte porque `defineConfig` acepta un solo `schema`; el CLI lo toma con `--config`.

```typescript
// Config del SEGUNDO esquema. El primero sigue en `prisma.config.ts` y no se
// toca. Todo comando de Prisma sobre este módulo necesita `--config`:
//   npx prisma migrate dev --config ./prisma-comprobantes.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/comprobantes/schema.prisma",
  migrations: { path: "prisma/comprobantes/migrations" },
  datasource: { url: process.env["COMPROBANTES_DATABASE_URL"] },
});
```

- [ ] **Step 3: Generar la migración inicial y el cliente**

```bash
COMPROBANTES_DATABASE_URL="file:./dev-comprobantes.db" npx prisma migrate dev --name inicial --config ./prisma-comprobantes.config.ts
npx prisma generate --config ./prisma-comprobantes.config.ts
```

Esperado: se crea `prisma/comprobantes/migrations/<fecha>_inicial/migration.sql` y se genera el cliente en `app/generated/comprobantes/`.

- [ ] **Step 4: Crear el cliente**

Crear `lib/db-comprobantes.ts`, copiando el patrón de `lib/db.ts`:

```typescript
import { PrismaClient } from "@/app/generated/comprobantes/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Segundo cliente, apuntando a la base de comprobantes. El singleton en
// `globalThis` es para que el recargado en caliente de desarrollo no abra una
// conexión nueva por cada cambio de archivo — mismo motivo que en `lib/db.ts`,
// pero con su propia variable para no pisar la del stock.
const adapter = new PrismaBetterSqlite3({
  url: process.env.COMPROBANTES_DATABASE_URL ?? "file:./dev-comprobantes.db",
});

const globalForPrisma = globalThis as unknown as { prismaComprobantes?: PrismaClient };

export const prismaComprobantes = globalForPrisma.prismaComprobantes ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaComprobantes = prismaComprobantes;
```

- [ ] **Step 5: Enganchar los dos esquemas en los scripts**

En `package.json`, reemplazar estas dos líneas:

```json
"start:prod": "prisma migrate deploy && next start",
"postinstall": "prisma generate",
```

por:

```json
"start:prod": "prisma migrate deploy && prisma migrate deploy --config ./prisma-comprobantes.config.ts && next start",
"postinstall": "prisma generate && prisma generate --config ./prisma-comprobantes.config.ts",
```

Sin esto el despliegue arranca con la base de comprobantes vacía y sin cliente generado, y falla recién en la primera captura.

- [ ] **Step 6: Escribir la prueba del esquema**

Crear `tests/comprobantes-esquema.test.ts`:

```typescript
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Que la segunda base exista, migre sola y sostenga las tres promesas que el
 * resto del módulo da por sentadas: importes exactos en centavos, una factura
 * electrónica no se puede duplicar, y un remito sí se puede repetir.
 */

const DB = path.join(os.tmpdir(), `didier-test-comprobantes-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;

before(async () => {
  fs.rmSync(DB, { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "./prisma-comprobantes.config.ts"], {
    env: { ...process.env, COMPROBANTES_DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/comprobantes/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
});

after(async () => {
  await prisma?.$disconnect();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* se lo lleva el sistema */
    }
  }
});

test("un importe en centavos vuelve exacto", async () => {
  // $2.231.811,45 — la factura de CCU del 27/08/2026, un caso real.
  const CENTAVOS = 223181145n;
  const creado = await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", importeTotal: CENTAVOS, clientKey: "k-centavos" },
  });
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: creado.id } });
  assert.equal(leido.importeTotal, CENTAVOS);
});

test("la misma factura electrónica no entra dos veces", async () => {
  const identidad = {
    cuitEmisor: "30500001735",
    tipoCbte: "A",
    puntoVenta: 1040,
    numero: 6515,
  };
  await prisma.document.create({
    data: { ...identidad, kind: "FACTURA", source: "QR", clientKey: "k-dup-1" },
  });
  await assert.rejects(
    prisma.document.create({
      data: { ...identidad, kind: "FACTURA", source: "ARCA", clientKey: "k-dup-2" },
    }),
    /[Uu]nique/,
  );
});

test("dos remitos sin identidad fiscal conviven", async () => {
  // Los cuatro campos en NULL: SQLite admite repetidos en un índice único, y
  // eso es lo correcto — un remito no tiene identidad fiscal que deduplicar.
  await prisma.document.create({ data: { kind: "REMITO", source: "MANUAL", clientKey: "k-rem-1" } });
  await prisma.document.create({ data: { kind: "REMITO", source: "MANUAL", clientKey: "k-rem-2" } });
  const cuantos = await prisma.document.count({ where: { kind: "REMITO" } });
  assert.equal(cuantos, 2);
});
```

- [ ] **Step 7: Correr la prueba**

Run: `npx tsx --test tests/comprobantes-esquema.test.ts`
Expected: PASS, 3 pruebas.

- [ ] **Step 8: Commit**

```bash
git add prisma/comprobantes prisma-comprobantes.config.ts lib/db-comprobantes.ts package.json .gitignore tests/comprobantes-esquema.test.ts
git commit -m "Darle base propia a los comprobantes"
```

---

### Task 2: Los importes en centavos

Lógica pura, sin base de datos. Se hace temprano porque todo lo que lee un importe depende de esto, y porque es donde un error no se nota hasta que la suma de un proveedor da mal.

**Files:**
- Create: `lib/money.ts`
- Test: `tests/comprobantes-money.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `aCentavos(texto: string, opts?: { puntoEsDecimal?: boolean }): bigint | null`
  - `formatear(centavos: bigint): string`
  - `aTextoPlano(centavos: bigint): string`
  - `sumar(valores: bigint[]): bigint`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-money.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { aCentavos, formatear, aTextoPlano, sumar } from "../lib/money";

/**
 * La plata se guarda en centavos enteros porque el punto flotante no suma
 * plata. Lo que se protege acá es que el número que dice el papel sea
 * exactamente el número que queda en la base, venga en el formato que venga:
 * los importes de estos archivos conviven en varios formatos, con coma o punto
 * decimal y con o sin separador de miles.
 */

test("lee el formato argentino con separador de miles", () => {
  assert.equal(aCentavos("2.231.811,45"), 223181145n);
  assert.equal(aCentavos("$ 2.231.811,45"), 223181145n);
  assert.equal(aCentavos("764.107,11"), 76410711n);
});

test("lee el formato con punto decimal, que es como viene el QR", () => {
  assert.equal(aCentavos("2231811.45"), 223181145n);
  assert.equal(aCentavos("77736.15"), 7773615n);
});

test("completa los centavos que falten", () => {
  assert.equal(aCentavos("1500"), 150000n);
  assert.equal(aCentavos("1500,5"), 150050n);
});

test("no confunde el separador de miles con el decimal", () => {
  // "1.500" en Argentina es mil quinientos, no uno con medio.
  assert.equal(aCentavos("1.500"), 150000n);
  // Pero "1.500.25" con dos puntos solo puede ser punto decimal al final.
  assert.equal(aCentavos("1500.25"), 150025n);
});

test("aguanta los decimales de relleno que mete un emisor real", () => {
  // Un QR real trae "387124.5100000000000000": 16 decimales, y los 14 ultimos
  // son ceros. Es plata legitima con relleno, no una lectura mala.
  assert.equal(aCentavos("387124.5100000000000000"), 38712451n);
});

test("el punto con tres digitos atras es ambiguo, y lo desempata quien llama", () => {
  // "1500.000" escrito por una persona en Argentina es un millon y medio.
  assert.equal(aCentavos("1500.000"), 150000000n);
  // El mismo texto dentro de un QR o un CSV de ARCA es mil quinientos: ahi el
  // punto SIEMPRE es decimal. La cadena sola no alcanza para decidir; el que
  // sabe de donde vino el dato, si.
  assert.equal(aCentavos("1500.000", { puntoEsDecimal: true }), 150000n);
  assert.equal(aCentavos("2231811.45", { puntoEsDecimal: true }), 223181145n);
});

test("no adivina: lo que no entiende devuelve null", () => {
  assert.equal(aCentavos(""), null);
  assert.equal(aCentavos("  "), null);
  assert.equal(aCentavos("s/d"), null);
  assert.equal(aCentavos("abc"), null);
  // Tres decimales no es plata: es un error de lectura y hay que avisar.
  assert.equal(aCentavos("1500,123"), null);
});

test("no pierde precisión con importes grandes", () => {
  // Arriba del techo de un entero de 32 bits ($21.474.836,47), que es la razón
  // de que la columna sea BigInt y no Int.
  assert.equal(aCentavos("999.999.999,99"), 99999999999n);
});

test("formatea para pantalla en formato argentino", () => {
  assert.equal(formatear(223181145n), "$ 2.231.811,45");
  assert.equal(formatear(0n), "$ 0,00");
  assert.equal(formatear(5n), "$ 0,05");
});

test("aTextoPlano deja el BigInt cruzar a JSON", () => {
  // BigInt no serializa a JSON: `JSON.stringify` tira. Toda server action que
  // devuelva un importe pasa por acá.
  assert.equal(aTextoPlano(223181145n), "223181145");
  assert.doesNotThrow(() => JSON.stringify({ importe: aTextoPlano(223181145n) }));
});

test("suma sin perder un centavo", () => {
  assert.equal(sumar([76410711n, 7773615n]), 84184326n);
  assert.equal(sumar([]), 0n);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-money.test.ts`
Expected: FAIL — no encuentra el módulo `../lib/money`.

- [ ] **Step 3: Escribir la implementación**

Crear `lib/money.ts`:

```typescript
// La plata, en centavos enteros.
//
// Nada de punto flotante: `0.1 + 0.2` no da `0.3` y una suma de proveedor que
// cierra por dos centavos es una suma en la que nadie vuelve a confiar.
//
// Y nada de `number` tampoco, ni siquiera en centavos: el techo de un entero de
// 32 bits son $21.474.836,47, y una factura grande lo pasa en silencio.

const MAX_DECIMALES = 2;

/**
 * Convierte lo que dice un papel —o un QR, o un CSV— a centavos.
 *
 * Devuelve `null` si no lo entiende, a propósito: adivinar es como un sistema
 * empieza a mentir. Quien llama decide si eso es un error o un campo vacío.
 */
export function aCentavos(
  texto: string,
  opts: { puntoEsDecimal?: boolean } = {},
): bigint | null {
  if (typeof texto !== "string") return null;

  // Fuera el símbolo de moneda, los espacios (incluido el fino que mete Excel)
  // y el signo, que acá no existe: el signo lo decide el tipo de comprobante.
  const limpio = texto.replace(/[$\s  ]/g, "").replace(/^[+-]/, "");
  if (!limpio) return null;
  if (!/^[\d.,]+$/.test(limpio)) return null;

  const separador = ultimoSeparadorDecimal(limpio, opts.puntoEsDecimal === true);
  const [enteroCrudo, decimalCrudo] =
    separador === null
      ? [limpio, ""]
      : [limpio.slice(0, separador), limpio.slice(separador + 1)];

  // Los separadores de miles se descartan; lo que quede tiene que ser dígitos.
  const entero = enteroCrudo.replace(/[.,]/g, "");
  if (!/^\d*$/.test(entero) || !/^\d*$/.test(decimalCrudo)) return null;
  if (entero === "" && decimalCrudo === "") return null;

  // Mas de dos decimales se acepta SOLO si lo que sobra son ceros: un emisor
  // real imprime "387124.5100000000000000", que es plata legitima con relleno.
  // Con cualquier otro digito atras es una lectura mal hecha, y hay que avisar.
  if (decimalCrudo.length > MAX_DECIMALES) {
    if (!/^0*$/.test(decimalCrudo.slice(MAX_DECIMALES))) return null;
  }

  const decimal = decimalCrudo.slice(0, MAX_DECIMALES).padEnd(MAX_DECIMALES, "0");
  return BigInt(`${entero || "0"}${decimal}`);
}

/**
 * Dónde está el separador decimal, si es que hay uno.
 *
 * Los dos formatos que llegan de verdad se contradicen, así que la regla mira
 * QUÉ separador es y no solo cuántos dígitos tiene detrás:
 *
 * - La **coma** siempre es decimal. Es el formato argentino del papel y de los
 *   CSV en es-AR.
 * - El **punto** es decimal salvo que le sigan exactamente tres dígitos, que es
 *   la forma de un grupo de miles. Por eso "1.500" son mil quinientos y no uno
 *   y medio, pero "387124.5100000000000000" —que sale de un QR real— sí es
 *   decimal.
 *
 * Un grupo de miles nunca tiene más de tres dígitos, así que con cuatro o más
 * detrás no hay ambigüedad posible.
 *
 * Queda un caso que la cadena sola NO puede resolver: "1500.000" es un millón y
 * medio si lo escribió una persona, y mil quinientos si viene de un QR o de un
 * CSV de ARCA, donde el punto siempre es decimal. Por eso `puntoEsDecimal` lo
 * decide quien llama, que es el único que sabe de dónde salió el dato.
 */
function ultimoSeparadorDecimal(s: string, puntoEsDecimal: boolean): number | null {
  const i = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (i === -1) return null;
  if (s[i] === "," || puntoEsDecimal) return i;
  return s.length - i - 1 === 3 ? null : i;
}

/** Para pantalla, en formato argentino: `$ 2.231.811,45`. */
export function formatear(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const entero = abs / 100n;
  const resto = (abs % 100n).toString().padStart(2, "0");
  const conMiles = entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}$ ${conMiles},${resto}`;
}

/**
 * El paso obligatorio antes de que un importe cruce del servidor al navegador.
 * `JSON.stringify` de un BigInt tira; verificado contra Prisma 7.
 */
export function aTextoPlano(centavos: bigint): string {
  return centavos.toString();
}

export function sumar(valores: bigint[]): bigint {
  return valores.reduce((a, b) => a + b, 0n);
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-money.test.ts`
Expected: PASS, 9 pruebas.

- [ ] **Step 5: Commit**

```bash
git add lib/money.ts tests/comprobantes-money.test.ts
git commit -m "Guardar la plata en centavos enteros"
```

---

### Task 3: Los dos roles nuevos

**Files:**
- Modify: `lib/permissions.ts`
- Test: `tests/comprobantes-permisos.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `"RECEPCION"` y `"PAGOS"` en `ROLES`, más `canCapturarComprobantes(role)`, `canVerImportes(role)`, `canPagar(role)`, `canAdministrarComprobantes(role)`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-permisos.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLE_LABEL,
  ROLE_HELP,
  canCapturarComprobantes,
  canVerImportes,
  canPagar,
  canAdministrarComprobantes,
} from "../lib/permissions";

/**
 * La matriz del módulo de comprobantes, entera y con los `false` escritos,
 * igual que la de `permissions.test.ts`: de un permiso importa sobre todo lo
 * que NO deja hacer.
 *
 * La fila que sostiene el diseño es RECEPCION con `canVerImportes: false`. El
 * depósito saca la foto y nunca recibe un importe — no porque la pantalla lo
 * esconda, sino porque el dato no sale del servidor.
 */
const MATRIZ = {
  ADMIN:      { capturar: true,  verImportes: true,  pagar: true,  administrar: true },
  RECEPCION:  { capturar: true,  verImportes: false, pagar: false, administrar: false },
  PAGOS:      { capturar: false, verImportes: true,  pagar: true,  administrar: false },
  ARMADOR:    { capturar: false, verImportes: false, pagar: false, administrar: false },
  LOGISTICA:  { capturar: false, verImportes: false, pagar: false, administrar: false },
} as const;

for (const [rol, esperado] of Object.entries(MATRIZ)) {
  test(`permisos de comprobantes para ${rol}`, () => {
    assert.equal(canCapturarComprobantes(rol), esperado.capturar);
    assert.equal(canVerImportes(rol), esperado.verImportes);
    assert.equal(canPagar(rol), esperado.pagar);
    assert.equal(canAdministrarComprobantes(rol), esperado.administrar);
  });
}

test("un rol inventado no puede nada", () => {
  for (const fn of [canCapturarComprobantes, canVerImportes, canPagar, canAdministrarComprobantes]) {
    assert.equal(fn("SUPERUSUARIO"), false);
    assert.equal(fn(""), false);
  }
});

test("los roles nuevos están registrados y tienen nombre", () => {
  assert.ok(ROLES.includes("RECEPCION"));
  assert.ok(ROLES.includes("PAGOS"));
  for (const r of ROLES) {
    assert.ok(ROLE_LABEL[r], `falta el nombre de ${r}`);
    assert.ok(ROLE_HELP[r], `falta la descripción de ${r}`);
  }
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-permisos.test.ts`
Expected: FAIL — `canCapturarComprobantes is not a function`.

- [ ] **Step 3: Ampliar `lib/permissions.ts`**

Reemplazar la línea de `ROLES` por:

```typescript
export const ROLES = ["ADMIN", "ARMADOR", "LOGISTICA", "RECEPCION", "PAGOS"] as const;
```

Agregar a `ROLE_LABEL`:

```typescript
  RECEPCION: "Recepción de mercadería",
  PAGOS: "Pagos a proveedores",
```

Agregar a `ROLE_HELP`:

```typescript
  RECEPCION: "Fotografía los comprobantes que llegan",
  PAGOS: "Ve qué se debe y qué vence, y marca lo pagado",
```

Y al final del archivo, antes de la sección de notificaciones:

```typescript
// ---------------------------------------------------------------------------
// Comprobantes de proveedores
// ---------------------------------------------------------------------------

/** Sacarle la foto a un comprobante que llega con la mercadería. */
export function canCapturarComprobantes(role: string): boolean {
  return role === "ADMIN" || role === "RECEPCION";
}

/** Ver importes, deuda y vencimientos.
 *
 *  Es el permiso más importante del módulo y el único que se apoya en algo más
 *  que la costumbre: quien recibe la mercadería no tiene por qué saber cuánto
 *  sale. Las acciones que devuelven plata comprueban ESTO antes de armar la
 *  respuesta, así que a un teléfono de depósito el número no le llega nunca. */
export function canVerImportes(role: string): boolean {
  return role === "ADMIN" || role === "PAGOS";
}

/** Cargar el vencimiento del papel y marcar comprobantes como pagados. */
export function canPagar(role: string): boolean {
  return role === "ADMIN" || role === "PAGOS";
}

/** Dar de alta proveedores, fusionar duplicados, corregir vínculos, importar
 *  el CSV de ARCA y ver el historial de cambios. */
export function canAdministrarComprobantes(role: string): boolean {
  return role === "ADMIN";
}
```

- [ ] **Step 4: Correr las dos suites de permisos**

Run: `npx tsx --test tests/comprobantes-permisos.test.ts tests/permissions.test.ts`
Expected: PASS las dos. La vieja también, porque agregar roles no cambia lo que podían hacer los existentes. **Si `permissions.test.ts` falla, no aflojar la prueba: revisar qué se rompió.**

- [ ] **Step 5: Commit**

```bash
git add lib/permissions.ts tests/comprobantes-permisos.test.ts
git commit -m "Separar quien recibe la mercadería de quien la paga"
```

---

### Task 4: El lector del QR de AFIP

> **Lo que este lector NO puede hacer: usar `JSON.parse`.** De cinco QR sacados
> de comprobantes reales el 01/09/2026, **dos no son JSON válido**. Uno trae
> ceros a la izquierda (`"tipoCmp":01`); el otro viene sin comillas, con guiones
> en el CUIT, la fecha en `DD-MM-YYYY` y **sin `nroCmp`**. Un lector que parsea
> JSON funciona en las pruebas y falla en el depósito casi la mitad de las veces.
>
> Las muestras ya están en `tests/fixtures/qr-muestras.ts`, con los valores
> cambiados y las patologías intactas.

**Files:**
- Create: `lib/comprobantes/tipos.ts`
- Create: `lib/comprobantes/qr.ts`
- Test: `tests/comprobantes-qr.test.ts`
- Usa: `tests/fixtures/qr-muestras.ts` (ya existe)

**Interfaces:**
- Consumes: `aCentavos` de `lib/money.ts`.
- Produces:
  - `type Cabecera`, `type Fuente`, `type Kind`, `type Destino` en `lib/comprobantes/tipos.ts`
  - `leerQr(texto: string): Cabecera | null`
  - `elegirQrDeFactura(textos: string[]): string | null`
  - `CUIT_PROPIO: string` y `esParaNosotros(c: Cabecera): boolean | null`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-qr.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerQr, elegirQrDeFactura, esParaNosotros } from "../lib/comprobantes/qr";
import { QR_MUESTRAS, QR_QUE_NO_SON_FACTURA } from "./fixtures/qr-muestras";

/**
 * El QR de la RG 4892. La regla que ordena esta unidad salió de mirar
 * comprobantes reales: **el emisor no siempre genera JSON válido**, así que el
 * lector extrae campo por campo en vez de parsear.
 *
 * Cada caso de acá es una factura que llegó al depósito de verdad.
 */

const porNombre = (n: string) => QR_MUESTRAS.find((m) => m.nombre === n)!.url;

test("lee un QR bien formado", () => {
  const c = leerQr(porNombre("sano"));
  assert.ok(c);
  assert.equal(c.cuitEmisor, "20999999993");
  assert.equal(c.tipoCbte, "A");
  assert.equal(c.puntoVenta, 6);
  assert.equal(c.numero, 57875);
  assert.equal(c.fechaEmision, "2026-08-27");
  assert.equal(c.importeTotal, 76410711n);
  assert.equal(c.cae, "86350106990468");
  assert.equal(c.fuente, "QR");
});

test("un CRLF al final no lo rompe", () => {
  const c = leerQr(porNombre("sanoConSaltoDeLinea"));
  assert.equal(c?.numero, 38604);
  assert.equal(c?.importeTotal, 31000001n);
});

test("lee el que tiene ceros a la izquierda, que NO es JSON válido", () => {
  const c = leerQr(porNombre("cerosALaIzquierda"));
  assert.ok(c, "este payload rompe JSON.parse: el lector no puede depender de él");
  assert.equal(c.tipoCbte, "A");     // venía "01"
  assert.equal(c.numero, 46293);     // venía "00046293"
  assert.equal(c.puntoVenta, 4552);
  assert.equal(c.importeTotal, 505020217n);
});

test("lee lo que puede del que viene sin comillas y con guiones", () => {
  const c = leerQr(porNombre("sinComillasNiNumero"));
  assert.ok(c);
  assert.equal(c.cuitEmisor, "9062901503");   // venía "906-290150-3"
  assert.equal(c.fechaEmision, "2026-08-11"); // venía "11-08-2026"
  assert.equal(c.importeTotal, 38712451n);
  // No trae nroCmp: no se inventa. Sin número no hay identidad, y el
  // comprobante va a caer en el peldaño de completar a mano.
  assert.equal(c.numero, undefined);
});

test("el importe no pasa nunca por el flotante", () => {
  // "387124.5100000000000000" — 16 decimales. Multiplicar por 100 en flotante
  // es exactamente donde se pierden centavos.
  assert.equal(leerQr(porNombre("sinComillasNiNumero"))?.importeTotal, 38712451n);
});

test("de varios QR en la misma foto elige el de factura", () => {
  const enLaFoto = [...QR_QUE_NO_SON_FACTURA, porNombre("sano")];
  assert.equal(elegirQrDeFactura(enLaFoto), porNombre("sano"));
  // El de Data Fiscal es de afip.gob.ar y NO es una factura: no alcanza con
  // mirar el dominio.
  assert.equal(elegirQrDeFactura(QR_QUE_NO_SON_FACTURA), null);
});

test("no acepta cualquier cosa que traiga la cámara", () => {
  assert.equal(leerQr(""), null);
  assert.equal(leerQr("https://ejemplo.com"), null);
  assert.equal(leerQr("https://www.afip.gob.ar/fe/qr/?p=no-es-base64!!"), null);
  for (const otro of QR_QUE_NO_SON_FACTURA) assert.equal(leerQr(otro), null);
});

test("avisa cuando la factura no está a nombre de la empresa", () => {
  // Los cinco QR reales traen nroDocRec con el CUIT propio. Es un control
  // gratis contra fotografiar la factura de otro.
  assert.equal(esParaNosotros(leerQr(porNombre("sano"))!), true);
  assert.equal(esParaNosotros({ fuente: "QR", cuitReceptor: "20111111112" }), false);
  // Sin dato no se afirma nada: null no es false.
  assert.equal(esParaNosotros({ fuente: "MANUAL" }), null);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-qr.test.ts`
Expected: FAIL — no encuentra `../lib/comprobantes/qr`.

- [ ] **Step 3: Escribir los tipos**

Crear `lib/comprobantes/tipos.ts`:

```typescript
/** Lo que un lector logró sacar de un comprobante. Todo opcional salvo la
 *  fuente, porque cada peldaño de la cascada saca menos que el anterior — y
 *  porque hay QR reales que vienen sin número. */
export type Cabecera = {
  fuente: Fuente;
  cuitEmisor?: string;
  /** A nombre de quién está la factura. Sirve para avisar si alguien
   *  fotografía la de otra empresa. */
  cuitReceptor?: string;
  tipoCbte?: string;
  puntoVenta?: number;
  numero?: number;
  fechaEmision?: string; // "AAAA-MM-DD"
  importeTotal?: bigint; // centavos
  cae?: string;
  caeVence?: string; // NO es el vencimiento del pago
};

/** Un valor por peldaño de la cascada de identificación. */
export type Fuente = "ARCA" | "QR" | "EMPAREJADO" | "LECTURA" | "MANUAL";

export type Kind = "FACTURA" | "REMITO" | "TICKET" | "NOTA_CREDITO" | "NOTA_DEBITO" | "OTRO";

export type Destino = "COCINA" | "DEPOSITO" | "OTRO";
```

- [ ] **Step 4: Escribir el lector**

Crear `lib/comprobantes/qr.ts`:

```typescript
import { aCentavos } from "@/lib/money";
import type { Cabecera } from "./tipos";

// El QR de la RG 4892/2020: una URL de AFIP con un JSON en base64.
//
// **No se usa `JSON.parse`, y no es por gusto.** De cinco QR sacados de
// comprobantes reales, dos no son JSON válido: uno trae ceros a la izquierda
// (`"tipoCmp":01`) y otro viene sin comillas, con el CUIT separado por guiones
// y la fecha al revés. Un lector estricto los descarta a los dos, y son casi la
// mitad de los que llegan.
//
// Por eso se extrae campo por campo, tolerando lo que el emisor haya impreso.

/** El CUIT de la empresa. Aparece como `nroDocRec` en todas las facturas que le
 *  emiten, y con eso se puede avisar si alguien fotografió la de otro. */
export const CUIT_PROPIO = "30717737489";

const TIPOS: Record<number, string> = {
  1: "A", 2: "NOTA_DEBITO_A", 3: "NOTA_CREDITO_A",
  6: "B", 7: "NOTA_DEBITO_B", 8: "NOTA_CREDITO_B",
  11: "C", 12: "NOTA_DEBITO_C", 13: "NOTA_CREDITO_C",
  51: "M", 201: "A", 206: "B", 211: "C",
};

/**
 * De todos los QR que la cámara vio en una foto, cuál es el de la factura.
 *
 * Una foto trae varios: el de AFIP, uno de marketing del proveedor, y a veces
 * el de Data Fiscal —que también es de `afip.gob.ar` pero NO identifica un
 * comprobante—. No alcanza con mirar el dominio.
 */
export function elegirQrDeFactura(textos: string[]): string | null {
  return textos.find((t) => payloadDe(t) !== null) ?? null;
}

export function leerQr(texto: string): Cabecera | null {
  const payload = payloadDe(texto);
  if (payload === null) return null;

  let crudo: string;
  try {
    crudo = Buffer.from(payload, "base64").toString("utf8").trim();
  } catch {
    return null;
  }
  if (!crudo.includes("cuit")) return null;

  const cuit = soloDigitos(campo(crudo, "cuit"));
  const ptoVta = aEntero(campo(crudo, "ptoVta"));
  const tipoCmp = aEntero(campo(crudo, "tipoCmp"));
  // Hay QR reales SIN nroCmp. No se inventa: sin número no hay identidad y el
  // comprobante cae en el peldaño de completar a mano.
  const nroCmp = aEntero(campo(crudo, "nroCmp"));
  const fecha = aFechaIso(campo(crudo, "fecha"));

  if (!cuit || ptoVta === null || tipoCmp === null) return null;

  return {
    fuente: "QR",
    cuitEmisor: cuit,
    cuitReceptor: soloDigitos(campo(crudo, "nroDocRec")) || undefined,
    tipoCbte: TIPOS[tipoCmp] ?? String(tipoCmp),
    puntoVenta: ptoVta,
    numero: nroCmp ?? undefined,
    fechaEmision: fecha ?? undefined,
    // El payload es de máquina: acá el punto SIEMPRE es decimal.
    importeTotal: aCentavos(campo(crudo, "importe") ?? "", { puntoEsDecimal: true }) ?? undefined,
    cae: soloDigitos(campo(crudo, "codAut")) || undefined,
  };
}

/** `true` si la factura está a nombre de la empresa, `false` si es de otra,
 *  `null` si el comprobante no lo dice. Null no es false: no saber y saber que
 *  no, son cosas distintas. */
export function esParaNosotros(c: Cabecera): boolean | null {
  if (!c.cuitReceptor) return null;
  return c.cuitReceptor === CUIT_PROPIO;
}

// --- ayudas privadas -------------------------------------------------------

/** El parámetro `p` de una URL de QR **de factura**. El de Data Fiscal usa otro
 *  host y otro parámetro, así que queda descartado acá mismo. */
function payloadDe(texto: string): string | null {
  if (typeof texto !== "string" || !texto) return null;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.hostname !== "www.afip.gob.ar" && url.hostname !== "afip.gob.ar") return null;
  if (!url.pathname.startsWith("/fe/qr")) return null;
  const p = url.searchParams.get("p");
  if (!p || !/^[A-Za-z0-9+/=_-]+$/.test(p)) return null;
  return p.replace(/-/g, "+").replace(/_/g, "/");
}

/**
 * El valor crudo de un campo, del TEXTO y no de un objeto parseado.
 *
 * Sirve igual para `"cuit":30597532381`, `"cuit":906-290150-3` y
 * `"moneda":"PES"`. Y el importe sale de acá sin pasar por un flotante, que es
 * donde se pierden los centavos.
 */
function campo(json: string, nombre: string): string | null {
  const m = new RegExp(`"${nombre}"\\s*:\\s*"?([^",}\\s]*)"?`).exec(json);
  return m ? m[1] : null;
}

function soloDigitos(v: string | null): string {
  return v ? v.replace(/\D/g, "") : "";
}

function aEntero(v: string | null): number | null {
  const d = soloDigitos(v);
  return d === "" ? null : Number(d);
}

/** Acepta `"2026-08-27"` y también `11-08-2026`, que es como lo imprime al
 *  menos un emisor. Devuelve siempre `AAAA-MM-DD`. */
function aFechaIso(v: string | null): string | null {
  if (!v) return null;
  let a: string, m: string, d: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const criollo = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  if (iso) [, a, m, d] = iso;
  else if (criollo) [, d, m, a] = criollo;
  else return null;

  const f = new Date(Date.UTC(+a, +m - 1, +d));
  if (f.getUTCFullYear() !== +a || f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null;
  return `${a}-${m}-${d}`;
}
```

- [ ] **Step 5: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-qr.test.ts`
Expected: PASS, 8 pruebas.

- [ ] **Step 6: Commit**

```bash
git add lib/comprobantes/tipos.ts lib/comprobantes/qr.ts tests/comprobantes-qr.test.ts tests/fixtures/qr-muestras.ts
git commit -m "Leer el QR aunque el emisor lo genere mal"
```

---

### Task 5: Guardar una captura

El corazón del módulo. Acá se cumple la regla que ordena todo: **la foto se guarda pase lo que pase**.

**Files:**
- Create: `lib/comprobantes/almacenamiento.ts`
- Create: `lib/comprobantes/documentos.ts`
- Test: `tests/comprobantes-documentos.test.ts`

**Interfaces:**
- Consumes: `prismaComprobantes`, `type Cabecera`, `type Destino`, `type Kind`.
- Produces, en `lib/comprobantes/documentos.ts`:
  - `guardarCaptura(input: EntradaCaptura): Promise<ResultadoCaptura>`
  - `type EntradaCaptura = { clientKey: string; kind: Kind; cabecera: Cabecera; destino?: Destino; destinoNota?: string; conforme?: boolean; actor: { id: string; name: string }; adjuntos: DatosAdjunto[] }`
  - `type DatosAdjunto = { s3Key: string; mimeType: string; sizeBytes: number }`
  - `type ResultadoCaptura = { documentId: string; fusionado: boolean; yaExistia: boolean }`
- Produces, en `lib/comprobantes/almacenamiento.ts`:
  - `subirFoto(bytes: Buffer, mimeType: string, hoy: string): Promise<{ s3Key: string; sizeBytes: number }>` — `hoy` en `"AAAA-MM-DD"`, para la carpeta por año y mes

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-documentos.test.ts`:

```typescript
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Guardar una captura. Las tres promesas que se protegen acá son las que
 * sostienen la adopción del módulo:
 *
 * 1. La foto queda SIEMPRE, aunque no se haya podido identificar nada.
 * 2. El doble toque de un dedo apurado no crea dos comprobantes.
 * 3. Que dos personas fotografíen la misma factura no es un error: es una
 *    fusión. En un depósito va a pasar seguido, y tratarlo como error es la
 *    forma más rápida de que dejen de usar la app.
 */

const DB = path.join(os.tmpdir(), `didier-test-docs-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let docs: typeof import("../lib/comprobantes/documentos");

const PABLO = { id: "u-pablo", name: "Pablo" };
const foto = (s3Key: string) => [{ s3Key, mimeType: "image/jpeg", sizeBytes: 900_000 }];

before(async () => {
  fs.rmSync(DB, { force: true });
  process.env.COMPROBANTES_DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "./prisma-comprobantes.config.ts"], {
    env: { ...process.env, COMPROBANTES_DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/comprobantes/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  docs = await import("../lib/comprobantes/documentos");
});

beforeEach(async () => {
  await prisma.attachment.deleteMany();
  await prisma.documentChange.deleteMany();
  await prisma.document.deleteMany();
  await prisma.supplier.deleteMany();
});

after(async () => {
  await prisma?.$disconnect();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* se lo lleva el sistema */
    }
  }
});

test("una foto que no se pudo identificar se guarda igual", async () => {
  const r = await docs.guardarCaptura({
    clientKey: "k1",
    kind: "FACTURA",
    cabecera: { fuente: "MANUAL" },
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/a.jpg"),
  });

  const d = await prisma.document.findUniqueOrThrow({
    where: { id: r.documentId },
    include: { attachments: true },
  });
  assert.equal(d.attachments.length, 1);
  assert.equal(d.cuitEmisor, null);
  assert.equal(d.capturedByName, "Pablo");
  // Lo que falta se pregunta con nulos, no con una columna de estado.
  assert.equal(d.supplierId, null);
  assert.equal(d.conforme, null);
});

test("el doble toque no crea dos comprobantes", async () => {
  const entrada = {
    clientKey: "k-doble",
    kind: "REMITO" as const,
    cabecera: { fuente: "MANUAL" as const },
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/b.jpg"),
  };
  const uno = await docs.guardarCaptura(entrada);
  const dos = await docs.guardarCaptura(entrada);

  assert.equal(dos.documentId, uno.documentId);
  assert.equal(dos.yaExistia, true);
  assert.equal(await prisma.document.count(), 1);
  // Y no duplica la foto.
  assert.equal(await prisma.attachment.count(), 1);
});

test("dos personas fotografían la misma factura: se fusiona", async () => {
  const identidad = {
    fuente: "QR" as const,
    cuitEmisor: "30500001735",
    tipoCbte: "A",
    puntoVenta: 1040,
    numero: 6515,
    fechaEmision: "2026-08-27",
    importeTotal: 223181145n,
  };
  const primero = await docs.guardarCaptura({
    clientKey: "k-p", kind: "FACTURA", cabecera: identidad,
    actor: PABLO, adjuntos: foto("fotos/2026/09/c1.jpg"),
  });
  const segundo = await docs.guardarCaptura({
    clientKey: "k-s", kind: "FACTURA", cabecera: identidad,
    actor: { id: "u-nico", name: "Nico" }, adjuntos: foto("fotos/2026/09/c2.jpg"),
  });

  assert.equal(segundo.documentId, primero.documentId);
  assert.equal(segundo.fusionado, true);
  assert.equal(await prisma.document.count({ where: { deletedAt: null } }), 1);

  // La segunda foto entra como página 2 del mismo comprobante.
  const adj = await prisma.attachment.findMany({
    where: { documentId: primero.documentId },
    orderBy: { page: "asc" },
  });
  assert.equal(adj.length, 2);
  assert.deepEqual(adj.map((a) => a.page), [1, 2]);
});

test("el destino y el conforme se guardan cuando vienen", async () => {
  const r = await docs.guardarCaptura({
    clientKey: "k-dest", kind: "FACTURA",
    cabecera: { fuente: "MANUAL" },
    destino: "COCINA", conforme: false, destinoNota: undefined,
    actor: PABLO, adjuntos: foto("fotos/2026/09/d.jpg"),
  });
  const d = await prisma.document.findUniqueOrThrow({ where: { id: r.documentId } });
  assert.equal(d.destino, "COCINA");
  assert.equal(d.conforme, false); // false NO es lo mismo que null
});

test("el alta queda en el historial", async () => {
  const r = await docs.guardarCaptura({
    clientKey: "k-hist", kind: "FACTURA",
    cabecera: { fuente: "QR", cuitEmisor: "30111111118", tipoCbte: "A", puntoVenta: 3, numero: 77 },
    actor: PABLO, adjuntos: foto("fotos/2026/09/e.jpg"),
  });
  const cambios = await prisma.documentChange.findMany({ where: { documentId: r.documentId } });
  assert.ok(cambios.length >= 1);
  assert.equal(cambios[0].actorName, "Pablo");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-documentos.test.ts`
Expected: FAIL — no encuentra `../lib/comprobantes/documentos`.

- [ ] **Step 3: Escribir el almacenamiento**

Crear `lib/comprobantes/almacenamiento.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

// Las fotos de los comprobantes viven en S3, no en la base.
//
// Usan las mismas credenciales que el respaldo (`BACKUP_S3_*`) pero **otro
// prefijo**: `comprobantes/`. El respaldo borra lo que pasa de 14 días dentro
// de `backups/`, y una foto de una factura no se puede borrar a los 14 días.

const PREFIJO = "comprobantes/";

function s3() {
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

const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Sube una foto y devuelve su clave. Tira si no puede: quien llama tiene que
 * enterarse, porque un comprobante sin foto es justo lo que este módulo vino a
 * evitar. Lo que NO puede pasar es que la foto se pierda en silencio.
 */
export async function subirFoto(
  bytes: Buffer,
  mimeType: string,
  hoy: string,
): Promise<{ s3Key: string; sizeBytes: number }> {
  const ext = EXTENSIONES[mimeType];
  if (!ext) throw new Error(`Tipo de archivo no admitido: ${mimeType}`);

  const cliente = s3();
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!cliente || !bucket) throw new Error("Almacenamiento no configurado (faltan variables BACKUP_S3_*).");

  // Carpeta por año y mes: hace navegable el bucket a mano el día que haga
  // falta, sin depender de la base.
  const [anio, mes] = hoy.split("-");
  const s3Key = `${PREFIJO}${anio}/${mes}/${randomUUID()}.${ext}`;

  await cliente.send(
    new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: bytes, ContentType: mimeType }),
  );
  return { s3Key, sizeBytes: bytes.byteLength };
}
```

- [ ] **Step 4: Escribir el alta de comprobantes**

Crear `lib/comprobantes/documentos.ts`:

```typescript
import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import type { Cabecera, Destino, Kind } from "./tipos";

export type DatosAdjunto = { s3Key: string; mimeType: string; sizeBytes: number };

export type EntradaCaptura = {
  /** Se genera al abrir la cámara. Es lo que hace que un doble toque —o un
   *  reintento al volver la señal— no cree dos comprobantes. */
  clientKey: string;
  kind: Kind;
  cabecera: Cabecera;
  destino?: Destino;
  destinoNota?: string;
  conforme?: boolean;
  actor: { id: string; name: string };
  adjuntos: DatosAdjunto[];
};

export type ResultadoCaptura = {
  documentId: string;
  /** La captura se sumó a un comprobante que ya existía por su identidad
   *  fiscal: otra persona lo había fotografiado, o ya vino de ARCA. */
  fusionado: boolean;
  /** Es exactamente la misma captura, repetida. Doble toque o reintento. */
  yaExistia: boolean;
};

/**
 * Guarda una captura.
 *
 * La regla que manda: **la foto queda pase lo que pase**. Que el QR no se lea,
 * que el proveedor no exista todavía, que no se sepa el destino — nada de eso
 * puede impedir que el comprobante entre. Un papel fotografiado y sin
 * identificar ya es mejor que un papel sobre un escritorio.
 */
export async function guardarCaptura(input: EntradaCaptura): Promise<ResultadoCaptura> {
  const { cabecera: c } = input;

  // 1. ¿Es la misma captura otra vez? (doble toque, reintento de red)
  const repetida = await db.document.findUnique({ where: { clientKey: input.clientKey } });
  if (repetida) return { documentId: repetida.id, fusionado: false, yaExistia: true };

  // 2. ¿Ya existe este comprobante por su identidad fiscal?
  //    Solo se busca si la identidad está completa: con algún campo en NULL no
  //    identifica nada, y buscar por identidad parcial fusionaría comprobantes
  //    distintos.
  const existente = tieneIdentidad(c)
    ? await db.document.findFirst({
        where: {
          cuitEmisor: c.cuitEmisor,
          tipoCbte: c.tipoCbte,
          puntoVenta: c.puntoVenta,
          numero: c.numero,
          deletedAt: null,
        },
      })
    : null;

  if (existente) return fusionar(existente.id, input);

  const creado = await db.document.create({
    data: {
      kind: input.kind,
      source: c.fuente,
      cuitEmisor: c.cuitEmisor ?? null,
      tipoCbte: c.tipoCbte ?? null,
      puntoVenta: c.puntoVenta ?? null,
      numero: c.numero ?? null,
      fechaEmision: c.fechaEmision ?? null,
      importeTotal: c.importeTotal ?? null,
      cae: c.cae ?? null,
      caeVence: c.caeVence ?? null,
      destino: input.destino ?? null,
      destinoNota: input.destinoNota ?? null,
      // `undefined` deja el campo en NULL, que significa "nadie revisó".
      // `false` significa "revisó y faltaban cosas". No son lo mismo.
      conforme: input.conforme ?? null,
      capturedById: input.actor.id,
      capturedByName: input.actor.name,
      clientKey: input.clientKey,
      attachments: {
        create: input.adjuntos.map((a, i) => ({
          s3Key: a.s3Key,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          page: i + 1,
          uploadedById: input.actor.id,
        })),
      },
      changes: {
        create: {
          actorId: input.actor.id,
          actorName: input.actor.name,
          field: "alta",
          before: null,
          after: c.fuente,
        },
      },
    },
  });

  return { documentId: creado.id, fusionado: false, yaExistia: false };
}

/**
 * Suma una captura a un comprobante que ya existe.
 *
 * No es un error: en un depósito dos personas van a fotografiar la misma
 * factura, y el mismo comprobante puede llegar por foto y por ARCA. Tratar eso
 * como error es la forma más rápida de que la gente deje de usar la app.
 *
 * Lo que ya está cargado no se pisa. Lo que estaba vacío se completa.
 */
async function fusionar(documentId: string, input: EntradaCaptura): Promise<ResultadoCaptura> {
  const ultima = await db.attachment.findFirst({
    where: { documentId },
    orderBy: { page: "desc" },
  });
  const desde = (ultima?.page ?? 0) + 1;

  await db.attachment.createMany({
    data: input.adjuntos.map((a, i) => ({
      documentId,
      s3Key: a.s3Key,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      page: desde + i,
      uploadedById: input.actor.id,
    })),
  });

  await db.document.update({
    where: { id: documentId },
    data: {
      destino: input.destino ?? undefined,
      destinoNota: input.destinoNota ?? undefined,
      conforme: input.conforme ?? undefined,
    },
  });

  await db.documentChange.create({
    data: {
      documentId,
      actorId: input.actor.id,
      actorName: input.actor.name,
      field: "adjunto",
      before: null,
      after: `${input.adjuntos.length} foto(s)`,
    },
  });

  return { documentId, fusionado: true, yaExistia: false };
}

/** Los cuatro campos que identifican una factura electrónica argentina. Con
 *  uno solo que falte no identifican nada. */
function tieneIdentidad(c: Cabecera): boolean {
  return (
    c.cuitEmisor != null && c.tipoCbte != null && c.puntoVenta != null && c.numero != null
  );
}
```

- [ ] **Step 5: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-documentos.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 6: Commit**

```bash
git add lib/comprobantes/almacenamiento.ts lib/comprobantes/documentos.ts tests/comprobantes-documentos.test.ts
git commit -m "Guardar la foto pase lo que pase"
```

---

### Task 6: Las bandejas y la vista de pagos

**Files:**
- Create: `lib/comprobantes/pagos.ts`
- Test: `tests/comprobantes-pagos.test.ts`

**Interfaces:**
- Consumes: `prismaComprobantes`, `sumar` de `lib/money.ts`.
- Produces:
  - `porProveedor(): Promise<DeudaProveedor[]>` con `type DeudaProveedor = { supplierId: string | null; nombre: string; total: bigint; cantidad: number }`
  - `queVence(desde: string, hasta: string): Promise<DocumentoAPagar[]>`
  - `marcarPagados(ids: string[], cuando: Date, actor: { id: string; name: string }): Promise<number>`
  - `ponerVencimiento(id: string, vencimiento: string, actor: { id: string; name: string }): Promise<void>`
  - `bandejas(): Promise<{ sinProveedor: number; sinRevisar: number; sinVencimiento: number }>`
  - `proponerVencimiento(fechaEmision: string | null, diasPago: number | null): string | null`
  - `posiblesDuplicados(): Promise<PosibleDuplicado[]>`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-pagos.test.ts`:

```typescript
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * La pantalla de Aldana, que es el producto: qué se debe, a quién, y qué vence.
 *
 * Dos reglas del diseño se protegen acá:
 *
 * - **Se paga por proveedor, no por factura.** A veces una, a veces varias en
 *   una transferencia. Por eso el total lo suma el sistema y el marcado es
 *   múltiple: no hace falta conciliar pagos contra comprobantes.
 * - **`vencimiento` sale del "Vto:" del papel y nunca del CAE.** Son fechas
 *   distintas y ya se confundieron una vez (Bitácora.md:415).
 */

const DB = path.join(os.tmpdir(), `didier-test-pagos-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let pagos: typeof import("../lib/comprobantes/pagos");
let donAngel: string;

const ALDANA = { id: "u-aldana", name: "Aldana" };

before(async () => {
  fs.rmSync(DB, { force: true });
  process.env.COMPROBANTES_DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "./prisma-comprobantes.config.ts"], {
    env: { ...process.env, COMPROBANTES_DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/comprobantes/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  pagos = await import("../lib/comprobantes/pagos");
});

beforeEach(async () => {
  await prisma.documentChange.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.supplier.deleteMany();

  const s = await prisma.supplier.create({ data: { name: "DON ANGEL", cuit: "30500001735" } });
  donAngel = s.id;
  // Las dos facturas reales del 27/08/2026: $764.107,11 y $77.736,15.
  await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", supplierId: donAngel, importeTotal: 76410711n,
            vencimiento: "2026-09-11", cuitEmisor: "30500001735", tipoCbte: "A", puntoVenta: 6, numero: 57875 },
  });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", supplierId: donAngel, importeTotal: 7773615n,
            vencimiento: "2026-09-11", cuitEmisor: "30500001735", tipoCbte: "A", puntoVenta: 6, numero: 57876 },
  });
});

after(async () => {
  await prisma?.$disconnect();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* se lo lleva el sistema */
    }
  }
});

test("suma la deuda de un proveedor", async () => {
  const [d] = await pagos.porProveedor();
  assert.equal(d.nombre, "DON ANGEL");
  assert.equal(d.cantidad, 2);
  assert.equal(d.total, 84184326n); // 764.107,11 + 77.736,15
});

test("una nota de crédito resta en vez de sumar", async () => {
  await prisma.document.create({
    data: { kind: "NOTA_CREDITO", source: "QR", supplierId: donAngel, importeTotal: 4184326n,
            cuitEmisor: "30500001735", tipoCbte: "NOTA_CREDITO_A", puntoVenta: 6, numero: 900 },
  });
  const [d] = await pagos.porProveedor();
  assert.equal(d.total, 80000000n); // 84.184.326 - 4.184.326 centavos
});

test("lo pagado deja de contar en la deuda", async () => {
  const uno = await prisma.document.findFirstOrThrow({ where: { numero: 57876 } });
  await pagos.marcarPagados([uno.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  const [d] = await pagos.porProveedor();
  assert.equal(d.cantidad, 1);
  assert.equal(d.total, 76410711n);
});

test("se marcan varias de una vez, que es como se paga de verdad", async () => {
  const todas = await prisma.document.findMany({ select: { id: true } });
  const n = await pagos.marcarPagados(todas.map((d) => d.id), new Date("2026-09-05T12:00:00Z"), ALDANA);

  assert.equal(n, 2);
  assert.deepEqual(await pagos.porProveedor(), []);
});

test("marcar pagado queda en el historial", async () => {
  const uno = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await pagos.marcarPagados([uno.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  const c = await prisma.documentChange.findFirstOrThrow({
    where: { documentId: uno.id, field: "pagadoAt" },
  });
  assert.equal(c.actorName, "Aldana");
});

test("qué vence en un rango, y no lo ya pagado", async () => {
  const antes = await pagos.queVence("2026-09-01", "2026-09-30");
  assert.equal(antes.length, 2);

  const uno = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await pagos.marcarPagados([uno.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  const despues = await pagos.queVence("2026-09-01", "2026-09-30");
  assert.equal(despues.length, 1);
});

test("el vencimiento se carga a mano y queda en el historial", async () => {
  const sinVto = await prisma.document.create({
    data: { kind: "TICKET", source: "MANUAL", supplierId: donAngel, importeTotal: 500000n },
  });
  await pagos.ponerVencimiento(sinVto.id, "2026-09-20", ALDANA);

  const d = await prisma.document.findUniqueOrThrow({ where: { id: sinVto.id } });
  assert.equal(d.vencimiento, "2026-09-20");
  const c = await prisma.documentChange.findFirstOrThrow({
    where: { documentId: sinVto.id, field: "vencimiento" },
  });
  assert.equal(c.after, "2026-09-20");
});

test("no acepta un vencimiento que no es un día", async () => {
  const d = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await assert.rejects(() => pagos.ponerVencimiento(d.id, "11/09/2026", ALDANA), /AAAA-MM-DD/);
  await assert.rejects(() => pagos.ponerVencimiento(d.id, "2026-13-40", ALDANA), /AAAA-MM-DD/);
});

test("propone el vencimiento desde la condicion de pago del proveedor", async () => {
  // Hay facturas que NO traen fecha de vencimiento: la de Dinamark dice
  // "7 DIAS", que es una condicion y no un dato. Se calcula contra la emision.
  assert.equal(pagos.proponerVencimiento("2026-07-28", 7), "2026-08-04");
  // Si el proveedor no tiene condicion cargada, no se inventa nada.
  assert.equal(pagos.proponerVencimiento("2026-07-28", null), null);
  assert.equal(pagos.proponerVencimiento(null, 7), null);
});

test("lo propuesto no se guarda solo", async () => {
  // Proponer es ayudar a quien paga, no decidir por ella. Hasta que alguien
  // confirme, el campo sigue vacio y el comprobante sigue en la bandeja.
  const s = await prisma.supplier.update({ where: { id: donAngel }, data: { diasPago: 7 } });
  const d = await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", supplierId: s.id, importeTotal: 100n,
            fechaEmision: "2026-07-28" },
  });
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.vencimiento, null);
  assert.equal((await pagos.bandejas()).sinVencimiento >= 1, true);
});

test("las bandejas cuentan lo que falta, con nulos y sin columna de estado", async () => {
  await prisma.document.create({
    data: { kind: "REMITO", source: "MANUAL", capturedByName: "Pablo" },
  });
  const b = await pagos.bandejas();
  assert.equal(b.sinProveedor, 1);
  assert.equal(b.sinRevisar, 3); // ninguno de los tres tiene `conforme`
  assert.equal(b.sinVencimiento, 1);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-pagos.test.ts`
Expected: FAIL — no encuentra `../lib/comprobantes/pagos`.

- [ ] **Step 3: Escribir la implementación**

Crear `lib/comprobantes/pagos.ts`:

```typescript
import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { sumarDias } from "@/lib/dates";

// Lo que ve y hace quien paga.
//
// El pago se hace de las dos formas: a veces una factura suelta, a veces
// varias del mismo proveedor en una sola transferencia. Por eso no hay
// conciliación de pagos contra comprobantes: alcanza con que el sistema sume
// por proveedor y con poder marcar varias de una vez.

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Los tipos que RESTAN del saldo en vez de sumar. El importe se guarda
 *  siempre positivo y el signo lo decide el tipo: guardar negativos invita a
 *  cargar una factura común en negativo y descuadrar sin que nadie lo note. */
const RESTAN = new Set(["NOTA_CREDITO"]);

/**
 * El vencimiento que el sistema SUGIERE, sin guardarlo.
 *
 * Hay facturas que no traen fecha: la de Dinamark dice "7 DIAS", que es una
 * condicion de pago y no un dato. La precedencia es siempre la misma:
 *
 *   1. La fecha que dice el papel, si dice una.
 *   2. Si no, emision + `diasPago` del proveedor, marcado como propuesto.
 *   3. Si el proveedor no tiene `diasPago`, queda vacio y cae en la bandeja.
 *
 * Nunca se escribe solo: proponer es ayudar a quien paga, no decidir por ella.
 */
export function proponerVencimiento(
  fechaEmision: string | null,
  diasPago: number | null,
): string | null {
  if (!fechaEmision || diasPago == null) return null;
  return sumarDias(fechaEmision, diasPago);
}

export type DeudaProveedor = {
  supplierId: string | null;
  nombre: string;
  total: bigint;
  cantidad: number;
};

export type DocumentoAPagar = {
  id: string;
  nombre: string;
  importeTotal: bigint | null;
  vencimiento: string | null;
  kind: string;
};

/** Cuánto se le debe a cada proveedor, y en cuántos comprobantes. Es la
 *  pantalla desde la que se transfiere. */
export async function porProveedor(): Promise<DeudaProveedor[]> {
  const docs = await db.document.findMany({
    where: { deletedAt: null, pagadoAt: null },
    include: { supplier: true },
  });

  const acumulado = new Map<string, DeudaProveedor>();
  for (const d of docs) {
    const clave = d.supplierId ?? "";
    const fila = acumulado.get(clave) ?? {
      supplierId: d.supplierId,
      nombre: d.supplier?.name ?? "Sin proveedor",
      total: 0n,
      cantidad: 0,
    };
    const monto = d.importeTotal ?? 0n;
    fila.total += RESTAN.has(d.kind) ? -monto : monto;
    fila.cantidad += 1;
    acumulado.set(clave, fila);
  }

  return [...acumulado.values()].sort((a, b) => (b.total > a.total ? 1 : -1));
}

/** Qué vence entre dos días, de lo que todavía no se pagó. */
export async function queVence(desde: string, hasta: string): Promise<DocumentoAPagar[]> {
  if (!DIA.test(desde) || !DIA.test(hasta)) throw new Error("Las fechas van en AAAA-MM-DD.");

  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      vencimiento: { gte: desde, lte: hasta },
    },
    include: { supplier: true },
    orderBy: { vencimiento: "asc" },
  });

  return docs.map((d) => ({
    id: d.id,
    nombre: d.supplier?.name ?? "Sin proveedor",
    importeTotal: d.importeTotal,
    vencimiento: d.vencimiento,
    kind: d.kind,
  }));
}

/** Marca varios como pagados de una vez y devuelve cuántos cambió. Se revierte
 *  pasando `cuando = null` por la misma vía; el historial guarda las dos. */
export async function marcarPagados(
  ids: string[],
  cuando: Date,
  actor: { id: string; name: string },
): Promise<number> {
  if (ids.length === 0) return 0;

  const antes = await db.document.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, pagadoAt: true },
  });

  const r = await db.document.updateMany({
    where: { id: { in: antes.map((d) => d.id) } },
    data: { pagadoAt: cuando },
  });

  await db.documentChange.createMany({
    data: antes.map((d) => ({
      documentId: d.id,
      actorId: actor.id,
      actorName: actor.name,
      field: "pagadoAt",
      before: d.pagadoAt?.toISOString() ?? null,
      after: cuando.toISOString(),
    })),
  });

  return r.count;
}

/**
 * Carga el vencimiento del pago, que sale del "Vto:" del papel.
 *
 * NUNCA se autocompleta desde `cae` ni `caeVence`: son fechas distintas y ya
 * se confundieron una vez, cargando el vencimiento del CAE (06/09) como si
 * fuera la fecha de pago (11/09). Por eso este campo solo se escribe acá, a
 * mano y mirando la foto.
 */
export async function ponerVencimiento(
  id: string,
  vencimiento: string,
  actor: { id: string; name: string },
): Promise<void> {
  if (!DIA.test(vencimiento) || !esDiaReal(vencimiento)) {
    throw new Error("El vencimiento va en AAAA-MM-DD y tiene que ser un día real.");
  }

  const antes = await db.document.findUniqueOrThrow({ where: { id }, select: { vencimiento: true } });
  await db.document.update({ where: { id }, data: { vencimiento } });
  await db.documentChange.create({
    data: {
      documentId: id,
      actorId: actor.id,
      actorName: actor.name,
      field: "vencimiento",
      before: antes.vencimiento,
      after: vencimiento,
    },
  });
}

/**
 * Cuánto falta por resolver, contado con consultas sobre NULLs.
 *
 * No hay columna de estado a propósito: un estado miente apenas alguien edita
 * un campo y se olvida de moverlo. Preguntando por los nulos, la bandeja no
 * puede desincronizarse de la realidad porque no hay nada que mantener.
 */
export async function bandejas(): Promise<{
  sinProveedor: number;
  sinRevisar: number;
  sinVencimiento: number;
}> {
  const vivos = { deletedAt: null };
  const [sinProveedor, sinRevisar, sinVencimiento] = await Promise.all([
    db.document.count({ where: { ...vivos, supplierId: null } }),
    db.document.count({ where: { ...vivos, conforme: null } }),
    db.document.count({ where: { ...vivos, pagadoAt: null, vencimiento: null } }),
  ]);
  return { sinProveedor, sinRevisar, sinVencimiento };
}

function esDiaReal(dia: string): boolean {
  const [a, m, d] = dia.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-pagos.test.ts`
Expected: PASS, 9 pruebas.

- [ ] **Step 5: Commit**

```bash
git add lib/comprobantes/pagos.ts tests/comprobantes-pagos.test.ts
git commit -m "Sumar por proveedor y marcar varias facturas de una vez"
```

---

### Task 7: Las server actions, que son la barrera

La tarea donde se cumple la promesa central del diseño: **el rol de depósito nunca recibe un importe**. No porque la pantalla lo esconda: porque el dato no sale del servidor.

**Files:**
- Create: `lib/comprobantes/politica.ts`
- Create: `app/actions/comprobantes.ts`
- Test: `tests/comprobantes-actions.test.ts`

> **Un archivo `"use server"` solo puede exportar funciones asíncronas.** Las
> ayudas puras —`puedeResponderImportes`, `aFilaDeuda`, `cabeceraDeLaCaptura`,
> `destinoValido`, `kindValido`— son síncronas, así que van en
> `lib/comprobantes/politica.ts`. Es mejor de todos modos: son las reglas que
> más importan del módulo y probarlas no debería necesitar levantar Next.

**Interfaces:**
- Consumes: `getSessionUser`, `canCapturarComprobantes`, `canVerImportes`, `canPagar`, `guardarCaptura`, `porProveedor`, `queVence`, `marcarPagados`, `ponerVencimiento`, `subirFoto`, `aTextoPlano`.
- Produces:
  - `capturarComprobante(fd: FormData): Promise<{ ok: boolean; documentId?: string; aviso?: string; error?: string }>`
  - `deudaPorProveedor(): Promise<{ ok: boolean; filas?: FilaDeuda[]; error?: string }>` con `type FilaDeuda = { supplierId: string | null; nombre: string; total: string; cantidad: number }` — **`total` es `string`, no `bigint`**
  - `pagar(ids: string[]): Promise<{ ok: boolean; cuantos?: number; error?: string }>`
  - `cargarVencimiento(id: string, vencimiento: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-actions.test.ts`. Prueba la **decisión de permiso** sin levantar Next: se extrae a una función pura que la action llama, y se prueba esa.

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { puedeResponderImportes, aFilaDeuda } from "../app/actions/comprobantes";

/**
 * La promesa que sostiene meter un módulo de plata dentro de una app que usa
 * todo el equipo: **al teléfono del depósito el importe no le llega nunca**.
 *
 * Se prueba la decisión, no la pantalla. Si esta prueba pasa y la pantalla
 * igual muestra un número, es un bug de la pantalla. Si esta prueba falla, es
 * un agujero.
 */

test("solo ADMIN y PAGOS pueden recibir importes", () => {
  assert.equal(puedeResponderImportes({ role: "ADMIN" }), true);
  assert.equal(puedeResponderImportes({ role: "PAGOS" }), true);
  assert.equal(puedeResponderImportes({ role: "RECEPCION" }), false);
  assert.equal(puedeResponderImportes({ role: "ARMADOR" }), false);
  assert.equal(puedeResponderImportes({ role: "LOGISTICA" }), false);
  assert.equal(puedeResponderImportes(null), false);
});

test("los importes cruzan a la pantalla como texto, no como BigInt", () => {
  // JSON.stringify de un BigInt tira. Verificado contra Prisma 7.
  const fila = aFilaDeuda({
    supplierId: "s1",
    nombre: "DON ANGEL",
    total: 84184326n,
    cantidad: 2,
  });
  assert.equal(fila.total, "84184326");
  assert.equal(typeof fila.total, "string");
  assert.doesNotThrow(() => JSON.stringify(fila));
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-actions.test.ts`
Expected: FAIL — no encuentra `../app/actions/comprobantes`.

- [ ] **Step 3: Escribir las actions**

Crear `app/actions/comprobantes.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { canCapturarComprobantes, canVerImportes, canPagar } from "@/lib/permissions";
import { guardarCaptura } from "@/lib/comprobantes/documentos";
import { porProveedor, queVence, marcarPagados, ponerVencimiento, type DeudaProveedor } from "@/lib/comprobantes/pagos";
import { subirFoto } from "@/lib/comprobantes/almacenamiento";
import { leerQr, elegirQrDeFactura, esParaNosotros } from "@/lib/comprobantes/qr";
import { aTextoPlano } from "@/lib/money";
import type { Cabecera, Destino, Kind } from "@/lib/comprobantes/tipos";

/** Un importe que cruza al navegador. `total` va en TEXTO porque
 *  `JSON.stringify` de un BigInt tira. */
export type FilaDeuda = {
  supplierId: string | null;
  nombre: string;
  total: string;
  cantidad: number;
};

/**
 * La decisión de si esta sesión puede recibir plata.
 *
 * Vive acá afuera y exportada a propósito: es la regla más importante del
 * módulo y tiene que poder probarse sin levantar Next. Toda action que arme
 * una respuesta con importes pasa por acá ANTES de consultar la base.
 */
export function puedeResponderImportes(sesion: { role: string } | null): boolean {
  return !!sesion && canVerImportes(sesion.role);
}

/** Convierte una fila de deuda en algo que puede viajar como JSON. */
export function aFilaDeuda(d: DeudaProveedor): FilaDeuda {
  return {
    supplierId: d.supplierId,
    nombre: d.nombre,
    total: aTextoPlano(d.total),
    cantidad: d.cantidad,
  };
}

const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * Guarda una captura hecha desde el celular.
 *
 * Devuelve `documentId` y nada más: quien captura tiene rol RECEPCION y no
 * puede recibir importes, ni siquiera el que acaba de fotografiar.
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

  // Los QR vienen ya leídos del teléfono: se decodifican con la cámara
  // apuntando, antes de disparar. Acá se vuelve a parsear el texto crudo en vez
  // de confiar en los campos sueltos que mande el cliente — un navegador puede
  // mandar cualquier cosa.
  // La camara puede haber visto VARIOS QR en la misma foto: el de AFIP, uno de
  // marketing del proveedor, el de Data Fiscal. Se elige el de factura.
  const vistos = fd.getAll("qr").map(String).filter(Boolean);
  const elegido = elegirQrDeFactura(vistos);
  const cabecera = (elegido && leerQr(elegido)) || { fuente: "MANUAL" as const };
  // Aviso, no bloqueo: puede ser un error de foto y la foto igual se guarda.
  const ajena = esParaNosotros(cabecera) === false;

  const hoy = new Date().toISOString().slice(0, 10);
  const adjuntos = [];
  for (const f of archivos) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const { s3Key, sizeBytes } = await subirFoto(bytes, f.type, hoy);
    adjuntos.push({ s3Key, mimeType: f.type, sizeBytes });
  }

  const destino = destinoValido(String(fd.get("destino") ?? ""));
  const conformeCrudo = fd.get("conforme");

  const r = await guardarCaptura({
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

  revalidatePath("/recepcion");
  revalidatePath("/pagos");

  return {
    ok: true,
    documentId: r.documentId,
    aviso: r.yaExistia
      ? "Este comprobante ya estaba cargado."
      : r.fusionado
        ? "Esta factura ya la había cargado otra persona. Se agregó tu foto."
        : undefined,
  };
}

export async function deudaPorProveedor() {
  const sesion = await getSessionUser();
  if (!puedeResponderImportes(sesion)) {
    // Se corta ANTES de consultar la base: el importe no se lee siquiera.
    return { ok: false, error: "No tenés permiso para ver importes." };
  }
  const filas = (await porProveedor()).map(aFilaDeuda);
  return { ok: true, filas };
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

// --- ayudas privadas -------------------------------------------------------

function destinoValido(v: string): Destino | undefined {
  return v === "COCINA" || v === "DEPOSITO" || v === "OTRO" ? v : undefined;
}

function kindValido(v: string): Kind {
  const validos = ["FACTURA", "REMITO", "TICKET", "NOTA_CREDITO", "NOTA_DEBITO", "OTRO"];
  return (validos.includes(v) ? v : "OTRO") as Kind;
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-actions.test.ts`
Expected: PASS, 2 pruebas.

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS todo, incluidas las suites viejas.

- [ ] **Step 6: Commit**

```bash
git add app/actions/comprobantes.ts tests/comprobantes-actions.test.ts
git commit -m "Cortar los importes en el servidor, no en la pantalla"
```

---

### Task 8: Las dos pantallas

**Files:**
- Create: `app/(app)/recepcion/page.tsx`
- Create: `app/(app)/recepcion/captura-cliente.tsx`
- Create: `app/(app)/pagos/page.tsx`
- Create: `app/(app)/pagos/lista-pagos.tsx`
- Modify: el menú de navegación de `app/(app)/layout.tsx` (leerlo primero y seguir el patrón que ya use para los enlaces)

**Interfaces:**
- Consumes: `capturarComprobante`, `deudaPorProveedor`, `vencimientosEntre`, `pagar`, `cargarVencimiento`, `getSessionUser`, `canCapturarComprobantes`, `canVerImportes`.
- Produces: las rutas `/recepcion` y `/pagos`.

> **Antes de escribir:** leer `app/(app)/inventario/page.tsx` y su componente cliente, y **seguir ese patrón** — página de servidor que comprueba la sesión y el permiso, componente cliente para lo interactivo. No inventar una estructura nueva. Usar los tokens del sistema de diseño (`--text-muted`, `--r-lg`), nunca colores literales.

- [ ] **Step 1: La página de recepción (servidor)**

Crear `app/(app)/recepcion/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canCapturarComprobantes } from "@/lib/permissions";
import CapturaCliente from "./captura-cliente";

export default async function RecepcionPage() {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canCapturarComprobantes(sesion.role)) redirect("/");

  // No se le pasa NADA de plata al cliente: quien captura no ve importes.
  return <CapturaCliente />;
}
```

- [ ] **Step 2: El componente de captura (cliente)**

Crear `app/(app)/recepcion/captura-cliente.tsx`. Lo esencial, en orden:

1. Un botón grande, **"Recibí mercadería"**, que abre la cámara con `getUserMedia({ video: { facingMode: "environment" } })` y enciende la linterna si el dispositivo la expone (`track.applyConstraints({ advanced: [{ torch: true }] })`, dentro de `try/catch` — no todos la tienen).
2. Un bucle de lectura en vivo con `BarcodeDetector` sobre `["qr_code"]`, corriendo con `requestAnimationFrame`. Al enganchar: `navigator.vibrate?.(80)` y guardar el texto crudo. **A los 3 segundos sin enganchar, se sigue igual** — no hay que pelearse con un papel arrugado.
3. Disparar la foto desde el mismo `video` a un `<canvas>`, **reduciendo a 2000 px de lado mayor** y exportando con `canvas.toBlob(blob => ..., "image/jpeg", 0.8)`. Se comprime DESPUÉS de leer los códigos, nunca antes.
4. `clientKey`: `crypto.randomUUID()` generado **al abrir la cámara**, no al enviar. Es lo que hace que el doble toque no cree dos comprobantes.
5. Dos botones grandes de destino, **COCINA** y **DEPÓSITO**, con `OTRO` como enlace chico abajo. Y **¿Está todo?** con *Sí* / *Faltan cosas*. Los dos salteables.
6. Enviar con `FormData` a `capturarComprobante`: `clientKey`, `kind`, `destino`, `conforme`, las fotos en `fotos`, y **un campo `qr` por cada QR que la cámara haya visto** (`fd.append("qr", ...)` varias veces). Elegir cuál es el de factura es trabajo del servidor, no de la pantalla.
7. Al volver `ok`, mostrar **"Listo · Aldana ya lo ve"**. Si viene `aviso`, mostrarlo.

Si `BarcodeDetector` no existe (`typeof window.BarcodeDetector === "undefined"`), saltear el paso 2 entero y sacar la foto igual. La cascada sigue: el comprobante queda sin identificar y se resuelve después.

Las dos piezas que no son obvias, escritas:

```typescript
// Lectura en vivo del QR. Se juntan TODOS los que aparezcan: una factura real
// puede traer el de AFIP y uno de marketing, y cual es cual lo decide el
// servidor. No se busca el codigo de barras de la RG 1702 porque ninguno de los
// 18 comprobantes revisados lo traia.
const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
const leidos = new Set<string>();
const arranque = performance.now();

async function buscar() {
  if (leidos.size > 0 || performance.now() - arranque > 3000) return; // se sigue igual
  try {
    for (const c of await detector.detect(videoRef.current!)) {
      if (leidos.has(c.rawValue)) continue;
      leidos.add(c.rawValue); // una foto puede traer varios QR distintos
      navigator.vibrate?.(80);
    }
  } catch {
    /* un cuadro borroso no es un error: se prueba con el siguiente */
  }
  requestAnimationFrame(buscar);
}
```

```typescript
// La foto, reducida DESPUÉS de leer los códigos. Comprimir antes es la forma
// más fácil de arruinar un QR que se leía bien.
const MAX = 2000;
function capturar(video: HTMLVideoElement): Promise<Blob> {
  const escala = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(video.videoWidth * escala);
  lienzo.height = Math.round(video.videoHeight * escala);
  lienzo.getContext("2d")!.drawImage(video, 0, 0, lienzo.width, lienzo.height);
  return new Promise((listo, error) =>
    lienzo.toBlob((b) => (b ? listo(b) : error(new Error("No se pudo capturar"))), "image/jpeg", 0.8),
  );
}
```

- [ ] **Step 3: La página de pagos (servidor)**

Crear `app/(app)/pagos/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerImportes } from "@/lib/permissions";
import { deudaPorProveedor, vencimientosEntre } from "@/app/actions/comprobantes";
import ListaPagos from "./lista-pagos";

/** Los próximos 30 días desde hoy, en días de calendario. */
function ventana(): { desde: string; hasta: string } {
  const hoy = new Date();
  const en30 = new Date(hoy.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { desde: hoy.toISOString().slice(0, 10), hasta: en30.toISOString().slice(0, 10) };
}

export default async function PagosPage() {
  const sesion = await getSessionUser();
  if (!sesion) redirect("/login");
  if (!canVerImportes(sesion.role)) redirect("/");

  const { desde, hasta } = ventana();
  const [deuda, vencen] = await Promise.all([deudaPorProveedor(), vencimientosEntre(desde, hasta)]);

  return <ListaPagos deuda={deuda.filas ?? []} vencen={vencen.filas ?? []} />;
}
```

- [ ] **Step 4: La lista de pagos (cliente)**

Crear `app/(app)/pagos/lista-pagos.tsx`. Lo esencial:

1. **"Qué vence"** primero, agrupado por semana, con los vencidos arriba y marcados. Es la pantalla de inicio, no un reporte escondido.
2. Cada fila: proveedor, importe, vencimiento, y un botón que abre la **foto a pantalla completa con zoom**. Aldana está en otra oficina y no puede ir a mirar el papel: el visor reemplaza tenerlo en la mano. Una miniatura no alcanza.
3. **Por proveedor**: nombre, cantidad de comprobantes y el total sumado por el sistema — `"DON ANGEL · $841.843,26 en 2 facturas"`. Es lo que se transfiere.
4. **Selección múltiple** con un botón *Marcar pagadas*, que llama a `pagar(ids)`. Se paga por proveedor, no por factura.
5. Un campo de **vencimiento** editable en las filas que lo tienen vacío, que llama a `cargarVencimiento`. Cuando el proveedor tiene `diasPago`, mostrar el valor de `proponerVencimiento` **como sugerencia gris con un botón de confirmar**, nunca como si ya estuviera guardado. **No mostrar `caeVence` en ninguna parte de esta pantalla**: no sirve para pagar y es la fecha que ya se confundió una vez con el "Vto:".
6. Los importes llegan como `string` de centavos: para mostrarlos, `formatear(BigInt(fila.total))` de `lib/money.ts`.

- [ ] **Step 5: Probar a mano las dos pantallas**

```bash
npm run dev
```

Comprobar, con un usuario de cada rol:
- `RECEPCION` entra a `/recepcion` y **NO** puede entrar a `/pagos` (redirige).
- `PAGOS` entra a `/pagos` y **NO** a `/recepcion`.
- `ARMADOR` no entra a ninguna de las dos.
- Sacar una foto de una factura real con QR: aparecen proveedor e importe sin tipear nada.
- Sacar una foto tapando el QR con el dedo: **la foto se guarda igual** y queda sin identificar.
- Tocar *Guardar* dos veces seguidas: se crea **un** comprobante, no dos.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/recepcion" "app/(app)/pagos" "app/(app)/layout.tsx"
git commit -m "Poner la camara en el deposito y la deuda en la oficina"
```

---

### Task 9: La carga manual corta

Sin esto, todo lo que no tiene código legible —que según el usuario es buena parte de lo que entra— se queda sin datos. Es la que cierra la etapa 1.

**Files:**
- Create: `app/(app)/recepcion/completar/[id]/page.tsx`
- Modify: `app/actions/comprobantes.ts` (agregar `completarAMano`)
- Modify: `lib/comprobantes/documentos.ts` (agregar `completarCabecera`)
- Test: `tests/comprobantes-completar.test.ts`

**Interfaces:**
- Consumes: `prismaComprobantes`, `aCentavos`.
- Produces:
  - `completarCabecera(id, datos, actor): Promise<void>` con `datos = { supplierId?: string; nombreProveedor?: string; importeTexto?: string; fechaEmision?: string; vencimiento?: string }`
  - `completarAMano(id: string, fd: FormData)`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/comprobantes-completar.test.ts`. Mismo armado de base temporal que `comprobantes-pagos.test.ts` (copiar el bloque `before`/`after`, cambiando el nombre del archivo de base a `didier-test-completar-${process.pid}.db`). Las pruebas:

```typescript
test("completar un remito no pide datos fiscales", async () => {
  const d = await prisma.document.create({
    data: { kind: "REMITO", source: "MANUAL", capturedByName: "Pablo" },
  });
  await docs.completarCabecera(
    d.id,
    { nombreProveedor: "Verdulería del barrio", fechaEmision: "2026-09-01" },
    { id: "u-pablo", name: "Pablo" },
  );
  const leido = await prisma.document.findUniqueOrThrow({
    where: { id: d.id },
    include: { supplier: true },
  });
  assert.equal(leido.supplier?.name, "Verdulería del barrio");
  assert.equal(leido.supplier?.cuit, null); // informal: no tiene CUIT
  assert.equal(leido.importeTotal, null);   // un remito no lleva importe
});

test("el importe tipeado entra en centavos exactos", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await docs.completarCabecera(d.id, { importeTexto: "$ 12.450,80" }, { id: "u", name: "U" });
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, 1245080n);
});

test("un importe que no se entiende se rechaza en vez de guardarse en cero", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await assert.rejects(
    () => docs.completarCabecera(d.id, { importeTexto: "como mil" }, { id: "u", name: "U" }),
    /importe/i,
  );
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, null); // sigue vacío, no en cero
});

test("completar a mano deja source en MANUAL y queda en el historial", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await docs.completarCabecera(d.id, { importeTexto: "500" }, { id: "u-ald", name: "Aldana" });
  const cambios = await prisma.documentChange.findMany({ where: { documentId: d.id } });
  assert.ok(cambios.some((c) => c.field === "importeTotal" && c.actorName === "Aldana"));
});

test("reutiliza el proveedor si ya existe con ese nombre", async () => {
  const a = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  const b = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  const actor = { id: "u", name: "U" };
  await docs.completarCabecera(a.id, { nombreProveedor: "Ferretería Sur" }, actor);
  await docs.completarCabecera(b.id, { nombreProveedor: "Ferretería Sur" }, actor);
  assert.equal(await prisma.supplier.count({ where: { name: "Ferretería Sur" } }), 1);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-completar.test.ts`
Expected: FAIL — `docs.completarCabecera is not a function`.

- [ ] **Step 3: Escribir `completarCabecera`**

Agregar `import { aCentavos } from "@/lib/money";` **arriba de todo**, junto a los otros imports, y el resto al final del archivo:

```typescript
export type DatosACompletar = {
  supplierId?: string;
  /** Cuando el proveedor no existe todavía. Los informales no tienen CUIT. */
  nombreProveedor?: string;
  /** Como lo tipeó la persona. Se convierte acá, en un solo lugar. */
  importeTexto?: string;
  fechaEmision?: string;
  vencimiento?: string;
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El último peldaño de la cascada: lo que no tiene código legible ni fila en
 * ARCA se carga a mano.
 *
 * Son pocos campos a propósito, y cambian según el tipo: un remito no pide
 * CAE. Preguntar datos fiscales a un remito es cómo se consigue que la gente
 * cargue cualquier cosa con tal de pasar de pantalla.
 */
export async function completarCabecera(
  id: string,
  datos: DatosACompletar,
  actor: { id: string; name: string },
): Promise<void> {
  const antes = await db.document.findUniqueOrThrow({ where: { id } });

  let importeTotal: bigint | undefined;
  if (datos.importeTexto != null && datos.importeTexto.trim() !== "") {
    const centavos = aCentavos(datos.importeTexto);
    // Si no se entiende, se rechaza. Guardar cero sería inventar un dato, y un
    // cero inventado en una suma de deuda es peor que un campo vacío.
    if (centavos === null) throw new Error(`No se entiende el importe: "${datos.importeTexto}"`);
    importeTotal = centavos;
  }

  for (const [campo, valor] of [["fechaEmision", datos.fechaEmision], ["vencimiento", datos.vencimiento]] as const) {
    if (valor != null && valor !== "" && !DIA.test(valor)) {
      throw new Error(`${campo} va en AAAA-MM-DD.`);
    }
  }

  let supplierId = datos.supplierId;
  if (!supplierId && datos.nombreProveedor?.trim()) {
    const nombre = datos.nombreProveedor.trim();
    // Se reutiliza por nombre exacto. La fusión de duplicados escritos distinto
    // es trabajo de administración, no de esta pantalla.
    const existente = await db.supplier.findFirst({ where: { name: nombre, deletedAt: null } });
    supplierId = existente?.id ?? (await db.supplier.create({ data: { name: nombre } })).id;
  }

  const cambios: { field: string; before: string | null; after: string | null }[] = [];
  const anotar = (field: string, before: unknown, after: unknown) => {
    if (after === undefined) return;
    const a = after == null ? null : String(after);
    const b = before == null ? null : String(before);
    if (a !== b) cambios.push({ field, before: b, after: a });
  };

  anotar("supplierId", antes.supplierId, supplierId);
  anotar("importeTotal", antes.importeTotal, importeTotal);
  anotar("fechaEmision", antes.fechaEmision, datos.fechaEmision || undefined);
  anotar("vencimiento", antes.vencimiento, datos.vencimiento || undefined);

  await db.document.update({
    where: { id },
    data: {
      supplierId,
      importeTotal,
      fechaEmision: datos.fechaEmision || undefined,
      vencimiento: datos.vencimiento || undefined,
      source: "MANUAL",
    },
  });

  if (cambios.length > 0) {
    await db.documentChange.createMany({
      data: cambios.map((c) => ({ documentId: id, actorId: actor.id, actorName: actor.name, ...c })),
    });
  }
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-completar.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 5: Agregar la action y la pantalla**

En `app/actions/comprobantes.ts`:

```typescript
import { completarCabecera } from "@/lib/comprobantes/documentos";

/** Completar a mano. Pide `canPagar` y no `canCapturarComprobantes` porque acá
 *  se tipea un IMPORTE, y quien recibe la mercadería no maneja importes. El
 *  proveedor y la fecha los podría cargar cualquiera; el importe no, y separar
 *  la pantalla en dos por eso sería peor. */
export async function completarAMano(id: string, fd: FormData) {
  const sesion = await getSessionUser();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para completar comprobantes." };
  }
  try {
    await completarCabecera(
      id,
      {
        nombreProveedor: String(fd.get("nombreProveedor") ?? "") || undefined,
        importeTexto: String(fd.get("importe") ?? "") || undefined,
        fechaEmision: String(fd.get("fechaEmision") ?? "") || undefined,
        vencimiento: String(fd.get("vencimiento") ?? "") || undefined,
      },
      { id: sesion.id, name: sesion.name },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/pagos");
  return { ok: true };
}
```

Crear `app/(app)/recepcion/completar/[id]/page.tsx`: comprueba sesión y `canPagar`, muestra **la foto al lado del formulario** (para copiar mirando, que es como se completa de verdad) y arma los campos **según `kind`**:

| `kind` | Campos |
|---|---|
| `REMITO` | Proveedor · Fecha |
| `TICKET` | Proveedor · Importe · Fecha |
| resto | Proveedor · Importe · Fecha · Vencimiento |

- [ ] **Step 6: Correr toda la suite y commitear**

Run: `npm test`
Expected: PASS todo.

```bash
git add lib/comprobantes/documentos.ts app/actions/comprobantes.ts "app/(app)/recepcion/completar" tests/comprobantes-completar.test.ts
git commit -m "Cargar a mano lo que no trae codigo ni esta en ARCA"
```

---

### Task 10: La lectura automática de la foto

> **Por qué está en la etapa 1 y no después.** La medición del 01/09 dice que
> **13 de 18 comprobantes no traen QR legible**. Sin esta tarea, la mayoría de
> lo que entra se completa a mano, y el tedio que este módulo vino a matar
> sobrevive con otra ropa.
>
> **No es un agente.** Es **una llamada con salida estructurada por documento**:
> entra la imagen, sale un JSON validado contra un esquema. Un agente —varios
> pasos, herramientas, iteración— cuesta un orden de magnitud más y no lee mejor
> una factura. Lo que sí se especializa es el **esquema según el tipo**: a un
> remito no se le pregunta el CAE.

**Files:**
- Create: `lib/comprobantes/lectura.ts`
- Create: `lib/comprobantes/cuit.ts`
- Modify: `app/actions/comprobantes.ts` (agregar `leerFotoDeComprobante`)
- Modify: `app/(app)/recepcion/completar/[id]/page.tsx` (prellenar con lo leído)
- Modify: `package.json` (dependencia `@anthropic-ai/sdk`)
- Test: `tests/comprobantes-lectura.test.ts`

**Interfaces:**
- Consumes: `aCentavos` de `lib/money.ts`, `type Kind` de `lib/comprobantes/tipos.ts`.
- Produces:
  - `cuitValido(cuit: string): boolean` en `lib/comprobantes/cuit.ts`
  - `type Lectura = { campos: CamposLeidos; controles: Controles }`
  - `type CamposLeidos = { nombreProveedor?: string; cuitEmisor?: string; fechaEmision?: string; vencimiento?: string; subtotal?: bigint; iva?: bigint; percepciones?: bigint; total?: bigint }`
  - `type Controles = { cierraLaCuenta: boolean | null; cuitValido: boolean | null }`
  - `revisar(campos: CamposLeidos): Controles`
  - `leerFoto(bytes: Buffer, mimeType: string, kind: Kind): Promise<Lectura>`

- [ ] **Step 1: Escribir la prueba que falla**

Las verificaciones son lógica pura y se prueban sin llamar a la API. **La
llamada al modelo no se prueba con una prueba automática** — se prueba a mano
contra fotos reales en el paso 6, porque una prueba que llama a la API cuesta
plata en cada corrida y falla cuando no hay red.

Crear `tests/comprobantes-lectura.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { revisar } from "../lib/comprobantes/lectura";
import { cuitValido } from "../lib/comprobantes/cuit";

/**
 * Las dos verificaciones que hacen que una lectura probabilística pueda tocar
 * plata sin que alguien revise campo por campo.
 *
 * La idea es simple: un dígito mal leído casi nunca deja la cuenta cuadrada ni
 * el CUIT validando. Cuando las dos dan verde, confirmar es un toque; cuando
 * alguna da rojo, ese campo se mira.
 */

test("el CUIT valida por dígito verificador", () => {
  assert.equal(cuitValido("30717737489"), true); // el de la empresa
  assert.equal(cuitValido("30712345678"), false); // un dígito cambiado
  assert.equal(cuitValido("123"), false);
  assert.equal(cuitValido(""), false);
  assert.equal(cuitValido("abcdefghijk"), false);
});

test("la cuenta cierra cuando subtotal + IVA + percepciones dan el total", () => {
  const c = revisar({
    subtotal: 63873368n, iva: 13413407n, percepciones: 0n, total: 77286775n,
  });
  assert.equal(c.cierraLaCuenta, true);
});

test("un digito mal leido en el total rompe la cuenta y se avisa", () => {
  const c = revisar({
    subtotal: 63873368n, iva: 13413407n, percepciones: 0n, total: 77286875n,
  });
  assert.equal(c.cierraLaCuenta, false);
});

test("sin los sumandos no se afirma nada", () => {
  // null no es false: no poder verificar y verificar que está mal son cosas
  // distintas, y mostrarlas igual seria mentirle a quien paga.
  assert.equal(revisar({ total: 77286775n }).cierraLaCuenta, null);
  assert.equal(revisar({}).cuitValido, null);
});

test("las percepciones pueden faltar y la cuenta cierra igual", () => {
  const c = revisar({ subtotal: 100000n, iva: 21000n, total: 121000n });
  assert.equal(c.cierraLaCuenta, true);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-lectura.test.ts`
Expected: FAIL — no encuentra `../lib/comprobantes/lectura`.

- [ ] **Step 3: Escribir el validador de CUIT**

Crear `lib/comprobantes/cuit.ts`:

```typescript
// El CUIT lleva dígito verificador por módulo 11. Validarlo es gratis y es una
// de las dos formas que tenemos de saber si el lector automático leyó bien, sin
// que una persona tenga que mirar.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function cuitValido(cuit: string): boolean {
  if (typeof cuit !== "string") return false;
  const d = cuit.replace(/\D/g, "");
  if (d.length !== 11) return false;

  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(d[i]), 0);
  const resto = suma % 11;
  // Las dos excepciones de la regla: resto 0 da verificador 0, y resto 1 da 9.
  const esperado = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return esperado === Number(d[10]);
}
```

- [ ] **Step 4: Escribir la lectura**

Instalar la dependencia:

```bash
npm install @anthropic-ai/sdk
```

Crear `lib/comprobantes/lectura.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { aCentavos } from "@/lib/money";
import { cuitValido } from "./cuit";
import type { Kind } from "./tipos";

// Lee una foto de comprobante y PROPONE los campos.
//
// Es el peldaño 4 de la cascada y la vía principal de todo lo que no trae QR,
// que segun la medicion del 01/09 son 13 de cada 18.
//
// **No es un agente**: es una llamada con salida estructurada. Entra la imagen,
// sale un JSON validado contra un esquema. Un agente costaria un orden de
// magnitud mas y no leeria mejor una factura.
//
// **Nada de lo que sale de acá se guarda solo.** Es la única fuente
// probabilística del sistema y la única que puede inventar un número que parezca
// razonable. Por eso ademas viene con dos controles que se verifican sin
// intervencion humana: que la cuenta cierre y que el CUIT valide.

export type CamposLeidos = {
  nombreProveedor?: string;
  cuitEmisor?: string;
  fechaEmision?: string; // "AAAA-MM-DD"
  /** El "Vto:" del papel. Si dice una condición ("7 DIAS") va en `condicionPago`. */
  vencimiento?: string;
  condicionPago?: string;
  subtotal?: bigint;
  iva?: bigint;
  percepciones?: bigint;
  total?: bigint;
};

export type Controles = {
  /** `subtotal + iva + percepciones === total`. `null` = faltan sumandos. */
  cierraLaCuenta: boolean | null;
  /** Cada renglón cumple `cantidad × precio = subtotal`, y la suma de todos da
   *  el subtotal general. `null` = no se leyeron renglones. */
  cierranLosRenglones: boolean | null;
  /** Dígito verificador del CUIT. `null` = no se leyó ningún CUIT. */
  cuitValido: boolean | null;
};

export type Lectura = { campos: CamposLeidos; controles: Controles };

/**
 * Las dos verificaciones que convierten una lectura probabilística en algo que
 * se confirma de un toque.
 *
 * Un dígito mal leído casi nunca deja la cuenta cuadrada ni el CUIT validando.
 * Con las dos en verde, quien paga confirma sin revisar campo por campo; con
 * alguna en rojo, ese campo se marca y ahí sí lo mira.
 */
export function revisar(campos: CamposLeidos): Controles {
  const { subtotal, iva, percepciones, total } = campos;
  const cierraLaCuenta =
    subtotal != null && iva != null && total != null
      ? subtotal + iva + (percepciones ?? 0n) === total
      : null;

  return {
    cierraLaCuenta,
    cuitValido: campos.cuitEmisor ? cuitValido(campos.cuitEmisor) : null,
  };
}

/** El esquema cambia según el tipo: a un remito no se le pregunta el importe,
 *  porque no lo tiene y preguntarlo invita a que el modelo invente uno. */
function esquemaDe(kind: Kind) {
  const base = {
    nombreProveedor: { type: "string", description: "Razón social del emisor, como figura impresa" },
    cuitEmisor: { type: "string", description: "CUIT del emisor, solo dígitos" },
    fechaEmision: { type: "string", description: "Fecha de emisión en formato AAAA-MM-DD" },
  };
  const renglones = {
    renglones: {
      type: "array",
      description: "Un elemento por renglón del detalle, en el orden impreso",
      items: {
        type: "object",
        properties: {
          codigo: { type: "string", description: "Código del artículo si lo trae" },
          descripcion: { type: "string" },
          cantidad: { type: "string", description: "Cantidad tal cual está impresa" },
          unidad: { type: "string", description: "KG, UN, LT..." },
          precioUnitario: { type: "string", description: "Precio unitario tal cual está impreso" },
          subtotal: { type: "string", description: "Importe del renglón tal cual está impreso" },
        },
        required: ["descripcion"],
        additionalProperties: false,
      },
    },
  };
  const plata = {
    subtotal: { type: "string", description: "Subtotal sin IVA, tal cual está impreso" },
    iva: { type: "string", description: "Importe de IVA, tal cual está impreso" },
    percepciones: { type: "string", description: "Percepciones e impuestos internos sumados; 0 si no hay" },
    total: { type: "string", description: "TOTAL final del comprobante, tal cual está impreso" },
    vencimiento: { type: "string", description: "Fecha de vencimiento DEL PAGO en AAAA-MM-DD. NO el vencimiento del CAE." },
    condicionPago: { type: "string", description: 'Condición de pago si en vez de fecha dice un plazo, por ejemplo "7 DIAS" o "CONTADO"' },
  };
  const props = kind === "REMITO" ? { ...base, ...renglones } : { ...base, ...plata, ...renglones };
  return {
    type: "object",
    properties: props,
    required: [] as string[],
    additionalProperties: false,
  };
}

const INSTRUCCIONES = `Sos un lector de comprobantes comerciales argentinos.

Extraé los campos del comprobante de la imagen. Reglas:

- Copiá los importes EXACTAMENTE como están impresos, con su separador decimal.
  No los recalcules, no los redondees, no los conviertas.
- El vencimiento del PAGO no es el vencimiento del CAE. El del CAE está al pie,
  junto al número de CAE, y NO se pide acá. Si el comprobante solo dice una
  condición ("7 DIAS", "CONTADO"), poné eso en condicionPago y dejá vencimiento
  vacío.
- Si un campo no se lee o no está, omitilo. **No inventes ningún valor.** Un
  campo vacío se resuelve preguntando; un campo inventado no se detecta nunca.`;

export async function leerFoto(bytes: Buffer, mimeType: string, kind: Kind): Promise<Lectura> {
  const client = new Anthropic();

  const respuesta = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: INSTRUCCIONES,
    output_config: { format: { type: "json_schema", schema: esquemaDe(kind) } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType as "image/jpeg", data: bytes.toString("base64") },
          },
          { type: "text", text: "Extraé los campos de este comprobante." },
        ],
      },
    ],
  });

  const texto = respuesta.content.find((b) => b.type === "text");
  if (!texto || texto.type !== "text") return { campos: {}, controles: revisar({}) };

  let bruto: Record<string, string>;
  try {
    bruto = JSON.parse(texto.text);
  } catch {
    return { campos: {}, controles: revisar({}) };
  }

  // Los importes vienen como TEXTO a propósito y se convierten acá con el mismo
  // parser que todo lo demás: si el modelo devolviera números, el JSON los
  // volvería flotantes y se perderían centavos antes de que los veamos.
  const campos: CamposLeidos = {
    nombreProveedor: bruto.nombreProveedor || undefined,
    cuitEmisor: bruto.cuitEmisor?.replace(/\D/g, "") || undefined,
    fechaEmision: diaValido(bruto.fechaEmision),
    vencimiento: diaValido(bruto.vencimiento),
    condicionPago: bruto.condicionPago || undefined,
    subtotal: aCentavos(bruto.subtotal ?? "") ?? undefined,
    iva: aCentavos(bruto.iva ?? "") ?? undefined,
    percepciones: aCentavos(bruto.percepciones ?? "") ?? undefined,
    total: aCentavos(bruto.total ?? "") ?? undefined,
  };

  return { campos, controles: revisar(campos) };
}

function diaValido(v: string | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  const ok = f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
  return ok ? v : undefined;
}
```

- [ ] **Step 5: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-lectura.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 6: Probar la lectura contra fotos reales**

Esto no va como prueba automática: cada corrida gasta plata y necesita red.
Es una comprobación a mano, una sola vez, con **cinco comprobantes reales de
tipos distintos** — una factura A, un remito, un ticket, y dos de los que no
tienen QR.

Por cada uno, comparar contra el papel: el **total**, el **CUIT del emisor** y
el **vencimiento**. Anotar cuántos salieron bien y cuántas veces los dos
controles dieron verde estando el dato mal — **ese último número es el que
importa**, porque es la única forma en que un dato equivocado llega a la
pantalla de quien paga sin que nadie lo mire.

Si aparece aunque sea uno, subir el umbral: que la confirmación de un toque
exija además que el proveedor ya exista con ese CUIT.

- [ ] **Step 7: Conectar con la pantalla de completar**

En `app/actions/comprobantes.ts`:

```typescript
import { leerFoto } from "@/lib/comprobantes/lectura";
import { aTextoPlano } from "@/lib/money";

/** Lee una foto y PROPONE los campos. No escribe nada en la base: lo que
 *  devuelve va al formulario para que una persona lo confirme. */
export async function leerFotoDeComprobante(documentId: string) {
  const sesion = await getSessionUser();
  if (!sesion || !canPagar(sesion.role)) {
    return { ok: false, error: "No tenés permiso para leer comprobantes." };
  }
  // ... recuperar los bytes del adjunto desde S3 y el `kind` del documento ...
  const { campos, controles } = await leerFoto(bytes, mimeType, kind);
  return {
    ok: true,
    campos: {
      ...campos,
      // Los importes cruzan como texto: BigInt no serializa a JSON.
      subtotal: campos.subtotal && aTextoPlano(campos.subtotal),
      iva: campos.iva && aTextoPlano(campos.iva),
      percepciones: campos.percepciones && aTextoPlano(campos.percepciones),
      total: campos.total && aTextoPlano(campos.total),
    },
    controles,
  };
}
```

En la pantalla de completar, los campos leídos entran **prellenados y marcados
como propuestos** (fondo distinto, nunca como si ya estuvieran guardados), con:

- Un cartel verde **"la cuenta cierra"** cuando `cierraLaCuenta` es `true`, y un
  botón de confirmar todo de un toque.
- Un cartel de atención sobre el campo que corresponda cuando alguno de los dos
  controles da `false`.
- Nada cuando dan `null`: no poder verificar no es lo mismo que verificar que
  está mal, y mostrarlo igual sería mentirle a quien paga.

Guardar sigue llamando a `completarAMano`, que ya existe y ya deja el rastro en
`DocumentChange`. La lectura no tiene una vía propia de escritura, a propósito.

- [ ] **Step 8: Commit**

```bash
git add lib/comprobantes/lectura.ts lib/comprobantes/cuit.ts app/actions/comprobantes.ts "app/(app)/recepcion/completar" tests/comprobantes-lectura.test.ts package.json package-lock.json
git commit -m "Leer la foto cuando no hay codigo que leer"
```

---

### Task 11: El escaneo del papel

> Lo que llega es una foto de un papel arrugado, de costado, en una carpeta de
> anillos y con la sombra de quien la saca encima. Lo que se archiva tiene que
> parecer un escaneo: recortado al borde de la hoja, derecho, fondo blanco.
>
> **No es maquillaje.** Aldana está en otra oficina y no puede ir a mirar el
> papel; y una imagen enderezada y con contraste sube la tasa de lectura del QR
> —hoy medida en 28% sobre fotos casuales— y mejora la extracción por IA. El
> escaneo alimenta al resto del sistema, no solo a la vista.
>
> **Lo que NO se hace acá es generar un documento nuevo a partir de los datos
> leídos.** Un PDF reconstruido se ve más confiable que una foto borrosa pero
> contiene lo que la IA leyó, y un error quedaría lavado dentro de algo con
> aspecto de comprobante fiscal. Se procesa el original; no se dibuja otro.

**Files:**
- Create: `lib/comprobantes/escaneo.ts`
- Modify: `app/(app)/recepcion/captura-cliente.tsx` (el paso de escaneo entre la foto y la subida)
- Modify: `app/actions/comprobantes.ts` (aceptar las dos variantes)
- Modify: `package.json` (dependencia `jscanify`)
- Test: `tests/comprobantes-escaneo.test.ts`

**Interfaces:**
- Consumes: nada del resto del módulo — es una unidad de imagen, aislada a propósito.
- Produces:
  - `type Esquina = { x: number; y: number }`
  - `ordenarEsquinas(puntos: Esquina[]): [Esquina, Esquina, Esquina, Esquina] | null` — superior-izq, superior-der, inferior-der, inferior-izq
  - `medidaDeSalida(esquinas: Esquina[]): { ancho: number; alto: number }`
  - `escanear(fuente: HTMLCanvasElement | HTMLVideoElement, esquinas?: Esquina[]): Promise<Blob>`

- [ ] **Step 1: Escribir la prueba que falla**

Se prueba la **geometría**, que es donde están los errores silenciosos y no
necesita navegador. El recorte y el realce se comprueban a ojo en el paso 6:
una prueba automática de "esta imagen se ve linda" no existe.

Crear `tests/comprobantes-escaneo.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { ordenarEsquinas, medidaDeSalida } from "../lib/comprobantes/escaneo";

/**
 * La geometría del escaneo.
 *
 * Ordenar las esquinas mal es el error que no se ve venir: la imagen sale
 * rotada 90° o espejada, y como igual "parece un escaneo", nadie se da cuenta
 * hasta que hay que leer un CAE al revés.
 */

// Una hoja fotografiada de costado: las esquinas NO vienen en orden.
const DESORDENADAS = [
  { x: 640, y: 900 }, // inferior derecha
  { x: 120, y: 80 },  // superior izquierda
  { x: 100, y: 950 }, // inferior izquierda
  { x: 700, y: 60 },  // superior derecha
];

test("ordena las esquinas empezando por la superior izquierda, en sentido horario", () => {
  const o = ordenarEsquinas(DESORDENADAS);
  assert.ok(o);
  assert.deepEqual(o, [
    { x: 120, y: 80 },
    { x: 700, y: 60 },
    { x: 640, y: 900 },
    { x: 100, y: 950 },
  ]);
});

test("con menos de cuatro esquinas no inventa un cuadrilátero", () => {
  assert.equal(ordenarEsquinas(DESORDENADAS.slice(0, 3)), null);
  assert.equal(ordenarEsquinas([]), null);
});

test("la salida conserva la proporción del papel, no la de la foto", () => {
  // Se toma el lado más largo de cada par: si un borde quedó escorzado por el
  // ángulo, usar el corto achataría la hoja y con ella los renglones.
  const m = medidaDeSalida(ordenarEsquinas(DESORDENADAS)!);
  assert.ok(m.ancho > 0 && m.alto > 0);
  // Una hoja A4 vertical: más alta que ancha. Si esto se invierte, la imagen
  // salió acostada.
  assert.ok(m.alto > m.ancho, `salió acostada: ${m.ancho}x${m.alto}`);
});

test("una hoja perfectamente derecha no se deforma", () => {
  const rect = [
    { x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 1100 }, { x: 0, y: 1100 },
  ];
  const m = medidaDeSalida(rect);
  assert.equal(m.ancho, 800);
  assert.equal(m.alto, 1100);
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-escaneo.test.ts`
Expected: FAIL — no encuentra `../lib/comprobantes/escaneo`.

- [ ] **Step 3: Escribir la geometría**

Crear `lib/comprobantes/escaneo.ts` con las dos funciones puras primero — se
prueban sin navegador y son donde viven los errores silenciosos:

```typescript
export type Esquina = { x: number; y: number };

/**
 * Ordena cuatro puntos como superior-izquierda, superior-derecha,
 * inferior-derecha, inferior-izquierda.
 *
 * El truco es viejo y funciona con cualquier cuadrilátero convexo: la suma
 * `x + y` es mínima en la esquina superior izquierda y máxima en la inferior
 * derecha; la resta `x - y` separa las otras dos.
 *
 * Equivocarse acá no rompe nada visiblemente: la imagen sale rotada o espejada
 * y "parece un escaneo" igual. Por eso tiene prueba propia.
 */
export function ordenarEsquinas(
  puntos: Esquina[],
): [Esquina, Esquina, Esquina, Esquina] | null {
  if (!Array.isArray(puntos) || puntos.length !== 4) return null;

  const porSuma = [...puntos].sort((a, b) => a.x + a.y - (b.x + b.y));
  const supIzq = porSuma[0];
  const infDer = porSuma[3];

  const resto = puntos.filter((p) => p !== supIzq && p !== infDer);
  const [supDer, infIzq] = resto[0].x > resto[1].x ? resto : [resto[1], resto[0]];

  return [supIzq, supDer, infDer, infIzq];
}

/**
 * El tamaño de la imagen enderezada.
 *
 * De cada par de lados opuestos se toma el **más largo**: si un borde quedó
 * escorzado por el ángulo de la foto, usar el corto achataría la hoja y con
 * ella los renglones, que es justo lo que después hay que leer.
 */
export function medidaDeSalida(esquinas: Esquina[]): { ancho: number; alto: number } {
  const [si, sd, id, ii] = esquinas;
  const dist = (a: Esquina, b: Esquina) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    ancho: Math.round(Math.max(dist(si, sd), dist(ii, id))),
    alto: Math.round(Math.max(dist(si, ii), dist(sd, id))),
  };
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-escaneo.test.ts`
Expected: PASS, 4 pruebas.

- [ ] **Step 5: Agregar el escaneo propiamente dicho**

```bash
npm install jscanify
```

En el mismo archivo, la parte que necesita navegador:

```typescript
/**
 * Recorta al borde del papel, endereza y blanquea el fondo.
 *
 * `jscanify` trae OpenCV compilado a WASM: son unos 30 MB, así que se importa
 * **acá adentro y solo cuando hace falta**. Se carga al abrir la cámara, el
 * service worker lo cachea, y el resto de la app no lo paga nunca.
 *
 * Si `esquinas` viene, se usan esas: son las que la persona arrastró en la
 * pantalla, y le ganan siempre a la detección automática.
 */
export async function escanear(
  fuente: HTMLCanvasElement,
  esquinas?: Esquina[],
): Promise<Blob> {
  const { default: jscanify } = await import("jscanify");
  const escaner = new jscanify();

  const puntos = esquinas ?? escaner.getCornerPoints(escaner.getCanny(fuente));
  const ordenadas = ordenarEsquinas(normalizar(puntos));
  // Sin cuatro esquinas no hay escaneo, y no se inventa uno: se devuelve el
  // original. Vale la regla de siempre — nada puede impedir que la foto quede.
  if (!ordenadas) return aBlob(fuente);

  const { ancho, alto } = medidaDeSalida(ordenadas);
  const enderezada = escaner.extractPaper(fuente, ancho, alto, aFormatoJscanify(ordenadas));
  return aBlob(realzar(enderezada));
}
```

Y el realce, que es el paso que lo hace parecer un escaneo:

```typescript
/**
 * Fondo blanco y texto negro, sin binarizar.
 *
 * Un umbral duro (blanco o negro y nada en el medio) se ve muy prolijo y
 * **arruina el QR y los sellos**. Acá se estira el contraste dejando los grises:
 * el papel se va a blanco, la tinta a negro, y lo que estaba en el medio
 * sobrevive.
 */
function realzar(lienzo: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = lienzo.getContext("2d")!;
  const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
  const d = img.data;

  // El punto blanco se estima del propio papel: el percentil 90 de luminancia.
  const muestras: number[] = [];
  for (let i = 0; i < d.length; i += 4 * 97) {
    muestras.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }
  muestras.sort((a, b) => a - b);
  const blanco = Math.max(1, muestras[Math.floor(muestras.length * 0.9)]);

  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      d[i + c] = Math.min(255, Math.round((d[i + c] / blanco) * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  return lienzo;
}

function aBlob(lienzo: HTMLCanvasElement): Promise<Blob> {
  return new Promise((listo, error) =>
    lienzo.toBlob((b) => (b ? listo(b) : error(new Error("No se pudo exportar"))), "image/jpeg", 0.85),
  );
}
```

- [ ] **Step 6: Conectar con la pantalla de captura**

En `captura-cliente.tsx`, entre la foto y la subida:

1. Sacada la foto, mostrarla con **los cuatro bordes detectados dibujados encima**.
2. **Las esquinas se pueden arrastrar.** Es lo que hace usable a una app de
   escaneo: la detección automática falla seguido con carpetas de anillos y
   mesas oscuras, y sin poder corregirla el escaneo es peor que la foto cruda.
3. Un botón **"usar la foto sin recortar"**, siempre visible.
4. Al confirmar, se suben **las dos**: `ORIGINAL` y `ESCANEADA`, con el mismo
   `page`.

Y en `capturarComprobante`, aceptar los dos archivos por página y guardarlos con
su `variante`. La `ESCANEADA` es la que se muestra en la pantalla de pagos; la
`ORIGINAL` queda como seguro.

**Si el escaneo falla o `jscanify` no carga, se sube solo la `ORIGINAL`.** El
comprobante entra igual: la regla de que nada puede impedir que la foto quede
vale también acá.

- [ ] **Step 7: Comprobar a ojo con fotos reales**

Con cinco de las fotos que ya hay en `Downloads/facturas` —incluida la de CCU,
que está de costado en una carpeta de anillos—, verificar que:

- El recorte agarra la hoja y no la mesa.
- El texto queda derecho y legible.
- **El QR sigue leyéndose en la escaneada.** Si el realce lo rompió, bajar la
  agresividad: la imagen linda no vale un código perdido.
- Anotar en cuántas la detección automática acertó sin tocar las esquinas. Ese
  número dice cuánto se va a usar el arrastre.

- [ ] **Step 8: Commit**

```bash
git add lib/comprobantes/escaneo.ts "app/(app)/recepcion" app/actions/comprobantes.ts tests/comprobantes-escaneo.test.ts package.json package-lock.json
git commit -m "Hacer que la foto del papel parezca un escaneo"
```

---

### Task 12: El documento reconstruido

> **Qué es.** Un PDF limpio y siempre igual, armado **con los datos leídos** —no
> con la foto—: emisor, identidad fiscal, la tabla de renglones, los totales, el
> vencimiento. Todos los comprobantes salen con el mismo formato, así que se
> leen de un vistazo sin reorientarse con cada proveedor.
>
> **Se genera en el momento, no se guarda congelado.** Si mañana alguien corrige
> un importe, el documento sale corregido. Un PDF archivado de hace tres meses
> mostraría el dato viejo y nadie se enteraría — es la misma razón por la que en
> este módulo no hay columna de estado.
>
> **Lo que el documento NO hace:** no lleva el logo de ARCA, ni la leyenda
> "Comprobante Autorizado", ni el código de barras. Lleva impreso que es una
> reconstrucción, de qué foto salió y qué verificaciones cerraron. Es un
> documento de trabajo, legible y uniforme; el comprobante autorizado ante AFIP,
> el contador o cualquier tercero **sigue siendo la foto del original**, que está
> a un toque.

**Files:**
- Create: `lib/comprobantes/documento.tsx`
- Create: `app/api/comprobantes/[id]/documento/route.ts`
- Modify: `app/(app)/pagos/lista-pagos.tsx` (el botón)
- Test: `tests/comprobantes-documento.test.ts`

**Interfaces:**
- Consumes: `formatear` de `lib/money.ts`, los modelos `Document` y `DocumentLine`.
- Produces:
  - `type DatosDocumento = { encabezado: {...}; renglones: {...}[]; totales: {...}; procedencia: {...} }`
  - `armarDatos(doc, lines, controles): DatosDocumento`
  - `<DocumentoReconstruido datos={...} />` — componente de `@react-pdf/renderer`

- [ ] **Step 1: Escribir la prueba que falla**

Se prueba `armarDatos`, que es donde están las decisiones: qué se muestra, qué
no, y cómo se dice lo que no se pudo verificar. El PDF renderizado se mira a ojo
en el paso 5 — una prueba de "se ve bien" no existe.

Crear `tests/comprobantes-documento.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarDatos } from "../lib/comprobantes/documento";

/**
 * El documento reconstruido: mismos datos, formato uniforme.
 *
 * Lo que se protege acá es que **no se disfrace del original**. Un PDF prolijo
 * se ve más confiable que una foto borrosa, y contiene lo que la IA leyó. Si
 * además pareciera un comprobante autorizado, un error de lectura quedaría
 * lavado dentro de algo con aspecto oficial.
 */

const DOC = {
  id: "d1",
  kind: "FACTURA",
  source: "LECTURA",
  cuitEmisor: "30718089413",
  tipoCbte: "A",
  puntoVenta: 2,
  numero: 28897,
  fechaEmision: "2026-07-28",
  importeTotal: 77286775n,
  cae: "86305704041463",
  caeVence: "2026-08-07",
  vencimiento: "2026-08-04",
  createdAt: new Date("2026-09-01T12:00:00Z"),
  supplier: { name: "DINAMARK SRL" },
};

const RENGLONES = [
  { orden: 1, codigo: "1096", descripcion: "QUESO HOLANDA HORMA TREGAR",
    cantidad: 4400n, unidad: "KG", precioUnitario: 1360724n, subtotal: 5987186n },
];

const CONTROLES = { cierraLaCuenta: true, cierranLosRenglones: true, cuitValido: true };

test("arma el encabezado con la identidad fiscal completa", () => {
  const d = armarDatos(DOC, RENGLONES, CONTROLES);
  assert.equal(d.encabezado.proveedor, "DINAMARK SRL");
  assert.equal(d.encabezado.cuit, "30-71808941-3"); // con guiones, para leerlo
  assert.equal(d.encabezado.comprobante, "FACTURA A 0002-00028897");
  assert.equal(d.encabezado.fecha, "28/07/2026");
});

test("los importes salen formateados, nunca en centavos crudos", () => {
  const d = armarDatos(DOC, RENGLONES, CONTROLES);
  assert.equal(d.renglones[0].precioUnitario, "$ 13.607,24");
  assert.equal(d.renglones[0].subtotal, "$ 59.871,86");
  assert.equal(d.renglones[0].cantidad, "4,40 KG");
  assert.equal(d.totales.total, "$ 772.867,75");
});

test("dice que es una reconstrucción y de dónde salió", () => {
  const d = armarDatos(DOC, RENGLONES, CONTROLES);
  assert.match(d.procedencia.leyenda, /reconstru/i);
  assert.match(d.procedencia.leyenda, /no es el comprobante/i);
  assert.equal(d.procedencia.origen, "leído de la foto");
  assert.equal(d.procedencia.fecha, "01/09/2026");
});

test("no lleva nada que lo haga pasar por el comprobante autorizado", () => {
  const d = armarDatos(DOC, RENGLONES, CONTROLES);
  const texto = JSON.stringify(d).toLowerCase();
  for (const prohibido of ["arca", "afip", "comprobante autorizado", "codigo de barras"]) {
    assert.ok(!texto.includes(prohibido), `no debería aparecer "${prohibido}"`);
  }
  // El CAE sí va: es un dato de la factura y sirve para buscarla. Lo que no va
  // es la presentación que lo hace parecer autorizado.
  assert.equal(d.totales.cae, "86305704041463");
});

test("cuando una verificación no cerró, el documento lo dice", () => {
  const d = armarDatos(DOC, RENGLONES, { ...CONTROLES, cierraLaCuenta: false });
  assert.match(d.procedencia.advertencia ?? "", /no cierra/i);
});

test("cuando no se pudo verificar, no afirma que esté bien", () => {
  // null no es false ni true: sin sumandos no se puede decir nada, y decir que
  // "cierra" sería mentir en un documento que alguien va a usar para pagar.
  const d = armarDatos(DOC, RENGLONES, { cierraLaCuenta: null, cierranLosRenglones: null, cuitValido: null });
  assert.equal(d.procedencia.verificado, false);
  assert.match(d.procedencia.advertencia ?? "", /sin verificar/i);
});

test("un comprobante sin renglones sale igual, con la tabla vacía", () => {
  // Un ticket o un remito cargado a mano no tiene detalle, y el documento tiene
  // que salir lo mismo.
  const d = armarDatos(DOC, [], CONTROLES);
  assert.deepEqual(d.renglones, []);
  assert.equal(d.totales.total, "$ 772.867,75");
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

Run: `npx tsx --test tests/comprobantes-documento.test.ts`
Expected: FAIL — no encuentra `../lib/comprobantes/documento`.

- [ ] **Step 3: Escribir `armarDatos`**

Crear `lib/comprobantes/documento.tsx`. Primero la parte pura, que es la que
tiene las decisiones:

```typescript
import { formatear } from "@/lib/money";

export type DatosDocumento = {
  encabezado: {
    proveedor: string;
    cuit: string;
    comprobante: string;
    fecha: string;
    vencimiento: string;
  };
  renglones: {
    codigo: string;
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    subtotal: string;
  }[];
  totales: { subtotal: string; iva: string; total: string; cae: string };
  procedencia: {
    leyenda: string;
    origen: string;
    fecha: string;
    verificado: boolean;
    advertencia?: string;
  };
};

/**
 * De los datos guardados al documento que se imprime.
 *
 * Todo lo que sale de acá es texto ya formateado: el componente de PDF no
 * decide nada, solo dibuja. Así las reglas —qué se muestra, cómo se dice lo que
 * no se verificó— viven en un solo lugar y se prueban sin renderizar nada.
 */
export function armarDatos(doc: any, lines: any[], controles: any): DatosDocumento {
  const numero = `${String(doc.puntoVenta ?? 0).padStart(4, "0")}-${String(doc.numero ?? 0).padStart(8, "0")}`;

  return {
    encabezado: {
      proveedor: doc.supplier?.name ?? "Sin proveedor",
      cuit: conGuiones(doc.cuitEmisor),
      comprobante: `${etiqueta(doc.kind)} ${doc.tipoCbte ?? ""} ${numero}`.replace(/\s+/g, " ").trim(),
      fecha: aDiaLegible(doc.fechaEmision),
      vencimiento: aDiaLegible(doc.vencimiento),
    },
    renglones: lines.map((l) => ({
      codigo: l.codigo ?? "",
      descripcion: l.descripcion,
      cantidad: l.cantidad == null ? "" : `${milesimas(l.cantidad)}${l.unidad ? " " + l.unidad : ""}`,
      precioUnitario: l.precioUnitario == null ? "" : formatear(l.precioUnitario),
      subtotal: l.subtotal == null ? "" : formatear(l.subtotal),
    })),
    totales: {
      subtotal: doc.subtotal == null ? "" : formatear(doc.subtotal),
      iva: doc.iva == null ? "" : formatear(doc.iva),
      total: doc.importeTotal == null ? "" : formatear(doc.importeTotal),
      cae: doc.cae ?? "",
    },
    procedencia: procedencia(doc, controles),
  };
}

/**
 * El pie que impide que esto se confunda con el original.
 *
 * Va siempre, incluso cuando todo verificó. Un documento que a veces avisa y a
 * veces no enseña a no mirar el aviso.
 */
function procedencia(doc: any, c: any): DatosDocumento["procedencia"] {
  const verificado = c.cierraLaCuenta === true && c.cuitValido === true;
  const falló = c.cierraLaCuenta === false || c.cierranLosRenglones === false || c.cuitValido === false;
  const noSePudo = c.cierraLaCuenta == null && c.cuitValido == null;

  return {
    leyenda:
      "Documento reconstruido por el sistema a partir de los datos del comprobante. " +
      "No es el comprobante original ni lo reemplaza.",
    origen: doc.source === "LECTURA" ? "leído de la foto" : doc.source === "QR" ? "leído del QR" : "cargado a mano",
    fecha: aDiaLegible(diaDe(doc.createdAt)),
    verificado,
    advertencia: falló
      ? "Atención: la aritmética del comprobante no cierra. Revisar contra la foto."
      : noSePudo
        ? "Datos sin verificar: no hubo con qué comprobar la aritmética."
        : undefined,
  };
}

const ETIQUETAS: Record<string, string> = {
  FACTURA: "FACTURA", REMITO: "REMITO", TICKET: "TICKET",
  NOTA_CREDITO: "NOTA DE CRÉDITO", NOTA_DEBITO: "NOTA DE DÉBITO", OTRO: "COMPROBANTE",
};
const etiqueta = (k: string) => ETIQUETAS[k] ?? "COMPROBANTE";

/** `30718089413` -> `30-71808941-3`. Un CUIT corrido se lee mucho peor. */
function conGuiones(cuit: string | null): string {
  if (!cuit || cuit.length !== 11) return cuit ?? "";
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

/** `"2026-07-28"` -> `"28/07/2026"`. Solo para mostrar: guardado sigue ISO. */
function aDiaLegible(dia: string | null): string {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "";
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/** `4400` (milésimas) -> `"4,40"`. */
function milesimas(v: bigint): string {
  const entero = v / 1000n;
  const resto = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, "") || "0";
  return `${entero},${resto.padEnd(2, "0")}`;
}

function diaDe(d: Date): string {
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Correr la prueba para verificar que pasa**

Run: `npx tsx --test tests/comprobantes-documento.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 5: El PDF**

En el mismo archivo, el componente con `@react-pdf/renderer`, que **ya está en
`package.json`** — es el mismo que imprime los pedidos.

Estructura, de arriba a abajo:

1. **Encabezado:** proveedor grande, CUIT con guiones, tipo y número, fecha de
   emisión, y **vencimiento destacado** — es el dato por el que se mira este
   documento.
2. **Tabla de renglones:** código, descripción, cantidad, precio unitario,
   subtotal. Alineación a la derecha en todo lo numérico, tipografía monoespaciada
   en los importes para que las comas queden en columna.
3. **Totales** abajo a la derecha: subtotal, IVA, total. El total en negrita.
4. **CAE** en un renglón chico, como dato de búsqueda. Sin barras, sin logos.
5. **Pie de procedencia**, siempre presente: la leyenda de reconstrucción, de
   dónde salió el dato, cuándo, y la advertencia si alguna verificación no cerró.
   Cuando falló, el pie va con fondo de alerta y no en gris.

Sin logo de ARCA, sin leyenda "Comprobante Autorizado", sin código de barras.

Crear `app/api/comprobantes/[id]/documento/route.ts`: comprueba sesión y
`canVerImportes`, arma los datos, renderiza y devuelve el PDF con
`Content-Type: application/pdf`. **Se genera en el momento**: si alguien corrige
un importe, el documento sale corregido, y no queda un PDF viejo por ahí
mostrando el dato anterior.

- [ ] **Step 6: El botón**

En la lista de pagos, junto al ojo que abre la foto, un botón que abre el
documento. Los dos visibles a la vez y con nombres distintos —**"Ver el
comprobante"** para la foto, **"Ver el detalle"** para el reconstruido—, para que
en ningún momento se confunda cuál es cuál.

- [ ] **Step 7: Mirarlo con datos reales**

Generar el documento de la factura de Dinamark, con sus siete renglones, y
comprobar a ojo: que las comas de los importes queden en columna, que el
vencimiento se vea de lejos, que el pie de procedencia se lea sin buscarlo, y
que puesto al lado de la foto del original **nadie pueda confundir cuál es cuál**.

- [ ] **Step 8: Commit**

```bash
git add lib/comprobantes/documento.tsx app/api/comprobantes "app/(app)/pagos" tests/comprobantes-documento.test.ts
git commit -m "Armar el documento reconstruido a partir de los datos"
```

---

## Lo que queda fuera de la etapa 1, a propósito

- **La importación del CSV de ARCA y el emparejamiento** — etapa 2. El campo `enArca` y `mergedIntoId` ya están en el esquema para que entre sin migración de datos.
- **Alta y fusión de proveedores desde una pantalla** — hoy se crean solos al completar a mano. La fusión de duplicados escritos distinto es trabajo de administración y va con la etapa 2.
- **El botón "pedir foto de nuevo"** con aviso push a quien capturó. Está en el diseño y no tiene tarea acá, a propósito: mientras sean tres personas que se conocen y trabajan en el mismo lugar, una foto ilegible se resuelve con un mensaje. El circuito hay que cerrarlo cuando entre gente que no se cruza en el día, y la infraestructura (`web-push`, `Notification`) ya está puesta.
- **La validación del CAE contra el servicio de constatación de ARCA** — control opcional, sin fecha.

## Antes de dar la etapa 1 por terminada

- [ ] `npm test` en verde, incluidas las suites viejas.
- [ ] `npm run build` sin errores.
- [ ] `COMPROBANTES_DATABASE_URL` configurada en Railway, apuntando al disco persistente (**no** al mismo archivo que `DATABASE_URL`).
- [ ] Verificar que el respaldo de la base nueva existe y que **no** hereda los 14 días de retención de `lib/backup.ts`. Si todavía no está, anotarlo como el primer pendiente de la etapa 2 — pero no desplegar sin saberlo.
- [ ] Los tres montones de 20 comprobantes reales contados, y el número anotado en la Bitácora del vault.
