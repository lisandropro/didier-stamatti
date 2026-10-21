# Etapa 3 · Faltante nuevo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cuando algo empieza a faltar en un período (o falta más que lo ya avisado), todo el equipo reciba un aviso con prioridad que diga qué falta, cuánto, y qué pedido lo empujó.

**Architecture:** Un barrido cada minuto (el mismo esquema que los avisos de pedidos) recorre los períodos vivos que no terminaron, calcula sus faltantes con la regla de siempre (`periodShortages`, que usa `computeShortage`) y los compara con lo ya avisado, guardado en una tabla nueva `FaltanteAvisado`. La decisión (avisar, guardar, borrar) es una función pura. La primera corrida de cada período registra lo que ya falta sin avisar, marcada con `OperationalPeriod.faltantesDesde`.

**Tech Stack:** Next.js 16.3.4, Prisma 7.10 + SQLite (better-sqlite3), Web Push, pruebas con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-deposito-y-avisos-design.md`, sección "Etapa 3 · Faltante nuevo" y "Pruebas → Etapa 3".

**Construido sobre las etapas 1 y 2** (en `main`):
- `lib/push.ts`: `sendPushToUser(userId, payload, meta, { urgency })`, que registra cada envío y nunca lanza. `TipoDeAviso` ya incluye `"FALTANTE"`.
- `lib/shortages.ts`: `periodShortages(periodId)` devuelve filas `ShortageRow` con `productId`, `name`, `unit`, `totalRequested`, `stock`, `missing`.
- `lib/pedido-vacio.ts`: el modelo de un aviso de fondo que crea la `Notification` con `pushedAt` y manda el push en el momento.
- `lib/notify.ts`: la quietud de 2 minutos (`QUIET_MINUTES`) de los avisos de cambios.

## Global Constraints

- **Esto NO es el Next.js que conocés.** Antes de tocar una API de Next, leé la guía en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- **Sin dependencias nuevas.** Nombres, textos y comentarios en castellano rioplatense; los comentarios explican el *porqué*.
- **La regla de faltante es una sola.** Se usa `periodShortages` (que usa `computeShortage`): solo reutilizables, y un stock nunca contado (`null`) no falta. No se escribe una regla nueva.
- **Tabla `FaltanteAvisado`:** `periodId`, `productId`, `missing`, `at`; clave única `[periodId, productId]`. Borrar el período o el producto borra sus filas.
- **Qué avisa:**
  - un producto que falta y no estaba avisado, o que falta MÁS que lo avisado → aviso `FALTANTE` y se actualiza la fila;
  - si falta igual o menos que lo avisado → nada;
  - si dejó de faltar → se borra la fila, sin aviso.
- **Primera corrida de cada período** (`faltantesDesde` nulo): registra los faltantes que ya existen **sin avisar** y marca `faltantesDesde`. Al desplegar, todos los períodos arrancan así: el deploy no dispara un aviso por cada faltante viejo.
- **Qué períodos:** vivos (`deletedAt` nulo) y que no terminaron (`endDay >= hoy`, día argentino).
- **Quietud:** si el último cambio de pedido del período (`OrderChange`) tiene menos de `QUIET_MINUTES` (2) minutos, ese período espera al barrido siguiente. Es la misma regla que los avisos de cambios: se avisa cuando la persona terminó de editar.
- **El texto:**
  - título `Falta stock · <período>` (el nombre del período con `nombreDe`);
  - una línea por producto: `<producto>: faltan <n> (piden <total>, hay <stock>). Lo empujó el pedido de <lugar>.`;
  - sin un cambio reciente que lo explique: `… Por un ajuste de stock.`;
  - hasta 3 productos y `y N más`; el cuerpo, como máximo 500 caracteres.
  - La spec dice "Faltan 50 Copas de agua…", pero los nombres del catálogo están en singular ("Copa de agua"): por eso el producto va primero.
- **La causa:** el último `OrderChange` del período sobre ese producto (por nombre: `itemName === name`) en los últimos 60 minutos; si no hay, el último "Todo el pedido" (copiar o restaurar) en esa ventana; si tampoco, "Por un ajuste de stock".
- **Destinatarios:** todos los usuarios con un rol vigente (`ROLES`), con los prioritarios primero, **sin excluir a nadie** (un faltante no tiene autor). Urgencia `high` para todos.
- **A dónde lleva:**
  - quien ve el stock (`canVerStock`): `/?w=<periodId>`, la portada del período con el resumen de lo que se pasa del stock;
  - el depósito: `/preparar/<eventId>#faltantes`, los faltantes del período en Preparar. El evento es el de la causa; si no hay, el primer evento vivo del período por fecha.
- **Un aviso por período por barrido**, con `tag` `faltante-<periodId>`: si en un barrido faltan tres productos, sale un solo push con las tres líneas.
- **Nunca lanza.** Es una tarea de fondo: un fallo se registra con `console.error("[faltantes] …")` y no corta el barrido de los otros períodos.
- **Pruebas:** `npm test` corre `node --import tsx --test tests/*.test.ts`. Las pruebas con base usan `crearBaseDescartable`.
- **No se despliega sin el OK explícito del usuario.** Antes: la app en local sobre una copia de producción **sin suscripciones** y con las claves VAPID vacías.

## Mapa de archivos

| Archivo | Qué | Tarea |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261022120000_faltante_avisado/` | Tabla `FaltanteAvisado`, `OperationalPeriod.faltantesDesde` | 1 |
| `lib/faltantes.ts`, `tests/faltantes.test.ts` | La decisión, pura (nuevo) | 2 |
| `lib/aviso-texto.ts`, `tests/aviso-texto.test.ts` | El texto del aviso | 2 |
| `lib/faltantes-db.ts`, `tests/faltantes-db.test.ts` | El barrido contra la base (nuevo) | 3 |
| `lib/notify.ts` | Exportar `QUIET_MINUTES` | 3 |
| `instrumentation.ts`, `tests/faltantes-guardas.test.ts` | El barrido cada minuto | 4 |

---

### Task 1: Esquema — `FaltanteAvisado` y `OperationalPeriod.faltantesDesde`

**Files:**
- Modify: `prisma/schema.prisma` (modelos `OperationalPeriod` y `Product`, y modelo nuevo al final)
- Create: `prisma/migrations/20261022120000_faltante_avisado/migration.sql`

**Interfaces:**
- Produces: tabla `FaltanteAvisado` (`id`, `periodId` FK → `OperationalPeriod` `onDelete: Cascade`, `productId` FK → `Product` `onDelete: Cascade`, `missing Int`, `at DateTime @default(now())`; única `[periodId, productId]`, que Prisma expone como `periodId_productId`). `OperationalPeriod.faltantesDesde DateTime?`. Relaciones `OperationalPeriod.faltantesAvisados` y `Product.faltantesAvisados`.

- [ ] **Step 1: Editar el esquema**

En `model OperationalPeriod`, debajo de `versions  PeriodVersion[]`:

```prisma
  // Cuándo se barrieron por primera vez sus faltantes. El primer barrido
  // registra lo que ya falta SIN avisar (si no, el deploy dispararía un aviso
  // por cada faltante viejo); desde ahí se avisa solo lo nuevo. Nulo = todavía no.
  faltantesDesde    DateTime?
  faltantesAvisados FaltanteAvisado[]
```

En `model Product`, debajo de `changes    ProductChange[]`:

```prisma
  faltantesAvisados FaltanteAvisado[]
```

Al final del archivo:

```prisma
/// Lo último que se avisó que falta de un producto en un período.
///
/// El barrido de cada minuto compara lo que falta ahora con esto: avisa si
/// falta algo nuevo o más que lo avisado, y borra la fila cuando deja de
/// faltar. `missing` es lo que decía el último aviso, no lo que falta hoy.
model FaltanteAvisado {
  id        String            @id @default(cuid())
  periodId  String
  period    OperationalPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  productId String
  product   Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  missing   Int
  at        DateTime          @default(now())

  @@unique([periodId, productId])
}
```

- [ ] **Step 2: Generar la migración**

```bash
mkdir -p prisma/migrations/20261022120000_faltante_avisado
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script > prisma/migrations/20261022120000_faltante_avisado/migration.sql
cat prisma/migrations/20261022120000_faltante_avisado/migration.sql
```

Expected: `CREATE TABLE "FaltanteAvisado"` con las dos claves foráneas `ON DELETE CASCADE`, el índice único `"FaltanteAvisado_periodId_productId_key"`, y la columna `faltantesDesde` en `OperationalPeriod` (Prisma puede rehacer la tabla `OperationalPeriod` con un bloque `RedefineTables` en vez de `ADD COLUMN`; está bien, siempre que copie todas las columnas existentes). Si aparece una línea que no es SQL (`Loaded Prisma config...`), borrarla.

- [ ] **Step 3: Encabezado explicativo arriba del SQL**

```sql
-- Faltante nuevo: lo último que se avisó que falta de cada producto en cada
-- período, y la marca del primer barrido de cada período.
--
-- Nada existente cambia de valor: la tabla es nueva y `faltantesDesde` arranca
-- nula en todos los períodos. Por eso el primer barrido después del deploy
-- registra los faltantes que ya hay sin avisar.
```

Si Prisma rehízo la tabla `OperationalPeriod`, sumar al encabezado: `-- SQLite no agrega la columna en el lugar: Prisma rehace la tabla OperationalPeriod y copia todas sus filas.`

- [ ] **Step 4: Verificar que aplica, que no queda diferencia y que los datos pasan**

```bash
T="$(cygpath -u "$LOCALAPPDATA")/Temp/falt-$$.db"; : > "$T"
DATABASE_URL="file:$T" npx prisma migrate deploy
DATABASE_URL="file:$T" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
rm -f "$T"
npx prisma generate
npx tsc --noEmit
```

Expected: `All migrations have been successfully applied.`, `-- This is an empty migration.`, el cliente generado y `tsc` sin salida.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261022120000_faltante_avisado
git commit -m "Faltantes: lo ultimo avisado de cada producto y la marca del primer barrido (esquema)"
```

---

### Task 2: La decisión y el texto (puros)

**Files:**
- Create: `lib/faltantes.ts`, `tests/faltantes.test.ts`
- Modify: `lib/aviso-texto.ts` (sumar `textoDeFaltantes` y `resumenDeFaltantes`), `tests/aviso-texto.test.ts`

**Interfaces:**
- Produces (en `lib/faltantes.ts`):
  - `type Faltante = { productId: string; name: string; totalRequested: number; stock: number; missing: number }`
  - `type Avisado = { productId: string; missing: number }`
  - `type Decision = { avisar: Faltante[]; guardar: Avisado[]; borrar: string[] }`
  - `decidirFaltantes(actuales: Faltante[], avisados: Avisado[], primeraVez: boolean): Decision`
- Produces (en `lib/aviso-texto.ts`):
  - `type FaltanteConCausa = { name: string; totalRequested: number; stock: number; missing: number; causa: string | null }` (`causa` = el lugar del evento cuyo pedido lo empujó, o `null`)
  - `textoDeFaltantes(periodo: string, items: FaltanteConCausa[]): { title: string; body: string } | null`
  - `resumenDeFaltantes(periodo: string, items: FaltanteConCausa[]): string` (una línea para la lista de avisos de la app)

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/faltantes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirFaltantes, type Faltante } from "../lib/faltantes";

/**
 * Qué hacer con los faltantes de un período en cada barrido: la tabla de la
 * spec, caso por caso. Sin base de datos.
 */

const F = (productId: string, missing: number): Faltante => ({
  productId, name: `Producto ${productId}`, totalRequested: 100 + missing, stock: 100, missing,
});

test("la primera corrida registra todo lo que falta y no avisa nada", () => {
  const d = decidirFaltantes([F("a", 50), F("b", 3)], [], true);
  assert.deepEqual(d.avisar, []);
  assert.deepEqual(d.guardar, [{ productId: "a", missing: 50 }, { productId: "b", missing: 3 }]);
  assert.deepEqual(d.borrar, []);
});

test("un faltante nuevo se avisa y se guarda", () => {
  const d = decidirFaltantes([F("a", 50)], [], false);
  assert.deepEqual(d.avisar.map((f) => f.productId), ["a"]);
  assert.deepEqual(d.guardar, [{ productId: "a", missing: 50 }]);
});

test("ya avisado y faltando lo mismo: nada", () => {
  const d = decidirFaltantes([F("a", 50)], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d, { avisar: [], guardar: [], borrar: [] });
});

test("falta más que lo avisado: se avisa otra vez y se guarda lo nuevo", () => {
  const d = decidirFaltantes([F("a", 70)], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d.avisar.map((f) => f.missing), [70]);
  assert.deepEqual(d.guardar, [{ productId: "a", missing: 70 }]);
});

test("falta menos que lo avisado: no se avisa ni se baja lo guardado", () => {
  // Lo guardado es lo que se avisó: si después vuelve a subir sin pasar ese
  // número, el depósito ya sabía que faltaba al menos eso.
  const d = decidirFaltantes([F("a", 30)], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d, { avisar: [], guardar: [], borrar: [] });
});

test("dejó de faltar: se borra la fila, sin aviso", () => {
  const d = decidirFaltantes([], [{ productId: "a", missing: 50 }], false);
  assert.deepEqual(d, { avisar: [], guardar: [], borrar: ["a"] });
});

test("la primera corrida también borra lo que ya no falta", () => {
  // Una fila puede quedar de antes si el período se recuperó de la papelera.
  const d = decidirFaltantes([F("a", 1)], [{ productId: "z", missing: 9 }], true);
  assert.deepEqual(d.borrar, ["z"]);
  assert.deepEqual(d.avisar, []);
});
```

En `tests/aviso-texto.test.ts`, sumar `textoDeFaltantes` y `resumenDeFaltantes` al import y agregar al final:

```ts
test("aviso de faltante: título con el período, una línea por producto con su causa", () => {
  const t = textoDeFaltantes("Finde 24/10", [
    { name: "Copa de agua", totalRequested: 300, stock: 250, missing: 50, causa: "El Carmen Center" },
    { name: "Brasero", totalRequested: 12, stock: 10, missing: 2, causa: null },
  ]);
  assert.deepEqual(t, {
    title: "Falta stock · Finde 24/10",
    body:
      "Copa de agua: faltan 50 (piden 300, hay 250). Lo empujó el pedido de El Carmen Center.\n" +
      "Brasero: faltan 2 (piden 12, hay 10). Por un ajuste de stock.",
  });
});

test("aviso de faltante: tres productos y cuántos más, sin pasar de 500", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    name: `Producto ${i} ${"x".repeat(200)}`, totalRequested: 10, stock: 5, missing: 5, causa: "Salón",
  }));
  const t = textoDeFaltantes("P", items)!;
  assert.ok(t.body.length <= 500);
  assert.ok(t.body.endsWith("\ny 2 más"));
});

test("sin faltantes no hay aviso", () => {
  assert.equal(textoDeFaltantes("P", []), null);
});

test("el resumen para la lista de avisos entra en una línea", () => {
  assert.equal(
    resumenDeFaltantes("Finde 24/10", [
      { name: "Copa de agua", totalRequested: 300, stock: 250, missing: 50, causa: "El Carmen Center" },
      { name: "Brasero", totalRequested: 12, stock: 10, missing: 2, causa: null },
    ]),
    "Falta stock en Finde 24/10: Copa de agua (faltan 50) · Brasero (faltan 2)",
  );
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/faltantes.test.ts tests/aviso-texto.test.ts`
Expected: FAIL. `Cannot find module '../lib/faltantes'`, y `textoDeFaltantes` no existe.

- [ ] **Step 3: Escribir `lib/faltantes.ts`**

```ts
// Qué hacer con los faltantes de un período en cada barrido. Sin base de datos.
//
// Se compara lo que falta ahora con lo último que se avisó. Avisar solo lo
// nuevo o lo que empeoró es lo que hace que el aviso se lea: uno que se repite
// cada minuto por lo mismo enseña a ignorarlo.

export type Faltante = { productId: string; name: string; totalRequested: number; stock: number; missing: number };
export type Avisado = { productId: string; missing: number };
export type Decision = {
  /** Lo que hay que avisar: nuevo, o falta más que lo avisado. */
  avisar: Faltante[];
  /** Las filas a crear o actualizar en `FaltanteAvisado`. */
  guardar: Avisado[];
  /** Los productos que dejaron de faltar: su fila se borra, sin aviso. */
  borrar: string[];
};

/**
 * La primera vez que se barre un período se registra todo lo que ya falta sin
 * avisar: si no, el deploy (o un período recién creado con pedidos copiados)
 * dispararía un aviso por cada faltante viejo.
 *
 * Si falta menos que lo avisado, no se toca la fila: lo guardado es lo que se
 * avisó, y si vuelve a subir sin pasar ese número el depósito ya lo sabía.
 */
export function decidirFaltantes(actuales: Faltante[], avisados: Avisado[], primeraVez: boolean): Decision {
  const previo = new Map(avisados.map((a) => [a.productId, a.missing]));
  const faltaAhora = new Set(actuales.map((f) => f.productId));
  const borrar = avisados.filter((a) => !faltaAhora.has(a.productId)).map((a) => a.productId);

  if (primeraVez) {
    return { avisar: [], guardar: actuales.map((f) => ({ productId: f.productId, missing: f.missing })), borrar };
  }

  const avisar = actuales.filter((f) => {
    const antes = previo.get(f.productId);
    return antes === undefined || f.missing > antes;
  });
  return { avisar, guardar: avisar.map((f) => ({ productId: f.productId, missing: f.missing })), borrar };
}
```

- [ ] **Step 4: Sumar los textos a `lib/aviso-texto.ts`**

Al final del archivo:

```ts
/** Un faltante a avisar, con lo que lo explica: el lugar del evento cuyo pedido
 *  lo empujó, o `null` si no hubo un cambio de pedido reciente (bajó el stock). */
export type FaltanteConCausa = { name: string; totalRequested: number; stock: number; missing: number; causa: string | null };

/** "Copa de agua: faltan 50 (piden 300, hay 250). Lo empujó el pedido de El Carmen Center."
 *  El producto va primero porque los nombres del catálogo están en singular:
 *  "faltan 50 Copa de agua" se lee mal. */
function lineaDeFaltante(f: FaltanteConCausa): string {
  const causa = f.causa ? `Lo empujó el pedido de ${f.causa}.` : "Por un ajuste de stock.";
  return `${f.name}: faltan ${f.missing} (piden ${f.totalRequested}, hay ${f.stock}). ${causa}`;
}

/**
 * El aviso de faltante nuevo: un push por período, con hasta tres productos y
 * cuántos más. `null` si no hay nada que avisar. Como el aviso de cambios, se
 * recorta el detalle y nunca el "y N más".
 */
export function textoDeFaltantes(periodo: string, items: FaltanteConCausa[]): { title: string; body: string } | null {
  if (items.length === 0) return null;
  const visibles = items.slice(0, MAX_EN_EL_PUSH).map(lineaDeFaltante).join("\n");
  const resto = items.length > MAX_EN_EL_PUSH ? `\ny ${items.length - MAX_EN_EL_PUSH} más` : "";
  return { title: `Falta stock · ${periodo}`, body: recortar(visibles, MAX_CUERPO - resto.length) + resto };
}

/** Lo mismo en una línea, para la lista de avisos de la app. */
export function resumenDeFaltantes(periodo: string, items: FaltanteConCausa[]): string {
  const partes = items.slice(0, MAX_EN_EL_PUSH).map((f) => `${f.name} (faltan ${f.missing})`);
  const resto = items.length > MAX_EN_EL_PUSH ? ` · y ${items.length - MAX_EN_EL_PUSH} más` : "";
  return recortar(`Falta stock en ${periodo}: ${partes.join(" · ")}`, MAX_CUERPO - resto.length) + resto;
}
```

(`MAX_EN_EL_PUSH`, `MAX_CUERPO` y `recortar` ya existen en el archivo.)

- [ ] **Step 5: Correr las pruebas, el typecheck y el lint**

Run: `node --import tsx --test tests/faltantes.test.ts tests/aviso-texto.test.ts`, después `npx tsc --noEmit` y `npx eslint lib/faltantes.ts lib/aviso-texto.ts tests/faltantes.test.ts tests/aviso-texto.test.ts`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/faltantes.ts lib/aviso-texto.ts tests/faltantes.test.ts tests/aviso-texto.test.ts
git commit -m "Faltantes: que avisar en cada barrido y como se lee el aviso"
```

---

### Task 3: El barrido contra la base (`lib/faltantes-db.ts`)

**Files:**
- Create: `lib/faltantes-db.ts`, `tests/faltantes-db.test.ts`
- Modify: `lib/notify.ts` (`const QUIET_MINUTES = 2;` pasa a `export const QUIET_MINUTES = 2;`, sin otro cambio)

**Interfaces:**
- Consumes: `FaltanteAvisado`, `OperationalPeriod.faltantesDesde` (Task 1); `decidirFaltantes`, `Faltante` (Task 2); `textoDeFaltantes`, `resumenDeFaltantes`, `FaltanteConCausa` (Task 2); `periodShortages` (`lib/shortages.ts`); `sendPushToUser` (`lib/push.ts`); `ROLES`, `canVerStock`, `sortByNotificationPriority` (`lib/permissions.ts`); `nombreDe` (`lib/period-fit.ts`); `diaDe` (`lib/dates.ts`).
- Produces:
  - `CAUSA_RECIENTE_MIN = 60`
  - `barrerFaltantes(ahora?: Date): Promise<{ periodos: number; avisos: number; registrados: number }>`: `periodos` = cuántos se barrieron, `avisos` = cuántos avisos (uno por persona y período) se crearon, `registrados` = filas guardadas sin avisar en primeras corridas. Nunca lanza.

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/faltantes-db.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { diaDe, instanteDe, sumarDias } from "../lib/dates";

/**
 * El barrido de faltantes contra una base de verdad: la primera corrida no
 * avisa, un faltante nuevo avisa una vez, empeorar avisa otra vez, resolverse
 * no avisa, y la regla es la misma que la del editor.
 */

const base = crearBaseDescartable("faltantes-db");
let prisma: typeof import("../lib/db").prisma;
let barrer: typeof import("../lib/faltantes-db").barrerFaltantes;
const enviados: { title: string; body: string; url?: string; tag?: string; endpoint: string }[] = [];
let ids: { periodo: string; evento: string; ana: string; pablo: string; dante: string; enrique: string; copa: string; mesa: string };

// "Ahora" fijo: el período y el evento son de hoy, y los cambios se fechan
// respecto de este instante para no depender del reloj.
const ahora = new Date();
const hoyDia = diaDe(ahora);
const haceMin = (min: number) => new Date(ahora.getTime() - min * 60_000);

before(async () => {
  ({ prisma } = await import("../lib/db"));
  ({ barrerFaltantes: barrer } = await import("../lib/faltantes-db"));
  const push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (destino, cuerpo) => {
    enviados.push({ ...JSON.parse(cuerpo), endpoint: destino.endpoint });
    return { statusCode: 201 };
  };
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: "x" } });
  const ana = await mk("Ana", "ADMIN");
  const pablo = await mk("Pablo", "LOGISTICA");
  const dante = await mk("Dante", "DEPOSITO");
  const enrique = await mk("Enrique", "ARMADOR");
  for (const u of [pablo, dante]) {
    await prisma.pushSubscription.create({ data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${u.name}`, p256dh: "k", auth: "a" } });
  }
  const periodo = await prisma.operationalPeriod.create({ data: { label: "Finde", startDay: hoyDia, endDay: sumarDias(hoyDia, 2) } });
  const evento = await prisma.event.create({ data: { periodId: periodo.id, lugar: "El Carmen", date: instanteDe(hoyDia, "21:00") } });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mesa = await prisma.product.create({ data: { name: "Mesa", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 10 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 300 } });
  ids = { periodo: periodo.id, evento: evento.id, ana: ana.id, pablo: pablo.id, dante: dante.id, enrique: enrique.id, copa: copa.id, mesa: mesa.id };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const filas = () => prisma.faltanteAvisado.findMany({ where: { periodId: ids.periodo }, orderBy: { productId: "asc" } });
const cambio = (itemName: string, createdAt: Date) =>
  prisma.orderChange.create({ data: { eventId: ids.evento, actorName: "Enrique", itemName, kind: "CANTIDAD", createdAt } });

test("la primera corrida registra lo que ya falta sin avisar", async () => {
  const r = await barrer(ahora);
  assert.equal(r.avisos, 0);
  assert.equal(r.registrados, 1);
  assert.deepEqual((await filas()).map((f) => [f.productId, f.missing]), [[ids.copa, 50]]);
  assert.ok((await prisma.operationalPeriod.findUnique({ where: { id: ids.periodo } }))?.faltantesDesde);
  assert.equal(enviados.length, 0);
});

test("un faltante nuevo avisa una vez, a todos, con prioridad y con su causa", async () => {
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: ids.mesa, qty: 12 } });
  await cambio("Mesa", haceMin(5));
  const r = await barrer(ahora);
  assert.equal(r.avisos, 4, "uno por persona: nadie queda afuera, ni quien hizo el cambio");
  assert.equal(enviados.length, 2, "Pablo y Dante tienen teléfono");
  for (const p of enviados) {
    assert.equal(p.title, "Falta stock · Finde");
    assert.equal(p.body, "Mesa: faltan 2 (piden 12, hay 10). Lo empujó el pedido de El Carmen.");
    assert.equal(p.tag, `faltante-${ids.periodo}`);
  }
  const deDante = enviados.find((p) => p.endpoint.endsWith("Dante"))!;
  const dePablo = enviados.find((p) => p.endpoint.endsWith("Pablo"))!;
  assert.equal(deDante.url, `/preparar/${ids.evento}#faltantes`, "el depósito va a los faltantes de Preparar");
  assert.equal(dePablo.url, `/?w=${ids.periodo}`, "quien ve el stock va a la portada del período");
  const entregas = await prisma.pushDelivery.findMany({ where: { kind: "FALTANTE" } });
  assert.ok(entregas.length === 2 && entregas.every((e) => e.urgency === "high"));
  const avisos = await prisma.notification.findMany({ where: { type: "FALTANTE" } });
  assert.equal(avisos.length, 4);
  assert.ok(avisos.every((a) => a.pushedAt !== null && a.message === "Falta stock en Finde: Mesa (faltan 2)"));

  enviados.length = 0;
  assert.equal((await barrer(ahora)).avisos, 0, "el mismo faltante no se avisa dos veces");
  assert.equal(enviados.length, 0);
});

test("empeorar avisa otra vez; mejorar no avisa ni baja lo guardado", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 320 } });
  await cambio("Copa de agua", haceMin(5));
  assert.equal((await barrer(ahora)).avisos, 4);
  assert.match(enviados[0].body, /^Copa de agua: faltan 70 \(piden 320, hay 250\)/);

  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 310 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).find((f) => f.productId === ids.copa)?.missing, 70);
});

test("resolverse no avisa y borra la fila", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.mesa }, data: { qty: 10 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).some((f) => f.productId === ids.mesa), false);
  assert.equal(enviados.length, 0);
});

test("mientras alguien sigue cambiando pedidos del período, el barrido espera", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 330 } });
  const reciente = await cambio("Copa de agua", haceMin(0.5));
  assert.equal((await barrer(ahora)).avisos, 0, "hace 30 segundos que se cambió: todavía no");
  await prisma.orderChange.update({ where: { id: reciente.id }, data: { createdAt: haceMin(3) } });
  assert.equal((await barrer(ahora)).avisos, 4, "pasada la quietud, sale");
});

test("sin un cambio de pedido reciente, la causa es un ajuste de stock", async () => {
  enviados.length = 0;
  await prisma.orderChange.updateMany({ data: { createdAt: haceMin(120) } });
  await prisma.product.update({ where: { id: ids.copa }, data: { stock: 200 } });
  assert.equal((await barrer(ahora)).avisos, 4);
  assert.match(enviados[0].body, /Copa de agua: faltan 130 \(piden 330, hay 200\)\. Por un ajuste de stock\.$/);
  const deDante = enviados.find((p) => p.endpoint.endsWith("Dante"))!;
  assert.equal(deDante.url, `/preparar/${ids.evento}#faltantes`, "sin causa, el primer evento del período");
});

test("la regla es la del editor: un consumible o un producto sin contar no avisan", async () => {
  enviados.length = 0;
  const vaso = await prisma.product.create({ data: { name: "Vaso descartable", category: "ENSERES", type: "CONSUMIBLE", stock: 1 } });
  const plato = await prisma.product.create({ data: { name: "Plato", category: "ENSERES", type: "REUTILIZABLE", stock: null } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: vaso.id, qty: 1000 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: plato.id, qty: 50 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).some((f) => f.productId === vaso.id || f.productId === plato.id), false);
});

test("un período que ya terminó no se barre", async () => {
  enviados.length = 0;
  const viejo = await prisma.operationalPeriod.create({
    data: { label: "Viejo", startDay: sumarDias(hoyDia, -5), endDay: sumarDias(hoyDia, -3), faltantesDesde: haceMin(9999) },
  });
  const ev = await prisma.event.create({ data: { periodId: viejo.id, lugar: "Pasado", date: instanteDe(sumarDias(hoyDia, -4), "21:00") } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: ids.mesa, qty: 500 } });
  await barrer(ahora);
  assert.equal(await prisma.faltanteAvisado.count({ where: { periodId: viejo.id } }), 0);
  assert.equal(enviados.length, 0);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/faltantes-db.test.ts`
Expected: FAIL con `Cannot find module '../lib/faltantes-db'`.

- [ ] **Step 3: Exportar la quietud**

En `lib/notify.ts`, cambiar `const QUIET_MINUTES = 2;` por `export const QUIET_MINUTES = 2;`. No se cambia nada más.

- [ ] **Step 4: Escribir `lib/faltantes-db.ts`**

```ts
// El barrido de faltantes: cada minuto, para cada período vivo que no terminó,
// compara lo que falta ahora con lo último que se avisó y avisa lo nuevo.
//
// La regla de faltante es la de siempre (`periodShortages` → `computeShortage`):
// el aviso no puede decir algo distinto de lo que muestra la pantalla.

import { prisma } from "@/lib/db";
import { diaDe } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";
import { periodShortages } from "@/lib/shortages";
import { decidirFaltantes, type Faltante } from "@/lib/faltantes";
import { resumenDeFaltantes, textoDeFaltantes, type FaltanteConCausa } from "@/lib/aviso-texto";
import { sendPushToUser } from "@/lib/push";
import { ROLES, canVerStock, sortByNotificationPriority } from "@/lib/permissions";
import { QUIET_MINUTES } from "@/lib/notify";

/** Un cambio de pedido más viejo que esto ya no explica un faltante: si nada
 *  se movió en la última hora, lo que cambió fue el stock. */
export const CAUSA_RECIENTE_MIN = 60;

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Un barrido a la vez, como el de los avisos de pedidos: si uno se demora (el
// servicio de push lento), el siguiente no puede leer lo mismo y avisar dos veces.
let barriendo = false;

type Periodo = { id: string; label: string | null; startDay: string; endDay: string; faltantesDesde: Date | null };

/** Por qué falta cada producto: el lugar del último cambio de pedido del
 *  período sobre ese producto en la última hora, o el de un "Todo el pedido"
 *  (copiar o restaurar), o nada. Devuelve también el evento de esa causa. */
async function causas(periodId: string, faltantes: Faltante[], ahora: Date) {
  const cambios = await prisma.orderChange.findMany({
    where: { event: { periodId }, createdAt: { gte: new Date(ahora.getTime() - CAUSA_RECIENTE_MIN * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { itemName: true, event: { select: { id: true, lugar: true } } },
  });
  const out = new Map<string, { lugar: string; eventId: string } | null>();
  for (const f of faltantes) {
    const c = cambios.find((x) => x.itemName === f.name) ?? cambios.find((x) => x.itemName === "Todo el pedido");
    out.set(f.productId, c ? { lugar: c.event.lugar, eventId: c.event.id } : null);
  }
  return out;
}

/** Crea el aviso de cada persona y manda los push. Devuelve cuántos avisos se crearon. */
async function avisar(p: Periodo, aAvisar: Faltante[], guardar: { productId: string; missing: number }[], borrar: string[], ahora: Date) {
  const porProducto = await causas(p.id, aAvisar, ahora);
  const items: FaltanteConCausa[] = aAvisar.map((f) => ({ ...f, causa: porProducto.get(f.productId)?.lugar ?? null }));
  const nombre = nombreDe(p);
  const texto = textoDeFaltantes(nombre, items);
  if (!texto) return 0;

  // El depósito va a los faltantes del período en Preparar: el evento de la
  // primera causa, o si no hay, el primer evento vivo del período.
  const deCausa = aAvisar.map((f) => porProducto.get(f.productId)?.eventId).find(Boolean);
  const evento =
    deCausa ??
    (await prisma.event.findFirst({ where: { periodId: p.id, deletedAt: null }, orderBy: { date: "asc" }, select: { id: true } }))?.id ??
    null;

  // Un faltante no tiene autor: le llega a todos, prioritarios primero.
  const personas = sortByNotificationPriority(
    await prisma.user.findMany({ where: { role: { in: [...ROLES] } }, select: { id: true, role: true } }),
  );
  const linkDe = (role: string) => (canVerStock(role) || !evento ? `/?w=${p.id}` : `/preparar/${evento}#faltantes`);
  const mensaje = resumenDeFaltantes(nombre, items);

  // Las filas y los avisos de la app van juntos: si algo falla, no queda una
  // fila que diga "avisado" sin el aviso, ni un aviso que se repita.
  const creados = await prisma.$transaction(async (tx) => {
    for (const g of guardar) {
      await tx.faltanteAvisado.upsert({
        where: { periodId_productId: { periodId: p.id, productId: g.productId } },
        update: { missing: g.missing, at: ahora },
        create: { periodId: p.id, productId: g.productId, missing: g.missing, at: ahora },
      });
    }
    if (borrar.length > 0) await tx.faltanteAvisado.deleteMany({ where: { periodId: p.id, productId: { in: borrar } } });
    const out: { id: string; userId: string; link: string }[] = [];
    for (const u of personas) {
      const link = linkDe(u.role);
      const n = await tx.notification.create({
        data: {
          recipientId: u.id,
          actorName: "Sistema",
          type: "FALTANTE",
          message: mensaje,
          eventId: evento,
          linkUrl: link,
          // El push sale acá mismo: queda marcado como enviado, como el aviso
          // de pedido vacío. Si un envío falla, lo reintenta `reintentarFallidos`.
          pushedAt: ahora,
        },
      });
      out.push({ id: n.id, userId: u.id, link });
    }
    return out;
  });

  for (const c of creados) {
    await sendPushToUser(
      c.userId,
      { title: texto.title, body: texto.body, url: c.link, tag: `faltante-${p.id}` },
      { kind: "FALTANTE", notificationId: c.id },
      { urgency: "high" },
    );
  }
  return creados.length;
}

/**
 * Barre los faltantes de los períodos vivos que no terminaron. Corre cada un
 * minuto desde `instrumentation.ts`. Nunca lanza: un período que falla se
 * anota y el resto sigue.
 */
export async function barrerFaltantes(ahora: Date = new Date()): Promise<{ periodos: number; avisos: number; registrados: number }> {
  if (barriendo) return { periodos: 0, avisos: 0, registrados: 0 };
  barriendo = true;
  let periodos = 0;
  let avisos = 0;
  let registrados = 0;
  try {
    const vivos = await prisma.operationalPeriod.findMany({
      where: { deletedAt: null, endDay: { gte: diaDe(ahora) } },
      select: { id: true, label: true, startDay: true, endDay: true, faltantesDesde: true },
    });
    for (const p of vivos) {
      try {
        // Quietud: mientras alguien sigue cambiando pedidos del período, se
        // espera. El aviso sale cuando terminó de editar, con el número final.
        const ultimo = await prisma.orderChange.findFirst({
          where: { event: { periodId: p.id } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (ultimo && ahora.getTime() - ultimo.createdAt.getTime() < QUIET_MINUTES * 60_000) continue;
        periodos++;

        const actuales: Faltante[] = (await periodShortages(p.id)).map((r) => ({
          productId: r.productId,
          name: r.name,
          totalRequested: r.totalRequested,
          stock: r.stock,
          missing: r.missing,
        }));
        const avisados = await prisma.faltanteAvisado.findMany({
          where: { periodId: p.id },
          select: { productId: true, missing: true },
        });
        const primeraVez = p.faltantesDesde === null;
        const d = decidirFaltantes(actuales, avisados, primeraVez);

        if (primeraVez || d.avisar.length === 0) {
          // Sin aviso: solo se acomodan las filas (y se marca la primera corrida).
          await prisma.$transaction([
            ...d.guardar.map((g) =>
              prisma.faltanteAvisado.upsert({
                where: { periodId_productId: { periodId: p.id, productId: g.productId } },
                update: { missing: g.missing, at: ahora },
                create: { periodId: p.id, productId: g.productId, missing: g.missing, at: ahora },
              }),
            ),
            prisma.faltanteAvisado.deleteMany({ where: { periodId: p.id, productId: { in: d.borrar } } }),
            ...(primeraVez ? [prisma.operationalPeriod.update({ where: { id: p.id }, data: { faltantesDesde: ahora } })] : []),
          ]);
          if (primeraVez) registrados += d.guardar.length;
          continue;
        }

        avisos += await avisar(p, d.avisar, d.guardar, d.borrar, ahora);
      } catch (e) {
        console.error("[faltantes] no se pudo barrer el período, se reintenta en el próximo barrido", p.id, mensajeDe(e));
      }
    }
    return { periodos, avisos, registrados };
  } catch (e) {
    console.error("[faltantes] falló el barrido", mensajeDe(e));
    return { periodos, avisos, registrados };
  } finally {
    barriendo = false;
  }
}
```

- [ ] **Step 5: Correr las pruebas, el typecheck, el lint y la suite**

Run: `node --import tsx --test tests/faltantes-db.test.ts`, después `npx tsc --noEmit`, `npx eslint lib/faltantes-db.ts lib/notify.ts tests/faltantes-db.test.ts` y `npm test`
Expected: todo en verde (las pruebas de avisos existentes no cambian: `QUIET_MINUTES` solo pasó a exportarse).

- [ ] **Step 6: Commit**

```bash
git add lib/faltantes-db.ts lib/notify.ts tests/faltantes-db.test.ts
git commit -m "Faltantes: el barrido avisa lo nuevo o lo que empeoro, a todos y con prioridad"
```

---

### Task 4: El barrido cada minuto

**Files:**
- Modify: `instrumentation.ts`
- Create: `tests/faltantes-guardas.test.ts`

**Interfaces:**
- Consumes: `barrerFaltantes` (Task 3).

- [ ] **Step 1: Escribir la prueba que falla**

`tests/faltantes-guardas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** El barrido de faltantes corre solo, cada minuto, desde que arranca el servidor. */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

test("el barrido de faltantes arranca con el servidor y corre cada minuto", () => {
  const s = fuente("instrumentation.ts");
  assert.match(s, /import\("@\/lib\/faltantes-db"\)/);
  assert.match(s, /void barrerFaltantesYAnotar\(\);/);
  assert.match(s, /setInterval\(\(\) => void barrerFaltantesYAnotar\(\), MINUTE\)/);
  // Fuera de la condición del respaldo: avisar que falta stock no depende de S3.
  assert.ok(s.indexOf("barrerFaltantesYAnotar") < s.indexOf("if (!process.env.BACKUP_S3_BUCKET)"));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/faltantes-guardas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Sumar el barrido a `instrumentation.ts`**

Después del bloque `// --- Avisos de pedido vacío ---` (y antes de `// --- Vaciado de la papelera ---`):

```ts
  // --- Faltante nuevo --------------------------------------------------------
  // Cada minuto, como los avisos de pedidos: un faltante tiene que llegar al
  // depósito mientras todavía se puede conseguir. Fuera de la condición del
  // respaldo, por lo mismo que el aviso de pedido vacío.
  const { barrerFaltantes } = await import("@/lib/faltantes-db");
  const barrerFaltantesYAnotar = async () => {
    const { avisos, registrados } = await barrerFaltantes();
    if (avisos > 0 || registrados > 0) {
      console.log(`[faltantes] avisos: ${avisos} · registrados sin avisar: ${registrados}`);
    }
  };
  void barrerFaltantesYAnotar();
  setInterval(() => void barrerFaltantesYAnotar(), MINUTE);
```

- [ ] **Step 4: Correr la prueba, el typecheck, el lint, la suite y la compilación**

Run: `node --import tsx --test tests/faltantes-guardas.test.ts`, después `npx tsc --noEmit`, `npx eslint`, `npm test` y `npm run build`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts tests/faltantes-guardas.test.ts
git commit -m "Faltantes: el barrido corre solo, cada minuto"
```

---

### Task 5: Revisión, verificación con datos reales y deploy (con OK del usuario)

- [ ] **Step 1: Revisión de la rama entera contra la spec**, con el modelo más capaz y el paquete de revisión de `main..HEAD`.
- [ ] **Step 2: Suite, lint y compilación desde cero:** `rm -rf .next && npm test && npx eslint && npm run build`.
- [ ] **Step 3: Copia de producción, sin suscripciones**, como en las etapas 1 y 2:
  - bajar la última copia con `railway run` sin imprimir credenciales; aplicar la migración; borrar `PushSubscription` de la copia;
  - levantar `next start` con las claves VAPID vacías;
  - comprobar en el log que el primer barrido dice `registrados sin avisar: N` y **ningún aviso**;
  - en la copia, subir la cantidad de un producto reutilizable de un período que viene hasta que falte, esperar más de 2 minutos y comprobar que aparece un aviso `FALTANTE` para cada persona, con el texto y el link correctos; volver a barrer y que no se repita;
  - **apagar el servidor por su PID** al terminar (en Windows, `TaskStop` no mata el `next start` hijo).
- [ ] **Step 4: Pedir el OK del usuario y desplegar.** Antes, un respaldo manual (`/api/internal/backup`). Con el sí: `main` por fast-forward, push, seguir el deploy y verificar en el log que se aplicó `20261022120000_faltante_avisado` y que el primer barrido registró sin avisar.
- [ ] **Step 5: Bitácora** en el vault, commit y `git push onedrive master`.
