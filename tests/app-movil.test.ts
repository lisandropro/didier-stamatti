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

test("en Historial cada movimiento se titula por el producto, no por la fecha", () => {
  const s = fuente("components/Historial.tsx");
  assert.ok(s.includes("celda-titulo"), "la tarjeta de un movimiento se titula con la fecha");
  assert.ok(s.includes('data-label="Fecha"'), "la fecha queda sin decir qué es");
  assert.ok(fuente("app/globals.css").includes(".tabla-lista tbody td.celda-titulo{order:-1"), "la celda título no encabeza la tarjeta");
});

test("el inventario esconde su encabezado solo donde esconde sus columnas", () => {
  // En Windows el CSS llega con CRLF: se pasa a LF para que los cortes por "}" caigan en el lugar.
  const css = fuente("app/globals.css").replace(/\r\n/g, "\n");
  const desde = css.indexOf("@media screen and (max-width:600px)");
  const hasta = css.indexOf("\n}\n", desde);
  assert.ok(desde !== -1 && hasta !== -1, "no se encuentra el bloque de 600 px del inventario");
  const bloque600 = css.slice(desde, hasta);
  assert.ok(bloque600.includes(".inventory-table thead{display:none}"), "entre 600 y 860 px el inventario muestra columnas sin nombre");
});

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

test("los avisos para revisar son filas tocables, no enlaces subrayados", () => {
  const css = fuente("app/globals.css");
  assert.ok(/\.revision-item > a\{[^}]*display:flex/.test(css), "los avisos siguen siendo un párrafo con enlaces");
  assert.ok(/\.revision-item > a\{[^}]*text-decoration:none/.test(css), "los avisos siguen subrayados");
  assert.ok(css.includes("-webkit-line-clamp:2"), "un aviso largo ocupa media pantalla");
  assert.ok(fuente("components/ParaRevisar.tsx").includes('<span className="revision-texto">{h.message}</span>'), "el texto del aviso no está en su propio span: el corte de dos renglones se come la flecha");
  // Las filas son solo del celular: en la pantalla ancha el aviso sigue siendo
  // el párrafo de siempre, con su enlace subrayado.
  assert.ok(/@media \(max-width:860px\)\{[^@]*\.revision-item > a\{/.test(css), "las filas tocables no están limitadas al celular");
  assert.ok(/@media not all and \(max-width:860px\)\{[^@]*\.revision-item a\{[^}]*text-decoration:underline/.test(css), "en la pantalla ancha el enlace del aviso dejó de estar subrayado");
});

test("en pantallas táctiles tocar se ve, y el hover no queda pegado", () => {
  const css = fuente("app/globals.css");
  const desde = css.indexOf("/* ===== Al tocar");
  assert.notEqual(desde, -1, "no está la sección de la respuesta al tocar");
  const seccion = css.slice(desde);
  assert.ok(seccion.includes("@media (hover:none)"), "la respuesta al tocar no se limita a pantallas táctiles");
  assert.ok(seccion.includes(":active"), "tocar no tiene respuesta visible");
  assert.ok(/\.event:hover\{[^}]*transform:none/.test(seccion), "la tarjeta del evento queda levantada después de tocarla");
});

test("el reinicio del hover no pinta de blanco los botones de color al tocarlos", () => {
  const css = fuente("app/globals.css");
  const desde = css.indexOf("/* ===== Al tocar");
  assert.notEqual(desde, -1, "no está la sección de la respuesta al tocar");
  const seccion = css.slice(desde);
  // .btn:hover reinicia el fondo de todos los botones; el rojo de Borrar, el
  // gris de "Borrar período" y el rojo de "Faltan" tienen que volver a su color.
  assert.ok(/\.btn\.danger:hover\{[^}]*background:var\(--crit\)/.test(seccion), "Borrar queda con letra blanca sobre fondo blanco al tocarlo");
  assert.ok(/\.btn\.btn-del:hover\{[^}]*background:transparent/.test(seccion), "el botón de borrar queda con el fondo del botón común al tocarlo");
  assert.ok(/\.btn\.btn-falta-top:hover\{[^}]*background:var\(--crit-soft\)/.test(seccion), "el botón de faltantes queda con el fondo del botón común al tocarlo");
});
