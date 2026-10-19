// El texto del push de cambios de pedido, en un solo lugar y sin dependencias.
//
// Hasta el 19/10/2026 el push decía "Enrique hizo 7 cambios en el pedido de X".
// El que prepara tenía que abrir la app y buscar a ojo qué se tocó. Ahora dice
// qué cambió, neto: si una cantidad pasó de 10 a 12 y de 12 a 24, dice 10→24.

export type Cambio = { itemName: string; kind: string; before: string | null; after: string | null };

const DE_CANTIDAD = new Set(["AGREGADO", "QUITADO", "CANTIDAD"]);
const MAX_EN_EL_PUSH = 3;
const MAX_CUERPO = 500;
// El nombre de quién lo hizo lo escribe una persona y no tiene tope: si no se
// acota, un nombre larguísimo se come el presupuesto del cuerpo entero.
const MAX_QUIEN = 60;

/**
 * Junta los cambios de cada ítem en uno solo, del primer "antes" al último
 * "después". Lo que terminó igual que como empezó desaparece: al depósito no
 * le cambia nada.
 *
 * Las cantidades se agrupan por ítem (agregar, sacar y cambiar son la misma
 * cosa vista desde el depósito), las notas también, y los datos del evento
 * (fecha, lugar, responsable...) por tipo.
 *
 * Dos reglas más, porque el depósito actúa sobre cómo queda el pedido, no
 * sobre la historia: copiar el pedido de otro evento pisa todo lo que se había
 * tocado de los ítems antes de copiar, y la nota de un ítem que ya no está no
 * se avisa.
 */
export function consolidarCambios(cambios: Cambio[]): Cambio[] {
  const grupos = new Map<string, { primero: Cambio; ultimo: Cambio }>();
  for (const cambio of cambios) {
    if (cambio.kind === "COPIADO") {
      // Lo de los ítems anterior a la copia ya no existe; lo posterior sí cuenta.
      for (const clave of [...grupos.keys()]) {
        if (clave.startsWith("Q:") || clave.startsWith("N:")) grupos.delete(clave);
      }
    }
    const clave = DE_CANTIDAD.has(cambio.kind)
      ? `Q:${cambio.itemName}`
      : cambio.kind === "NOTA"
        ? `N:${cambio.itemName}`
        : `O:${cambio.kind}`;
    const g = grupos.get(clave);
    if (g) g.ultimo = cambio;
    else grupos.set(clave, { primero: cambio, ultimo: cambio });
  }

  // Ítems que al final no están (los sacaron, o los agregaron y los sacaron).
  // Las notas van en su propio grupo, así que sin esto una nota sobreviviría
  // al ítem y el depósito leería una nota de algo que ya no tiene que preparar.
  const sinItem = new Set<string>();
  for (const [clave, { ultimo }] of grupos) {
    if (clave.startsWith("Q:") && (ultimo.after ?? null) === null) sinItem.add(clave.slice(2));
  }

  const netos: Cambio[] = [];
  for (const [clave, { primero, ultimo }] of grupos) {
    const before = primero.before ?? null;
    const after = ultimo.after ?? null;
    const itemName = primero.itemName;
    if (clave.startsWith("Q:")) {
      if (before === null && after === null) continue; // se agregó y se sacó
      if (before === null) netos.push({ itemName, kind: "AGREGADO", before: null, after });
      else if (after === null) netos.push({ itemName, kind: "QUITADO", before, after: null });
      else if (before !== after) netos.push({ itemName, kind: "CANTIDAD", before, after });
    } else if (clave.startsWith("N:")) {
      if (sinItem.has(itemName)) continue;
      if ((before ?? "") !== (after ?? "")) netos.push({ itemName, kind: "NOTA", before, after });
    } else if (ultimo.kind === "COPIADO" || before !== after) {
      netos.push({ ...ultimo, before });
    }
  }
  return netos;
}

/**
 * Recorta a `n` unidades de longitud como mucho (la `length` de JS, que es la
 * que cuenta el tope de 500), con "…" al final si cortó. Corta por caracteres
 * enteros: partir un emoji por la mitad deja un carácter suelto que el
 * teléfono muestra como un cuadradito.
 */
export function recortar(s: string, n: number): string {
  if (n <= 0) return "";
  if (s.length <= n) return s;
  if (n === 1) return "…";
  let largo = 0;
  let corte = "";
  for (const caracter of s) {
    if (largo + caracter.length > n - 1) break; // el último lugar es para el "…"
    corte += caracter;
    largo += caracter.length;
  }
  return `${corte}…`;
}

/** Un dato del evento que quedó vacío no se escribe como "null". */
function dato(valor: string | null): string {
  return valor ?? "(sin dato)";
}

/** Un cambio en pocas palabras, como lo leería el que prepara. */
export function describirCambio(c: Cambio): string {
  switch (c.kind) {
    case "CANTIDAD":
      return `${c.itemName} ${c.before}→${c.after}`;
    case "AGREGADO":
      return `${c.itemName} +${c.after}`;
    case "QUITADO":
      return `${c.itemName} quitado`;
    case "NOTA":
      return c.after ? `${c.itemName}: nota "${recortar(c.after, 40)}"` : `${c.itemName}: nota borrada`;
    case "COPIADO":
      return c.after ?? "Pedido copiado de otro evento";
    case "RESPONSABLE":
      return `Responsable: ${c.after ?? "sin responsable"}`;
    case "LUGAR":
      return `Lugar: ${dato(c.after)}`;
    case "FECHA":
      return `Fecha: ${dato(c.after)}`;
    case "INVITADOS":
      return `Invitados: ${dato(c.after)}`;
    case "PERIODO":
      return `Período: ${dato(c.after)}`;
    case "RESTAURADO":
      return c.after ?? "Se restauró el pedido";
    default:
      return c.itemName;
  }
}

/** La firma del final del cuerpo: quién lo hizo, con el nombre acotado. */
function pieDe(actorName: string): string {
  return `\n— ${recortar(actorName, MAX_QUIEN)}`;
}

/** Hasta tres partes, "y N más" y la firma, sin pasar de MAX_CUERPO. Se recorta
 *  solo el detalle: el "y N más" y la firma son lo último que se puede perder. */
function cuerpoConTope(partes: string[], actorName: string): string {
  const visibles = partes.slice(0, MAX_EN_EL_PUSH).join(" · ");
  const resto = partes.length > MAX_EN_EL_PUSH ? ` · y ${partes.length - MAX_EN_EL_PUSH} más` : "";
  const pie = pieDe(actorName);
  return recortar(visibles, MAX_CUERPO - pie.length - resto.length) + resto + pie;
}

/**
 * Título y cuerpo del push de una tanda de cambios. `null` si los cambios se
 * compensaron: no hay nada que hacer en el depósito y el teléfono no suena.
 */
export function textoDePush(
  lugar: string,
  actorName: string,
  cambios: Cambio[],
): { title: string; body: string } | null {
  const netos = consolidarCambios(cambios);
  if (netos.length === 0) return null;
  // Se recorta solo el detalle: el "y N más" y el pie dicen cuántos cambios hay
  // y quién los hizo, y son lo último que se puede perder.
  return { title: lugar, body: cuerpoConTope(netos.map(describirCambio), actorName) };
}

/**
 * El push que corrige a uno ya mandado cuando lo que avisaba se deshizo (se
 * agregó Hielo, salió el aviso, y enseguida lo sacaron). Sin esto el teléfono
 * se quedaba con "Hielo +20" y el depósito lo preparaba igual. Va con el mismo
 * `tag` que el anterior para que lo reemplace en la pantalla.
 */
export function textoDeLoDeshecho(lugar: string, actorName: string): { title: string; body: string } {
  return { title: lugar, body: `Sin cambios: lo avisado recién se deshizo${pieDe(actorName)}` };
}

/**
 * El aviso de un cambio sobre algo ya preparado: no qué se tocó, sino qué hay
 * que hacer en el depósito. `null` si no queda nada por aplicar (alguien ya lo
 * aplicó, o el cambio se deshizo). Si el evento es hoy, el título lo dice
 * primero: es el que más urge.
 */
export function textoTardio(
  lugar: string,
  actorName: string,
  acciones: string[],
  esHoy: boolean,
): { title: string; body: string } | null {
  if (acciones.length === 0) return null;
  return {
    title: `${esHoy ? "HOY · " : ""}⚠ Cambio en pedido ya preparado · ${lugar}`,
    body: cuerpoConTope(acciones, actorName),
  };
}

/** Corrige un aviso tardío ya mandado cuando ya no queda nada por aplicar. Va
 *  con el mismo `tag` para reemplazarlo en la pantalla del teléfono. */
export function textoSinPendientes(lugar: string, actorName: string): { title: string; body: string } {
  return { title: `Pedido ya preparado · ${lugar}`, body: `Ya no hay cambios para aplicar${pieDe(actorName)}` };
}
