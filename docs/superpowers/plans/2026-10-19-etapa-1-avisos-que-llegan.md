# Etapa 1 · Avisos que llegan — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada push quede registrado con su resultado, que se reintente una vez si falló por algo pasajero, que diga qué cambió, y que la administradora vea a quién le llega y a quién no.

**Architecture:** `lib/push.ts` pasa a escribir una fila `PushDelivery` por cada intento a cada dispositivo, con un `transporte` reemplazable en las pruebas. El barrido de cada minuto (`flushPendingOrderPushes`) arma el texto del push con los cambios netos de la tanda (`lib/aviso-texto.ts`, puro) y reintenta los fallidos. El service worker informa cuándo se abre un aviso y renueva su suscripción solo. Una pantalla `/dispositivos` lee el registro.

**Tech Stack:** Next.js 16.3.4 (App Router, server actions), Prisma 7.10 con SQLite (`@prisma/adapter-better-sqlite3`), `web-push` 3.6, pruebas con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-deposito-y-avisos-design.md`, sección "Etapa 1".

**Una desviación deliberada de la spec:** la spec marcaba la apertura agregando `?d=<deliveryId>` a la URL del aviso. El plan manda `d` dentro del contenido del push, y el service worker lo informa con `POST /api/notifications/abierto` antes de abrir la pantalla. El resultado es el mismo (`openedAt` y el aviso leído), y además las URLs de la app no cargan un parámetro que ninguna pantalla usa, y la marca no queda en el historial del navegador.

## Global Constraints

- **Esto NO es el Next.js que conocés.** Antes de tocar una API de Next, leé la guía en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- **Sin dependencias nuevas.**
- **Nombres y comentarios en castellano rioplatense**, como el resto del código. Los comentarios explican el *porqué*.
- **Quietud del aviso de cambios: 2 minutos** (`QUIET_MINUTES = 2`).
- **Un solo reintento**, solo ante 429, 5xx o error de red, dentro de los 60 minutos del intento original.
- **El registro se poda a los 60 días.**
- **Se considera que a un dispositivo "no le llega"** con 3 envíos seguidos no aceptados (`FALLOS_PARA_ALARMA = 3`).
- **Cuerpo del push**: hasta 3 cambios, después `y N más`, y al final `— <quién>`. Máximo 500 caracteres.
- **Los permisos se deciden en el servidor.** La pantalla `/dispositivos` responde 404 a quien no pasa `canManageUsers`.
- **Pruebas**: `npm test` corre `node --import tsx --test tests/*.test.ts`. Cada archivo corre en su propio proceso, y las pruebas con base usan una SQLite descartable migrada con `prisma migrate deploy`.
- **No se despliega sin el OK explícito del usuario.** Antes de pedirlo: la app en local sobre una copia de producción **sin suscripciones** y con las claves VAPID vacías (ver Task 10).

## Mapa de archivos

| Archivo | Qué | Tarea |
|---|---|---|
| `prisma/schema.prisma` | Modelo `PushDelivery`; `PushSubscription` suma `userAgent`, `lastOkAt`, `lastErrorAt` | 1 |
| `prisma/migrations/20261020120000_registro_de_avisos/migration.sql` | Migración | 1 |
| `tests/helpers/base-descartable.ts` | Crea la SQLite descartable para las pruebas (nuevo) | 1 |
| `lib/push.ts` | Reescrito: transporte, registro, reintento, apertura, prueba, poda | 2 |
| `lib/notify.ts`, `lib/pedido-vacio.ts`, `lib/healthcheck.ts`, `app/actions/suggestions.ts` | Llaman a `sendPushToUser` con la firma nueva | 2 |
| `tests/push.test.ts` | Pruebas del registro (nuevo) | 2 |
| `lib/aviso-texto.ts` | Cambios netos y texto del push, puro (nuevo) | 3 |
| `tests/aviso-texto.test.ts` | (nuevo) | 3 |
| `lib/notify.ts` | 2 minutos, texto nuevo, `cambiosDeLaTanda`, reintento | 4 |
| `app/(app)/aviso/[id]/page.tsx` | "Qué cambió" acotado a la tanda | 4 |
| `instrumentation.ts` | Log nuevo y poda diaria | 4 |
| `tests/notifications.test.ts` | Se actualiza | 4 |
| `app/api/notifications/abierto/route.ts` | El service worker avisa que se abrió (nuevo) | 5 |
| `app/api/notifications/clave/route.ts` | Clave pública para renovar la suscripción (nuevo) | 5 |
| `app/api/notifications/subscribe/route.ts` | Guarda `userAgent` | 5 |
| `app/actions/notifications.ts` | `probarEsteDispositivo` | 5 |
| `tests/avisos-guardas.test.ts` | Pruebas sobre el texto de rutas y acciones (nuevo) | 5, 7 |
| `public/sw.js` | Apertura, `pushsubscriptionchange` | 6 |
| `tests/sw.test.ts` | El service worker en una caja de arena (nuevo) | 6 |
| `components/PushSubscriptionSync.tsx` | Registra el service worker desde cualquier pantalla | 6 |
| `components/CerrarSesion.tsx` | Cerrar sesión desanota el teléfono (nuevo) | 6 |
| `components/Sidebar.tsx`, `app/(app)/cuenta/page.tsx` | Usan `CerrarSesion` | 6 |
| `components/EnableNotifications.tsx` | Botón "Probar en este teléfono" | 6 |
| `app/actions/users.ts` | Borrar usuario borra sus dispositivos | 7 |
| `lib/healthcheck.ts` | `agruparHallazgos` conserva el link; avisos del sistema con `linkUrl` | 7 |
| `tests/aviso-urgente.test.ts` | Prueba de `agruparHallazgos` | 7 |
| `lib/dispositivos.ts` | Estado de los dispositivos por persona (nuevo) | 8 |
| `app/(app)/dispositivos/page.tsx` | Pantalla (nueva) | 8 |
| `tests/dispositivos.test.ts` | (nuevo) | 8 |
| `components/Sidebar.tsx`, `app/(app)/notificaciones/page.tsx`, `app/globals.css` | Acceso y estilo | 8 |

---

### Task 1: Esquema del registro y base descartable para las pruebas

**Files:**
- Modify: `prisma/schema.prisma` (modelo `PushSubscription`, y modelo nuevo al final)
- Create: `prisma/migrations/20261020120000_registro_de_avisos/migration.sql`
- Create: `tests/helpers/base-descartable.ts`

**Interfaces:**
- Produces: la tabla `PushDelivery` (campos abajo) y `crearBaseDescartable(nombre: string): { url: string; borrar: () => void }`. Fija `process.env.DATABASE_URL`: **importar `lib/db` recién después** de llamarla.

- [ ] **Step 1: Agregar los campos a `PushSubscription`**

En `prisma/schema.prisma`, el modelo queda así:

```prisma
model PushSubscription {
  id          String    @id @default(cuid())
  userId      String
  endpoint    String    @unique
  p256dh      String
  auth        String
  createdAt   DateTime  @default(now())
  // Para mostrar "Chrome · Android" en Dispositivos. Se toma al suscribir y en
  // cada apertura de la app; las suscripciones viejas lo completan solas.
  userAgent   String?
  // Último envío aceptado y último fallido: lo que dice si a este teléfono le
  // llegan los avisos, sin tener que recorrer el registro.
  lastOkAt    DateTime?
  lastErrorAt DateTime?

  @@index([userId])
}
```

- [ ] **Step 2: Agregar el modelo `PushDelivery` al final del esquema**

```prisma
/// Un intento de mandar un push a UN dispositivo.
///
/// Sin claves foráneas a propósito: el dispositivo o el aviso pueden borrarse,
/// y el registro tiene que quedar para poder decir qué pasó.
model PushDelivery {
  id             String    @id @default(cuid())
  notificationId String?
  userId         String
  subscriptionId String?
  // ORDER_EDIT | CAMBIO_TARDIO | FALTANTE | PEDIDO_VACIO | SISTEMA | SUGERENCIA | PRUEBA
  kind           String
  // ACEPTADO | CADUCADO | RECHAZADO | ERROR
  status         String
  statusCode     Int?
  error          String?
  attempt        Int       @default(1)
  // 429, 5xx o red: vale la pena un segundo intento. El resto, no.
  reintentable   Boolean   @default(false)
  retriedAt      DateTime?
  // Lo que se mandó, sin la marca de entrega: hace falta para reintentar.
  payload        String
  urgency        String    @default("normal")
  createdAt      DateTime  @default(now())
  openedAt       DateTime?

  @@index([userId, createdAt])
  @@index([subscriptionId, createdAt])
  @@index([status, reintentable, retriedAt])
  @@index([createdAt])
}
```

- [ ] **Step 3: Generar la migración desde el esquema**

```bash
mkdir -p prisma/migrations/20261020120000_registro_de_avisos
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script > prisma/migrations/20261020120000_registro_de_avisos/migration.sql
cat prisma/migrations/20261020120000_registro_de_avisos/migration.sql
```

Expected: tres `ALTER TABLE "PushSubscription" ADD COLUMN` (`userAgent` TEXT, `lastOkAt` DATETIME, `lastErrorAt` DATETIME), un `CREATE TABLE "PushDelivery"` y cuatro `CREATE INDEX`. Si la primera línea es `Loaded Prisma config...`, borrarla del archivo: tiene que quedar solo SQL.

- [ ] **Step 4: Agregar el encabezado explicativo arriba del SQL**

```sql
-- Registro de cada push, para saber a quién le llega y a quién no.
--
-- Hasta acá un push que fallaba se perdía en silencio: del 07/09 al 19/10/2026
-- ningún teléfono pudo activar los avisos y nada lo mostró. Cada intento a cada
-- dispositivo queda ahora como una fila de PushDelivery con su resultado.
-- Las columnas nuevas de PushSubscription son nulas: no cambian ningún dato.
```

- [ ] **Step 5: Verificar que la migración aplica y que no queda diferencia con el esquema**

```bash
T="$TEMP/registro-$$.db"; : > "$T"
DATABASE_URL="file:$T" npx prisma migrate deploy
DATABASE_URL="file:$T" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
npx prisma generate
```

Expected: `All migrations have been successfully applied.`, después `-- This is an empty migration.` y `Generated Prisma Client`.

- [ ] **Step 6: Crear el ayudante de base descartable**

`tests/helpers/base-descartable.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Una base SQLite nueva y descartable, con las mismas migraciones que corren en
 * producción. No toca dev.db ni nada real.
 *
 * Fija `process.env.DATABASE_URL`: `lib/db` crea el cliente al importarse, así
 * que hay que importarlo DESPUÉS de llamar a esto (con `await import`).
 */
export function crearBaseDescartable(nombre: string): { url: string; borrar: () => void } {
  const archivo = path.join(os.tmpdir(), `didier-test-${nombre}-${process.pid}.db`);
  fs.rmSync(archivo, { force: true });
  // Prisma en Windows necesita que el archivo exista antes de migrar.
  fs.writeFileSync(archivo, "");
  const url = `file:${archivo}`;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  return {
    url,
    borrar: () => {
      // En Windows el archivo puede seguir tomado un instante: si no se puede
      // borrar, queda en la carpeta temporal y se limpia solo.
      for (const f of [archivo, `${archivo}-wal`, `${archivo}-shm`, `${archivo}-journal`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          /* se lo lleva el sistema */
        }
      }
    },
  };
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261020120000_registro_de_avisos tests/helpers/base-descartable.ts
git commit -m "Avisos: registro de cada push (esquema)"
```

---

### Task 2: `lib/push.ts` registra cada intento, reintenta una vez, y sabe probar y podar

**Files:**
- Modify: `lib/push.ts` (reescritura completa)
- Modify: `lib/notify.ts:157-163`, `lib/pedido-vacio.ts:114-133`, `lib/healthcheck.ts:93-103`, `app/actions/suggestions.ts:143-161` y `:226-242` (solo la llamada)
- Test: `tests/push.test.ts`

**Interfaces:**
- Consumes: `PushDelivery` y los campos nuevos de `PushSubscription` (Task 1), y `crearBaseDescartable` (Task 1).
- Produces:
  - `type PushPayload = { title: string; body: string; url?: string; tag?: string }`
  - `type Urgencia = "very-low" | "low" | "normal" | "high"`
  - `type TipoDeAviso = "ORDER_EDIT" | "CAMBIO_TARDIO" | "FALTANTE" | "PEDIDO_VACIO" | "SISTEMA" | "SUGERENCIA" | "PRUEBA"`
  - `type Meta = { kind: TipoDeAviso; notificationId?: string | null }`
  - `type EstadoDeEntrega = "ACEPTADO" | "CADUCADO" | "RECHAZADO" | "ERROR"`
  - `transporte: { listo(): boolean; enviar(destino, cuerpo: string, urgency: Urgencia): Promise<{ statusCode: number }> }`
  - `clasificar(statusCode: number | null): { status: EstadoDeEntrega; reintentable: boolean }`
  - `enviarASuscripcion(sub, payload, meta, urgency?, attempt?): Promise<{ id: string; status: EstadoDeEntrega; error: string | null }>`
  - `sendPushToUser(userId, payload, meta: Meta, options?: { urgency?: Urgencia }): Promise<{ intentos: number; aceptados: number }>`
  - `reintentarFallidos(ahora?: Date): Promise<number>`
  - `registrarApertura(userId: string, deliveryId: string): Promise<boolean>`
  - `enviarPrueba(userId: string, endpoint: string): Promise<{ ok: boolean; error?: string }>`
  - `podarEntregas(ahora?: Date, dias?: number): Promise<number>`

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/push.test.ts`:

```ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";

/**
 * El registro de cada push, contra una base de verdad.
 *
 * Lo que se protege: que ningún envío se pierda en silencio. Del 07/09 al
 * 19/10/2026 ningún teléfono pudo activar los avisos y nada lo mostró.
 *
 * El envío real se reemplaza por uno falso (`transporte`) que responde el
 * código que pide cada prueba: así se prueban los seis desenlaces sin red.
 */

const base = crearBaseDescartable("push");
let prisma: typeof import("../lib/db").prisma;
let push: typeof import("../lib/push");
let usuario = "";
let otro = "";
let respuesta: number | "red" = 201;
const cuerpos: string[] = [];

before(async () => {
  ({ prisma } = await import("../lib/db"));
  push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (_destino, cuerpo) => {
    cuerpos.push(cuerpo);
    if (respuesta === "red") throw new Error("socket hang up");
    if (respuesta >= 200 && respuesta < 300) return { statusCode: respuesta };
    throw Object.assign(new Error(`Received unexpected response code ${respuesta}`), { statusCode: respuesta });
  };
  const u = await prisma.user.create({ data: { name: "Pablo", email: "p@test.local", role: "LOGISTICA", passwordHash: "x" } });
  const o = await prisma.user.create({ data: { name: "Enrique", email: "e@test.local", role: "ARMADOR", passwordHash: "x" } });
  usuario = u.id;
  otro = o.id;
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

beforeEach(async () => {
  await prisma.pushDelivery.deleteMany({});
  await prisma.pushSubscription.deleteMany({});
  cuerpos.length = 0;
  respuesta = 201;
  push.transporte.listo = () => true;
});

const suscribir = (userId: string, sufijo: string) =>
  prisma.pushSubscription.create({
    data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/${sufijo}`, p256dh: "k", auth: "a" },
  });

const PAYLOAD = { title: "El Carmen Center", body: "Copa de agua 10→24", url: "/aviso/x", tag: "order-x" };

test("clasificar: cada código cae donde corresponde", () => {
  assert.deepEqual(push.clasificar(201), { status: "ACEPTADO", reintentable: false });
  assert.deepEqual(push.clasificar(404), { status: "CADUCADO", reintentable: false });
  assert.deepEqual(push.clasificar(410), { status: "CADUCADO", reintentable: false });
  assert.deepEqual(push.clasificar(403), { status: "RECHAZADO", reintentable: false });
  assert.deepEqual(push.clasificar(413), { status: "RECHAZADO", reintentable: false });
  assert.deepEqual(push.clasificar(429), { status: "ERROR", reintentable: true });
  assert.deepEqual(push.clasificar(503), { status: "ERROR", reintentable: true });
  assert.deepEqual(push.clasificar(null), { status: "ERROR", reintentable: true });
});

test("un envío aceptado queda registrado y marca el dispositivo", async () => {
  const sub = await suscribir(usuario, "a1");
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT", notificationId: "n1" });
  assert.deepEqual(r, { intentos: 1, aceptados: 1 });
  const [e] = await prisma.pushDelivery.findMany();
  assert.equal(e.status, "ACEPTADO");
  assert.equal(e.notificationId, "n1");
  assert.equal(e.subscriptionId, sub.id);
  assert.equal(e.kind, "ORDER_EDIT");
  assert.ok((await prisma.pushSubscription.findUnique({ where: { id: sub.id } }))?.lastOkAt);
});

test("lo que llega al teléfono lleva la marca de entrega, y lo guardado no", async () => {
  await suscribir(usuario, "a2");
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const [e] = await prisma.pushDelivery.findMany();
  assert.equal(JSON.parse(cuerpos[0]).d, e.id, "el service worker necesita el id para avisar que se abrió");
  assert.equal(JSON.parse(e.payload).d, undefined, "el reintento tiene que generar su propia marca");
});

test("404 y 410: el dispositivo caducó y se borra", async () => {
  await suscribir(usuario, "c1");
  respuesta = 410;
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  assert.equal(r.aceptados, 0);
  assert.equal((await prisma.pushDelivery.findFirst())?.status, "CADUCADO");
  assert.equal(await prisma.pushSubscription.count(), 0);
});

test("403: rechazado, no se reintenta y el dispositivo queda", async () => {
  const sub = await suscribir(usuario, "r1");
  respuesta = 403;
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const e = await prisma.pushDelivery.findFirst();
  assert.equal(e?.status, "RECHAZADO");
  assert.equal(e?.reintentable, false);
  assert.ok((await prisma.pushSubscription.findUnique({ where: { id: sub.id } }))?.lastErrorAt);
  assert.equal(await push.reintentarFallidos(), 0);
});

test("500: se reintenta UNA vez, y nunca más", async () => {
  await suscribir(usuario, "e1");
  respuesta = 500;
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" }, { urgency: "high" });
  respuesta = 201;
  assert.equal(await push.reintentarFallidos(), 1);
  const intentos = await prisma.pushDelivery.findMany({ orderBy: { attempt: "asc" } });
  assert.deepEqual(intentos.map((i) => [i.attempt, i.status]), [[1, "ERROR"], [2, "ACEPTADO"]]);
  assert.equal(intentos[1].urgency, "high", "el reintento conserva la prioridad");
  assert.equal(await push.reintentarFallidos(), 0, "un segundo barrido no reintenta de nuevo");
});

test("sin red: error reintentable, sin código", async () => {
  await suscribir(usuario, "n1");
  respuesta = "red";
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const e = await prisma.pushDelivery.findFirst();
  assert.equal(e?.status, "ERROR");
  assert.equal(e?.statusCode, null);
  assert.equal(e?.reintentable, true);
  assert.match(e?.error ?? "", /socket hang up/);
});

test("un intento viejo de más de una hora no se reintenta", async () => {
  await suscribir(usuario, "v1");
  respuesta = 500;
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const dentroDeDosHoras = new Date(Date.now() + 2 * 60 * 60 * 1000);
  assert.equal(await push.reintentarFallidos(dentroDeDosHoras), 0);
});

test("sin claves VAPID: queda registrado como error y no se reintenta", async () => {
  await suscribir(usuario, "s1");
  push.transporte.listo = () => false;
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "SISTEMA" });
  assert.equal(r.aceptados, 0);
  const e = await prisma.pushDelivery.findFirst();
  assert.equal(e?.status, "ERROR");
  assert.equal(e?.error, "sin claves");
  assert.equal(e?.reintentable, false);
  assert.equal(cuerpos.length, 0, "no tiene que intentar mandar nada");
});

test("una persona sin dispositivos no genera registro ni error", async () => {
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  assert.deepEqual(r, { intentos: 0, aceptados: 0 });
});

test("abrir el aviso marca la entrega y deja leído el aviso; otra persona no puede", async () => {
  await suscribir(usuario, "o1");
  const ev = await prisma.notification.create({
    data: { recipientId: usuario, actorName: "Sistema", type: "PEDIDO_VACIO:x:1", message: "m", pushedAt: new Date() },
  });
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "PEDIDO_VACIO", notificationId: ev.id });
  const e = (await prisma.pushDelivery.findFirst())!;
  assert.equal(await push.registrarApertura(otro, e.id), false);
  assert.equal((await prisma.pushDelivery.findUnique({ where: { id: e.id } }))?.openedAt, null);
  assert.equal(await push.registrarApertura(usuario, e.id), true);
  assert.ok((await prisma.pushDelivery.findUnique({ where: { id: e.id } }))?.openedAt);
  assert.equal((await prisma.notification.findUnique({ where: { id: ev.id } }))?.read, true);
});

test("la prueba va solo al teléfono que la pide", async () => {
  await suscribir(usuario, "t1");
  await suscribir(usuario, "t2");
  const r = await push.enviarPrueba(usuario, "https://fcm.googleapis.com/fcm/send/t2");
  assert.deepEqual(r, { ok: true });
  assert.equal(cuerpos.length, 1);
  assert.equal((await prisma.pushDelivery.findFirst())?.kind, "PRUEBA");
});

test("la prueba no sale a un teléfono de otra persona", async () => {
  await suscribir(otro, "ajeno");
  const r = await push.enviarPrueba(usuario, "https://fcm.googleapis.com/fcm/send/ajeno");
  assert.equal(r.ok, false);
  assert.equal(cuerpos.length, 0);
});

test("la poda borra lo de más de 60 días y nada más", async () => {
  const vieja = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
  await prisma.pushDelivery.create({
    data: { userId: usuario, kind: "ORDER_EDIT", status: "ACEPTADO", payload: "{}", createdAt: vieja },
  });
  await prisma.pushDelivery.create({ data: { userId: usuario, kind: "ORDER_EDIT", status: "ACEPTADO", payload: "{}" } });
  assert.equal(await push.podarEntregas(), 1);
  assert.equal(await prisma.pushDelivery.count(), 1);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --import tsx --test tests/push.test.ts`
Expected: FAIL. `push.transporte` no existe y `prisma.pushDelivery` no tiene filas porque `sendPushToUser` todavía no registra.

- [ ] **Step 3: Reescribir `lib/push.ts`**

Reemplazar el archivo entero por:

```ts
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { validPushEndpoint } from "./push-subscription";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** `high` es la prioridad máxima que admite Web Push (RFC 8030): le pide al
 *  servicio de mensajería que despierte el teléfono en vez de esperar a la
 *  próxima ventana de ahorro de energía. */
export type Urgencia = "very-low" | "low" | "normal" | "high";
export type PushOptions = { urgency?: Urgencia };

export type TipoDeAviso =
  | "ORDER_EDIT"
  | "CAMBIO_TARDIO"
  | "FALTANTE"
  | "PEDIDO_VACIO"
  | "SISTEMA"
  | "SUGERENCIA"
  | "PRUEBA";

/** Para qué es un envío. Queda en el registro. */
export type Meta = { kind: TipoDeAviso; notificationId?: string | null };

export type EstadoDeEntrega = "ACEPTADO" | "CADUCADO" | "RECHAZADO" | "ERROR";

/** Un reintento solo dentro de esta ventana: un aviso de hace horas ya no sirve. */
const VENTANA_REINTENTO_MIN = 60;

let configurado: boolean | null = null;

/**
 * El envío de verdad, aparte para que las pruebas lo reemplacen.
 *
 * Es un objeto y no dos funciones sueltas para poder pisar sus métodos desde
 * afuera: una función importada no se puede reasignar, una propiedad sí.
 */
export const transporte = {
  listo(): boolean {
    if (configurado !== null) return configurado;
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@didier.local";
    if (!pub || !priv) return (configurado = false);
    webpush.setVapidDetails(subject, pub, priv);
    return (configurado = true);
  },
  async enviar(
    destino: { endpoint: string; keys: { p256dh: string; auth: string } },
    cuerpo: string,
    urgency: Urgencia,
  ): Promise<{ statusCode: number }> {
    const r = await webpush.sendNotification(destino, cuerpo, { urgency, TTL: 60 * 60 * 12, timeout: 10_000 });
    return { statusCode: r.statusCode };
  },
};

/**
 * Qué significa la respuesta del servicio de push.
 *
 * `null` es que no hubo respuesta (red, tiempo agotado): como un 5xx, puede
 * andar en un rato. 404/410 es que el teléfono dio de baja la suscripción. El
 * resto de los 4xx no se arregla reintentando: claves mal, payload muy grande.
 */
export function clasificar(statusCode: number | null): { status: EstadoDeEntrega; reintentable: boolean } {
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) return { status: "ACEPTADO", reintentable: false };
  if (statusCode === 404 || statusCode === 410) return { status: "CADUCADO", reintentable: false };
  if (statusCode === null || statusCode === 429 || statusCode >= 500) return { status: "ERROR", reintentable: true };
  return { status: "RECHAZADO", reintentable: false };
}

type Suscripcion = { id: string; userId: string; endpoint: string; p256dh: string; auth: string };

/**
 * Manda un push a UN dispositivo y deja escrito qué pasó. Nunca lanza.
 *
 * El id de la entrega viaja dentro del push (`d`): el service worker lo devuelve
 * cuando la persona lo toca, y así se sabe que se abrió. Lo que se guarda en
 * `payload` va SIN esa marca, para que un reintento tenga la suya.
 */
export async function enviarASuscripcion(
  sub: Suscripcion,
  payload: PushPayload,
  meta: Meta,
  urgency: Urgencia = "normal",
  attempt = 1,
): Promise<{ id: string; status: EstadoDeEntrega; error: string | null }> {
  const id = randomUUID();
  let statusCode: number | null = null;
  let error: string | null = null;
  let resultado: { status: EstadoDeEntrega; reintentable: boolean };

  if (!transporte.listo()) {
    // Antes esto volvía sin hacer nada y sin dejar rastro.
    resultado = { status: "ERROR", reintentable: false };
    error = "sin claves";
  } else if (!validPushEndpoint(sub.endpoint)) {
    resultado = { status: "RECHAZADO", reintentable: false };
    error = "endpoint no permitido";
  } else {
    try {
      const r = await transporte.enviar(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ ...payload, d: id }),
        urgency,
      );
      statusCode = r.statusCode;
    } catch (e) {
      const code = (e as { statusCode?: unknown })?.statusCode;
      statusCode = typeof code === "number" ? code : null;
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    resultado = clasificar(statusCode);
  }

  try {
    await prisma.pushDelivery.create({
      data: {
        id,
        notificationId: meta.notificationId ?? null,
        userId: sub.userId,
        subscriptionId: sub.id,
        kind: meta.kind,
        status: resultado.status,
        statusCode,
        error,
        attempt,
        reintentable: resultado.reintentable,
        payload: JSON.stringify(payload),
        urgency,
      },
    });
    if (resultado.status === "CADUCADO") {
      // App desinstalada o permiso revocado: el dispositivo ya no existe.
      await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
    } else {
      await prisma.pushSubscription.updateMany({
        where: { id: sub.id },
        data: resultado.status === "ACEPTADO" ? { lastOkAt: new Date() } : { lastErrorAt: new Date() },
      });
    }
  } catch {
    // Que no se pueda registrar no puede cortar el envío al resto.
  }
  return { id, status: resultado.status, error };
}

/**
 * Manda un push a todos los dispositivos de una persona. Nunca lanza.
 *
 * Que no lance es parte del contrato: si falla el push de una persona, los del
 * resto tienen que salir igual. Devuelve cuántos dispositivos lo aceptaron, que
 * es lo único que dice si "se mandó".
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  meta: Meta,
  options: PushOptions = {},
): Promise<{ intentos: number; aceptados: number }> {
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const r = await Promise.all(subs.map((s) => enviarASuscripcion(s, payload, meta, options.urgency ?? "normal")));
    return { intentos: r.length, aceptados: r.filter((x) => x.status === "ACEPTADO").length };
  } catch {
    return { intentos: 0, aceptados: 0 };
  }
}

/**
 * Un segundo intento para lo que falló por algo pasajero. Corre en el barrido
 * de cada minuto. Una sola vez por envío: si vuelve a fallar, queda registrado
 * y se ve en Dispositivos.
 */
export async function reintentarFallidos(ahora = new Date()): Promise<number> {
  try {
    const desde = new Date(ahora.getTime() - VENTANA_REINTENTO_MIN * 60_000);
    const fallidos = await prisma.pushDelivery.findMany({
      where: { status: "ERROR", reintentable: true, attempt: 1, retriedAt: null, createdAt: { gte: desde } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    let n = 0;
    for (const f of fallidos) {
      // Se marca ANTES de reenviar: si el barrido se corta a la mitad, el
      // siguiente no lo manda dos veces.
      const marcado = await prisma.pushDelivery.updateMany({
        where: { id: f.id, retriedAt: null },
        data: { retriedAt: ahora },
      });
      if (marcado.count === 0 || !f.subscriptionId) continue;
      const sub = await prisma.pushSubscription.findUnique({ where: { id: f.subscriptionId } });
      if (!sub) continue;
      await enviarASuscripcion(
        sub,
        JSON.parse(f.payload) as PushPayload,
        { kind: f.kind as TipoDeAviso, notificationId: f.notificationId },
        f.urgency as Urgencia,
        2,
      );
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** La persona tocó el push: queda la hora y el aviso pasa a leído. Solo el
 *  destinatario puede marcar el suyo. */
export async function registrarApertura(userId: string, deliveryId: string): Promise<boolean> {
  const d = await prisma.pushDelivery.findFirst({ where: { id: deliveryId, userId } });
  if (!d) return false;
  if (!d.openedAt) await prisma.pushDelivery.update({ where: { id: d.id }, data: { openedAt: new Date() } });
  if (d.notificationId) {
    await prisma.notification.updateMany({ where: { id: d.notificationId, recipientId: userId }, data: { read: true } });
  }
  return true;
}

/** "Probar en este teléfono": un push solo a ESTE dispositivo de ESTA persona. */
export async function enviarPrueba(userId: string, endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const sub = await prisma.pushSubscription.findFirst({ where: { endpoint, userId } });
  if (!sub) {
    return { ok: false, error: "Este teléfono no está anotado a tu nombre. Desactivá los avisos y volvé a activarlos." };
  }
  const r = await enviarASuscripcion(
    sub,
    {
      title: "Didier Stamatti",
      body: "Prueba: si ves esto, los avisos llegan a este teléfono.",
      url: "/notificaciones",
      tag: "prueba",
    },
    { kind: "PRUEBA" },
    "high",
  );
  if (r.status === "ACEPTADO") return { ok: true };
  if (r.error === "sin claves") return { ok: false, error: "Faltan las claves de avisos en el servidor. Avisale a la administradora." };
  if (r.status === "CADUCADO") return { ok: false, error: "El servicio de avisos dio de baja este teléfono. Volvé a activar los avisos." };
  return { ok: false, error: "El servicio de avisos no aceptó el envío. Probá de nuevo en un rato." };
}

/** El registro se guarda 60 días: alcanza para diagnosticar y no crece sin fin. */
export async function podarEntregas(ahora = new Date(), dias = 60): Promise<number> {
  const corte = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  const r = await prisma.pushDelivery.deleteMany({ where: { createdAt: { lt: corte } } });
  return r.count;
}
```

- [ ] **Step 4: Actualizar las cinco llamadas a la firma nueva**

`lib/notify.ts`, dentro de `flushPendingOrderPushes` (la Task 4 la reescribe entera; acá solo tiene que compilar):

```ts
          await sendPushToUser(
            n.recipientId,
            {
              title: "Didier Stamatti",
              body: n.message,
              url: `/aviso/${n.id}`,
              tag: `order-${n.eventId ?? n.id}`,
            },
            { kind: "ORDER_EDIT", notificationId: n.id },
            { urgency: isPriorityRecipient(n.role) ? "high" : "normal" }
          );
```

`lib/pedido-vacio.ts`: guardar el aviso creado y pasarle el id.

```ts
        const aviso = await prisma.notification.create({
          data: {
            recipientId: u.id,
            actorName: "Sistema",
            type: etiqueta,
            message: mensaje,
            eventId: a.id,
            linkUrl: `/evento/${a.id}`,
            // El push sale acá mismo, así que queda marcado como enviado. Sin
            // esto la fila queda para siempre como "pendiente de envío" y el
            // dato miente sobre lo que realmente pasó.
            pushedAt: new Date(),
          },
        });
        await sendPushToUser(
          u.id,
          { title: "Falta armar un pedido", body: mensaje, url: `/evento/${a.id}`, tag: `pedido-vacio-${a.id}` },
          { kind: "PEDIDO_VACIO", notificationId: aviso.id },
        );
```

`lib/healthcheck.ts`, en `runHealthCheck`. Además, el aviso del sistema pasa a llevar a `/notificaciones`: sin `linkUrl` abría "Qué cambió", con un texto que habla de pedidos.

```ts
      const aviso = await prisma.notification.create({
        // El push sale acá mismo: la fila nace marcada como enviada. Sin esto
        // quedaba para siempre como "pendiente", mintiendo sobre lo que pasó.
        // `linkUrl`: sin él, tocarlo abría "Qué cambió", que es de pedidos.
        data: { recipientId: admin.id, actorName: "Sistema", type: signature, message, pushedAt: new Date(), linkUrl: "/notificaciones" },
      });
      await sendPushToUser(
        admin.id,
        { title: "Didier Stamatti", body: message, url: "/notificaciones", tag: "sistema" },
        { kind: "SISTEMA", notificationId: aviso.id },
      );
```

`app/actions/suggestions.ts`, en `avisarALaAdministradora`:

```ts
        const aviso = await prisma.notification.create({
          data: {
            recipientId: a.id,
            actorName: autor,
            type: "SUGERENCIA",
            message,
            linkUrl: url,
            // Ya sale el push acá mismo: marcarlo evita que el barrido de
            // pedidos lo vuelva a tomar y lo mande dos veces.
            pushedAt: new Date(),
          },
        });
        await sendPushToUser(
          a.id,
          { title: "Didier Stamatti", body: message, url, tag: `sugerencia-${suggestionId}` },
          { kind: "SUGERENCIA", notificationId: aviso.id },
        );
```

`app/actions/suggestions.ts`, en la respuesta a una sugerencia:

```ts
    const aviso = await prisma.notification.create({
      data: {
        recipientId: sug.authorId,
        actorName: guard.user.name,
        type: "SUGERENCIA",
        message: `${guard.user.name} respondió tu sugerencia: ${sug.title}`,
        linkUrl: `/sugerencias/${id}`,
        pushedAt: new Date(),
      },
    });
    await sendPushToUser(
      sug.authorId,
      { title: "Didier Stamatti", body: `Te respondieron la sugerencia: ${sug.title}`, url: `/sugerencias/${id}`, tag: `sugerencia-${id}` },
      { kind: "SUGERENCIA", notificationId: aviso.id },
    );
```

- [ ] **Step 5: Correr las pruebas nuevas y el typecheck**

Run: `node --import tsx --test tests/push.test.ts` y después `npx tsc --noEmit`
Expected: `ℹ pass 14`, `ℹ fail 0`; el typecheck sin salida.

- [ ] **Step 6: Correr la suite entera**

Run: `npm test`
Expected: pasan todas menos dos de `tests/notifications.test.ts`: "pasados los 5 minutos de quietud sale un push por persona" y "un aviso ya leído en la app no hace sonar el teléfono". Es esperable. Esas pruebas cuentan push enviados, la base que usan no tiene dispositivos, y desde esta tarea solo cuenta lo aceptado. Lo arregla la Task 4. **Anotarlo y seguir.** Ninguna otra prueba puede fallar.

- [ ] **Step 7: Commit**

```bash
git add lib/push.ts lib/notify.ts lib/pedido-vacio.ts lib/healthcheck.ts app/actions/suggestions.ts tests/push.test.ts
git commit -m "Avisos: cada push queda registrado con su resultado, y se reintenta una vez"
```

---

### Task 3: El texto del push dice qué cambió (`lib/aviso-texto.ts`, puro)

**Files:**
- Create: `lib/aviso-texto.ts`
- Test: `tests/aviso-texto.test.ts`

**Interfaces:**
- Produces:
  - `type Cambio = { itemName: string; kind: string; before: string | null; after: string | null }`
  - `consolidarCambios(cambios: Cambio[]): Cambio[]`
  - `describirCambio(c: Cambio): string`
  - `textoDePush(lugar: string, actorName: string, cambios: Cambio[]): { title: string; body: string } | null`. Devuelve `null` si los cambios se compensan.

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/aviso-texto.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidarCambios, describirCambio, textoDePush, type Cambio } from "../lib/aviso-texto";

/**
 * El texto del push: lo que el depósito tiene que hacer, no cuántas veces se
 * tocó algo. Enrique ajusta y reajusta (10→12, 12→24): al depósito le importa
 * que quedó en 24.
 */

const c = (itemName: string, kind: string, before: string | null, after: string | null): Cambio => ({ itemName, kind, before, after });

test("dos cambios de cantidad del mismo ítem son uno solo, de punta a punta", () => {
  assert.deepEqual(consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "CANTIDAD", "12", "24")]), [
    c("Copa", "CANTIDAD", "10", "24"),
  ]);
});

test("agregar y después sacar lo mismo no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Hielo", "AGREGADO", null, "20"), c("Hielo", "QUITADO", "20", null)]), []);
});

test("subir y volver a la cantidad original no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Copa", "CANTIDAD", "10", "12"), c("Copa", "CANTIDAD", "12", "10")]), []);
});

test("sacar y volver a agregar con otra cantidad es un cambio de cantidad", () => {
  assert.deepEqual(consolidarCambios([c("Brasero", "QUITADO", "3", null), c("Brasero", "AGREGADO", null, "5")]), [
    c("Brasero", "CANTIDAD", "3", "5"),
  ]);
});

test("agregar y después cambiar la cantidad es un agregado con la cantidad final", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "AGREGADO", null, "4"), c("Mantel", "CANTIDAD", "4", "6")]), [
    c("Mantel", "AGREGADO", null, "6"),
  ]);
});

test("una nota que vuelve a ser la de antes no deja nada", () => {
  assert.deepEqual(consolidarCambios([c("Mantel", "NOTA", null, "largos"), c("Mantel", "NOTA", "largos", null)]), []);
});

test("se respeta el orden en que aparece cada ítem", () => {
  const r = consolidarCambios([c("B", "AGREGADO", null, "1"), c("A", "AGREGADO", null, "1"), c("B", "CANTIDAD", "1", "2")]);
  assert.deepEqual(r.map((x) => x.itemName), ["B", "A"]);
});

test("cómo se describe cada clase de cambio", () => {
  assert.equal(describirCambio(c("Copa de agua", "CANTIDAD", "10", "24")), "Copa de agua 10→24");
  assert.equal(describirCambio(c("Servilletas", "AGREGADO", null, "50")), "Servilletas +50");
  assert.equal(describirCambio(c("Brasero", "QUITADO", "3", null)), "Brasero quitado");
  assert.equal(describirCambio(c("Mantel", "NOTA", null, "los largos")), 'Mantel: nota "los largos"');
  assert.equal(describirCambio(c("Mantel", "NOTA", "los largos", null)), "Mantel: nota borrada");
  assert.equal(describirCambio(c("Responsable de la fiesta", "RESPONSABLE", null, "Pablo")), "Responsable: Pablo");
  assert.equal(describirCambio(c("Evento", "FECHA", "sáb 24/10", "dom 25/10")), "Fecha: dom 25/10");
});

test("el push: lugar de título, tres cambios, cuántos más y quién", () => {
  const t = textoDePush("El Carmen Center", "Enrique", [
    c("Copa de agua", "CANTIDAD", "10", "24"),
    c("Servilletas", "AGREGADO", null, "50"),
    c("Brasero", "QUITADO", "3", null),
    c("Mantel", "NOTA", "", "los largos"),
    c("Hielo", "AGREGADO", null, "20"),
  ]);
  assert.deepEqual(t, {
    title: "El Carmen Center",
    body: "Copa de agua 10→24 · Servilletas +50 · Brasero quitado · y 2 más\n— Enrique",
  });
});

test("si todo se compensó, no hay push", () => {
  assert.equal(textoDePush("X", "Enrique", [c("Hielo", "AGREGADO", null, "20"), c("Hielo", "QUITADO", "20", null)]), null);
});

test("el cuerpo nunca pasa de 500 caracteres", () => {
  const largo = "x".repeat(400);
  const t = textoDePush("X", "Enrique", [c(largo, "AGREGADO", null, "1"), c(largo + "y", "AGREGADO", null, "1")]);
  assert.ok(t && t.body.length <= 500);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --import tsx --test tests/aviso-texto.test.ts`
Expected: FAIL con `Cannot find module '../lib/aviso-texto'`.

- [ ] **Step 3: Escribir `lib/aviso-texto.ts`**

```ts
// El texto del push de cambios de pedido, en un solo lugar y sin dependencias.
//
// Hasta el 19/10/2026 el push decía "Enrique hizo 7 cambios en el pedido de X".
// El que prepara tenía que abrir la app y buscar a ojo qué se tocó. Ahora dice
// qué cambió, neto: si una cantidad pasó de 10 a 12 y de 12 a 24, dice 10→24.

export type Cambio = { itemName: string; kind: string; before: string | null; after: string | null };

const DE_CANTIDAD = new Set(["AGREGADO", "QUITADO", "CANTIDAD"]);
const MAX_EN_EL_PUSH = 3;
const MAX_CUERPO = 500;

/**
 * Junta los cambios de cada ítem en uno solo, del primer "antes" al último
 * "después". Lo que terminó igual que como empezó desaparece: al depósito no
 * le cambia nada.
 *
 * Las cantidades se agrupan por ítem (agregar, sacar y cambiar son la misma
 * cosa vista desde el depósito), las notas también, y los datos del evento
 * (fecha, lugar, responsable...) por tipo.
 */
export function consolidarCambios(cambios: Cambio[]): Cambio[] {
  const grupos = new Map<string, { primero: Cambio; ultimo: Cambio }>();
  for (const cambio of cambios) {
    const clave = DE_CANTIDAD.has(cambio.kind)
      ? `Q:${cambio.itemName}`
      : cambio.kind === "NOTA"
        ? `N:${cambio.itemName}`
        : `O:${cambio.kind}`;
    const g = grupos.get(clave);
    if (g) g.ultimo = cambio;
    else grupos.set(clave, { primero: cambio, ultimo: cambio });
  }

  const netos: Cambio[] = [];
  for (const [clave, { primero, ultimo }] of grupos) {
    const before = primero.before ?? null;
    const after = ultimo.after ?? null;
    const itemName = primero.itemName;
    if (clave.startsWith("Q:")) {
      if (before === null && after === null) continue; // se agregó y se sacó
      if (before === null) netos.push({ itemName, kind: "AGREGADO", before: null, after });
      else if (after === null) netos.push({ itemName, kind: "QUITADO", before, after: null });
      else if (before !== after) netos.push({ itemName, kind: "CANTIDAD", before, after });
    } else if (clave.startsWith("N:")) {
      if ((before ?? "") !== (after ?? "")) netos.push({ itemName, kind: "NOTA", before, after });
    } else if (ultimo.kind === "COPIADO" || before !== after) {
      netos.push({ ...ultimo, before });
    }
  }
  return netos;
}

function recortar(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Un cambio en pocas palabras, como lo leería el que prepara. */
export function describirCambio(c: Cambio): string {
  switch (c.kind) {
    case "CANTIDAD":
      return `${c.itemName} ${c.before}→${c.after}`;
    case "AGREGADO":
      return `${c.itemName} +${c.after}`;
    case "QUITADO":
      return `${c.itemName} quitado`;
    case "NOTA":
      return c.after ? `${c.itemName}: nota "${recortar(c.after, 40)}"` : `${c.itemName}: nota borrada`;
    case "COPIADO":
      return c.after ?? "Pedido copiado de otro evento";
    case "RESPONSABLE":
      return `Responsable: ${c.after ?? "sin responsable"}`;
    case "LUGAR":
      return `Lugar: ${c.after}`;
    case "FECHA":
      return `Fecha: ${c.after}`;
    case "INVITADOS":
      return `Invitados: ${c.after}`;
    case "PERIODO":
      return `Período: ${c.after}`;
    default:
      return c.itemName;
  }
}

/**
 * Título y cuerpo del push de una tanda de cambios. `null` si los cambios se
 * compensaron: no hay nada que hacer en el depósito y el teléfono no suena.
 */
export function textoDePush(
  lugar: string,
  actorName: string,
  cambios: Cambio[],
): { title: string; body: string } | null {
  const netos = consolidarCambios(cambios);
  if (netos.length === 0) return null;
  const visibles = netos.slice(0, MAX_EN_EL_PUSH).map(describirCambio).join(" · ");
  const resto = netos.length > MAX_EN_EL_PUSH ? ` · y ${netos.length - MAX_EN_EL_PUSH} más` : "";
  const pie = `\n— ${actorName}`;
  return { title: lugar, body: recortar(visibles + resto, MAX_CUERPO - pie.length) + pie };
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --import tsx --test tests/aviso-texto.test.ts`
Expected: `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/aviso-texto.ts tests/aviso-texto.test.ts
git commit -m "Avisos: el texto del push dice que cambio, neto"
```

---

### Task 4: El barrido usa el texto nuevo, sale a los 2 minutos y reintenta; "Qué cambió" acotado a su tanda

**Files:**
- Modify: `lib/notify.ts` (constante `QUIET_MINUTES`, función nueva `cambiosDeLaTanda`, `flushPendingOrderPushes` entera)
- Modify: `app/(app)/aviso/[id]/page.tsx:52-58`
- Modify: `instrumentation.ts` (log del barrido y poda diaria)
- Test: `tests/notifications.test.ts`

**Interfaces:**
- Consumes: `sendPushToUser`, `reintentarFallidos`, `podarEntregas`, `transporte` (Task 2); `textoDePush` (Task 3).
- Produces:
  - `cambiosDeLaTanda(aviso: { eventId: string | null; actorName: string; sinceAt: Date; createdAt: Date }): Promise<OrderChange[]>`
  - `flushPendingOrderPushes(): Promise<{ enviados: number; cerrados: number; reintentos: number }>`. `enviados` cuenta los avisos que **algún** dispositivo aceptó.

- [ ] **Step 1: Ajustar el armado de `tests/notifications.test.ts` y escribir las pruebas nuevas**

En el `before(...)`, después de `notify = await import("../lib/notify");`:

```ts
  // El envío real se reemplaza: el barrido cuenta lo que ACEPTA el servicio de
  // push, así que estas pruebas necesitan dispositivos y un transporte que acepte.
  const push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (_destino, cuerpo) => {
    enviadosAlTelefono.push(JSON.parse(cuerpo));
    return { statusCode: 201 };
  };
```

Agregar arriba, junto a las otras variables del archivo:

```ts
const enviadosAlTelefono: { title: string; body: string; url?: string }[] = [];
```

Al final del `before(...)`, después de armar `ids`:

```ts
  for (const [userId, sufijo] of [[logistica.id, "pablo"], [armador.id, "enrique"]] as const) {
    await prisma.pushSubscription.create({
      data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/${sufijo}`, p256dh: "k", auth: "a" },
    });
  }
```

Reemplazar el título de la prueba `"pasados los 5 minutos de quietud sale un push por persona"` por `"pasados los 2 minutos de quietud sale un push por persona"`, y en ella `pasaronMinutos(6)` por `pasaronMinutos(3)`.

Inmediatamente después de esa prueba, agregar:

```ts
test("el push dice qué cambió, no cuántas veces se tocó", () => {
  // La tanda tiene 5 cambios: los 4 de "cuatro cambios seguidos" más el Hielo
  // que suma la prueba de "un usuario con un rol retirado".
  const ultimo = enviadosAlTelefono.at(-1)!;
  assert.equal(ultimo.title, "El Carmen Center");
  assert.equal(ultimo.body, "Copa de agua 10→24 · Servilletas +50 · Brasero quitado · y 2 más\n— Ana");
});
```

Inmediatamente después de `"un cambio posterior abre tanda nueva en vez de colarse en la ya avisada"`, agregar:

```ts
test("'Qué cambió' de una tanda vieja no muestra los cambios de la siguiente", async () => {
  // `avisos` ordena del más nuevo al más viejo: [tanda nueva, tanda vieja].
  const [, vieja] = await avisos(ids.logistica);
  const cambios = await notify.cambiosDeLaTanda(vieja);
  assert.equal(cambios.length, 5, "se coló el cambio de la tanda nueva");
  assert.equal(cambios.some((x) => x.itemName === "Fuente"), false);
});
```

Al final del archivo, antes de `"un evento que no existe no rompe el guardado del pedido"`, agregar:

```ts
test("si los cambios se compensaron, el teléfono no suena", async () => {
  await limpiar();
  const antes = enviadosAlTelefono.length;
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Hielo", kind: "AGREGADO", before: null, after: "20" });
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Hielo", kind: "QUITADO", before: "20", after: null });
  await pasaronMinutos(3);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.cerrados, 2, "las tandas se cierran igual");
  assert.equal(r.enviados, 0);
  assert.equal(enviadosAlTelefono.length, antes);
});
```

- [ ] **Step 2: Correr y verificar que fallan las nuevas**

Run: `node --import tsx --test tests/notifications.test.ts`
Expected: FAIL. `"pasados los 2 minutos"` da 0, porque con 3 minutos y quietud de 5 todavía no sale. `"el push dice qué cambió"` y `"'Qué cambió'..."` fallan porque `notify.cambiosDeLaTanda` no existe.

- [ ] **Step 3: Cambiar `lib/notify.ts`**

Imports, arriba del archivo:

```ts
import { prisma } from "@/lib/db";
import { reintentarFallidos, sendPushToUser } from "@/lib/push";
import { textoDePush } from "@/lib/aviso-texto";
import { ROLES, isPriorityRecipient, sortByNotificationPriority } from "@/lib/permissions";
```

La constante:

```ts
// Mientras la persona sigue editando, los cambios se van sumando a un mismo
// aviso. El push al celular NO sale con cada cambio: sale uno solo cuando pasa
// este rato sin que nadie toque nada, o sea cuando terminó de editar.
//
// Eran 5 minutos hasta el 19/10/2026. Se sentía lento y parecía que el aviso no
// llegaba; con 2 sigue juntando la tanda de quien carga varias cosas seguidas.
const QUIET_MINUTES = 2;
```

Agregar la función nueva, arriba de `flushPendingOrderPushes`:

```ts
/**
 * Los cambios de UNA tanda: desde que arrancó (`sinceAt`) hasta su última
 * actividad (`createdAt`), sobre ese pedido y de esa persona.
 *
 * El tope de arriba es el arreglo: sin él, el resumen de una tanda vieja
 * mostraba también los cambios de las tandas siguientes de la misma persona.
 */
export async function cambiosDeLaTanda(aviso: {
  eventId: string | null;
  actorName: string;
  sinceAt: Date;
  createdAt: Date;
}) {
  if (!aviso.eventId) return [];
  return prisma.orderChange.findMany({
    where: {
      eventId: aviso.eventId,
      actorName: aviso.actorName,
      createdAt: { gte: aviso.sinceAt, lte: aviso.createdAt },
    },
    orderBy: { createdAt: "asc" },
  });
}
```

Reemplazar `flushPendingOrderPushes` entera por:

```ts
/** Manda el push de los avisos cuya edición ya se quedó quieta, y reintenta lo
 *  que falló por algo pasajero en el barrido anterior. Corre cada un minuto
 *  desde `instrumentation.ts`. Nunca lanza. */
export async function flushPendingOrderPushes(): Promise<{ enviados: number; cerrados: number; reintentos: number }> {
  try {
    const reintentos = await reintentarFallidos();
    const cutoff = new Date(Date.now() - QUIET_MINUTES * 60 * 1000);
    const pendientesCrudos = await prisma.notification.findMany({
      where: { type: "ORDER_EDIT", pushedAt: null, createdAt: { lte: cutoff } },
      take: 100,
      orderBy: { createdAt: "asc" },
      include: { recipient: { select: { role: true } } },
    });

    // Los prioritarios salen primero de la cola.
    const pendientes = sortByNotificationPriority(
      pendientesCrudos.map((n) => ({ ...n, role: n.recipient.role }))
    );

    let enviados = 0;
    for (const n of pendientes) {
      // Si ya lo vio en la app, no tiene sentido hacerle sonar el teléfono.
      if (!n.read) {
        try {
          const ev = n.eventId
            ? await prisma.event.findUnique({ where: { id: n.eventId }, select: { lugar: true } })
            : null;
          const texto = textoDePush(ev?.lugar ?? "Pedido", n.actorName, await cambiosDeLaTanda(n));
          // `null`: los cambios se compensaron. En el depósito no hay nada que
          // hacer, así que el teléfono no suena; el aviso queda en la app.
          if (texto) {
            const r = await sendPushToUser(
              n.recipientId,
              { title: texto.title, body: texto.body, url: `/aviso/${n.id}`, tag: `order-${n.eventId ?? n.id}` },
              { kind: "ORDER_EDIT", notificationId: n.id },
              { urgency: isPriorityRecipient(n.role) ? "high" : "normal" }
            );
            if (r.aceptados > 0) enviados++;
          }
        } catch {
          // se sigue con el resto
        }
      }
      // Se cierra la tanda aunque el push haya fallado: el aviso ya está en la
      // app, y el reintento de un fallo pasajero lo hace `reintentarFallidos`.
      await prisma.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } }).catch(() => {});
    }
    return { enviados, cerrados: pendientes.length, reintentos };
  } catch {
    return { enviados: 0, cerrados: 0, reintentos: 0 };
  }
}
```

- [ ] **Step 4: "Qué cambió" usa la tanda acotada**

En `app/(app)/aviso/[id]/page.tsx`, agregar el import:

```ts
import { cambiosDeLaTanda } from "@/lib/notify";
```

y reemplazar el bloque `const cambios = aviso.eventId ? await prisma.orderChange.findMany({...}) : [];` por:

```ts
  // Los cambios de ESTA tanda y no los de las siguientes: ver cambiosDeLaTanda.
  const cambios = await cambiosDeLaTanda(aviso);
```

- [ ] **Step 5: Log del barrido y poda diaria en `instrumentation.ts`**

Reemplazar el cuerpo de `flush`:

```ts
  const flush = async () => {
    const { enviados, cerrados, reintentos } = await flushPendingOrderPushes();
    if (cerrados > 0 || reintentos > 0) {
      console.log(`[avisos] tandas cerradas: ${cerrados} · aceptados: ${enviados} · reintentos: ${reintentos}`);
    }
  };
```

En `vaciar`, a continuación de `vaciarPapelera()` y adentro del mismo `try`:

```ts
      // El registro de envíos se guarda 60 días. Va acá porque es una limpieza
      // diaria por fecha, igual que la papelera.
      const { podarEntregas } = await import("@/lib/push");
      const podadas = await podarEntregas();
      if (podadas > 0) console.log(`[avisos] registro podado: ${podadas} envíos de más de 60 días`);
```

- [ ] **Step 6: Correr las pruebas de avisos y la suite**

Run: `node --import tsx --test tests/notifications.test.ts` y después `npm test`
Expected: todas en verde, incluida la que la Task 2 dejó anotada.

- [ ] **Step 7: Commit**

```bash
git add lib/notify.ts "app/(app)/aviso/[id]/page.tsx" instrumentation.ts tests/notifications.test.ts
git commit -m "Avisos: salen a los 2 minutos, dicen que cambio y Que cambio no mezcla tandas"
```

---

### Task 5: Rutas para abrir y renovar, `userAgent`, y "Probar en este teléfono" del lado del servidor

**Files:**
- Create: `app/api/notifications/abierto/route.ts`
- Create: `app/api/notifications/clave/route.ts`
- Modify: `app/api/notifications/subscribe/route.ts` (el `upsert`)
- Modify: `app/actions/notifications.ts`
- Test: `tests/avisos-guardas.test.ts`

**Interfaces:**
- Consumes: `registrarApertura`, `enviarPrueba` (Task 2); `mismoOrigen` (`lib/mismo-origen.ts`, ya existe).
- Produces:
  - `POST /api/notifications/abierto` con cuerpo `{ d: string }`, que responde `{ ok: boolean }`.
  - `GET /api/notifications/clave`, que responde `{ clave: string }`.
  - La server action `probarEsteDispositivo(endpoint: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Escribir la prueba que falla**

`tests/avisos-guardas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardas de las rutas y acciones de avisos, sobre el texto de los archivos.
 *
 * Las rutas leen la sesión de las cookies y no corren fuera de Next. Lo que se
 * fija acá es el orden: primero el origen, después la sesión, después escribir.
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

test("abrir un aviso exige mismo origen y sesión, y marca solo lo propio", () => {
  const s = fuente("app/api/notifications/abierto/route.ts");
  const origen = s.indexOf("mismoOrigen(");
  const sesion = s.indexOf("getSessionUser(");
  const escritura = s.indexOf("registrarApertura(");
  assert.ok(origen > -1 && sesion > origen && escritura > sesion, "el orden tiene que ser origen, sesión, escritura");
  assert.match(s, /registrarApertura\(user\.id,/, "tiene que marcar con el id de la sesión, no con uno que mande el cliente");
});

test("la suscripción guarda de qué navegador viene", () => {
  assert.match(fuente("app/api/notifications/subscribe/route.ts"), /user-agent/);
});

test("probar un teléfono exige sesión y prueba solo los propios", () => {
  const s = fuente("app/actions/notifications.ts");
  const cuerpo = s.slice(s.indexOf("export async function probarEsteDispositivo"));
  assert.ok(cuerpo.indexOf("getSessionUser(") < cuerpo.indexOf("enviarPrueba("));
  assert.match(cuerpo, /enviarPrueba\(user\.id,/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/avisos-guardas.test.ts`
Expected: FAIL con `no se encontró app/api/notifications/abierto/route.ts`.

- [ ] **Step 3: Crear `app/api/notifications/abierto/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { mismoOrigen } from "@/lib/mismo-origen";
import { registrarApertura } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El service worker avisa que la persona tocó un push.
 *
 * Sirve para dos cosas: saber que el aviso llegó Y se abrió, que es lo que el
 * registro no puede saber solo, y dejarlo leído. Antes, abrir el push de un
 * pedido vacío o de una sugerencia dejaba el contador encendido.
 */
export async function POST(req: Request) {
  if (!mismoOrigen(req.headers)) return NextResponse.json({ ok: false }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { d?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof body.d !== "string" || body.d.length === 0 || body.d.length > 64) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const ok = await registrarApertura(user.id, body.d);
  return NextResponse.json({ ok });
}
```

- [ ] **Step 4: Crear `app/api/notifications/clave/route.ts`**

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * La clave pública de avisos, para que el service worker pueda renovar la
 * suscripción solo cuando el navegador la cambia (`pushsubscriptionchange`).
 * Es pública por definición: no lleva sesión.
 */
export async function GET() {
  return NextResponse.json({ clave: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "" });
}
```

- [ ] **Step 5: Guardar el `userAgent` al suscribir**

En `app/api/notifications/subscribe/route.ts`, en el `POST`, reemplazar el `upsert` por:

```ts
  // De qué navegador viene, para mostrarlo en Dispositivos. Se renueva en cada
  // apertura de la app (PushSubscriptionSync).
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh, auth, userAgent },
    create: { userId: user.id, endpoint, p256dh, auth, userAgent },
  });
```

- [ ] **Step 6: La acción `probarEsteDispositivo`**

En `app/actions/notifications.ts`, agregar el import y la función:

```ts
import { enviarPrueba } from "@/lib/push";

/** "Probar en este teléfono": manda un push solo a este dispositivo, que tiene
 *  que estar anotado a nombre de quien lo pide. */
export async function probarEsteDispositivo(endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Tenés que iniciar sesión." };
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2048) {
    return { ok: false, error: "No se reconoce este teléfono." };
  }
  return enviarPrueba(user.id, endpoint);
}
```

- [ ] **Step 7: Correr las pruebas y el typecheck**

Run: `node --import tsx --test tests/avisos-guardas.test.ts` y después `npx tsc --noEmit`
Expected: `ℹ pass 3`; el typecheck sin salida.

- [ ] **Step 8: Commit**

```bash
git add app/api/notifications/abierto app/api/notifications/clave app/api/notifications/subscribe/route.ts app/actions/notifications.ts tests/avisos-guardas.test.ts
git commit -m "Avisos: saber cuando se abre, renovar la clave y probar un telefono"
```

---

### Task 6: El teléfono: service worker, registro desde cualquier pantalla, cerrar sesión y botón de prueba

**Files:**
- Modify: `public/sw.js` (los manejadores `push` y `notificationclick`, y uno nuevo, `pushsubscriptionchange`)
- Modify: `components/PushSubscriptionSync.tsx`
- Create: `components/CerrarSesion.tsx`
- Modify: `components/Sidebar.tsx:107-114`, `app/(app)/cuenta/page.tsx:47-55`
- Modify: `components/EnableNotifications.tsx`
- Test: `tests/sw.test.ts`

**Interfaces:**
- Consumes: `POST /api/notifications/abierto`, `GET /api/notifications/clave`, `POST|DELETE /api/notifications/subscribe` (Task 5), `probarEsteDispositivo` (Task 5), `intentar` (`lib/actualizacion.ts`, ya existe), `logout` (`app/actions/auth.ts`, ya existe).
- Produces: `CerrarSesion({ variante }: { variante: "icono" | "boton" })`.

- [ ] **Step 1: Escribir la prueba del service worker que falla**

`tests/sw.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * El service worker, corrido en una caja de arena con un `self` falso.
 *
 * Es el único código de la app que corre cuando la app está cerrada, y un
 * error acá no se ve en ninguna pantalla: el teléfono simplemente deja de
 * avisar. Por eso se prueba igual que el resto.
 */

type Manejador = (evento: Record<string, unknown>) => void;

function cargarSW() {
  const manejadores: Record<string, Manejador> = {};
  const pedidos: { url: string; init?: { method?: string; body?: string } }[] = [];
  const mostradas: { titulo: string; opciones: { data: { url: string; d?: string } } }[] = [];
  const navegadas: string[] = [];
  const self = {
    addEventListener: (tipo: string, fn: Manejador) => (manejadores[tipo] = fn),
    skipWaiting: () => {},
    location: { origin: "https://app.test" },
    registration: {
      showNotification: async (titulo: string, opciones: { data: { url: string; d?: string } }) => {
        mostradas.push({ titulo, opciones });
      },
      pushManager: {
        subscribe: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/nueva", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/nueva" }) }),
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [{ focus: async () => {}, navigate: async (u: string) => { navegadas.push(u); } }],
      openWindow: async (u: string) => { navegadas.push(u); },
    },
  };
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    pedidos.push({ url, init });
    return { json: async () => ({ clave: "BClave" }) };
  };
  const codigo = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(codigo, { self, fetch, caches: { keys: async () => [], match: async () => undefined, open: async () => ({ put: async () => {} }), delete: async () => true }, URL });
  return { manejadores, pedidos, mostradas, navegadas };
}

async function disparar(m: Manejador, evento: Record<string, unknown>) {
  const promesas: Promise<unknown>[] = [];
  m({ ...evento, waitUntil: (p: Promise<unknown>) => promesas.push(p) });
  await Promise.all(promesas);
}

test("el push guarda la marca de entrega para cuando lo toquen", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.push, { data: { json: () => ({ title: "El Carmen", body: "Copa 10→24", url: "/aviso/1", d: "ent-1" }) } });
  assert.equal(sw.mostradas[0].titulo, "El Carmen");
  assert.equal(sw.mostradas[0].opciones.data.d, "ent-1");
  assert.equal(sw.mostradas[0].opciones.data.url, "/aviso/1");
});

test("tocar el aviso avisa que se abrió y lleva a su pantalla", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.notificationclick, { notification: { close: () => {}, data: { url: "/aviso/1", d: "ent-1" } } });
  const abierto = sw.pedidos.find((p) => p.url === "/api/notifications/abierto");
  assert.ok(abierto, "no avisó que se abrió");
  assert.equal(abierto.init?.method, "POST");
  assert.deepEqual(JSON.parse(abierto.init?.body ?? "{}"), { d: "ent-1" });
  assert.deepEqual(sw.navegadas, ["/aviso/1"]);
});

test("un aviso sin marca igual abre, sin avisar nada", async () => {
  const sw = cargarSW();
  await disparar(sw.manejadores.notificationclick, { notification: { close: () => {}, data: { url: "/notificaciones" } } });
  assert.equal(sw.pedidos.length, 0);
  assert.deepEqual(sw.navegadas, ["/notificaciones"]);
});

test("si el navegador cambia la suscripción, se vuelve a anotar sola", async () => {
  const sw = cargarSW();
  assert.ok(sw.manejadores.pushsubscriptionchange, "no maneja pushsubscriptionchange");
  await disparar(sw.manejadores.pushsubscriptionchange, { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/vieja", options: {} } });
  const alta = sw.pedidos.find((p) => p.url === "/api/notifications/subscribe" && p.init?.method === "POST");
  const baja = sw.pedidos.find((p) => p.url === "/api/notifications/subscribe" && p.init?.method === "DELETE");
  assert.ok(alta, "no anotó la suscripción nueva");
  assert.match(alta.init?.body ?? "", /nueva/);
  assert.ok(baja, "no dio de baja la vieja");
  assert.match(baja.init?.body ?? "", /vieja/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/sw.test.ts`
Expected: FAIL. `data.d` es `undefined`, no hay pedido a `/api/notifications/abierto` y `pushsubscriptionchange` no está.

- [ ] **Step 3: Cambiar `public/sw.js`**

Reemplazar los manejadores `push` y `notificationclick` (todo desde `self.addEventListener("push"` hasta el final del archivo) por:

```js
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Didier Stamatti";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    lang: "es-AR",
    tag: data.tag || undefined, // mismo evento => reemplaza el aviso anterior en el celular
    renotify: Boolean(data.tag),
    // `d` es la marca de esta entrega: se devuelve al tocarla.
    data: { url: data.url || "/notificaciones", d: data.d || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const datos = event.notification.data || {};
  const url = datos.url || "/";
  event.waitUntil(
    (async () => {
      if (datos.d) {
        // Que quede registrado que se abrió, y el aviso leído. Si falla, se
        // abre igual: no saberlo no puede impedir llegar a la pantalla.
        await fetch("/api/notifications/abierto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ d: datos.d }),
        }).catch(() => {});
      }
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of list) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })()
  );
});

// El navegador puede cambiar la suscripción por su cuenta (rotación de claves,
// limpieza). Sin esto el teléfono quedaba mudo sin que nadie lo supiera, hasta
// que la persona volviera a tocar "Activar notificaciones".
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const vieja = event.oldSubscription || null;
        let clave = vieja && vieja.options && vieja.options.applicationServerKey;
        if (!clave) {
          const r = await fetch("/api/notifications/clave");
          clave = (await r.json()).clave;
        }
        if (!clave) return;
        const nueva =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave }));
        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nueva.toJSON()),
        });
        if (vieja && vieja.endpoint !== nueva.endpoint) {
          await fetch("/api/notifications/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: vieja.endpoint }),
          });
        }
      } catch (_) {
        // Si no se pudo, queda como antes: la persona lo ve en "Probar en este teléfono".
      }
    })()
  );
});
```

- [ ] **Step 4: Correr la prueba del service worker**

Run: `node --import tsx --test tests/sw.test.ts`
Expected: `ℹ pass 4`.

- [ ] **Step 5: `PushSubscriptionSync` registra el service worker desde cualquier pantalla**

En `components/PushSubscriptionSync.tsx`, reemplazar el bloque `try { ... }` del efecto por:

```ts
      try {
        if (!("serviceWorker" in navigator)) return;
        // Se registra desde cualquier pantalla, no solo desde Avisos: hasta el
        // 19/10/2026 un teléfono que nunca abría Avisos no tenía el service
        // worker al día, y sin él no hay push ni renovación de la suscripción.
        const reg =
          (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
        if (cancelado) return;
        if (!("PushManager" in window) || !("Notification" in window)) return;
        if (Notification.permission !== "granted") return;

        const sub = await reg.pushManager.getSubscription();
        if (!sub || cancelado) return;

        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch {
        // Que no se pueda resincronizar nunca puede romper la pantalla.
      }
```

- [ ] **Step 6: Crear `components/CerrarSesion.tsx`**

```tsx
"use client";

import { logout } from "@/app/actions/auth";

/**
 * Antes de cerrar la sesión, desanota este teléfono de los avisos.
 *
 * Sin esto el teléfono seguía recibiendo los avisos de quien salió, con nombres
 * de eventos, hasta que entrara otra persona. Se borra la anotación en el
 * servidor pero NO la suscripción del navegador: si después entra otra persona
 * en este teléfono, PushSubscriptionSync la anota a su nombre y no tiene que
 * volver a activar nada.
 */
async function desanotarEsteTelefono(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/notifications/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Si no se pudo, se cierra la sesión igual.
  }
}

const IconoSalir = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M15 12H4M8 8l-4 4 4 4" />
    <path d="M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
  </svg>
);

export function CerrarSesion({ variante }: { variante: "icono" | "boton" }) {
  return (
    <form
      action={async () => {
        await desanotarEsteTelefono();
        await logout();
      }}
    >
      {variante === "icono" ? (
        <button type="submit" className="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">
          {IconoSalir}
        </button>
      ) : (
        <button type="submit" className="btn btn-del">
          {IconoSalir}
          Cerrar sesión
        </button>
      )}
    </form>
  );
}
```

- [ ] **Step 7: Usarlo en la barra lateral y en Cuenta**

En `components/Sidebar.tsx`, borrar `import { logout } from "@/app/actions/auth";`, agregar `import { CerrarSesion } from "@/components/CerrarSesion";`, y reemplazar todo el `<form action={logout}>...</form>` por:

```tsx
        <CerrarSesion variante="icono" />
```

En `app/(app)/cuenta/page.tsx`, borrar `import { logout } from "@/app/actions/auth";`, agregar `import { CerrarSesion } from "@/components/CerrarSesion";`, y reemplazar todo el `<form action={logout}>...</form>` por:

```tsx
          <CerrarSesion variante="boton" />
```

- [ ] **Step 8: El botón "Probar en este teléfono"**

En `components/EnableNotifications.tsx`, agregar los imports:

```ts
import { probarEsteDispositivo } from "@/app/actions/notifications";
import { intentar } from "@/lib/actualizacion";
```

Agregar el estado, debajo de `const [error, setError] = ...`:

```ts
  const [prueba, setPrueba] = useState<string | null>(null);
```

Agregar la función, debajo de `disable()`:

```ts
  async function probar() {
    setPrueba("Mandando…");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return setPrueba("Este teléfono no tiene los avisos activados.");
      const r = await intentar(() => probarEsteDispositivo(sub.endpoint));
      setPrueba(
        r.ok
          ? "Enviado: tiene que sonar en unos segundos. Si no suena, revisá el ahorro de batería del teléfono."
          : r.error ?? "No se pudo probar.",
      );
    } catch {
      setPrueba("No se pudo probar.");
    }
  }
```

Reemplazar la rama `state === "enabled"` del JSX por:

```tsx
      {state === "enabled" ? (
        <>
          <span className="notif-enable-ok">🔔 Notificaciones activadas en este dispositivo</span>
          <button className="btn ghost" onClick={probar}>Probar en este teléfono</button>
          <button className="btn ghost" onClick={disable}>Desactivar</button>
          {prueba && <span className="notif-enable-note">{prueba}</span>}
        </>
      ) : state === "denied" ? (
```

- [ ] **Step 9: Typecheck, lint y suite**

Run: `npx tsc --noEmit`, después `npx eslint` y después `npm test`
Expected: el typecheck sin salida; el lint con 0 errores y 0 advertencias; todas las pruebas en verde.

- [ ] **Step 10: Commit**

```bash
git add public/sw.js components/PushSubscriptionSync.tsx components/CerrarSesion.tsx components/Sidebar.tsx "app/(app)/cuenta/page.tsx" components/EnableNotifications.tsx tests/sw.test.ts
git commit -m "Avisos: el telefono avisa que abrio, se renueva solo y se desanota al salir"
```

---

### Task 7: Borrar un usuario borra sus dispositivos; "Para revisar" vuelve a tener links

**Files:**
- Modify: `app/actions/users.ts:107-110` (la transacción de `deleteUser`)
- Modify: `lib/healthcheck.ts` (tipo `HealthProblem`, función nueva `agruparHallazgos`, y `collectProblems`)
- Test: `tests/avisos-guardas.test.ts` (se suma una prueba), `tests/aviso-urgente.test.ts` (se suman dos)

**Interfaces:**
- Produces:
  - `HealthProblem = { code: string; message: string; gravedad: Gravedad; url?: string }`
  - `agruparHallazgos(hallazgos: { code: string; message: string; gravedad: Gravedad; url?: string }[]): HealthProblem[]`

- [ ] **Step 1: Escribir las pruebas que fallan**

Al final de `tests/avisos-guardas.test.ts`:

```ts
test("borrar un usuario borra sus dispositivos en la misma transacción", () => {
  const s = fuente("app/actions/users.ts");
  const cuerpo = s.slice(s.indexOf("export async function deleteUser"));
  const transaccion = cuerpo.slice(cuerpo.indexOf("$transaction("), cuerpo.indexOf("revalidatePath"));
  assert.match(transaccion, /pushSubscription\.deleteMany\(\{ where: \{ userId \} \}\)/);
});
```

En `tests/aviso-urgente.test.ts`, agregar `agruparHallazgos` al import desde `../lib/healthcheck` y estas dos pruebas al final:

```ts
test("al agrupar se conserva el link del primer hallazgo", () => {
  const r = agruparHallazgos([
    { code: "evento-sin-invitados", message: "La Pachita no tiene invitados", gravedad: "media", url: "/evento/1" },
    { code: "evento-sin-invitados", message: "Hípico no tiene invitados", gravedad: "media", url: "/evento/2" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, "/evento/1");
  assert.match(r[0].message, /^2 avisos: La Pachita/);
});

test("un hallazgo sin link sigue sin link", () => {
  const [r] = agruparHallazgos([{ code: "x", message: "m", gravedad: "media" }]);
  assert.equal(r.url, undefined);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --import tsx --test tests/avisos-guardas.test.ts tests/aviso-urgente.test.ts`
Expected: FAIL. No hay `pushSubscription.deleteMany` y `agruparHallazgos` no existe.

- [ ] **Step 3: `deleteUser` borra los dispositivos**

En `app/actions/users.ts`, la transacción queda:

```ts
  // Los movimientos de stock guardan quién los hizo; al borrar el usuario,
  // se desvinculan (quedan en el historial sin nombre) en vez de bloquear el borrado.
  // Sus dispositivos se van con él: si no, el teléfono de alguien que ya no
  // está seguiría anotado y contando como "dispositivo sin dueño".
  await prisma.$transaction([
    prisma.stockMovement.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
```

- [ ] **Step 4: `agruparHallazgos` en `lib/healthcheck.ts`**

El tipo:

```ts
export type HealthProblem = { code: string; message: string; gravedad: Gravedad; url?: string };
```

Agregar la función, arriba de `collectProblems`:

```ts
/**
 * Junta los hallazgos por código: tres eventos con el mismo problema son un
 * solo renglón. Conserva el link del primero.
 *
 * Antes el agrupado descartaba el link y "Para revisar" mostraba todo como
 * texto suelto, sin forma de ir a arreglarlo.
 */
export function agruparHallazgos(
  hallazgos: { code: string; message: string; gravedad: Gravedad; url?: string }[],
): HealthProblem[] {
  const porCodigo = new Map<string, { mensajes: string[]; gravedad: Gravedad; url?: string }>();
  for (const h of hallazgos) {
    const previo = porCodigo.get(h.code);
    if (previo) previo.mensajes.push(h.message);
    else porCodigo.set(h.code, { mensajes: [h.message], gravedad: h.gravedad, url: h.url });
  }
  return [...porCodigo].map(([code, { mensajes, gravedad, url }]) => ({
    code,
    gravedad,
    url,
    message: mensajes.length === 1 ? mensajes[0] : `${mensajes.length} avisos: ${mensajes[0]} (y ${mensajes.length - 1} más)`,
  }));
}
```

En `collectProblems`, reemplazar lo que hay adentro del `try` del bloque de controles por:

```ts
    const { revisarTodo } = await import("@/lib/checks");
    base.push(...agruparHallazgos(await revisarTodo()));
```

- [ ] **Step 5: Correr las pruebas, el typecheck y la suite**

Run: `node --import tsx --test tests/avisos-guardas.test.ts tests/aviso-urgente.test.ts`, después `npx tsc --noEmit` y después `npm test`
Expected: todas en verde.

- [ ] **Step 6: Commit**

```bash
git add app/actions/users.ts lib/healthcheck.ts tests/avisos-guardas.test.ts tests/aviso-urgente.test.ts
git commit -m "Avisos: borrar un usuario borra sus dispositivos, y Para revisar vuelve a tener links"
```

---

### Task 8: Pantalla "Dispositivos" para la administradora

**Files:**
- Create: `lib/dispositivos.ts`
- Create: `app/(app)/dispositivos/page.tsx`
- Modify: `components/Sidebar.tsx` (`ADMIN_NAV`)
- Modify: `app/(app)/notificaciones/page.tsx`
- Modify: `app/globals.css` (una regla al final)
- Test: `tests/dispositivos.test.ts`

**Interfaces:**
- Consumes: `PushDelivery` y los campos de `PushSubscription` (Task 1), `deviceSummary` (`lib/suggestions.ts`, ya existe y es puro), `ROLES`, `ROLE_LABEL` y `canManageUsers` (`lib/permissions.ts`), `fmtMomento` (`lib/dates.ts`).
- Produces:
  - `FALLOS_PARA_ALARMA = 3`
  - `noLeLlega(ultimos: { status: string }[]): boolean`, con los últimos envíos del más nuevo al más viejo
  - `type DispositivoVista = { id: string; descripcion: string; alta: Date; lastOkAt: Date | null; lastErrorAt: Date | null; noLeLlega: boolean }`
  - `type PersonaVista = { id: string; name: string; role: string; dispositivos: DispositivoVista[] }`
  - `estadoDeDispositivos(): Promise<PersonaVista[]>`, con primero quien no tiene dispositivos, después quien tiene alguno al que no le llega, y después el resto por nombre

- [ ] **Step 1: Escribir las pruebas que fallan**

`tests/dispositivos.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";

/**
 * A quién le llegan los avisos y a quién no.
 *
 * Al 18/10/2026 Aldana no tenía ningún dispositivo y nadie lo sabía: los
 * avisos de seis semanas se perdieron sin que ninguna pantalla lo dijera.
 */

const base = crearBaseDescartable("dispositivos");
let prisma: typeof import("../lib/db").prisma;
let disp: typeof import("../lib/dispositivos");

before(async () => {
  ({ prisma } = await import("../lib/db"));
  disp = await import("../lib/dispositivos");
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

test("noLeLlega: tres fracasos seguidos sí, dos no, y uno bueno lo corta", () => {
  const f = { status: "ERROR" };
  const ok = { status: "ACEPTADO" };
  assert.equal(disp.noLeLlega([f, f, f]), true);
  assert.equal(disp.noLeLlega([f, f]), false);
  assert.equal(disp.noLeLlega([ok, f, f]), false);
  assert.equal(disp.noLeLlega([]), false);
});

test("primero quien no tiene ningún teléfono, después a quien no le llega, después el resto", async () => {
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name}@t.local`, role, passwordHash: "x" } });
  const aldana = await mk("Aldana", "ARMADOR");
  const pablo = await mk("Pablo", "LOGISTICA");
  const enrique = await mk("Enrique", "ARMADOR");
  await mk("Contable", "PAGOS"); // rol retirado: no aparece

  const subPablo = await prisma.pushSubscription.create({
    data: {
      userId: pablo.id,
      endpoint: "https://fcm.googleapis.com/fcm/send/p",
      p256dh: "k",
      auth: "a",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130",
    },
  });
  const subEnrique = await prisma.pushSubscription.create({
    data: { userId: enrique.id, endpoint: "https://fcm.googleapis.com/fcm/send/e", p256dh: "k", auth: "a" },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.pushDelivery.create({
      data: { userId: pablo.id, subscriptionId: subPablo.id, kind: "ORDER_EDIT", status: "ERROR", payload: "{}" },
    });
  }
  await prisma.pushDelivery.create({
    data: { userId: enrique.id, subscriptionId: subEnrique.id, kind: "ORDER_EDIT", status: "ACEPTADO", payload: "{}" },
  });

  const r = await disp.estadoDeDispositivos();
  assert.deepEqual(r.map((p) => p.name), ["Aldana", "Pablo", "Enrique"]);
  assert.equal(r[0].dispositivos.length, 0);
  assert.equal(r[1].dispositivos[0].noLeLlega, true);
  assert.equal(r[1].dispositivos[0].descripcion, "Chrome · Android");
  assert.equal(r[2].dispositivos[0].noLeLlega, false);
  assert.equal(r[2].dispositivos[0].descripcion, "Desconocido", "sin userAgent todavía");
  assert.equal(r.some((p) => p.id === aldana.id), true);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --import tsx --test tests/dispositivos.test.ts`
Expected: FAIL con `Cannot find module '../lib/dispositivos'`.

- [ ] **Step 3: Recordar el formato de `deviceSummary` (no se toca)**

Devuelve `` `${nav} · ${so}` `` (navegador primero), con el modelo entre paréntesis cuando un Android lo informa: `Chrome · Android (SM-A145M)`. Verificado el 19/10/2026. La prueba de arriba espera `"Chrome · Android"` porque su `userAgent` no trae modelo.

- [ ] **Step 4: Escribir `lib/dispositivos.ts`**

```ts
import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/permissions";
import { deviceSummary } from "@/lib/suggestions";

// A quién le llegan los avisos y a quién no, para la pantalla Dispositivos.
//
// Hasta el 19/10/2026 un push que fallaba no dejaba rastro: del 07/09 al 19/10
// ningún teléfono pudo activar los avisos, y al 18/10 Aldana no tenía ningún
// dispositivo. Nada lo mostraba.

/** Con cuántos fracasos seguidos se da por hecho que a un teléfono no le llega. */
export const FALLOS_PARA_ALARMA = 3;

/** `ultimos` va del más nuevo al más viejo. Uno aceptado en el medio alcanza
 *  para decir que llega: los fracasos sueltos son ruido de la red. */
export function noLeLlega(ultimos: { status: string }[]): boolean {
  if (ultimos.length < FALLOS_PARA_ALARMA) return false;
  return ultimos.slice(0, FALLOS_PARA_ALARMA).every((e) => e.status !== "ACEPTADO");
}

export type DispositivoVista = {
  id: string;
  descripcion: string;
  alta: Date;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  noLeLlega: boolean;
};

export type PersonaVista = { id: string; name: string; role: string; dispositivos: DispositivoVista[] };

/** Cada persona con un rol vigente y sus dispositivos. Arriba, lo que hay que
 *  resolver: quien no tiene ninguno, y quien tiene uno al que no le llega. */
export async function estadoDeDispositivos(): Promise<PersonaVista[]> {
  const usuarios = await prisma.user.findMany({
    where: { role: { in: [...ROLES] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: usuarios.map((u) => u.id) } },
    orderBy: { createdAt: "asc" },
  });

  const personas: PersonaVista[] = [];
  for (const u of usuarios) {
    const dispositivos: DispositivoVista[] = [];
    for (const s of subs.filter((x) => x.userId === u.id)) {
      const ultimos = await prisma.pushDelivery.findMany({
        where: { subscriptionId: s.id },
        orderBy: { createdAt: "desc" },
        take: FALLOS_PARA_ALARMA,
        select: { status: true },
      });
      dispositivos.push({
        id: s.id,
        descripcion: deviceSummary(s.userAgent ?? ""),
        alta: s.createdAt,
        lastOkAt: s.lastOkAt,
        lastErrorAt: s.lastErrorAt,
        noLeLlega: noLeLlega(ultimos),
      });
    }
    personas.push({ ...u, dispositivos });
  }

  const urgencia = (p: PersonaVista) =>
    p.dispositivos.length === 0 ? 0 : p.dispositivos.some((d) => d.noLeLlega) ? 1 : 2;
  return personas.sort((a, b) => urgencia(a) - urgencia(b) || a.name.localeCompare(b.name, "es"));
}
```

- [ ] **Step 5: Correr la prueba**

Run: `node --import tsx --test tests/dispositivos.test.ts`
Expected: `ℹ pass 2`.

- [ ] **Step 6: La pantalla `app/(app)/dispositivos/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canManageUsers, ROLE_LABEL } from "@/lib/permissions";
import { estadoDeDispositivos } from "@/lib/dispositivos";
import { fmtMomento } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function DispositivosPage() {
  // Como el resto: la pantalla comprueba su propio permiso, no se apoya en que
  // no haya un enlace.
  const sesion = await getSessionUser();
  if (!sesion || !canManageUsers(sesion.role)) notFound();

  const personas = await estadoDeDispositivos();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dispositivos</h1>
          <div className="sub">A quién le llegan los avisos, y a quién no</div>
        </div>
      </div>
      <div className="content">
        <div className="disp-lista">
          {personas.map((p) => (
            <section key={p.id} className="settings-card">
              <h2>
                {p.name} <span className="count-pill">{ROLE_LABEL[p.role] ?? p.role}</span>
              </h2>
              {p.dispositivos.length === 0 ? (
                <p className="disp-alarma">
                  Ningún teléfono: no le llega ningún aviso. Tiene que entrar a Avisos y tocar “Activar notificaciones”.
                </p>
              ) : (
                <ul className="revision-list">
                  {p.dispositivos.map((d) => (
                    <li key={d.id} className={`revision-item${d.noLeLlega ? " grav-alta disp-alarma" : ""}`}>
                      <b>{d.descripcion}</b> · activado {fmtMomento(d.alta)} ·{" "}
                      {d.lastOkAt ? `último aviso que llegó: ${fmtMomento(d.lastOkAt)}` : "todavía no le llegó ninguno"}
                      {d.lastErrorAt ? ` · último error: ${fmtMomento(d.lastErrorAt)}` : ""}
                      {d.noLeLlega ? " · NO LE LLEGA: fallaron los últimos 3 envíos" : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 7: Estilo, acceso desde el menú y desde Avisos**

Al final de `app/globals.css`:

```css
/* Dispositivos: lo que hay que resolver se lee en rojo, no solo con un punto. */
.disp-lista{display:flex; flex-direction:column; gap:var(--sp-4)}
.disp-alarma{color:var(--crit); font-weight:600}
```

En `components/Sidebar.tsx`, `ADMIN_NAV` queda:

```ts
const ADMIN_NAV = [
  { href: "/sugerencias", label: "Sugerencias", icon: IconSuggest },
  { href: "/dispositivos", label: "Dispositivos", icon: ICONS.avisos },
  { href: "/usuarios", label: "Usuarios", icon: ICONS.usuarios },
];
```

En `app/(app)/notificaciones/page.tsx`, agregar `import Link from "next/link";` y `import { canManageUsers, canSeeChecks } from "@/lib/permissions";` (reemplaza el import de `canSeeChecks`). Debajo de `<EnableNotifications />` agregar:

```tsx
        {/* En el celular la barra lateral no existe: desde acá se llega igual. */}
        {canManageUsers(user.role) && (
          <p className="notif-enable-note">
            <Link href="/dispositivos">Ver a quién le llegan los avisos →</Link>
          </p>
        )}
```

- [ ] **Step 8: Typecheck, lint, suite y compilación**

Run: `npx tsc --noEmit`, después `npx eslint`, después `npm test` y después `npm run build`
Expected: el typecheck sin salida; el lint con 0 problemas; todo en verde; la compilación con `/dispositivos` en la lista de rutas.

- [ ] **Step 9: Commit**

```bash
git add lib/dispositivos.ts "app/(app)/dispositivos" components/Sidebar.tsx "app/(app)/notificaciones/page.tsx" app/globals.css tests/dispositivos.test.ts
git commit -m "Avisos: pantalla Dispositivos, a quien le llegan y a quien no"
```

---

### Task 9: Revisión del diff entero contra la especificación

**Files:** ninguno nuevo, salvo lo que esta revisión obligue a corregir.

- [ ] **Step 1: Leer el diff completo de la etapa**

Run: `git diff main --stat` y después `git diff main -- lib app components public instrumentation.ts`
Lo que hay que buscar a ojo: llamadas a `sendPushToUser` con la firma vieja (3 argumentos sin `kind`), paréntesis o argumentos de más, `console.log` olvidados y comentarios que mientan. **El 19/10 un reemplazo masivo pasó el typecheck en un archivo y rompió argumentos en otro: el diff se lee entero.**

- [ ] **Step 2: Recorrer la sección "Etapa 1" de la spec, punto por punto**

Para cada viñeta de la spec, anotar la tarea que la cubre. Si alguna no tiene tarea, agregar el cambio con su prueba antes de seguir.

- [ ] **Step 3: Commit, solo si hubo correcciones**

```bash
git add -A
git commit -m "Avisos: correcciones de la revision de la etapa 1"
```

---

### Task 10: Verificación con datos reales y deploy (con OK del usuario)

**Files:** ninguno.

- [ ] **Step 1: Suite, lint y compilación desde cero**

```bash
rm -rf .next
npm test
npx eslint
npm run build
```

Expected: todo en verde y 0 problemas.

- [ ] **Step 2: Copia de producción, sin suscripciones**

Los scripts van en una carpeta fuera del repo (`$V`). Las credenciales de S3 las inyecta `railway run` y **no se imprimen nunca**.

```bash
V="$TEMP/verif-etapa-1"; mkdir -p "$V"
cat > "$V/bajar.mjs" <<'EOF'
// Baja la copia más nueva del stock (solo lectura).
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require = createRequire(process.cwd() + "/package.json");
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const e = process.env;
const c = new S3Client({ endpoint: e.BACKUP_S3_ENDPOINT, region: e.BACKUP_S3_REGION || "auto",
  credentials: { accessKeyId: e.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: e.BACKUP_S3_SECRET_ACCESS_KEY } });
const l = await c.send(new ListObjectsV2Command({ Bucket: e.BACKUP_S3_BUCKET, Prefix: "backups/" }));
const o = (l.Contents ?? []).sort((a, b) => b.LastModified - a.LastModified)[0];
const r = await c.send(new GetObjectCommand({ Bucket: e.BACKUP_S3_BUCKET, Key: o.Key }));
await writeFile(process.argv[2], Buffer.from(await r.Body.transformToByteArray()));
console.log("copia:", o.Key);
EOF
railway run -s didier-catering node "$V/bajar.mjs" "$V/copia.db"
DATABASE_URL="file:$V/copia.db" npx prisma migrate deploy
node -e "const D=require('better-sqlite3');const d=new D(process.argv[1]);console.log('suscripciones borradas de la copia:',d.prepare('delete from PushSubscription').run().changes)" "$V/copia.db"
```

Expected: `copia: backups/dev-....db`, se aplica `20261020120000_registro_de_avisos` y se borran las suscripciones de **la copia**. **Sin esto, el barrido que corre al arrancar podría mandarle un push a un teléfono real.**

- [ ] **Step 3: Levantar la app local sobre la copia y recorrerla**

```bash
export AUTH_SECRET="secreto-descartable-solo-para-verificar-la-etapa-1"
cat > "$V/token.mts" <<'EOF'
// Firma una sesión para el ADMIN de la copia con el secreto descartable.
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
const d = new Database(process.argv[2], { readonly: true });
const u = d.prepare("select id, name, email, role, passwordHash from User where role='ADMIN' limit 1").get();
const m = await import(pathToFileURL(process.cwd() + "/lib/session-token.ts").href);
process.stdout.write(await m.issueSessionToken(u, false));
EOF
TOKEN=$(node --import tsx "$V/token.mts" "$V/copia.db")
(DATABASE_URL="file:$V/copia.db" VAPID_PRIVATE_KEY="" NEXT_PUBLIC_VAPID_PUBLIC_KEY="" VAPID_SUBJECT="" npx next start -p 3060 > "$V/server.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3060/login && break; sleep 1; done
for p in / /notificaciones /dispositivos; do echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: didier_session=$TOKEN" http://localhost:3060$p)"; done
curl -s -H "Cookie: didier_session=$TOKEN" http://localhost:3060/dispositivos | grep -o "Ningún teléfono" | head -1
grep -iE "error|unhandled" "$V/server.log" | head
```

Expected: las tres rutas dan `200`, aparece `Ningún teléfono` (con la copia sin suscripciones, todos quedan sin dispositivos), y el log no tiene errores. Al terminar, detener el servidor del puerto 3060.

- [ ] **Step 4: Pedir el OK del usuario para desplegar**

Mostrar el resumen de lo hecho, cómo quedó verificado y qué falta verificar en vivo. **No desplegar sin un sí explícito.**

- [ ] **Step 5: Desplegar y verificar en producción (solo con el OK)**

```bash
git checkout main && git merge --ff-only pieza-3-deposito && git push origin main
```

Seguir el deploy con `railway deployment list -s didier-catering --json` hasta `SUCCESS`. En los logs (`railway logs -s didier-catering --deployment`), comprobar:

- se aplicó `20261020120000_registro_de_avisos`;
- arrancó sin errores;
- `[backup] ok`.

Probar `POST /api/notifications/abierto` sin sesión y con el mismo origen: tiene que dar **401**, no 403.

- [ ] **Step 6: Lo que tiene que hacer cada persona (se le pasa al usuario)**

Cada uno abre la app en su teléfono, entra a **Avisos**, toca **Activar notificaciones** si no las tiene y después **Probar en este teléfono**. Aldana, primero. Después, `/dispositivos` muestra a quién le llegó.

- [ ] **Step 7: Bitácora del vault**

Registrar la etapa en `00 - Inicio/Bitácora.md` del vault, con lo verificado y lo que quedó pendiente, y después commit y `git push onedrive master`.
