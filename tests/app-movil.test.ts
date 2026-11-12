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
  assert.ok(fuente("components/Dialogo.tsx").includes("data-sin-deslizar={sinDeslizar"), "la base de las ventanas no pone el atributo que frena el gesto");
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
    // Las ventanas se arman con `Dialogo`: `sinDeslizar` es lo que pone el atributo.
    assert.ok(fuente(archivo).includes("sinDeslizar"), `${archivo}: el formulario se cierra deslizando`);
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
  for (const sel of [".notif-item:not(:disabled)", "button.sug-row", "a.sug-row", ".seg button", ".prep-faltan", ".prep-salto", ".prep-volver", ".pasados > summary", ".lev-card"]) {
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

/**
 * Depósito, señal que va y viene (23/10). Abrir la app sin red mostraba el
 * dinosaurio del navegador, y perder la señal a mitad de uso solo daba un error
 * genérico. El service worker sigue sin guardar pantallas ni datos: solo guarda
 * esta página estática.
 */
test("sin red, la app abre una página propia y no el dinosaurio del navegador", () => {
  const sw = fuente("public/sw.js");
  assert.ok(sw.includes('"/sin-conexion.html"'), "el service worker no conoce la página sin conexión");
  assert.ok(sw.includes('req.mode === "navigate"'), "abrir una pantalla sin red no tiene respuesta propia");
  const html = fuente("public/sin-conexion.html");
  assert.ok(html.includes("Sin conexión") && html.includes("Reintentar"), "la página sin conexión no explica ni deja reintentar");
  // Vuelve sola: nadie va a tocar "Reintentar" si el teléfono ya tiene señal. Con
  // "señal pero sin datos" el aviso del navegador no llega: también se pregunta
  // cada tanto, sin pasar por el service worker (HEAD, sin caché).
  const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
  assert.ok(script.includes('addEventListener("online"'), "la página sin conexión no se entera de que volvió la señal");
  assert.ok(script.includes("location.reload()"), "la página sin conexión no se recarga sola al volver la señal");
  assert.ok(script.includes("setInterval(") && script.includes('"HEAD"') && script.includes("no-store"), "con señal pero sin datos la página sin conexión no se entera de que volvió");
  // Si la app estaba en segundo plano (el intervalo no prueba mientras no se ve)
  // y se reabre, no tiene que esperar hasta 20 s al próximo intento.
  assert.ok(script.includes("visibilitychange"), "al volver a mirar la página sin conexión espera hasta 20 s para probar");
});

test("si se corta la señal, la app lo dice arriba y se pone al día cuando vuelve", () => {
  const s = fuente("components/SinConexion.tsx");
  assert.ok(s.includes('"offline"') && s.includes('"online"'), "nadie escucha si se corta o vuelve la señal");
  assert.ok(s.includes("router.refresh()"), "al volver la señal la pantalla queda vieja");
  assert.ok(fuente("app/(app)/layout.tsx").includes("<SinConexion />"), "el layout no monta el aviso de sin conexión");
});

test("al volver la señal, el refresco espera a que la red conteste y no se hace en el editor del pedido", () => {
  const s = fuente("components/SinConexion.tsx");
  // El evento `online` puede llegar antes de que la red responda: un
  // `router.refresh()` que falla termina en la página de sin conexión.
  const desde = s.indexOf("const con = ");
  assert.notEqual(desde, -1, "no está el manejador de cuando vuelve la señal");
  const cuerpo = s.slice(desde, s.indexOf("\n    };", desde));
  assert.ok(/ESPERA_MS\s*=\s*1500/.test(s), "no hay espera de 1500 ms antes de refrescar");
  assert.ok(/setTimeout\([\s\S]*ESPERA_MS/.test(cuerpo), "refresca en cuanto llega el aviso, sin dejar que la red conteste");
  assert.ok(cuerpo.includes("navigator.onLine"), "refresca aunque para entonces la señal se haya vuelto a ir");
  // En el editor (`/evento/…`) el estado se arma una sola vez al montar: refrescar no aporta nada.
  assert.ok(s.includes("usePathname()") && s.includes('"/evento/"'), "refresca también en el editor del pedido");
  assert.ok(cuerpo.includes("router.refresh()"), "al volver la señal la pantalla queda vieja");
  // Esa espera es un reloj más: se corta al desmontar.
  const limpieza = s.slice(s.indexOf("return () => {"));
  assert.ok(limpieza.includes("clearTimeout(espera)"), "el reloj de espera sigue corriendo al desmontar");
});

test("la franja de sin conexión va abajo, por encima de la barra flotante y de las hojas", () => {
  const css = fuente("app/globals.css").replace(/\r\n/g, "\n");
  const desde = css.indexOf(".sin-conexion{");
  assert.notEqual(desde, -1, "no está la regla de la franja");
  const regla = css.slice(desde, css.indexOf("}", desde));
  // Arriba tapaba la primera fila de la cabecera y quedaba debajo de las hojas (z-index 50).
  assert.ok(regla.includes("top:auto") && regla.includes("bottom:var(--sp-4)"), "la franja no va abajo en la pantalla ancha");
  assert.ok(!regla.includes("safe-area-inset-top"), "la franja sigue pegada arriba");
  const z = /z-index:(\d+)/.exec(regla);
  assert.ok(z && Number(z[1]) >= 70, "la franja queda debajo de las hojas o del menú ⋯");
  assert.ok(
    /@media \(max-width:860px\)\{\s*\.sin-conexion\{bottom:calc\(76px \+ env\(safe-area-inset-bottom\)\)\}/.test(css),
    "en el celular la franja no sube por encima de la barra flotante",
  );
  // Abajo, a esa altura, taparía la mitad de abajo del menú "Más" (`.mobmas`,
  // que solo existe en el DOM mientras está abierto) y el pie de las hojas
  // (Guardar/Cancelar). Con cualquiera de los dos abierto solo hay fondo
  // oscurecido: la franja se va arriba. La copia de una ventana que se está
  // yendo (`.overlay.saliendo`) no cuenta: la franja no salta arriba y abajo.
  assert.ok(
    css.includes(":has(.overlay:not(.saliendo), .mobmas-fondo) .sin-conexion"),
    "con el menú Más o una hoja abiertos la franja sigue abajo, tapando el menú o los botones de la hoja",
  );
});

test("los saltos de Preparar del celular no se aplican a lo impreso", () => {
  const css = fuente("app/globals.css").replace(/\r\n/g, "\n");
  const regla = css.indexOf(".prep-saltos{flex-wrap:nowrap");
  assert.notEqual(regla, -1, "no está la regla de los saltos en el celular");
  const media = css.slice(css.lastIndexOf("@media", regla), regla);
  // Una hoja A4 mide ~688 px de ancho y entra en el corte del celular.
  assert.ok(media.startsWith("@media screen and (max-width:860px)"), "los saltos del celular entran también al imprimir");
});

/**
 * Preparar, de Enseres a Bebida (23/10). Cada sector es una lista larga: para
 * ir de uno a otro había que scrollear todo lo del medio. Una fila de saltos en
 * la cabecera fija lleva directo, con el avance de cada sector a la vista.
 */
test("en Preparar se salta a cada sector desde una fila fija, con su avance", () => {
  const s = fuente("components/Preparar.tsx");
  assert.ok(s.includes('className="prep-saltos'), "no hay fila de saltos a los sectores");
  assert.ok(s.includes("href={`#sector-${s.category}`}"), "los saltos no llevan a cada sector");
  assert.ok(s.includes("id={`sector-${s.category}`}"), "los sectores no tienen a dónde saltar");
  assert.ok(/\.prep-seccion\{[^}]*scroll-margin-top/.test(fuente("app/globals.css")), "el salto deja el título del sector debajo de la cabecera fija");
});

test("en Preparar el teléfono vibra al tildar y al destildar", () => {
  const s = fuente("components/Preparar.tsx");
  const desde = s.indexOf("function alternar");
  const cuerpo = s.slice(desde, s.indexOf("\n  }", desde));
  assert.ok(cuerpo.includes("vibrar("), "tildar no da ninguna señal física");
  // Vibra recién cuando el toque va a hacer algo: si la guarda de arriba lo corta
  // (solo lectura, fila ocupándose), un teléfono que vibra sin hacer nada miente.
  assert.ok(cuerpo.includes("return;"), "alternar ya no tiene guarda de salida");
  assert.ok(cuerpo.indexOf("vibrar(") > cuerpo.indexOf("return;"), "vibra aunque el toque no haga nada");
  // Tildar un sector entero es otro toque, con su propia señal.
  const desdeSector = s.indexOf("function tildarSector");
  assert.notEqual(desdeSector, -1, "no está tildarSector");
  const cuerpoSector = s.slice(desdeSector, s.indexOf("\n  }", desdeSector));
  assert.ok(cuerpoSector.includes("vibrar("), "tildar un sector entero no da ninguna señal física");
});

/**
 * Tirar hacia abajo para actualizar (23/10). La app instalada apaga el estirón
 * del navegador (`overscroll-behavior:none`), y con él el "tirar para
 * actualizar" que todo el mundo espera en una lista. Se hace a mano, solo donde
 * se mira una lista para ver si llegó algo; nunca en el editor del pedido.
 */
test("el tirón para actualizar está montado y no pelea con las hojas", () => {
  assert.ok(fuente("app/(app)/layout.tsx").includes("<TirarParaActualizar />"), "no hay tirar para actualizar");
  const s = fuente("components/TirarParaActualizar.tsx");
  assert.ok(s.includes(".overlay"), "tirar dentro de una hoja actualizaría la pantalla de atrás");
  assert.ok(s.includes("router.refresh()"), "soltar no actualiza");
  assert.ok(s.includes("scrollY"), "tirar en el medio de la lista actualizaría en vez de scrollear");
  // El menú "Más" también es una ventana: el dedo que tira ahí no es de la pantalla de atrás.
  assert.ok(s.includes(".mobmas-fondo"), "tirar dentro del menú Más actualizaría la pantalla de atrás");
  // Y el menú ⋯ de la portada, que va en el body, encima de todo.
  assert.ok(s.includes(".rowmenu-list"), "tirar sobre el menú ⋯ actualizaría la pantalla de atrás");
  assert.ok(s.includes("pantallaConTiron("), "el tirón no distingue en qué pantallas existe");
  // Sin señal, `router.refresh()` hace una navegación completa y el service worker
  // contesta con la página de "sin conexión": reemplazaría la lista que se está
  // leyendo. Ni el tirón ni el refresco periódico pueden pedirla sin red.
  assert.ok(s.includes("navigator.onLine"), "tirar sin señal reemplaza la lista por la página de sin conexión");
  assert.ok(fuente("components/RefrescoPeriodico.tsx").includes("navigator.onLine"), "el refresco periódico, sin señal, reemplaza la lista por la página de sin conexión");
  // Y tildar sin señal: si la acción falla, Preparar vuelve a pedir la lista, y
  // sin red ese pedido termina en la página de "sin conexión".
  const prep = fuente("components/Preparar.tsx");
  // El guardado de cada toque vive en `guardar` (`correr` lo envuelve para
  // mostrar el tilde antes de que conteste el servidor).
  const desdeCorrer = prep.indexOf("async function guardar");
  assert.notEqual(desdeCorrer, -1, "no está guardar en Preparar");
  const cuerpoCorrer = prep.slice(desdeCorrer, prep.indexOf("\n  }", desdeCorrer));
  assert.ok(cuerpoCorrer.includes("navigator.onLine"), "tildar sin señal y fallar reemplaza la lista por la página de sin conexión");
});

/**
 * Sin señal en el editor del pedido (23/10). Después de "Volvió la conexión", lo
 * que no se guardó quedaba esperando que alguien tocara "Reintentar guardado".
 */
test("el editor del pedido reintenta guardar solo cuando vuelve la señal", () => {
  const s = fuente("components/OrderBuilder.tsx");
  const i = s.indexOf('"online"');
  assert.notEqual(i, -1, "el editor no escucha cuando vuelve la señal");
  // En el mismo efecto: escuchar, reintentar y soltar la escucha al salir.
  const desde = s.lastIndexOf("useEffect(", i);
  const hasta = s.indexOf("}, [", i);
  const efecto = s.slice(desde, hasta);
  assert.ok(efecto.includes("queue.flush()"), "al volver la señal el editor no reintenta guardar");
  assert.ok(efecto.includes('removeEventListener("online"'), "el editor deja la escucha de la señal puesta al desmontarse");
  // Igual que `SinConexion`: el aviso de red puede llegar antes de que la red
  // conteste, y un guardado que falla ahí queda esperando "Reintentar guardado".
  assert.ok(efecto.includes("setTimeout("), "el editor reintenta en cuanto llega el aviso, sin dejar que la red conteste");
  assert.ok(efecto.includes("clearTimeout("), "el reloj de espera del editor sigue corriendo al desmontar");
});

/**
 * Textos chicos a 12 px en el celular (los de contenido, no la barra de abajo,
 * que queda en 11 a propósito). A 11 px, "Faltan 10" o la fecha debajo de un
 * título costaban en el depósito. Esta guarda mira que el token y las cuatro
 * reglas existan; que ninguna regla posterior las pise no lo mide, se verificó
 * leyendo el archivo.
 */
test("en el celular los textos de contenido miden al menos 12 px", () => {
  const css = fuente("app/globals.css");
  assert.ok(css.includes("--t-chico:calc(12px * var(--fs))"), "no hay tamaño de 12 px para los textos chicos");
  for (const sel of [".orow-resumen", ".topbar .sub", ".topbar-pedido .sub", ".tile .k"]) {
    assert.ok(css.includes(`${sel}{font-size:var(--t-chico)}`), `${sel} sigue en 11 px`);
  }
});

/**
 * El resumen de la mañana es un aviso de varios renglones ("Hoy: …", "Mañana: …",
 * "Falta 1 producto…"). Sin `white-space`, el navegador junta los saltos de línea
 * y en Avisos se lee todo corrido. Los demás avisos son de una línea y no cambian.
 */
test("en Avisos los renglones del mensaje se respetan", () => {
  const css = fuente("app/globals.css");
  assert.ok(/\.notif-msg\{[^}]*white-space:pre-line/.test(css), "el resumen de la mañana se lee todo en una línea");
});
