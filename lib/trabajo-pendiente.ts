// Quién está a mitad de algo.
//
// La app se actualiza sola cuando cambia de versión, pero no puede hacerlo
// encima de trabajo sin guardar. El armador de pedidos guarda con 700 ms de
// retraso: si la recarga cae en ese hueco, la última cantidad tipeada se pierde.
//
// Es un contador y no un booleano a propósito: puede haber varias cosas a medio
// guardar al mismo tiempo, y la app solo está libre cuando no queda ninguna.

let pendientes = 0;

/** Lo llama quien empieza algo que todavía no está en la base. */
export function marcarPendiente(): void {
  pendientes++;
}

/** Lo llama cuando eso terminó, salga bien o mal. */
export function marcarGuardado(): void {
  pendientes = Math.max(0, pendientes - 1);
}

/**
 * ¿Hay algo a medio guardar, un formulario abierto, o alguien tipeando?
 *
 * Lo del teclado y los formularios se mira en el momento y no se registra: es
 * más confiable preguntarle al navegador quién tiene el foco que pedirle a cada
 * pantalla que avise cuándo abre y cierra algo.
 */
export function estaOcupado(): boolean {
  if (pendientes > 0) return true;
  if (typeof document === "undefined") return false;

  // Un modal abierto: alguien está cargando un evento, un producto o una sugerencia.
  if (document.querySelector(".overlay")) return true;

  // Alguien escribiendo.
  const foco = document.activeElement;
  if (foco instanceof HTMLInputElement || foco instanceof HTMLTextAreaElement || foco instanceof HTMLSelectElement) {
    return true;
  }
  return false;
}

/** Solo para las pruebas: deja el contador como recién arrancado. */
export function _reiniciar(): void {
  pendientes = 0;
}
