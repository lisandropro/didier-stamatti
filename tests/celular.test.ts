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

test("el menú de tres puntitos se dibuja en el body, no adentro de la cabecera", () => {
  const s = fuente("components/RowMenu.tsx");
  assert.ok(s.includes("createPortal("), "el menú se dibuja adentro de quien lo abre");
  assert.ok(s.includes("document.body"), "el menú no va al body");
});

test("borrar el evento no reactiva el modal cuando salió bien", () => {
  const s = fuente("components/ConfirmDeleteEvent.tsx");
  const cuerpo = s.slice(s.indexOf("async function confirm"), s.indexOf("return (", s.indexOf("async function confirm")));
  const exito = cuerpo.lastIndexOf("onDeleted()");
  const fallo = cuerpo.indexOf("if (!res.ok)");
  const reactivar = cuerpo.lastIndexOf("setSaving(false)");
  assert.ok(exito !== -1, "no llama a onDeleted");
  assert.ok(fallo !== -1, "no distingue el fallo del borrado");
  // El `return` que separa a `setSaving(false)` de `onDeleted()` tiene que ser el
  // del camino de error; si `setSaving(false)` queda antes del `if (!res.ok)`,
  // corre también cuando salió bien y reactiva los botones sobre un evento borrado.
  assert.ok(
    reactivar > fallo && reactivar < exito && cuerpo.slice(reactivar, exito).includes("return"),
    "setSaving(false) corre también cuando salió bien",
  );
});

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

test("la nota del detalle mide 16 px, para que el teléfono no agrande la pantalla", () => {
  const css = fuente("app/globals.css");
  const regla = css.slice(css.indexOf(".detalle-nota{"), css.indexOf("}", css.indexOf(".detalle-nota{")));
  assert.ok(regla.includes("font-size:16px"), "la nota del detalle mide menos de 16 px");
});

test("en el celular los extras conservan su unidad: solo se esconde el rubro del catálogo", () => {
  const css = fuente("app/globals.css");
  assert.ok(!css.includes(".ocol-name .rubro{display:none}"), "se esconde también la unidad de los extras");
  assert.ok(fuente("components/OrderBuilder.tsx").includes('<div className="rubro solo-ancho">{rubro}</div>'), "el rubro del catálogo no se esconde en el celular");
});

test("la vista de solo lectura sigue sin ningún control que escriba en el pedido", () => {
  const s = fuente("components/OrderReadOnly.tsx");
  assert.ok(!s.includes("@/app/actions/order"), "la vista de solo lectura importa acciones del pedido");
  assert.ok(s.includes('className="ro-tabla"'), "la tabla no tiene la clase que la vuelve lista en el celular");
});
