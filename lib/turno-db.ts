// Quién usa la conexión a la base, y cuándo.
//
// El adaptador de SQLite trabaja con UNA sola conexión. Una transacción hace
// `BEGIN` sobre ella y la deja abierta mientras su código espera cosas; todo lo
// que llegue en el medio por la misma conexión —el tilde de otro teléfono, un
// aviso, un barrido— cae ADENTRO de esa transacción. Si la transacción vuelve
// atrás, se lleva también esas escrituras ajenas: a la otra persona la pantalla
// le dijo "guardado" y el dato no está. Y un respaldo (`VACUUM INTO`) que cae
// en el medio falla, porque no se puede hacer adentro de una transacción.
//
// La regla que se aplica acá es la de un candado de lectores y escritor:
//   - las operaciones sueltas pueden correr varias a la vez;
//   - una transacción corre sola: espera a que terminen las sueltas en curso, y
//     las sueltas que llegan mientras tanto esperan a que termine ella.
//
// No sabe nada de Prisma a propósito: así se prueba sin base.

/** Cuánto espera alguien su turno antes de pasar igual.
 *
 *  Es una válvula, no la regla: si alguna vez dos cosas se esperaran entre sí,
 *  pasado este tiempo la app sigue andando como andaba antes de este candado,
 *  en vez de quedarse colgada. Es más que los 5 s que Prisma le da a una
 *  transacción, así que una transacción trabada vence primero y libera. */
export const ESPERA_MAXIMA_MS = 8000;

type Espera = { pasar: () => void };

export type Turno = {
  /** Pide turno para una operación suelta. Devuelve cómo avisar que terminó. */
  entrarSuelta(): Promise<() => void>;
  /** Pide turno para una transacción. Devuelve cómo avisar que terminó. */
  entrarTransaccion(): Promise<() => void>;
  /** Para las pruebas y el diagnóstico. */
  estado(): { sueltas: number; transaccion: boolean; esperando: number };
};

export function crearTurno(esperaMaximaMs: number = ESPERA_MAXIMA_MS): Turno {
  let sueltas = 0;
  let transaccion = false;
  const transaccionesEnEspera: Espera[] = [];
  const sueltasEnEspera: Espera[] = [];

  // Quien libera le pasa el turno al que sigue ANTES de despertarlo: marca el
  // estado como si ya hubiera entrado. Si lo marcara el que se despierta, entre
  // el aviso y el despertar podría colarse otro que viera el camino libre.
  function repartir() {
    if (transaccion || sueltas > 0) return;
    const siguiente = transaccionesEnEspera.shift();
    if (siguiente) {
      transaccion = true;
      siguiente.pasar();
      return;
    }
    const todas = sueltasEnEspera.splice(0);
    sueltas += todas.length;
    for (const s of todas) s.pasar();
  }

  /** Espera en `fila`. `true` = le dieron el turno; `false` = se cansó. */
  function esperar(fila: Espera[]): Promise<boolean> {
    return new Promise((resolver) => {
      const espera: Espera = {
        pasar: () => {
          clearTimeout(reloj);
          resolver(true);
        },
      };
      const reloj = setTimeout(() => {
        const i = fila.indexOf(espera);
        if (i >= 0) fila.splice(i, 1);
        resolver(false);
      }, esperaMaximaMs);
      // Que un proceso que está terminando no se quede vivo por este reloj.
      if (typeof reloj === "object" && "unref" in reloj) reloj.unref();
      fila.push(espera);
    });
  }

  function soltarUnaVez(soltar: () => void): () => void {
    let hecho = false;
    return () => {
      if (hecho) return;
      hecho = true;
      soltar();
    };
  }

  const nada = () => {};

  return {
    async entrarSuelta() {
      // Si hay una transacción esperando, la suelta nueva espera también: si
      // no, un goteo de operaciones sueltas no la dejaría empezar nunca.
      if (transaccion || transaccionesEnEspera.length > 0) {
        const conTurno = await esperar(sueltasEnEspera);
        // Sin turno pasa igual, pero sin anotarse: no tiene nada que liberar.
        if (!conTurno) return nada;
      } else {
        sueltas++;
      }
      return soltarUnaVez(() => {
        sueltas--;
        repartir();
      });
    },

    async entrarTransaccion() {
      if (transaccion || sueltas > 0) {
        const conTurno = await esperar(transaccionesEnEspera);
        if (!conTurno) return nada;
      } else {
        transaccion = true;
      }
      return soltarUnaVez(() => {
        transaccion = false;
        repartir();
      });
    },

    estado() {
      return {
        sueltas,
        transaccion,
        esperando: transaccionesEnEspera.length + sueltasEnEspera.length,
      };
    },
  };
}
