# Levante: la ayuda memoria para juntar todo después del evento — diseño

Aprobado por el usuario el 09/11/2026.

## El problema

Después de cada evento hay que levantar: juntar en el salón todo lo que se llevó y subirlo al camión. Hoy no hay una lista a mano para eso, así que se olvidan cosas y nadie registra qué no volvió (lo roto o perdido). Pedido del usuario: "que el apartado de preparar pedidos sirva para que a la hora de juntar puedan tener la lista de cosas para no olvidarse nada de los eventos, una ayuda memoria en la que puedan tachar las cosas que falten o las que ya juntaron y cargaron". Aclaró: "No es para el depósito, es después de los eventos, a la hora del levante".

## Decisiones

- **Vive en Preparar.** La pantalla de Preparar suma una sección **"Para levantar"**: cada evento aparece desde su día (hora argentina) hasta que se termina su levante, con un máximo de 7 días para atrás. Tarjeta con "Levante · N de M" (marcados de total).
- **La lista es lo que fue al evento:** los renglones del pedido con cantidad > 0 de productos **REUTILIZABLE** y los **ítems sueltos** (sin producto); los consumibles no vuelven y no aparecen. Agrupada por sector (`CATEGORIES` de `lib/categories.ts`), con la cantidad que se mandó.
- **Marcas por ítem:**
  - **Volvió todo:** se toca la fila; se tacha, vibra y baja al final de su sector (lo pendiente queda arriba).
  - **Falta:** botón en la fila que pregunta cuántos no volvieron (propone todos, mínimo 1, máximo lo mandado). La fila queda en rojo "Faltan N de M". Se puede corregir o desmarcar.
  - **Tachar todo el sector:** marca como "volvió todo" lo pendiente del sector.
- **Quién marca:** los mismos que tildan Preparar (`canPreparar`: administradora, logística, depósito). Los demás ven la lista sin poder marcar.
- **Terminar el levante:** botón al pie. Si quedan ítems sin marcar, confirma "Quedan N sin revisar" y deja terminar igual; esos quedan como **sin revisar**, no como faltantes. Al terminar:
  - el evento sale de "Para levantar";
  - **le llega un aviso a quien puede tocar el stock** (`canEditStock`, hoy la administradora): "Levante de MUSEO: faltaron 5 Copa vino y 2 Mantel redondo" / "Levante de MUSEO: volvió todo" (y "N sin revisar" si hubo). Tocarlo abre el levante del evento.
  - Una vez terminado no se puede volver a marcar (para corregir, la administradora reabre: "Reabrir levante").
- **Descontar del stock (solo `canEditStock`):** en el levante terminado, cada faltante de un producto tiene **Rotura** / **Pérdida**. Da de baja con un `StockMovement` (delta −N, `reason` ROTURA o PERDIDA, nota "Levante de {lugar} {dd/mm}") y descuenta el stock del producto, por el mismo camino que el ajuste de stock de hoy. El renglón queda "Descontado (Rotura)". Una sola vez por renglón, aunque dos teléfonos toquen a la vez. Lo que no se descuenta no toca el stock. Los ítems sueltos no tienen stock: solo quedan anotados.
- **Celular primero:** la pantalla sigue las convenciones de la app en el celular (filas tocables grandes, `:active` apretado, hojas que suben desde abajo para "¿Cuántos faltan?", vibración con `lib/vibrar.ts`, sin `router.refresh()` sin señal).

## Fuera de alcance

Contar lo que sobra; fotos de lo roto; avisar a otros roles además de quien toca el stock; descontar automáticamente.

## Datos

- Tabla nueva por ítem de levante (evento + clave del ítem, como `Preparacion`): nombre, unidad, sector, cantidad mandada, cuántos faltan (0 = volvió todo), quién y cuándo, y si se descontó (motivo, cuándo, quién). Se copian nombre/unidad/sector para que la fila se lea sola.
- En el evento: cuándo se terminó el levante y quién.
- Migración nueva; `prisma migrate deploy` la aplica al desplegar.

## Verificación

Sobre la copia de producción (sin suscripciones, claves de push vacías): un evento de ayer aparece en "Para levantar"; marcar volvió/falta/tachar sector; terminar con pendientes; el aviso llega a la administradora; descontar Rotura baja el stock y deja el movimiento en el historial; dos toques de descuento no descuentan dos veces.
