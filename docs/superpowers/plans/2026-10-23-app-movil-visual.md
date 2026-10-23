# Que se sienta una app · Parte visual — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que en el teléfono la app se vea y se toque como una app instalada y no como una página web: ventanas que suben desde abajo y se cierran deslizando, listas en vez de tablas, cabeceras completas, avisos como filas tocables y respuesta visible al tocar.

**Architecture:** todo vive debajo de 860 px (`@media (max-width:860px)`) o en pantallas táctiles (`@media (hover:none)`); la computadora no cambia. Casi todo es CSS sobre clases que ya comparten las pantallas (`.overlay` + `.modal`, `table`, `.revision-item`). Lo único con lógica es el gesto de deslizar para cerrar, que vive en `components/ComportamientoDeApp.tsx` (montado en `app/layout.tsx`) y no conoce a ningún modal: dispara el mismo clic en el fondo que ya cierra cada uno, así respeta las reglas de cada ventana.

**Tech Stack:** Next.js 16, React 19 (componentes de cliente), CSS plano en `app/globals.css`, pruebas con `node --test` + `tsx`.

## Global Constraints

- El usuario, 23/10, en su teléfono Android: "Necesito que quede como una aplicación móvil de verdad, tiene muchas falencias visuales y de interfaz". El comportamiento (zoom, bordes que se estiran, selección) ya se arregló en `1e269cc`; esto es la parte visual.
- Corte del celular: `@media (max-width:860px)`; pantalla ancha: `@media not all and (max-width:860px)`. Táctil: `@media (hover:none)`. **En la pantalla ancha nada cambia.**
- Todo lo que se toca mide al menos `var(--tap)` (44 px). Los campos de texto en el celular miden 16 px de letra.
- Las animaciones mueven, nunca ocultan: nada empieza con `opacity:0` (si la animación no corre, el contenido igual se ve). Respetar `prefers-reduced-motion`.
- La traba de lo ya preparado en el editor y el "salir espera el guardado" no se tocan.
- Textos y comentarios en castellano rioplatense, explicando el porqué.
- Archivos con CRLF: editar con la herramienta Edit, no con `sed -i`.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pruebas: `npm test` (hoy 697 en verde), `npx tsc --noEmit -p .`, `npx eslint <archivos>`. Las guardas de interfaz van en `tests/app-movil.test.ts` (tiene un helper `fuente(rel)` que lee un archivo desde la raíz del repo).

---

### Task 1: Las ventanas suben desde abajo y se cierran deslizando

**Files:**
- Modify: `app/globals.css` (al final, una sección nueva "Hojas del celular")
- Modify: `components/ComportamientoDeApp.tsx`
- Modify: `tests/app-movil.test.ts`

**Interfaces:**
- Produces: clase de comportamiento global; ningún componente nuevo. Todas las ventanas usan `<div className="overlay" onClick={…}><div className="modal …">`; no se toca ninguna.

- [ ] **Step 1: Guardas que fallan.** Agregar a `tests/app-movil.test.ts`:

```ts
test("en el celular las ventanas suben desde abajo, a lo ancho", () => {
  const css = fuente("app/globals.css");
  const desde = css.indexOf("/* ===== Hojas del celular");
  assert.notEqual(desde, -1, "no está la sección de las hojas del celular");
  const seccion = css.slice(desde);
  assert.ok(/\.overlay\{[^}]*align-items:flex-end/.test(seccion), "las ventanas siguen flotando en el medio");
  assert.ok(/\.modal-xwide\{[^}]*border-radius:var\(--r-xl\) var\(--r-xl\) 0 0/.test(seccion), "la hoja no tiene la forma de las de una app");
  assert.ok(seccion.includes("env(safe-area-inset-bottom)"), "la hoja queda debajo de la barra de gestos");
});

test("deslizar hacia abajo cierra la hoja usando el mismo cierre que tocar afuera", () => {
  const s = fuente("components/ComportamientoDeApp.tsx");
  assert.ok(s.includes('"touchstart"') && s.includes('"touchend"'), "no hay gesto de deslizar");
  assert.ok(s.includes(".click()"), "el gesto no usa el cierre de cada ventana");
  assert.ok(s.includes("scrollTop"), "deslizar cerraría la hoja en vez de scrollear su contenido");
});
```

Correr `node --import tsx --test tests/app-movil.test.ts` → las dos nuevas fallan.

- [ ] **Step 2: CSS.** Agregar al final de `app/globals.css`:

```css
/* ===== Hojas del celular ===================================================
   En el teléfono, las ventanas suben desde abajo y ocupan el ancho, como en
   cualquier app: en el medio de la pantalla, con márgenes, parecían un aviso
   de una página web. La manija de arriba dice que se puede deslizar para
   cerrarla (el gesto vive en ComportamientoDeApp). */
@keyframes hoja-sube{from{transform:translateY(24px)}to{transform:none}}
@media (max-width:860px){
  .overlay{align-items:flex-end; padding:0; padding-top:var(--sp-8)}
  .modal, .modal.modal-wide, .modal.modal-xwide{
    max-width:none; border-radius:var(--r-xl) var(--r-xl) 0 0; border-bottom:none;
    max-height:calc(100dvh - var(--sp-8));
    padding-bottom:calc(var(--sp-5) + env(safe-area-inset-bottom));
    animation:hoja-sube var(--dur) var(--ease);
    position:relative; padding-top:calc(var(--sp-5) + var(--sp-2));
  }
  .modal.modal-sheet{padding-top:var(--sp-3); padding-bottom:0}
  .modal-sheet .sheet-foot{padding-bottom:calc(var(--sp-4) + env(safe-area-inset-bottom))}
  .modal::before{
    content:""; position:absolute; top:var(--sp-2); left:50%; transform:translateX(-50%);
    width:40px; height:4px; border-radius:var(--r-pill); background:var(--hair);
  }
  /* Los botones del pie, a lo ancho y apilados de a dos: se tocan con el pulgar. */
  .modal-actions{flex-wrap:wrap}
  .modal-actions .btn{flex:1 1 40%}
}
@media (prefers-reduced-motion:reduce){ .modal{animation:none} }
```

- [ ] **Step 3: El gesto.** En `components/ComportamientoDeApp.tsx`, dentro del mismo `useEffect`, agregar (y quitar en la limpieza):

```ts
    // Deslizar hacia abajo cierra la hoja, como en Android. No conoce a ningún
    // modal: al soltar, hace clic en su fondo, que es como ya se cierra cada
    // uno al tocar afuera. Si una ventana no se cierra tocando afuera (por
    // ejemplo, mientras borra), tampoco se cierra deslizando: vuelve a su lugar.
    // Solo arranca si lo que está bajo el dedo no está scrolleado: si no, el
    // gesto es para subir el contenido, no para cerrar.
    const celular = window.matchMedia("(max-width:860px)");
    let arrastre: { y: number; hoja: HTMLElement; fondo: HTMLElement } | null = null;
    const scrolleado = (desde: EventTarget | null, hoja: HTMLElement) => {
      for (let el = desde instanceof Element ? desde : null; el && el !== hoja.parentElement; el = el.parentElement) {
        if (el instanceof HTMLElement && el.scrollTop > 0) return true;
      }
      return false;
    };
    const alTocar = (e: TouchEvent) => {
      if (!celular.matches || e.touches.length !== 1) return;
      const hoja = e.target instanceof Element ? e.target.closest<HTMLElement>(".modal") : null;
      const fondo = hoja?.parentElement;
      if (!hoja || !fondo?.classList.contains("overlay") || scrolleado(e.target, hoja)) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      arrastre = { y: e.touches[0].clientY, hoja, fondo };
    };
    const alMover = (e: TouchEvent) => {
      if (!arrastre) return;
      const dy = e.touches[0].clientY - arrastre.y;
      arrastre.hoja.style.transition = "none";
      arrastre.hoja.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    };
    const alSoltar = (e: TouchEvent) => {
      if (!arrastre) return;
      const { hoja, fondo, y } = arrastre;
      arrastre = null;
      const dy = e.changedTouches[0].clientY - y;
      hoja.style.transition = "";
      hoja.style.transform = "";
      if (dy > 90) fondo.click();
    };
    document.addEventListener("touchstart", alTocar, { passive: true });
    document.addEventListener("touchmove", alMover, { passive: true });
    document.addEventListener("touchend", alSoltar);
    document.addEventListener("touchcancel", alSoltar);
```

y en la limpieza los cuatro `removeEventListener`. Actualizar el comentario de cabecera del componente con una viñeta: "Deslizar una hoja hacia abajo la cierra".

- [ ] **Step 4:** guardas en verde, `npx tsc --noEmit -p .`, `npx eslint components/ComportamientoDeApp.tsx tests/app-movil.test.ts`, `npm test`.
- [ ] **Step 5: Commit** `App móvil: las ventanas suben desde abajo y se cierran deslizando`.

---

### Task 2: Listas en vez de tablas

**Files:**
- Modify: `app/globals.css` (sección nueva "Tablas que en el celular son listas", al final)
- Modify: `components/Historial.tsx` (tabla de movimientos de stock), `app/(app)/aviso/[id]/page.tsx`, `components/EditEventModal.tsx`, `app/(app)/periodo/[id]/page.tsx` (las dos `summary-table`), `components/InventoryTable.tsx`
- Modify: `tests/app-movil.test.ts`

**Interfaces:**
- Produces: clase `tabla-lista` para cualquier `<table>`, y el atributo `data-label` en cada `<td>` que no sea el primero.

**La regla.** En el celular una `table.tabla-lista` no tiene encabezado; cada fila es una tarjeta: la primera celda es el título (en negrita, a lo ancho) y cada celda siguiente es una línea "Etiqueta: valor", donde la etiqueta sale de `data-label` (el mismo texto del `<th>` de esa columna). Las celdas vacías no ocupan lugar. En la pantalla ancha la tabla queda igual.

- [ ] **Step 1: Guardas que fallan.** Agregar a `tests/app-movil.test.ts`:

```ts
const TABLAS = [
  "components/Historial.tsx",
  "app/(app)/aviso/[id]/page.tsx",
  "components/EditEventModal.tsx",
  "app/(app)/periodo/[id]/page.tsx",
];

test("en el celular las tablas son listas: cada valor dice qué es", () => {
  const css = fuente("app/globals.css");
  assert.ok(/\.tabla-lista thead\{display:none\}/.test(css), "las tablas siguen mostrando el encabezado de columnas");
  assert.ok(css.includes("content:attr(data-label)"), "los valores quedan sin decir qué son");
  for (const archivo of TABLAS) {
    const s = fuente(archivo);
    assert.ok(s.includes("tabla-lista"), `${archivo}: la tabla no se vuelve lista en el celular`);
    assert.ok(s.includes("data-label="), `${archivo}: las celdas no dicen qué columna son`);
  }
});

test("el inventario en el celular no muestra encabezado de columnas", () => {
  const css = fuente("app/globals.css");
  assert.ok(/\.inventory-table thead\{display:none\}/.test(css), "el inventario sigue con PRODUCTO / STOCK arriba");
});
```

- [ ] **Step 2: CSS.** Agregar al final de `app/globals.css`:

```css
/* ===== Tablas que en el celular son listas ==================================
   Una tabla con encabezado de columnas es de página web. En el teléfono cada
   fila es una tarjeta: el título arriba y cada dato con su nombre al lado
   ("Antes: 12"). El nombre sale de data-label, el mismo texto del encabezado. */
@media (max-width:860px){
  .tabla-lista{min-width:0}
  .tabla-lista thead{display:none}
  .tabla-lista tbody tr{display:flex; flex-direction:column; gap:2px; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--hair)}
  .tabla-lista tbody tr:last-child{border-bottom:none}
  .tabla-lista tbody td{padding:0; border:none; font-size:var(--t-sm); color:var(--muted)}
  .tabla-lista tbody td:first-child{font-size:var(--t-base); color:var(--ink); font-weight:600}
  .tabla-lista tbody td[data-label]::before{content:attr(data-label) ": "; color:var(--muted); font-weight:500}
  .tabla-lista tbody td:empty{display:none}
  /* Las filas de sección ("ENSERES") de las tablas agrupadas siguen siendo
     un rótulo, no una tarjeta. */
  .tabla-lista tbody tr.cat-row{padding:var(--sp-2) var(--sp-4); background:var(--surface-2)}
  .inventory-table thead{display:none}
}
```

- [ ] **Step 3: Marcar las tablas.** En cada archivo de `TABLAS`, a cada `<table …>` agregarle la clase `tabla-lista` (sumándola a la que tenga, ej. `className="summary-table tabla-lista"`), y a cada `<td>` que NO sea el primero de su fila, `data-label="<texto del th de esa columna>"`. Si un encabezado es dinámico (`{multiEvent ? "Por evento" : "Evento"}`), el `data-label` usa la misma expresión. Si una celda ya contiene su propia etiqueta o es una celda que ocupa toda la fila (`colSpan`), no lleva `data-label`. No cambiar ningún dato ni el orden de las columnas.
  - Ojo: `ShortagesModal.tsx` y `OrderReadOnly.tsx` ya tienen su propia versión del celular; no se tocan.
  - En `periodo/[id]/page.tsx`, si las filas de sector usan `className="cat-row"`, mantenerla.

- [ ] **Step 4:** guardas en verde, `npx tsc --noEmit -p .`, `npx eslint` de los archivos tocados, `npm test`.
- [ ] **Step 5: Commit** `App móvil: en el celular las tablas son listas`.

---

### Task 3: Cabeceras completas y filtros en una fila

**Files:**
- Modify: `components/Preparar.tsx` (cabecera del evento)
- Modify: `components/InventoryTable.tsx` (filtros de categoría)
- Modify: `app/globals.css`
- Modify: `tests/app-movil.test.ts`

- [ ] **Step 1: Guardas que fallan.**

```ts
test("Preparar muestra el lugar entero: el lugar arriba y cuándo abajo", () => {
  const s = fuente("components/Preparar.tsx");
  assert.ok(!s.includes("· {data.evento.esHoy"), "la cabecera sigue en una línea y el lugar se corta");
  assert.ok(/\.prep-titulo\{[^}]*flex-direction:column/.test(fuente("app/globals.css")), "el lugar y la fecha siguen compitiendo por la misma línea");
});

test("en Inventario los filtros van en una fila que se desliza", () => {
  assert.ok(fuente("components/InventoryTable.tsx").includes('className="filtros-scroll"'), "los filtros de Inventario se apilan en dos líneas");
});

test("en el celular los títulos de las pantallas son de app, no de página", () => {
  assert.ok(/\.topbar h1\{font-size:var\(--t-xl\)/.test(fuente("app/globals.css")), "los títulos siguen del tamaño de la computadora");
});
```

- [ ] **Step 2: Preparar.** En `components/Preparar.tsx`, el título de la cabecera pasa a dos líneas (sacar el `·` de adelante):

```tsx
          <div className="prep-titulo">
            <b>{data.evento.lugar}</b>
            <span className="prep-cuando">
              {data.evento.esHoy ? <span className="prep-hoy">HOY</span> : null} {data.evento.cuando}
            </span>
          </div>
```

y actualizar el comentario de arriba ("Dos líneas: el lugar arriba, entero si entra, y cuándo abajo. En una sola, en un teléfono de 360 px el lugar quedaba en 'MUS…'."). En `app/globals.css`, la regla `.prep-titulo{…}` pasa a:

```css
.prep-titulo{flex:1; min-width:0; display:flex; flex-direction:column; gap:0; color:var(--muted); font-size:var(--t-sm); line-height:1.25}
```

y `.prep-titulo b{…}` suma `white-space:nowrap; text-overflow:ellipsis` (además de lo que tiene). Actualizar su comentario.

- [ ] **Step 3: Inventario.** En `components/InventoryTable.tsx`, envolver los botones de categoría (las pestañas `.tab`, sin el buscador ni "Nuevo producto") en `<div className="filtros-scroll"> … </div>`, igual que en el editor del pedido.

- [ ] **Step 4: Títulos.** En `app/globals.css`, dentro del `@media(max-width:860px){ … }` de "Mobile" (el que tiene `.app{grid-template-columns:1fr}`), agregar:

```css
  /* Títulos de app: del tamaño de la computadora ocupaban dos renglones. */
  .topbar h1{font-size:var(--t-xl)}
  .topbar .sub{font-size:var(--t-xs)}
```

- [ ] **Step 5:** guardas en verde, tsc, eslint, `npm test`. **Step 6: Commit** `App móvil: cabeceras completas y filtros en una fila`.

---

### Task 4: Los avisos son filas tocables

**Files:**
- Modify: `app/globals.css` (reglas de `.revision-item`)
- Modify: `tests/app-movil.test.ts`

- [ ] **Step 1: Guarda que falla.**

```ts
test("los avisos para revisar son filas tocables, no enlaces subrayados", () => {
  const css = fuente("app/globals.css");
  assert.ok(/\.revision-item > a\{[^}]*display:flex/.test(css), "los avisos siguen siendo un párrafo con enlaces");
  assert.ok(/\.revision-item > a\{[^}]*text-decoration:none/.test(css), "los avisos siguen subrayados");
  assert.ok(css.includes("-webkit-line-clamp:2"), "un aviso largo ocupa media pantalla");
});
```

- [ ] **Step 2: CSS.** Reemplazar las reglas `.revision-item a{…}` y `.revision-item a:hover{…}` por:

```css
/* Cada aviso con enlace es una fila que se toca entera, con una flecha: como
   la lista de una app. Antes era un párrafo con enlaces subrayados, y uno largo
   (la lista de 20 eventos de un faltante) ocupaba media pantalla. Se corta en
   dos renglones; el detalle está al abrirlo. */
.revision-item:has(> a){padding-left:0}
.revision-item:has(> a)::before{content:none}
.revision-item > a{
  display:flex; align-items:center; gap:var(--sp-2); min-height:var(--tap);
  padding:var(--sp-2) var(--sp-3); border-radius:var(--r-md);
  background:color-mix(in srgb, var(--surface) 70%, transparent);
  color:var(--ink); text-decoration:none;
}
.revision-item.grav-alta > a{box-shadow:inset 3px 0 0 var(--crit)}
.revision-item > a > span, .revision-item > a{overflow-wrap:anywhere}
.revision-item > a::after{content:"›"; margin-left:auto; flex:none; font-size:var(--t-xl); color:var(--muted)}
.revision-texto{display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; min-width:0}
@media (hover:hover){ .revision-item > a:hover{color:var(--gold)} }
```

Y en `components/ParaRevisar.tsx`, el texto del enlace va dentro de `<span className="revision-texto">{h.message}</span>` (así el corte en dos renglones no se come la flecha). Agregar `components/ParaRevisar.tsx` a los archivos del commit.

- [ ] **Step 3:** guarda en verde, tsc, eslint, `npm test`. **Step 4: Commit** `App móvil: los avisos para revisar son filas tocables`.

---

### Task 5: Respuesta al tocar y sin efectos de mouse pegados

**Files:**
- Modify: `app/globals.css` (sección nueva al final)
- Modify: `tests/app-movil.test.ts`

**El problema.** En una pantalla táctil, `:hover` queda "pegado" después de tocar: la tarjeta del evento queda levantada (`.event:hover{transform:translateY(-2px)}`), las filas quedan resaltadas. Y al tocar no hay ninguna respuesta visible hasta que la pantalla cambia, que es lo que hace que una página "no se sienta" una app.

- [ ] **Step 1: Guarda que falla.**

```ts
test("en pantallas táctiles tocar se ve, y el hover no queda pegado", () => {
  const css = fuente("app/globals.css");
  const desde = css.indexOf("/* ===== Al tocar");
  assert.notEqual(desde, -1, "no está la sección de la respuesta al tocar");
  const seccion = css.slice(desde);
  assert.ok(seccion.includes("@media (hover:none)"), "la respuesta al tocar no se limita a pantallas táctiles");
  assert.ok(seccion.includes(":active"), "tocar no tiene respuesta visible");
  assert.ok(/\.event:hover\{[^}]*transform:none/.test(seccion), "la tarjeta del evento queda levantada después de tocarla");
});
```

- [ ] **Step 2: CSS.** Agregar al final de `app/globals.css`:

```css
/* ===== Al tocar =============================================================
   En una pantalla táctil, el :hover queda pegado después de tocar (la tarjeta
   queda levantada, la fila resaltada) y tocar no tiene respuesta hasta que la
   pantalla cambia. Acá: sin hover pegado, y todo lo que se toca se apaga un
   instante mientras el dedo está apoyado, como en Android. */
@media (hover:none){
  .event:hover{transform:none; box-shadow:var(--shadow); border-color:var(--hair)}
  .event:hover .event-foot{color:var(--muted)}
  .orow:hover{background:transparent}
  .orow.has-qty:hover{background:color-mix(in srgb,var(--gold) 5%,var(--surface))}
  tbody tr:hover{background:transparent}
  .btn:hover{background:var(--surface); border-color:var(--hair)}
  .btn.ghost:hover{background:transparent}
  .btn.primary:hover{background:var(--brand); border-color:var(--brand)}
  .tab:hover{background:var(--surface); color:var(--muted)}
  .tab.active:hover{background:var(--ink); color:var(--ground)}
  .qbtn:hover{background:var(--surface-2); border-color:var(--hair)}
  :where(.btn, .tab, .qbtn, .event, .event-falta, .copy-row, .prep-fila, .mobnav a,
         .mobnav button, .rowmenu-list button, .revision-item > a, .resp-chip-btn,
         .pname-btn, .topbar-volver, .rowmenu-btn, .nav, .step-btn):active{
    opacity:.6; transition:opacity 0s;
  }
}
```

- [ ] **Step 3:** guarda en verde, tsc, `npm test`. **Step 4: Commit** `App móvil: respuesta al tocar y sin hover pegado`.

---

## Verificación (la hace el controlador)

Sobre la copia de producción, con la app local, a 360×780:

1. Abrir "Ver faltantes", "Repetir pedido", "Borrar evento" y "Responsable": suben desde abajo a lo ancho, con la manija; deslizar hacia abajo las cierra; "Borrando…" no se cierra.
2. Historial → Movimientos, un aviso, el Resumen del depósito y el historial de "Editar evento": tarjetas con "Etiqueta: valor", sin encabezado ni scroll de costado.
3. Preparar de un evento con nombre largo: el lugar entero.
4. Inventario: filtros en una fila; sin "PRODUCTO / STOCK".
5. Avisos: filas con ›, sin subrayado, cortadas en dos renglones.
6. Tocar una tarjeta de evento y volver: no queda levantada.
7. Pantalla ancha (1280): todo igual que antes.
