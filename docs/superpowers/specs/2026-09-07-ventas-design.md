# Ventas — el lado comercial del evento

**Objetivo:** que exista, por primera vez, el registro de a cuánto se vendió cada fiesta y cuánto se cobró de ella.

**Arquitectura:** modelos nuevos en la base financiera (la que hoy se llama "comprobantes"), donde ya viven los costos. El evento se referencia por id con el nombre al lado, porque vive en la otra base y entre bases no hay claves foráneas.

**Stack:** Next.js 16 · Prisma 7 · SQLite · el mismo de siempre.

---

## Por qué esta pieza va primero

La app sabe **qué salió de la cocina** y no sabe **cuánto entró**. Un evento existe hoy como una orden de comida: qué platos, qué sectores, los carteles. No tiene cliente, no tiene precio, no tiene seña.

El precio pactado de cada fiesta **no está escrito en ningún lado**: vive en la memoria de quien la vendió o en un chat de WhatsApp. Los cobros entran a `CAJA.xlsx` como movimientos sueltos, sin atarse a un evento.

De ahí salen dos consecuencias que este módulo viene a cortar:

1. **El margen por evento nunca se pudo medir.** No falta el costo — falta también la venta. Es una resta sin minuendo.
2. La cifra de auditoría de **$913,3 millones cobrados y no prestados es una estimación**, y no puede ser otra cosa mientras el precio de cada fiesta no exista como dato.

Esta pieza no arregla el pasado. Crea el dato que faltaba, de acá en adelante.

## Alcance temporal: desde el día que se prenda

**Decisión del usuario (07/09/2026): no se carga nada histórico.**

El indicador de "cobrado y no prestado" mide **solo las ventas cargadas en el sistema**, y la pantalla lo dice explícitamente con la fecha desde la que mide. Un número parcial que se presenta como parcial es información; el mismo número presentado como total es una mentira que se descubre tarde.

Los $913,3 millones siguen siendo una estimación. No se reemplazan.

---

## Restricciones globales

Valen las reglas del proyecto, sin excepción salvo la que se justifica abajo:

- **Importes en `BigInt` centavos, siempre positivos.** El signo lo decide el tipo de operación.
- **Un precio unitario es una tasa, no un importe → MILÉSIMAS de peso.** Precedente en el código: `DocumentLine.precioUnitario`, que existe porque una factura real imprime `$31.574,674`.
- **No hay columna de estado.** Lo que falta es `NULL`, y `null ≠ false`.
- **Ningún número que se pueda calcular se escribe a mano.**
- **No hay claves foráneas entre bases.** El id viaja con el nombre al lado.
- **Historial campo por campo** con un modelo `*Change`, como `DocumentChange` y `ProductChange`.
- `JSON.stringify` revienta con `BigInt`: usar `aTextoPlano` en la frontera servidor/cliente.

### La única excepción, y por qué no es una excepción

`cubiertosCobrables` **se escribe a mano**. Parece violar la regla del número calculable y no la viola: cuando se pacta un mínimo y confirman menos, **lo que se cobra se negocia caso por caso**. No hay fórmula que lo produzca — es el resultado de una conversación.

La regla existe para que nadie tipee un total que la máquina puede sacar sola. Acá la máquina no puede. Los otros dos números quedan al lado como referencia y **no se copian solos**.

Esto es lo que evita el error más caro que se detectó en la revisión: con la regla `confirmados ?? pactados`, una fiesta que pactó 150 y confirma 120 **habría descontado 30 cubiertos sola y en silencio**, y el total resultante se ve perfectamente razonable.

---

## Modelo de datos

Todo en la base financiera (`prisma/comprobantes/schema.prisma`).

```prisma
/// El cliente que contrata la fiesta. Misma forma que Supplier: el CUIT es la
/// identidad cuando existe, y el nombre varía en el papel.
model Cliente {
  id        String    @id @default(cuid())
  nombre    String
  cuit      String?   @unique   // NULL = particular sin CUIT
  telefono  String?
  email     String?
  notas     String?
  activo    Boolean   @default(true)
  createdAt DateTime  @default(now())
  deletedAt DateTime?
  ventas    Venta[]
}

/// El lado comercial de UN evento.
model Venta {
  id String @id @default(cuid())

  // El evento vive en la base de stock. El id viaja con el nombre al lado, que
  // es el patrón que esta base ya usa para los usuarios: si el evento se borra,
  // la venta sobrevive con sentido.
  eventId     String? @unique
  eventNombre String

  clienteId String
  cliente   Cliente @relation(fields: [clienteId], references: [id])

  fechaEvento String  // "AAAA-MM-DD". Manda ésta para el indicador.

  /// MILÉSIMAS de peso. Es una tasa, no un importe.
  precioCubierto BigInt

  /// Lo que se pactó al cerrar. Es el piso de la conversación, no el cobro.
  cubiertosPactados Int
  /// Lo que confirmó el cliente. NULL = todavía no confirmó.
  cubiertosConfirmados Int?
  /// Lo que efectivamente se cobra. NULL = la negociación no se cerró, y el
  /// total se muestra PROVISORIO. Nunca se completa solo.
  cubiertosCobrables Int?

  /// Cuándo se prestó el servicio. NULL = falta la constancia, que NO es lo
  /// mismo que "no se prestó". Los casos sin constancia se muestran aparte.
  realizadoEl DateTime?

  /// La fiesta se cayó. Es un HECHO con fecha y motivo, no un `deletedAt`:
  /// puede quedar plata por devolver o una seña retenida.
  canceladaEl     DateTime?
  canceladaMotivo String?

  notas     String?
  createdAt DateTime  @default(now())
  deletedAt DateTime?   // borrado por error de carga, no cancelación

  extras  VentaExtra[]
  cobros  Cobro[]
  changes VentaChange[]

  @@index([fechaEvento])
  @@index([clienteId])
  @@index([deletedAt])
}

/// Los agregados que NO entran en el precio por cubierto.
///
/// El precio por cubierto de esta empresa ya incluye mozos, barra y torta. Los
/// agregados son otra cosa — los kioscos, por ejemplo. Por eso alcanza con un
/// importe cerrado: si mañana se cotizan por invitado, se agregan `cantidad` y
/// `precioUnitario` como columnas opcionales y no se pierde nada, porque no hay
/// datos históricos que queden sin ese detalle.
model VentaExtra {
  id          String @id @default(cuid())
  ventaId     String
  venta       Venta  @relation(fields: [ventaId], references: [id], onDelete: Cascade)
  orden       Int
  descripcion String
  importe     BigInt // CENTAVOS

  @@index([ventaId, orden])
}

/// Plata que entra por una venta.
///
/// **Dos momentos, por los cheques.** Se toman cheques y cuentan cuando se
/// acreditan, no cuando se reciben. Para efectivo y transferencia los dos
/// momentos son el mismo y se llenan juntos.
///
/// Sin columna de estado: el NULL dice lo que falta.
model Cobro {
  id      String @id @default(cuid())
  ventaId String
  venta   Venta  @relation(fields: [ventaId], references: [id], onDelete: Cascade)

  recibidoEl   String  // "AAAA-MM-DD"
  /// Cuándo entró la plata de verdad. NULL = todavía no entró.
  acreditadoEl String?
  /// El cheque rebotó. Excluye el cobro del total sin borrarlo.
  rechazadoEl  String?

  importe BigInt // CENTAVOS, positivo
  medio   String // EFECTIVO | TRANSFERENCIA | CHEQUE | OTRO
  referencia String?

  /// La contrapartida en la planilla de caja, cuando se concilió a mano.
  /// Es lo que impide contar el mismo peso dos veces. Ver "La frontera con el
  /// Excel" más abajo.
  refCaja String?

  registradoPorId     String?
  registradoPorNombre String
  createdAt           DateTime @default(now())

  ajustes AjusteDeCobro[]

  @@index([ventaId])
  @@index([acreditadoEl])
}

/// Lo que pasa cuando un cobro sale mal.
///
/// **Anular y devolver son cosas distintas y no se pueden confundir:**
///   ANULACION  = se cargó mal. La plata nunca existió como la dice el registro.
///   DEVOLUCION = la plata existió y se le devolvió al cliente.
///
/// Las dos van con importe POSITIVO; el efecto lo decide el tipo, igual que en
/// el resto del sistema. Un cobro equivocado no se borra: se anula, y queda el
/// rastro de que alguien se equivocó y cuándo.
model AjusteDeCobro {
  id      String @id @default(cuid())
  cobroId String
  cobro   Cobro  @relation(fields: [cobroId], references: [id], onDelete: Cascade)

  tipo    String // ANULACION | DEVOLUCION
  fecha   String // "AAAA-MM-DD"
  importe BigInt // CENTAVOS, positivo
  motivo  String

  actorId     String?
  actorNombre String
  createdAt   DateTime @default(now())

  @@index([cobroId])
}

/// Historial campo por campo, incluyendo los hijos.
///
/// `entidad` y `entidadId` existen porque agregar, cambiar o sacar un extra o un
/// cobro también es un cambio de la venta, y sin eso el historial no dice cuál
/// de los tres extras se modificó.
model VentaChange {
  id      String @id @default(cuid())
  ventaId String
  venta   Venta  @relation(fields: [ventaId], references: [id], onDelete: Cascade)

  entidad   String  // VENTA | EXTRA | COBRO | AJUSTE
  entidadId String?
  field     String
  before    String?
  after     String?

  actorId     String?
  actorNombre String
  createdAt   DateTime @default(now())

  @@index([ventaId, createdAt])
}
```

---

## Los cálculos

Ninguno se guarda. Todos viven en `lib/ventas/plata.ts`, con pruebas propias.

### El total

```
cubiertos       = cubiertosCobrables ?? cubiertosConfirmados ?? cubiertosPactados
totalCubiertos  = redondear(precioCubierto × cubiertos / 10)
total           = totalCubiertos + Σ VentaExtra.importe
esProvisorio    = cubiertosCobrables == NULL
```

**Ojo con esa cascada, que se parece peligrosamente al error que se está evitando.**
La diferencia es que acá NO decide lo que se cobra: mientras `cubiertosCobrables` esté
en NULL, `esProvisorio` es verdadero y **la pantalla marca el total como no cerrado**.
Es una estimación para poder mirar la lista, no un compromiso. El número que se factura
sale únicamente de `cubiertosCobrables`, que **nadie completa solo**.

Ninguna pantalla que sume plata en serio —el indicador, lo que se debe— puede usar un
total provisorio sin decirlo.

**El `/10` es el número correcto y hay que entender por qué**, porque el error natural es `/1000` y da un resultado 100 veces más chico que se ve plausible.

`precioCubierto` está en milésimas de peso. `cubiertos` es un conteo pelado, no una magnitud en milésimas. Entonces `precioCubierto × cubiertos` queda en **milésimas de peso**, y de milésimas de peso a centavos se divide por 10.

Es distinto del caso de `renglones.ts`, que divide por 10.000 — ahí se multiplican **dos** magnitudes en milésimas (cantidad × precio unitario). Copiar aquel denominador acá es el error.

**El redondeo va al final, después de multiplicar.** No es cosmético:

| | |
|---|---|
| `$31.574,674 × 3`, redondeando al final | **$94.724,02** |
| redondeando cada cubierto primero | **$94.724,01** |

Un centavo por fiesta, siempre para el mismo lado. Redondeo al centavo más cercano, empates hacia arriba. La división entera de `BigInt` trunca: hay que implementar la política, no confiar en el operador.

### Lo cobrado

```
contados = Cobro donde acreditadoEl != NULL  y  rechazadoEl == NULL
cobrado  = Σ contados.importe  −  Σ AjusteDeCobro.importe de los cobros CONTADOS
```

Se cuenta **lo acreditado**, no lo recibido. Un cheque en el cajón no es plata.

Los ajustes se restan **solo de los cobros que se estaban contando**. Anular un cobro que
nunca se acreditó no resta nada: ya valía cero. Restarlo igual dejaría el cobrado en
negativo por un error de carga, que es exactamente la clase de número que hace desconfiar
de todo el tablero.

```
saldo = total − cobrado
```

**El saldo puede ser negativo y eso no es un error**: si la fiesta baja de cubiertos después de una seña grande, hay saldo a favor del cliente. No se lleva a cero ni se rechaza. En pantalla se muestran deuda y crédito como dos magnitudes positivas separadas, porque "saldo −$200.000" se lee mal a las siete de la mañana.

### Un cobro nunca se recalcula

Es un hecho externo: entró esa plata ese día. Aunque su importe se haya calculado en su momento como "el 30% del total", si después el total cambia **el cobro no se toca**. Lo que cambia es el saldo.

---

## La frontera con el Excel

Mientras exista `CAJA.xlsx` —hasta la pieza D— el mismo peso está representado en dos lugares. La regla se escribe ahora aunque la automatización venga después:

> **El Excel se queda con los movimientos de caja y banco. La app se queda con el acuerdo comercial y su imputación al evento. Las dos representaciones del mismo dinero NUNCA se suman en un consolidado.**

`Cobro.refCaja` guarda la contrapartida cuando alguien concilia a mano. Dos cosas que **no** sirven como identificador y conviene tener claras:

- **El número de fila del Excel**, que cambia al ordenar o insertar.
- **La referencia bancaria**, que no existe para el efectivo y se repite.

Conciliar solo totales diarios tampoco alcanza: un cobro omitido y otro duplicado se compensan y el día cierra.

---

## Pantallas

**`/ventas`** — la lista. Por cada fila: evento, cliente, fecha, total, cobrado, saldo. Filtros por lo que se debe y por lo que viene. Las ventas con el total provisorio (sin `cubiertosCobrables`) se marcan, porque su total todavía no es un compromiso.

**`/ventas/[id]`** — el detalle editable: cliente, precio por cubierto, los tres números de cubiertos, agregados, cobros con sus ajustes, y el historial.

**`/ventas/nueva`** — alta, pudiendo enganchar un evento existente o quedar suelta.

**El indicador de cobrado y no prestado**, con tres números y no uno:

| | |
|---|---|
| Cobrado de fiestas **sin realizar** | el número principal |
| De fiestas ya pasadas y **sin constancia** de prestación | lo que hay que ir a revisar |
| De fiestas **canceladas** con plata sin resolver | lo que hay que devolver o retener |

Con la leyenda de desde qué fecha mide. Un evento pasado sin `realizadoEl` no se cuenta como prestado ni como pendiente: se muestra como lo que es, un caso sin verificar.

---

## Lo que esta pieza NO hace

- **No emite factura al cliente.** Eso es AFIP y es otro problema.
- **No se sincroniza con `CAJA.xlsx`.** Eso es la pieza D.
- **No costea ni calcula margen.** Eso es la pieza B, que se apoya en ésta.
- **No carga nada histórico.** Decisión explícita del usuario.
- **No maneja contratos, firmas ni presupuestos versionados.**
- **No maneja un mismo pago repartido entre dos fiestas**, porque acá cada pago es de una fiesta. Si algún día deja de ser cierto, hace falta separar "recibir plata" de "imputarla".
- **No tiene cuotas ni vencimientos de seña.** Es la carencia consciente más grande y está abajo.

## Lo que queda sabiendo que falta

**"¿Cuánto debería haber cobrado ya, a quién le reclamo y desde cuándo?"**

El saldo no contesta eso: mezcla deuda vencida con pagos que todavía no vencen. Contestarlo pide al menos una condición de vencimiento por venta, y probablemente un plan de cuotas si en la práctica se usan.

Se deja afuera a propósito para que esta pieza entre completa y ande, y es la primera candidata a **pieza A.2**. Lo anoto acá y no en un TODO en el código.

## Riesgos

1. **Los cobros van a existir en dos lugares** hasta que exista la pieza D. Mitigado con `refCaja` y con la regla de no sumar nunca las dos representaciones, no resuelto.
2. **`fechaEvento` existe en dos bases** — acá y en `Event`. Manda la de acá para todo lo comercial. Una reprogramación que se cargue solo en la base de stock deja el indicador desactualizado; hay que decidir el sentido de la sincronización cuando se enganche el evento.
3. **La adopción es todo.** Si las ventas no se cargan, el módulo no dice nada. No es un riesgo técnico y es el que más probablemente lo mate.

---

## Qué cambió por la revisión de Codex

Se sometió el diseño a `gpt-6-astra` como revisor adversarial antes de escribir una línea de código. Encontró tres cosas que ya estaban mal:

1. **El factor 100** en la conversión de cubiertos. Verificado después contra `renglones.ts`: era real. Todos los totales habrían salido 100 veces más chicos.
2. **No había forma de representar que algo salió mal** — ni devolución, ni anulación, ni cancelación como hecho, ni constancia de prestación. De ahí salieron `AjusteDeCobro`, `canceladaEl` y `realizadoEl`.
3. **El indicador prometía más de lo que medía**, y encima se contradecía con el propio alcance del documento.

Y el mejor hallazgo no fue técnico: **"invitados confirmados no es lo mismo que cubiertos cobrables"**. De ahí salió `cubiertosCobrables` como campo negociado.

Se le discutieron y descartaron dos propuestas: la entidad de imputación de cobros (acá cada pago es de una fiesta) y los extras con cantidad × tarifa (el precio por cubierto ya incluye todo; los agregados van con importe cerrado).
