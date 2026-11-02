# Resumen de la mañana y avisos de cambios de estado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que nadie tenga que entrar a mirar para enterarse de lo importante: un aviso a la mañana con lo de hoy y mañana, y un aviso cuando un evento se marca listo, vuelve a borrador, se borra o se recupera.

**Architecture:** los cambios de estado entran por el mismo camino que ya usan los cambios del pedido (`notifyOrderChange` en `lib/notify.ts`): se guardan como `OrderChange` con dos tipos nuevos (`ESTADO`, `PAPELERA`), se suman a la tanda de cada destinatario, salen al celular cuando la edición se queda quieta 2 minutos, y si algo se hace y se deshace dentro de la misma tanda no se avisa (eso ya lo hace `consolidarCambios`). El resumen de la mañana es una tarea de fondo nueva, con el texto en una función pura por rol y el envío en una función de base de datos, como el aviso de pedido vacío (`lib/pedido-vacio.ts`).

**Tech Stack:** Next.js 16 (server actions, `instrumentation.ts`), Prisma 7 + SQLite, web push (`lib/push.ts`), pruebas con `node --test` + `tsx` (las de base de datos usan una base descartable, como `tests/faltantes-db.test.ts`).

## Global Constraints

- Pedido del usuario (02/11): "seguí con el resumen de la mañana y los avisos de cambios de estado".
- **Cambios de estado que avisan:** marcar un evento listo, volverlo a borrador, mandarlo a la papelera y recuperarlo. Cambiar fecha, lugar, invitados, período o responsable YA avisa (por `updateEvent` y `setEventResponsable`): no se toca.
- Los avisos de estado siguen las reglas de los cambios del pedido: a todos los roles vigentes menos quien hizo el cambio, el depósito y logística primero, una tanda por persona y evento, push cuando pasan `QUIET_MINUTES` (2) sin cambios, y lo hecho y deshecho dentro de la tanda no se avisa.
- **Resumen de la mañana:** uno por persona por día, entre las 7:00 y las 11:00 hora argentina (si el servidor arranca más tarde, ese día no sale: un "resumen de la mañana" a la tarde confunde). Solo si hay eventos hoy o mañana. Contenido por rol:
  - todos: los eventos de hoy y de mañana (hasta 3 nombres por día y "y N más") y, si hay, cuántos productos faltan en los períodos de esos eventos;
  - quien arma pedidos (`canEditOrders`): además, cuántos de esos eventos no tienen pedido y cuántos tienen pedido pero no están marcados listos;
  - la administradora (`ADMIN`): además, quiénes no tienen los avisos activados en ningún teléfono.
  - Destino al tocarlo: `/preparar` para DEPOSITO, `/` para el resto.
- Nunca lanza: una tarea de fondo que falla no puede afectar a la app.
- Textos en castellano rioplatense, cortos, sin promesas que la app no cumple. El cuerpo del push no pasa de 500 caracteres (`MAX_CUERPO` en `lib/aviso-texto.ts`).
- Archivos con CRLF: editar con la herramienta Edit. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pruebas: `npm test` en verde, `npx tsc --noEmit -p .`, `npx eslint <archivos>`.

---

### Task 1: Avisos de cambios de estado

**Files:**
- Modify: `lib/notify.ts` (tipo `ChangeKind`)
- Modify: `lib/aviso-texto.ts` (`describirCambio`)
- Modify: `app/actions/period.ts` (`setEventStatus`, `deleteEvent`, `restoreEvent`)
- Modify: `app/(app)/aviso/[id]/page.tsx` (etiquetas y clases por tipo; que abra aunque el evento esté en la papelera)
- Create: `tests/avisos-de-estado.test.ts`

**Interfaces:**
- `ChangeKind` suma `"ESTADO"` (itemName `"Estado"`, before/after `"LISTO"` | `"NO_LISTO"`) y `"PAPELERA"` (itemName `"Evento"`, before/after `"VIVO"` | `"BORRADO"`).

- [ ] **Step 1: Pruebas que fallan** (`tests/avisos-de-estado.test.ts`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { consolidarCambios, describirCambio } from "../lib/aviso-texto";

/**
 * Marcar un evento listo, volverlo a borrador, borrarlo o recuperarlo no
 * avisaba: quien prepara se enteraba entrando a mirar. Entran por el mismo
 * camino que los cambios del pedido, así heredan las reglas: a todos menos
 * quien lo hizo, una tanda por evento y lo deshecho no se avisa.
 */

const c = (kind: "ESTADO" | "PAPELERA", itemName: string, before: string, after: string) => ({ kind, itemName, before, after });

test("marcarlo listo se lee así", () => {
  assert.equal(describirCambio(c("ESTADO", "Estado", "NO_LISTO", "LISTO")), "Quedó listo");
  assert.equal(describirCambio(c("ESTADO", "Estado", "LISTO", "NO_LISTO")), "Volvió a borrador");
});

test("mandarlo a la papelera y recuperarlo se leen así", () => {
  assert.equal(describirCambio(c("PAPELERA", "Evento", "VIVO", "BORRADO")), "Se borró el evento (se puede recuperar desde la papelera)");
  assert.equal(describirCambio(c("PAPELERA", "Evento", "BORRADO", "VIVO")), "Se recuperó el evento");
});

test("listo y vuelta a borrador en la misma tanda no avisa nada", () => {
  assert.deepEqual(
    consolidarCambios([c("ESTADO", "Estado", "NO_LISTO", "LISTO"), c("ESTADO", "Estado", "LISTO", "NO_LISTO")]),
    [],
  );
});

test("borrado y recuperado en la misma tanda no avisa nada", () => {
  assert.deepEqual(
    consolidarCambios([c("PAPELERA", "Evento", "VIVO", "BORRADO"), c("PAPELERA", "Evento", "BORRADO", "VIVO")]),
    [],
  );
});

function cuerpoDe(archivo: string, funcion: string): string {
  const s = fs.readFileSync(path.join(process.cwd(), archivo), "utf8");
  const desde = s.indexOf(`export async function ${funcion}`);
  assert.notEqual(desde, -1, `no está ${funcion}`);
  const hasta = s.indexOf("\nexport ", desde + 1);
  return s.slice(desde, hasta === -1 ? undefined : hasta);
}

test("las tres acciones avisan, y después de guardar", () => {
  for (const [funcion, kind] of [["setEventStatus", "ESTADO"], ["deleteEvent", "PAPELERA"], ["restoreEvent", "PAPELERA"]] as const) {
    const cuerpo = cuerpoDe("app/actions/period.ts", funcion);
    const aviso = cuerpo.indexOf("notifyOrderChange(");
    assert.notEqual(aviso, -1, `${funcion} no avisa`);
    assert.ok(cuerpo.includes(`kind: "${kind}"`), `${funcion} no avisa con el tipo ${kind}`);
    const escritura = cuerpo.search(/prisma\.(event\.update|event\.updateMany|\$transaction)\(/);
    assert.ok(escritura !== -1 && escritura < aviso, `${funcion} avisa antes de guardar`);
  }
});
```

- [ ] **Step 2: Implementación.**
  - `lib/notify.ts`: en `ChangeKind`, después de `"PERIODO"`, con comentario: `// Estado del evento: listo o borrador, y si está en la papelera.` → `| "ESTADO" | "PAPELERA"`.
  - `lib/aviso-texto.ts`, en `describirCambio`, antes del `default`:

```ts
    case "ESTADO":
      return c.after === "LISTO" ? "Quedó listo" : "Volvió a borrador";
    case "PAPELERA":
      return c.after === "BORRADO" ? "Se borró el evento (se puede recuperar desde la papelera)" : "Se recuperó el evento";
```

  - `app/actions/period.ts`:
    - `setEventStatus`: leer el estado anterior antes de escribir (`prisma.event.findFirst({ where: { id: eventId, deletedAt: null, period: { deletedAt: null } }, select: { status: true } })`; si no está, el mismo error de hoy). Escribir como hoy. Si el estado cambió, después de escribir: `await notifyOrderChange(user, eventId, { itemName: "Estado", kind: "ESTADO", before: anterior, after: status })`.
    - `deleteEvent`: después del `update`, `await notifyOrderChange(user, eventId, { itemName: "Evento", kind: "PAPELERA", before: "VIVO", after: "BORRADO" })` (el "ya estaba borrado" de antes no avisa).
    - `restoreEvent`: leer `deletedAt` junto con lo que ya lee; si estaba borrado, después del `$transaction`: `await notifyOrderChange(user, eventId, { itemName: "Evento", kind: "PAPELERA", before: "BORRADO", after: "VIVO" })`. Si no estaba borrado, no avisa.
    - `requireManage()` ya devuelve `user` con `id` y `name` (verificarlo y usarlo como en `updateEvent`).
  - `app/(app)/aviso/[id]/page.tsx`: sumar `ESTADO: "Estado"` y `PAPELERA: "Papelera"` a las etiquetas, y `ESTADO: "ok"`, `PAPELERA: "crit"` a las clases. **Verificar** que la página abra el detalle de un aviso cuyo evento está en la papelera (hoy `notFound()` si el evento está borrado? leerla): si no abre, que muestre los cambios igual y una línea "Este evento está en la papelera." en vez de "no encontrado". Si ya abre, no tocar.

- [ ] **Step 3:** pruebas en verde, `npx tsc --noEmit -p .`, `npx eslint` de los tocados, `npm test`. **Commit** `Avisos: marcar listo, volver a borrador, borrar y recuperar un evento avisan`.

---

### Task 2: El texto del resumen de la mañana

**Files:**
- Create: `lib/resumen-manana.ts`
- Create: `tests/resumen-manana.test.ts`

**Interfaces:**

```ts
export const HORA_DESDE = 7;   // 7:00 hora argentina
export const HORA_HASTA = 11;  // después de las 11 ya no es "de la mañana"
export function esHoraDelResumen(hora: number): boolean;            // HORA_DESDE <= hora < HORA_HASTA
export type EventoDelResumen = { lugar: string; renglones: number; listo: boolean };
export type DatosDelResumen = { hoy: EventoDelResumen[]; manana: EventoDelResumen[]; faltan: number; sinAvisos: string[] };
export function textoDelResumen(rol: string, d: DatosDelResumen): { title: string; body: string; url: string } | null;
```

- [ ] **Step 1: Pruebas que fallan** (`tests/resumen-manana.test.ts`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { esHoraDelResumen, textoDelResumen, type DatosDelResumen } from "../lib/resumen-manana";

const ev = (lugar: string, renglones = 10, listo = false) => ({ lugar, renglones, listo });
const base: DatosDelResumen = { hoy: [ev("MUSEO", 41, true)], manana: [ev("PUERTO ABAJO", 0), ev("GUALEGUYCHU", 50)], faltan: 13, sinAvisos: ["Pablo"] };

test("sale entre las 7 y las 11", () => {
  assert.equal(esHoraDelResumen(6), false);
  assert.equal(esHoraDelResumen(7), true);
  assert.equal(esHoraDelResumen(10), true);
  assert.equal(esHoraDelResumen(11), false);
});

test("sin eventos hoy ni mañana no hay resumen", () => {
  assert.equal(textoDelResumen("ADMIN", { hoy: [], manana: [], faltan: 0, sinAvisos: ["Pablo"] }), null);
});

test("todos ven los eventos de hoy y de mañana y los faltantes", () => {
  const r = textoDelResumen("DEPOSITO", base)!;
  assert.match(r.body, /Hoy: MUSEO/);
  assert.match(r.body, /Mañana: PUERTO ABAJO y GUALEGUYCHU/);
  assert.match(r.body, /Faltan 13 productos/);
});

test("el depósito no ve lo de armar pedidos ni quién no tiene avisos, y va a Preparar", () => {
  const r = textoDelResumen("DEPOSITO", base)!;
  assert.doesNotMatch(r.body, /Sin pedido|Sin marcar listo|Sin avisos/);
  assert.equal(r.url, "/preparar");
});

test("quien arma pedidos ve los que no tienen pedido y los que falta marcar listos", () => {
  const r = textoDelResumen("ARMADOR", base)!;
  assert.match(r.body, /Sin pedido: 1/);
  assert.match(r.body, /Sin marcar listo: 1/);
  assert.doesNotMatch(r.body, /Sin avisos/);
  assert.equal(r.url, "/");
});

test("la administradora ve además quién no tiene los avisos activados", () => {
  assert.match(textoDelResumen("ADMIN", base)!.body, /Sin avisos en el celular: Pablo/);
});

test("más de tres eventos en un día se resumen", () => {
  const r = textoDelResumen("DEPOSITO", { ...base, hoy: [ev("A"), ev("B"), ev("C"), ev("D"), ev("E")] })!;
  assert.match(r.body, /Hoy: A, B, C y 2 más/);
});

test("un día sin eventos lo dice, si el otro tiene", () => {
  assert.match(textoDelResumen("DEPOSITO", { ...base, hoy: [] })!.body, /Hoy no hay eventos/);
});

test("el cuerpo nunca pasa de 500 caracteres", () => {
  const largo = Array.from({ length: 40 }, (_, i) => ev(`EVENTO CON UN NOMBRE MUY LARGO NÚMERO ${i}`));
  const r = textoDelResumen("ADMIN", { hoy: largo, manana: largo, faltan: 999, sinAvisos: largo.map((e) => e.lugar) })!;
  assert.ok(r.body.length <= 500);
});
```

- [ ] **Step 2: `lib/resumen-manana.ts`.** Con comentario de cabecera (qué es y por qué uno solo por día). Reglas:
  - `textoDelResumen`: `null` si `hoy` y `manana` están vacíos.
  - título: `"Hoy y mañana"`.
  - líneas, en este orden, unidas con `\n`:
    1. `Hoy: <hasta 3 nombres, separados por ", " y el último con " y ">` (con más de 3: `A, B, C y N más`), o `Hoy no hay eventos.`;
    2. lo mismo con `Mañana`;
    3. si `canEditOrders(rol)`: `Sin pedido: N` (eventos de hoy y mañana con `renglones === 0`, solo si N > 0) y `Sin marcar listo: N` (con renglones > 0 y `!listo`, solo si N > 0), en una línea separadas por ` · `;
    4. si `faltan > 0`: `Faltan <faltan> productos en el depósito.` (con `1 producto` en singular);
    5. si `rol === "ADMIN"` y hay `sinAvisos`: `Sin avisos en el celular: <nombres separados por ", ">`.
  - recortar el cuerpo con `recortar(…, MAX_CUERPO)` de `lib/aviso-texto.ts` (exportar `MAX_CUERPO` si no lo está).
  - `url`: `"/preparar"` si `rol === "DEPOSITO"`, si no `"/"`.

- [ ] **Step 3:** pruebas en verde, tsc, eslint, `npm test`. **Commit** `Resumen de la mañana: el texto por rol`.

---

### Task 3: Mandar el resumen

**Files:**
- Create: `lib/resumen-manana-db.ts`
- Modify: `lib/push.ts` (`TipoDeAviso` suma `"RESUMEN"`)
- Modify: `instrumentation.ts`
- Create: `tests/resumen-manana-db.test.ts`

**Interfaces:** `export async function enviarResumenDeLaManana(ahora = new Date()): Promise<{ enviados: number }>` — nunca lanza.

- [ ] **Step 1: Pruebas que fallan** (`tests/resumen-manana-db.test.ts`), con base descartable y el push espiado, siguiendo el armado de `tests/faltantes-db.test.ts` (leerlo primero: migración, `transporte` de `lib/push.ts` reemplazado por un espía, usuarios y suscripciones de prueba). Casos:
  - a las 6:59 hora argentina no manda nada; a las 7:05 manda uno a cada usuario con rol vigente;
  - correrlo dos veces el mismo día no manda dos (deduplica por `Notification.type = "RESUMEN:<día>"`);
  - al día siguiente vuelve a mandar;
  - a las 11:30 no manda (aunque ese día no haya salido);
  - sin eventos hoy ni mañana no manda;
  - un evento en la papelera (o de un período en la papelera) no cuenta;
  - el depósito recibe `url` `/preparar` y el armador `/`;
  - la administradora recibe "Sin avisos en el celular" con quien no tiene ninguna `PushSubscription`.

  (Instantes de prueba: usar `instanteDe(dia, "07:05")` de `lib/dates.ts`, que ya está en hora argentina.)

- [ ] **Step 2: `lib/resumen-manana-db.ts`.**
  - Si `!esHoraDelResumen(partesDe(ahora).hour)` → `{ enviados: 0 }`.
  - `hoyDia = diaDe(ahora)`, `mananaDia = sumarDias(hoyDia, 1)`.
  - Eventos vivos (`deletedAt: null`, `period: { deletedAt: null }`) con `date >= instanteDe(hoyDia, "00:00")` y `< instanteDe(sumarDias(hoyDia, 2), "00:00")`, con `lugar`, `date`, `status`, `periodId` y `_count.lines`, ordenados por fecha. Si no hay → `{ enviados: 0 }`.
  - `faltan`: suma de `(await periodShortages(periodId)).length` sobre los períodos distintos de esos eventos (`lib/shortages.ts`).
  - `sinAvisos`: nombres de los usuarios con rol vigente (`ROLES`) que no tienen ninguna `PushSubscription`.
  - Destinatarios: usuarios con rol vigente, en el orden de `sortByNotificationPriority`. Para cada uno: si ya hay una `Notification` suya con `type: "RESUMEN:" + hoyDia`, sigue; si no, arma el texto con `textoDelResumen(u.role, datos)`; si es `null`, sigue; si no, crea la `Notification` (`actorName: "Sistema"`, `type: "RESUMEN:" + hoyDia`, `message: body`, `linkUrl: url`, `pushedAt: new Date()`) y manda `sendPushToUser(u.id, { title, body, url, tag: "resumen-" + hoyDia }, { kind: "RESUMEN", notificationId: aviso.id })` con urgencia `"normal"`.
  - Todo dentro de `try/catch`: ante un error, `console.error("[resumen] …")` y devuelve lo enviado hasta ahí.
- [ ] **Step 3: `lib/push.ts`:** `TipoDeAviso` suma `| "RESUMEN"`.
- [ ] **Step 4: `instrumentation.ts`:** junto al aviso de pedido vacío, un bloque "Resumen de la mañana" que lo corre al arrancar y cada 10 minutos (`setInterval(…, 10 * MINUTE)`), con un `console.log("[resumen] enviados: N")` solo si N > 0, y un comentario: cada 10 minutos alcanza porque se manda una vez por día y la hora se controla adentro.
- [ ] **Step 5:** pruebas en verde, tsc, eslint, `npm test`. **Commit** `Resumen de la mañana: sale a las 7 una vez por persona`.

---

## Verificación (la hace el controlador)

Sobre la copia de producción, con la app local y las claves de push vacías (sin suscripciones):
1. Marcar un evento listo como Enrique: a los 2 minutos, el aviso aparece en Avisos de los demás (no en el de Enrique), con "Quedó listo". Marcarlo listo y volverlo a borrador enseguida: no aparece nada.
2. Borrar un evento y recuperarlo: los avisos correspondientes; tocar el de "se borró" abre el detalle aunque el evento esté en la papelera.
3. Correr `enviarResumenDeLaManana` con un instante de las 7:05 sobre la copia: un aviso por persona con el texto de su rol; correrlo de nuevo no duplica.
