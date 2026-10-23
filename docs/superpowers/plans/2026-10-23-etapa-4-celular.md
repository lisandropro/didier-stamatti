# Etapa 4 · Interfaz del celular — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que en un teléfono de 375×812 el editor de pedidos muestre 6 productos o más por pantalla (hoy 2), y que la portada, la vista de solo lectura y Cambios tardíos dejen de desbordar.

**Architecture:** todo se resuelve debajo de 860 px, el mismo corte que ya esconde la barra lateral. Cada pantalla conserva un solo marcado: lo que existe en un solo ancho lleva las clases `solo-ancho` o `solo-celular`, y el CSS reacomoda el resto. La lógica de qué dice cada fila sobre su stock sale del componente a `lib/fila-de-pedido.ts` para poder probarla. En la pantalla ancha cambia una sola cosa a propósito: borrar un evento deja la tarjeta de la portada y pasa al editor.

**Tech Stack:** Next.js 16 (App Router, componentes de cliente), React 19, CSS plano en `app/globals.css`, pruebas con `node --test` + `tsx`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-19-deposito-y-avisos-design.md`, sección "Etapa 4 · Interfaz del celular". Meta: **6 o más productos visibles por pantalla a 375×812**, con el pedido de 125 renglones.
- Corte del celular: `@media (max-width:860px)`; la pantalla ancha es `@media (min-width:861px)`. **Decisión sobre la spec:** la spec decía 640 px para la vista de solo lectura; se usa 860 en todo, porque entre 640 y 860 la tabla de 680 px de mínimo también desborda.
- Todo lo que se toca mide al menos `var(--tap)` (44 px).
- **La traba de lo ya preparado no se puede abrir por ningún control nuevo.** Todo control que cambie cantidad o nota pasa por `updateItem`/`stepQty` (que preguntan con `conConfirmacion`), y todo `<input>` editable de una fila lleva `readOnly={trabada}` con `onFocus` y `onPointerDown` que llaman a `setPorConfirmar`. Es la falla que se pagó en la etapa 2: un valor tecleado escondido detrás de la traba.
- Salir del editor con cambios sin guardar espera el guardado: los enlaces ya lo hacen (el `navigate` de captura); toda navegación nueva por código hace `if (await queue.flush()) router.push(...)`.
- Textos en castellano rioplatense, como el resto de la app. Comentarios en castellano, explicando el porqué.
- Archivos con CRLF: editar con la herramienta Edit, no con `sed -i`. Los archivos nuevos pueden ir con LF.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prueba completa: `npm test` (hoy 665 en verde). Tipos: `npx tsc --noEmit -p .`. Lint: `npx eslint <archivos tocados>`.

---

### Task 1: El estado de stock de una fila, fuera del componente

**Files:**
- Create: `lib/fila-de-pedido.ts`
- Create: `tests/fila-de-pedido.test.ts`
- Modify: `components/OrderBuilder.tsx` (el cálculo de `st` dentro de `visible.map`, líneas ~381-399, y la barra de la columna de stock)

**Interfaces:**
- Produces: `estadoDeStock(p: { type: string; stock: number | null; qty: number; reserved: number }): EstadoDeStock | null`, `avisosDeFila(p: { type; stock; qty; reserved; note: string; deBaja?: boolean }): AvisoDeFila[]`, `type NivelDeStock = "neutral" | "crit" | "warn" | "ok"`, `type EstadoDeStock = { cls: NivelDeStock; txt: string }`, `type AvisoDeFila = { cls: "crit" | "warn" | "neutral" | "nota"; txt: string }`. La Task 3 usa `avisosDeFila`; la constante `RELLENO` queda en `OrderBuilder.tsx`.

- [ ] **Step 1: Escribir la prueba que falla** — `tests/fila-de-pedido.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDeStock, avisosDeFila } from "../lib/fila-de-pedido";

/**
 * Lo que cada fila del armador dice de su stock.
 *
 * La pantalla ancha lo muestra como chip y barra. La fila compacta del celular
 * lo muestra como una segunda línea chica que aparece SOLO cuando hay algo que
 * decir: si cada fila dijera "Alcanza", todas medirían el doble y volverían a
 * entrar 2 productos por pantalla, que es lo que esta etapa vino a arreglar.
 */

const base = { type: "REUTILIZABLE", stock: 10, qty: 0, reserved: 0, note: "" };

test("un consumible no tiene estado de stock", () => {
  assert.equal(estadoDeStock({ ...base, type: "CONSUMIBLE", qty: 5 }), null);
});

test("sin recuento dice Sin contar, no un número inventado", () => {
  assert.deepEqual(estadoDeStock({ ...base, stock: null, qty: 4 }), { cls: "neutral", txt: "Sin contar" });
});

test("si lo que piden todos supera el stock, dice cuánto falta", () => {
  assert.deepEqual(estadoDeStock({ ...base, qty: 6, reserved: 7 }), { cls: "crit", txt: "Faltan 3" });
});

test("justo lo que hay es al límite", () => {
  assert.deepEqual(estadoDeStock({ ...base, qty: 4, reserved: 6 }), { cls: "warn", txt: "Al límite" });
});

test("pedido y con lugar, alcanza", () => {
  assert.deepEqual(estadoDeStock({ ...base, qty: 3 }), { cls: "ok", txt: "Alcanza" });
});

test("un reutilizable que nadie pide y alcanza no tiene nada que decir", () => {
  assert.equal(estadoDeStock({ ...base, reserved: 2 }), null);
});

test("la fila compacta no repite Alcanza", () => {
  assert.deepEqual(avisosDeFila({ ...base, qty: 3 }), []);
});

test("la fila compacta avisa el faltante aunque este evento no lo pida", () => {
  assert.deepEqual(avisosDeFila({ ...base, reserved: 12 }), [{ cls: "crit", txt: "Faltan 2" }]);
});

test("sin contar se avisa solo si este pedido lo usa", () => {
  assert.deepEqual(avisosDeFila({ ...base, stock: null }), []);
  assert.deepEqual(avisosDeFila({ ...base, stock: null, qty: 2 }), [{ cls: "neutral", txt: "Sin contar" }]);
});

test("la nota va en la segunda línea", () => {
  assert.deepEqual(avisosDeFila({ ...base, type: "CONSUMIBLE", qty: 5, note: "doradas" }), [{ cls: "nota", txt: "✎ doradas" }]);
});

test("un producto dado de baja dice primero qué hacer con él", () => {
  assert.deepEqual(avisosDeFila({ ...base, stock: 1, qty: 3, deBaja: true }), [
    { cls: "crit", txt: "Ya no está en el catálogo: poné 0" },
    { cls: "crit", txt: "Faltan 2" },
  ]);
});
```

- [ ] **Step 2: Correrla y ver que falla**

Run: `node --import tsx --test tests/fila-de-pedido.test.ts`
Expected: FAIL con `Cannot find module '../lib/fila-de-pedido'`.

- [ ] **Step 3: Implementar** — `lib/fila-de-pedido.ts`:

```ts
// Lo que dice cada fila del armador de pedidos sobre su stock.
//
// Vive aparte del componente para poder probarlo. La fila ancha lo muestra
// como chip y barra; la compacta del celular, como una segunda línea que
// aparece solo cuando hay algo que decir.

export type NivelDeStock = "neutral" | "crit" | "warn" | "ok";
export type EstadoDeStock = { cls: NivelDeStock; txt: string };
export type AvisoDeFila = { cls: "crit" | "warn" | "neutral" | "nota"; txt: string };

type FilaDeStock = { type: string; stock: number | null; qty: number; reserved: number };

/** El estado de stock de una fila. null = nada que mostrar: es un consumible,
 *  o es reutilizable, este pedido no lo usa y alcanza. */
export function estadoDeStock(p: FilaDeStock): EstadoDeStock | null {
  if (p.type !== "REUTILIZABLE") return null;
  // Sin recuento no se puede decir si alcanza: no se sabe cuánto hay. Se avisa
  // que falta contarlo, que es lo único cierto.
  if (p.stock === null) return { cls: "neutral", txt: "Sin contar" };
  const total = p.qty + p.reserved;
  if (total > p.stock) return { cls: "crit", txt: `Faltan ${total - p.stock}` };
  if (total === p.stock && total > 0) return { cls: "warn", txt: "Al límite" };
  if (p.qty > 0) return { cls: "ok", txt: "Alcanza" };
  return null;
}

/** La segunda línea de la fila compacta del celular. Vacía = la fila ocupa una
 *  sola línea. "Alcanza" no se dice: es lo normal, y decirlo en cada fila
 *  duplicaría su alto sin informar nada. */
export function avisosDeFila(p: FilaDeStock & { note: string; deBaja?: boolean }): AvisoDeFila[] {
  const avisos: AvisoDeFila[] = [];
  // El chip "Dado de baja" ya está junto al nombre: acá va qué hacer.
  if (p.deBaja) avisos.push({ cls: "crit", txt: "Ya no está en el catálogo: poné 0" });
  const st = estadoDeStock(p);
  const cls = st?.cls;
  if (st && (cls === "crit" || cls === "warn")) avisos.push({ cls, txt: st.txt });
  // Sin contar importa solo si este pedido lo usa.
  if (st && cls === "neutral" && p.qty > 0) avisos.push({ cls, txt: st.txt });
  if (p.note) avisos.push({ cls: "nota", txt: `✎ ${p.note}` });
  return avisos;
}
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `node --import tsx --test tests/fila-de-pedido.test.ts`
Expected: `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 5: Usarlo en el armador.** En `components/OrderBuilder.tsx`:

Agregar al import (después de `import { computeShortage } from "@/lib/shortage-rule";`):

```ts
import { estadoDeStock, type NivelDeStock } from "@/lib/fila-de-pedido";
```

Agregar después de la constante `IconCopy`:

```ts
/** Color de la barra de stock según lo que dice la fila. */
const RELLENO: Record<NivelDeStock, string> = {
  neutral: "var(--muted)",
  crit: "var(--crit)",
  warn: "var(--warn)",
  ok: "var(--ok)",
};
```

Reemplazar, dentro de `visible.map`, este bloque:

```tsx
              const reutil = p.type === "REUTILIZABLE";
              const total = p.qty + p.reserved;
              // Sin recuento no se puede decir si alcanza: no se sabe cuánto hay.
              // Se avisa que falta contarlo, que es lo único cierto.
              const contado = reutil && p.stock !== null;
              const hay = p.stock ?? 0;
              const pct = contado && hay > 0 ? Math.min(100, Math.round((total / hay) * 100)) : total > 0 ? 100 : 0;
              const st =
                !reutil
                  ? null
                  : !contado
                    ? { cls: "neutral", txt: "Sin contar", fill: "var(--muted)" }
                  : total > hay
                    ? { cls: "crit", txt: `Faltan ${total - hay}`, fill: "var(--crit)" }
                    : total === hay && total > 0
                      ? { cls: "warn", txt: "Al límite", fill: "var(--warn)" }
                      : p.qty > 0
                        ? { cls: "ok", txt: "Alcanza", fill: "var(--ok)" }
                        : null;
```

por:

```tsx
              const reutil = p.type === "REUTILIZABLE";
              const total = p.qty + p.reserved;
              const contado = reutil && p.stock !== null;
              const hay = p.stock ?? 0;
              const pct = contado && hay > 0 ? Math.min(100, Math.round((total / hay) * 100)) : total > 0 ? 100 : 0;
              const st = estadoDeStock(p);
```

y en la barra, `background: st?.fill ?? "var(--muted)"` por `background: st ? RELLENO[st.cls] : "var(--muted)"`.

- [ ] **Step 6: Verificar todo**

Run: `npx tsc --noEmit -p .` (sin salida), `npx eslint lib/fila-de-pedido.ts tests/fila-de-pedido.test.ts components/OrderBuilder.tsx` (sin salida), `npm test` → `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/fila-de-pedido.ts tests/fila-de-pedido.test.ts components/OrderBuilder.tsx
git commit -m "Etapa 4: el estado de stock de una fila sale del armador y se prueba"
```

---

### Task 2: La cabecera del editor en una línea, y borrar el evento se muda al editor

**Files:**
- Modify: `components/RowMenu.tsx` (ítems deshabilitados y peligrosos, botón grande)
- Create: `components/ConfirmDeleteEvent.tsx` (se muda desde `components/PeriodHub.tsx`)
- Modify: `components/PeriodHub.tsx` (sale el botón de borrar de la tarjeta)
- Modify: `app/(app)/evento/[id]/page.tsx` (`periodId` y `canBorrar` en los datos)
- Modify: `components/OrderBuilder.tsx` (cabecera, menú, responsable, filtros de sector)
- Modify: `app/globals.css`
- Create: `tests/celular.test.ts`

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces:
  - `RowMenuItem = { label: string; onSelect: () => void; disabled?: boolean; peligro?: boolean }` y `RowMenu({ items, label, grande? })`. Las Tasks 4 y 5 lo usan con `grande`.
  - `ConfirmDeleteEvent({ evento: { id: string; lugar: string; lineCount: number }, onClose, onDeleted })`.
  - Clases CSS `solo-ancho`, `solo-celular`, `filtros-scroll`, `topbar-pedido`, `topbar-titulo`, `topbar-volver`, `topbar-acciones`, `sub-datos`. Las Tasks 4 y 5 las reutilizan.
  - `Data.event.periodId: string` y `Data.canBorrar: boolean` en el armador.

- [ ] **Step 1: Escribir las guardas que fallan** — `tests/celular.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Las pantallas del celular, sobre el texto de los componentes.
 *
 * Los componentes de cliente no corren en `node --test`, así que —como
 * `order-actions.test.ts`— se exige sobre el archivo lo que no se puede
 * romper al reacomodar la pantalla: que salir del editor siga esperando el
 * guardado, que lo ya preparado siga trabado y que cada acción que se esconde
 * en el celular siga existiendo en un menú.
 */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel} desde ${process.cwd()}`);
}

test("el PDF desde el menú del celular sale recién después de guardar lo pendiente", () => {
  const s = fuente("components/OrderBuilder.tsx");
  const desde = s.indexOf("async function irAlPdf");
  assert.notEqual(desde, -1, "no está irAlPdf");
  const cuerpo = s.slice(desde, desde + 300);
  const guardar = cuerpo.indexOf("queue.flush()");
  const salir = cuerpo.indexOf("router.push(");
  assert.ok(guardar !== -1 && salir !== -1 && guardar < salir, "irAlPdf navega sin esperar el guardado");
});

test("el menú del editor tiene todo lo que en el celular sale de la cabecera", () => {
  const s = fuente("components/OrderBuilder.tsx");
  for (const label of ["Editar evento", "Repetir pedido", "PDF del pedido", "Marcar como listo", "Responsable de la fiesta", "Borrar evento"]) {
    assert.ok(s.includes(`label: "${label}"`) || s.includes(`"${label}"`), `falta "${label}" en el menú`);
  }
});

test("borrar el evento se ofrece solo a quien puede administrar períodos", () => {
  const pagina = fuente("app/(app)/evento/[id]/page.tsx");
  assert.ok(pagina.includes("canBorrar: canManagePeriods(session.role)"), "la página no calcula canBorrar");
  const s = fuente("components/OrderBuilder.tsx");
  const aperturas = s.split("setShowBorrar(true)").length - 1;
  assert.equal(aperturas, 2, "se esperaban dos entradas: el botón ancho y el menú");
  assert.ok(s.includes("{data.canBorrar && ("), "el botón ancho no depende de canBorrar");
  assert.ok(s.includes("...(data.canBorrar ?"), "el ítem del menú no depende de canBorrar");
});

test("la tarjeta de la portada ya no tiene el borrar pegado a Armar pedido", () => {
  const s = fuente("components/PeriodHub.tsx");
  assert.ok(!s.includes("event-del"), "la tarjeta sigue teniendo el botón de borrar");
  assert.ok(!s.includes("deleteEvent"), "la portada sigue borrando eventos");
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `node --import tsx --test tests/celular.test.ts`
Expected: FAIL en las cuatro (no está `irAlPdf`, falta `Borrar evento`, falta `canBorrar`, `event-del` sigue en la portada).

- [ ] **Step 3: `components/RowMenu.tsx`.** Reemplazar el tipo, la constante y la firma, y el render de cada ítem:

```tsx
export type RowMenuItem = { label: string; onSelect: () => void; disabled?: boolean; peligro?: boolean };

// Alto de un ítem para decidir si el menú entra hacia abajo. En el celular cada
// ítem mide lo que un dedo (44 px); en la pantalla ancha mide menos, y
// sobreestimar solo hace que a veces se abra hacia arriba.
const ALTO_ITEM = 44;
```

```tsx
export function RowMenu({ items, label, grande = false }: { items: RowMenuItem[]; label: string; grande?: boolean }) {
```

El botón: `className="rowmenu-btn"` pasa a `className={`rowmenu-btn${grande ? " grande" : ""}`}`. Cada ítem de la lista:

```tsx
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              className={it.peligro ? "peligro" : undefined}
              onClick={() => {
                setPos(null);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
```

Y agregar a su comentario de cabecera una línea: `` `grande`: el botón mide lo que un dedo, para la cabecera del celular. ``

- [ ] **Step 4: `components/ConfirmDeleteEvent.tsx`** (es la función de `PeriodHub.tsx`, con la prop renombrada):

```tsx
"use client";

import { useState } from "react";
import { intentar } from "@/lib/actualizacion";
import { deleteEvent } from "@/app/actions/period";

/** Confirmación para mandar un evento a la papelera. Vive en el editor del
 *  pedido: en la tarjeta de la portada estaba pegada a "Armar pedido", y en el
 *  celular un dedo apurado podía tocarla en vez de abrir el pedido. */
export function ConfirmDeleteEvent({
  evento,
  onClose,
  onDeleted,
}: {
  evento: { id: string; lugar: string; lineCount: number };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setErr(null);
    const res = await intentar(() => deleteEvent(evento.id));
    setSaving(false);
    if (!res.ok) return setErr(res.error ?? "No se pudo borrar.");
    onDeleted();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <h2>¿Borrar el evento de {evento.lugar}?</h2>
        <p className="modal-sub">
          {evento.lineCount > 0
            ? `Se va a la papelera junto con sus ${evento.lineCount} producto${evento.lineCount > 1 ? "s" : ""} del pedido.`
            : "Todavía no tiene pedido cargado."}{" "}
          El resto del período no se toca, y lo podés recuperar desde la papelera.
        </p>
        {err && <div className="form-error">{err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn danger" onClick={confirm} disabled={saving}>
            {saving ? "Borrando…" : "Borrar evento"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `components/PeriodHub.tsx`.**
  - Borrar la función `ConfirmDeleteEvent` entera (la de `function ConfirmDeleteEvent({` hasta su `}` de cierre, antes de `function TrashModal`).
  - Borrar el estado `const [eventToDelete, setEventToDelete] = useState<EventItem | null>(null);`.
  - Borrar el bloque `{eventToDelete && ( <ConfirmDeleteEvent … /> )}`.
  - En la tarjeta, borrar el botón `{canManage && ( <button className="event-del" … </button> )}` dentro de `.event-foot`.
  - Sacar `deleteEvent` del import de `@/app/actions/period`.
  - Si `IconTrash` sigue usándose (lo usa "Borrar" del período), queda.

- [ ] **Step 6: `app/(app)/evento/[id]/page.tsx`.** Importar `canManagePeriods` junto a los otros permisos:

```ts
import { canEditOrders, canManagePeriods, canSetResponsable, canVerStock } from "@/lib/permissions";
```

En `data.event`, después de `id: ev.id,`, agregar `periodId: ev.periodId,`. En `data`, después de `userId: session.id,`, agregar:

```ts
    // Borrar el evento vive en el editor y no en la tarjeta de la portada.
    canBorrar: canManagePeriods(session.role),
```

- [ ] **Step 7: `components/OrderBuilder.tsx` — tipos, estado y acciones.**

Imports nuevos:

```ts
import { RowMenu, type RowMenuItem } from "@/components/RowMenu";
import { ConfirmDeleteEvent } from "@/components/ConfirmDeleteEvent";
```

En `type Data`, dentro de `event`, agregar `periodId: string;`, y al nivel de `Data`, después de `userId: string;`:

```ts
  /** Puede mandar el evento a la papelera (administra períodos). */
  canBorrar: boolean;
```

Ícono, junto a los otros:

```tsx
const IconBack = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
);
```

Estado, junto a `showShortages`:

```ts
  const [showResp, setShowResp] = useState(false);
  const [showBorrar, setShowBorrar] = useState(false);
```

Después de `toggleStatus`:

```ts
  // Como los enlaces: primero se guarda lo pendiente, después se sale.
  async function irAlPdf() {
    if (await queue.flush()) router.push(`/evento/${data.event.id}/pdf`);
  }

  // En el celular la cabecera es una línea: volver, lugar, faltantes y este
  // menú. Medido el 19/10: con los botones a la vista ocupaba el 40 % de la
  // pantalla y entraban 2 productos.
  const menu: RowMenuItem[] = [
    { label: "Editar evento", onSelect: () => setShowEdit(true) },
    { label: "Repetir pedido", onSelect: () => setShowCopy(true), disabled: pending > 0 },
    { label: "PDF del pedido", onSelect: () => void irAlPdf() },
    {
      label: status === "LISTO" ? "Volver a borrador" : "Marcar como listo",
      onSelect: () => void toggleStatus(),
      disabled: pending > 0 || statusSaving,
    },
    { label: "Responsable de la fiesta", onSelect: () => setShowResp(true) },
    ...(data.canBorrar ? [{ label: "Borrar evento", onSelect: () => setShowBorrar(true), disabled: pending > 0, peligro: true }] : []),
  ];
```

- [ ] **Step 8: `components/OrderBuilder.tsx` — la cabecera.** Reemplazar el `<div className="topbar"> … </div>` del armador (desde `<div className="topbar">` hasta el `</div>` que cierra después del botón de "Marcar como listo") por:

```tsx
      <div className="topbar topbar-pedido">
        <Link className="topbar-volver solo-celular" href="/" aria-label="Volver">{IconBack}</Link>
        <div className="topbar-titulo">
          <h1>{data.event.lugar}</h1>
          <div className="sub">
            {status === "LISTO" && <span className="sub-listo solo-celular">Listo</span>}
            <span className="sub-datos">
              {data.event.subLabel} · {inOrderCount} producto{inOrderCount === 1 ? "" : "s"} en el pedido
            </span>
            <span className="save-ind">
              {saveStatus.error ? "Sin guardar" : pending > 0 ? "Guardando…" : savedOnce ? "Guardado ✓" : "Se guarda solo mientras cargás"}
            </span>
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost solo-ancho" href="/">Volver</Link>
        {/* Único lugar donde se informan los faltantes: no hay banner aparte. */}
        {over.length > 0 && (
          <button
            className="btn btn-falta btn-falta-top"
            onClick={() => setShowShortages(true)}
            aria-label={`Ver faltantes (${over.length})`}
          >
            {IconWarn} <span className="solo-ancho">Ver faltantes</span> <span className="count-pill">{over.length}</span>
          </button>
        )}
        <div className="topbar-acciones solo-ancho">
          <button className="btn ghost" onClick={() => setShowEdit(true)}>{IconEdit} Editar evento</button>
          <button className="btn ghost" disabled={pending > 0} onClick={() => setShowCopy(true)}>{IconCopy} Repetir pedido</button>
          <Link className="btn ghost" href={`/evento/${data.event.id}/pdf`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
            </svg>
            PDF del pedido
          </Link>
          <button className={`btn${status === "LISTO" ? "" : " primary"}`} disabled={pending > 0 || statusSaving} onClick={toggleStatus}>
            {status === "LISTO" ? "✓ Listo — volver a borrador" : "Marcar como listo"}
          </button>
          {data.canBorrar && (
            <button className="btn btn-del" disabled={pending > 0} onClick={() => setShowBorrar(true)} title="Mandar el evento a la papelera">
              {IconTrash} Borrar
            </button>
          )}
        </div>
        <div className="solo-celular">
          <RowMenu items={menu} label="Más acciones del pedido" grande />
        </div>
      </div>
```

- [ ] **Step 9: `components/OrderBuilder.tsx` — responsable y filtros.**

El bloque del responsable pasa a ser solo de la pantalla ancha (en el celular está en el menú): `<div className="ro-resp">` → `<div className="ro-resp solo-ancho">`.

En la barra de búsqueda, envolver las pestañas de sector y la de Extras en un solo contenedor. Reemplazar:

```tsx
          {!searching &&
            CATS.map((c) => (
              <button key={c.v} className={`tab${tab === c.v ? " active" : ""}`} onClick={() => elegirPestania(c.v)}>
                {c.l}
              </button>
            ))}
          {!searching && (
            <button className={`tab${tab === "EXTRAS" ? " active" : ""}`} onClick={() => elegirPestania("EXTRAS")}>
              Extras{customs.length > 0 ? ` (${customs.length})` : ""}
            </button>
          )}
```

por:

```tsx
          {!searching && (
            <div className="filtros-scroll">
              {CATS.map((c) => (
                <button key={c.v} className={`tab${tab === c.v ? " active" : ""}`} onClick={() => elegirPestania(c.v)}>
                  {c.l}
                </button>
              ))}
              <button className={`tab${tab === "EXTRAS" ? " active" : ""}`} onClick={() => elegirPestania("EXTRAS")}>
                Extras{customs.length > 0 ? ` (${customs.length})` : ""}
              </button>
            </div>
          )}
```

Modales, después del de `EditEventModal`:

```tsx
      {showResp && (
        <div className="overlay" onClick={() => setShowResp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Responsable de la fiesta</h2>
            <ResponsableEditor eventId={data.event.id} responsable={data.event.responsable} canEdit />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowResp(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
      {showBorrar && (
        <ConfirmDeleteEvent
          evento={{ id: data.event.id, lugar: data.event.lugar, lineCount: inOrderCount }}
          onClose={() => setShowBorrar(false)}
          onDeleted={() => router.push(`/?w=${data.event.periodId}`)}
        />
      )}
```

- [ ] **Step 10: `app/globals.css`.**

Borrar las reglas de `.event-del` que quedan sin uso: el bloque `.event-del{…}`, `.event-del svg{…}`, `.event-del:hover{…}`, `.event-del:focus-visible{…}`, la línea `@media (hover:none){ .event-del{opacity:1} }` (con su comentario), y dentro de `@media (max-width:720px){ … }` solo la línea `.event-del{opacity:1; width:38px; height:38px}` (la regla de `.event-falta` de ese bloque queda).

Agregar al final del archivo:

```css
/* ===== Celular (etapa 4) ==================================================
   Medido el 19/10 a 375×812 con datos de producción: en el editor la cabecera
   fija ocupaba el 40 % de la pantalla y entraban 2 productos. La meta es 6 o
   más. El corte es 860 px, el mismo que esconde la barra lateral. */

/* Lo que existe en un solo ancho. `!important` porque estas clases conviven
   con las de cada elemento (`.btn`, `.topbar-acciones`), que fijan su propio
   `display`. */
@media (min-width:861px){ .solo-celular{display:none !important} }
@media (max-width:860px){ .solo-ancho{display:none !important} }

/* Filtros que en el celular van en una sola fila que se desliza de costado, en
   vez de apilarse y empujar la lista hacia abajo. En la pantalla ancha el
   contenedor no existe para el layout. */
.filtros-scroll{display:contents}

.topbar-titulo{min-width:0}
.topbar-acciones{display:flex; align-items:center; gap:var(--sp-3); flex-wrap:wrap}
.sub-datos + .save-ind::before{content:" · "}
.topbar-volver{
  width:var(--tap); height:var(--tap); flex:none; display:grid; place-items:center;
  color:var(--ink); border-radius:var(--r-md); margin-left:calc(-1 * var(--sp-2));
}
.topbar-volver svg{width:22px; height:22px}
.sub-listo{color:var(--ok); font-weight:700}

.rowmenu-btn.grande{width:var(--tap); height:var(--tap); flex:none; border-color:var(--hair); background:var(--surface); color:var(--ink)}
.rowmenu-btn.grande svg{width:20px; height:20px}
.rowmenu-list button.peligro{color:var(--crit)}
.rowmenu-list button:disabled{opacity:.5; cursor:not-allowed}
.rowmenu-list button:disabled:hover{background:transparent}

@media (max-width:860px){
  /* La cabecera del pedido, en una línea: volver, lugar, faltantes y ⋯. */
  .topbar-pedido{flex-wrap:nowrap; gap:var(--sp-2); padding:var(--sp-2) var(--sp-3)}
  .topbar-pedido .topbar-titulo{flex:1 1 auto}
  .topbar-pedido .spacer{display:none}
  .topbar-pedido h1{font-size:var(--t-lg); line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .topbar-pedido .sub{display:flex; gap:var(--sp-2); white-space:nowrap; font-size:var(--t-xs); margin-top:0}
  .topbar-pedido .sub-datos{min-width:0; overflow:hidden; text-overflow:ellipsis}
  /* Lo que no se puede cortar va primero: si está listo y si se guardó. */
  .topbar-pedido .sub-listo, .topbar-pedido .save-ind{order:-1; flex:none}
  .topbar-pedido .save-ind::before{content:none}
  .topbar-pedido .btn-falta-top{flex:none; padding:0 var(--sp-3)}
  .rowmenu-list button{min-height:var(--tap)}

  .searchbar .search{flex-basis:100%}
  .filtros-scroll{display:flex; gap:var(--sp-2); width:100%; overflow-x:auto; flex-wrap:nowrap; scrollbar-width:none; overscroll-behavior-x:contain}
  .filtros-scroll::-webkit-scrollbar{display:none}
  .filtros-scroll > *{flex:none}
}
```

- [ ] **Step 11: Correr las guardas y todo lo demás**

Run: `node --import tsx --test tests/celular.test.ts` → `ℹ pass 4`. Después `npx tsc --noEmit -p .`, `npx eslint components/RowMenu.tsx components/ConfirmDeleteEvent.tsx components/PeriodHub.tsx components/OrderBuilder.tsx "app/(app)/evento/[id]/page.tsx" tests/celular.test.ts`, `npm test` → `ℹ fail 0`.

- [ ] **Step 12: Commit**

```bash
git add components/RowMenu.tsx components/ConfirmDeleteEvent.tsx components/PeriodHub.tsx components/OrderBuilder.tsx "app/(app)/evento/[id]/page.tsx" app/globals.css tests/celular.test.ts
git commit -m "Etapa 4: la cabecera del editor en una línea en el celular, y borrar el evento pasa al editor"
```

---

### Task 3: La fila de producto compacta en el celular

**Files:**
- Modify: `components/OrderBuilder.tsx` (`visible.map` del catálogo y la fila de `ExtrasPanel`)
- Modify: `app/globals.css` (el bloque `@media(max-width:860px)` del armador, después de `.extras-form`)
- Modify: `tests/celular.test.ts`

**Interfaces:**
- Consumes: `avisosDeFila`, `estadoDeStock` y `RELLENO` (Task 1); `solo-ancho`, `solo-celular` (Task 2).
- Produces: clases `pname-btn`, `orow-resumen`, `resumen-<cls>`, `orow-detalle`, `detalle-pasos`, `detalle-nota`.

- [ ] **Step 1: Escribir la guarda que falla.** Agregar a `tests/celular.test.ts`:

```ts
test("la nota del detalle del celular respeta la traba de lo ya preparado", () => {
  const s = fuente("components/OrderBuilder.tsx");
  const desde = s.indexOf('className="detalle-nota"');
  assert.notEqual(desde, -1, "no está la nota del detalle");
  const input = s.slice(s.lastIndexOf("<input", desde), s.indexOf("/>", desde));
  assert.ok(input.includes("readOnly={trabada}"), "la nota del detalle se puede tipear estando trabada");
  assert.ok(input.includes("onFocus={trabada ? () => setPorConfirmar(p.id)"), "enfocarla trabada no pregunta");
  assert.ok(input.includes("onPointerDown={trabada ? () => setPorConfirmar(p.id)"), "tocarla trabada no pregunta");
  assert.ok(input.includes("updateItem(p.id, { note:"), "la nota del detalle no pasa por updateItem");
});

test("los ±10 del detalle pasan por la misma pregunta que el resto", () => {
  const s = fuente("components/OrderBuilder.tsx");
  const desde = s.indexOf('className="detalle-pasos"');
  assert.notEqual(desde, -1, "no están los ±10 del detalle");
  const bloque = s.slice(desde, s.indexOf("</div>", desde));
  assert.ok(bloque.includes("stepQty(p.id, -10)") && bloque.includes("stepQty(p.id, 10)"), "los ±10 no usan stepQty");
});
```

- [ ] **Step 2: Correrla y ver que falla**

Run: `node --import tsx --test tests/celular.test.ts`
Expected: FAIL en las dos nuevas (no está `detalle-nota` ni `detalle-pasos`).

- [ ] **Step 3: Estado del detalle.** En `components/OrderBuilder.tsx`, el import de la Task 1 pasa a:

```ts
import { avisosDeFila, estadoDeStock, type NivelDeStock } from "@/lib/fila-de-pedido";
```

Y junto a `noteOpen`:

```ts
  // Filas abiertas en el celular: tocar el nombre muestra ±10, el stock y la nota.
  const [detalle, setDetalle] = useState<Record<string, boolean>>({});
```

- [ ] **Step 4: La fila del catálogo.** Dentro de `visible.map((p) => { … })`, después de `const st = estadoDeStock(p);`, agregar:

```tsx
              const avisos = avisosDeFila(p);
              const abierta = detalle[p.id] === true;
              const rubro = (
                <>
                  {searching ? `${CATS.find((c) => c.v === p.category)?.l ?? p.category} · ` : ""}
                  {p.rubro}
                  {p.unit !== "Unidad" ? ` · por ${p.unit.toLowerCase()}` : ""}
                  {p.deBaja ? " · ya no está en el catálogo, poné 0 para sacarlo" : ""}
                </>
              );
```

(`const trabada = bloqueada(p.id);` ya existe; queda donde está.) Reemplazar el `return ( <div key={p.id} className={`orow…`}> … </div> );` de esa función por:

```tsx
              return (
                <div key={p.id} className={`orow${p.qty > 0 ? " has-qty" : ""}${abierta ? " abierta" : ""}`}>
                  <div className="ocol-name">
                    {/* En el celular, tocar el nombre abre el detalle: ±10, el stock y
                        la nota. En la pantalla ancha todo eso ya está a la vista. */}
                    <button
                      type="button"
                      className="pname pname-btn"
                      aria-expanded={abierta}
                      onClick={() => setDetalle((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    >
                      {p.name}
                      {p.deBaja && <span className="chip crit chip-baja">Dado de baja</span>}
                      {data.preparados[p.id] !== undefined && <span className="chip ok chip-prep">Preparado</span>}
                    </button>
                    <div className="rubro">{rubro}</div>
                    {/* La segunda línea del celular: solo si hay algo que decir. */}
                    {avisos.length > 0 && (
                      <div className="orow-resumen solo-celular">
                        {avisos.map((a) => (
                          <span key={a.cls + a.txt} className={`resumen-${a.cls}`}>{a.txt}</span>
                        ))}
                      </div>
                    )}
                    <button
                      className={`note-toggle solo-ancho${p.note ? " has-note" : ""}`}
                      onClick={() => {
                        // Trabada, la nota tampoco se abre: se pregunta primero.
                        if (trabada) setPorConfirmar(p.id);
                        else setNoteOpen((s) => ({ ...s, [p.id]: !s[p.id] }));
                      }}
                    >
                      {p.note ? `✎ ${p.note}` : "+ nota"}
                    </button>
                    {noteOpen[p.id] && (
                      <input
                        className="note-input solo-ancho"
                        type="text"
                        placeholder="Aclaración… (ej: doradas, para postre)"
                        value={p.note}
                        autoFocus
                        // Si el depósito tilda la fila con la nota abierta (llega con una
                        // recarga), el campo se traba en vez de tragarse lo que se tipea.
                        readOnly={trabada}
                        onFocus={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onPointerDown={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onChange={(e) => updateItem(p.id, { note: e.target.value })}
                        onBlur={() => setNoteOpen((s) => ({ ...s, [p.id]: false }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setNoteOpen((s) => ({ ...s, [p.id]: false }));
                        }}
                      />
                    )}
                  </div>

                  <div className="ocol-stock solo-ancho">
                    {reutil ? (
                      <>
                        <div className="bar"><div className="fill" style={{ width: `${pct}%`, background: st ? RELLENO[st.cls] : "var(--muted)" }} /></div>
                        <div className="line">
                          Depósito: <b>{p.stock ?? "sin contar"}</b> · Otros eventos: <b>{p.reserved}</b>
                          {st && <span className={`chip ${st.cls}`}>{st.txt}</span>}
                        </div>
                      </>
                    ) : (
                      <span className="chip neutral">Se compra por evento</span>
                    )}
                  </div>

                  <div className="ocol-qty">
                    <button className="qbtn wide solo-ancho" onClick={() => stepQty(p.id, -10)} aria-label="Restar diez">−10</button>
                    <button className="qbtn" onClick={() => stepQty(p.id, -1)} aria-label="Restar uno">−</button>
                    <input
                      className="qinput"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      id={idDeCantidad(p.id)}
                      value={p.qty === 0 ? "" : p.qty}
                      placeholder="0"
                      // Trabado no se puede tipear: el aviso se abre al tocarlo y no se
                      // captura ninguna tecla.
                      readOnly={trabada}
                      title={trabada ? "Ya está preparado: tocá para cambiarlo" : undefined}
                      onFocus={trabada ? () => setPorConfirmar(p.id) : undefined}
                      onPointerDown={trabada ? () => setPorConfirmar(p.id) : undefined}
                      onChange={(e) => {
                        const n = e.target.value.trim() === "" ? 0 : Math.max(0, Math.round(Number(e.target.value)));
                        updateItem(p.id, { qty: Number.isFinite(n) ? n : 0 });
                      }}
                      aria-label={`Cantidad de ${p.name}`}
                    />
                    <button className="qbtn" onClick={() => stepQty(p.id, 1)} aria-label="Sumar uno">+</button>
                    <button className="qbtn wide solo-ancho" onClick={() => stepQty(p.id, 10)} aria-label="Sumar diez">+10</button>
                  </div>

                  {abierta && (
                    <div className="orow-detalle solo-celular">
                      <div className="rubro">{rubro}</div>
                      <div>
                        {reutil ? (
                          <>Depósito: <b>{p.stock ?? "sin contar"}</b> · Otros eventos: <b>{p.reserved}</b></>
                        ) : (
                          "Se compra por evento"
                        )}
                      </div>
                      <div className="detalle-pasos">
                        <button className="qbtn wide" onClick={() => stepQty(p.id, -10)} aria-label="Restar diez">−10</button>
                        <button className="qbtn wide" onClick={() => stepQty(p.id, 10)} aria-label="Sumar diez">+10</button>
                      </div>
                      <input
                        className="detalle-nota"
                        type="text"
                        placeholder="Nota… (ej: doradas, para postre)"
                        value={p.note}
                        // La misma traba que la cantidad: preparado, se pregunta antes.
                        readOnly={trabada}
                        onFocus={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onPointerDown={trabada ? () => setPorConfirmar(p.id) : undefined}
                        onChange={(e) => updateItem(p.id, { note: e.target.value })}
                        aria-label={`Nota de ${p.name}`}
                      />
                    </div>
                  )}
                  {porConfirmar === p.id && (
                    <div className="prep-aviso-fila" role="alert">
                      <span>
                        Ya está preparado ({data.preparados[p.id]}). Si lo cambiás, el depósito tiene que rehacerlo.
                      </span>
                      <button className="btn primary" onClick={confirmarCambio}>Cambiar igual</button>
                      <button className="btn ghost" onClick={() => setPorConfirmar(null)}>Cancelar</button>
                    </div>
                  )}
                </div>
              );
```

- [ ] **Step 5: La fila de los extras.** En `ExtrasPanel`, `<div className="ocol-stock">` (el de "Sin control de stock") pasa a `<div className="ocol-stock solo-ancho">`. Nada más: en el celular el nombre y − cantidad + 🗑 quedan en una línea por el CSS del paso siguiente.

- [ ] **Step 6: `app/globals.css`.** Reemplazar el bloque:

```css
@media(max-width:860px){
  .orow{grid-template-columns:1fr; gap:10px}
  .ocol-qty{justify-content:flex-start}
  .extras-form{flex-direction:column; align-items:stretch}
  .extras-form .field{width:100%!important}
}
```

por:

```css
/* El nombre es un botón: en el celular abre el detalle de la fila. En la
   pantalla ancha se ve y se comporta como texto. */
.pname-btn{display:block; width:100%; appearance:none; background:none; border:0; padding:0; margin:0; font:inherit; color:inherit; text-align:left; cursor:pointer}
.pname-btn:focus-visible{outline:2px solid var(--gold); outline-offset:2px; border-radius:var(--r-sm)}
@media (min-width:861px){ .pname-btn{cursor:default} }

/* En el celular la fila es una línea: el nombre y − cantidad +. Una segunda
   línea chica aparece solo si hay algo que decir, y el resto (±10, el stock y
   la nota) se abre tocando el nombre. Medido el 19/10: con la fila apilada en
   tres pisos entraban 2 productos por pantalla. */
.orow-resumen{display:flex; flex-wrap:wrap; gap:0 var(--sp-2); font-size:var(--t-xs); line-height:1.4; color:var(--muted)}
.orow-resumen > span{min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.resumen-crit{color:var(--crit); font-weight:650}
.resumen-warn{color:var(--warn); font-weight:650}
.resumen-nota{color:var(--gold)}
.orow-detalle{grid-column:1/-1; display:flex; flex-direction:column; gap:var(--sp-2); padding-top:var(--sp-2); border-top:1px dashed var(--hair); font-size:var(--t-sm); color:var(--muted)}
.orow-detalle b{color:var(--ink)}
.orow-detalle .rubro{margin-top:0}
.detalle-pasos{display:flex; gap:var(--sp-2)}
.detalle-pasos .qbtn{flex:1}
/* 16 px de letra: con menos, el teléfono agranda la pantalla al tocarla. */
.detalle-nota{display:block; width:100%; min-height:var(--tap); font-size:var(--t-base); font-family:var(--font-ui); background:var(--surface-2); border:1px solid var(--hair); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); color:var(--ink)}
.detalle-nota:focus{outline:2px solid var(--gold); outline-offset:-1px}

@media(max-width:860px){
  .orow{grid-template-columns:minmax(0,1fr) auto; gap:var(--sp-1) var(--sp-3); padding:var(--sp-2) var(--sp-3)}
  .ocol-name .rubro{display:none}
  .pname-btn{min-height:var(--tap); display:flex; flex-wrap:wrap; align-items:center; gap:var(--sp-1) var(--sp-2)}
  .pname-btn .chip-prep, .pname-btn .chip-baja{margin-left:0}
  .ocol-qty{justify-content:flex-end}
  .ocol-qty .qinput{width:52px}
  .extras-form{flex-direction:column; align-items:stretch}
  .extras-form .field{width:100%!important}
}
```

Ojo: `.orow-detalle .rubro` está fuera de `.ocol-name`, así que `.ocol-name .rubro{display:none}` no lo alcanza.

- [ ] **Step 7: Correr las guardas y todo lo demás**

Run: `node --import tsx --test tests/celular.test.ts` → `ℹ pass 6`. Después `npx tsc --noEmit -p .`, `npx eslint components/OrderBuilder.tsx tests/celular.test.ts`, `npm test` → `ℹ fail 0`.

- [ ] **Step 8: Commit**

```bash
git add components/OrderBuilder.tsx app/globals.css tests/celular.test.ts
git commit -m "Etapa 4: la fila de producto compacta en el celular, con el detalle al tocar el nombre"
```

---

### Task 4: La vista de solo lectura en el celular

**Files:**
- Modify: `components/OrderReadOnly.tsx`
- Modify: `app/globals.css`
- Modify: `tests/celular.test.ts`

**Interfaces:**
- Consumes: `topbar-pedido`, `topbar-volver`, `topbar-titulo`, `sub-datos`, `solo-ancho`, `solo-celular` (Task 2).
- Produces: clases `ro-tabla`, `sub-chip`, `topbar-icono`.

- [ ] **Step 1: Escribir la guarda que falla.** Agregar a `tests/celular.test.ts`:

```ts
test("la vista de solo lectura sigue sin ningún control que escriba en el pedido", () => {
  const s = fuente("components/OrderReadOnly.tsx");
  assert.ok(!s.includes("@/app/actions/order"), "la vista de solo lectura importa acciones del pedido");
  assert.ok(s.includes('className="ro-tabla"'), "la tabla no tiene la clase que la vuelve lista en el celular");
});
```

- [ ] **Step 2: Correrla y ver que falla**

Run: `node --import tsx --test tests/celular.test.ts`
Expected: FAIL en la nueva (falta `ro-tabla`).

- [ ] **Step 3: `components/OrderReadOnly.tsx`.** Íconos nuevos, después de `IconWarn`:

```tsx
const IconBack = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
);
const IconPrint = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
  </svg>
);
```

Reemplazar el `<div className="topbar"> … </div>` por:

```tsx
      <div className="topbar topbar-pedido">
        <Link className="topbar-volver solo-celular" href="/" aria-label="Volver">{IconBack}</Link>
        <div className="topbar-titulo">
          <h1>{data.event.lugar}</h1>
          <div className="sub">
            <span className="sub-datos">
              {data.event.subLabel} · {total} producto{total === 1 ? "" : "s"} en el pedido
            </span>
            <span className="chip neutral sub-chip">Solo lectura</span>
          </div>
        </div>
        <div className="spacer" />
        <Link className="btn ghost solo-ancho" href="/">Volver</Link>
        {faltantes.length > 0 && (
          <button
            className="btn btn-falta btn-falta-top"
            onClick={() => setVerFaltantes(true)}
            aria-label={`Ver faltantes (${faltantes.length})`}
          >
            {IconWarn} <span className="solo-ancho">Ver faltantes</span> <span className="count-pill">{faltantes.length}</span>
          </button>
        )}
        <Link className="btn ghost solo-ancho" href={`/evento/${data.event.id}/pdf`}>
          {IconPrint}
          PDF del pedido
        </Link>
        {/* En el celular el PDF es un ícono: es la única acción, no hace falta menú. */}
        <Link className="btn ghost topbar-icono solo-celular" href={`/evento/${data.event.id}/pdf`} aria-label="PDF del pedido">
          {IconPrint}
        </Link>
      </div>
```

Y `<table>` pasa a `<table className="ro-tabla">`.

- [ ] **Step 4: `app/globals.css`.** Agregar al final de la sección "Celular (etapa 4)":

```css
.sub-chip{margin-left:var(--sp-2)}
.topbar-icono{width:var(--tap); padding:0; flex:none}

/* El pedido en solo lectura: en el celular es una lista, con la nota debajo del
   nombre. La tabla tiene 680 px de mínimo y dejaba la nota fuera del teléfono. */
@media (max-width:860px){
  .topbar-pedido .sub-chip{flex:none; margin-left:0; padding:0 var(--sp-2)}
  .ro-tabla{min-width:0}
  .ro-tabla thead{display:none}
  .ro-tabla tbody tr{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px var(--sp-3); padding:var(--sp-2) var(--sp-3); border-bottom:1px solid var(--hair)}
  .ro-tabla tbody tr:last-child{border-bottom:none}
  .ro-tabla tbody td{padding:0; border:none}
  .ro-tabla tbody td:nth-child(2){text-align:right; white-space:nowrap}
  .ro-tabla tbody td:nth-child(3){grid-column:1/-1; font-size:var(--t-sm)}
  /* Sin nota no queda un renglón vacío. */
  .ro-tabla tbody td:empty{display:none}
}
```

- [ ] **Step 5: Correr las guardas y todo lo demás**

Run: `node --import tsx --test tests/celular.test.ts` → `ℹ pass 7`. Después `npx tsc --noEmit -p .`, `npx eslint components/OrderReadOnly.tsx tests/celular.test.ts`, `npm test` → `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add components/OrderReadOnly.tsx app/globals.css tests/celular.test.ts
git commit -m "Etapa 4: el pedido en solo lectura es una lista en el celular, con la nota a la vista"
```

---

### Task 5: La portada y Cambios tardíos en el celular

**Files:**
- Modify: `components/PeriodHub.tsx`
- Modify: `app/(app)/cambios-tardios/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/celular.test.ts`

**Interfaces:**
- Consumes: `RowMenu` con `grande` y `peligro` (Task 2); `solo-ancho`, `solo-celular`, `filtros-scroll`, `topbar-titulo` (Task 2).
- Produces: clases `topbar-hub`, `hub-cuerpo`, `hub-eventos`, `hub-banner`.

- [ ] **Step 1: Escribir las guardas que fallan.** Agregar a `tests/celular.test.ts`:

```ts
test("en el celular, lo que el período esconde de la cabecera está en su menú", () => {
  const s = fuente("components/PeriodHub.tsx");
  const desde = s.indexOf('label="Más acciones del período"');
  assert.notEqual(desde, -1, "la portada no tiene el menú del período");
  // Los ítems van después de la etiqueta, hasta el cierre del componente.
  const menu = s.slice(desde, s.indexOf("/>", desde));
  for (const label of ["Nuevo período", "Editar período", "Papelera", "Borrar período"]) {
    assert.ok(menu.includes(label), `falta "${label}" en el menú del período`);
  }
});

test("las pestañas de Cambios tardíos van en una fila que se desliza", () => {
  const s = fuente("app/(app)/cambios-tardios/page.tsx");
  assert.ok(s.includes('className="filtros-scroll"'), "las pestañas de períodos se apilan en el celular");
});
```

- [ ] **Step 2: Correrlas y ver que fallan**

Run: `node --import tsx --test tests/celular.test.ts`
Expected: FAIL en las dos nuevas.

- [ ] **Step 3: `components/PeriodHub.tsx` — cabecera.** Importar el menú:

```ts
import { RowMenu } from "@/components/RowMenu";
```

Reemplazar el `<div className="topbar"> … </div>` de `PeriodHub` por:

```tsx
      <div className="topbar topbar-hub">
        <div className="topbar-titulo">
          <h1>{selected ? selected.label : "Período"}</h1>
          <div className="sub">
            {selected
              ? `${selected.rangeLabel} · ${totalEventos} ${totalEventos === 1 ? "evento" : "eventos"}`
              : "Creá tu primer período operativo para empezar"}
          </div>
        </div>
        <div className="spacer" />
        {/* En el celular, lo que se usa poco va a un menú: los botones apilados
            empujaban los eventos al final de la primera pantalla. */}
        {canManage && (
          <div className="solo-celular">
            <RowMenu
              grande
              label="Más acciones del período"
              items={[
                { label: "Nuevo período", onSelect: () => setShowPeriodo(true) },
                ...(selected ? [{ label: "Editar período", onSelect: () => setShowEditPeriodo(true) }] : []),
                ...(trashCount > 0 ? [{ label: `Papelera (${trashCount})`, onSelect: () => setShowTrash(true) }] : []),
                ...(selected ? [{ label: "Borrar período", onSelect: () => setShowDelete(true), peligro: true }] : []),
              ]}
            />
          </div>
        )}
        {periodos.length > 1 && selected && (
          <select
            className="wk-select"
            value={selected.id}
            onChange={(e) => router.push(`/?w=${e.target.value}`)}
            aria-label="Elegir período"
          >
            {periodos.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} ({w.eventCount})
              </option>
            ))}
          </select>
        )}
        {canManage && (
          <button className="btn ghost solo-ancho" onClick={() => setShowPeriodo(true)}>
            {IconPlus} Nuevo período
          </button>
        )}
        {canManage && selected && (
          <button className="btn primary" onClick={() => setShowEvent(true)}>
            {IconPlus} Nuevo evento
          </button>
        )}
        {canManage && trashCount > 0 && (
          <button className="btn ghost solo-ancho" onClick={() => setShowTrash(true)} title="Recuperar algo borrado">
            {IconUndo} Papelera <span className="count-pill">{trashCount}</span>
          </button>
        )}
        {canManage && selected && (
          <button className="btn ghost solo-ancho" onClick={() => setShowEditPeriodo(true)} title="Editar las fechas o el nombre">
            {IconEdit} Editar período
          </button>
        )}
        {canManage && selected && (
          <button className="btn btn-del solo-ancho" onClick={() => setShowDelete(true)} title="Borrar período">
            {IconTrash} Borrar
          </button>
        )}
      </div>
```

- [ ] **Step 4: `components/PeriodHub.tsx` — cuerpo.** Dentro de la rama `selected` (el fragmento `<> … </>` que empieza con `<div className="tiles">`), cambiar:

1. El fragmento `<>` de apertura pasa a `<div className="hub-cuerpo">` y su `</>` de cierre a `</div>`.
2. Las etiquetas de las fichas. La segunda y la tercera `.k` quedan:

```tsx
                <div className="k">
                  <span className="dot" style={{ background: "var(--ok)" }} />
                  <span className="solo-ancho">Productos que alcanzan</span>
                  <span className="solo-celular">Alcanzan</span>
                </div>
```

```tsx
                <div className="k">
                  <span className="dot" style={{ background: "var(--crit)" }} />
                  <span className="solo-ancho">Sin stock suficiente</span>
                  <span className="solo-celular">Sin stock</span>
                </div>
```

3. Los dos avisos: `<div className="banner crit">` → `<div className="banner crit hub-banner">` y `<div className="banner ok">` → `<div className="banner ok hub-banner">`.
4. Envolver el título "Por hacer" y la lista de eventos (desde `<div className="section-title">` hasta el cierre del ternario `totalEventos === 0 ? … : …` inclusive) en `<div className="hub-eventos"> … </div>`. El `<details className="pasados">` queda afuera, después.

- [ ] **Step 5: `app/(app)/cambios-tardios/page.tsx`.** Envolver las pestañas:

```tsx
        <div className="searchbar">
          <div className="filtros-scroll">
            <Link className={`tab${elegido ? "" : " active"}`} href="/cambios-tardios">Todos</Link>
            {periodos.map((x) => (
              <Link key={x.id} className={`tab${elegido?.id === x.id ? " active" : ""}`} href={`/cambios-tardios?p=${x.id}`}>
                {nombreDe(x)}
              </Link>
            ))}
          </div>
        </div>
```

- [ ] **Step 6: `app/globals.css`.** En el bloque existente:

```css
@media(max-width:860px){
  .tiles{grid-template-columns:1fr}
  .event-grid{grid-template-columns:1fr}
  .wk-select{max-width:none; flex:1}
}
```

reemplazar `.tiles{grid-template-columns:1fr}` por:

```css
  /* Los tres números en una línea: apilados ocupaban media pantalla. */
  .tiles{grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--sp-2); margin-bottom:var(--sp-3)}
  .tile{padding:var(--sp-3)}
  .tile .k{font-size:var(--t-xs)}
  .tile .v{font-size:var(--t-xl); margin-top:var(--sp-1)}
```

Y agregar al final de la sección "Celular (etapa 4)":

```css
/* La portada en el celular: la cabecera no queda fija (no es una lista larga) y
   los eventos van antes que el aviso del período, que repite lo que cada
   tarjeta ya dice con su propio botón de faltantes. */
@media (max-width:860px){
  .topbar-hub{position:static; gap:var(--sp-2)}
  .topbar-hub .spacer{display:none}
  /* El título y el menú en la primera línea; el período y "Nuevo evento", en la segunda. */
  .topbar-hub .topbar-titulo{flex:1 1 calc(100% - var(--tap) - var(--sp-2))}
  .topbar-hub h1{font-size:var(--t-xl)}
  .topbar-hub .wk-select{flex:1 1 0; min-width:0}
  .hub-cuerpo{display:flex; flex-direction:column}
  .hub-eventos{order:1}
  .hub-banner{order:2; margin-top:var(--sp-5); margin-bottom:0}
  .hub-cuerpo > .pasados{order:3}
}
```

- [ ] **Step 7: Correr las guardas y todo lo demás**

Run: `node --import tsx --test tests/celular.test.ts` → `ℹ pass 9`. Después `npx tsc --noEmit -p .`, `npx eslint components/PeriodHub.tsx "app/(app)/cambios-tardios/page.tsx" tests/celular.test.ts`, `npm test` → `ℹ fail 0`, y `npm run build` sin errores.

- [ ] **Step 8: Commit**

```bash
git add components/PeriodHub.tsx "app/(app)/cambios-tardios/page.tsx" app/globals.css tests/celular.test.ts
git commit -m "Etapa 4: la portada pone los eventos primero en el celular, y Cambios tardíos desliza sus pestañas"
```

---

## Verificación (la hace el controlador, no un implementador)

Sobre una copia de producción, con la app local (`npm run build` + `next start`), sin suscripciones y con las claves de push vacías:

1. **El número de la spec.** A 375×812, en el pedido más largo (el de 125 renglones o el mayor que haya), contar los productos completamente visibles entre la cabecera fija y la barra de abajo, con la lista ya en pantalla. Antes: 2 (medido el 19/10). Meta: 6 o más.
2. **La traba.** En una fila ya preparada: tocar la cantidad, los ±10 del detalle y la nota del detalle → aparece "Ya está preparado…", y nada cambia hasta "Cambiar igual".
3. **El menú.** Editar evento, Repetir pedido, PDF (con un cambio recién tipeado: espera el guardado), Listo/borrador, Responsable, Borrar evento (vuelve a la portada del período).
4. **Solo lectura** (con un usuario de Logística): lista, nota debajo del nombre, sin scroll de costado.
5. **Portada:** los eventos en la primera pantalla; el menú ⋯ con período, papelera y borrar.
6. **Cambios tardíos:** las pestañas en una fila.
7. **Pantalla ancha (1280):** el editor y la portada como antes, más "Borrar" en el editor y sin el tachito en la tarjeta.
