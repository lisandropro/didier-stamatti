import { createHash } from "node:crypto";

// La capa bancaria: el modelo y la frontera, sin ningún parser.
//
// **Lo que se investigó y lo que NO se va a inventar.** Banco Macro no ofrece
// una API pública para pymes. El patrón argentino es que el home banking
// entrega PDF —Galicia lo dice explícitamente y existe una industria de
// conversores de extractos de Macro, que es la mejor evidencia—. Interbanking
// con su servicio DATANET sí entrega archivos estructurados de movimientos y
// saldos, pero exige adhesión y no está confirmado que la empresa la tenga.
//
// Por eso acá hay un `AdaptadorBancario` y no un lector de Macro. El formato
// concreto se escribe cuando exista un archivo real — igual que el lector de QR,
// que se escribió contra payloads reales y por eso soporta los que vienen rotos.
// Escribirlo antes sería adivinar, y adivinar sobre plata se paga caro.

/** Un movimiento tal como lo entiende el sistema, ya normalizado. */
export type MovimientoNormalizado = {
  fechaContable: string; // "AAAA-MM-DD"
  fechaValor?: string;
  descripcion: string; // cruda, tal cual la imprime el banco
  referencia?: string;
  importe: bigint; // CENTAVOS, CON SIGNO: acá el signo es del banco
  saldoPosterior?: bigint;
  idExterno?: string;
};

/**
 * Lo que tiene que saber hacer cualquier formato de extracto.
 *
 * El banco es un dato, no una estructura. Sumar Interbanking o cambiar de banco
 * es escribir otro adaptador, no tocar el módulo financiero.
 */
export type AdaptadorBancario = {
  /** Cómo se llama, y con qué se guarda en `BankMovement.origen`. */
  id: string;
  /** Nombre para la pantalla. */
  nombre: string;
  /** Si este adaptador reconoce el archivo. */
  reconoce(contenido: Buffer, nombreArchivo: string): boolean;
  /** Del archivo a movimientos. Tira con el número de línea si no entiende algo:
   *  una fila que no se entiende se rechaza, no se importa a medias. */
  leer(contenido: Buffer): MovimientoNormalizado[];
};

/**
 * La huella que impide importar dos veces el mismo movimiento.
 *
 * Los extractos se bajan por rango y los rangos se pisan: sin esto, reimportar
 * un mes duplica todo y el saldo se va al doble. Es el mismo argumento que la
 * `clientKey` de la captura, aplicado al banco.
 *
 * `orden` es la posición del movimiento **dentro de su propio día**, y no es un
 * detalle: dos débitos idénticos el mismo día son perfectamente legítimos —dos
 * transferencias iguales, dos comisiones— y sin ese desempate el segundo se
 * descartaría como duplicado. Es el error opuesto y peor: perder plata que sí
 * ocurrió.
 *
 * Cuando el banco da un identificador propio se usa ese y no se calcula nada.
 */
export function huellaDeMovimiento(
  cuentaId: string,
  m: MovimientoNormalizado,
  orden: number,
): string {
  if (m.idExterno) return `ext:${cuentaId}:${m.idExterno}`;

  const partes = [
    cuentaId,
    m.fechaContable,
    m.importe.toString(),
    // La descripción se normaliza SOLO para la huella —espacios colapsados,
    // mayúsculas— porque el mismo banco imprime el mismo concepto con
    // espaciados distintos entre exportaciones. La descripción guardada sigue
    // siendo la cruda.
    m.descripcion.trim().replace(/\s+/g, " ").toUpperCase(),
    String(orden),
  ];
  return createHash("sha256").update(partes.join("|")).digest("hex").slice(0, 32);
}

/**
 * Numera los movimientos dentro de cada día, en el orden en que vienen.
 *
 * El orden del archivo es el orden del banco, y es la única forma de desempatar
 * dos movimientos idénticos del mismo día.
 */
export function conOrdenDiario(movs: MovimientoNormalizado[]): { m: MovimientoNormalizado; orden: number }[] {
  const porDia = new Map<string, number>();
  return movs.map((m) => {
    const n = (porDia.get(m.fechaContable) ?? 0) + 1;
    porDia.set(m.fechaContable, n);
    return { m, orden: n };
  });
}

export type ControlDeSaldos =
  | { cierra: true }
  | { cierra: false; enLinea: number; esperado: bigint; declarado: bigint }
  | { cierra: null };

/**
 * Verifica que la cadena de saldos cierre: `saldo[n-1] + importe[n] == saldo[n]`.
 *
 * Es un control que no cuesta nada y detecta lo que ninguna otra cosa detecta:
 * **una fila que falta**. Un extracto al que le falta un movimiento se ve
 * perfectamente normal fila por fila; la cadena de saldos no.
 *
 * Es la misma disciplina que ya usa el módulo con los renglones de una factura
 * —el documento queda sobredeterminado y un error rompe alguna de las cuentas—,
 * aplicada al extracto.
 *
 * Devuelve `cierra: null` cuando el archivo no trae saldos: no se puede
 * verificar, que no es lo mismo que estar mal.
 */
export function controlarSaldos(movs: MovimientoNormalizado[]): ControlDeSaldos {
  const conSaldo = movs.filter((m) => m.saldoPosterior != null);
  if (conSaldo.length < 2 || conSaldo.length !== movs.length) return { cierra: null };

  for (let i = 1; i < movs.length; i++) {
    const esperado = movs[i - 1].saldoPosterior! + movs[i].importe;
    if (esperado !== movs[i].saldoPosterior!) {
      return { cierra: false, enLinea: i + 1, esperado, declarado: movs[i].saldoPosterior! };
    }
  }
  return { cierra: true };
}

/**
 * Los conceptos del extracto que NO corresponden a un pago a proveedor.
 *
 * Son la mayoría de las líneas y hay que decirlo porque es contraintuitivo. En
 * Argentina el impuesto de la ley 25.413 aparece pegado a cada movimiento, así
 * que un extracto con 60 movimientos puede traer 60 líneas más que no son
 * gastos operativos ni corresponden a ninguna factura.
 *
 * Clasificarlas automáticamente es lo que hace que conciliar un mes sea posible:
 * sin esto, quien concilia tiene que mirar el doble de líneas y abandona al
 * segundo mes.
 *
 * **Ninguna alícuota está escrita acá a propósito.** El porcentaje del impuesto
 * y el cómputo como pago a cuenta cambian por decreto y dependen de la
 * categoría de la empresa: lo define el contador, o se deriva del propio
 * extracto. Acá solo se reconoce el concepto.
 */
export const CATEGORIAS_BANCARIAS = [
  { categoria: "IMPUESTO_25413", patron: /LEY\s*25\.?413|IMP\.?\s*DEB|IMP\.?\s*CRED|D[EÉ]B.*CR[EÉ]D/i },
  { categoria: "SIRCREB", patron: /SIRCREB|RET\.?\s*IIBB|RETENCI[OÓ]N\s*IB/i },
  { categoria: "IVA_COMISION", patron: /IVA/i },
  { categoria: "COMISION", patron: /COMISI[OÓ]N|MANTENIMIENTO|GASTOS?\s*ADM/i },
  { categoria: "INTERES", patron: /INTER[EÉ]S/i },
] as const;

/**
 * Qué concepto bancario parece ser una línea, o `null` si parece un pago.
 *
 * Solo se usa para SUGERIR. Nada se concilia solo: la regla del módulo es que
 * el sistema propone y una persona confirma, y con plata no hay excepción.
 */
export function categoriaSugerida(descripcion: string): string | null {
  for (const { categoria, patron } of CATEGORIAS_BANCARIAS) {
    if (patron.test(descripcion)) return categoria;
  }
  return null;
}
