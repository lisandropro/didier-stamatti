// Una llave única generada en el navegador.
//
// **Por qué no se llama `crypto.randomUUID()` y listo.** Esa función solo existe
// en *contextos seguros*: HTTPS o `localhost`. Servida por IP en la red local
// —`http://192.168.0.220:3000`, que es exactamente cómo se prueba la app desde
// un teléfono— **no existe**, y llamarla tira un `TypeError`.
//
// Eso rompió la pantalla de captura de una forma particularmente fea: la llamada
// estaba *antes* del `try`, así que la excepción se llevaba puesto el `finally`
// que soltaba la guarda de reentrada. Resultado: el primer toque del botón de la
// cámara fallaba en silencio y **todos los siguientes salían por el `return` de
// la primera línea**. Desde afuera, un botón que no hace absolutamente nada.
//
// El respaldo no es criptográfico y no necesita serlo: la llave solo tiene que
// ser distinta entre capturas del mismo teléfono para que un doble toque no cree
// dos comprobantes. La unicidad real la garantiza el índice de la base.

export function llaveDeCliente(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Si este navegador puede abrir la cámara.
 *
 * `navigator.mediaDevices` tampoco existe fuera de un contexto seguro, y el
 * mensaje genérico "no se pudo abrir la cámara" manda a buscar el problema al
 * lugar equivocado: se revisan permisos, se reinicia el teléfono, y el problema
 * era la dirección.
 */
export function porQueNoHayCamara(): string | null {
  if (typeof navigator === "undefined") return "Este navegador no permite usar la cámara.";

  if (!navigator.mediaDevices?.getUserMedia) {
    // `isSecureContext` es la causa en el 99% de los casos, y decirlo con la
    // dirección a la vista ahorra media hora de buscar en el lugar equivocado.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return (
        "La cámara necesita una dirección segura (https://) y esta página está abierta por " +
        `http://${typeof location !== "undefined" ? location.host : ""}. ` +
        "Entrá por la dirección publicada de la app, o usá esta pantalla desde la computadora."
      );
    }
    return "Este navegador no permite abrir la cámara desde una página web.";
  }
  return null;
}
