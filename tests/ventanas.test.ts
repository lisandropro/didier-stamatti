import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Las ventanas, los formularios y las pantallas de error, sobre el texto de los
 * archivos (como `celular.test.ts`: los componentes de cliente no corren acá).
 *
 * Lo que cuidan estas guardas es que no vuelva lo que se unificó: una ventana
 * armada a mano se olvida de Escape, del foco o de preguntar antes de tirar lo
 * tipeado; un rótulo suelto no le dice al lector de pantalla de qué campo es.
 */

const raiz = process.cwd();
const fuente = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const componentes = fs.readdirSync(path.join(raiz, "components")).filter((f) => f.endsWith(".tsx"));

test("todas las ventanas salen de Dialogo: nadie arma su propio fondo", () => {
  for (const f of componentes) {
    if (f === "Dialogo.tsx") continue;
    const s = fuente(`components/${f}`);
    assert.ok(!s.includes('className="overlay"'), `${f} arma su propia ventana en vez de usar Dialogo`);
    assert.ok(!s.includes("body.style.overflow"), `${f} traba el scroll del fondo por su cuenta`);
  }
});

test("la base de las ventanas hace lo que antes cada una hacía a medias", () => {
  const s = fuente("components/Dialogo.tsx");
  assert.ok(s.includes('className="overlay"') && s.includes("`modal${"), "cambió el DOM del que dependen la hoja de estilos y el gesto de deslizar");
  assert.ok(s.includes('role="dialog"') && s.includes('aria-modal="true"'), "la ventana no se anuncia como ventana");
  assert.ok(s.includes("aria-labelledby") && s.includes("aria-label="), "la ventana no tiene nombre");
  assert.ok(s.includes('e.key === "Escape"'), "Escape no cierra");
  assert.ok(s.includes('e.key !== "Tab"'), "con Tab se sale de la ventana");
  assert.ok(s.includes("trabarFondo()") && s.includes("destrabarFondo()"), "el fondo scrollea detrás de la ventana");
  assert.ok(s.includes("volverA.focus("), "al cerrar, el foco no vuelve a donde estaba");
  // Guardando no se cierra; con algo tipeado, primero pregunta.
  const cierre = s.slice(s.indexOf("const pedirCierre"), s.indexOf("}, []);", s.indexOf("const pedirCierre")));
  assert.ok(cierre.includes("if (e.ocupado) return;"), "se cierra a mitad de un guardado");
  assert.ok(cierre.includes("if (e.cambiado) return setPreguntando(true);"), "tocar afuera tira lo tipeado sin preguntar");
  // El gesto de deslizar (ComportamientoDeApp) hace clic en el fondo: tiene que pasar.
  assert.ok(s.includes("e.nativeEvent.isTrusted"), "el clic del gesto de deslizar ya no cierra la hoja");
});

test("los rótulos de los formularios están atados a su campo", () => {
  // Los únicos <label> sin htmlFor permitidos son los que envuelven a su campo.
  const ENVUELVEN = /<label className="(search|check-line|remember)"|<label>\s*\n\s*<span>/;
  for (const f of componentes) {
    // `Campo` es quien pone el `htmlFor` (y su comentario nombra la etiqueta).
    if (f === "Formulario.tsx") continue;
    const s = fuente(`components/${f}`);
    for (const m of s.matchAll(/<label\b[^>]*>/g)) {
      const etiqueta = m[0];
      if (etiqueta.includes("htmlFor=") || etiqueta.includes("id=")) continue;
      const contexto = s.slice(m.index, m.index + 80);
      assert.ok(ENVUELVEN.test(contexto), `${f}: hay un <label> suelto (${contexto.split("\n")[0]}). Usar <Campo>.`);
    }
  }
});

test("los errores de los formularios usan un solo cartel, que se anuncia", () => {
  assert.match(fuente("components/Formulario.tsx"), /role="alert" className=\{`form-error/);
  for (const f of componentes) {
    if (f === "Formulario.tsx") continue;
    const s = fuente(`components/${f}`);
    assert.ok(!s.includes("login-error"), `${f} usa el cartel de error viejo`);
    assert.ok(!/className="form-error/.test(s), `${f} arma el cartel de error a mano: usar <MensajeDeError>`);
  }
});

test("una pantalla que falla muestra algo propio, con cómo seguir", () => {
  const e = fuente("app/(app)/error.tsx");
  assert.ok(e.startsWith('"use client"'), "la pantalla de error tiene que ser de cliente");
  assert.ok(e.includes("Reintentar") && e.includes("Volver al inicio"), "la pantalla de error no deja seguir");
  // Next 16 pasa `retry`; `reset` es el de antes.
  assert.ok(e.includes("retry"), "la pantalla de error no usa el reintento de Next 16");
  const g = fuente("app/global-error.tsx");
  assert.ok(g.includes("<html") && g.includes("<body>"), "el error global no trae su propio documento");
});

test("cada pantalla tiene su esqueleto de carga y su título", () => {
  // Sin esqueleto propio caían en el de la portada: el depósito veía "Período"
  // cada vez que abría Preparar.
  for (const ruta of ["preparar", "preparar/[eventId]", "preparar/[eventId]/levante", "sugerencias", "dispositivos", "cambios-tardios"]) {
    assert.ok(fs.existsSync(path.join(raiz, "app/(app)", ruta, "loading.tsx")), `/${ruta} no tiene esqueleto propio`);
  }
  assert.match(fuente("app/layout.tsx"), /template: "%s · Didier Stamatti"/);
  for (const pagina of ["inventario", "historial", "notificaciones", "preparar", "cuenta"]) {
    assert.match(fuente(`app/(app)/${pagina}/page.tsx`), /export const metadata = \{ title: "/, `/${pagina} no tiene título propio`);
  }
  assert.match(fuente("app/(app)/evento/[id]/page.tsx"), /export async function generateMetadata/);
});

test("los campos numéricos no cambian con la rueda del mouse", () => {
  for (const f of componentes) {
    const s = fuente(`components/${f}`);
    for (const m of s.matchAll(/type="number"/g)) {
      assert.ok(s.slice(m.index, m.index + 60).includes("onWheel={sinRueda}"), `${f}: un campo numérico cambia de valor al scrollear`);
    }
  }
});

test("lo impreso no depende del tema elegido ni de los gráficos de fondo", () => {
  const css = fuente("app/globals.css").replace(/\r\n/g, "\n");
  const print = css.slice(css.indexOf("@media print{"));
  // `:root:root` le gana a `:root[data-theme="dark"]`; un `:root` solo, no.
  assert.ok(print.includes(":root:root{"), "con el tema oscuro elegido a mano, lo impreso sale con tinta clara");
  assert.ok(print.includes("print-color-adjust:exact"), "el logo no sale si el navegador no imprime fondos");
  assert.ok(/\.overlay[^{]*\{display:none!important\}/.test(print), "una ventana abierta sale impresa encima del pedido");
});

test("el tema le llega también a lo que dibuja el navegador", () => {
  const css = fuente("app/globals.css");
  assert.ok(css.includes("color-scheme:light") && css.split("color-scheme:dark").length - 1 >= 2, "en oscuro, el calendario y los desplegables se dibujan en claro");
  assert.ok(css.includes("::placeholder{color:var(--muted)"), "el texto de ejemplo de los campos queda con el gris del navegador");
});
