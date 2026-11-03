# Avisos al borrar o recuperar un período entero — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** que mandar un período a la papelera, o recuperarlo, avise a los demás igual que hoy avisa borrar o recuperar un evento suelto.

**Architecture:** se reusa el circuito del evento suelto (`notifyOrderChange` con `kind: "PAPELERA"`). Al borrar o recuperar un período, cada evento suyo que no esté borrado por su cuenta recibe el mismo cambio que si se lo hubiera borrado o recuperado solo. Así valen todas las reglas que ya existen:
- tanda de 2 minutos, y lo hecho y deshecho se cancela;
- no avisa a quien lo hizo; el depósito y logística primero;
- los eventos que ya pasaron quedan en el historial pero no avisan (`lib/notify.ts`, corte `yaPaso`);
- línea de bandeja "Enrique borró el evento X" / "recuperó el evento X";
- push "Se borró el evento (queda en la papelera hasta el lunes)".

Escrituras condicionadas: con dos teléfonos a la vez, avisa solo el que de verdad cambió la fila.

**Tech Stack:** Next.js 16 (server actions), Prisma 7 + SQLite, `node --import tsx --test`.

## Global Constraints

- Pedido del usuario (02/11): "borrar o recuperar un período entero también avise".
- Un aviso nunca dice algo que no pasó: con dos aparatos a la vez avisa solo la escritura con `count === 1`.
- Un evento borrado por su cuenta (`Event.deletedAt` puesto) no se toca ni avisa al borrar o recuperar su período: ya estaba en la papelera y sigue ahí.
- Los eventos que ya pasaron no avisan (ya lo resuelve `notifyOrderChange`); el `OrderChange` queda como historial.
- Se avisa DESPUÉS de guardar, nunca antes. Un fallo al avisar no rompe la acción (`notifyOrderChange` ya no lanza).
- Comentarios en castellano con el porqué. Archivos CRLF: herramienta Edit. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pruebas: `npm test` en verde, `npx tsc --noEmit -p .`, `npx eslint <archivos>`. No correr `npm run build`.

---

### Task 1: Borrar y recuperar un período avisan, y el detalle lo muestra en la papelera

**Files:**
- Modify: `app/actions/period.ts` (`deletePeriod` ~161, `restorePeriod` ~172, `restoreEvent` ~462)
- Create: `lib/avisos-del-periodo.ts`
- Modify: `app/(app)/aviso/[id]/page.tsx` (~80-115)
- Test: `tests/avisos-del-periodo.test.ts` (base descartable), `tests/avisos-de-estado.test.ts` (guardas de texto de las acciones)

**Interfaces:**
- Produce: `export async function avisarEventosDelPeriodo(actor: { id: string; name: string }, periodId: string, de: "VIVO" | "BORRADO", a: "VIVO" | "BORRADO"): Promise<number>` — avisa a cada evento del período con `deletedAt: null`, devuelve a cuántos. Nunca lanza.
- Consume: `notifyOrderChange(actor, eventId, { itemName: "Evento", kind: "PAPELERA", before, after })` de `lib/notify.ts`.

- [ ] **Step 1: Pruebas que fallan.** `tests/avisos-del-periodo.test.ts`, con base descartable siguiendo el armado de los tests de base que ya usan `notifyOrderChange` (buscarlos con `grep -rln "notifyOrderChange" tests/`). Un período con tres eventos: uno mañana, uno ayer y uno de mañana borrado por su cuenta.
  - `avisarEventosDelPeriodo(actor, periodo, "VIVO", "BORRADO")` devuelve 2 (no cuenta el borrado por su cuenta).
  - Deja un `OrderChange` `PAPELERA` `VIVO → BORRADO` en el de mañana y en el de ayer (historial), y ninguno en el borrado por su cuenta.
  - Crea `Notification` para los demás usuarios solo del evento de mañana (el de ayer ya pasó), con el mensaje "{actor} borró el evento {lugar}".
  - Con `"BORRADO", "VIVO"`, lo mismo con "recuperó el evento".
- [ ] **Step 2: `lib/avisos-del-periodo.ts`.**

```ts
import { prisma } from "@/lib/prisma";
import { notifyOrderChange } from "@/lib/notify";

/**
 * Borrar o recuperar un período mueve a la papelera (o saca de ella) a todos sus
 * eventos de una vez. Para quien prepara, es lo mismo que si se hubiera borrado
 * cada evento: se avisa evento por evento por el mismo camino que el evento
 * suelto, así valen sus reglas (tanda de 2 minutos, lo hecho y deshecho no
 * avisa, los eventos que ya pasaron no suenan). Los eventos borrados por su
 * cuenta no se tocan: estaban en la papelera y siguen ahí. Nunca lanza.
 */
export async function avisarEventosDelPeriodo(
  actor: { id: string; name: string },
  periodId: string,
  de: "VIVO" | "BORRADO",
  a: "VIVO" | "BORRADO",
): Promise<number> {
  try {
    const eventos = await prisma.event.findMany({ where: { periodId, deletedAt: null }, select: { id: true }, orderBy: { date: "asc" } });
    for (const e of eventos) {
      await notifyOrderChange(actor, e.id, { itemName: "Evento", kind: "PAPELERA", before: de, after: a });
    }
    return eventos.length;
  } catch (e) {
    console.error("[avisos] no se pudo avisar el período", periodId, e instanceof Error ? e.message : String(e));
    return 0;
  }
}
```

- [ ] **Step 3: `app/actions/period.ts`.**
  - `deletePeriod`: mantener la lectura ("no existe" / "ya estaba borrado"); escribir `updateMany({ where: { id: periodId, deletedAt: null }, data: { deletedAt: new Date() } })`; si `count === 1`, `await avisarEventosDelPeriodo(user, periodId, "VIVO", "BORRADO")`.
  - `restorePeriod`: leer `deletedAt`; si no estaba borrado, `{ ok: true, id }` sin avisar; escribir `updateMany({ where: { id: periodId, deletedAt: { not: null } }, data: { deletedAt: null } })`; si `count === 1`, `avisarEventosDelPeriodo(user, periodId, "BORRADO", "VIVO")`.
  - `restoreEvent`: la parte del período pasa a `updateMany({ where: { id: ev.periodId, deletedAt: { not: null } }, data: { deletedAt: null } })` dentro del mismo `$transaction`. Leer el `count` de cada parte por su posición (el evento va primero solo si estaba borrado). Si volvió el período (`count === 1`), avisar con `avisarEventosDelPeriodo(user, ev.periodId, "BORRADO", "VIVO")` — eso ya incluye al evento recuperado, así que en ese caso NO se avisa además el evento solo. Si no volvió el período, queda lo de hoy (avisa el evento si `count === 1`).
  - Comentarios con el porqué en cada una.
  - Guardas de texto en `tests/avisos-de-estado.test.ts`, en el estilo de las que ya están para `deleteEvent`/`restoreEvent`: las tres usan `updateMany` condicionado y `avisarEventosDelPeriodo` bajo `count === 1`; `restoreEvent` no llama a `notifyOrderChange` del evento cuando volvió el período.
- [ ] **Step 4: el detalle del aviso.** `app/(app)/aviso/[id]/page.tsx` (~80-115) solo mira `evento.deletedAt`. Con el período en la papelera, el evento tiene `deletedAt` nulo: el detalle no muestra el aviso de papelera y ofrece abrir el pedido de un evento que no se ve. Traer también `period: { select: { deletedAt: true } }` y tratar como "en la papelera" `evento.deletedAt || evento.period.deletedAt`, en los dos lugares (~101 y ~110). Guarda de texto.
- [ ] **Step 5:** `npx tsc --noEmit -p .`, `npx eslint` de los tocados, `npm test` (`ℹ fail 0`). **Commit:** `Avisos: borrar o recuperar un periodo entero avisa, evento por evento`.

---

## Verificación (la hace el controlador)

Sobre la copia de producción (sin suscripciones, claves de push vacías), con la app armada de cero (`rm -rf .next`):
1. Como Enrique, crear un período de mañana con dos eventos y borrar uno por su cuenta. Borrar el período: a los 2 minutos, los demás tienen "Enrique borró el evento X" solo del evento vivo; el borrado por su cuenta no avisa.
2. Recuperar el período: "recuperó el evento X". Borrarlo y recuperarlo enseguida: no aparece nada.
3. Borrar un período que ya pasó: sin avisos; el historial del evento lo registra.
4. El detalle del aviso del borrado muestra "Este evento está en la papelera".
