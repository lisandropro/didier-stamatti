# Depósito y avisos — que lo físico se entere de cada cambio

> Diseño aprobado por el usuario el 19/10/2026. Pieza 3 del plan de la app de pedidos (en el vault: `Plan - App de pedidos (recorte, arreglos y avisos)`).

## El problema, medido

Un pedido se prepara en el depósito y después cambia. El que preparó no se entera, o se entera tarde y con un aviso que no dice qué hacer, y el evento sale con faltantes o con cosas de más.

Medido sobre los 5.639 cambios de pedido registrados hasta el 18/10/2026:

| Qué | Cuánto |
|---|---|
| Cambios hechos por Enrique | 5.403 (96 %) |
| Cambios en las 48 h antes del evento | 1.020, en 34 de 131 eventos |
| Cambios en las últimas 24 h o con el evento empezado | 240, en 15 eventos |

Según el usuario, la falla aparece de las cuatro maneras posibles:
- se cambia después de preparar;
- el depósito trabaja con un papel que quedó viejo;
- se cambia el mismo día del evento;
- un evento del finde le quita algo a otro.

Además, desde el 07/09 ningún teléfono podía activar los avisos: el chequeo de origen fallaba detrás del proxy. Se arregló el 19/10 (`08579f3`).

## Lo que decidió el usuario

1. **Los avisos que importan** son los cambios en los ítems del pedido y el faltante nuevo de stock. El exceso de avisos no es un problema.
2. **Destinatarios**: el depósito y Pablo primero, con prioridad, y además los que arman y la administradora. Nunca quien hizo el cambio.
3. **Demora**: el aviso de cambios sale **2 minutos** después del último cambio, no 5.
4. **Canal**: push del navegador, con registro de cada envío. Otro canal (WhatsApp, Telegram) solo si el registro muestra que el push no llega.
5. **Rol nuevo, "Depósito"**, para quien prepara físicamente:
   - ve los eventos próximos con su pedido y los faltantes del período;
   - **ve todas las cantidades**: lo que pide el pedido, cuánto hay y cuánto falta;
   - **no modifica nada** del pedido, ni accede a inventario, historial ni usuarios;
   - recibe los avisos con prioridad.
6. **Preparación ítem por ítem**: el depósito tilda en el teléfono lo que junta, como hacía con el papel, y puede tildar un sector entero de una vez.
7. **Cambio tardío**: si alguien cambia un ítem ya tildado, la app **advierte antes de guardar y, si se confirma, avisa** con la diferencia exacta. No pide aprobación.
8. **Registro de cambios tardíos**, visible **solo para la administradora**.
9. **Instalable**: la misma app web, con la instalación guiada. Casi todos los teléfonos del depósito son Android. No hay app de tienda.
10. **Interfaz del celular**: hay que rehacerla para el armador y para la portada.

## Fuera de alcance

- WhatsApp, Telegram, email.
- Horario silencioso, resumen diario, preferencias por persona.
- App nativa o de tienda, y modo sin conexión.
- Devolución y conteo post-evento.

---

## Etapa 1 · Que los avisos lleguen, y saber cuándo no

### Registro de envíos

Tabla nueva `PushDelivery`, **una fila por intento a un dispositivo**:

| Campo | Qué |
|---|---|
| `notificationId` | El aviso que se mandó. Puede ser nulo: una prueba no tiene aviso |
| `userId`, `subscriptionId` | A quién y a qué dispositivo. `subscriptionId` sin clave foránea: el dispositivo puede borrarse y el registro tiene que quedar |
| `kind` | `ORDER_EDIT`, `CAMBIO_TARDIO`, `FALTANTE`, `PEDIDO_VACIO`, `SISTEMA`, `SUGERENCIA`, `PRUEBA` |
| `status` | `ACEPTADO`: el servicio de push lo tomó. `CADUCADO`: respondió 404 o 410, y la suscripción se borra. `RECHAZADO`: cualquier otro 4xx. `ERROR`: 429, 5xx o la red |
| `statusCode`, `error` | Para diagnosticar. El error se recorta a 300 caracteres |
| `attempt` | 1 o 2 |
| `payload` | El JSON que se mandó. Hace falta para poder reintentarlo |
| `createdAt`, `openedAt` | `openedAt` se completa cuando la persona toca el aviso |

`PushSubscription` suma `userAgent`, que se toma al suscribir, para mostrar "Android · Chrome". También suma `lastOkAt` y `lastErrorAt`.

**Retención**: `PushDelivery` se poda a los 60 días, en el mismo barrido que vacía la papelera.

### Envío

- `sendPushToUser` **devuelve el resultado por dispositivo**, en vez de no devolver nada, y escribe una `PushDelivery` por intento.
- **Un reintento** ante 429 o 5xx: el barrido siguiente reenvía el `payload` de las `PushDelivery` en `ERROR` con `attempt = 1`, si la suscripción sigue existiendo. Nunca más de uno.
- `pushedAt` se sigue marcando al intentar. Lo que cambia es el contador: **"enviados" cuenta solo los `ACEPTADO`**.
- Si faltan las claves VAPID, se escribe una `PushDelivery` con `status = ERROR` y `error = "sin claves"`. Hoy se pierde en silencio.

### El teléfono

- **El service worker se registra desde el layout de la app**, en cualquier pantalla. Hoy solo se registra al visitar Avisos.
- **`pushsubscriptionchange`**: el service worker se vuelve a suscribir y se lo avisa al servidor.
- **Al tocar un aviso** se abre su URL con `?d=<deliveryId>`. El servidor completa `openedAt` y marca el aviso como leído. Hoy, abrir el aviso de pedido vacío o el de sugerencia no lo marca.
- **Cerrar sesión desuscribe el dispositivo**: el cliente borra la suscripción en el servidor antes de llamar a `logout`.
- **Borrar un usuario borra sus suscripciones.**
- **Botón "Probar en este teléfono"** en Avisos: manda un `PRUEBA` solo a esta suscripción y muestra el resultado.

### Pantalla "Dispositivos" (solo la administradora)

Muestra a cada persona con sus dispositivos (sistema, navegador, alta), el último envío aceptado y el último error.

- **Quien tiene cero dispositivos sale primero y en rojo.**
- **Quien tiene un dispositivo con 3 errores seguidos se marca como "no le llega".**

### Que se entienda

- **El push dice qué cambió.**
  - Título: el lugar del evento.
  - Cuerpo: hasta tres cambios y "y N más". Por ejemplo: `Copas de agua 10→24 · Servilletas +50 · Brasero quitado · y 1 más`.
  - Pie: quién lo hizo.
- **La quietud baja de 5 a 2 minutos** (`QUIET_MINUTES = 2`).
- **"Qué cambió" muestra solo esa tanda**: los cambios entre `sinceAt` y `createdAt` del aviso. Hoy no tiene tope y mezcla las tandas siguientes.
- **Los avisos del sistema** llevan a `/notificaciones`, no a "Qué cambió".
- **"Para revisar" vuelve a tener links**: el agrupado por código conserva la `url` del primer hallazgo.

### Destinatarios

`ORDER_EDIT` le llega a `LOGISTICA`, `ARMADOR` y `ADMIN`, menos quien hizo el cambio, igual que hoy. Desde la etapa 2 se suma `DEPOSITO`: `isPriorityRecipient` pasa a incluirlo, con prioridad `high` y primero en la cola.

---

## Etapa 2 · Rol Depósito, preparación y cambio tardío

### Rol

`DEPOSITO`, con la etiqueta "Depósito" y la ayuda "Prepara los pedidos en el teléfono".

| Capacidad | ADMIN | ARMADOR | LOGISTICA | DEPOSITO |
|---|---|---|---|---|
| `canVerStock` (portada, inventario, historial, editor de pedido) | ✓ | ✓ | ✓ | — |
| `canVerPreparacion` (pantallas de Preparar, faltantes del período) | ✓ | ✓ | ✓ | ✓ |
| `canPreparar` (tildar) | ✓ | — | ✓ | ✓ |
| `canEditOrders` | ✓ | ✓ | — | — |
| `isPriorityRecipient` | — | — | ✓ | ✓ |

- **Navegación de DEPOSITO**: Preparar, Avisos, Cuenta y Sugerir.
- **`/` lo lleva a `/preparar`.** Las pantallas del stock le responden 404, igual que a cualquier rol sin permiso.
- **Las pruebas de la matriz de permisos se extienden**: si se agrega un rol, fallan hasta que se decida cada casilla. Ese mecanismo ya existe.

### Modelo de preparación

Tabla nueva `Preparacion`, **una fila por ítem tildado**:

| Campo | Qué |
|---|---|
| `eventId` | Con clave foránea y `onDelete: Cascade`: si se borra el evento, se borra la preparación |
| `clave` | `productId` para los ítems de catálogo, `custom:<orderLineId>` para los sueltos |
| `itemName`, `unit`, `category` | **Copiados al tildar**: si se borra el renglón, el pendiente "sacá 3 braseros" tiene que poder leerse solo |
| `qty`, `note` | Lo que había en el pedido **en el momento de tildar** |
| `porId`, `porName`, `at` | Quién tildó y cuándo |

Clave única: `[eventId, clave]`.

**La clave es el ítem, no el renglón.** Si se borra el renglón, la preparación queda, y eso es justamente lo que dice "sacá esto".

### Estado de cada ítem (se calcula, no se guarda)

| Pedido `q` | Preparado `p` | Estado | Qué ve el depósito |
|---|---|---|---|
| > 0 | — | Pendiente | Casilla vacía |
| = p | = q, misma nota | Preparado | ✓ |
| ≠ p, > 0 | existe | **Cambió** | "Antes 10 → ahora 24 · **sumá 14**" o "**sacá 6**" |
| igual | nota distinta | **Cambió la nota** | La nota nueva resaltada |
| 0 o sin renglón | > 0 | **Sacar** | "**Sacá 3** · ya no va" |

- **Volver a tildar un ítem que cambió** guarda el `q` y la nota nuevos. Si el estado era "Sacar", la fila se borra.
- **Destildar** borra la fila. Es para errores de quien tilda.
- **Avance por sector**: `preparados / (pedidos + a sacar)`.

### Cambio tardío

**Es tardío todo cambio a un ítem que tiene `Preparacion`.**

- **Un cambio solo de nota también es tardío.** Al depósito le cambia el trabajo igual ("los largos").
- **`OrderChange` suma `tardio Boolean @default(false)`**. Lo calculan `setLine` (incluido volver a agregar un producto que estaba para sacar), `setCustomQty`, `deleteLine`, `copyOrderFromEvent` y `restorePeriodVersion`/`discardPeriodChanges`, comparando contra la preparación **dentro de la misma transacción** que escribe.
- **`addCustomLine` nunca es tardío**: un ítem suelto nuevo tiene una clave nueva, que nadie preparó.
- **En el editor**:
  - el armador recibe la preparación de cada ítem;
  - al tocar un ítem preparado, antes de que el cambio entre a la cola de autoguardado, aparece en la fila: *"Ya está preparado (10). Si lo cambiás, el depósito tiene que rehacerlo."* con **Cambiar igual** / Cancelar;
  - confirmado una vez, ese ítem no vuelve a preguntar hasta recargar, para no trabar el ajuste fino;
  - el aviso va en la fila y no en una ventana: no tapa el pedido.
- **Copiar o restaurar** sobre un evento con ítems preparados: la confirmación que ya existe suma *"N ítems ya están preparados y van a cambiar"*.
- **Aviso `CAMBIO_TARDIO`**:
  - va aparte de `ORDER_EDIT`, en una tanda propia con la misma quietud de 2 minutos, y con urgencia `high` para todos los destinatarios;
  - el título es `⚠ Cambio en pedido ya preparado · <lugar>` y el cuerpo, las acciones: `Sumá 14 Copas de agua · Sacá 3 Braseros · y 2 más`;
  - al tocarlo abre `/preparar/<eventId>`.
- **Si el evento es hoy** (día argentino), el título lleva `HOY`.

### Pantallas de Preparar (mobile-first)

**`/preparar`**: los eventos vivos desde hoy hasta 14 días adelante, ordenados por fecha. Cada tarjeta muestra:
- el lugar, el día y la hora;
- el avance (`Vajilla 48/68 · Bebida 0/20`);
- **"N cambios para aplicar"** en naranja, cuando hay;
- "HOY" o "MAÑANA" bien visible.

**`/preparar/<eventId>`**:
- **Cabecera fija de una línea**: volver, lugar y día, faltantes del período.
- **Arriba de todo, "Cambios para aplicar"**: los ítems en estado *Cambió* y *Sacar*.
- **Después, una sección por sector**, con el avance y el botón **Tildar todo el sector**. Pide confirmación y tilda solo lo *Pendiente*: lo que está en *Cambió*, *Cambió la nota* o *Sacar* se confirma de a uno, porque implica mover algo físico.
- **Cada fila**: casilla de 44 px, nombre, **la cantidad grande a la derecha** y la nota debajo, siempre visible. Toda la fila es tocable.
- **Faltantes del período**: la misma regla y los mismos números que hoy (piden, hay, faltan), en lista.
- **Se actualiza sola** al volver a la pestaña y cada 45 segundos, igual que el contador de avisos. Quien tilda con la pantalla abierta ve llegar el cambio sin recargar.

### Registro de cambios tardíos (solo ADMIN)

**`/cambios-tardios`**: los `OrderChange` con `tardio = true`, filtrables por período.

- **Por evento**: cuántos hubo, cuántos el mismo día y el detalle.
- **Por persona**: cuántos hubo y en cuántos eventos.

Mide el problema con los datos que la app ya registra.

### Instalación guiada

Componente `InstalarApp`:

- **Android / Chrome**: captura `beforeinstallprompt` y ofrece **Instalar la app**.
- **iPhone / Safari**: muestra los tres pasos (Compartir → Agregar a inicio → Abrir desde el ícono), con la advertencia de que en iPhone los avisos solo funcionan instalada.
- **Ya instalada** (`display-mode: standalone`): no aparece.
- **Dónde aparece**: en Avisos, y al primer ingreso de DEPOSITO.

El manifiesto queda como está: `start_url` sigue siendo `/` y la redirección por rol hace el resto. Se suma un atajo "Preparar".

---

## Etapa 3 · Faltante nuevo

Tabla nueva `FaltanteAvisado` (`periodId`, `productId`, `missing`, `at`), con clave única `[periodId, productId]`.

**El barrido de cada minuto**, el mismo de los avisos, para cada período vivo que todavía no terminó:

1. **Calcula los faltantes** con `lib/shortage-rule.ts`, la misma regla que el editor y "Ver faltantes".
2. **Si un producto falta y no estaba avisado, o falta más que lo avisado**: aviso `FALTANTE` y se actualiza la fila.
3. **Si dejó de faltar**: se borra la fila, sin aviso.
4. **La primera corrida después del deploy registra los faltantes que ya existen sin avisar.** Si no, el deploy dispara de golpe un aviso por cada faltante viejo.

**El texto**:
- título `Falta stock · <período>`;
- cuerpo `Faltan 50 Copas de agua: piden 300, hay 250. Lo empujó el pedido de El Carmen Center.`

**La causa** sale del último `OrderChange` sobre ese producto en el período. Si no hay ninguno reciente, dice *"por un ajuste de stock"*.

**Destinatarios** los mismos de la etapa 1, con urgencia `high` y sin excluir a nadie: un faltante no tiene autor. **Destino**: los faltantes del período en `/preparar` para DEPOSITO, y el resumen del depósito para el resto.

---

## Etapa 4 · Interfaz del celular

**Medido el 19/10 a 375×812**, con datos de producción: en el editor, la cabecera fija ocupa el 40 % de la pantalla y entran **2 productos**. La meta es **6 o más**.

- **Editor de pedido**:
  - cabecera fija de una línea: volver, lugar, insignia de faltantes y menú ⋯ con Editar, Repetir, PDF y Listo;
  - el responsable pasa al menú;
  - los filtros de sector, en una sola fila con scroll horizontal.
- **Fila de producto compacta**:
  - nombre y paso − / cantidad / + en la misma línea;
  - una segunda línea chica solo cuando hay algo que decir (`falta 30`, nota);
  - ±10, depósito, otros eventos y la nota completa, en el detalle que se abre al tocar el nombre.
- **Pedido en solo lectura**: debajo de 640 px es una lista, con la nota debajo del nombre. Hoy la tabla tiene un mínimo de 680 px y la nota queda afuera de la pantalla.
- **Portada**:
  - **los eventos primero**;
  - los tres números, en una línea;
  - Nuevo, Editar y Borrar período, en un menú;
  - **el borrar del evento sale de la tarjeta**: hoy está pegado a "Armar pedido".

**Se verifica midiendo**, como el 09/09: los productos visibles por pantalla antes y después, a 375×812, con el pedido de 125 renglones.

---

## Cómo se construye

**Cada etapa tiene su propio plan de implementación**, se despliega sola y se verifica con datos reales antes de pasar a la siguiente. Las etapas 2 a 4 dependen de la 1, porque usan el registro de envíos. La 3 y la 4 no dependen entre sí.

## Pruebas

Cada etapa trae las suyas, contra una base descartable, como el resto del proyecto:

- **Etapa 1**:
  - `sendPushToUser` registra cada intento con el estado correcto: 201, 404, 410, 403, 429 y 500 simulados;
  - el reintento ocurre una sola vez;
  - "Qué cambió" no mezcla tandas;
  - abrir un aviso lo marca leído;
  - borrar un usuario borra sus dispositivos.
- **Etapa 2**:
  - **la tabla de estados completa**: cada combinación de `q`, `p` y nota da el estado y el texto esperados;
  - cada acción marca `tardio` cuando y solo cuando corresponde;
  - tildar un sector tilda solo lo *Pendiente*;
  - DEPOSITO no puede escribir nada del pedido, con una prueba sobre el texto de las acciones como la de `order-actions.test.ts`;
  - la matriz de permisos completa.
- **Etapa 3**:
  - un faltante nuevo avisa una vez;
  - empeorar avisa otra vez;
  - resolverse no avisa;
  - la primera corrida no avisa los faltantes existentes;
  - la regla es la misma que la del editor.
- **Etapa 4**: medición en el navegador, y que el editor siga guardando igual. Las pruebas del autoguardado ya existen.

**Antes de cada deploy**: la app en local sobre una copia de producción, sin suscripciones y con las claves de push vacías, como el 19/10.

## Riesgos

- **Que el depósito no tilde.** Si no tildan, no hay cambio tardío. Para que tildar valga la pena por sí mismo, la pantalla de Preparar tiene que reemplazar al papel con ventaja: la nota visible, el avance y lo que cambió arriba de todo. La adopción se mide con el registro: cuántos ítems se tildan por evento.
- **Fricción para Enrique.** La advertencia es una por ítem y por sesión, en la fila, y no frena. Si molesta demasiado, se ajusta con datos del registro, no a ojo.
- **iPhone.** Los avisos solo llegan con la app instalada desde Safari, en iOS 16.4 o posterior. La instalación guiada lo explica, y el registro muestra si llegan.
- **Samsung y su ahorro de batería**, que duerme la app. El protocolo de prueba en el teléfono ya documenta los ajustes, y la pantalla Dispositivos muestra a quién no le llega.
