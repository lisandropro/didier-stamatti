# Etapa 2 · Rol Depósito, preparación y cambio tardío — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el personal que prepara los pedidos los vea en el teléfono, tilde lo que junta, y se entere con prioridad y con la diferencia exacta ("sumá 14 copas") cuando alguien cambia algo que ya estaba preparado.

**Architecture:**
- **Lo tildado.** Una tabla `Preparacion` guarda, por ítem del pedido (no por renglón), lo que había en el pedido en el momento de tildar. El estado de cada ítem (pendiente, preparado, cambió, cambió la nota, sacar) se **calcula** comparando lo tildado con el pedido de ahora, en una función pura (`lib/preparacion.ts`).
- **El cambio tardío.** Las acciones del pedido marcan `OrderChange.tardio` cuando el ítem ya estaba tildado. `notifyOrderChange` los manda a una tanda propia, `CAMBIO_TARDIO`. El barrido arma su texto con las acciones pendientes del evento y la manda con prioridad alta a todos.
- **Pantallas nuevas.** `/preparar` y `/preparar/[eventId]`, pensadas para el teléfono.

**Tech Stack:** Next.js 16.3.4 (App Router, server actions), Prisma 7.10 + SQLite, pruebas con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-deposito-y-avisos-design.md`, sección "Etapa 2" (y "Lo que decidió el usuario", puntos 5 a 9).

**Construido sobre la etapa 1** (en `main` desde el 19/10):
- `lib/push.ts`: `sendPushToUser(userId, payload, meta, options)` registra cada envío y nunca lanza.
- `lib/notify.ts`: tandas por destinatario, quietud de 2 minutos, relectura antes de enviar, corrección cuando lo avisado se deshace, guard de re-entrada.
- `lib/aviso-texto.ts`: textos con tope de 500.
- `tests/helpers/base-descartable.ts`: SQLite descartable para las pruebas.

## Global Constraints

- **Esto NO es el Next.js que conocés.** Antes de tocar una API de Next, leé la guía en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- **Sin dependencias nuevas.** Nombres y comentarios en castellano rioplatense; los comentarios explican el *porqué*.
- **Rol nuevo:** `DEPOSITO`, etiqueta "Depósito", ayuda "Prepara los pedidos en el teléfono".
- **Matriz de capacidades (spec):**

  | Capacidad | ADMIN | ARMADOR | LOGISTICA | DEPOSITO |
  |---|---|---|---|---|
  | `canVerStock` | ✓ | ✓ | ✓ | — |
  | `canVerPreparacion` | ✓ | ✓ | ✓ | ✓ |
  | `canPreparar` | ✓ | — | ✓ | ✓ |
  | `canEditOrders` | ✓ | ✓ | — | — |
  | `isPriorityRecipient` | — | — | ✓ | ✓ |

- **El depósito ve todas las cantidades** (del pedido, lo que hay, lo que falta) y **no modifica nada del pedido**.
- **Clave de un ítem:** `productId` para el catálogo, `custom:<orderLineId>` para los sueltos.
- **Estados**, calculados y nunca guardados:
  - `PENDIENTE`: no tildado;
  - `PREPARADO`: tildado con la misma cantidad y nota;
  - `CAMBIO`: otra cantidad → "Sumá N" / "Sacá N";
  - `NOTA`: misma cantidad, otra nota;
  - `SACAR`: tildado y ya no está en el pedido → "Sacá N · ya no va".
- **"Cambios para aplicar"** = los ítems en `CAMBIO`, `NOTA` o `SACAR`. La spec nombra "Cambió y Sacar", pero un cambio solo de nota también es tardío: si `NOTA` quedara afuera, ese aviso saldría sin nada que decir y no sonaría.
- **Tildar un sector entero** tilda solo lo `PENDIENTE`.
- **Cambio tardío** = todo cambio a un ítem que tiene `Preparacion`; un cambio solo de nota también cuenta. `addCustomLine` nunca es tardío. Se decide **dentro de la misma transacción que escribe**.
- **Límite conocido.** Copiar un pedido borra los renglones y los crea de nuevo, así que los sueltos cambian de id: lo tildado de un suelto queda en `SACAR` y el suelto nuevo, en `PENDIENTE` (es lo esperable: el pedido nuevo es el de otro evento). **Restaurar y descartar sí lo resuelven** desde la revisión final: `reasignarSueltos` devuelve lo tildado al renglón nuevo del mismo ítem (mismo nombre, sector y unidad).
- **Aviso `CAMBIO_TARDIO`:**
  - tanda propia, misma quietud de 2 minutos, urgencia `high` para todos los destinatarios;
  - título `⚠ Cambio en pedido ya preparado · <lugar>`, con `HOY · ` adelante si el evento es hoy (día argentino);
  - cuerpo: las acciones (`Sumá 14 Copas de agua · Sacá 3 Braseros · y 2 más`) y `— <quién>`, con un máximo de 500 caracteres;
  - abre `/preparar/<eventId>`.
- **`/preparar`** lista los eventos vivos desde hoy hasta 14 días adelante.
- **Registro de cambios tardíos:** solo para quien pasa `canManageUsers`.
- **Pruebas:** `npm test` corre `node --import tsx --test tests/*.test.ts`. Las pruebas con base usan `crearBaseDescartable`.
- **No se despliega sin el OK explícito del usuario.** Antes: la app en local sobre una copia de producción **sin suscripciones** y con las claves VAPID vacías.

## Mapa de archivos

| Archivo | Qué | Tarea |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261021120000_preparacion/` | Modelo `Preparacion`, `OrderChange.tardio` | 1 |
| `lib/permissions.ts` | Rol `DEPOSITO`, `canVerPreparacion`, `canPreparar`, prioridad | 2 |
| `components/Sidebar.tsx`, `components/MobileNav.tsx`, `app/(app)/page.tsx` | Entrada "Preparar"; la portada lleva al depósito a `/preparar` | 2 |
| `tests/permissions.test.ts`, `tests/event-edit.test.ts`, `tests/period-crud.test.ts`, `tests/suggestions.test.ts` | Matrices con el rol nuevo | 2 |
| `tests/preparacion-guardas.test.ts` | Pruebas sobre el texto de pantallas y acciones (nuevo) | 2, 5, 6, 8, 9 |
| `lib/preparacion.ts` | Estados, acciones y avance, puro (nuevo) | 3 |
| `tests/preparacion.test.ts` | (nuevo) | 3 |
| `lib/preparacion-db.ts` | Leer, tildar, destildar, tildar un sector, eventos a preparar (nuevo) | 4 |
| `lib/shortages.ts` | `periodShortages` | 4 |
| `tests/preparacion-db.test.ts` | (nuevo) | 4 |
| `app/actions/preparacion.ts` | Acciones de tildado (nuevo) | 5 |
| `lib/notify.ts`, `lib/aviso-texto.ts` | `tardio`, tanda `CAMBIO_TARDIO`, `RESTAURADO` | 6, 7 |
| `app/actions/order.ts`, `app/actions/snapshot.ts` | Marcan los cambios tardíos | 6 |
| `tests/notifications.test.ts`, `tests/aviso-texto.test.ts` | Pruebas de tanda y texto | 6, 7 |
| `app/(app)/preparar/page.tsx`, `app/(app)/preparar/[eventId]/page.tsx`, `components/Preparar.tsx`, `app/globals.css` | Pantallas de preparar (nuevas) | 8 |
| `app/(app)/evento/[id]/page.tsx`, `components/OrderBuilder.tsx`, `app/(app)/page.tsx`, `components/PeriodHub.tsx` | Advertencia antes de cambiar lo preparado | 9 |
| `lib/cambios-tardios.ts`, `app/(app)/cambios-tardios/page.tsx`, `tests/cambios-tardios.test.ts` | Registro (nuevo) | 10 |
| `components/InstalarApp.tsx`, `app/manifest.ts`, `app/(app)/notificaciones/page.tsx` | Instalación guiada | 11 |

---

### Task 1: Esquema — `Preparacion` y `OrderChange.tardio`

**Files:**
- Modify: `prisma/schema.prisma` (modelos `Event` y `OrderChange`, y modelo nuevo al final)
- Create: `prisma/migrations/20261021120000_preparacion/migration.sql`

**Interfaces:**
- Produces: tabla `Preparacion` (`id`, `eventId` FK → `Event` `onDelete: Cascade`, `clave`, `itemName`, `unit`, `category`, `qty`, `note?`, `porId?`, `porName`, `at`; único `[eventId, clave]`, que Prisma expone como `eventId_clave`). `OrderChange.tardio Boolean @default(false)`. La relación `Event.preparaciones`.

- [ ] **Step 1: Editar el esquema**

En `model Event`, debajo de `changes     OrderChange[]`:

```prisma
  preparaciones Preparacion[]
```

En `model OrderChange`, debajo de `createdAt DateTime @default(now())`:

```prisma
  // El ítem ya estaba tildado como preparado cuando se cambió: el depósito tiene
  // que rehacer algo físico. Alimenta el aviso CAMBIO_TARDIO y su registro.
  tardio    Boolean  @default(false)
```

y, junto a `@@index([eventId, createdAt])`:

```prisma
  @@index([tardio, createdAt])
```

Al final del archivo:

```prisma
/// Lo que el depósito tildó como preparado en un evento: una fila por ÍTEM.
///
/// La clave es el ítem y no el renglón del pedido (`productId`, o
/// `custom:<orderLineId>` para los sueltos): si el renglón se borra, lo tildado
/// queda, y eso es justamente lo que le dice al depósito "sacá esto". Se copian
/// nombre, unidad y sector para que esa fila se pueda leer sola.
///
/// `qty` y `note` son lo que había en el pedido EN EL MOMENTO de tildar. El
/// estado (pendiente, preparado, cambió...) no se guarda: se calcula comparando
/// esto con el pedido de ahora (lib/preparacion.ts).
model Preparacion {
  id       String   @id @default(cuid())
  eventId  String
  event    Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  clave    String
  itemName String
  unit     String
  category String
  qty      Int
  note     String?
  porId    String?
  porName  String
  at       DateTime @default(now())

  @@unique([eventId, clave])
}
```

- [ ] **Step 2: Generar la migración**

```bash
mkdir -p prisma/migrations/20261021120000_preparacion
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script > prisma/migrations/20261021120000_preparacion/migration.sql
cat prisma/migrations/20261021120000_preparacion/migration.sql
```

Expected:
- `ALTER TABLE "OrderChange" ADD COLUMN "tardio" BOOLEAN NOT NULL DEFAULT false`;
- `CREATE TABLE "Preparacion"` con su clave foránea `ON DELETE CASCADE`;
- `CREATE UNIQUE INDEX "Preparacion_eventId_clave_key"`;
- `CREATE INDEX "OrderChange_tardio_createdAt_idx"`.

Si aparece una línea que no es SQL (`Loaded Prisma config...`), borrarla.

- [ ] **Step 3: Encabezado explicativo arriba del SQL**

```sql
-- Preparación en el depósito: lo que se tildó, ítem por ítem, y la marca de
-- cambio tardío en el historial del pedido.
--
-- Todo es nuevo o tiene valor por omisión: ningún dato existente cambia. Los
-- cambios ya guardados quedan con tardio = false, que es lo cierto: hasta hoy
-- nadie tildaba nada.
```

- [ ] **Step 4: Verificar que aplica y que no queda diferencia**

```bash
T="$TEMP/prep-$$.db"; : > "$T"
DATABASE_URL="file:$T" npx prisma migrate deploy
DATABASE_URL="file:$T" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
npx prisma generate
npx tsc --noEmit
```

Expected: `All migrations have been successfully applied.`, `-- This is an empty migration.`, el cliente generado, y `tsc` sin salida.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261021120000_preparacion
git commit -m "Deposito: lo tildado en la preparacion, y la marca de cambio tardio (esquema)"
```

---

### Task 2: Rol `DEPOSITO`, permisos, navegación y portada

**Files:**
- Modify: `lib/permissions.ts`, `components/Sidebar.tsx`, `components/MobileNav.tsx`, `app/(app)/page.tsx`
- Modify (tests): `tests/permissions.test.ts`, `tests/event-edit.test.ts`, `tests/period-crud.test.ts`, `tests/suggestions.test.ts`
- Create: `tests/preparacion-guardas.test.ts`

**Interfaces:**
- Produces: `canVerPreparacion(role: string): boolean`, `canPreparar(role: string): boolean` en `lib/permissions.ts`; `ROLES` incluye `"DEPOSITO"`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `tests/permissions.test.ts`, agregar `canVerPreparacion`, `canPreparar` y `canVerStock` al import desde `../lib/permissions`. Agregar a `MATRIZ`, después de `LOGISTICA`:

```ts
  // Quien prepara físicamente los pedidos: ve y tilda, no toca nada del pedido.
  DEPOSITO: {
    canView: true,
    canEditOrders: false,
    canManagePeriods: false,
    canEditStock: false,
    canManageCatalog: false,
    canManageUsers: false,
    canSetResponsable: false,
  },
```

Y al final del archivo:

```ts
// --- Preparación en el depósito ------------------------------------------------

const PREPARACION = {
  ADMIN: { ver: true, tildar: true, stock: true },
  ARMADOR: { ver: true, tildar: false, stock: true },
  LOGISTICA: { ver: true, tildar: true, stock: true },
  DEPOSITO: { ver: true, tildar: true, stock: false },
} as const;

for (const rol of Object.keys(PREPARACION) as (keyof typeof PREPARACION)[]) {
  test(`${rol}: ver preparación = ${PREPARACION[rol].ver}, tildar = ${PREPARACION[rol].tildar}, ver stock = ${PREPARACION[rol].stock}`, () => {
    assert.equal(canVerPreparacion(rol), PREPARACION[rol].ver);
    assert.equal(canPreparar(rol), PREPARACION[rol].tildar);
    assert.equal(canVerStock(rol), PREPARACION[rol].stock);
  });
}

test("la matriz de preparación cubre todos los roles", () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(PREPARACION).sort());
});

test("un rol inventado no ve ni tilda la preparación", () => {
  assert.equal(canVerPreparacion("SUPERUSUARIO"), false);
  assert.equal(canPreparar("SUPERUSUARIO"), false);
  assert.equal(canPreparar(""), false);
});

test("al depósito se le concede ver, preparar y sugerir; nada más", async () => {
  // Se barren TODAS las capacidades exportadas, como la prueba de logística en
  // period-crud.test.ts: si mañana alguien le abre un permiso "para que ayude",
  // esta prueba obliga a decidirlo en voz alta.
  const permisos = await import("../lib/permissions");
  const enTrue = Object.entries(permisos)
    .filter(([k, f]) => k.startsWith("can") && typeof f === "function" && (f as (r: string) => boolean)("DEPOSITO"))
    .map(([k]) => k)
    .sort();
  assert.deepEqual(enTrue, ["canPreparar", "canSendSuggestions", "canVerPreparacion", "canView"]);
});
```

En el mismo archivo, **reemplazar** la prueba `"solo el encargado de logística es destinatario prioritario"` por:

```ts
test("logística y el depósito son los destinatarios prioritarios", () => {
  // Son los que salen a conseguir o a juntar las cosas.
  assert.equal(isPriorityRecipient("LOGISTICA"), true);
  assert.equal(isPriorityRecipient("DEPOSITO"), true);
  assert.equal(isPriorityRecipient("ADMIN"), false);
  assert.equal(isPriorityRecipient("ARMADOR"), false);
});
```

Y en la prueba `"un usuario que conserve un rol del módulo financiero no puede nada"`:
- borrar la línea `const { canVerStock, canSendSuggestions, canSeeChecks } = await import("../lib/permissions");`;
- sumar `canSendSuggestions` y `canSeeChecks` al import de arriba (`canVerStock` ya se sumó);
- en el `for`, recorrer `[...Object.values(FN), canVerStock, canSendSuggestions, canSeeChecks, canVerPreparacion, canPreparar]`.

En `tests/event-edit.test.ts` y `tests/period-crud.test.ts`, sumar `DEPOSITO: false` a `PUEDE_CORREGIR` y a `PUEDE_GESTIONAR_PERIODOS`. En `tests/suggestions.test.ts`, sumar `DEPOSITO: { enviar: true, gestionar: false },` a `ESPERADO`.

En `tests/period-crud.test.ts`, la prueba `"a LOGISTICA no se le abrió ningún permiso nuevo..."` va a fallar, y está bien que falle: logística recibe dos capacidades nuevas. Se decide en voz alta. Cambiar su nombre por `"a LOGISTICA se le abrió solo lo que se decidió: mirar, sugerir, el responsable y preparar"`, sumar `"canVerPreparacion", "canPreparar"` a `CONCEDIDOS`, y agregar al final de su comentario:

```ts
  // `canVerPreparacion` y `canPreparar` (19/10/2026, etapa 2 del depósito): el
  // encargado de logística también junta las cosas, así que ve la preparación
  // y tilda. Sigue sin tocar nada del pedido: `canEditOrders` queda en false.
```

Crear `tests/preparacion-guardas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardas de la preparación sobre el texto de los archivos: las pantallas y
 * acciones leen la sesión de las cookies y no corren fuera de Next.
 */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

test("la portada lleva al depósito a Preparar en vez de dar 404", () => {
  const s = fuente("app/(app)/page.tsx");
  assert.match(s, /canVerPreparacion\(session\.role\)\) redirect\("\/preparar"\)/);
});

test("Preparar está en el menú lateral y en la barra del teléfono para quien tilda", () => {
  for (const archivo of ["components/Sidebar.tsx", "components/MobileNav.tsx"]) {
    const s = fuente(archivo);
    assert.match(s, /canPreparar\(/, `${archivo} no mira canPreparar`);
    assert.match(s, /"\/preparar"/, `${archivo} no tiene la entrada /preparar`);
  }
});

test("el depósito no pasa ninguna guarda de las acciones que escriben pedidos, stock, catálogo o usuarios", async () => {
  // La spec pide probarlo sobre el texto de las acciones, como order-actions.test.ts:
  // cada guarda que usan esos archivos tiene que dejar afuera al depósito.
  const permisos = (await import("../lib/permissions")) as unknown as Record<string, (r: string) => boolean>;
  for (const archivo of ["order.ts", "period.ts", "snapshot.ts", "stock.ts", "users.ts"]) {
    const s = fuente(`app/actions/${archivo}`);
    const guardas = [...new Set([...s.matchAll(/\b(can[A-Z]\w*)\(/g)].map((m) => m[1]))];
    assert.ok(guardas.length > 0, `${archivo} no usa ninguna guarda`);
    for (const g of guardas) assert.equal(permisos[g]("DEPOSITO"), false, `${archivo}: ${g} deja pasar al depósito`);
  }
  // El catálogo no usa una capacidad sino el rol exacto.
  assert.match(fuente("app/actions/products.ts"), /user\.role !== "ADMIN"/);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/permissions.test.ts tests/event-edit.test.ts tests/period-crud.test.ts tests/suggestions.test.ts tests/preparacion-guardas.test.ts`
Expected: FAIL. `canVerPreparacion` no existe, las matrices no cubren `DEPOSITO`, y faltan las guardas.

- [ ] **Step 3: `lib/permissions.ts`**

```ts
export const ROLES = ["ADMIN", "ARMADOR", "LOGISTICA", "DEPOSITO"] as const;
```

En `ROLE_LABEL`: `DEPOSITO: "Depósito",`. En `ROLE_HELP`: `DEPOSITO: "Prepara los pedidos en el teléfono",`.

Reemplazar el doc de `canVerStock` y agregar las dos capacidades nuevas debajo:

```ts
/** Ver las pantallas del stock: períodos, inventario, historial y el editor de
 *  pedidos.
 *
 *  Existe aparte de `canEditOrders` porque el encargado de logística MIRA todo
 *  eso aunque no arme pedidos. El depósito no: su pantalla es Preparar, que ya
 *  trae lo que necesita para juntar las cosas, sin el resto. */
export function canVerStock(role: string): boolean {
  return role === "ADMIN" || role === "ARMADOR" || role === "LOGISTICA";
}

/** Ver la preparación: los eventos que vienen, qué hay que juntar, qué cambió
 *  y qué falta en el período. Todos los roles que trabajan con pedidos. */
export function canVerPreparacion(role: string): boolean {
  return role === "ADMIN" || role === "ARMADOR" || role === "LOGISTICA" || role === "DEPOSITO";
}

/** Tildar lo que se preparó. Quien junta las cosas: el depósito, el encargado
 *  de logística y la administradora. Quien arma el pedido no: si tildara lo que
 *  pidió, el tilde dejaría de decir que algo está FÍSICAMENTE preparado. */
export function canPreparar(role: string): boolean {
  return role === "ADMIN" || role === "LOGISTICA" || role === "DEPOSITO";
}
```

Y la prioridad:

```ts
/** Quienes salen a conseguir o a juntar las cosas: el encargado de logística y
 *  el depósito. Su aviso va primero y con la prioridad más alta de Web Push. */
export function isPriorityRecipient(role: string): boolean {
  return role === "LOGISTICA" || role === "DEPOSITO";
}
```

- [ ] **Step 4: La portada lleva al depósito a Preparar**

En `app/(app)/page.tsx`, sumar `canVerPreparacion` al import de permisos y reemplazar `if (!canVerStock(session.role)) notFound();` por:

```ts
  if (!canVerStock(session.role)) {
    // El depósito no ve la portada del stock: su pantalla es Preparar. Sin esto,
    // al iniciar sesión caería en un "no encontrado".
    if (canVerPreparacion(session.role)) redirect("/preparar");
    notFound();
  }
```

- [ ] **Step 5: Entrada "Preparar" en la navegación**

`components/Sidebar.tsx`: sumar `canPreparar` al import de permisos. Después de `NAV_AVISOS`, agregar:

```tsx
/** Un portapapeles con un tilde: lo que se junta en el depósito. */
const NAV_PREPARAR = [
  {
    href: "/preparar",
    label: "Preparar",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="m9 13 2 2 4-4" />
      </svg>
    ),
  },
];
```

y en el armado de `nav`:

```tsx
    ...(canVerStock(user.role) ? NAV_STOCK : []),
    ...(canPreparar(user.role) ? NAV_PREPARAR : []),
    ...NAV_AVISOS,
```

`components/MobileNav.tsx`: sumar `canPreparar` al import. Arriba de `ITEMS`:

```tsx
const PREPARAR = {
  href: "/preparar",
  label: "Preparar",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="m9 13 2 2 4-4" />
    </svg>
  ),
};
```

y `items` queda:

```tsx
  const items = [
    ...(canVerStock(role) ? ITEMS.slice(0, 3) : []),
    ...(canPreparar(role) ? [PREPARAR] : []),
    ...ITEMS.slice(3),
  ];
```

Actualizar el comentario del cupo: "Con Preparar, a la administradora y a logística la cuenta les da siete: el sobrante va a la hoja de "Más". Al depósito le quedan cuatro: Preparar, Avisos, Cuenta y Sugerir."

- [ ] **Step 6: Correr las pruebas, el typecheck y la suite**

Run: el comando del Step 2, después `npx tsc --noEmit` y después `npm test`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add lib/permissions.ts components/Sidebar.tsx components/MobileNav.tsx "app/(app)/page.tsx" tests/permissions.test.ts tests/event-edit.test.ts tests/period-crud.test.ts tests/suggestions.test.ts tests/preparacion-guardas.test.ts
git commit -m "Deposito: el rol, lo que puede y su entrada al menu"
```

---

### Task 3: El estado de cada ítem (`lib/preparacion.ts`, puro)

**Files:**
- Create: `lib/preparacion.ts`
- Modify: `lib/aviso-texto.ts` (exportar `recortar`)
- Test: `tests/preparacion.test.ts`

**Interfaces:**
- Produces:
  - `type EstadoItem = "PENDIENTE" | "PREPARADO" | "CAMBIO" | "NOTA" | "SACAR"`
  - `type LineaPedido = { clave; itemName; unit; category; qty: number; note: string | null }`
  - `type Tildado = { clave; itemName; unit; category; qty: number; note: string | null; porName: string; at: Date }`
  - `type ItemPreparacion = { clave; itemName; unit; category; qty; note; tildado: { qty; note; porName; at } | null; estado: EstadoItem; accion: string | null }`
  - `claveDeLinea(l: { id: string; productId: string | null }): string`
  - `estadoDeItems(lineas: LineaPedido[], tildados: Tildado[]): ItemPreparacion[]`
  - `cambiosParaAplicar(items): ItemPreparacion[]`
  - `textoDeAccion(i: ItemPreparacion): string`
  - `avancePorSector(items): Map<string, { listos: number; total: number }>`
  - `clavesParaTildarSector(items, category: string): string[]`
  - `recortar` pasa a ser `export` en `lib/aviso-texto.ts` (sin cambiar su comportamiento).

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/preparacion.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avancePorSector,
  cambiosParaAplicar,
  claveDeLinea,
  clavesParaTildarSector,
  estadoDeItems,
  textoDeAccion,
  type LineaPedido,
  type Tildado,
} from "../lib/preparacion";

/**
 * El estado de cada ítem en el depósito, calculado: lo tildado (lo que había
 * al tildar) contra el pedido de ahora. Es la tabla de la spec, caso por caso.
 */

const L = (clave: string, qty: number, note: string | null = null, category = "ENSERES"): LineaPedido => ({
  clave, itemName: `Item ${clave}`, unit: "Unidad", category, qty, note,
});
const T = (clave: string, qty: number, note: string | null = null, category = "ENSERES"): Tildado => ({
  clave, itemName: `Item ${clave}`, unit: "Unidad", category, qty, note, porName: "Pablo", at: new Date("2026-10-20T12:00:00Z"),
});
const uno = (lineas: LineaPedido[], tildados: Tildado[]) => {
  const r = estadoDeItems(lineas, tildados);
  assert.equal(r.length, 1);
  return r[0];
};

test("sin tildar: pendiente, sin acción", () => {
  const i = uno([L("a", 10)], []);
  assert.equal(i.estado, "PENDIENTE");
  assert.equal(i.accion, null);
  assert.equal(i.tildado, null);
});

test("tildado con la misma cantidad y nota: preparado", () => {
  assert.equal(uno([L("a", 10, "largos")], [T("a", 10, "largos")]).estado, "PREPARADO");
});

test("nota vacía y nota nula son la misma nota", () => {
  assert.equal(uno([L("a", 10, "")], [T("a", 10, null)]).estado, "PREPARADO");
});

test("el pedido subió después de tildar: sumá la diferencia", () => {
  const i = uno([L("a", 24)], [T("a", 10)]);
  assert.equal(i.estado, "CAMBIO");
  assert.equal(i.accion, "Sumá 14");
  assert.equal(i.tildado?.qty, 10);
});

test("el pedido bajó después de tildar: sacá la diferencia", () => {
  const i = uno([L("a", 4)], [T("a", 10)]);
  assert.equal(i.estado, "CAMBIO");
  assert.equal(i.accion, "Sacá 6");
});

test("cambió la cantidad y también la nota: manda la cantidad", () => {
  assert.equal(uno([L("a", 12, "otra")], [T("a", 10, "una")]).estado, "CAMBIO");
});

test("misma cantidad, otra nota: cambió la nota", () => {
  const i = uno([L("a", 10, "los largos")], [T("a", 10, null)]);
  assert.equal(i.estado, "NOTA");
  assert.equal(i.accion, "Cambió la nota");
});

test("tildado y ya no está en el pedido: sacar", () => {
  const i = uno([], [T("a", 3)]);
  assert.equal(i.estado, "SACAR");
  assert.equal(i.qty, 0);
  assert.equal(i.accion, "Sacá 3 · ya no va");
  assert.equal(i.itemName, "Item a", "lo tildado tiene que poder leerse solo");
});

test("un renglón en cero no es un pedido", () => {
  assert.deepEqual(estadoDeItems([L("a", 0)], []), []);
});

test("la clave es el producto, o custom:<renglón> para los sueltos", () => {
  assert.equal(claveDeLinea({ id: "l1", productId: "p1" }), "p1");
  assert.equal(claveDeLinea({ id: "l1", productId: null }), "custom:l1");
});

test("cambios para aplicar: lo que cambió, la nota y lo que hay que sacar", () => {
  const items = estadoDeItems(
    [L("pend", 1), L("prep", 2), L("camb", 5), L("nota", 3, "x")],
    [T("prep", 2), T("camb", 2), T("nota", 3), T("sacar", 7)],
  );
  assert.deepEqual(cambiosParaAplicar(items).map((i) => i.clave).sort(), ["camb", "nota", "sacar"]);
});

test("el texto de cada acción, como lo lee el que prepara", () => {
  // Ordenados por clave: camb, nota, sacar.
  const [camb, nota, sacar] = estadoDeItems([L("camb", 24), L("nota", 3, "los largos")], [T("camb", 10), T("sacar", 3), T("nota", 3)]).sort((a, b) => a.clave.localeCompare(b.clave));
  assert.equal(textoDeAccion(camb), "Sumá 14 Item camb");
  assert.equal(textoDeAccion(nota), 'Item nota: nota "los largos"');
  // En el push, sacar un ítem entero o parte es la misma acción física: "Sacá 3 Braseros".
  assert.equal(textoDeAccion(sacar), "Sacá 3 Item sacar");
});

test("avance por sector: lo al día sobre lo que hay que mover, incluido lo que hay que sacar", () => {
  const items = estadoDeItems(
    [L("a", 1), L("b", 1), L("m", 1, null, "MOBILIARIO")],
    [T("a", 1), T("z", 2), T("m", 1, null, "MOBILIARIO")],
  );
  assert.deepEqual(avancePorSector(items).get("ENSERES"), { listos: 1, total: 3 });
  assert.deepEqual(avancePorSector(items).get("MOBILIARIO"), { listos: 1, total: 1 });
});

test("tildar un sector entero toma solo lo pendiente de ese sector", () => {
  const items = estadoDeItems(
    [L("p1", 1), L("p2", 2), L("camb", 5), L("otro", 1, null, "BEBIDA")],
    [T("camb", 2), T("sacar", 3)],
  );
  assert.deepEqual(clavesParaTildarSector(items, "ENSERES").sort(), ["p1", "p2"]);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/preparacion.test.ts`
Expected: FAIL con `Cannot find module '../lib/preparacion'`.

- [ ] **Step 3: Exportar `recortar`**

En `lib/aviso-texto.ts`, cambiar `function recortar(` por `export function recortar(`. No se cambia nada más.

- [ ] **Step 4: Escribir `lib/preparacion.ts`**

```ts
// La preparación de un pedido en el depósito, calculada. Sin base de datos.
//
// El depósito tilda en el teléfono lo que junta. Lo tildado guarda la cantidad
// y la nota que tenía el pedido EN ESE MOMENTO. Comparar eso con el pedido de
// ahora dice qué cambió después de preparar y qué hay que hacer físicamente.
// Nada de esto se guarda: se calcula cada vez, como los faltantes, para que no
// pueda quedar desactualizado.

import { recortar } from "@/lib/aviso-texto";

export type EstadoItem = "PENDIENTE" | "PREPARADO" | "CAMBIO" | "NOTA" | "SACAR";

/** Un renglón del pedido tal como está ahora. */
export type LineaPedido = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
};

/** Lo que el depósito tildó: copia del renglón en el momento de tildar. */
export type Tildado = LineaPedido & { porName: string; at: Date };

export type ItemPreparacion = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  /** Lo que pide el pedido ahora. 0 si ya no va. */
  qty: number;
  note: string | null;
  tildado: { qty: number; note: string | null; porName: string; at: Date } | null;
  estado: EstadoItem;
  /** Qué hay que hacer físicamente, si hay algo: "Sumá 14", "Sacá 6". */
  accion: string | null;
};

/** El ítem, no el renglón: si el renglón se borra, lo tildado sigue diciendo
 *  "sacá esto". Los sueltos no tienen producto: su renglón es el ítem. */
export function claveDeLinea(linea: { id: string; productId: string | null }): string {
  return linea.productId ?? `custom:${linea.id}`;
}

const mismaNota = (a: string | null, b: string | null) => (a ?? "").trim() === (b ?? "").trim();

/**
 * El estado de cada ítem: lo que pide el pedido, más lo tildado que ya no está.
 *
 * Si cambiaron la cantidad Y la nota, manda la cantidad: es lo que obliga a
 * mover cosas. La nota nueva se ve igual en la fila.
 */
export function estadoDeItems(lineas: LineaPedido[], tildados: Tildado[]): ItemPreparacion[] {
  const porClave = new Map(tildados.map((t) => [t.clave, t]));
  const enPedido = new Set<string>();
  const items: ItemPreparacion[] = [];

  for (const l of lineas) {
    if (l.qty <= 0) continue;
    enPedido.add(l.clave);
    const t = porClave.get(l.clave);
    const tildado = t ? { qty: t.qty, note: t.note, porName: t.porName, at: t.at } : null;
    let estado: EstadoItem = "PENDIENTE";
    let accion: string | null = null;
    if (t && t.qty !== l.qty) {
      estado = "CAMBIO";
      const dif = l.qty - t.qty;
      accion = dif > 0 ? `Sumá ${dif}` : `Sacá ${-dif}`;
    } else if (t && !mismaNota(t.note, l.note)) {
      estado = "NOTA";
      accion = "Cambió la nota";
    } else if (t) {
      estado = "PREPARADO";
    }
    items.push({ ...l, tildado, estado, accion });
  }

  // Lo tildado que ya no está en el pedido hay que sacarlo de lo preparado.
  for (const t of tildados) {
    if (enPedido.has(t.clave)) continue;
    items.push({
      clave: t.clave,
      itemName: t.itemName,
      unit: t.unit,
      category: t.category,
      qty: 0,
      note: null,
      tildado: { qty: t.qty, note: t.note, porName: t.porName, at: t.at },
      estado: "SACAR",
      accion: `Sacá ${t.qty} · ya no va`,
    });
  }
  return items;
}

const PARA_APLICAR: ReadonlySet<EstadoItem> = new Set(["CAMBIO", "NOTA", "SACAR"]);

/** Lo que cambió después de preparar y todavía nadie aplicó en lo físico. */
export function cambiosParaAplicar(items: ItemPreparacion[]): ItemPreparacion[] {
  return items.filter((i) => PARA_APLICAR.has(i.estado));
}

/** Una acción como la lee el que prepara en el push: "Sumá 14 Copas de agua",
 *  "Sacá 3 Braseros". Sacar parte de un ítem o el ítem entero es la misma
 *  acción física; la pantalla dice además "ya no va". */
export function textoDeAccion(i: ItemPreparacion): string {
  switch (i.estado) {
    case "CAMBIO":
      return `${i.accion} ${i.itemName}`;
    case "SACAR":
      return `Sacá ${i.tildado?.qty ?? 0} ${i.itemName}`;
    case "NOTA":
      return i.note ? `${i.itemName}: nota "${recortar(i.note, 40)}"` : `${i.itemName}: sin nota`;
    default:
      return i.itemName;
  }
}

/** Por sector: lo preparado y al día, sobre todo lo que hay que mover (lo que
 *  pide el pedido más lo que hay que sacar). */
export function avancePorSector(items: ItemPreparacion[]): Map<string, { listos: number; total: number }> {
  const out = new Map<string, { listos: number; total: number }>();
  for (const i of items) {
    const a = out.get(i.category) ?? { listos: 0, total: 0 };
    a.total++;
    if (i.estado === "PREPARADO") a.listos++;
    out.set(i.category, a);
  }
  return out;
}

/** "Tildar todo el sector" toma solo lo pendiente. Lo que cambió o hay que
 *  sacar implica mover algo físico y se confirma de a uno. */
export function clavesParaTildarSector(items: ItemPreparacion[], category: string): string[] {
  return items.filter((i) => i.category === category && i.estado === "PENDIENTE").map((i) => i.clave);
}
```

- [ ] **Step 5: Correr las pruebas, el typecheck y las de texto**

Run: `node --import tsx --test tests/preparacion.test.ts tests/aviso-texto.test.ts` y después `npx tsc --noEmit`
Expected: todo en verde; `aviso-texto` sin cambios de comportamiento.

- [ ] **Step 6: Commit**

```bash
git add lib/preparacion.ts lib/aviso-texto.ts tests/preparacion.test.ts
git commit -m "Deposito: el estado de cada item, calculado contra lo tildado"
```

---

### Task 4: Leer y tildar en la base (`lib/preparacion-db.ts`) y faltantes del período

**Files:**
- Create: `lib/preparacion-db.ts`
- Modify: `lib/shortages.ts` (agregar `periodShortages`)
- Test: `tests/preparacion-db.test.ts`

**Interfaces:**
- Consumes: `Preparacion` (Task 1), `lib/preparacion.ts` (Task 3).
- Produces:
  - `type Db = Pick<typeof prisma, "orderLine" | "preparacion">`: sirve con `prisma` o con el cliente de una transacción.
  - `lineasDelEvento(db: Db, eventId: string): Promise<LineaPedido[]>`
  - `estadoDelEvento(eventId: string, db?: Db): Promise<ItemPreparacion[]>`, ordenado por sector y nombre
  - `estaTildado(db: Db, eventId: string, clave: string): Promise<boolean>`
  - `hayTildados(db: Db, eventId: string): Promise<boolean>`
  - `tildar(eventId: string, clave: string, actor: { id: string; name: string }): Promise<"tildado" | "sacado" | "no-existe">`
  - `destildar(eventId: string, clave: string): Promise<boolean>`
  - `tildarSector(eventId: string, category: string, actor): Promise<number>`
  - `DIAS_A_PREPARAR = 14`
  - `eventosParaPreparar(hoyDia?: string): Promise<EventoParaPreparar[]>`, con `EventoParaPreparar = { id; lugar; date: Date; dia: string; avance: { category; label; listos; total }[]; cambiosParaAplicar: number }`
  - `periodShortages(periodId: string): Promise<ShortageRow[]>` en `lib/shortages.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/preparacion-db.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, hoy, sumarDias } from "../lib/dates";

/**
 * Tildar, destildar y leer la preparación contra una base de verdad.
 */

const base = crearBaseDescartable("preparacion-db");
let prisma: typeof import("../lib/db").prisma;
let db: typeof import("../lib/preparacion-db");
let shortages: typeof import("../lib/shortages");
const PABLO = { id: "u-pablo", name: "Pablo" };
let ids: { periodo: string; evento: string; copa: string; mesa: string; suelto: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  db = await import("../lib/preparacion-db");
  shortages = await import("../lib/shortages");
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: hoy(), endDay: sumarDias(hoy(), 2) } });
  const evento = await prisma.event.create({
    data: { periodId: periodo.id, lugar: "El Carmen", date: instanteDe(hoy(), "21:00"), guests: 100 },
  });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mesa = await prisma.product.create({ data: { name: "Mesa redonda", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 40 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 300, note: "las altas" } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: mesa.id, qty: 12 } });
  const suelto = await prisma.orderLine.create({
    data: { eventId: evento.id, customName: "Hielo", customCategory: "BEBIDA", customUnit: "Bolsa", qty: 20 },
  });
  ids = { periodo: periodo.id, evento: evento.id, copa: copa.id, mesa: mesa.id, suelto: `custom:${suelto.id}` };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const estadoDe = async (clave: string) => (await db.estadoDelEvento(ids.evento)).find((i) => i.clave === clave);

test("todo arranca pendiente, con nombre, unidad y sector del producto o del suelto", async () => {
  const items = await db.estadoDelEvento(ids.evento);
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.estado === "PENDIENTE"));
  const hielo = items.find((i) => i.clave === ids.suelto)!;
  assert.deepEqual([hielo.itemName, hielo.unit, hielo.category], ["Hielo", "Bolsa", "BEBIDA"]);
});

test("tildar copia lo que había en el pedido y lo deja preparado", async () => {
  assert.equal(await db.tildar(ids.evento, ids.copa, PABLO), "tildado");
  const fila = await prisma.preparacion.findUnique({ where: { eventId_clave: { eventId: ids.evento, clave: ids.copa } } });
  assert.deepEqual([fila?.qty, fila?.note, fila?.itemName, fila?.porName], [300, "las altas", "Copa de agua", "Pablo"]);
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  assert.equal(await db.estaTildado(prisma, ids.evento, ids.copa), true);
  assert.equal(await db.hayTildados(prisma, ids.evento), true);
});

test("si el pedido cambia después, el estado lo dice y volver a tildar lo pone al día", async () => {
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 314 } });
  const i = await estadoDe(ids.copa);
  assert.equal(i?.estado, "CAMBIO");
  assert.equal(i?.accion, "Sumá 14");
  await db.tildar(ids.evento, ids.copa, PABLO);
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
});

test("si el renglón se borra, lo tildado pide sacarlo; tildarlo de nuevo lo da por sacado", async () => {
  await db.tildar(ids.evento, ids.mesa, PABLO);
  await prisma.orderLine.deleteMany({ where: { eventId: ids.evento, productId: ids.mesa } });
  assert.equal((await estadoDe(ids.mesa))?.estado, "SACAR");
  assert.equal(await db.tildar(ids.evento, ids.mesa, PABLO), "sacado");
  assert.equal(await estadoDe(ids.mesa), undefined);
});

test("tildar algo que no está ni tildado ni en el pedido no hace nada", async () => {
  assert.equal(await db.tildar(ids.evento, "no-existe", PABLO), "no-existe");
});

test("destildar borra la fila: es para errores de quien tilda", async () => {
  assert.equal(await db.destildar(ids.evento, ids.copa), true);
  assert.equal((await estadoDe(ids.copa))?.estado, "PENDIENTE");
  assert.equal(await db.destildar(ids.evento, ids.copa), false);
});

test("tildar un sector toma solo lo pendiente de ese sector", async () => {
  await db.tildar(ids.evento, ids.suelto, PABLO);
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, customName: "Hielo" }, data: { qty: 25 } });
  assert.equal(await db.tildarSector(ids.evento, "BEBIDA", PABLO), 0, "el Hielo cambió: se confirma de a uno");
  assert.equal(await db.tildarSector(ids.evento, "ENSERES", PABLO), 1);
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  assert.equal((await estadoDe(ids.suelto))?.estado, "CAMBIO");
});

test("borrar el evento borra lo tildado", async () => {
  const otro = await prisma.event.create({ data: { periodId: ids.periodo, lugar: "Otro", date: instanteDe(hoy(), "20:00") } });
  await prisma.preparacion.create({
    data: { eventId: otro.id, clave: "x", itemName: "X", unit: "Unidad", category: "ENSERES", qty: 1, porName: "Pablo" },
  });
  await prisma.event.delete({ where: { id: otro.id } });
  assert.equal(await prisma.preparacion.count({ where: { eventId: otro.id } }), 0);
});

test("eventos para preparar: desde hoy hasta 14 días, vivos, con su avance y lo que hay que aplicar", async () => {
  const lejos = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Lejos", date: instanteDe(sumarDias(hoy(), 20), "21:00") },
  });
  const ayer = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Ayer", date: instanteDe(sumarDias(hoy(), -1), "21:00") },
  });
  const borrado = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Borrado", date: instanteDe(hoy(), "22:00"), deletedAt: new Date() },
  });
  const lista = await db.eventosParaPreparar();
  const lugares = lista.map((e) => e.lugar);
  assert.ok(lugares.includes("El Carmen"));
  for (const no of ["Lejos", "Ayer", "Borrado"]) assert.ok(!lugares.includes(no), `no tenía que aparecer ${no}`);
  const carmen = lista.find((e) => e.lugar === "El Carmen")!;
  assert.equal(carmen.cambiosParaAplicar, 1, "el Hielo que cambió");
  assert.deepEqual(carmen.avance.find((a) => a.category === "ENSERES"), { category: "ENSERES", label: "Enseres", listos: 1, total: 1 });
  await prisma.event.deleteMany({ where: { id: { in: [lejos.id, ayer.id, borrado.id] } } });
});

test("faltantes del período: lo pedido entre todos contra el stock", async () => {
  const filas = await shortages.periodShortages(ids.periodo);
  const copa = filas.find((f) => f.productId === ids.copa)!;
  assert.deepEqual([copa.totalRequested, copa.stock, copa.missing], [314, 250, 64]);
  assert.equal(filas.some((f) => f.productId === ids.mesa), false, "la mesa ya no está en el pedido");
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/preparacion-db.test.ts`
Expected: FAIL con `Cannot find module '../lib/preparacion-db'`.

- [ ] **Step 3: `periodShortages` en `lib/shortages.ts`**

Agregar al final:

```ts
/** Lo que falta en todo un período: lo pedido entre todos sus eventos contra
 *  el stock. Es lo que mira el depósito: no le importa qué evento "causó" el
 *  faltante, sino cuánto tiene que conseguir. */
export async function periodShortages(periodId: string): Promise<ShortageRow[]> {
  const { products, totalPorProducto } = await cargarPeriodo(periodId);
  const rows: ShortageRow[] = [];
  for (const p of products) {
    const requested = totalPorProducto.get(p.id) ?? 0;
    const row = computeShortage({ ...p, productId: p.id, requested, otherRequested: 0 });
    if (row) rows.push(row);
  }
  rows.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  return rows;
}
```

- [ ] **Step 4: Escribir `lib/preparacion-db.ts`**

```ts
import { prisma } from "@/lib/db";
import { diaDe, hoy, instanteDe, sumarDias } from "@/lib/dates";
import { nombreDeCategoria, ordenDeCategoria } from "@/lib/categories";
import {
  avancePorSector,
  cambiosParaAplicar,
  claveDeLinea,
  clavesParaTildarSector,
  estadoDeItems,
  type ItemPreparacion,
  type LineaPedido,
  type Tildado,
} from "@/lib/preparacion";

// La preparación contra la base: leer el pedido y lo tildado, tildar y
// destildar. El cálculo del estado vive en lib/preparacion.ts, que es puro.

/** `prisma` o el cliente de una transacción: lo que hace falta para leer. */
export type Db = Pick<typeof prisma, "orderLine" | "preparacion">;

/** Los eventos que el depósito tiene a la vista: de hoy a dos semanas. */
export const DIAS_A_PREPARAR = 14;

/** Los renglones del pedido de un evento, con nombre, unidad y sector. */
export async function lineasDelEvento(db: Db, eventId: string): Promise<LineaPedido[]> {
  const lineas = await db.orderLine.findMany({
    where: { eventId },
    include: { product: { select: { name: true, unit: true, category: true } } },
  });
  return lineas.map((l) => ({
    clave: claveDeLinea(l),
    itemName: l.product?.name ?? l.customName ?? "Ítem",
    unit: l.product?.unit ?? l.customUnit ?? "Unidad",
    category: l.product?.category ?? l.customCategory ?? "ENSERES",
    qty: l.qty,
    note: l.note,
  }));
}

async function tildadosDelEvento(db: Db, eventId: string): Promise<Tildado[]> {
  const filas = await db.preparacion.findMany({ where: { eventId } });
  return filas.map((f) => ({
    clave: f.clave,
    itemName: f.itemName,
    unit: f.unit,
    category: f.category,
    qty: f.qty,
    note: f.note,
    porName: f.porName,
    at: f.at,
  }));
}

function ordenar(items: ItemPreparacion[]): ItemPreparacion[] {
  return items.sort(
    (a, b) => ordenDeCategoria(a.category) - ordenDeCategoria(b.category) || a.itemName.localeCompare(b.itemName, "es"),
  );
}

/** El estado de cada ítem del evento, ordenado por sector y por nombre. */
export async function estadoDelEvento(eventId: string, db: Db = prisma): Promise<ItemPreparacion[]> {
  const [lineas, tildados] = await Promise.all([lineasDelEvento(db, eventId), tildadosDelEvento(db, eventId)]);
  return ordenar(estadoDeItems(lineas, tildados));
}

/** ¿Este ítem ya está tildado? Lo usa el pedido para saber si un cambio es tardío. */
export async function estaTildado(db: Db, eventId: string, clave: string): Promise<boolean> {
  return (await db.preparacion.count({ where: { eventId, clave } })) > 0;
}

/** ¿El evento tiene algo tildado? Para copiar o restaurar un pedido entero. */
export async function hayTildados(db: Db, eventId: string): Promise<boolean> {
  return (await db.preparacion.count({ where: { eventId } })) > 0;
}

/**
 * Tildar un ítem: copia lo que hay en el pedido ahora. Si el ítem ya no está en
 * el pedido (estado SACAR), tildarlo es confirmar que se sacó: la fila se borra
 * y no queda nada que recordar.
 */
export async function tildar(
  eventId: string,
  clave: string,
  actor: { id: string; name: string },
): Promise<"tildado" | "sacado" | "no-existe"> {
  return prisma.$transaction(async (tx) => {
    const linea = (await lineasDelEvento(tx, eventId)).find((l) => l.clave === clave && l.qty > 0);
    if (linea) {
      const datos = {
        itemName: linea.itemName,
        unit: linea.unit,
        category: linea.category,
        qty: linea.qty,
        note: linea.note,
        porId: actor.id,
        porName: actor.name,
        at: new Date(),
      };
      await tx.preparacion.upsert({
        where: { eventId_clave: { eventId, clave } },
        update: datos,
        create: { eventId, clave, ...datos },
      });
      return "tildado";
    }
    const borrado = await tx.preparacion.deleteMany({ where: { eventId, clave } });
    return borrado.count > 0 ? "sacado" : "no-existe";
  });
}

/** Destildar: para errores de quien tilda. Borra la fila. */
export async function destildar(eventId: string, clave: string): Promise<boolean> {
  return (await prisma.preparacion.deleteMany({ where: { eventId, clave } })).count > 0;
}

/** Tilda de una vez todo lo PENDIENTE de un sector. Devuelve cuántos tildó. */
export async function tildarSector(eventId: string, category: string, actor: { id: string; name: string }): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const lineas = await lineasDelEvento(tx, eventId);
    const items = estadoDeItems(lineas, await tildadosDelEvento(tx, eventId));
    const claves = new Set(clavesParaTildarSector(items, category));
    let n = 0;
    for (const l of lineas) {
      if (!claves.has(l.clave)) continue;
      await tx.preparacion.create({
        data: {
          eventId,
          clave: l.clave,
          itemName: l.itemName,
          unit: l.unit,
          category: l.category,
          qty: l.qty,
          note: l.note,
          porId: actor.id,
          porName: actor.name,
        },
      });
      n++;
    }
    return n;
  });
}

export type EventoParaPreparar = {
  id: string;
  lugar: string;
  date: Date;
  dia: string;
  avance: { category: string; label: string; listos: number; total: number }[];
  cambiosParaAplicar: number;
};

/** Los eventos vivos de hoy a `DIAS_A_PREPARAR` días, con su avance por sector
 *  y cuántos cambios hay para aplicar. */
export async function eventosParaPreparar(hoyDia: string = hoy()): Promise<EventoParaPreparar[]> {
  const eventos = await prisma.event.findMany({
    where: {
      deletedAt: null,
      period: { deletedAt: null },
      date: { gte: instanteDe(hoyDia, "00:00"), lt: instanteDe(sumarDias(hoyDia, DIAS_A_PREPARAR + 1), "00:00") },
    },
    orderBy: { date: "asc" },
    select: { id: true, lugar: true, date: true },
  });
  const out: EventoParaPreparar[] = [];
  for (const e of eventos) {
    const items = await estadoDelEvento(e.id);
    const avance = [...avancePorSector(items)]
      .sort(([a], [b]) => ordenDeCategoria(a) - ordenDeCategoria(b))
      .map(([category, a]) => ({ category, label: nombreDeCategoria(category), ...a }));
    out.push({ ...e, dia: diaDe(e.date), avance, cambiosParaAplicar: cambiosParaAplicar(items).length });
  }
  return out;
}
```

- [ ] **Step 5: Correr las pruebas, el typecheck y la suite**

Run: `node --import tsx --test tests/preparacion-db.test.ts`, después `npx tsc --noEmit` y después `npm test`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/preparacion-db.ts lib/shortages.ts tests/preparacion-db.test.ts
git commit -m "Deposito: tildar, destildar y leer la preparacion, y los faltantes del periodo"
```

---

### Task 5: Acciones del servidor para tildar

**Files:**
- Create: `app/actions/preparacion.ts`
- Modify: `tests/preparacion-guardas.test.ts`

**Interfaces:**
- Consumes: `tildar`, `destildar`, `tildarSector` (Task 4), `canPreparar` (Task 2).
- Produces: las server actions `tildarItem(eventId: string, clave: string)`, `destildarItem(eventId: string, clave: string)` y `tildarSectorEntero(eventId: string, category: string)`, que devuelven `Promise<PrepResult>` con `PrepResult = { ok: boolean; error?: string; count?: number }`.

- [ ] **Step 1: Escribir la prueba que falla**

Al final de `tests/preparacion-guardas.test.ts`:

```ts
test("ninguna acción de preparación escribe sin comprobar permiso y evento vivo antes", () => {
  const s = fuente("app/actions/preparacion.ts");
  const guarda = s.slice(s.indexOf("async function requerirPreparar"), s.indexOf("export async function"));
  assert.match(guarda, /canPreparar\(user\.role\)/);
  assert.match(guarda, /deletedAt: null, period: \{ deletedAt: null \}/);
  const cortes = [...s.matchAll(/^export async function (\w+)/gm)];
  assert.equal(cortes.length, 3);
  for (let i = 0; i < cortes.length; i++) {
    const cuerpo = s.slice(cortes[i].index!, i + 1 < cortes.length ? cortes[i + 1].index! : s.length);
    const permiso = cuerpo.indexOf("requerirPreparar(");
    const escritura = cuerpo.search(/\b(tildar|destildar|tildarSector)\(eventId/);
    assert.ok(permiso > -1 && escritura > permiso, `${cortes[i][1]} escribe sin comprobar antes`);
  }
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`
Expected: FAIL con `no se encontró app/actions/preparacion.ts`.

- [ ] **Step 3: Escribir `app/actions/preparacion.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canPreparar } from "@/lib/permissions";
import { esCategoria } from "@/lib/categories";
import { destildar, tildar, tildarSector } from "@/lib/preparacion-db";

export type PrepResult = { ok: boolean; error?: string; count?: number };

/** Tildar es escribir: lo decide el servidor, y solo sobre un evento vivo. */
async function requerirPreparar(eventId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tenés que iniciar sesión." };
  if (!canPreparar(user.role)) return { user: null, error: "No tenés permiso para tildar la preparación." };
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) {
    return { user: null, error: "Evento inválido." };
  }
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, period: { deletedAt: null } },
    select: { id: true },
  });
  if (!ev) return { user: null, error: "El evento ya no está disponible." };
  return { user, error: null };
}

function claveValida(clave: unknown): clave is string {
  return typeof clave === "string" && clave.length > 0 && clave.length <= 100;
}

function revalidar(eventId: string) {
  revalidatePath("/preparar");
  revalidatePath(`/preparar/${eventId}`);
}

/** Tilda un ítem como preparado con lo que pide ahora el pedido. Si ya no va,
 *  lo da por sacado. */
export async function tildarItem(eventId: string, clave: string): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!claveValida(clave)) return { ok: false, error: "Ítem inválido." };
  const r = await tildar(eventId, clave, user);
  if (r === "no-existe") return { ok: false, error: "Ese ítem ya no está en el pedido." };
  revalidar(eventId);
  return { ok: true };
}

/** Destilda un ítem: para cuando se tildó por error. */
export async function destildarItem(eventId: string, clave: string): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!claveValida(clave)) return { ok: false, error: "Ítem inválido." };
  await destildar(eventId, clave);
  revalidar(eventId);
  return { ok: true };
}

/** Tilda todo lo pendiente de un sector. */
export async function tildarSectorEntero(eventId: string, category: string): Promise<PrepResult> {
  const { user, error } = await requerirPreparar(eventId);
  if (!user) return { ok: false, error: error! };
  if (!esCategoria(category)) return { ok: false, error: "Sector inválido." };
  const count = await tildarSector(eventId, category, user);
  revalidar(eventId);
  return { ok: true, count };
}
```

- [ ] **Step 4: Correr las pruebas, el typecheck y el lint**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`, después `npx tsc --noEmit` y después `npx eslint app/actions/preparacion.ts`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add app/actions/preparacion.ts tests/preparacion-guardas.test.ts
git commit -m "Deposito: tildar y destildar desde el telefono, con permiso y evento vivo"
```

---

### Task 6: El cambio tardío — marcarlo y mandarlo a su propia tanda

**Files:**
- Modify: `lib/notify.ts` (`ChangeKind`, `OrderChangeInput`, `notifyOrderChange`, `cambiosDeLaTanda`)
- Modify: `lib/aviso-texto.ts` (`describirCambio`: caso `RESTAURADO`)
- Modify: `app/actions/order.ts` (`setLine`, `setCustomQty`, `deleteLine`, `copyOrderFromEvent`)
- Modify: `app/actions/snapshot.ts` (`discardPeriodChanges`, `restorePeriodVersion`)
- Test: `tests/notifications.test.ts`, `tests/preparacion-guardas.test.ts`

**Interfaces:**
- Consumes: `estaTildado`, `hayTildados` (Task 4), `claveDeLinea` (Task 3).
- Produces:
  - `OrderChangeInput` suma `tardio?: boolean`; `ChangeKind` suma `"RESTAURADO"`.
  - En `notifyOrderChange`, los cambios con `tardio` van a una tanda de tipo `"CAMBIO_TARDIO"`, con `linkUrl` `/preparar/<eventId>`. El resto sigue yendo a `"ORDER_EDIT"`.
  - `cambiosDeLaTanda` devuelve solo los cambios con `tardio: false`, que son los de `ORDER_EDIT`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `tests/notifications.test.ts`, antes de `"un evento que no existe no rompe el guardado del pedido"`:

```ts
const tandas = (recipientId: string, type: string) =>
  prisma.notification.findMany({ where: { recipientId, type }, orderBy: { createdAt: "desc" } });

test("un cambio tardío va a su propia tanda, que abre la pantalla de preparar", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, {
    itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true,
  });
  const [t] = await tandas(ids.logistica, "CAMBIO_TARDIO");
  assert.ok(t, "no abrió la tanda de cambio tardío");
  assert.equal(t.linkUrl, `/preparar/${ids.evento}`);
  assert.match(t.message, /ya preparado/);
  assert.equal((await tandas(ids.logistica, "ORDER_EDIT")).length, 0, "lo tardío no va además a la tanda común");
  const [c] = await prisma.orderChange.findMany({ where: { itemName: "Copa de agua" } });
  assert.equal(c.tardio, true);
});

test("un guardado con cambios tardíos y comunes abre una tanda de cada una", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, [
    { itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true },
    { itemName: "Servilletas", kind: "AGREGADO", before: null, after: "50" },
  ]);
  assert.equal((await tandas(ids.logistica, "CAMBIO_TARDIO"))[0]?.changeCount, 1);
  assert.equal((await tandas(ids.logistica, "ORDER_EDIT"))[0]?.changeCount, 1);
});

test("'Qué cambió' de la tanda común no muestra los cambios tardíos", async () => {
  const [comun] = await tandas(ids.logistica, "ORDER_EDIT");
  const cambios = await notify.cambiosDeLaTanda(comun);
  assert.deepEqual(cambios.map((c) => c.itemName), ["Servilletas"]);
});
```

En `tests/preparacion-guardas.test.ts`:

```ts
test("cada acción del pedido marca si el cambio es tardío antes de avisar", () => {
  const s = fuente("app/actions/order.ts");
  const cuerpo = (nombre: string) => {
    const desde = s.indexOf(`export async function ${nombre}`);
    const resto = s.slice(desde + 10);
    const hasta = resto.search(/^export async function /m);
    return s.slice(desde, hasta === -1 ? s.length : desde + 10 + hasta);
  };
  for (const [nombre, pregunta] of [
    ["setLine", "estaTildado("],
    ["setCustomQty", "estaTildado("],
    ["deleteLine", "estaTildado("],
    ["copyOrderFromEvent", "hayTildados("],
  ] as const) {
    const c = cuerpo(nombre);
    const marca = c.indexOf(pregunta);
    const aviso = c.indexOf("notifyOrderChange(");
    assert.ok(marca > -1 && aviso > marca, `${nombre} avisa sin saber si es tardío`);
    assert.match(c, /tardio/, `${nombre} no pasa la marca`);
  }
  const addCustom = cuerpo("addCustomLine");
  assert.doesNotMatch(addCustom, /tardio: true|estaTildado\(/, "un suelto nuevo nunca es tardío");
});

test("descartar y restaurar avisan como tardío a los eventos que tenían algo tildado", () => {
  const s = fuente("app/actions/snapshot.ts");
  assert.match(s, /preparaciones: \{ some: \{\} \}/);
  assert.match(s, /kind: "RESTAURADO"[\s\S]*tardio: true/);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/notifications.test.ts tests/preparacion-guardas.test.ts`
Expected: FAIL. No hay tanda `CAMBIO_TARDIO`, `tardio` no existe y las acciones no consultan lo tildado.

- [ ] **Step 3: `lib/notify.ts` — tipos, registro y tandas**

Sumar `| "RESTAURADO"` a `ChangeKind` (con el comentario `// Se descartaron los cambios o se restauró una versión: el pedido entero.`) y a `OrderChangeInput`:

```ts
  /** El ítem ya estaba tildado como preparado: el depósito tiene que rehacer algo. */
  tardio?: boolean;
```

En el `createMany` de `notifyOrderChange`, agregar `tardio: c.tardio ?? false,` a cada fila.

Reemplazar el bloque `for (const r of recipients) { ... }` por la separación y una función por tanda:

```ts
    // Lo tardío va a su propia tanda: es otro aviso (qué rehacer, con prioridad
    // para todos) y no se mezcla con los cambios comunes.
    const comunes = cambios.filter((c) => !c.tardio).length;
    const tardios = cambios.length - comunes;

    for (const r of recipients) {
      if (comunes > 0) await sumarATanda("ORDER_EDIT", r.id, actor, eventId, ev.lugar, comunes, ahora, batchCutoff);
      if (tardios > 0) await sumarATanda("CAMBIO_TARDIO", r.id, actor, eventId, ev.lugar, tardios, ahora, batchCutoff);
    }
```

Y el cuerpo de antes pasa a esta función, parametrizada por tipo. La lógica es **la misma de hoy, movida**: `updateMany` condicional, incremento atómico, relectura del contador y `create` si la tanda se cerró en el medio. Los comentarios largos también se mueven tal cual. Va debajo de `resumen`:

```ts
type TipoDeTanda = "ORDER_EDIT" | "CAMBIO_TARDIO";

function resumenDe(tipo: TipoDeTanda, actorName: string, lugar: string, n: number): string {
  if (tipo === "ORDER_EDIT") return resumen(actorName, lugar, n);
  return n === 1
    ? `${actorName} cambió un ítem ya preparado de ${lugar}`
    : `${actorName} cambió ${n} ítems ya preparados de ${lugar}`;
}

/** Suma `n` cambios a la tanda abierta de este destinatario y de este tipo, o
 *  abre una nueva. Las dos tandas (común y tardía) siguen la misma regla. */
async function sumarATanda(
  tipo: TipoDeTanda,
  recipientId: string,
  actor: { id: string; name: string },
  eventId: string,
  lugar: string,
  n: number,
  ahora: Date,
  batchCutoff: Date,
): Promise<void> {
  // Se busca un aviso de esta misma persona sobre este mismo pedido que
  // todavía no haya salido al celular. Si el push ya salió, este cambio
  // arranca una tanda nueva — si no, se colaría en un aviso ya avisado.
  const abierto = await prisma.notification.findFirst({
    where: {
      recipientId,
      type: tipo,
      eventId,
      actorName: actor.name,
      read: false,
      pushedAt: null,
      sinceAt: { gte: batchCutoff },
    },
    orderBy: { createdAt: "desc" },
  });

  if (abierto) {
    // (comentario de hoy: "Solo si sigue abierta. Entre la búsqueda...", movido tal cual)
    const sumado = await prisma.notification.updateMany({
      where: { id: abierto.id, pushedAt: null },
      // (comentario de hoy sobre `createdAt` que nunca retrocede y el contador
      // que se incrementa en la base, movido tal cual)
      data: {
        createdAt: abierto.createdAt > ahora ? abierto.createdAt : ahora,
        changeCount: { increment: n },
      },
    });
    if (sumado.count > 0) {
      // (comentario de hoy: "El mensaje dice el total que quedó en la base...", movido tal cual)
      const actual = await prisma.notification.findUnique({
        where: { id: abierto.id },
        select: { changeCount: true },
      });
      if (actual) {
        await prisma.notification.updateMany({
          where: { id: abierto.id, changeCount: actual.changeCount },
          data: { message: resumenDe(tipo, actor.name, lugar, actual.changeCount) },
        });
      }
      return;
    }
  }

  // No había tanda abierta, o se cerró justo antes de sumarle este cambio.
  await prisma.notification.create({
    data: {
      recipientId,
      actorName: actor.name,
      type: tipo,
      eventId,
      message: resumenDe(tipo, actor.name, lugar, n),
      changeCount: n,
      sinceAt: ahora,
      createdAt: ahora,
      // El aviso tardío abre Preparar, no "Qué cambió": lo que importa es qué
      // rehacer ahora, no la lista de lo que se tocó.
      linkUrl: tipo === "CAMBIO_TARDIO" ? `/preparar/${eventId}` : null,
    },
  });
}
```

Las líneas `(comentario de hoy: ...)` se reemplazan por esos comentarios, copiados tal cual del cuerpo actual de `notifyOrderChange`: no se pierden.

En `cambiosDeLaTanda`, sumar `tardio: false,` al `where`, con el comentario:

```ts
      // Los tardíos tienen su propia tanda y se leen en Preparar, no acá.
      tardio: false,
```

- [ ] **Step 4: `describirCambio` conoce `RESTAURADO`**

En `lib/aviso-texto.ts`, antes de `default:`:

```ts
    case "RESTAURADO":
      return c.after ?? "Se restauró el pedido";
```

- [ ] **Step 5: Las acciones del pedido marcan lo tardío**

En `app/actions/order.ts`, importar:

```ts
import { estaTildado, hayTildados } from "@/lib/preparacion-db";
import { claveDeLinea } from "@/lib/preparacion";
```

`setLine`: dentro de la transacción, después de leer `existing` y `producto`, y antes de armar `cambios`:

```ts
    // ¿El depósito ya lo tildó? Entonces este cambio obliga a rehacer algo
    // físico: va marcado, y avisa aparte y con prioridad.
    const tardio = await estaTildado(tx, input.eventId, input.productId);
```

y sumar `tardio` a cada `cambios.push({ ... })` del cuerpo (los tres casos: `QUITADO`, `CANTIDAD`/`NOTA` y `AGREGADO`).

En las otras tres, la escritura pasa a una transacción interactiva que también pregunta por lo tildado: así se decide con lo que había tildado **en el momento de escribir** (spec).

`setCustomQty`: sumar `productId: true` al `select` de `antes`, y reemplazar desde `const line = await prisma.orderLine.update(...)` hasta el final del `if` que avisa por:

```ts
  const { eventId, tardio } = await prisma.$transaction(async (tx) => {
    const line = await tx.orderLine.update({ where: { id: lineId }, data: { qty: q }, select: { eventId: true } });
    // ¿El depósito ya lo tildó? Se pregunta en la misma transacción que escribe.
    const tardio = await estaTildado(tx, line.eventId, claveDeLinea({ id: lineId, productId: antes.productId }));
    return { eventId: line.eventId, tardio };
  });
  if (antes.qty !== q) {
    await notifyOrderChange(user, eventId, {
      itemName: antes.customName ?? antes.product?.name ?? "Ítem",
      kind: "CANTIDAD",
      before: String(antes.qty),
      after: String(q),
      tardio,
    });
  }
```

`deleteLine`: sumar `productId: true` al `select` de `line`, y reemplazar `await prisma.orderLine.deleteMany({ where: { id: lineId } });` por:

```ts
  const tardio = await prisma.$transaction(async (tx) => {
    await tx.orderLine.deleteMany({ where: { id: lineId } });
    return estaTildado(tx, line.eventId, claveDeLinea({ id: lineId, productId: line.productId }));
  });
```

y sumar `tardio,` al cambio `QUITADO` que se avisa.

`copyOrderFromEvent`: reemplazar el `await prisma.$transaction([ ... ]);` que borra y recrea por:

```ts
  const tardio = await prisma.$transaction(async (tx) => {
    // Si algo de este pedido ya estaba preparado, copiar encima lo cambia todo.
    const tardio = await hayTildados(tx, targetEventId);
    await tx.orderLine.deleteMany({ where: { eventId: targetEventId } });
    await tx.orderLine.createMany({
      data: sourceLines.map((l) => ({
        eventId: targetEventId,
        productId: l.productId,
        customName: l.customName,
        customCategory: l.customCategory,
        customUnit: l.customUnit,
        qty: l.qty,
        note: l.note,
      })),
    });
    return tardio;
  });
```

y sumar `tardio,` al cambio `COPIADO`. (`saveRecoverableVersion` sigue antes, como exige `tests/order-actions.test.ts`.)

- [ ] **Step 6: Descartar y restaurar avisan a los eventos con algo tildado**

En `app/actions/snapshot.ts`, importar:

```ts
import { notifyOrderChange } from "@/lib/notify";
import { estadoDelEvento } from "@/lib/preparacion-db";
import { cambiosParaAplicar } from "@/lib/preparacion";
```

y agregar, arriba de `savePeriodSnapshot` (fuera de las `export async function`, para no partir sus cuerpos en `tests/order-actions.test.ts`):

```ts
/**
 * Descartar o restaurar reemplaza los pedidos de todo el período. A cada evento
 * que tenía algo tildado y quedó con algo para rehacer se le avisa como cambio
 * tardío: el depósito tiene que revisar lo que ya juntó.
 *
 * Acá no se decide "dentro de la transacción que escribe", como en las acciones
 * del pedido: `applySnapshotData` es una transacción en lote y no puede leer en
 * el medio. Se compara después contra lo tildado, que da lo mismo: lo que cuenta
 * es si quedó algo distinto de lo que se preparó. Un evento que la versión dejó
 * igual no recibe un aviso vacío.
 */
async function avisarATildados(periodId: string, actor: { id: string; name: string }, que: string) {
  const eventos = await prisma.event.findMany({
    where: { periodId, deletedAt: null, preparaciones: { some: {} } },
    select: { id: true },
  });
  for (const e of eventos) {
    if (cambiosParaAplicar(await estadoDelEvento(e.id)).length === 0) continue;
    await notifyOrderChange(actor, e.id, { itemName: "Todo el pedido", kind: "RESTAURADO", before: null, after: que, tardio: true });
  }
}
```

Llamarla después de `applySnapshotData`:
- en `discardPeriodChanges`: `await avisarATildados(periodId, user, "Se descartaron los cambios del pedido");`
- en `restorePeriodVersion`: `await avisarATildados(version.periodId, user, "Se restauró una versión anterior del pedido");`

- [ ] **Step 7: Correr las pruebas, el typecheck y la suite**

Run: `node --import tsx --test tests/notifications.test.ts tests/preparacion-guardas.test.ts tests/aviso-texto.test.ts`, después `npx tsc --noEmit` y después `npm test`
Expected: todo en verde, incluidas las pruebas de tandas que ya existían.

- [ ] **Step 8: Commit**

```bash
git add lib/notify.ts lib/aviso-texto.ts app/actions/order.ts app/actions/snapshot.ts tests/notifications.test.ts tests/preparacion-guardas.test.ts
git commit -m "Deposito: un cambio sobre algo ya preparado queda marcado y va a su propia tanda"
```

---

### Task 7: El aviso del cambio tardío — texto y envío

**Files:**
- Modify: `lib/aviso-texto.ts` (`textoTardio`, `textoSinPendientes`, tope compartido)
- Modify: `lib/notify.ts` (`flushPendingOrderPushes` toma también `CAMBIO_TARDIO`)
- Test: `tests/aviso-texto.test.ts`, `tests/notifications.test.ts`

**Interfaces:**
- Consumes: `estadoDelEvento` (Task 4), `cambiosParaAplicar` y `textoDeAccion` (Task 3), la tanda `CAMBIO_TARDIO` (Task 6).
- Produces:
  - `textoTardio(lugar: string, actorName: string, acciones: string[], esHoy: boolean): { title; body } | null`
  - `textoSinPendientes(lugar: string, actorName: string): { title; body }`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `tests/aviso-texto.test.ts`, sumar `textoTardio` y `textoSinPendientes` al import y agregar al final:

```ts
test("aviso tardío: título con el lugar, las acciones y quién", () => {
  const t = textoTardio("El Carmen", "Enrique", ["Sumá 14 Copas de agua", "Sacá 3 Braseros"], false);
  assert.deepEqual(t, {
    title: "⚠ Cambio en pedido ya preparado · El Carmen",
    body: "Sumá 14 Copas de agua · Sacá 3 Braseros\n— Enrique",
  });
});

test("aviso tardío de un evento de hoy: el título lo dice primero", () => {
  assert.match(textoTardio("El Carmen", "Enrique", ["Sumá 1 Copa"], true)!.title, /^HOY · ⚠ Cambio en pedido ya preparado/);
});

test("aviso tardío: tres acciones y cuántas más, sin pasar de 500", () => {
  const acciones = Array.from({ length: 6 }, (_, i) => `Sumá ${i} ${"x".repeat(200)}`);
  const t = textoTardio("X", "Enrique", acciones, false)!;
  assert.ok(t.body.length <= 500);
  assert.ok(t.body.endsWith(" · y 3 más\n— Enrique"));
});

test("sin acciones pendientes no hay aviso tardío", () => {
  assert.equal(textoTardio("X", "Enrique", [], false), null);
});

test("la corrección cuando ya no queda nada para aplicar", () => {
  assert.deepEqual(textoSinPendientes("El Carmen", "Enrique"), {
    title: "Pedido ya preparado · El Carmen",
    body: "Ya no hay cambios para aplicar\n— Enrique",
  });
});
```

En `tests/notifications.test.ts`, antes de `"un evento que no existe no rompe el guardado del pedido"`:

```ts
test("el aviso tardío dice qué rehacer, abre Preparar y sale con prioridad para todos", async () => {
  await limpiar();
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 500 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: copa.id, qty: 24 } });
  await prisma.preparacion.create({
    data: { eventId: ids.evento, clave: copa.id, itemName: "Copa de agua", unit: "Unidad", category: "ENSERES", qty: 10, porName: "Pablo" },
  });
  const antes = enviadosAlTelefono.length;
  await notify.notifyOrderChange(ACTOR(), ids.evento, {
    itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true,
  });
  await pasaronMinutos(3);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 2);
  const nuevos = enviadosAlTelefono.slice(antes);
  assert.equal(nuevos.length, 2);
  for (const p of nuevos) {
    assert.match(p.title, /⚠ Cambio en pedido ya preparado · El Carmen Center$/);
    assert.equal(p.body, "Sumá 14 Copa de agua\n— Ana");
    assert.equal(p.url, `/preparar/${ids.evento}`);
  }
  const entregas = await prisma.pushDelivery.findMany({ where: { kind: "CAMBIO_TARDIO" } });
  assert.ok(entregas.length > 0 && entregas.every((e) => e.urgency === "high"), "el tardío sale con prioridad alta para todos");
  await prisma.preparacion.deleteMany({});
  await prisma.orderLine.deleteMany({ where: { productId: copa.id } });
});

test("si el depósito ya lo aplicó antes de que salga el aviso, no suena", async () => {
  await limpiar();
  const vaso = await prisma.product.create({ data: { name: "Vaso", category: "ENSERES", type: "REUTILIZABLE", stock: 500 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: vaso.id, qty: 30 } });
  await prisma.preparacion.create({
    data: { eventId: ids.evento, clave: vaso.id, itemName: "Vaso", unit: "Unidad", category: "ENSERES", qty: 20, porName: "Pablo" },
  });
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vaso", kind: "CANTIDAD", before: "20", after: "30", tardio: true });
  // El depósito vuelve a tildar con la cantidad nueva: ya no queda nada para aplicar.
  await prisma.preparacion.updateMany({ where: { clave: vaso.id }, data: { qty: 30 } });
  await pasaronMinutos(3);
  const antes = enviadosAlTelefono.length;
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 0);
  assert.equal(enviadosAlTelefono.length, antes);
  await prisma.preparacion.deleteMany({});
  await prisma.orderLine.deleteMany({ where: { productId: vaso.id } });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/aviso-texto.test.ts tests/notifications.test.ts`
Expected: FAIL. `textoTardio` no existe y el barrido no toma `CAMBIO_TARDIO`.

- [ ] **Step 3: `lib/aviso-texto.ts` — tope compartido y textos nuevos**

Extraer el armado del cuerpo con tope de `textoDePush` a una función, y usarla en los dos casos:

```ts
/** Hasta tres partes, "y N más" y la firma, sin pasar de MAX_CUERPO. Se recorta
 *  solo el detalle: el "y N más" y la firma son lo último que se puede perder. */
function cuerpoConTope(partes: string[], actorName: string): string {
  const visibles = partes.slice(0, MAX_EN_EL_PUSH).join(" · ");
  const resto = partes.length > MAX_EN_EL_PUSH ? ` · y ${partes.length - MAX_EN_EL_PUSH} más` : "";
  const pie = pieDe(actorName);
  return recortar(visibles, MAX_CUERPO - pie.length - resto.length) + resto + pie;
}
```

`textoDePush` pasa a terminar en:

```ts
  return { title: lugar, body: cuerpoConTope(netos.map(describirCambio), actorName) };
```

(conservando su comentario de por qué se recorta solo el detalle). Y agregar:

```ts
/**
 * El aviso de un cambio sobre algo ya preparado: no qué se tocó, sino qué hay
 * que hacer en el depósito. `null` si no queda nada por aplicar (alguien ya lo
 * aplicó, o el cambio se deshizo). Si el evento es hoy, el título lo dice
 * primero: es el que más urge.
 */
export function textoTardio(
  lugar: string,
  actorName: string,
  acciones: string[],
  esHoy: boolean,
): { title: string; body: string } | null {
  if (acciones.length === 0) return null;
  return {
    title: `${esHoy ? "HOY · " : ""}⚠ Cambio en pedido ya preparado · ${lugar}`,
    body: cuerpoConTope(acciones, actorName),
  };
}

/** Corrige un aviso tardío ya mandado cuando ya no queda nada por aplicar. Va
 *  con el mismo `tag` para reemplazarlo en la pantalla del teléfono. */
export function textoSinPendientes(lugar: string, actorName: string): { title: string; body: string } {
  return { title: `Pedido ya preparado · ${lugar}`, body: `Ya no hay cambios para aplicar${pieDe(actorName)}` };
}
```

- [ ] **Step 4: El barrido toma también `CAMBIO_TARDIO`**

En `lib/notify.ts`:

```ts
import { textoDeLoDeshecho, textoDePush, textoSinPendientes, textoTardio } from "@/lib/aviso-texto";
import { estadoDelEvento } from "@/lib/preparacion-db";
import { cambiosParaAplicar, textoDeAccion } from "@/lib/preparacion";
import { diaDe, hoy } from "@/lib/dates";
```

- El `findMany` de pendientes pasa a `type: { in: ["ORDER_EDIT", "CAMBIO_TARDIO"] }`.
- Justo antes de `let texto: ReturnType<typeof textoDePush>;`, declarar `const tardio = n.type === "CAMBIO_TARDIO";`: se usa adentro del `try` del texto y después, en el envío.
- El cuerpo del `try` que arma el texto pasa a ser:

```ts
          const ev = n.eventId
            ? await prisma.event.findUnique({ where: { id: n.eventId }, select: { lugar: true, date: true } })
            : null;
          const lugar = ev?.lugar ?? "Pedido";
          if (tardio) {
            // El texto no sale de los cambios sino de lo que hay que hacer AHORA:
            // si el depósito ya lo aplicó, o el cambio se deshizo, no queda nada.
            const acciones = n.eventId ? cambiosParaAplicar(await estadoDelEvento(n.eventId)).map(textoDeAccion) : [];
            texto = textoTardio(lugar, n.actorName, acciones, ev ? diaDe(ev.date) === hoy() : false);
          } else {
            texto = textoDePush(lugar, n.actorName, await cambiosDeLaTanda(n));
          }
          if (!texto) {
            const yaLlego = await prisma.pushDelivery.findFirst({
              where: { notificationId: n.id, status: "ACEPTADO" },
              select: { id: true },
            });
            if (yaLlego) texto = tardio ? textoSinPendientes(lugar, n.actorName) : textoDeLoDeshecho(lugar, n.actorName);
          }
```

  Conservar los comentarios existentes sobre la corrección.

- El envío pasa a:

```ts
            const r = await sendPushToUser(
              n.recipientId,
              {
                title: texto.title,
                body: texto.body,
                url: tardio ? `/preparar/${n.eventId}` : `/aviso/${n.id}`,
                tag: `${tardio ? "tardio" : "order"}-${n.eventId ?? n.id}`,
              },
              { kind: tardio ? "CAMBIO_TARDIO" : "ORDER_EDIT", notificationId: n.id },
              // Lo tardío sale con prioridad para todos: obliga a rehacer algo físico.
              { urgency: tardio || isPriorityRecipient(n.role) ? "high" : "normal" }
            );
```

- Actualizar el comentario de arriba de `flushPendingOrderPushes`: ahora manda los dos tipos de tanda.

- [ ] **Step 5: Correr las pruebas, el typecheck y la suite**

Run: `node --import tsx --test tests/aviso-texto.test.ts tests/notifications.test.ts`, después `npx tsc --noEmit` y después `npm test`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/aviso-texto.ts lib/notify.ts tests/aviso-texto.test.ts tests/notifications.test.ts
git commit -m "Deposito: el aviso de cambio tardio dice que rehacer, con prioridad para todos"
```

---

### Task 8: Las pantallas de preparar

**Files:**
- Create: `app/(app)/preparar/page.tsx`, `app/(app)/preparar/[eventId]/page.tsx`, `components/Preparar.tsx`
- Modify: `app/globals.css` (reglas al final), `app/(app)/aviso/[id]/page.tsx` (botón para el depósito)
- Test: `tests/preparacion-guardas.test.ts`

**Interfaces:**
- Consumes: `eventosParaPreparar`, `estadoDelEvento` (Task 4); `periodShortages` (Task 4); `tildarItem`, `destildarItem`, `tildarSectorEntero` (Task 5); `canVerPreparacion`, `canPreparar` (Task 2); `intentar` (`lib/actualizacion.ts`).

- [ ] **Step 1: Escribir la prueba que falla**

Al final de `tests/preparacion-guardas.test.ts`:

```ts
test("las pantallas de preparar comprueban su permiso; tildar se ofrece solo a quien puede", () => {
  for (const archivo of ["app/(app)/preparar/page.tsx", "app/(app)/preparar/[eventId]/page.tsx"]) {
    assert.match(fuente(archivo), /canVerPreparacion\(sesion\.role\)\) notFound\(\)/, archivo);
  }
  assert.match(fuente("app/(app)/preparar/[eventId]/page.tsx"), /puedeTildar: canPreparar\(sesion\.role\)/);
  assert.match(fuente("components/Preparar.tsx"), /if \(!data\.puedeTildar/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`
Expected: FAIL con `no se encontró app/(app)/preparar/page.tsx`.

- [ ] **Step 3: `app/(app)/preparar/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canVerPreparacion } from "@/lib/permissions";
import { eventosParaPreparar, DIAS_A_PREPARAR } from "@/lib/preparacion-db";
import { fmtEvento, hoy, sumarDias } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function PrepararPage() {
  // Como el resto: la pantalla comprueba su propio permiso.
  const sesion = await getSessionUser();
  if (!sesion || !canVerPreparacion(sesion.role)) notFound();

  const eventos = await eventosParaPreparar();
  const hoyDia = hoy();
  const manana = sumarDias(hoyDia, 1);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Preparar</h1>
          <div className="sub">Los eventos de los próximos {DIAS_A_PREPARAR} días</div>
        </div>
      </div>
      <div className="content">
        {eventos.length === 0 ? (
          <div className="empty-card">
            <p className="empty-title">No hay eventos para preparar</p>
            <p>Cuando se cargue un evento de los próximos {DIAS_A_PREPARAR} días, aparece acá.</p>
          </div>
        ) : (
          <div className="prep-lista">
            {eventos.map((e) => (
              <Link key={e.id} href={`/preparar/${e.id}`} className="prep-card">
                <div className="prep-card-top">
                  <b>{e.lugar}</b>
                  {e.dia === hoyDia && <span className="prep-dia hoy">HOY</span>}
                  {e.dia === manana && <span className="prep-dia">MAÑANA</span>}
                </div>
                <div className="prep-card-cuando">{fmtEvento(e.date)}</div>
                {e.cambiosParaAplicar > 0 && (
                  <div className="prep-alerta">
                    {e.cambiosParaAplicar} {e.cambiosParaAplicar === 1 ? "cambio para aplicar" : "cambios para aplicar"}
                  </div>
                )}
                <div className="prep-avance">
                  {e.avance.length === 0 ? (
                    <span className="prep-chip">Sin pedido todavía</span>
                  ) : (
                    e.avance.map((a) => (
                      <span key={a.category} className={`prep-chip${a.listos === a.total ? " ok" : ""}`}>
                        {a.label} {a.listos}/{a.total}
                      </span>
                    ))
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: `app/(app)/preparar/[eventId]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canPreparar, canVerPreparacion } from "@/lib/permissions";
import { estadoDelEvento } from "@/lib/preparacion-db";
import { periodShortages } from "@/lib/shortages";
import { diaDe, fmtEvento, fmtMomento, hoy } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";
import { Preparar } from "@/components/Preparar";

export const dynamic = "force-dynamic";

export default async function PrepararEventoPage({ params }: { params: Promise<{ eventId: string }> }) {
  const sesion = await getSessionUser();
  if (!sesion || !canVerPreparacion(sesion.role)) notFound();

  const { eventId } = await params;
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, period: { deletedAt: null } },
    select: { id: true, lugar: true, date: true, periodId: true, period: { select: { label: true, startDay: true, endDay: true } } },
  });
  if (!ev) notFound();

  const [items, faltantes] = await Promise.all([estadoDelEvento(ev.id), periodShortages(ev.periodId)]);

  return (
    <Preparar
      data={{
        evento: {
          id: ev.id,
          lugar: ev.lugar,
          cuando: fmtEvento(ev.date),
          esHoy: diaDe(ev.date) === hoy(),
          periodo: nombreDe(ev.period),
        },
        items: items.map((i) => ({
          clave: i.clave,
          itemName: i.itemName,
          unit: i.unit,
          category: i.category,
          qty: i.qty,
          note: i.note,
          estado: i.estado,
          accion: i.accion,
          tildadoQty: i.tildado?.qty ?? null,
          tildadoNota: i.tildado?.note ?? null,
          tildadoPor: i.tildado ? `${i.tildado.porName} · ${fmtMomento(i.tildado.at)}` : null,
        })),
        faltantes: faltantes.map((f) => ({ id: f.productId, name: f.name, unit: f.unit, pedido: f.totalRequested, hay: f.stock, faltan: f.missing })),
        puedeTildar: canPreparar(sesion.role),
      }}
    />
  );
}
```

- [ ] **Step 5: `components/Preparar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { destildarItem, tildarItem, tildarSectorEntero } from "@/app/actions/preparacion";
import { intentar } from "@/lib/actualizacion";
import { CATEGORIES, nombreDeCategoria } from "@/lib/categories";

type Estado = "PENDIENTE" | "PREPARADO" | "CAMBIO" | "NOTA" | "SACAR";
type Item = {
  clave: string;
  itemName: string;
  unit: string;
  category: string;
  qty: number;
  note: string | null;
  estado: Estado;
  accion: string | null;
  tildadoQty: number | null;
  tildadoNota: string | null;
  tildadoPor: string | null;
};
type Data = {
  evento: { id: string; lugar: string; cuando: string; esHoy: boolean; periodo: string };
  items: Item[];
  faltantes: { id: string; name: string; unit: string; pedido: number; hay: number; faltan: number }[];
  puedeTildar: boolean;
};

const PARA_APLICAR: Estado[] = ["CAMBIO", "NOTA", "SACAR"];
const unidad = (u: string) => (u === "Unidad" ? "" : ` ${u.toLowerCase()}`);

/**
 * La preparación de un evento, para el teléfono del depósito.
 *
 * Reemplaza al papel: arriba lo que cambió después de preparar (lo único que
 * obliga a moverse), después cada sector con su avance, y al final lo que falta
 * en el período. Toda la fila se toca para tildar; la nota se ve siempre.
 */
export function Preparar({ data }: { data: Data }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectorAConfirmar, setSectorAConfirmar] = useState<string | null>(null);

  // Se actualiza sola: quien prepara con la pantalla abierta tiene que ver
  // llegar un cambio sin recargar. Cada 45 s y al volver a la app.
  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refrescar, 45_000);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router]);

  async function alternar(i: Item) {
    if (!data.puedeTildar || ocupado) return;
    setOcupado(i.clave);
    setError(null);
    // Tocar algo preparado lo destilda (errores de quien tilda). Tocar algo
    // pendiente, que cambió o hay que sacar, lo da por hecho con el pedido de ahora.
    const r = await intentar(() =>
      i.estado === "PREPARADO" ? destildarItem(data.evento.id, i.clave) : tildarItem(data.evento.id, i.clave),
    );
    setOcupado(null);
    if (!r.ok) setError(r.error ?? "No se pudo guardar.");
  }

  async function tildarSector(category: string) {
    setSectorAConfirmar(null);
    setOcupado(`sector:${category}`);
    setError(null);
    const r = await intentar(() => tildarSectorEntero(data.evento.id, category));
    setOcupado(null);
    if (!r.ok) setError(r.error ?? "No se pudo guardar.");
  }

  const paraAplicar = data.items.filter((i) => PARA_APLICAR.includes(i.estado));
  const sectores = CATEGORIES.map((c) => ({ category: c, items: data.items.filter((i) => i.category === c) })).filter(
    (s) => s.items.length > 0,
  );

  return (
    <>
      <div className="prep-cabecera">
        <Link href="/preparar" className="prep-volver" aria-label="Volver a Preparar">←</Link>
        {/* Una sola línea: en el teléfono la cabecera fija no puede comerse la pantalla. */}
        <div className="prep-titulo">
          <b>{data.evento.lugar}</b> · {data.evento.esHoy ? <span className="prep-hoy">HOY</span> : null} {data.evento.cuando}
        </div>
        {data.faltantes.length > 0 && (
          <a href="#faltantes" className="prep-faltan">Faltan {data.faltantes.length}</a>
        )}
      </div>

      <div className="content prep-contenido">
        {error && <div className="form-error">{error}</div>}

        {paraAplicar.length > 0 && (
          <section className="prep-seccion prep-aplicar">
            <h2>Cambios para aplicar <span className="count-pill">{paraAplicar.length}</span></h2>
            {paraAplicar.map((i) => (
              <Fila key={i.clave} item={i} puedeTildar={data.puedeTildar} ocupado={ocupado === i.clave} alTocar={() => alternar(i)} />
            ))}
          </section>
        )}

        {sectores.map(({ category, items }) => {
          // El avance cuenta todo (spec: preparados / pedidos + a sacar), pero lo
          // que está arriba en "Cambios para aplicar" no se repite acá: dos filas
          // del mismo ítem hacen dudar de si se tildó dos veces.
          const total = items.length;
          const listos = items.filter((i) => i.estado === "PREPARADO").length;
          const pendientes = items.filter((i) => i.estado === "PENDIENTE").length;
          const filas = items.filter((i) => !PARA_APLICAR.includes(i.estado));
          return (
            <section key={category} className="prep-seccion">
              <h2>
                {nombreDeCategoria(category)} <span className={`count-pill${listos === total ? " ok" : ""}`}>{listos}/{total}</span>
                {data.puedeTildar && pendientes > 0 && (
                  <button className="btn ghost prep-sector-btn" onClick={() => setSectorAConfirmar(category)} disabled={!!ocupado}>
                    Tildar todo
                  </button>
                )}
              </h2>
              {filas.map((i) => (
                <Fila key={i.clave} item={i} puedeTildar={data.puedeTildar} ocupado={ocupado === i.clave} alTocar={() => alternar(i)} />
              ))}
              {filas.length === 0 && <p className="prep-nada">Lo de este sector está arriba, en "Cambios para aplicar".</p>}
            </section>
          );
        })}

        {data.items.length === 0 && (
          <div className="empty-card">
            <p className="empty-title">Este evento todavía no tiene pedido</p>
          </div>
        )}

        <section id="faltantes" className="prep-seccion">
          <h2>Faltantes del período · {data.evento.periodo}</h2>
          {data.faltantes.length === 0 ? (
            <p className="prep-nada">Todo alcanza en este período.</p>
          ) : (
            <ul className="prep-faltantes">
              {data.faltantes.map((f) => (
                <li key={f.id}>
                  <b>{f.name}</b> · piden {f.pedido}{unidad(f.unit)} · hay {f.hay} · <span className="prep-falta">faltan {f.faltan}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sectorAConfirmar && (
        <div className="overlay" onClick={() => setSectorAConfirmar(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>¿Tildar todo {nombreDeCategoria(sectorAConfirmar)}?</h2>
            <div className="msub">
              Se tilda solo lo pendiente. Lo que cambió o hay que sacar se confirma de a uno, porque hay que mover algo.
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setSectorAConfirmar(null)}>Cancelar</button>
              <button className="btn primary" onClick={() => tildarSector(sectorAConfirmar)}>Tildar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Fila({ item: i, puedeTildar, ocupado, alTocar }: { item: Item; puedeTildar: boolean; ocupado: boolean; alTocar: () => void }) {
  const hecho = i.estado === "PREPARADO";
  const cantidad = i.estado === "SACAR" ? 0 : i.qty;
  return (
    <button
      type="button"
      className={`prep-fila estado-${i.estado.toLowerCase()}${ocupado ? " ocupada" : ""}`}
      onClick={alTocar}
      disabled={!puedeTildar || ocupado}
      role="checkbox"
      aria-checked={hecho}
    >
      <span className="prep-check" aria-hidden="true">{hecho ? "✓" : ""}</span>
      <span className="prep-item">
        <span className="prep-nombre">{i.itemName}</span>
        {i.accion && (
          <span className="prep-accion">
            {/* Como en la spec: "Antes 10 → ahora 24 · Sumá 14". */}
            {i.estado === "CAMBIO" && i.tildadoQty !== null ? `Antes ${i.tildadoQty} → ahora ${i.qty} · ` : ""}
            {i.accion}
          </span>
        )}
        {i.note && <span className="prep-nota">✎ {i.note}</span>}
        {i.estado === "NOTA" && i.tildadoNota && <span className="prep-nota vieja">antes: {i.tildadoNota}</span>}
        {i.tildadoPor && hecho && <span className="prep-por">{i.tildadoPor}</span>}
      </span>
      <span className="prep-cantidad">
        {cantidad}
        <small>{unidad(i.unit)}</small>
      </span>
    </button>
  );
}
```

- [ ] **Step 6: Estilos al final de `app/globals.css`**

```css
/* Preparar: pensado para el teléfono del depósito. Filas grandes para tocar
   con una mano, la cantidad bien visible y la nota siempre a la vista. */
.prep-lista{display:flex; flex-direction:column; gap:var(--sp-3)}
.prep-card{display:block; background:var(--surface); border:1px solid var(--hair); border-radius:var(--radius); box-shadow:var(--shadow); padding:var(--sp-4); color:var(--ink); text-decoration:none}
.prep-card-top{display:flex; align-items:center; gap:var(--sp-2); font-size:var(--t-lg)}
.prep-card-cuando{color:var(--muted); font-size:var(--t-sm); margin-top:2px}
.prep-dia{font-size:var(--t-xs); font-weight:700; padding:2px var(--sp-2); border-radius:var(--r-pill); background:var(--surface-2); border:1px solid var(--hair)}
.prep-dia.hoy{background:var(--crit); color:#fff; border-color:var(--crit)}
.prep-alerta{margin-top:var(--sp-2); color:var(--warn); font-weight:700}
.prep-avance{display:flex; flex-wrap:wrap; gap:var(--sp-2); margin-top:var(--sp-3)}
.prep-chip{font-size:var(--t-sm); padding:2px var(--sp-2); border-radius:var(--r-pill); background:var(--surface-2); border:1px solid var(--hair)}
.prep-chip.ok{color:var(--ok); border-color:var(--ok)}
.prep-cabecera{position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:var(--sp-3); padding:var(--sp-2) var(--sp-4); background:var(--ground); border-bottom:1px solid var(--hair)}
.prep-volver{font-size:var(--t-xl); text-decoration:none; color:var(--ink); min-width:var(--tap); min-height:var(--tap); display:flex; align-items:center; justify-content:center}
.prep-titulo{flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--muted); font-size:var(--t-sm)}
.prep-titulo b{color:var(--ink); font-size:var(--t-md)}
.prep-hoy{color:var(--crit); font-weight:800}
.prep-faltan{color:var(--crit); font-weight:700; text-decoration:none; white-space:nowrap}
.prep-contenido{display:flex; flex-direction:column; gap:var(--sp-5)}
.prep-seccion h2{display:flex; align-items:center; gap:var(--sp-2); font-size:var(--t-lg); margin:0 0 var(--sp-2)}
.prep-sector-btn{margin-left:auto}
.count-pill.ok{color:var(--ok); border-color:var(--ok)}
.prep-aplicar{background:var(--surface); border:2px solid var(--warn); border-radius:var(--radius); padding:var(--sp-3)}
.prep-fila{display:flex; align-items:center; gap:var(--sp-3); width:100%; min-height:56px; padding:var(--sp-3); background:var(--surface); border:1px solid var(--hair); border-radius:var(--radius); margin-bottom:var(--sp-2); text-align:left; color:var(--ink); font:inherit; cursor:pointer}
.prep-fila:disabled{cursor:default; opacity:1}
.prep-fila.ocupada{opacity:.6}
.prep-check{flex:0 0 auto; width:44px; height:44px; border:2px solid var(--muted); border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:var(--t-xl)}
.prep-fila.estado-preparado .prep-check{background:var(--ok); border-color:var(--ok); color:#fff}
.prep-fila.estado-cambio, .prep-fila.estado-nota, .prep-fila.estado-sacar{border-color:var(--warn)}
.prep-item{flex:1; min-width:0; display:flex; flex-direction:column; gap:2px}
.prep-nombre{font-weight:600}
.prep-accion{color:var(--warn); font-weight:700}
.prep-nota{font-size:var(--t-sm); color:var(--ink)}
.prep-nota.vieja{color:var(--muted); text-decoration:line-through}
.prep-fila.estado-nota .prep-nota:not(.vieja){background:var(--warn-soft); border-radius:var(--r-sm); padding:0 var(--sp-1)}
.prep-por{font-size:var(--t-xs); color:var(--muted)}
.prep-cantidad{flex:0 0 auto; font-size:var(--t-2xl); font-weight:700; text-align:right}
.prep-cantidad small{font-size:var(--t-sm); font-weight:400; color:var(--muted)}
.prep-fila.estado-sacar .prep-cantidad{color:var(--crit)}
.prep-faltantes{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--sp-2); font-size:var(--t-sm)}
.prep-falta{color:var(--crit); font-weight:700}
.prep-nada{color:var(--muted); margin:0}
```

Todas las variables de arriba existen en `globals.css` (verificado el 19/10: `--ground` es el fondo; no hay `--bg`).

- [ ] **Step 6b: "Qué cambió" lleva al depósito a Preparar, no al editor**

El push común (`ORDER_EDIT`) también le llega al depósito y abre `/aviso/<id>`. Su botón "Abrir el pedido" va a `/evento/<id>`, que al depósito le da 404. En `app/(app)/aviso/[id]/page.tsx`, importar `canVerStock` de `@/lib/permissions` y cambiar ese `Link` por:

```tsx
        {aviso.eventId && !evento?.deletedAt && (
          // Quien no ve el editor (el depósito) va a la preparación del evento.
          canVerStock(user.role)
            ? <Link className="btn primary" href={`/evento/${aviso.eventId}`}>Abrir el pedido</Link>
            : <Link className="btn primary" href={`/preparar/${aviso.eventId}`}>Ver en Preparar</Link>
        )}
```

Y sumar a la prueba de este Step 1, en `tests/preparacion-guardas.test.ts`:

```ts
test("'Qué cambió' manda a Preparar a quien no ve el editor", () => {
  assert.match(fuente("app/(app)/aviso/[id]/page.tsx"), /canVerStock\(user\.role\)[\s\S]*\/preparar\//);
});
```

- [ ] **Step 7: Correr la prueba, el typecheck, el lint y la compilación**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`, después `npx tsc --noEmit`, después `npx eslint` y después `npm run build`
Expected: todo en verde, con `/preparar` y `/preparar/[eventId]` en la lista de rutas.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/preparar" "app/(app)/aviso/[id]/page.tsx" components/Preparar.tsx app/globals.css tests/preparacion-guardas.test.ts
git commit -m "Deposito: las pantallas de preparar, para el telefono"
```

---

### Task 9: Advertencia antes de cambiar algo ya preparado

**Files:**
- Modify: `app/(app)/evento/[id]/page.tsx`, `components/OrderBuilder.tsx`
- Modify: `app/(app)/page.tsx`, `components/PeriodHub.tsx` (confirmación de descartar)
- Test: `tests/preparacion-guardas.test.ts`

**Interfaces:**
- Consumes: la tabla `Preparacion` (Task 1).
- Produces:
  - `Data.preparados: Record<string, number>` en `OrderBuilder`, de clave a cantidad tildada.
  - `selected.preparados: number` en los datos de `PeriodHub`.

- [ ] **Step 1: Escribir la prueba que falla**

Al final de `tests/preparacion-guardas.test.ts`:

```ts
test("el editor pide confirmación antes de cambiar algo ya preparado, en la fila", () => {
  const s = fuente("components/OrderBuilder.tsx");
  const update = s.slice(s.indexOf("function updateItem"), s.indexOf("function stepQty"));
  assert.match(update, /conConfirmacion\(/, "updateItem cambia sin preguntar");
  assert.match(s, /Ya está preparado/);
  assert.match(s, /Cambiar igual/);
  assert.match(fuente("app/(app)/evento/[id]/page.tsx"), /preparacion\.findMany/);
});

test("copiar y descartar avisan cuántos ítems preparados van a cambiar", () => {
  assert.match(fuente("components/OrderBuilder.tsx"), /ya están preparados y van a cambiar/);
  assert.match(fuente("components/PeriodHub.tsx"), /ya están preparados y van a cambiar/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`
Expected: FAIL.

- [ ] **Step 3: El editor recibe lo tildado**

En `app/(app)/evento/[id]/page.tsx`, después de cargar `myLines`:

```ts
  // Lo que el depósito ya tildó de este pedido: el editor avisa antes de cambiarlo.
  const tildados = await prisma.preparacion.findMany({ where: { eventId: id }, select: { clave: true, qty: true } });
```

y en el objeto `data` que se pasa a `OrderBuilder`:

```ts
    preparados: Object.fromEntries(tildados.map((t) => [t.clave, t.qty])),
```

- [ ] **Step 4: `OrderBuilder`: confirmar en la fila**

Sumar a `type Data`: `preparados: Record<string, number>;`. Dentro de `OrderBuilder`:

```tsx
  // Cambiar algo que el depósito ya preparó obliga a rehacerlo. Se pregunta en
  // la fila, una vez por ítem y por sesión: confirmado, el ajuste fino sigue
  // sin trabas. Un aviso que se repite en cada tecla se deja de leer.
  // Un ref y no un estado: se lee y se escribe solo desde los manejadores.
  const confirmados = useRef(new Set<string>());
  const [porConfirmar, setPorConfirmar] = useState<{ clave: string; aplicar: () => void } | null>(null);
  function conConfirmacion(clave: string, aplicar: () => void) {
    if (data.preparados[clave] !== undefined && !confirmados.current.has(clave)) {
      setPorConfirmar({ clave, aplicar });
      return;
    }
    aplicar();
  }
  function confirmarCambio() {
    if (!porConfirmar) return;
    confirmados.current.add(porConfirmar.clave);
    const aplicar = porConfirmar.aplicar;
    setPorConfirmar(null);
    aplicar();
  }
```

(`useRef` ya está importado en `OrderBuilder`.)

`updateItem` pasa a delegar en `conConfirmacion`. El cuerpo de hoy se mueve, sin cambios, a `aplicarCambio`:

```tsx
  function updateItem(id: string, patch: Partial<ProductRow>) {
    conConfirmacion(id, () => aplicarCambio(id, patch));
  }
  function aplicarCambio(id: string, patch: Partial<ProductRow>) {
    const previous = currentItems.current.find((p) => p.id === id);
    if (!previous) return;
    const next = { ...previous, ...patch };
    if (!validQuantity(next.qty)) return;
    currentItems.current = currentItems.current.map((p) => p.id === id ? next : p);
    setItems(currentItems.current);
    const pending: OrderSave = { kind: "product", row: next };
    scheduleSave(id, pending);
  }
```

`aplicarCambio` es el cuerpo de hoy de `updateItem`, sin cambios.

En el render de cada fila de producto, al final del `<div className={`orow...`}>`:

```tsx
                  {porConfirmar?.clave === p.id && (
                    <div className="prep-aviso-fila" role="alert">
                      <span>
                        Ya está preparado ({data.preparados[p.id]}). Si lo cambiás, el depósito tiene que rehacerlo.
                      </span>
                      <button className="btn primary" onClick={confirmarCambio}>Cambiar igual</button>
                      <button className="btn ghost" onClick={() => setPorConfirmar(null)}>Cancelar</button>
                    </div>
                  )}
```

Y una marca chica en la fila, junto al nombre, si `data.preparados[p.id] !== undefined`: `<span className="chip ok">Preparado</span>`.

**Ítems sueltos (`ExtrasPanel`).** Su clave es `custom:<id del renglón>`.

Pasarle al `<ExtrasPanel ... />`:

```tsx
            preparados={data.preparados}
            conConfirmacion={conConfirmacion}
            porConfirmar={porConfirmar?.clave ?? null}
            onConfirmar={confirmarCambio}
            onCancelar={() => setPorConfirmar(null)}
```

y sumar a sus props (destructuring y tipo):

```tsx
  preparados: Record<string, number>;
  conConfirmacion: (clave: string, aplicar: () => void) => void;
  porConfirmar: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
```

Adentro de `ExtrasPanel`, debajo de `remove`:

```tsx
  // Las dos entradas a cambiar un suelto pasan por la misma pregunta que los
  // productos del catálogo.
  function pedirCambio(id: string, next: number) {
    conConfirmacion(`custom:${id}`, () => changeQty(id, next));
  }
  function pedirQuitar(id: string) {
    conConfirmacion(`custom:${id}`, () => void remove(id));
  }
```

En la fila de cada suelto, los tres `onClick`/`onChange` que hoy llaman a `changeQty(c.id, ...)` pasan a llamar a `pedirCambio(c.id, ...)` con el mismo argumento, y el botón de borrar pasa de `remove(c.id)` a `pedirQuitar(c.id)`. Al final del `<div className="orow has-qty">` del suelto:

```tsx
            {porConfirmar === `custom:${c.id}` && (
              <div className="prep-aviso-fila" role="alert">
                <span>
                  Ya está preparado ({preparados[`custom:${c.id}`]}). Si lo cambiás, el depósito tiene que rehacerlo.
                </span>
                <button className="btn primary" onClick={onConfirmar}>Cambiar igual</button>
                <button className="btn ghost" onClick={onCancelar}>Cancelar</button>
              </div>
            )}
```

**Copiar.** Pasarle a `CopyOrderModal` la prop `preparadosCount={Object.keys(data.preparados).length}`. En su `msub`, después de la frase de "Reemplaza":

```tsx
              {preparadosCount > 0 && (
                <> <b>{preparadosCount} {preparadosCount === 1 ? "ítem ya está preparado y va a cambiar" : "ítems ya están preparados y van a cambiar"}:</b> el depósito va a tener que rehacerlos.</>
              )}
```

Estilo, al final de `app/globals.css`:

```css
.prep-aviso-fila{grid-column:1/-1; display:flex; flex-wrap:wrap; align-items:center; gap:var(--sp-2); margin-top:var(--sp-2); padding:var(--sp-2) var(--sp-3); border:1px solid var(--warn); border-radius:var(--radius); background:var(--surface-2); font-size:var(--t-sm)}
.prep-aviso-fila span{flex:1 1 220px}
```

- [ ] **Step 5: Descartar cambios avisa lo preparado del período**

Descartar tiene confirmación; restaurar una versión desde la Papelera, no (es un toque). Ahí el aviso va en la misma fila de la versión, a la vista antes de tocar "Restaurar".

En `app/(app)/page.tsx`, después del `Promise.all` de la papelera:

```ts
  // Lo que el depósito ya tildó, por período: descartar o restaurar lo pisa, y
  // la confirmación lo tiene que decir. Son pocas filas (los eventos que vienen).
  const preparadosPorPeriodo = new Map<string, number>();
  for (const f of await prisma.preparacion.findMany({
    where: { event: { deletedAt: null, period: { deletedAt: null } } },
    select: { event: { select: { periodId: true } } },
  })) {
    preparadosPorPeriodo.set(f.event.periodId, (preparadosPorPeriodo.get(f.event.periodId) ?? 0) + 1);
  }
```

En `data.selected`, sumar `preparados: preparadosPorPeriodo.get(selected.id) ?? 0,`. En cada elemento de `trash.versions`, sumar `preparados: preparadosPorPeriodo.get(v.periodId) ?? 0,`.

En `components/PeriodHub.tsx`:
- sumar `preparados: number` al tipo de `selected` y al de cada elemento de `trash.versions`;
- pasarle `preparados={selected.preparados}` a `ConfirmDiscardChanges`, y sumar `preparados: number` a sus props;
- en `ConfirmDiscardChanges`, dentro del `<div className="msub">`, después del párrafo "Qué NO se toca":

```tsx
          {preparados > 0 && (
            <p>
              <b>{preparados} {preparados === 1 ? "ítem ya está preparado y va a cambiar" : "ítems ya están preparados y van a cambiar"}</b>: el depósito va a recibir el aviso para revisarlos.
            </p>
          )}
```

- en `TrashModal`, dentro de la fila de cada versión, debajo del `<div className="trash-meta">`:

```tsx
                {v.preparados > 0 && (
                  <div className="trash-meta prep-ojo">
                    {v.preparados} {v.preparados === 1 ? "ítem ya está preparado y va a cambiar" : "ítems ya están preparados y van a cambiar"}
                  </div>
                )}
```

Estilo, al final de `app/globals.css`: `.prep-ojo{color:var(--warn); font-weight:700}`.

Y sumar a la prueba del Step 1: `assert.match(fuente("components/PeriodHub.tsx"), /v\.preparados > 0/);`.

- [ ] **Step 6: Correr la prueba, el typecheck, el lint, la suite y la compilación**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`, después `npx tsc --noEmit`, `npx eslint`, `npm test` y `npm run build`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/evento/[id]/page.tsx" components/OrderBuilder.tsx "app/(app)/page.tsx" components/PeriodHub.tsx app/globals.css tests/preparacion-guardas.test.ts
git commit -m "Deposito: el editor avisa antes de cambiar algo ya preparado"
```

---

### Task 10: Registro de cambios tardíos (solo administradora)

**Files:**
- Create: `lib/cambios-tardios.ts`, `app/(app)/cambios-tardios/page.tsx`
- Modify: `components/Sidebar.tsx` (`ADMIN_NAV`), `app/(app)/notificaciones/page.tsx` (link)
- Test: `tests/cambios-tardios.test.ts`

**Interfaces:**
- Consumes: `OrderChange.tardio` (Task 1).
- Produces: `registroTardio(periodId?: string): Promise<{ total: number; eventos: EventoTardio[]; personas: PersonaTardia[] }>`, donde:
  - `EventoTardio = { eventId; lugar; date: Date; total; mismoDia; cambios: { id; at: Date; actorName; itemName; kind; before; after; mismoDia: boolean }[] }`
  - `PersonaTardia = { actorName; total; eventos: number; mismoDia: number }`

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/cambios-tardios.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe } from "../lib/dates";

/** El registro de cambios tardíos: qué se cambió después de preparar, dónde y quién. */

const base = crearBaseDescartable("cambios-tardios");
let prisma: typeof import("../lib/db").prisma;
let registro: typeof import("../lib/cambios-tardios");
let ids: { p1: string; p2: string; carmen: string; hipico: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  registro = await import("../lib/cambios-tardios");
  const p1 = await prisma.operationalPeriod.create({ data: { startDay: "2026-10-23", endDay: "2026-10-25" } });
  const p2 = await prisma.operationalPeriod.create({ data: { startDay: "2026-10-30", endDay: "2026-11-01" } });
  const carmen = await prisma.event.create({ data: { periodId: p1.id, lugar: "El Carmen", date: instanteDe("2026-10-24", "21:00") } });
  const hipico = await prisma.event.create({ data: { periodId: p2.id, lugar: "Hípico", date: instanteDe("2026-10-31", "21:00") } });
  const cambio = (eventId: string, actorName: string, cuando: Date, tardio = true) =>
    prisma.orderChange.create({ data: { eventId, actorName, itemName: "Copa", kind: "CANTIDAD", before: "10", after: "24", tardio, createdAt: cuando } });
  await cambio(carmen.id, "Enrique", instanteDe("2026-10-22", "10:00"));
  await cambio(carmen.id, "Enrique", instanteDe("2026-10-24", "15:00")); // el mismo día del evento
  await cambio(carmen.id, "Aldana", instanteDe("2026-10-23", "09:00"));
  await cambio(carmen.id, "Enrique", instanteDe("2026-10-23", "11:00"), false); // no tardío: no cuenta
  await cambio(hipico.id, "Enrique", instanteDe("2026-10-31", "20:00"));
  ids = { p1: p1.id, p2: p2.id, carmen: carmen.id, hipico: hipico.id };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

test("cuenta solo los tardíos, por evento y con los del mismo día", async () => {
  const r = await registro.registroTardio();
  assert.equal(r.total, 4);
  const carmen = r.eventos.find((e) => e.eventId === ids.carmen)!;
  assert.equal(carmen.total, 3);
  assert.equal(carmen.mismoDia, 1);
  assert.equal(r.eventos[0].eventId, ids.hipico, "del evento más reciente al más viejo");
});

test("por persona: cuántos, en cuántos eventos y cuántos el mismo día", async () => {
  const r = await registro.registroTardio();
  const enrique = r.personas.find((p) => p.actorName === "Enrique")!;
  assert.deepEqual([enrique.total, enrique.eventos, enrique.mismoDia], [3, 2, 2]);
  assert.equal(r.personas[0].actorName, "Enrique", "el que más primero");
});

test("se filtra por período", async () => {
  const r = await registro.registroTardio(ids.p2);
  assert.equal(r.total, 1);
  assert.deepEqual(r.eventos.map((e) => e.lugar), ["Hípico"]);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/cambios-tardios.test.ts`
Expected: FAIL con `Cannot find module '../lib/cambios-tardios'`.

- [ ] **Step 3: Escribir `lib/cambios-tardios.ts`**

```ts
import { prisma } from "@/lib/db";
import { diaDe } from "@/lib/dates";

// El registro de cambios tardíos: lo que se cambió en un pedido después de que
// el depósito lo preparó. Es para medir el problema y hablarlo con datos: cuántos,
// en qué eventos, quién, y cuántos el mismo día del evento.

const TOPE = 2000;

export type CambioTardio = {
  id: string;
  at: Date;
  actorName: string;
  itemName: string;
  kind: string;
  before: string | null;
  after: string | null;
  /** El mismo día del evento o después: el que menos margen deja. */
  mismoDia: boolean;
};
export type EventoTardio = { eventId: string; lugar: string; date: Date; total: number; mismoDia: number; cambios: CambioTardio[] };
export type PersonaTardia = { actorName: string; total: number; eventos: number; mismoDia: number };

export async function registroTardio(periodId?: string): Promise<{ total: number; eventos: EventoTardio[]; personas: PersonaTardia[] }> {
  const filas = await prisma.orderChange.findMany({
    where: { tardio: true, ...(periodId ? { event: { periodId } } : {}) },
    orderBy: { createdAt: "desc" },
    take: TOPE,
    include: { event: { select: { id: true, lugar: true, date: true } } },
  });

  const eventos = new Map<string, EventoTardio>();
  const personas = new Map<string, { total: number; eventos: Set<string>; mismoDia: number }>();
  for (const f of filas) {
    const mismoDia = diaDe(f.createdAt) >= diaDe(f.event.date);
    const e = eventos.get(f.eventId) ?? { eventId: f.eventId, lugar: f.event.lugar, date: f.event.date, total: 0, mismoDia: 0, cambios: [] };
    e.total++;
    if (mismoDia) e.mismoDia++;
    e.cambios.push({ id: f.id, at: f.createdAt, actorName: f.actorName, itemName: f.itemName, kind: f.kind, before: f.before, after: f.after, mismoDia });
    eventos.set(f.eventId, e);
    const p = personas.get(f.actorName) ?? { total: 0, eventos: new Set<string>(), mismoDia: 0 };
    p.total++;
    p.eventos.add(f.eventId);
    if (mismoDia) p.mismoDia++;
    personas.set(f.actorName, p);
  }

  return {
    total: filas.length,
    eventos: [...eventos.values()].sort((a, b) => b.date.getTime() - a.date.getTime()),
    personas: [...personas]
      .map(([actorName, p]) => ({ actorName, total: p.total, eventos: p.eventos.size, mismoDia: p.mismoDia }))
      .sort((a, b) => b.total - a.total || a.actorName.localeCompare(b.actorName, "es")),
  };
}
```

- [ ] **Step 4: La pantalla `app/(app)/cambios-tardios/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { registroTardio } from "@/lib/cambios-tardios";
import { describirCambio } from "@/lib/aviso-texto";
import { fmtEvento, fmtMomento } from "@/lib/dates";
import { nombreDe } from "@/lib/period-fit";

export const dynamic = "force-dynamic";

export default async function CambiosTardiosPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sesion = await getSessionUser();
  if (!sesion || !canManageUsers(sesion.role)) notFound();

  const { p } = await searchParams;
  const periodos = await prisma.operationalPeriod.findMany({
    where: { deletedAt: null },
    orderBy: { startDay: "desc" },
    take: 20,
    select: { id: true, label: true, startDay: true, endDay: true },
  });
  const elegido = periodos.find((x) => x.id === p) ?? null;
  const r = await registroTardio(elegido?.id);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Cambios tardíos</h1>
          <div className="sub">Lo que se cambió en un pedido después de que el depósito lo preparó</div>
        </div>
      </div>
      <div className="content">
        <div className="searchbar">
          <Link className={`tab${elegido ? "" : " active"}`} href="/cambios-tardios">Todos</Link>
          {periodos.map((x) => (
            <Link key={x.id} className={`tab${elegido?.id === x.id ? " active" : ""}`} href={`/cambios-tardios?p=${x.id}`}>
              {nombreDe(x)}
            </Link>
          ))}
        </div>

        {r.total === 0 ? (
          <div className="empty-card">
            <p className="empty-title">No hubo cambios tardíos</p>
            <p>Aparecen cuando alguien cambia un ítem que el depósito ya había tildado como preparado.</p>
          </div>
        ) : (
          <>
            <section className="settings-card">
              <h2>Por persona</h2>
              <ul className="revision-list">
                {r.personas.map((x) => (
                  <li key={x.actorName} className="revision-item">
                    <b>{x.actorName}</b>: {x.total} {x.total === 1 ? "cambio" : "cambios"} en {x.eventos} {x.eventos === 1 ? "evento" : "eventos"}
                    {x.mismoDia > 0 ? ` · ${x.mismoDia} el mismo día del evento` : ""}
                  </li>
                ))}
              </ul>
            </section>
            <section className="settings-card">
              <h2>Por evento</h2>
              {r.eventos.map((e) => (
                <details key={e.eventId} className="tardio-evento">
                  <summary>
                    <b>{e.lugar}</b> · {fmtEvento(e.date)} · {e.total} {e.total === 1 ? "cambio" : "cambios"}
                    {e.mismoDia > 0 && <span className="disp-alarma"> · {e.mismoDia} el mismo día</span>}
                  </summary>
                  <ul className="revision-list">
                    {e.cambios.map((c) => (
                      <li key={c.id} className={`revision-item${c.mismoDia ? " grav-alta" : ""}`}>
                        {fmtMomento(c.at)} · {c.actorName} · {describirCambio(c)}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}
```

El contenedor `searchbar` y las pestañas `tab` / `tab active` son los mismos de Inventario y Historial (verificado el 19/10).

- [ ] **Step 5: Acceso desde el menú y desde Avisos**

`components/Sidebar.tsx`, en `ADMIN_NAV`, debajo de Dispositivos:

```ts
  { href: "/cambios-tardios", label: "Cambios tardíos", icon: ICONS.historial },
```

`app/(app)/notificaciones/page.tsx`, dentro del bloque `canManageUsers`, debajo del link a Dispositivos:

```tsx
            {" · "}<Link href="/cambios-tardios">Ver los cambios tardíos →</Link>
```

- [ ] **Step 6: Correr las pruebas, el typecheck, el lint, la suite y la compilación**

Run: `node --import tsx --test tests/cambios-tardios.test.ts`, después `npx tsc --noEmit`, `npx eslint`, `npm test` y `npm run build`
Expected: todo en verde, con `/cambios-tardios` en las rutas.

- [ ] **Step 7: Commit**

```bash
git add lib/cambios-tardios.ts "app/(app)/cambios-tardios" components/Sidebar.tsx "app/(app)/notificaciones/page.tsx" tests/cambios-tardios.test.ts
git commit -m "Deposito: registro de cambios tardios, por evento y por persona"
```

---

### Task 11: Instalación guiada

**Files:**
- Create: `components/InstalarApp.tsx`
- Modify: `app/manifest.ts`, `app/(app)/notificaciones/page.tsx`, `app/(app)/preparar/page.tsx`, `app/globals.css`
- Test: `tests/preparacion-guardas.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```ts
test("la instalación guiada está en Avisos y en Preparar, y el manifiesto tiene el atajo", () => {
  assert.match(fuente("app/(app)/notificaciones/page.tsx"), /<InstalarApp \/>/);
  assert.match(fuente("app/(app)/preparar/page.tsx"), /<InstalarApp \/>/);
  assert.match(fuente("app/manifest.ts"), /shortcuts:[\s\S]*"\/preparar"/);
  const c = fuente("components/InstalarApp.tsx");
  assert.match(c, /beforeinstallprompt/);
  assert.match(c, /display-mode: standalone/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Escribir `components/InstalarApp.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type EventoInstalar = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * Instalar la app en el teléfono, guiado.
 *
 * En Android el navegador ofrece instalarla y se captura ese ofrecimiento para
 * un botón propio. En iPhone no hay botón posible: se explican los pasos, y que
 * los avisos solo llegan con la app instalada. Instalada, no aparece.
 */
export function InstalarApp() {
  const [modo, setModo] = useState<"oculto" | "android" | "ios">("oculto");
  const ofrecimiento = useRef<EventoInstalar | null>(null);

  useEffect(() => {
    let activo = true;
    const capturar = (e: Event) => {
      e.preventDefault();
      ofrecimiento.current = e as EventoInstalar;
      if (activo) setModo("android");
    };
    const instalada = () => {
      if (activo) setModo("oculto");
    };
    (async () => {
      // Un tick antes de decidir: el estado se setea fuera del cuerpo del efecto.
      await Promise.resolve();
      const yaInstalada =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (yaInstalada) return;
      // Un iPad con iPadOS se presenta como Mac: se lo reconoce por la pantalla táctil.
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios && activo) setModo("ios");
    })();
    window.addEventListener("beforeinstallprompt", capturar);
    window.addEventListener("appinstalled", instalada);
    return () => {
      activo = false;
      window.removeEventListener("beforeinstallprompt", capturar);
      window.removeEventListener("appinstalled", instalada);
    };
  }, []);

  async function instalar() {
    const e = ofrecimiento.current;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    ofrecimiento.current = null;
    if (outcome === "accepted") setModo("oculto");
  }

  if (modo === "oculto") return null;
  return (
    <div className="instalar">
      {modo === "android" ? (
        <>
          <span className="instalar-texto">Instalá la app: se abre con su ícono, sin la barra del navegador, y los avisos llegan mejor.</span>
          <button className="btn primary" onClick={instalar}>Instalar la app</button>
        </>
      ) : (
        <span className="instalar-texto">
          Para instalarla en iPhone: 1) tocá <b>Compartir</b> en Safari, 2) elegí <b>Agregar a inicio</b>, 3) abrí la app desde su ícono.
          En iPhone los avisos solo llegan con la app instalada.
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ubicarla y el atajo del manifiesto**

- `app/(app)/notificaciones/page.tsx`: importar `InstalarApp` y ponerla arriba de `<EnableNotifications />`.
- `app/(app)/preparar/page.tsx`: importarla y ponerla como primer hijo de `<div className="content">`.
- `app/manifest.ts`, en el objeto que se devuelve:

```ts
    // Mantener apretado el ícono en Android ofrece ir directo a Preparar.
    shortcuts: [{ name: "Preparar", short_name: "Preparar", url: "/preparar" }],
```

- Al final de `app/globals.css`:

```css
.instalar{display:flex; flex-wrap:wrap; align-items:center; gap:var(--sp-3); padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4); background:var(--surface); border:1px solid var(--gold); border-radius:var(--radius)}
.instalar-texto{flex:1 1 240px; font-size:var(--t-sm); line-height:1.4}
```

Si `--gold` no existe, usar el color de acento que use `.btn.primary`.

- [ ] **Step 5: Correr la prueba, el typecheck, el lint y la compilación**

Run: `node --import tsx --test tests/preparacion-guardas.test.ts`, después `npx tsc --noEmit`, `npx eslint` y `npm run build`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add components/InstalarApp.tsx app/manifest.ts "app/(app)/notificaciones/page.tsx" "app/(app)/preparar/page.tsx" app/globals.css tests/preparacion-guardas.test.ts
git commit -m "Deposito: instalar la app guiado, en Android y en iPhone"
```

---

### Task 12: Revisión, verificación con datos reales y deploy (con OK del usuario)

- [ ] **Step 1: Revisión de la rama entera contra la spec**

Con el modelo más capaz y el paquete de revisión de `main..HEAD`. Recorrer la sección "Etapa 2" de la spec punto por punto, y leer el diff entero: no basta con el typecheck.

- [ ] **Step 2: Suite, lint y compilación desde cero**

```bash
rm -rf .next && npm test && npx eslint && npm run build
```

- [ ] **Step 3: Copia de producción, sin suscripciones**

Igual que en la etapa 1:
- bajar la última copia del stock con `railway run` sin imprimir credenciales;
- `migrate deploy`;
- borrar `PushSubscription` **de la copia**;
- levantar `next start` con `VAPID_PRIVATE_KEY=""` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY=""` y tokens descartables.

En la copia, **crear un usuario `DEPOSITO`** de prueba. Comprobar:
- `/` lo lleva a `/preparar`;
- `/inventario`, `/historial` y `/evento/<id>` le dan "no encontrado";
- `/preparar` lista los eventos;
- tildar y destildar funcionan en el navegador a 375×812;
- cambiar una cantidad tildada desde una sesión de armador muestra la advertencia en la fila y, con "Cambiar igual", deja el ítem en "Cambios para aplicar";
- `/cambios-tardios` muestra el cambio;
- el log no tiene errores.

- [ ] **Step 4: Pedir el OK del usuario y desplegar**

Recién con un sí explícito:
- `main` por fast-forward, `push`;
- seguir el deploy;
- verificar en los logs que se aplicó `20261021120000_preparacion` y que no hay 5xx.

Después, el usuario crea los usuarios del depósito en `/usuarios` y cada uno instala la app y activa los avisos.

- [ ] **Step 5: Bitácora**

Registrar la etapa en el vault, commit y `git push onedrive master`.
