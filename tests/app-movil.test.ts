import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * La app instalada se tiene que comportar como una app, no como una página.
 *
 * El 23/10 el usuario la abrió en su teléfono y dijo: "se sigue pudiendo
 * achicar la pantalla, los bordes se mueven". No era que algo se saliera de la
 * pantalla —medido a 360 px, ninguna pantalla desborda— sino lo que el
 * navegador hace por defecto: el pellizco agranda y achica, Android estira la
 * página entera al pasarse del borde, el doble toque hace zoom y mantener
 * apretado selecciona texto o abre el menú de los enlaces.
 *
 * Se exige sobre el texto de los archivos, como el resto de las guardas de la
 * interfaz (`celular.test.ts`).
 */

function fuente(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

test("el pellizco no agranda ni achica la pantalla", () => {
  const s = fuente("app/layout.tsx");
  assert.ok(s.includes("export const viewport"), "el layout no declara el viewport");
  assert.ok(s.includes("userScalable: false"), "el viewport deja hacer zoom");
  assert.ok(s.includes("maximumScale: 1"), "el viewport deja agrandar");
});

test("los bordes no se estiran y el doble toque no hace zoom", () => {
  const css = fuente("app/globals.css");
  const html = css.slice(css.indexOf("\nhtml{"), css.indexOf("}", css.indexOf("\nhtml{")));
  assert.ok(html.includes("overscroll-behavior:none"), "Android estira la página al pasarse del borde");
  assert.ok(html.includes("touch-action:pan-x pan-y"), "el doble toque y el pellizco siguen haciendo zoom");
});

test("mantener apretado no selecciona la interfaz, pero los campos de texto sí", () => {
  const css = fuente("app/globals.css");
  assert.ok(/body\{[^}]*user-select:none/.test(css), "mantener apretado selecciona los nombres y botones");
  assert.ok(/:where\(input, textarea[^)]*\)\{[^}]*user-select:text/.test(css), "los campos de texto no dejan seleccionar para corregir");
});

test("el menú de mantener apretado un enlace no aparece en pantallas táctiles", () => {
  const s = fuente("components/ComportamientoDeApp.tsx");
  assert.ok(s.includes('"contextmenu"'), "no se frena el menú del navegador");
  assert.ok(s.includes("(pointer: coarse)"), "también se frenaría el clic derecho con mouse");
  assert.ok(s.includes('"gesturestart"'), "el iPhone sigue haciendo zoom con el pellizco");
  assert.ok(fuente("app/layout.tsx").includes("<ComportamientoDeApp />"), "el layout no monta el comportamiento de app");
});

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

test("el gesto sigue al dedo que lo empezó y un toque cancelado no cierra", () => {
  const s = fuente("components/ComportamientoDeApp.tsx");
  assert.ok(s.includes(".identifier"), "un segundo dedo puede cerrar la hoja");
  const cancelar = s.slice(s.indexOf('"touchcancel"'), s.indexOf('"touchcancel"') + 80);
  assert.ok(!cancelar.includes("alSoltar"), "un toque cancelado por el sistema cierra la hoja");
});

test("con el teclado abierto la pantalla se achica y la barra de abajo se esconde", () => {
  assert.ok(fuente("app/layout.tsx").includes('interactiveWidget: "resizes-content"'), "el teclado tapa las hojas");
  assert.ok(fuente("app/globals.css").includes("body:has(:is(input, textarea, select):focus) .mobnav{display:none}"), "la barra de abajo queda arriba del teclado");
});

test("los botones de las páginas no se estiran como los de las hojas", () => {
  assert.ok(fuente("app/globals.css").includes(".modal .modal-actions .btn{flex:1 1 40%}"), "el estilo de las hojas alcanza a las tarjetas de las páginas");
});
