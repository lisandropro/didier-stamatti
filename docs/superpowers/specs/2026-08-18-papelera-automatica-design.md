# La papelera se vacía sola los lunes

18 de agosto de 2026

## El problema

Lo que se borra en la app no se borra: queda en la papelera para poder
recuperarlo. Nadie la vacía nunca, así que crece sin freno y cada semana cuesta
más encontrar ahí adentro lo que uno realmente quiere recuperar.

## La regla

**Se borra definitivamente lo que ya estaba en la papelera antes del lunes más
reciente**, con los días leídos en `America/Argentina/Buenos_Aires`.

Algo tirado un martes o un domingo se va el lunes siguiente. Algo tirado un
lunes sobrevive hasta el otro lunes. Nunca se pierde nada con menos de un día de
margen, y en general hay una semana entera.

## Por qué la regla se enuncia sobre los datos y no sobre el reloj

La tarea diaria del servidor arranca cuando arranca el contenedor, y el
contenedor se reinicia con cada despliegue. Un disparo del estilo "andá los
lunes a las 3" se puede saltear justo el lunes y nadie se entera.

Acá el barrido no pregunta qué día es: pregunta *qué debería estar borrado ya*.
De eso salen tres propiedades que importan:

- Si el servidor estuvo apagado todo el lunes, el martes limpia igual.
- Si corre tres veces el mismo día, la segunda y la tercera no encuentran nada.
- Se puede probar sin tocar el reloj: la función recibe el día como argumento.

## Qué se lleva y qué no

Se borra: los **períodos** y los **eventos** que estén en la papelera desde
antes del corte. Con ellos se van, por las cascadas del esquema, sus pedidos,
su historial de cambios y las copias del período — es lo que había adentro de
lo que se tiró.

También se borran los **avisos** que apuntaban a un evento recién borrado.
`Notification.eventId` no es clave foránea, así que nadie los limpia solo y
quedarían llevando a una pantalla que no existe.

No se toca: las copias guardadas de un período **vivo** (son la única forma de
deshacer un cambio en un pedido en uso, no son basura), el stock, los
movimientos de inventario, los productos, los usuarios ni las sugerencias.

## Cómo queda armado

- `lunesMasReciente(dia)` en `lib/dates.ts` — aritmética de calendario pura,
  junto al resto. Vive ahí y no en `lib/trash` para poder probarla sin arrastrar
  la base detrás.
- `vaciarPapelera(dia)` en `lib/trash.ts` — hace el borrado y devuelve cuántos
  períodos, eventos y avisos se llevó.
- `instrumentation.ts` — lo corre al arrancar y una vez por día. Va **antes** y
  **fuera** de la condición del respaldo: limpiar la papelera no depende de
  tener S3 configurado. Si falla, se registra el error y el arranque sigue.
- La pantalla de la papelera avisa que se vacía sola. Antes decía "nada se borra
  del todo", que ahora sería mentira; sin ese cartel, la primera vez que algo
  desaparezca va a parecer una falla de la app.

## Cómo se comprueba

- El corte, sin base: cada día de la semana, y el cruce de mes y de año.
- El barrido, contra una base de prueba: que se vaya lo que corresponde, que
  **siga estando todo lo demás**, que los avisos huérfanos no queden, que correr
  dos veces el mismo día no borre nada, y que lo tirado un lunes aguante hasta
  el lunes siguiente.
- A mano: dejar algo viejo en la papelera local, reiniciar el servidor y ver el
  renglón `[papelera]` en el registro.
