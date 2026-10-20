import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardas de la preparación sobre el texto de los archivos: las pantallas y
 * acciones leen la sesión de las cookies y no corren fuera de Next.
 */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

/** El cuerpo de una acción exportada: desde su `export async function` hasta la
 *  siguiente (o el final del archivo). */
function cuerpoDe(s: string, nombre: string): string {
  const desde = s.indexOf(`export async function ${nombre}`);
  assert.ok(desde > -1, `no existe ${nombre}`);
  const resto = s.slice(desde + 10);
  const hasta = resto.search(/^export async function /m);
  return s.slice(desde, hasta === -1 ? s.length : desde + 10 + hasta);
}

test("la portada lleva al depósito a Preparar en vez de dar 404", () => {
  const s = fuente("app/(app)/page.tsx");
  assert.match(s, /canVerPreparacion\(session\.role\)\) redirect\("\/preparar"\)/);
});

test("Preparar está en el menú lateral y en la barra del teléfono para quien tilda", () => {
  for (const archivo of ["components/Sidebar.tsx", "components/MobileNav.tsx"]) {
    const s = fuente(archivo);
    assert.match(s, /canPreparar\(/, `${archivo} no mira canPreparar`);
    assert.match(s, /"\/preparar"/, `${archivo} no tiene la entrada /preparar`);
  }
});

test("el depósito no pasa ninguna guarda de las acciones que escriben pedidos, stock, catálogo o usuarios", async () => {
  // La spec pide probarlo sobre el texto de las acciones, como order-actions.test.ts:
  // cada guarda que usan esos archivos tiene que dejar afuera al depósito.
  const permisos = (await import("../lib/permissions")) as unknown as Record<string, (r: string) => boolean>;
  for (const archivo of ["order.ts", "period.ts", "snapshot.ts", "stock.ts", "users.ts"]) {
    const s = fuente(`app/actions/${archivo}`);
    const guardas = [...new Set([...s.matchAll(/\b(can[A-Z]\w*)\(/g)].map((m) => m[1]))];
    assert.ok(guardas.length > 0, `${archivo} no usa ninguna guarda`);
    for (const g of guardas) {
      assert.equal(typeof permisos[g], "function", `${archivo}: ${g} no es una capacidad de lib/permissions`);
      assert.equal(permisos[g]("DEPOSITO"), false, `${archivo}: ${g} deja pasar al depósito`);
    }
  }
  // El catálogo no usa una capacidad sino el rol exacto.
  assert.match(fuente("app/actions/products.ts"), /user\.role !== "ADMIN"/);
});

test("ninguna acción de preparación escribe sin comprobar permiso y evento vivo antes", () => {
  const s = fuente("app/actions/preparacion.ts");
  const guarda = s.slice(s.indexOf("async function requerirPreparar"), s.indexOf("export async function"));
  assert.match(guarda, /canPreparar\(user\.role\)/);
  assert.match(guarda, /deletedAt: null, period: \{ deletedAt: null \}/);
  // El permiso se mira antes de tocar la base: a quien no puede no se le dice
  // ni si el evento existe.
  assert.ok(guarda.indexOf("canPreparar(") < guarda.indexOf("prisma.event.findFirst"), "consulta la base antes del permiso");
  const cortes = [...s.matchAll(/^export async function (\w+)/gm)];
  assert.equal(cortes.length, 3);
  for (let i = 0; i < cortes.length; i++) {
    const cuerpo = s.slice(cortes[i].index!, i + 1 < cortes.length ? cortes[i + 1].index! : s.length);
    const permiso = cuerpo.indexOf("requerirPreparar(");
    const escritura = cuerpo.search(/\b(tildar|destildar|tildarSector)\(eventId/);
    assert.ok(permiso > -1 && escritura > permiso, `${cortes[i][1]} escribe sin comprobar antes`);
    // Llamar a la guarda no alcanza: hay que cortar si no dejó pasar.
    assert.match(cuerpo.slice(permiso, escritura), /if \(!user\) return/, `${cortes[i][1]} ignora lo que dijo la guarda`);
  }
});

test("las acciones de preparar comprueban lo visto y se lo pasan a la escritura", () => {
  const s = fuente("app/actions/preparacion.ts");
  for (const [nombre, comprueba] of [
    ["tildarItem", "esVisto(visto)"],
    ["destildarItem", "esVisto(visto)"],
    ["tildarSectorEntero", "sonVistosDeSector(vistos)"],
  ] as const) {
    const c = cuerpoDe(s, nombre);
    const valida = c.indexOf(comprueba);
    const escritura = c.search(/\b(tildar|destildar|tildarSector)\(eventId/);
    assert.ok(valida > -1 && escritura > valida, `${nombre} escribe lo visto sin comprobarlo`);
    // Si lo visto no llegara a la escritura, se volvería a guardar lo que diga el
    // pedido al llegar el toque, que es justo lo que no se quiere.
    assert.match(c.slice(escritura), /^\w+\(eventId, [^)]*\bvistos?\)/, `${nombre} no le pasa lo visto a la escritura`);
  }
});

test("la pantalla de preparar manda lo que se ve, y la pregunta armada se desarma si cambia", () => {
  const s = fuente("components/Preparar.tsx");
  assert.match(s, /const vistoDe = \(i: Item\): Visto => \(\{ estado: i\.estado, qty: i\.qty, note: i\.note \}\)/);
  assert.match(s, /destildarItem\(data\.evento\.id, i\.clave, visto\)/);
  assert.match(s, /tildarItem\(data\.evento\.id, i\.clave, visto\)/);
  assert.match(s, /tildarSectorEntero\(data\.evento\.id, a\.category, a\.vistos\)/);
  // "Tildar todo" manda solo lo pendiente del sector, tal como se veía.
  assert.match(s, /vistos: s\.filas\.filter\(\(i\) => i\.estado === "PENDIENTE"\)/);
  const desde = s.indexOf("const sigueComoSeArmo");
  assert.ok(desde > -1, "no existe sigueComoSeArmo");
  const sigue = s.slice(desde, s.indexOf(";", desde));
  for (const campo of ["clave", "estado", "qty", "note"]) assert.match(sigue, new RegExp(`a\\.${campo} === i\\.${campo}`), campo);
  assert.match(s, /!paraAplicar\.some\(\(i\) => sigueComoSeArmo\(armada, i\)\)\) setArmada\(null\)/);
  // Un aviso (se tildó, pero algo cambió) se muestra y la pantalla se pone al día.
  assert.match(s, /setError\(\{ texto: \(r\.ok \? r\.aviso : r\.error\)/);
});

test("cada acción del pedido marca si el cambio es tardío antes de avisar", () => {
  const s = fuente("app/actions/order.ts");
  const cuerpo = (nombre: string) => cuerpoDe(s, nombre);
  for (const [nombre, pregunta] of [
    ["setLine", "estaTildado("],
    ["setCustomQty", "estaTildado("],
    ["deleteLine", "estaTildado("],
    ["copyOrderFromEvent", "hayTildados("],
  ] as const) {
    const c = cuerpo(nombre);
    const marca = c.indexOf(pregunta);
    const aviso = c.indexOf("notifyOrderChange(");
    assert.ok(marca > -1 && aviso > marca, `${nombre} avisa sin saber si es tardío`);
    assert.match(c, /tardio/, `${nombre} no pasa la marca`);
    // La pregunta va con `tx`: dentro de la misma transacción que escribe. Con
    // `prisma` se podría tildar entre la lectura y la escritura, y el cambio
    // saldría como común cuando el depósito ya lo había preparado.
    const enLaTransaccion = pregunta === "estaTildado(" ? "estaTildado(tx," : "hayTildados(tx,";
    assert.ok(c.includes(enLaTransaccion), `${nombre} no pregunta por lo tildado dentro de la transacción (${enLaTransaccion})`);
  }
  const addCustom = cuerpo("addCustomLine");
  assert.doesNotMatch(addCustom, /tardio: true|estaTildado\(/, "un suelto nuevo nunca es tardío");
});

test("descartar y restaurar avisan como tardío a los eventos que tenían algo tildado", () => {
  const s = fuente("app/actions/snapshot.ts");
  assert.match(s, /preparaciones: \{ some: \{\} \}/);
  assert.match(s, /kind: "RESTAURADO"[\s\S]*tardio: true/);
  // El aviso va DESPUÉS de aplicar: antes no habría nada que avisar. Y en la
  // restauración, después de marcar la versión como restaurada, para que un
  // fallo al avisar no se lleve esa marca por delante.
  for (const nombre of ["discardPeriodChanges", "restorePeriodVersion"]) {
    const c = cuerpoDe(s, nombre);
    const aplica = c.indexOf("applySnapshotData(");
    const aviso = c.indexOf("avisarATildados(");
    assert.ok(aplica > -1 && aviso > aplica, `${nombre} avisa antes de aplicar la versión`);
    // La foto de lo pendiente se saca antes de aplicar: después ya no hay con qué comparar.
    const foto = c.indexOf("pendientesPorEvento(");
    assert.ok(foto > -1 && foto < aplica, `${nombre} no saca la foto de lo pendiente antes de aplicar`);
  }
  const restaurar = cuerpoDe(s, "restorePeriodVersion");
  const restaurada = restaurar.indexOf("restoredAt");
  assert.ok(restaurada > -1 && restaurar.indexOf("avisarATildados(") > restaurada, "restorePeriodVersion avisa antes de marcar la versión como restaurada");
});

test("las pantallas de preparar comprueban su permiso; tildar se ofrece solo a quien puede", () => {
  for (const archivo of ["app/(app)/preparar/page.tsx", "app/(app)/preparar/[eventId]/page.tsx"]) {
    assert.match(fuente(archivo), /canVerPreparacion\(sesion\.role\)\) notFound\(\)/, archivo);
  }
  assert.match(fuente("app/(app)/preparar/[eventId]/page.tsx"), /puedeTildar: canPreparar\(sesion\.role\)/);
  assert.match(fuente("components/Preparar.tsx"), /if \(!data\.puedeTildar/);
});

test("'Qué cambió' manda a Preparar a quien no ve el editor", () => {
  assert.match(fuente("app/(app)/aviso/[id]/page.tsx"), /canVerStock\(user\.role\)[\s\S]*\/preparar\//);
});

test("el editor pide confirmación antes de cambiar algo ya preparado, en la fila", () => {
  const s = fuente("components/OrderBuilder.tsx");
  const update = s.slice(s.indexOf("function updateItem"), s.indexOf("function stepQty"));
  assert.match(update, /conConfirmacion\(/, "updateItem cambia sin preguntar");
  assert.match(s, /Ya está preparado/);
  assert.match(s, /Cambiar igual/);
  assert.match(fuente("app/(app)/evento/[id]/page.tsx"), /preparacion\.findMany/);
});

test("una fila ya preparada está trabada: tocarla solo avisa, no guarda ningún cambio escondido", () => {
  const s = fuente("components/OrderBuilder.tsx");

  // conConfirmacion corta antes de llamar a `aplicar` cuando la fila está
  // trabada. Si lo llamara igual (o lo guardara para después), un cambio que
  // nadie vio terminaría aplicándose al confirmar.
  const desde = s.indexOf("function conConfirmacion");
  assert.ok(desde > -1, "no existe conConfirmacion");
  const cuerpo = s.slice(desde, s.indexOf("function ", desde + "function conConfirmacion".length));
  assert.match(cuerpo, /if \(bloqueada\(clave\)\)/);
  const corta = cuerpo.indexOf("return");
  const aplica = cuerpo.indexOf("aplicar()");
  assert.ok(corta > -1 && aplica > corta, "conConfirmacion llama a aplicar antes de cortar");
  assert.doesNotMatch(cuerpo.slice(0, corta), /aplicar\(\)/, "conConfirmacion aplica con la fila trabada");

  // Lo que queda esperando confirmación es solo la clave de la fila, no una
  // función con el valor nuevo: tipear 102 sobre un 10 no puede arrastrar nada.
  assert.match(s, /useState<string \| null>\(null\)/);
  assert.doesNotMatch(s, /setPorConfirmar\(\{/);
  assert.match(s, /useState<ReadonlySet<string>>/);

  // Los dos inputs de cantidad (catálogo y sueltos) son de solo lectura mientras
  // la fila está trabada y abren el aviso al tocarlos: así no capturan teclas.
  const cantidades = [...s.matchAll(/<input\s+className="qinput"[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(cantidades.length, 2, "cambió la cantidad de inputs de cantidad: revisar la guarda");
  for (const input of cantidades) {
    assert.match(input, /readOnly=\{trabada\}/, "un input de cantidad se puede tipear con la fila trabada");
    assert.match(input, /onFocus=\{trabada \?/);
    assert.match(input, /onPointerDown=\{trabada \?/);
  }

  // La nota del catálogo tampoco se abre trabada: el botón abre el aviso.
  const botonNota = s.slice(s.indexOf("className={`note-toggle"), s.indexOf("{p.note ? `✎"));
  assert.match(botonNota, /if \(trabada\) setPorConfirmar\(p\.id\)/);

  // En Extras, -, + y el tacho van por la pregunta; ninguno llama directo a la
  // acción de cambiar o quitar.
  const extras = s.slice(s.indexOf("function ExtrasPanel"));
  const jsx = extras.slice(extras.indexOf('<div className="extras-form">'));
  assert.match(jsx, /onClick=\{\(\) => pedirCambio\(c\.id, c\.qty - 1\)\}/);
  assert.match(jsx, /onClick=\{\(\) => pedirCambio\(c\.id, c\.qty \+ 1\)\}/);
  assert.match(jsx, /onClick=\{\(\) => pedirQuitar\(c\.id\)\}/);
  assert.doesNotMatch(jsx, /changeQty\(c\.id/, "un control de Extras cambia sin pasar por pedirCambio");
  assert.doesNotMatch(jsx, /remove\(c\.id\)/, "un control de Extras quita sin pasar por pedirQuitar");

  // Al cambiar de pestaña o de búsqueda se cierra el aviso.
  assert.match(s, /function elegirPestania\(valor: string\) \{\s*setTab\(valor\);\s*setPorConfirmar\(null\);/);
  assert.match(s, /function escribirBusqueda\(valor: string\) \{\s*setQuery\(valor\);\s*setPorConfirmar\(null\);/);
  assert.doesNotMatch(s, /onClick=\{\(\) => setTab\(/, "una pestaña cambia sin cerrar el aviso");
});

test("las pantallas no leen toda la historia de preparaciones ni las que no usan", () => {
  // La portada cuenta lo tildado solo en los períodos que muestra, por evento.
  const portada = fuente("app/(app)/page.tsx");
  assert.doesNotMatch(portada, /prisma\.preparacion\.findMany/, "la portada vuelve a leer cada fila de Preparacion");
  assert.match(portada, /periodId: \{ in: periodosConPreparados \}/);
  assert.match(portada, /periodosConPreparados\.length > 0/);
  // El pedido solo trae lo tildado si quien lo abre va a ver el editor.
  assert.match(fuente("app/(app)/evento/[id]/page.tsx"), /puedeEditar\s*\?\s*prisma\.preparacion\.findMany/);
});

test("copiar y descartar avisan cuántos ítems preparados van a cambiar", () => {
  assert.match(fuente("components/OrderBuilder.tsx"), /ya están preparados y van a cambiar/);
  assert.match(fuente("components/PeriodHub.tsx"), /ya están preparados y van a cambiar/);
  assert.match(fuente("components/PeriodHub.tsx"), /v\.preparados > 0/);
});

test("la instalación guiada está en Avisos y en Preparar, y el manifiesto tiene el atajo", () => {
  assert.match(fuente("app/(app)/notificaciones/page.tsx"), /<InstalarApp \/>/);
  assert.match(fuente("app/(app)/preparar/page.tsx"), /<InstalarApp \/>/);
  assert.match(fuente("app/manifest.ts"), /shortcuts:[\s\S]*"\/preparar"/);
  const c = fuente("components/InstalarApp.tsx");
  assert.match(c, /beforeinstallprompt/);
  assert.match(c, /display-mode: standalone/);
});
