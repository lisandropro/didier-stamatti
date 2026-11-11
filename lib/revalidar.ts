import { revalidatePath } from "next/cache";

/**
 * Las pantallas que muestran el pedido de un evento, todas juntas.
 *
 * Antes cada acción revalidaba lo que se le había ocurrido a quien la escribió
 * —casi siempre solo la portada— y el pedido se ve en seis lugares: la portada
 * (faltantes y avance), el período, el editor del evento, la hoja para
 * imprimir, y Preparar (la lista y el evento). No se notaba porque todas las
 * páginas son dinámicas y porque en Next 16 un `revalidatePath` desde una
 * Server Function refresca además todo lo ya visitado; la documentación
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`)
 * dice que eso es temporal. Con la lista en un solo lugar, el día que cambie no
 * hay que acordarse de cada acción.
 *
 * `periodId` es el período del evento; si la acción lo movió de período, se
 * llama una vez más con el anterior.
 */
export function revalidarPedido(eventId: string, periodId?: string | null): void {
  revalidatePath("/");
  revalidatePath(`/evento/${eventId}`);
  revalidatePath(`/evento/${eventId}/pdf`);
  revalidatePath("/preparar");
  revalidatePath(`/preparar/${eventId}`);
  revalidatePath(`/preparar/${eventId}/levante`);
  if (periodId) revalidatePath(`/periodo/${periodId}`);
}

/** Un período entero cambió (se borró, volvió, cambió de fechas): la portada,
 *  su pantalla, la papelera del historial y la lista de Preparar. */
export function revalidarPeriodo(periodId: string): void {
  revalidatePath("/");
  revalidatePath(`/periodo/${periodId}`);
  revalidatePath("/historial");
  revalidatePath("/preparar");
}
