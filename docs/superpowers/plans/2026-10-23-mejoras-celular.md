# Cinco mejoras del celular — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la app instalada se porte como una app también en lo que falta: sin señal muestra lo suyo, Preparar salta entre sectores, el teléfono vibra al tildar, se tira hacia abajo para actualizar y los textos chicos se leen.

**Architecture:** cinco piezas independientes. (1) El service worker devuelve una página propia cuando no hay red al abrir, y un componente en el layout de la app avisa cuando la señal se corta y vuelve. (2) Preparar suma una fila fija de saltos a cada sector. (3) Un ayudante `vibrar()` que no hace nada donde no hay vibración. (4) Un componente de "tirar para actualizar", solo en Período, Preparar y Avisos, con la decisión del gesto en una función pura probada. (5) Una ficha de tipografía de 12 px para los textos de contenido en el celular.

**Tech Stack:** Next.js 16, React 19 (componentes de cliente), service worker en `public/sw.js`, CSS en `app/globals.css`, pruebas con `node --test` + `tsx`.

## Global Constraints

- Pedido del usuario (23/10), tras recorrer la app: "hacé las cinco mejoras como las propusiste". Las cinco: sin señal (página propia + franja), saltar entre sectores en Preparar, vibración al tildar, tirar hacia abajo para actualizar (Preparar, Avisos, portada) y letra mínima de 12 px en los textos chicos.
- Corte del celular: `@media (max-width:860px)`; pantalla ancha: `@media not all and (max-width:860px)`. En la pantalla ancha nada cambia, salvo lo que no depende del ancho (la página sin conexión y la franja de "sin conexión" valen para todos).
- Todo lo que se toca mide al menos `var(--tap)` (44 px).
- Las animaciones mueven, nunca ocultan (nada empieza en `opacity:0`), y respetan `prefers-reduced-motion`.
- **El service worker nunca guarda páginas ni datos** (regla vigente de `public/sw.js`: el stock y los pedidos jamás se ven desactualizados). Solo puede guardar la página estática de "sin conexión".
- "Tirar para actualizar" no existe en el editor del pedido (`/evento/…`): ahí hay cantidades sin guardar y la pantalla no se recarga desde el servidor.
- Textos y comentarios en castellano rioplatense, explicando el porqué. Sin promesas que la app no cumple (ej. no decir "se guarda solo" donde no se guarda).
- Archivos con CRLF: editar con la herramienta Edit, no con `sed -i`.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pruebas: `npm test` (hoy 723 en verde), `npx tsc --noEmit -p .`, `npx eslint <archivos>`. Las guardas de interfaz van en `tests/app-movil.test.ts` (helper `fuente(rel)`; `app/globals.css` es CRLF: normalizar `\r\n` antes de cortar por renglón).

---

### Task 1: Sin señal

**Files:**
- Create: `public/sin-conexion.html`
- Modify: `public/sw.js`
- Create: `components/SinConexion.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `app/globals.css` (al final, sección "Sin conexión")
- Modify: `tests/app-movil.test.ts`

- [ ] **Step 1: Guardas que fallan.**

```ts
test("sin red, la app abre una página propia y no el dinosaurio del navegador", () => {
  const sw = fuente("public/sw.js");
  assert.ok(sw.includes('"/sin-conexion.html"'), "el service worker no conoce la página sin conexión");
  assert.ok(sw.includes('req.mode === "navigate"'), "abrir una pantalla sin red no tiene respuesta propia");
  const html = fuente("public/sin-conexion.html");
  assert.ok(html.includes("Sin conexión") && html.includes("Reintentar"), "la página sin conexión no explica ni deja reintentar");
});

test("si se corta la señal, la app lo dice arriba y se pone al día cuando vuelve", () => {
  const s = fuente("components/SinConexion.tsx");
  assert.ok(s.includes('"offline"') && s.includes('"online"'), "nadie escucha si se corta o vuelve la señal");
  assert.ok(s.includes("router.refresh()"), "al volver la señal la pantalla queda vieja");
  assert.ok(fuente("app/(app)/layout.tsx").includes("<SinConexion />"), "el layout no monta el aviso de sin conexión");
});
```

- [ ] **Step 2: `public/sin-conexion.html`.** Una página autocontenida (CSS en línea, sin scripts externos), que respete el tema del sistema (`prefers-color-scheme`) con los mismos fondos de la app (`#FBFAF8` claro, `#0E0E0D` oscuro):

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Sin conexión · Didier Stamatti</title>
<style>
  :root{color-scheme:light dark; --fondo:#FBFAF8; --tinta:#1A1917; --suave:#6B6862; --boton:#1A1917; --sobre-boton:#FBFAF8}
  @media (prefers-color-scheme:dark){:root{--fondo:#0E0E0D; --tinta:#F2F0EC; --suave:#A29E97; --boton:#F2F0EC; --sobre-boton:#0E0E0D}}
  html,body{margin:0; height:100%; background:var(--fondo); color:var(--tinta); font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{min-height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; box-sizing:border-box; text-align:center}
  h1{margin:0; font-size:22px}
  p{margin:0; max-width:32ch; color:var(--suave); line-height:1.45}
  button{margin-top:12px; min-height:48px; padding:0 28px; border:0; border-radius:12px; background:var(--boton); color:var(--sobre-boton); font-size:16px; font-weight:600}
</style>
</head>
<body>
<main>
  <h1>Sin conexión</h1>
  <p>El teléfono no tiene señal ni wifi. Cuando vuelva, tocá Reintentar.</p>
  <button type="button" onclick="location.reload()">Reintentar</button>
</main>
</body>
</html>
```

- [ ] **Step 3: `public/sw.js`.**
  - En `install`: además de `skipWaiting`, guardar la página en el caché: `event.waitUntil(caches.open(CACHE).then((c) => c.add("/sin-conexion.html")).then(() => self.skipWaiting()))` (el listener pasa a recibir `event`).
  - Cambiar `CACHE` a `"didier-static-v2"` (así el `activate` borra el viejo y el nuevo trae la página).
  - En `fetch`, antes de la condición de recursos inmutables, las navegaciones:

```js
  // Abrir una pantalla sin red: en vez del dinosaurio del navegador, la página
  // propia de "sin conexión". La pantalla en sí NUNCA se guarda: con red se pide
  // siempre al servidor, así el stock y los pedidos no se ven viejos.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/sin-conexion.html")) ?? Response.error()),
    );
    return;
  }
```

  - Actualizar el comentario de cabecera del archivo con una línea sobre la página sin conexión.

- [ ] **Step 4: `components/SinConexion.tsx`.**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Una franja arriba cuando el teléfono se queda sin señal, y un "volvió" corto
 *  cuando vuelve. En el depósito la señal va y viene: sin esto, un tilde que no
 *  se guardó solo mostraba un error genérico. Al volver, la pantalla se pide de
 *  nuevo, porque lo que muestra puede haber quedado viejo. */
export function SinConexion() {
  const router = useRouter();
  const [estado, setEstado] = useState<"con" | "sin" | "volvio">("con");

  useEffect(() => {
    if (!navigator.onLine) setEstado("sin");
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const sin = () => {
      clearTimeout(reloj);
      setEstado("sin");
    };
    const con = () => {
      setEstado("volvio");
      router.refresh();
      reloj = setTimeout(() => setEstado("con"), 2500);
    };
    window.addEventListener("offline", sin);
    window.addEventListener("online", con);
    return () => {
      clearTimeout(reloj);
      window.removeEventListener("offline", sin);
      window.removeEventListener("online", con);
    };
  }, [router]);

  if (estado === "con") return null;
  return (
    <div className={`sin-conexion${estado === "volvio" ? " volvio" : ""}`} role="status" aria-live="polite">
      {estado === "sin"
        ? "Sin conexión. Lo que toques no se guarda hasta que vuelva la señal."
        : "Volvió la conexión."}
    </div>
  );
}
```

- [ ] **Step 5: Layout.** En `app/(app)/layout.tsx`, importar `SinConexion` y montarlo como primer hijo de `<div className="app">`, con un comentario corto.

- [ ] **Step 6: CSS.** Al final de `app/globals.css`:

```css
/* ===== Sin conexión ========================================================
   La franja va fija arriba, por encima de la cabecera, y no tapa nada que se
   toque: es un aviso, no un bloqueo. */
.sin-conexion{
  position:fixed; z-index:40; left:50%; transform:translateX(-50%);
  top:calc(var(--sp-2) + env(safe-area-inset-top));
  max-width:calc(100% - var(--sp-6)); padding:var(--sp-2) var(--sp-4);
  border-radius:var(--r-pill); background:var(--crit); color:#fff;
  font-size:var(--t-sm); font-weight:650; text-align:center;
  box-shadow:0 6px 20px rgba(0,0,0,.25); pointer-events:none;
}
.sin-conexion.volvio{background:var(--ok)}
```

- [ ] **Step 7:** guardas en verde, `npx tsc --noEmit -p .`, `npx eslint components/SinConexion.tsx "app/(app)/layout.tsx" tests/app-movil.test.ts`, `npm test`. **Commit** `Celular: sin señal, una página propia y una franja que avisa`.

---

### Task 2: Preparar salta entre sectores

**Files:**
- Modify: `components/Preparar.tsx`
- Modify: `app/globals.css`
- Modify: `tests/app-movil.test.ts`

- [ ] **Step 1: Guarda que falla.**

```ts
test("en Preparar se salta a cada sector desde una fila fija, con su avance", () => {
  const s = fuente("components/Preparar.tsx");
  assert.ok(s.includes('className="prep-saltos'), "no hay fila de saltos a los sectores");
  assert.ok(s.includes("href={`#sector-${s.category}`}"), "los saltos no llevan a cada sector");
  assert.ok(s.includes("id={`sector-${s.category}`}"), "los sectores no tienen a dónde saltar");
  assert.ok(/\.prep-seccion\{[^}]*scroll-margin-top/.test(fuente("app/globals.css")), "el salto deja el título del sector debajo de la cabecera fija");
});
```

- [ ] **Step 2: Componente.** En `components/Preparar.tsx`:
  - La `<section>` de "Cambios para aplicar" suma `id="aplicar"`; cada sección de sector suma `id={`sector-${s.category}`}`.
  - Dentro de `.prep-cabecera`, después de `.prep-cabecera-fila` (y antes del error), una fila de saltos que aparece solo si hay dos destinos o más (cambios para aplicar + sectores):

```tsx
        {/* Saltos a cada sector, con su avance: para ir de Enseres a Bebida no
            hay que recorrer la lista entera. Fija con la cabecera. */}
        {(paraAplicar.length > 0 ? 1 : 0) + sectores.length > 1 && (
          <nav className="prep-saltos filtros-scroll" aria-label="Ir a un sector">
            {paraAplicar.length > 0 && (
              <a href="#aplicar" className="prep-salto aplicar">Cambios {paraAplicar.length}</a>
            )}
            {sectores.map((s) => (
              <a key={s.category} href={`#sector-${s.category}`} className={`prep-salto${s.listos === s.total ? " ok" : ""}`}>
                {s.label} {s.listos}/{s.total}
              </a>
            ))}
          </nav>
        )}
```

  (Ojo: `paraAplicar` y `sectores` se calculan antes del `return`; ya existen.)

- [ ] **Step 3: CSS.** Junto a las reglas `.prep-*` de `app/globals.css`:

```css
/* Los saltos a cada sector van en la cabecera fija; en el celular se deslizan
   de costado (filtros-scroll) y en la computadora entran en una fila. */
.prep-saltos{display:flex; gap:var(--sp-2); padding:0 var(--sp-4) var(--sp-2); flex-wrap:wrap}
.prep-salto{
  display:inline-flex; align-items:center; min-height:var(--tap); padding:0 var(--sp-3);
  border:1px solid var(--hair); border-radius:var(--r-pill); background:var(--surface);
  color:var(--ink); font-size:var(--t-sm); font-weight:650; text-decoration:none; white-space:nowrap; flex:none;
}
.prep-salto.ok{color:var(--ok); border-color:var(--ok)}
.prep-salto.aplicar{color:var(--warn); border-color:var(--warn)}
/* Al saltar, el título del sector queda debajo de la cabecera fija y no tapado. */
.prep-seccion{scroll-margin-top:130px}
```

  y en la regla existente `.prep-seccion{…}` si ya existe una, sumar ahí el `scroll-margin-top` en vez de duplicar el selector (el test busca `.prep-seccion{` con `scroll-margin-top`). En el celular `filtros-scroll` ya la vuelve una fila que se desliza (`display:flex; overflow-x:auto; flex-wrap:nowrap`); verificar que la regla del celular gane al `flex-wrap:wrap` de arriba (mismo peso, el bloque del celular está después en el archivo).

- [ ] **Step 4:** guarda en verde, tsc, eslint, `npm test`. **Commit** `Celular: Preparar salta a cada sector desde la cabecera`.

---

### Task 3: El teléfono vibra al tildar

**Files:**
- Create: `lib/vibrar.ts`
- Create: `tests/vibrar.test.ts`
- Modify: `components/Preparar.tsx`
- Modify: `tests/app-movil.test.ts`

- [ ] **Step 1: Pruebas que fallan.** `tests/vibrar.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { vibrar, PATRON } from "../lib/vibrar";

/** Un toque corto al tildar, como en cualquier app: quien prepara con la caja
 *  en la otra mano sabe que se marcó sin mirar. Donde no hay vibración (iPhone,
 *  la computadora) no hace nada y nunca rompe. */

test("vibra con el patrón pedido cuando el teléfono puede", () => {
  const llamadas: unknown[] = [];
  vibrar(PATRON.tildar, { vibrate: (p: number | number[]) => { llamadas.push(p); return true; } });
  assert.deepEqual(llamadas, [PATRON.tildar]);
});

test("sin vibración no hace nada", () => {
  assert.doesNotThrow(() => vibrar(PATRON.tildar, {}));
});

test("si vibrar falla, no rompe la pantalla", () => {
  assert.doesNotThrow(() => vibrar(PATRON.tildar, { vibrate: () => { throw new Error("no"); } }));
});

test("destildar se siente distinto que tildar", () => {
  assert.notDeepEqual(PATRON.destildar, PATRON.tildar);
});
```

  Y en `tests/app-movil.test.ts`:

```ts
test("en Preparar el teléfono vibra al tildar y al destildar", () => {
  const s = fuente("components/Preparar.tsx");
  const desde = s.indexOf("function alternar");
  const cuerpo = s.slice(desde, s.indexOf("\n  }", desde));
  assert.ok(cuerpo.includes("vibrar("), "tildar no da ninguna señal física");
});
```

- [ ] **Step 2: `lib/vibrar.ts`.**

```ts
// Una vibración corta como respuesta a un toque, como en las apps del teléfono.
// En iPhone y en la computadora no hay `navigator.vibrate`: ahí no hace nada.
// Nunca rompe: una vibración que falla no puede tirar abajo un tilde.

export const PATRON = {
  tildar: 12,
  destildar: [8, 40, 8],
  tildarSector: 24,
} as const;

type ConVibracion = { vibrate?: (patron: number | number[]) => boolean };

export function vibrar(patron: number | readonly number[], nav: ConVibracion = typeof navigator === "undefined" ? {} : navigator) {
  try {
    nav.vibrate?.(Array.isArray(patron) ? [...patron] : (patron as number));
  } catch {
    // Sin vibración no pasa nada.
  }
}
```

- [ ] **Step 3: Usarlo.** En `components/Preparar.tsx`: `import { vibrar, PATRON } from "@/lib/vibrar";`. En `alternar`, justo antes de `void correr(…)`: `vibrar(i.estado === "PREPARADO" ? PATRON.destildar : PATRON.tildar);`. En `tildarSector`, antes de `void correr(…)`: `vibrar(PATRON.tildarSector);`.

- [ ] **Step 4:** pruebas en verde, tsc, eslint, `npm test`. **Commit** `Celular: el teléfono vibra al tildar en Preparar`.

---

### Task 4: Tirar hacia abajo para actualizar

**Files:**
- Create: `lib/tirar.ts`
- Create: `tests/tirar.test.ts`
- Create: `components/TirarParaActualizar.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `app/globals.css`
- Modify: `tests/app-movil.test.ts`

**Interfaces:**
- `lib/tirar.ts` exporta `UMBRAL = 70`, `MAXIMO = 96`, `pantallaConTiron(pathname: string): boolean` y `estadoDelTiron(dy: number, dx: number): { visible: boolean; y: number; listo: boolean }`.

- [ ] **Step 1: Pruebas que fallan.** `tests/tirar.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDelTiron, pantallaConTiron, UMBRAL, MAXIMO } from "../lib/tirar";

test("tirar para actualizar existe en Período, Preparar y Avisos", () => {
  for (const p of ["/", "/preparar", "/preparar/abc123", "/notificaciones"]) assert.equal(pantallaConTiron(p), true, p);
});

test("no existe en el editor del pedido ni en las demás pantallas", () => {
  for (const p of ["/evento/abc", "/evento/abc/pdf", "/inventario", "/cuenta", "/historial"]) assert.equal(pantallaConTiron(p), false, p);
});

test("un movimiento de costado o hacia arriba no es un tirón", () => {
  assert.equal(estadoDelTiron(30, 60).visible, false);
  assert.equal(estadoDelTiron(-40, 0).visible, false);
});

test("un temblor no muestra nada", () => {
  assert.equal(estadoDelTiron(8, 0).visible, false);
});

test("el indicador baja a la mitad de lo que baja el dedo, con un tope", () => {
  assert.equal(estadoDelTiron(60, 0).y, 30);
  assert.equal(estadoDelTiron(1000, 0).y, MAXIMO);
});

test("está listo para soltar recién pasado el umbral", () => {
  assert.equal(estadoDelTiron(UMBRAL * 2 - 2, 0).listo, false);
  assert.equal(estadoDelTiron(UMBRAL * 2 + 2, 0).listo, true);
});
```

  Y en `tests/app-movil.test.ts`:

```ts
test("el tirón para actualizar está montado y no pelea con las hojas", () => {
  assert.ok(fuente("app/(app)/layout.tsx").includes("<TirarParaActualizar />"), "no hay tirar para actualizar");
  const s = fuente("components/TirarParaActualizar.tsx");
  assert.ok(s.includes(".overlay"), "tirar dentro de una hoja actualizaría la pantalla de atrás");
  assert.ok(s.includes("router.refresh()"), "soltar no actualiza");
  assert.ok(s.includes("scrollY"), "tirar en el medio de la lista actualizaría en vez de scrollear");
});
```

- [ ] **Step 2: `lib/tirar.ts`.**

```ts
// La decisión del gesto "tirar hacia abajo para actualizar", sin DOM, para
// poder probarla. El componente solo mide el dedo y dibuja.

/** Cuánto tiene que bajar el indicador (no el dedo) para que soltar actualice. */
export const UMBRAL = 70;
/** Hasta dónde baja el indicador aunque el dedo siga. */
export const MAXIMO = 96;

/** Dónde existe: las listas que se miran para ver si llegó algo. El editor del
 *  pedido no: ahí hay cantidades sin guardar y la pantalla no se recarga. */
export function pantallaConTiron(pathname: string): boolean {
  return pathname === "/" || pathname === "/preparar" || pathname.startsWith("/preparar/") || pathname === "/notificaciones";
}

/** dy y dx: cuánto se movió el dedo desde que tocó, hacia abajo y de costado.
 *  El indicador baja a la mitad (se siente "pesado", como en las apps). */
export function estadoDelTiron(dy: number, dx: number): { visible: boolean; y: number; listo: boolean } {
  if (dy <= 10 || Math.abs(dx) >= dy) return { visible: false, y: 0, listo: false };
  const y = Math.min(dy / 2, MAXIMO);
  return { visible: true, y, listo: y >= UMBRAL };
}
```

- [ ] **Step 3: `components/TirarParaActualizar.tsx`.** Componente de cliente que:
  - usa `usePathname()` y no hace nada si `!pantallaConTiron(pathname)`;
  - escucha en `document` `touchstart` (pasivo), `touchmove` (pasivo), `touchend` y `touchcancel`;
  - arranca solo si: un solo dedo, `window.scrollY <= 0`, y el toque NO está dentro de `.overlay`, `.mobmas-fondo` ni de un campo (`input, textarea, select`); guarda `identifier`, `x`, `y` del dedo (mismo criterio que el gesto de las hojas en `ComportamientoDeApp.tsx`: seguir solo a ese dedo);
  - en cada `touchmove` de ese dedo calcula `estadoDelTiron(dy, dx)` y lo guarda en estado (si deja de ser visible porque fue de costado, suelta el gesto);
  - en `touchend` de ese dedo: si `listo`, muestra "actualizando" y llama `startTransition(() => router.refresh())` (con `useTransition`); el indicador se va cuando `isPending` vuelve a `false`. Si no, se va. `touchcancel` solo lo esconde;
  - dibuja (solo si visible o actualizando):

```tsx
    <div
      className={`tiron${listo ? " listo" : ""}${actualizando ? " actualizando" : ""}`}
      style={{ transform: `translate(-50%, ${actualizando ? UMBRAL : y}px)` }}
      role="status"
      aria-label={actualizando ? "Actualizando" : listo ? "Soltá para actualizar" : "Tirá para actualizar"}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" />
      </svg>
    </div>
```

  Con un comentario de cabecera que explique dónde existe y por qué no en el editor. Montarlo en `app/(app)/layout.tsx` (junto a `SinConexion` si ya está, si no como primer hijo de `.app`).

- [ ] **Step 4: CSS.** Al final de `app/globals.css`:

```css
/* ===== Tirar para actualizar ===============================================
   El indicador baja con el dedo; la flecha gira hasta "listo" y, al soltar,
   gira sola mientras se actualiza. */
@keyframes tiron-gira{to{transform:rotate(360deg)}}
.tiron{
  position:fixed; z-index:35; left:50%; top:calc(-40px + env(safe-area-inset-top));
  width:40px; height:40px; border-radius:50%; display:grid; place-items:center;
  background:var(--surface); border:1px solid var(--hair); color:var(--muted);
  box-shadow:0 6px 18px rgba(0,0,0,.2); pointer-events:none;
}
.tiron svg{width:20px; height:20px; transition:transform var(--dur) var(--ease)}
.tiron.listo{color:var(--gold)}
.tiron.listo svg{transform:rotate(180deg)}
.tiron.actualizando{color:var(--gold)}
.tiron.actualizando svg{animation:tiron-gira .8s linear infinite}
@media (prefers-reduced-motion:reduce){ .tiron.actualizando svg{animation:none} }
```

- [ ] **Step 5:** pruebas en verde, tsc, eslint, `npm test`. **Commit** `Celular: tirar hacia abajo para actualizar en Período, Preparar y Avisos`.

---

### Task 5: Los textos chicos se leen

**Files:**
- Modify: `app/globals.css`
- Modify: `tests/app-movil.test.ts`

Hoy `--t-xs` es 11 px. En el celular, los textos de contenido que lo usan pasan a 12 px (escalando con la letra elegida en Cuenta). Las etiquetas de la barra de abajo quedan en 11: entran justas en 360 px con seis botones y es el tamaño de las barras de las apps.

- [ ] **Step 1: Guarda que falla.**

```ts
test("en el celular los textos de contenido miden al menos 12 px", () => {
  const css = fuente("app/globals.css");
  assert.ok(css.includes("--t-chico:calc(12px * var(--fs))"), "no hay tamaño de 12 px para los textos chicos");
  for (const sel of [".orow-resumen", ".topbar .sub", ".topbar-pedido .sub", ".tile .k"]) {
    assert.ok(css.includes(`${sel}{font-size:var(--t-chico)}`), `${sel} sigue en 11 px`);
  }
});
```

- [ ] **Step 2: CSS.** En `:root` (junto a `--t-xs`) agregar `--t-chico:calc(12px * var(--fs));    /* textos de contenido chicos en el celular */`. Y en la sección "Celular (etapa 4)" (o la que corresponda, siempre dentro de `@media screen and (max-width:860px)`, después de las reglas que hoy les ponen `--t-xs`, para ganar):

```css
/* Textos de contenido chicos: 12 px en el celular. A 11 px, "Faltan 10" o la
   fecha debajo de un título costaban en el depósito. Las etiquetas de la barra
   de abajo quedan en 11: con seis botones entran justas en 360 px. */
@media screen and (max-width:860px){
  .orow-resumen{font-size:var(--t-chico)}
  .topbar .sub{font-size:var(--t-chico)}
  .topbar-pedido .sub{font-size:var(--t-chico)}
  .tile .k{font-size:var(--t-chico)}
}
```

  Verificar con una lectura del archivo que ninguna regla posterior las pise.

- [ ] **Step 3:** guarda en verde, `npm test`. **Commit** `Celular: los textos chicos de contenido miden 12 px`.

---

## Verificación (la hace el controlador)

Sobre la copia de producción, con la app local, a 360 y 390 px:
1. Cortar la red (DevTools offline en el navegador de prueba): aparece la franja; volver: "Volvió la conexión" y se va. Abrir una pantalla sin red: la página propia, no el dinosaurio.
2. Preparar de un evento con varios sectores: la fila de saltos; tocar "Bebida" deja el título de Bebida a la vista, debajo de la cabecera.
3. Tildar: `navigator.vibrate` se llama (espiar con un stub en la consola).
4. Tirar con toques simulados en Preparar, Avisos y la portada: el indicador aparece, gira al pasar el umbral y al soltar se actualiza; en el editor no aparece; dentro de una hoja no aparece.
5. Los textos chicos a 12 px; la barra de abajo de 6 botones sigue sin desbordar a 360 px.
6. Pantalla ancha: igual que antes salvo los saltos de Preparar (útiles también ahí).
