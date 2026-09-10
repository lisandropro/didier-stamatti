import { prismaComprobantes as db } from "@/lib/db-comprobantes";
import { diasEntre, sumarDias } from "@/lib/dates";
import { aporteAlSaldo, NO_SE_PAGAN, sePaga } from "./politica";

// Lo que ve y hace quien paga.
//
// El pago se hace de las dos formas: a veces una factura suelta, a veces varias
// del mismo proveedor en una sola transferencia. Por eso no hay conciliación de
// pagos contra comprobantes: alcanza con que el sistema sume por proveedor y
// con poder marcar varias de una vez.
//
// Toda escritura de este archivo va dentro de una transacción. El dato y su
// registro en el historial se guardan juntos o no se guarda ninguno: un pago
// marcado sin rastro de quién lo marcó es peor que un pago no marcado, porque
// después nadie puede reconstruirlo.

const DIA = /^\d{4}-\d{2}-\d{2}$/;

// El signo de cada tipo vive en `politica.ts`, en un solo lugar. Estaba escrito
// por separado acá y en `documento.ts`, y una tercera copia —en el resumen de
// la pantalla— nacio sumando las notas de credito en vez de restarlas.

// `NO_SE_PAGAN` vive en `politica.ts`, junto a la regla del signo: son la misma
// regla dicha de dos formas, y separarlas es como se desincronizan.

export type DeudaProveedor = {
  supplierId: string | null;
  nombre: string;
  total: bigint;
  cantidad: number;
  /** Cuántos de esos comprobantes NO tienen importe cargado.
   *
   *  Existe porque el total de arriba es lo que alguien va a transferir. Con 13
   *  de cada 18 comprobantes entrando sin código legible, un total que suma
   *  cero por los que faltan **no es un total**: es un número más chico que la
   *  deuda real, presentado con la misma autoridad. La pantalla tiene que poder
   *  decir "$764.107,11 y dos sin importe" en vez de mentir por lo bajo. */
  sinImporte: number;
};

export type DocumentoAPagar = {
  id: string;
  nombre: string;
  importeTotal: bigint | null;
  /** La fecha que dice el papel. NULL = el papel no la dice, que es lo normal:
   *  la mayoría de las facturas son cuenta corriente. */
  vencimiento: string | null;
  /**
   * La fecha calculada con el plazo pactado con el proveedor: emisión más sus
   * días.
   *
   * **Va aparte y NO se guarda.** Un cálculo que se escribe en la base deja de
   * distinguirse de un dato leído del papel, y a los dos meses nadie sabe cuál
   * es cuál. Se recalcula sola si el plazo del proveedor cambia, que es lo
   * correcto: si se acordó otra cosa, las facturas viejas también se pagan con
   * la nueva.
   */
  propuesto: string | null;
  /** El proveedor debita solo: nadie paga esto a mano. */
  debitoAutomatico: boolean;
  kind: string;
};

/**
 * La fecha con la que este comprobante entra en las listas.
 *
 * **El papel le gana al cálculo.** Si la factura dice una fecha, esa manda: el
 * plazo pactado es lo que se hace cuando el papel no dice nada.
 */
export function fechaDePagoEsperada(d: {
  vencimiento: string | null;
  propuesto: string | null;
}): string | null {
  return d.vencimiento ?? d.propuesto;
}

/** Qué pasó al marcar pagos. Devolver un número solo escondía los que se
 *  saltearon, y saltear en silencio es como se paga dos veces. */
export type ResultadoPago = {
  marcados: number;
  /** Ya tenían fecha de pago: no se tocaron. Volver a marcar pisaría la fecha
   *  en que salió la plata, que es el único dato con el que después se cruza
   *  contra el extracto bancario. */
  yaEstaban: number;
  /** Remitos y otros tipos que no se pagan. */
  noSePagan: number;
  /** Ids que no existen o están anulados. */
  noEncontrados: number;
};

/**
 * El vencimiento que el sistema SUGIERE, sin guardarlo.
 *
 * Hay facturas que no traen fecha: la de Dinamark dice "7 DIAS", que es una
 * condición de pago y no un dato. La precedencia es siempre la misma:
 *
 *   1. La fecha que dice el papel, si dice una.
 *   2. Si no, emisión + `diasPago` del proveedor, marcado como propuesto.
 *   3. Si el proveedor no tiene `diasPago`, queda vacío y cae en la bandeja.
 *
 * Nunca se escribe solo: proponer es ayudar a quien paga, no decidir por ella.
 */
export function proponerVencimiento(
  fechaEmision: string | null,
  diasPago: number | null,
): string | null {
  if (!fechaEmision || diasPago == null) return null;
  return sumarDias(fechaEmision, diasPago);
}

/** Cuánto se le debe a cada proveedor, y en cuántos comprobantes. Es la
 *  pantalla desde la que se transfiere. */
/**
 * El filtro por entidad, en un solo lugar.
 *
 * `undefined` = todas las entidades. `null` = **solo las que no tienen entidad
 * asignada**, que es una pregunta legítima y distinta de "todas": son las que
 * hay que ir a resolver.
 *
 * Existe como función porque el mismo filtro va en cuatro consultas y
 * escribirlo cuatro veces es cómo una termina sin él — y una pantalla de plata
 * que se olvida de filtrar suma dos contribuyentes en el mismo total.
 */
function filtroDeEntidad(entidadId?: string | null) {
  return entidadId === undefined ? {} : { entidadId };
}

export async function porProveedor(entidadId?: string | null): Promise<DeudaProveedor[]> {
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      ...filtroDeEntidad(entidadId),
    },
    include: { supplier: true },
  });

  const acumulado = new Map<string, DeudaProveedor>();
  for (const d of docs) {
    const clave = d.supplierId ?? "";
    const fila = acumulado.get(clave) ?? {
      supplierId: d.supplierId,
      nombre: d.supplier?.name ?? "Sin proveedor",
      total: 0n,
      cantidad: 0,
      sinImporte: 0,
    };
    if (d.importeTotal == null) {
      fila.sinImporte += 1;
    } else {
      fila.total += aporteAlSaldo(d.kind, d.importeTotal);
    }
    fila.cantidad += 1;
    acumulado.set(clave, fila);
  }

  // Comparador estable: devolver siempre 1 o -1 hace que dos totales iguales se
  // ordenen distinto entre corridas, y esto es una pantalla de plata.
  return [...acumulado.values()].sort((a, b) =>
    a.total === b.total ? a.nombre.localeCompare(b.nombre) : b.total > a.total ? 1 : -1,
  );
}

/** Qué vence entre dos días, de lo que todavía no se pagó. */
export async function queVence(
  desde: string,
  hasta: string,
  entidadId?: string | null,
): Promise<DocumentoAPagar[]> {
  if (!DIA.test(desde) || !DIA.test(hasta)) throw new Error("Las fechas van en AAAA-MM-DD.");

  // **El filtro por fecha ya no puede vivir en la consulta.** La fecha con la
  // que un comprobante entra en esta lista puede ser calculada —emisión más el
  // plazo pactado con el proveedor— y un cálculo no existe como columna: un
  // `where` sobre `vencimiento` no lo ve.
  //
  // El costo es traer todos los impagos en vez de un rango. Son ciento
  // cuarenta y cinco después de importar nueve meses, no millones, y esta
  // misma consulta ya la hace `porProveedor` por el mismo motivo. Si algún día
  // fueran decenas de miles, la salida es materializar la fecha propuesta en
  // una columna al guardar el plazo — pero eso trae de vuelta el problema de
  // no poder distinguir lo leído de lo calculado, así que se paga recién
  // cuando duela.
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      ...filtroDeEntidad(entidadId),
    },
    include: { supplier: true },
  });

  return docs
    .map(aDocumentoAPagar)
    // **Los débitos automáticos no entran.** Esta lista contesta "qué pago", y
    // a eso no lo paga nadie: sale solo. Mostrarlo sería pedir una decisión que
    // no existe, y una lista con cosas que no se hacen se deja de leer.
    .filter((d) => !d.debitoAutomatico)
    .filter((d) => {
      const f = fechaDePagoEsperada(d);
      return f != null && f >= desde && f <= hasta;
    })
    .sort((a, b) => {
      const fa = fechaDePagoEsperada(a) ?? "";
      const fb = fechaDePagoEsperada(b) ?? "";
      return fa === fb ? a.nombre.localeCompare(b.nombre) : fa < fb ? -1 : 1;
    });
}

/**
 * Lo que hay que pagar y no tiene fecha de vencimiento.
 *
 * Una comparación de rango nunca es verdadera contra NULL, así que estos
 * comprobantes **no aparecían en ninguna pantalla**: ni en lo que vence ni en
 * lo vencido. Con la mayoría de los comprobantes entrando sin `Vto:` legible,
 * eso es la mayor parte de la deuda invisible. Van arriba, no abajo.
 */
export async function sinVencimiento(): Promise<DocumentoAPagar[]> {
  // **Sin fecha de ninguna de las dos clases**: ni la del papel ni la
  // calculada. Antes bastaba con que la columna estuviera vacía, pero desde
  // que el plazo del proveedor propone una fecha eso dejó de ser cierto — y si
  // no se corrigiera, cargar el plazo de un proveedor no vaciaría nunca esta
  // bandeja. Una bandeja que no baja cuando hacés el trabajo se deja de mirar.
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      vencimiento: null,
    },
    include: { supplier: true },
    orderBy: { fechaEmision: "asc" },
  });
  return docs
    .map(aDocumentoAPagar)
    .filter((d) => !d.debitoAutomatico && fechaDePagoEsperada(d) == null);
}

/**
 * Lo que sale solo de la cuenta: seguros, leasing, luz, gas, internet.
 *
 * **Se cuenta aparte, no se esconde.** Sus comprobantes salen de las listas de
 * "qué pagar" porque nadie los paga, pero la plata sale igual — y un total que
 * deja de mostrar plata que se va es exactamente la clase de número que este
 * proyecto no quiere. Va como una línea al lado del resto.
 *
 * Hoy nadie cruza el débito contra la factura: se ve en el extracto y se asume
 * que está bien. Eso lo resolvería la conciliación bancaria, que ya está en el
 * esquema y todavía no la usa nadie.
 */
export async function debitosAutomaticos(
  entidadId?: string | null,
): Promise<{ cantidad: number; total: bigint; sinImporte: number }> {
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      supplier: { debitoAutomatico: true, condicionAcordadaAt: { not: null } },
      ...filtroDeEntidad(entidadId),
    },
    select: { importeTotal: true, kind: true },
  });
  let total = 0n;
  let sinImporte = 0;
  for (const d of docs) {
    if (d.importeTotal == null) sinImporte += 1;
    else total += aporteAlSaldo(d.kind, d.importeTotal);
  }
  return { cantidad: docs.length, total, sinImporte };
}

function aDocumentoAPagar(d: {
  id: string;
  vencimiento: string | null;
  fechaEmision: string | null;
  importeTotal: bigint | null;
  kind: string;
  supplier: {
    name: string;
    diasPago: number | null;
    debitoAutomatico: boolean;
    condicionAcordadaAt: Date | null;
  } | null;
}): DocumentoAPagar {
  // Sólo se propone si la condición se PACTÓ. Un proveedor sin cargar tiene
  // `diasPago` en NULL igual que uno que se paga cuando se puede, y proponer
  // sobre el primero sería inventar un vencimiento que nadie acordó.
  const acordada = d.supplier?.condicionAcordadaAt != null;
  const debito = acordada && d.supplier?.debitoAutomatico === true;
  return {
    id: d.id,
    debitoAutomatico: debito,
    nombre: d.supplier?.name ?? "Sin proveedor",
    importeTotal: d.importeTotal,
    vencimiento: d.vencimiento,
    // Un débito automático no tiene fecha que proponer: no hay nada que
    // decidir, la plata sale sola.
    propuesto:
      d.vencimiento == null && acordada && !debito
        ? proponerVencimiento(d.fechaEmision, d.supplier?.diasPago ?? null)
        : null,
    kind: d.kind,
  };
}

/**
 * Marca comprobantes como pagados. Es como se paga de verdad: una transferencia
 * que cancela varias facturas.
 *
 * **No pisa un pago ya registrado.** Volver a marcar algo pagado sobrescribiría
 * la fecha en que salió la plata — el único dato con el que después se cruza
 * contra el extracto del banco. Los que ya estaban se cuentan aparte y se
 * informan; saltear en silencio es como se paga dos veces sin enterarse.
 */
export async function marcarPagados(
  ids: string[],
  cuando: Date,
  actor: { id: string; name: string },
): Promise<ResultadoPago> {
  const vacio: ResultadoPago = { marcados: 0, yaEstaban: 0, noSePagan: 0, noEncontrados: 0 };
  if (ids.length === 0) return vacio;

  const encontrados = await db.document.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, pagadoAt: true, kind: true },
  });

  const aMarcar = encontrados.filter((d) => d.pagadoAt == null && sePaga(d.kind));
  const resumen: ResultadoPago = {
    marcados: aMarcar.length,
    yaEstaban: encontrados.filter((d) => d.pagadoAt != null).length,
    noSePagan: encontrados.filter((d) => d.pagadoAt == null && !sePaga(d.kind)).length,
    noEncontrados: ids.length - encontrados.length,
  };
  if (aMarcar.length === 0) return resumen;

  // El pago y su registro se guardan juntos o no se guarda ninguno.
  await db.$transaction([
    db.document.updateMany({
      where: { id: { in: aMarcar.map((d) => d.id) } },
      data: { pagadoAt: cuando },
    }),
    db.documentChange.createMany({
      data: aMarcar.map((d) => ({
        documentId: d.id,
        actorId: actor.id,
        actorName: actor.name,
        field: "pagadoAt",
        before: null,
        after: cuando.toISOString(),
      })),
    }),
  ]);

  return resumen;
}

/**
 * Deshace un pago marcado por error.
 *
 * El diseño prometía que se podía revertir y no había ninguna función que lo
 * hiciera. Pide motivo a propósito: un pago que se deshace sin explicación es
 * exactamente el movimiento que después nadie puede justificar.
 */
export async function revertirPago(
  ids: string[],
  motivo: string,
  actor: { id: string; name: string },
): Promise<number> {
  if (ids.length === 0) return 0;
  if (!motivo.trim()) throw new Error("Para deshacer un pago hay que decir por qué.");

  const pagados = await db.document.findMany({
    where: { id: { in: ids }, deletedAt: null, pagadoAt: { not: null } },
    select: { id: true, pagadoAt: true },
  });
  if (pagados.length === 0) return 0;

  await db.$transaction([
    db.document.updateMany({
      where: { id: { in: pagados.map((d) => d.id) } },
      data: { pagadoAt: null },
    }),
    db.documentChange.createMany({
      data: pagados.map((d) => ({
        documentId: d.id,
        actorId: actor.id,
        actorName: actor.name,
        field: "pagadoAt",
        before: d.pagadoAt!.toISOString(),
        after: `(sin pagar) — ${motivo.trim()}`,
      })),
    }),
  ]);

  return pagados.length;
}

/**
 * Carga el vencimiento del pago, que sale del "Vto:" del papel.
 *
 * NUNCA se autocompleta desde `cae` ni `caeVence`: son fechas distintas y ya se
 * confundieron una vez, cargando el vencimiento del CAE (06/09) como si fuera
 * la fecha de pago (11/09). Por eso este campo solo se escribe acá, a mano y
 * mirando la foto.
 */
export async function ponerVencimiento(
  id: string,
  vencimiento: string,
  actor: { id: string; name: string },
): Promise<void> {
  if (!DIA.test(vencimiento) || !esDiaReal(vencimiento)) {
    throw new Error("El vencimiento va en AAAA-MM-DD y tiene que ser un día real.");
  }

  const antes = await db.document.findUniqueOrThrow({
    where: { id },
    select: { vencimiento: true },
  });

  await db.$transaction([
    db.document.update({ where: { id }, data: { vencimiento } }),
    db.documentChange.create({
      data: {
        documentId: id,
        actorId: actor.id,
        actorName: actor.name,
        field: "vencimiento",
        before: antes.vencimiento,
        after: vencimiento,
      },
    }),
  ]);
}

/**
 * Cuánto falta por resolver, contado con consultas sobre NULLs.
 *
 * No hay columna de estado a propósito: un estado miente apenas alguien edita
 * un campo y se olvida de moverlo. Preguntando por los nulos, la bandeja no
 * puede desincronizarse de la realidad porque no hay nada que mantener.
 *
 * Las bandejas excluyen lo que no se paga: un remito no tiene vencimiento y
 * nunca lo va a tener, así que contarlo deja un número que no puede llegar a
 * cero — y una bandeja que no se vacía se deja de mirar en dos semanas.
 */
export async function bandejas(): Promise<{
  sinProveedor: number;
  sinRevisar: number;
  sinVencimiento: number;
  sinImporte: number;
}> {
  const vivos = { deletedAt: null };
  const pagables = { ...vivos, kind: { notIn: [...NO_SE_PAGAN] } };
  const [sinProveedor, sinRevisar, sinVenc, sinImporte] = await Promise.all([
    db.document.count({ where: { ...vivos, supplierId: null } }),
    db.document.count({ where: { ...vivos, conforme: null } }),
    // Ya no es un `count`: la bandeja tiene que bajar cuando se carga el plazo
    // de un proveedor, y eso es una fecha calculada que SQL no ve.
    sinVencimiento().then((d) => d.length),
    db.document.count({ where: { ...pagables, pagadoAt: null, importeTotal: null } }),
  ]);
  return { sinProveedor, sinRevisar, sinVencimiento: sinVenc, sinImporte };
}

// --- Pagar dos veces lo mismo -------------------------------------------------

/** Cuántos días de diferencia todavía hacen sospechar que es el mismo pago. */
const DIAS_DE_SOSPECHA = 10;

export type PosibleDuplicado = {
  supplierId: string | null;
  nombre: string;
  importe: bigint;
  documentIds: string[];
};

/**
 * Comprobantes que parecen ser el mismo pago cargado dos veces.
 *
 * El índice único ya impide cargar dos veces la misma **factura electrónica**.
 * Lo que no impide es **pagar dos veces la misma deuda**: un ticket o un remito
 * cargados a mano dos veces no tienen identidad fiscal que los delate, y ahí se
 * va plata de verdad.
 *
 * La regla es a propósito angosta —mismo proveedor, mismo importe al centavo,
 * menos de diez días entre uno y el siguiente, ninguno pagado— porque **una
 * alarma que suena de más se deja de mirar**. Los que ya tienen número de
 * comprobante propio quedan afuera: son distintos por construcción.
 */
export async function posiblesDuplicados(): Promise<PosibleDuplicado[]> {
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      numero: null, // los que tienen número propio no son ambiguos
      // Un remito no se paga: dos remitos del mismo importe no son un pago
      // doble, son dos entregas. Avisar por eso es la forma más rápida de que
      // la alarma se deje de mirar.
      kind: { notIn: [...NO_SE_PAGAN] },
      importeTotal: { not: null },
      supplierId: { not: null },
      fechaEmision: { not: null },
    },
    include: { supplier: true },
    orderBy: { fechaEmision: "asc" },
  });

  const porClave = new Map<string, typeof docs>();
  for (const d of docs) {
    const clave = `${d.supplierId}|${d.importeTotal}`;
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(d);
    else porClave.set(clave, [d]);
  }

  const avisos: PosibleDuplicado[] = [];
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;

    // Ventana DESLIZANTE, no anclada en el primero. Anclada, tres comprobantes
    // en los días 0, 20 y 25 dejaban al viejo solo y el par 20/25 —que sí es
    // sospechoso— no se avisaba nunca. Se encadena de a uno con el siguiente.
    let corrida = [grupo[0]];
    const cerrar = () => {
      if (corrida.length >= 2) {
        avisos.push({
          supplierId: corrida[0].supplierId,
          nombre: corrida[0].supplier?.name ?? "Sin proveedor",
          importe: corrida[0].importeTotal!,
          documentIds: corrida.map((d) => d.id),
        });
      }
    };
    for (const d of grupo.slice(1)) {
      const anterior = corrida[corrida.length - 1];
      if (Math.abs(diasEntre(anterior.fechaEmision!, d.fechaEmision!)) <= DIAS_DE_SOSPECHA) {
        corrida.push(d);
      } else {
        cerrar();
        corrida = [d];
      }
    }
    cerrar();
  }
  return avisos;
}

function esDiaReal(dia: string): boolean {
  const [a, m, d] = dia.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export type Incompleto = DocumentoAPagar & {
  /** Qué le falta, en palabras, para que la fila diga por qué está en la lista. */
  falta: string[];
};

/**
 * Los comprobantes a los que les falta algo para poder pagarse.
 *
 * Las bandejas mostraban un número y nada más: "3 sin proveedor", sin forma de
 * abrir esos tres. Un contador que no se puede tocar es peor que no tener el
 * contador, porque dice que hay trabajo pendiente y no deja hacerlo.
 *
 * Devuelve las filas, con el motivo escrito, para que cada una lleve a la
 * pantalla donde se completa.
 */
export async function incompletos(): Promise<Incompleto[]> {
  const docs = await db.document.findMany({
    where: {
      deletedAt: null,
      pagadoAt: null,
      kind: { notIn: [...NO_SE_PAGAN] },
      OR: [{ supplierId: null }, { importeTotal: null }, { vencimiento: null }],
    },
    include: { supplier: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return docs
    .map((d) => {
      const base = aDocumentoAPagar(d);
      const falta: string[] = [];
      if (!d.supplierId) falta.push("proveedor");
      if (d.importeTotal == null) falta.push("importe");
      // **No le falta el vencimiento si el plazo del proveedor ya lo propone.**
      // Sin esta línea, cargar la condición de un proveedor no sacaría sus
      // facturas de la lista de incompletos, y la pantalla seguiría pidiendo un
      // dato que ya tiene.
      if (!base.debitoAutomatico && fechaDePagoEsperada(base) == null) falta.push("vencimiento");
      return { ...base, falta };
    })
    // El `OR` de la consulta es un prefiltro: trae los que tienen la columna
    // vacía, y a algunos de ésos el plazo del proveedor ya les da fecha. Ésos
    // ya no están incompletos.
    .filter((d) => d.falta.length > 0);
}
