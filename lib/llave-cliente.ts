// Una llave única generada en el navegador.
//
// La usa el formulario de sugerencias: una llave por redacción, que viaja con
// el envío y tiene un índice único en la base. Es lo que hace que un doble
// toque —o un reintento al volver la señal— no cree dos sugerencias.
//
// **Por qué no se llama `crypto.randomUUID()` y listo.** Esa función solo existe
// en *contextos seguros*: HTTPS o `localhost`. Servida por IP en la red local
// —`http://192.168.0.220:3000`, que es exactamente cómo se prueba la app desde
// un teléfono— **no existe**, y llamarla tira un `TypeError`. Ya rompió una
// pantalla de una forma particularmente fea: la llamada estaba *antes* del
// `try`, así que la excepción se llevaba puesto el `finally` que soltaba la
// guarda de reentrada. Resultado: el primer toque del botón fallaba en silencio
// y **todos los siguientes salían por el `return` de la primera línea**. Desde
// afuera, un botón que no hace absolutamente nada.
//
// El respaldo no es criptográfico y no necesita serlo: la llave solo tiene que
// ser distinta entre envíos del mismo teléfono. La unicidad real la garantiza
// el índice de la base.
//
// (Hasta el 19/10/2026 vivía acá también el diagnóstico de la cámara, de la
// pantalla de captura del módulo financiero. Se fue con ese módulo.)

export function llaveDeCliente(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
