import { diaDe, diasEntre, esDia, fmtRangoDias, sumarDias } from "@/lib/dates";

/**
 * A qué período operativo pertenece un evento.
 *
 * La regla nueva, y la razón de que este archivo exista: **cuando hay más de un
 * período que cubre una fecha, no se elige solo.** Los períodos pueden
 * superponerse porque los arma una persona según cómo salga el trabajo, y
 * adivinar cuál corresponde significa contar la vajilla contra el grupo
 * equivocado. Antes había una regla de desempate ("el que empieza primero") y
 * eso es exactamente lo que hay que no hacer: se devuelven los candidatos y
 * decide quien sabe.
 *
 * Todo se compara como **texto de fecha** `AAAA-MM-DD`. Sin instantes no hay
 * zonas horarias, y sin zonas horarias no hay días que se corran.
 */

export type Periodo = {
  id: string;
  label: string | null;
  startDay: string;
  endDay: string;
};

/** El nombre que se muestra: el propio si lo tiene, si no el rango. */
export function nombreDe(p: { label: string | null; startDay: string; endDay: string }): string {
  return p.label?.trim() || fmtRangoDias(p.startDay, p.endDay);
}

/** ¿Este período cubre este día de calendario? Los dos extremos entran. */
export function cubreDia(p: { startDay: string; endDay: string }, dia: string): boolean {
  return dia >= p.startDay && dia <= p.endDay;
}

/** ¿Cubre el día (argentino) de este instante? */
export function cubreInstante(p: { startDay: string; endDay: string }, instante: Date): boolean {
  return cubreDia(p, diaDe(instante));
}

/** Cuántos días dura. Un período de una sola jornada dura 1. */
export function duracion(p: { startDay: string; endDay: string }): number {
  return diasEntre(p.startDay, p.endDay) + 1;
}

export type Ubicacion =
  /** Ningún período cubre esa fecha: hay que crear uno o elegir otro a mano. */
  | { tipo: "ninguno"; sugerido: { startDay: string; endDay: string } }
  /** Exactamente uno: se propone como destino. */
  | { tipo: "uno"; periodo: Periodo }
  /** Varios: elige la persona. Nunca se desempata solo. */
  | { tipo: "varios"; candidatos: Periodo[] };

/**
 * Dónde iría un evento de este día.
 *
 * Devuelve los candidatos, no una decisión. El único caso resuelto es cuando hay
 * uno solo, porque ahí no hay nada que elegir.
 */
export function ubicarDia(periodos: Periodo[], dia: string): Ubicacion {
  const cubren = periodos.filter((p) => cubreDia(p, dia));
  if (cubren.length === 0) return { tipo: "ninguno", sugerido: sugerirPeriodo(dia) };
  if (cubren.length === 1) return { tipo: "uno", periodo: cubren[0] };
  // Se ordenan del más corto al más largo solo para mostrarlos: el más ajustado
  // suele ser el que la persona quiere, pero la elección sigue siendo suya.
  const orden = [...cubren].sort(
    (a, b) => duracion(a) - duracion(b) || a.startDay.localeCompare(b.startDay) || a.id.localeCompare(b.id)
  );
  return { tipo: "varios", candidatos: orden };
}

/**
 * Qué período proponer cuando no existe ninguno para esa fecha.
 *
 * **Propone ese único día.** Antes proponía de viernes a domingo, porque el
 * modelo se llamaba "fin de semana"; la empresa trabaja todos los días y un
 * evento de un martes no tiene por qué arrastrar el finde entero. Una sola
 * jornada es el período más chico que resuelve el caso, y siempre se puede
 * estirar después editándolo.
 */
export function sugerirPeriodo(dia: string): { startDay: string; endDay: string } {
  return { startDay: dia, endDay: dia };
}

/** Qué está mal en este rango, o null si está bien. */
export function problemaDeRango(startDay: string, endDay: string): string | null {
  if (!esDia(startDay) || !esDia(endDay)) return "Elegí las fechas del período.";
  if (endDay < startDay) return "La fecha de fin no puede ser anterior a la de inicio.";
  // Un tope generoso: no hay nada que impida un período largo, pero uno de años
  // casi siempre es un error de tipeo en el año.
  if (diasEntre(startDay, endDay) > 366) return "Ese período dura más de un año. ¿Está bien la fecha?";
  return null;
}

/**
 * ¿Ya hay un período igual? Evita el duplicado de apretar dos veces o de crear
 * de nuevo algo que ya existía. Mismo rango exacto = duplicado.
 */
export function duplicadoDe(periodos: Periodo[], startDay: string, endDay: string, exceptoId?: string): Periodo | null {
  return periodos.find((p) => p.id !== exceptoId && p.startDay === startDay && p.endDay === endDay) ?? null;
}

/**
 * Los eventos que quedarían fuera si el período pasara a este rango.
 *
 * Se usa al editar las fechas: achicar un período puede dejar eventos afuera, y
 * un evento que cuelga de un período que no cubre su fecha cuenta contra el
 * stock equivocado.
 */
export function eventosQueQuedanFuera<T extends { id: string; lugar: string; date: Date }>(
  eventos: T[],
  startDay: string,
  endDay: string
): T[] {
  return eventos.filter((e) => !cubreDia({ startDay, endDay }, diaDe(e.date)));
}

/** El rango mínimo que contiene a todos estos eventos. Sirve para ofrecer un
 *  arreglo cuando al achicar quedan eventos afuera. */
export function rangoQueLosContiene(eventos: { date: Date }[]): { startDay: string; endDay: string } | null {
  if (eventos.length === 0) return null;
  const dias = eventos.map((e) => diaDe(e.date)).sort();
  return { startDay: dias[0], endDay: dias[dias.length - 1] };
}

/** Un período que arranca hoy y dura un día — el que se ofrece por defecto. */
export function periodoDeHoy(hoyDia: string): { startDay: string; endDay: string } {
  return { startDay: hoyDia, endDay: hoyDia };
}

export { sumarDias };
