import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { aporteAlSaldo, NO_SE_PAGAN } from "./politica";
import { esCostoDeEvento } from "./categorias";

// El costo de un evento, y con él el margen.
//
// **Acá no se mide: se reparte, y la diferencia importa.** El sistema no sabe
// qué se compró para cada fiesta — el catálogo tiene bebida, vajilla y
// mobiliario, y la comida, que es el costo más grande de un catering, no está
// modelada en ningún lado. Inventar una atribución exacta sería peor que no
// tener el número: se usaría para poner precios.
//
// Lo que sí se puede hacer, y es lo que hace la industria, es **costo por
// cubierto**: lo que se compró en un período se reparte entre los eventos de
// ese período en proporción a sus comensales. No dice cuánto costó ESA fiesta;
// dice cuánto cuesta un cubierto en ese período, que es la pregunta que de
// verdad sirve para fijar precios.
//
// Tres cosas que el reparto informa siempre, porque sin ellas el número
// engaña:
//
//   - **cuánto quedó afuera por falta de clasificación** del proveedor;
//   - **cuánto se excluyó a propósito** por no ser costo de evento (impuestos,
//     seguros, retiros);
//   - **que es un reparto**, dicho con todas las letras en la pantalla.

/** Un período con sus eventos, tal como viene de la base del stock. */
export type PeriodoConEventos = {
  id: string;
  label: string | null;
  startDay: string;
  endDay: string;
  eventos: { id: string; lugar: string; guests: number }[];
};

export type CostoDelEvento = {
  eventoId: string;
  /** Cuántos cubiertos pesó este evento en el reparto. */
  cubiertos: number;
  /** Su parte del costo del período, en CENTAVOS. */
  costo: bigint;
};

export type RepartoDelPeriodo = {
  periodoId: string;
  /** Lo que se reparte: comprobantes de rubros que SÍ son costo de evento. */
  costoRepartible: bigint;
  /** Lo que quedó afuera porque el proveedor no tiene rubro cargado. Es la
   *  medida de cuán incompleto está el número. */
  sinClasificar: bigint;
  /** Lo que quedó afuera a propósito: impuestos, seguros, retiros de socios. */
  noEsDeEventos: bigint;
  /** Cuántos comprobantes no tienen importe. No son cero: no se sabe. */
  sinImporte: number;
  cubiertosTotales: number;
  porEvento: CostoDelEvento[];
};

/**
 * Reparte el costo de un período entre sus eventos.
 *
 * **El reparto es proporcional a los cubiertos y el resto va al más grande.**
 * Dividir centavos entre tres eventos casi nunca da exacto; si cada parte se
 * redondeara por su cuenta, la suma de las partes no daría el total y la
 * pantalla mostraría una diferencia que nadie puede explicar. Se reparte por
 * división entera y **el sobrante se le da al evento de más cubiertos**, así la
 * suma cierra al centavo siempre.
 *
 * Si no hay cubiertos —ningún evento tiene gente cargada— no se reparte nada:
 * repartir en partes iguales sería inventar un criterio.
 */
export function repartir(
  costoRepartible: bigint,
  eventos: { eventoId: string; cubiertos: number }[],
): CostoDelEvento[] {
  const total = eventos.reduce((a, e) => a + e.cubiertos, 0);
  if (total <= 0 || eventos.length === 0) {
    return eventos.map((e) => ({ eventoId: e.eventoId, cubiertos: e.cubiertos, costo: 0n }));
  }

  const totalBig = BigInt(total);
  const partes = eventos.map((e) => ({
    eventoId: e.eventoId,
    cubiertos: e.cubiertos,
    costo: (costoRepartible * BigInt(e.cubiertos)) / totalBig,
  }));

  const repartido = partes.reduce((a, p) => a + p.costo, 0n);
  const sobra = costoRepartible - repartido;
  if (sobra !== 0n) {
    // Al de más cubiertos: es donde menos se nota y es determinista. Con
    // empate, el primero por id, para que dos corridas den lo mismo.
    let i = 0;
    for (let j = 1; j < partes.length; j++) {
      const mejor = partes[i];
      const otro = partes[j];
      if (otro.cubiertos > mejor.cubiertos) i = j;
      else if (otro.cubiertos === mejor.cubiertos && otro.eventoId < mejor.eventoId) i = j;
    }
    partes[i].costo += sobra;
  }
  return partes;
}

/**
 * A qué período pertenece un comprobante.
 *
 * **La fecha de la factura casi nunca cae adentro del período.** La comida de
 * un sábado se compra el jueves, y el período es el fin de semana. Así que un
 * comprobante va al primer período que **termina** en su fecha o después: el de
 * adentro si cae adentro, y si cae en el medio de dos, al que viene.
 *
 * Lo que queda después del último período no se asigna: todavía no se sabe para
 * qué evento fue.
 */
export function periodoDe(
  fecha: string,
  periodos: { id: string; startDay: string; endDay: string }[],
): string | null {
  const ordenados = [...periodos].sort((a, b) => (a.endDay < b.endDay ? -1 : a.endDay > b.endDay ? 1 : 0));
  for (const p of ordenados) if (p.endDay >= fecha) return p.id;
  return null;
}

/**
 * El costo de cada evento de estos períodos.
 *
 * Recibe los períodos ya leídos de la base del stock: este módulo vive en la
 * base financiera y no cruza por su cuenta, igual que el resto del módulo.
 */
export async function costoPorEvento(
  periodos: PeriodoConEventos[],
  cubiertosDe: (eventoId: string, guests: number) => number,
  entidadId?: string | null,
): Promise<Map<string, RepartoDelPeriodo>> {
  const salida = new Map<string, RepartoDelPeriodo>();
  if (periodos.length === 0) return salida;

  const desde = periodos.reduce((a, p) => (p.startDay < a ? p.startDay : a), periodos[0].startDay);
  const hasta = periodos.reduce((a, p) => (p.endDay > a ? p.endDay : a), periodos[0].endDay);

  // Se trae desde bastante antes del primer período: lo que se compró para el
  // primer fin de semana se facturó antes de que empezara.
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      fechaEmision: { gte: restar(desde, 30), lte: hasta },
      ...(entidadId === undefined ? {} : { entidadId }),
    },
    select: {
      fechaEmision: true,
      importeTotal: true,
      kind: true,
      supplier: { select: { categoria: true } },
    },
  });

  const acc = new Map<string, { repartible: bigint; sinClasificar: bigint; noEs: bigint; sinImporte: number }>();
  for (const p of periodos) {
    acc.set(p.id, { repartible: 0n, sinClasificar: 0n, noEs: 0n, sinImporte: 0 });
  }

  for (const d of docs) {
    if (!d.fechaEmision) continue;
    const pid = periodoDe(d.fechaEmision, periodos);
    if (!pid) continue;
    const a = acc.get(pid);
    if (!a) continue;

    if (d.importeTotal == null) {
      a.sinImporte += 1;
      continue;
    }
    const monto = aporteAlSaldo(d.kind, d.importeTotal);
    const cat = d.supplier?.categoria ?? null;
    if (cat == null) a.sinClasificar += monto;
    else if (esCostoDeEvento(cat)) a.repartible += monto;
    else a.noEs += monto;
  }

  for (const p of periodos) {
    const a = acc.get(p.id)!;
    const eventos = p.eventos.map((e) => ({
      eventoId: e.id,
      cubiertos: cubiertosDe(e.id, e.guests),
    }));
    salida.set(p.id, {
      periodoId: p.id,
      costoRepartible: a.repartible,
      sinClasificar: a.sinClasificar,
      noEsDeEventos: a.noEs,
      sinImporte: a.sinImporte,
      cubiertosTotales: eventos.reduce((x, e) => x + e.cubiertos, 0),
      porEvento: repartir(a.repartible, eventos),
    });
  }
  return salida;
}

/** Un día "AAAA-MM-DD" menos N días, sin `Date` de por medio. */
function restar(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - n));
  const dd = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${dd(t.getUTCMonth() + 1)}-${dd(t.getUTCDate())}`;
}
