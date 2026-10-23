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

test("con el teclado abierto la pantalla se achica", () => {
  assert.ok(fuente("app/layout.tsx").includes('interactiveWidget: "resizes-content"'), "el teclado tapa las hojas");
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

test("ningún efecto de mouse vive fuera de @media (hover:hover): en el teléfono no queda pegado", async () => {
  // En una pantalla táctil el :hover se queda después de tocar (el aviso rojo de
  // faltantes sigue rojo, la fila sigue resaltada). Perseguirlos de a uno no
  // escala: la regla es que todo :hover viva dentro de @media (hover:hover), que
  // es "hay un mouse". postcss parsea el CSS de verdad, así que no se engaña con
  // llaves anidadas ni con listas de selectores.
  const { createRequire } = await import("node:module");
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const postcss = require("postcss");
  const raiz = postcss.parse(fuente("app/globals.css"));
  const sueltas: string[] = [];
  raiz.walkRules((r: { selector: string; parent: unknown }) => {
    if (!r.selector.includes(":hover")) return;
    let p = r.parent as { type: string; name?: string; params?: string; parent?: unknown } | undefined;
    while (p && p.type !== "root") {
      if (p.type === "atrule" && p.name === "media" && String(p.params).includes("hover:hover")) return;
      p = p.parent as typeof p;
    }
    sueltas.push(r.selector);
  });
  assert.deepEqual(sueltas, [], "estos :hover quedan pegados después de tocar en el teléfono");
});

test("en pantallas táctiles, lo que se toca se ve apretado", () => {
  const css = fuente("app/globals.css");
  const desde = css.indexOf("/* ===== Al tocar");
  assert.notEqual(desde, -1, "no está la sección de la respuesta al tocar");
  const seccion = css.slice(desde);
  assert.ok(seccion.includes("@media (hover:none)"), "la respuesta al tocar no se limita a pantallas táctiles");
  assert.ok(seccion.includes(":active"), "tocar no tiene respuesta visible");
});

test("la barra de abajo se esconde con el teclado abierto, no por tocar un selector", () => {
  const css = fuente("app/globals.css");
  assert.ok(!css.includes("body:has(:is(input, textarea, select):focus) .mobnav"), "un selector sin teclado esconde la barra de abajo");
  assert.ok(css.includes(".teclado-abierto .mobnav{display:none}"), "con el teclado abierto la barra de abajo queda arriba del teclado");
  assert.ok(fuente("components/ComportamientoDeApp.tsx").includes('"teclado-abierto"'), "nadie detecta el teclado");
});

test("el menú ⋯ no se cierra porque se cerró el teclado", () => {
  const s = fuente("components/RowMenu.tsx");
  assert.ok(s.includes("innerWidth"), "el menú se cierra con cualquier cambio de alto, como el del teclado");
  // `innerWidth` ya aparece al posicionar la lista: lo que importa es que el
  // `resize` no apunte al cierre incondicional.
  assert.ok(!s.includes('addEventListener("resize", cerrar)'), "cualquier resize cierra el menú, también el que causa el teclado");
  assert.ok(s.includes("anchoAlAbrir"), "el menú no recuerda el ancho con que se abrió");
});

test("las ventanas de formulario no se cierran deslizando", () => {
  assert.ok(fuente("components/ComportamientoDeApp.tsx").includes("data-sin-deslizar"), "deslizar tira lo tipeado en un formulario");
  assert.ok(fuente("app/globals.css").includes(".modal[data-sin-deslizar]::before{content:none}"), "las hojas que no se deslizan muestran la manija");
  for (const archivo of [
    "components/EditEventModal.tsx",
    "components/NewProductModal.tsx",
    "components/SuggestionBox.tsx",
    "components/ProductAdminModal.tsx",
    "components/UsersManager.tsx",
    "components/EditPeriodModal.tsx",
    "components/PeriodHub.tsx",
    "components/InventoryTable.tsx",
    "components/OrderBuilder.tsx",
  ]) {
    assert.ok(fuente(archivo).includes("data-sin-deslizar"), `${archivo}: el formulario se cierra deslizando`);
  }
});

test("un golpe rápido también cierra la hoja y, si no cierra, vuelve con animación", () => {
  const s = fuente("components/ComportamientoDeApp.tsx");
  assert.ok(s.includes("performance.now()"), "el gesto no mide cuánto duró");
  assert.ok(s.includes('"transform 180ms ease"'), "la hoja salta de golpe a su lugar en vez de volver");
});

test("imprimir no toma los títulos del celular", () => {
  const css = fuente("app/globals.css").replace(/\r\n/g, "\n");
  const i = css.indexOf(".topbar h1{font-size:var(--t-xl)}");
  assert.notEqual(i, -1, "no está la regla del título del celular");
  const abre = css.lastIndexOf("@media screen and (max-width:860px)", i);
  assert.ok(abre !== -1 && !css.slice(abre, i).includes("\n}"), "los títulos del celular también achican lo impreso");
});

test("en Historial los filtros de motivo van en una fila", () => {
  assert.ok(fuente("components/Historial.tsx").includes('className="filtros-scroll"'), "los motivos se apilan en dos líneas");
});

test("los detalles de las listas del celular", () => {
  const css = fuente("app/globals.css");
  assert.ok(css.includes(".tabla-lista tbody td.emptyrow{"), "el aviso de 'sin movimientos' toma el estilo de una tarjeta");
  assert.ok(/\.prep-cuando\{white-space:nowrap; overflow:hidden; text-overflow:ellipsis\}/.test(css), "la fecha de Preparar baja a un tercer renglón");
  assert.ok(css.includes('content:"›" / ""'), "el lector de pantalla lee la flecha de los avisos");
});

test("tocar responde también en avisos, sugerencias, segmentos y el resto de lo que se toca", () => {
  const css = fuente("app/globals.css");
  const seccion = css.slice(css.indexOf("/* ===== Al tocar"));
  for (const sel of [".notif-item:not(:disabled)", "button.sug-row", "a.sug-row", ".seg button", ".miniedit", ".prep-faltan", ".prep-volver", ".pasados > summary"]) {
    assert.ok(seccion.includes(sel), `${sel} no responde al tocar`);
  }
  assert.ok(!/\.event, \.event-falta,/.test(seccion), ".event-falta está adentro de .event: se apagaban los dos a la vez");
  assert.ok(seccion.includes(".pasados .event:active{opacity:.45}"), "las tarjetas pasadas (.72) le ganan al estado apretado");
});

/**
 * iPhone, 23/10: "el botón de período se ve cortado". La barra de abajo iba de
 * borde a borde y pegada al fondo, con esquinas rectas: las esquinas redondeadas
 * de la pantalla del iPhone se comían el primer botón. Y el margen para la
 * barra de gestos (`env(safe-area-inset-bottom)`) valía 0, porque el viewport no
 * pedía `viewport-fit=cover`.
 */
test("el viewport pide la pantalla entera, así el margen de la barra de gestos vale", () => {
  assert.ok(fuente("app/layout.tsx").includes('viewportFit: "cover"'), "en iPhone el margen de abajo vale 0");
});

test("la barra de abajo flota redondeada, lejos de las esquinas de la pantalla", () => {
  const css = fuente("app/globals.css");
  const desde = css.indexOf("  .mobnav{\r\n    display:flex; position:fixed;") !== -1
    ? css.indexOf("  .mobnav{\r\n    display:flex; position:fixed;")
    : css.indexOf("  .mobnav{\n    display:flex; position:fixed;");
  assert.notEqual(desde, -1, "no está la regla de la barra de abajo");
  const regla = css.slice(desde, css.indexOf("}", desde));
  assert.ok(regla.includes("border-radius:"), "la barra tiene esquinas rectas que el iPhone recorta");
  assert.ok(/bottom:calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/.test(regla), "la barra queda pegada al fondo, sobre la barra de gestos");
  assert.ok(/left:calc\(\d+px \+ env\(safe-area-inset-left\)\)/.test(regla), "la barra toca el borde de la pantalla");
});

test("el selector de período se dibuja igual en iPhone que en Android", () => {
  const css = fuente("app/globals.css");
  const regla = css.slice(css.indexOf(".wk-select{"), css.indexOf("}", css.indexOf(".wk-select{")));
  assert.ok(regla.includes("appearance:none"), "Safari le pone su propio dibujo al selector y lo corta");
});
