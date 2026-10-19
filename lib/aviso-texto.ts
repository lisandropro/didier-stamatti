// El texto del push de cambios de pedido, en un solo lugar y sin dependencias.
//
// Hasta el 19/10/2026 el push decía "Enrique hizo 7 cambios en el pedido de X".
// El que prepara tenía que abrir la app y buscar a ojo qué se tocó. Ahora dice
// qué cambió, neto: si una cantidad pasó de 10 a 12 y de 12 a 24, dice 10→24.

export type Cambio = { itemName: string; kind: string; before: string | null; after: string | null };

const DE_CANTIDAD = new Set(["AGREGADO", "QUITADO", "CANTIDAD"]);
const MAX_EN_EL_PUSH = 3;
const MAX_CUERPO = 500;

/**
 * Junta los cambios de cada ítem en uno solo, del primer "antes" al último
 * "después". Lo que terminó igual que como empezó desaparece: al depósito no
 * le cambia nada.
 *
 * Las cantidades se agrupan por ítem (agregar, sacar y cambiar son la misma
 * cosa vista desde el depósito), las notas también, y los datos del evento
 * (fecha, lugar, responsable...) por tipo.
 */
export function consolidarCambios(cambios: Cambio[]): Cambio[] {
  const grupos = new Map<string, { primero: Cambio; ultimo: Cambio }>();
  for (const cambio of cambios) {
    const clave = DE_CANTIDAD.has(cambio.kind)
      ? `Q:${cambio.itemName}`
      : cambio.kind === "NOTA"
        ? `N:${cambio.itemName}`
        : `O:${cambio.kind}`;
    const g = grupos.get(clave);
    if (g) g.ultimo = cambio;
    else grupos.set(clave, { primero: cambio, ultimo: cambio });
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
      if ((before ?? "") !== (after ?? "")) netos.push({ itemName, kind: "NOTA", before, after });
    } else if (ultimo.kind === "COPIADO" || before !== after) {
      netos.push({ ...ultimo, before });
    }
  }
  return netos;
}

function recortar(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
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
      return `Lugar: ${c.after}`;
    case "FECHA":
      return `Fecha: ${c.after}`;
    case "INVITADOS":
      return `Invitados: ${c.after}`;
    case "PERIODO":
      return `Período: ${c.after}`;
    default:
      return c.itemName;
  }
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
  const visibles = netos.slice(0, MAX_EN_EL_PUSH).map(describirCambio).join(" · ");
  const resto = netos.length > MAX_EN_EL_PUSH ? ` · y ${netos.length - MAX_EN_EL_PUSH} más` : "";
  const pie = `\n— ${actorName}`;
  return { title: lugar, body: recortar(visibles + resto, MAX_CUERPO - pie.length) + pie };
}
