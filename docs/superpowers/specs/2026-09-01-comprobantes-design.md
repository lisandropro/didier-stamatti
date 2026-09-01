# Digitalizar los comprobantes para que Aldana pueda pagar sin entrar a ARCA

1 de septiembre de 2026

## El problema

Las facturas de los proveedores llegan en papel junto con la mercadería. Las
reciben tres personas en el depósito. Aldana, que trabaja en otra oficina, es
quien las paga.

Para que ella pueda verlas, alguien **tipea cada comprobante a mano** en una
planilla de Google Drive. Para las facturas electrónicas ese trabajo es
directamente redundante —el dato ya está en ARCA, exacto— y existe solo porque
**Aldana no puede entrar a ARCA** y no hay otra forma de mostrarle una parte sin
mostrarle el todo.

Pero **buena parte de lo que entra no es factura electrónica**: son remitos,
tickets y proveedores que facturan en papel. Eso no está en ARCA ni va a estarlo,
y hoy tampoco tiene dónde vivir salvo la misma planilla.

Son dos problemas distintos con la misma cara: uno es un rodeo de permisos, el
otro es que no hay sistema. La planilla los tapa a los dos y el tipeo es el
peaje de ambos.

Ese tipeo ya produjo errores documentados en la propia planilla: fechas como
`21/08/0202`, números de factura con un dígito de menos, comprobantes sin monto,
y un vencimiento pisado con la fecha equivocada (ver más abajo, que es una
trampa de diseño, no un descuido).

## Por qué no alcanza con compartirle el CSV de ARCA

Es la primera objeción que aparece, y hay que contestarla antes de justificar
una sola tabla: ARCA exporta *Mis Comprobantes → Recibidos* a CSV. ¿Por qué no
mandarle ese archivo a Aldana todas las semanas y terminar?

Por dos razones, y cualquiera de las dos alcanza.

**Primera: ARCA no tiene la mayoría de los comprobantes.** Los remitos, los
tickets y los proveedores que no facturan electrónicamente no aparecen ahí. Un
CSV compartido deja fuera justo la parte que más papeles genera.

**Segunda: la planilla de Aldana no es un registro de comprobantes, es una cola
de pagos.** ARCA sabe qué facturas te emitieron. No sabe las dos cosas que ella
administra:

- **cuándo vence cada una**, y
- **cuál ya se pagó**.

Un CSV publicado le daría identidad y la dejaría con dos fuentes en vez de una:
el archivo de ARCA para los datos y su planilla para el estado. Eso es peor que
hoy.

Lo que hay que construir es **el lugar donde viven las dos cosas**: el estado de
pago, y los comprobantes que ARCA nunca va a conocer.

## El orden, y por qué cambió dos veces

Vale dejar el recorrido escrito, porque explica por qué el diseño quedó como
quedó.

La primera versión ponía la captura por foto primero. Una revisión del Council
lo marcó al revés por unanimidad, con un argumento fuerte: importar el CSV de
ARCA es un parser, una tabla y una vista — no necesita cámara, ni PWA, ni
entrenar a nadie— y elimina el tipeo de todas las facturas electrónicas.

**Ese argumento se apoyaba en una premisa que resultó falsa.** Al preguntarlo,
la respuesta fue que **buena parte de lo que entra son remitos, tickets y
proveedores que no facturan electrónicamente**. Nada de eso está en ARCA. Con la
premisa caída, el argumento cae, y el orden vuelve al original.

### Cantidad y plata no dan lo mismo

Es la distinción que ordena el resto, y probablemente den resultados opuestos:

- **Por cantidad de comprobantes**, ARCA cubre poco.
- **Por plata**, ARCA cubre probablemente mucho: los proveedores grandes —CCU,
  Don Angel— facturan electrónicamente. Los tickets y los informales son muchos
  y chicos.

Importa porque **el tipeo se mide por documento y el riesgo de pago se mide por
peso**. Puede que ARCA resuelva el 30% de los papeles y el 80% del dinero. Las
dos mitades sirven, para cosas distintas: **ARCA para que los números grandes
sean exactos, la foto para que no se pierda nada**.

### Las etapas

| Etapa | Qué entra | Qué resuelve |
|---|---|---|
| **1** | Captura por foto · extracción (códigos, y lectura automática donde no hay) · destino · conforme · vista de Aldana con vencimiento, total por proveedor y marcar pagado | Cubre el **100%** de los comprobantes desde el día uno, sean electrónicos o no. Muere la planilla |
| **2** | Importación del CSV de ARCA y emparejamiento | **Mejora** los electrónicos a dato exacto y delata los que nadie trajo |
| **3** | Detalle de ítems | Control de precios de insumos y la mitad que falta del costeo por evento |

La etapa 1 está armada para **no depender de cómo dé la mezcla**: si mañana
resulta que ARCA cubría más de lo pensado, la etapa 2 solo mejora datos que ya
estaban entrando. La etapa 2 no es el cimiento: es una fuente exacta que corrige
y controla.

## Dónde vive: una aplicación, dos bases de datos

**Una sola aplicación.** El módulo entra dentro de `didier-catering`, con el
mismo despliegue, el mismo login y la misma PWA. La razón es de adopción y le
gana a todas las demás: quienes tienen que sacar la foto ya tienen esta app
instalada en el celular y ya están logueados. Agregar un botón a algo que usan
todos los días le gana a pedirles que instalen una segunda app.

**Dos bases de datos SQLite separadas**, con migraciones y respaldos propios:

| | App de stock | Comprobantes |
|---|---|---|
| Esquema | `prisma/schema.prisma` | `prisma/comprobantes/schema.prisma` |
| Cliente | `lib/db.ts` | `lib/db-comprobantes.ts` |
| Variable | `DATABASE_URL` | `COMPROBANTES_DATABASE_URL` |
| Respaldo | 14 días | años, e inmutable |

Tres razones:

- **`lib/backup.ts` retiene 14 días.** Para inventario está bien. Un comprobante
  fiscal hay que conservarlo años, y meterlo en una base cuyo respaldo se pisa
  cada dos semanas sería un error grave.
- **El radio de daño.** La app de stock tiene `PeriodVersion` y `PeriodSnapshot`
  porque restaura estados anteriores. Restaurar un período de pedidos jamás
  debería poder tocar una factura.
- **Los ciclos de vida no se parecen.** El inventario se puede resetear y
  remigrar. Un comprobante fiscal no se toca nunca más.

**El corte está bien puesto porque nada necesita escribir en las dos a la vez.**
El módulo *lee* usuarios de la app de stock y nunca les escribe. Toda escritura
de una captura va a un solo archivo, así que no hace falta ninguna transacción
que cruce bases —que es lo único que volvería peligrosa esta separación.

Lo que se pierde es la integridad referencial hacia `User`. Se cubre igual que
ya lo cubre `Suggestion`: el nombre viaja al lado del id (`capturedByName`), y
un chequeo en `lib/checks.ts` reporta los ids huérfanos.

## El modelo de datos

Cuatro tablas nuevas. De lo existente solo se toca `lib/permissions.ts`, para
agregar dos roles: es un archivo, sin migración y sin cambio de esquema.

```prisma
// Un proveedor. El CUIT es la identidad real; el nombre en el papel varía
// ("DON ANGEL", "Don Angel SRL", "DONANGEL") y no sirve para identificar.
model Supplier {
  id        String     @id @default(cuid())
  name      String
  // Único cuando existe. NULL = proveedor informal sin CUIT (verdulería,
  // ferretería de barrio). SQLite admite varios NULL en un índice único.
  cuit      String?    @unique
  alias     String?    // cómo lo llama el equipo
  active    Boolean    @default(true)
  createdAt DateTime   @default(now())
  deletedAt DateTime?
  documents Document[]
}

// Un comprobante: factura, remito, ticket o nota. Es la tabla central.
model Document {
  id     String @id @default(cuid())
  kind   String // FACTURA | REMITO | TICKET | NOTA_CREDITO | NOTA_DEBITO | OTRO
  // Cómo se resolvió la cabecera la primera vez, no de dónde salió la foto.
  // Un valor por peldaño de la cascada:
  //   ARCA | QR | BARCODE | EMPAREJADO (alguien tocó la fila de ARCA)
  //   | LECTURA (la sacó el lector automático y una persona la confirmó)
  //   | MANUAL
  // Sirve además como medición: en producción dice qué peldaño está
  // funcionando de verdad, que es hoy el número más incierto del proyecto.
  source String

  // --- Identidad fiscal: se copia de ARCA o del QR. NUNCA se tipea. ---
  // Los cuatro primeros juntos son la identidad única de una factura
  // electrónica argentina.
  cuitEmisor   String?
  tipoCbte     String? // A | B | C | M | ...
  puntoVenta   Int?
  numero       Int?
  fechaEmision String? // "AAAA-MM-DD": es un día, no un instante
  importeTotal BigInt? // CENTAVOS, siempre positivo
  cae          String?
  // Se guarda pero NO se le muestra a Aldana. Ver "Las dos fechas".
  caeVence     String?

  // --- Vínculos: se resuelven y se pueden corregir sin tocar el dato crudo ---
  supplierId String?
  supplier   Supplier? @relation(fields: [supplierId], references: [id])

  // A dónde entró la mercadería. La factura NO pertenece a una fiesta: la
  // mercadería entra a un sector y desde ahí se consume.
  destino     String? // COCINA | DEPOSITO | OTRO
  destinoNota String? // solo para OTRO

  // --- Recepción ---
  // NULL = nadie revisó. No es lo mismo que "revisado y estaba bien".
  conforme      Boolean?
  faltantesNota String?

  // --- Pago ---
  // Sale del "Vto:" del papel. NUNCA se autocompleta desde el CAE.
  vencimiento String?
  pagadoAt    DateTime?

  // --- Conciliación con ARCA ---
  // NULL = todavía no se cruzó. true/false = ya se cruzó.
  enArca Boolean?

  // --- Captura ---
  // Los tres van en NULL cuando el comprobante entró por el CSV de ARCA: no lo
  // capturó nadie. Que `capturedByName` esté vacío es información, no un hueco.
  capturedById   String?  // id en la OTRA base: no hay clave foránea
  capturedByName String?  // sobrevive al borrado del usuario
  // Una por captura: mata el doble toque. NULL para lo que viene de ARCA;
  // SQLite admite varios NULL en un índice único.
  clientKey      String?  @unique
  createdAt      DateTime @default(now())
  deletedAt      DateTime?

  // Cuando una foto suelta se empareja con una fila de ARCA, las fotos se mudan
  // a la fila de ARCA y esta queda borrada apuntando a la que quedó viva. No se
  // destruye: es la única forma de auditar un emparejamiento equivocado.
  mergedIntoId String?

  attachments Attachment[]
  changes     DocumentChange[]

  @@unique([cuitEmisor, tipoCbte, puntoVenta, numero])
  @@index([supplierId, pagadoAt])
  @@index([vencimiento, pagadoAt])
}

// Una foto, o varias: la factura de tres hojas. Vive en S3, no en la base.
model Attachment {
  id           String   @id @default(cuid())
  documentId   String
  document     Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  s3Key        String   @unique
  mimeType     String
  sizeBytes    Int
  page         Int      @default(1)
  uploadedById String?
  createdAt    DateTime @default(now())

  @@index([documentId, page])
}

// Historial. Mismo patrón que ProductChange, por las mismas razones.
model DocumentChange {
  id         String   @id @default(cuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  actorId    String?
  actorName  String
  field      String
  before     String?
  after      String?
  createdAt  DateTime @default(now())

  @@index([documentId, createdAt])
}
```

### No hay columna de estado

Es la decisión que más costó tomar. Un `estado: PENDIENTE | COMPLETO` miente
apenas alguien edita un campo y se olvida de moverlo.

Acá **lo que falta se pregunta**: `supplierId IS NULL` es "sin proveedor",
`conforme IS NULL` es "nadie lo revisó", `vencimiento IS NULL` es "falta la
fecha de pago". Las bandejas de trabajo son consultas sobre nulos y por
construcción no pueden desincronizarse de la realidad.

Es la misma disciplina que ya aplica `Product.stock`, donde `NULL` significa
"nunca lo contamos" y es distinto de cero.

### El índice único de los cuatro campos fiscales

`@@unique([cuitEmisor, tipoCbte, puntoVenta, numero])` es la pieza que sostiene
todo el cruce. Esos cuatro campos son la identidad de una factura electrónica
argentina, así que:

- La misma factura importada de ARCA **y** fotografiada es una sola fila.
- La misma factura fotografiada por dos personas es una sola fila.
- Subir dos veces el mismo CSV no duplica nada.

Lo garantiza la base, no un chequeo que alguien puede olvidar. Es el problema de
duplicados de la planilla de Drive resuelto de raíz.

Para remitos y tickets los cuatro campos van en `NULL` y no deduplican, que es
lo correcto: no tienen identidad única.

### El dato crudo y el vínculo conviven

`cuitEmisor` es el hecho que dice el papel y no se toca nunca. `supplierId` es
la interpretación y se puede corregir. Si mañana se descubre que dos proveedores
estaban mezclados, se arregla el vínculo sin falsificar lo que decía la factura.
Mismo criterio que `authorId` + `authorName` en `Suggestion`.

### Los importes van en centavos, como BigInt

Nunca en decimal: el punto flotante no suma plata. Y en centavos como `Int`
común tampoco, porque el techo de un entero de 32 bits son **$21.474.836,47** y
una factura grande o una nota de crédito lo revientan en silencio.

`BigInt` no se serializa a JSON. **Hay que poner un serializador único desde el
primer día**, no resolverlo "en el borde": sin eso muerde en cada acción de
servidor, cada respuesta y cada test.

### Las fechas de día van como texto "AAAA-MM-DD"

Igual que `OperationalPeriod`, y por la misma razón: la fecha de emisión de una
factura es un día del calendario, no un instante. Guardarla como `DateTime` la
deja a merced de la zona horaria del proceso, que es como una factura del 1° de
septiembre termina archivada en agosto.

## Las dos fechas que parecen vencimiento

La factura trae **dos fechas** que se parecen, y confundirlas ya pasó:

> `Bitácora.md:415` — *Vencimientos de Don Angel pisados: se cargaron
> `11/09/2026` (el `Vto:` de la factura, condición cuenta corriente) y alguien
> los cambió después a `06/09/2026`, que es la fecha de vencimiento del CAE del
> pie de la factura — no la fecha de pago.*

De ahí salen dos reglas duras:

1. **`vencimiento` nunca se autocompleta desde nada relacionado con el CAE.**
   El QR no trae la condición de pago: trae CUIT, punto de venta, número, fecha
   de emisión, importe y CAE. El `Vto:` sale del papel y solo del papel.
2. **`caeVence` se guarda pero no se le muestra a Aldana.** No le sirve para
   pagar y es la fuente exacta del error. Un campo que solo puede confundir no
   va en la pantalla de quien decide.

Quien carga el `Vto:` es **Aldana**, mirando la imagen que ya tiene abierta para
pagar. El tipeo no baja a cero: baja de una factura entera a una fecha.

## Cómo paga Aldana

El pago se hace de las dos formas: a veces una factura, a veces varias del mismo
proveedor en una transferencia. **No hace falta conciliar pagos contra
facturas.** Alcanza con dos cosas:

- **Total por proveedor, sumado por el sistema.** Ve "Don Angel: $841.843,26 en
  2 facturas" y transfiere.
- **Marcar varias como pagadas de una vez**, con selección múltiple.

Sin tabla de pagos, sin conciliación, sin pagos parciales. Si algún día hacen
falta, entran después sin tocar nada de esto.

## Cómo entra un comprobante

### Captura por foto (etapa 1)

```
[Botón "Recibí mercadería"]
        │
        ▼
   Cámara apuntando → QR y código de barras se leen EN VIVO, vibra al enganchar
        │
        ▼
   Foto → se sube y se guarda   ◀── esto NUNCA falla
        │
        ▼
   Dos toques OPCIONALES, salteables:
   · ¿A dónde?  [COCINA] [DEPÓSITO]   (OTRO como enlace chico)
   · ¿Está todo? [Sí] [Faltan cosas]
        │
        ▼
   Listo · Aldana ya lo ve
```

**La foto se guarda pase lo que pase.** Los códigos pueden fallar, la red puede
cortarse, el proveedor puede no existir todavía. Nada de eso puede impedir que
la foto quede: un comprobante fotografiado y sin identificar ya es mejor que el
papel sobre un escritorio.

Cuatro detalles que deciden si esto funciona:

- **Los códigos se leen en vivo mientras se apunta**, con la linterna encendida
  y vibración al enganchar, y recién ahí se dispara la foto. Leerlos de una
  imagen ya tomada —papel arrugado, con grasa, con el brillo del depósito— tiene
  una tasa de acierto bastante peor. **Si a los tres segundos no engancha, se
  saca la foto igual y se sigue.** No hay que pelearse con un papel arrugado.
- **Se leen en el teléfono**, con la API de códigos de barras del navegador. Es
  instantáneo, gratis y funciona sin señal. Donde esa API no exista, una
  librería en WASM.
- **La foto se comprime a 2000 px de lado mayor** después de leer los códigos,
  nunca antes. Son unos 5 GB al año en el bucket de Railway.
- **La `clientKey` se genera al abrir la cámara** y viaja con la subida, así el
  doble toque no crea dos comprobantes. Mismo patrón que `Suggestion`.

Si dos personas fotografían la misma factura, el índice único lo detecta y **la
segunda foto se agrega como página del comprobante que ya existe**, avisando.
No es un error: en un depósito va a pasar seguido, y tratarlo como error es la
forma más rápida de que dejen de usar la app.

### Importación de ARCA (etapa 2)

Administración baja el CSV de *Mis Comprobantes → Recibidos* y lo sube. Cada
fila se cruza contra los cuatro campos fiscales y produce tres listas:

| Situación | Qué pasa | Qué significa |
|---|---|---|
| La fila cruza con un comprobante que ya existe | Se completa, `enArca = true` | Todo en orden |
| La fila no cruza con nada | Se crea el comprobante sin foto | Existe y nadie trajo el papel |
| Hay papel y ARCA no lo conoce | `enArca = false` | Remito o ticket… o hay que mirarlo |

El parser **falla ruidosamente**: una fila que no se entiende se rechaza con su
número de línea y no se importa a medias. Los importes de estos archivos
conviven en varios formatos con coma decimal es-AR, y adivinar es como se
construye un sistema que miente.

## La cascada de identificación

No todas las facturas traen un código legible. Algunas no traen ninguno —remitos,
tickets, proveedores informales— y otras lo traen borroneado, arrugado o
impreso en térmico desvanecido.

Eso importa mucho menos de lo que parece, por una razón que ordena todo el
módulo:

> **Los códigos no son de dónde salen los datos. ARCA es de dónde salen los
> datos. Los códigos son solo la forma más rápida de *emparejar* la foto con la
> fila de ARCA que ya los tiene perfectos.**

Si la factura es electrónica, **está en ARCA aunque su QR sea ilegible**. Un
código que no se lee no es un problema de datos: es un problema de
emparejamiento. Y emparejar es mucho más fácil que extraer — no hay que leer
nada, hay que elegir entre las 50 o 100 filas de esa semana.

**Pero eso vale solo para las electrónicas.** Para los remitos, los tickets y
los proveedores en papel no hay fila contra la cual emparejar: ahí sí hay que
leer. Son dos caminos distintos y la cascada se bifurca en el peldaño 3.

Cinco peldaños, del más barato al más caro:

**1 · QR de AFIP** (RG 4892/2020). Trae CUIT, punto de venta, tipo, número,
fecha, importe y CAE. Resuelve solo.

**2 · Código de barras** (RG 1702/2004, Interleaved 2 of 5). Obligatorio en
facturas A, B, C, E y M, y está impreso en muchas que además traen QR. Trae CUIT,
tipo, punto de venta y **CAE**. No trae número ni importe, pero **el CAE es único
por comprobante**, así que cruza exacto contra ARCA. Son dos oportunidades de
lectura, no una, y agregarlo es gratis: el mismo lector soporta los dos formatos.

**3 · Elegir de una lista corta.** Si ningún código se lee, se muestran **las
filas de ARCA de esa semana que todavía no tienen foto**, de la más reciente a
la más vieja. Un toque en *"DON ANGEL · $764.107,11 · 27/08"* y listo. Cero
tipeo, y el dato es exacto porque viene de ARCA y no de la foto.

**4 · Lectura automática de la foto** (OCR o visión por IA). Hace dos trabajos
distintos según de qué lado de la bifurcación esté el comprobante:

- **Si es electrónico**, solo tiene que **ordenar la lista del peldaño 3** para
  que el candidato correcto quede primero. Aunque lea mal la mitad, sirve.
- **Si no lo es**, es la forma principal de sacar los datos, porque no existe
  lista de candidatos. Acá sí tiene que leer de verdad.

Ese segundo caso es el que justifica el gasto. La cuenta: si la mitad de 20-100
comprobantes semanales necesita extracción, son unos 2.000 documentos al año.
Aun a dos centavos de dólar por documento son **USD 40 al año**. El costo por
documento solo sería un problema para un producto vendible a muchas pymes, que
no es lo que se está construyendo.

**Lo que salga de acá se propone, nunca se guarda solo.** Es la única fuente
probabilística del sistema y tiene que quedar marcada como tal: alguien confirma
antes de que el número entre.

**5 · Carga manual corta**, cuando la lectura no alcanza. **El formulario cambia
según el tipo de comprobante**, y esa es la diferencia entre tres campos y una
pantalla que nadie completa:

| | Qué pide | Cuánto se tipea |
|---|---|---|
| **Remito** | Proveedor, fecha, **conforme** | Casi nada. No es fiscal y no se paga: su trabajo es dejar constancia de qué entró |
| **Ticket** | Proveedor, importe, fecha | Tres campos |
| **Factura en papel** | Proveedor, importe, fecha, **vencimiento** | Cuatro campos, y sí hay que pagarla |

Un remito no pregunta CAE. Preguntarlo es cómo se consigue que la gente cargue
cualquier cosa con tal de pasar de pantalla.

### La captura no necesita identidad

La consecuencia estructural es la que más vale: quien recibe la mercadería saca
la foto y se va. El comprobante queda sin identificar y no pasa nada. **El
emparejamiento es una actividad posterior, por lotes, de un toque por
documento**, y solo puede ocurrir después de importar el CSV, porque ARCA
publica con un día de atraso.

Quien la hace es Aldana, sin trabajo extra: ella ya abre cada foto para decidir
si paga. *Mirar la foto y tocar la fila que corresponde* es el mismo acto que ya
iba a hacer. El muelle y la oficina quedan desacoplados.

### Cómo se emparejan dos filas

Un comprobante fotografiado sin identificar y una fila importada de ARCA son
**dos filas distintas** hasta que alguien las une. Emparejarlas:

1. Mueve los adjuntos a la fila de ARCA, que es la que tiene los datos buenos.
2. Copia `destino`, `conforme` y quién capturó.
3. Marca la fila de la foto con `deletedAt` y `mergedIntoId` apuntando a la que
   quedó viva. **No se destruye**: es la única forma de auditar un
   emparejamiento equivocado.
4. Deja el rastro en `DocumentChange`.

## Roles

Se agregan dos a los tres que ya existen.

| Rol | Puede | Nunca ve |
|---|---|---|
| **RECEPCION** — depósito | Sacar la foto, marcar destino y conformidad, ver sus capturas del día | Importes, deuda, vencimientos, estado de pago |
| **PAGOS** — Aldana | Ver comprobantes con imagen e importe, cargar el `Vto:`, ver el total por proveedor, marcar pagado | El CSV crudo, credenciales, la administración. **No entra a ARCA** |
| **ADMIN** | Todo: importar el CSV, corregir vínculos, alta y fusión de proveedores, historial | — |
| `ARMADOR`, `LOGISTICA` | Nada: el módulo no existe para ellos | Todo el módulo |

**La regla es del lado del servidor, no de la interfaz:** ninguna acción del
módulo devuelve un importe a un rol que no sea `ADMIN` o `PAGOS`. No es que la
pantalla lo oculte — el dato no sale del servidor. Hay un test que lo sostiene.

## Errores y casos límite

- **No se lee ningún código.** Queda "sin identificar" con la foto guardada, y
  lo resuelve después la cascada de identificación. Nunca bloquea la captura.
- **Se empareja con la fila equivocada.** Pasa: dos facturas del mismo proveedor
  el mismo día con importes parecidos. Se desempareja, los adjuntos vuelven y el
  `mergedIntoId` se limpia. Por eso el emparejamiento no destruye nada.
- **La foto sale ilegible.** Un botón "pedir foto de nuevo" dispara un aviso push
  a quien capturó. Cierra el único circuito que si no termina en un llamado.
- **Se corta la red a mitad de la subida.** Reintento; la `clientKey` impide el
  duplicado. Si falla del todo, la foto queda en el teléfono y avisa. Lo único
  inaceptable es perderla en silencio.
- **El importe del QR no coincide con el de ARCA.** Gana ARCA, pero la
  discrepancia se registra en `DocumentChange` y el comprobante se marca para
  revisar. Nunca se pisa un número callado: así es como un sistema empieza a
  mentir.
- **Notas de crédito.** El importe se guarda siempre positivo y el `kind` decide
  el signo al sumar. Guardar negativos invita a cargar una factura común en
  negativo y descuadrar el saldo sin que nadie lo note.
- **Alguien marca pagado por error.** Se revierte y queda en el historial.
- **Borrar.** Nunca de verdad: `deletedAt`, y para un comprobante fiscal ni
  siquiera el admin. Se anula con motivo y queda. La obligación de conservarlo es
  legal, no una preferencia de diseño.

## Qué se prueba

Con `node --test`, como el resto del proyecto:

1. Los dos lectores: QR de AFIP y código de barras ITF, cada uno con un caso
   real, uno corrupto y uno de otra cosa. Y que el CAE del código de barras
   cruce contra la fila correcta de ARCA.
2. El parser del CSV de ARCA: formatos de número, filas de total, campos vacíos.
3. La deduplicación: la misma factura por ARCA y por foto da **una** fila.
   Y el emparejamiento manual: los adjuntos se mudan, la fila de la foto queda
   con `mergedIntoId`, y desemparejar la devuelve a como estaba.
4. El signo de las notas de crédito en el total por proveedor.
5. Los centavos: `$2.231.811,45` va a la base y vuelve idéntico, incluido el ida
   y vuelta de `BigInt` a JSON.
6. **Los permisos, del lado del servidor**: una acción del módulo de pagos
   invocada con una sesión `RECEPCION` no devuelve importes. Sin este test, la
   promesa de la sección de roles es solo una intención.
7. **Que la lectura automática no escriba sola**: lo que devuelve el lector
   queda propuesto y sin confirmar, y ningún importe entra al total por
   proveedor hasta que una persona lo confirme. Es la única fuente
   probabilística del sistema y es la que puede meter un número inventado.

## Lo que no hace

No emite facturas · no se conecta a ARCA por API (el CSV se sube a mano) · no
paga ni toca bancos o Mercado Pago · no lleva contabilidad ni libro IVA · no
tiene detalle de ítems · no concilia pagos parciales ni cheques · no es
multiempresa · no imputa comprobantes a eventos.

Cada una es una decisión, no un olvido.

## Lo que hay que medir antes de escribir código

Dos mediciones, una tarde, cero código. Salieron de la revisión del Council.

**La etapa 1 no depende de ellas** —está diseñada para cubrir el 100% de los
comprobantes sea cual sea la mezcla— pero deciden dos cosas: cuánto vale la
etapa 2, y si hace falta la lectura automática del peldaño 4.

1. **Exportar el CSV de Recibidos de la semana pasada** y cruzarlo con lo que
   Aldana efectivamente pagó esa semana, contando **dos veces**: cuántos
   comprobantes están, y **cuánta plata** representan. Los dos números van a dar
   distinto, y el segundo es el que dice cuánto vale la etapa 2 — si ARCA cubre
   el 30% de los papeles pero el 80% del dinero, sigue valiendo mucho.
2. **Agarrar 20 comprobantes reales** —arrugados, con grasa, como llegan— y
   contarlos en tres montones: **cuántos tienen QR legible**, cuántos tienen
   **código de barras legible** (aunque el QR no se lea), y cuántos **no tienen
   ninguno**. Ese tercer montón es el único que va a necesitar tipeo, y su
   tamaño decide si hace falta el peldaño 4 de la cascada.

## Lo que quedó sin resolver

- **La granularidad de la delegación de ARCA no está verificada.** Está
  confirmado que se pueden delegar servicios a otro CUIT sin compartir la clave
  fiscal. No está confirmado que "Mis Comprobantes" no se pueda delegar solo en
  su parte de *Recibidos*. Si se pudiera, parte del problema se resuelve sin
  código. Son veinte minutos en el Administrador de Relaciones.
- **Cómo se corren las migraciones de un segundo esquema en Prisma 7** con
  `prisma.config.ts`, que acepta un solo `schema`. Hay que leer la documentación
  de `node_modules` antes de asumir nada, como ya advierte `AGENTS.md`.
- **Aldana no participó de este diseño.** Nadie le preguntó cuáles son sus
  columnas ni qué necesita ver. Todo el retorno depende de que abandone una
  herramienta que controla por una que no pidió.
- **Segregación de funciones.** Aldana paga y además registra que pagó. El
  historial de `DocumentChange` deja rastro, pero el control lo cierra alguien
  que revise, y hoy ese alguien no está definido.
- **Compras facturadas a otro CUIT no aparecen en el cruce.** El control de
  "facturas que nadie trajo" es ciego a esa fuga por construcción.
- **La lista de comprobantes sin respaldo en ARCA va a ser grande.** Es una
  consecuencia del negocio, no del diseño, y el sistema la va a hacer visible
  por primera vez. Es información que el contador va a querer ver; qué se hace
  con ella no es una decisión de este documento.
