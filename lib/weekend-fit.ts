/**
 * A qué fin de semana pertenece un evento según su fecha.
 *
 * Vive aparte y sin depender de la base para poder probarlo solo: es la regla
 * que decide si un evento hay que moverlo de finde, y equivocarla significa
 * dejar un pedido colgado del finde que no es —contando contra el stock
 * equivocado— sin que nadie lo note hasta el sábado.
 *
 * Todo se compara **por día del calendario**, no por instante: el finde guarda
 * sus extremos a la medianoche, así que un evento del último día a las 21hs es
 * posterior a `endDate` aunque caiga adentro del fin de semana.
 */

export type RangoFinde = { id: string; label: string; startDate: Date; endDate: Date };

/** El día, sin la hora. */
export function soloDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** ¿Este finde cubre esta fecha? Los dos extremos entran. */
export function findeCubre(w: { startDate: Date; endDate: Date }, fecha: Date): boolean {
  const d = soloDia(fecha).getTime();
  return d >= soloDia(w.startDate).getTime() && d <= soloDia(w.endDate).getTime();
}

/**
 * Cuál de los findes le toca a esta fecha.
 *
 * Los findes pueden solaparse —hoy mismo hay uno "14 al 15" y otro "15 al 16"—,
 * así que un día puede caer en más de uno. Se prefiere **el que ya tiene el
 * evento** si sigue sirviendo: si la corrección de fecha no lo saca del finde
 * donde está, no hay ningún motivo para moverlo, y así el resultado no depende
 * de un desempate arbitrario. Recién si el actual no cubre la fecha se busca
 * otro, y ahí gana el que empieza primero.
 */
export function elegirFinde(
  findes: RangoFinde[],
  fecha: Date,
  findeActualId?: string | null
): RangoFinde | null {
  const cubren = findes.filter((w) => findeCubre(w, fecha));
  if (cubren.length === 0) return null;
  const actual = cubren.find((w) => w.id === findeActualId);
  if (actual) return actual;
  return [...cubren].sort((a, b) => soloDia(a.startDate).getTime() - soloDia(b.startDate).getTime())[0];
}

/**
 * Qué fin de semana proponer cuando no existe ninguno para esa fecha.
 *
 * Propone el sábado y el domingo de esa semana, que es como se arman todos los
 * findes de la empresa. Si el evento cae un viernes, el rango arranca ahí para
 * que lo incluya; si cae entre lunes y jueves —raro, pero pasa— se propone ese
 * único día, porque inventarle un fin de semana alrededor sería adivinar.
 */
export function proponerFinde(fecha: Date): { startDate: Date; endDate: Date } {
  const d = soloDia(fecha);
  const dia = d.getDay(); // 0 domingo … 6 sábado

  if (dia === 5 || dia === 6 || dia === 0) {
    // Viernes, sábado o domingo: se toma el finde entero al que pertenece.
    const viernes = new Date(d);
    // Del domingo hay que retroceder dos días; del sábado, uno.
    viernes.setDate(d.getDate() - (dia === 0 ? 2 : dia - 5));
    const domingo = new Date(viernes);
    domingo.setDate(viernes.getDate() + 2);
    return { startDate: viernes, endDate: domingo };
  }
  return { startDate: d, endDate: d };
}

/** "2026-08-15" a partir de una fecha, para mandarla a la acción de crear. */
export function aISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
