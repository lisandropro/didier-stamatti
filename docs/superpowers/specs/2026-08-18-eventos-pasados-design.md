# Los eventos que ya pasaron salen del camino

18 de agosto de 2026

## El problema

Un período operativo puede durar varios días. Mientras está abierto, su lista
de eventos mezcla los que ya se hicieron con los que faltan, todos con la misma
pinta. Quien entra a la pantalla principal a ver qué tiene por delante tiene que
leer fechas una por una para descartar lo que ya pasó.

Cuando el período entero termina, la app ya lo saca del selector y lo manda a
Historial. El agujero está *adentro* de un período todavía abierto.

## Qué se hace

Dentro del período, los eventos se parten en dos:

- **Por hacer** — los de hoy y los que vienen. Es la lista de siempre, arriba.
- **Ya pasaron (N)** — plegados al pie, cerrados. Se abren con un clic.

Los eventos pasados quedan enteros: se entran, se imprimen, se editan y se
borran igual que hoy. Nada se archiva de verdad, nada se cierra, nada cambia de
período. Es puramente dónde se muestra.

## La regla

Un evento ya pasó cuando **su día es anterior a hoy**, con los días leídos en
`America/Argentina/Buenos_Aires` (la política de `lib/dates.ts`). Un evento de
hoy sigue arriba toda la jornada, sin importar la hora que tenga cargada: la
gente del depósito trabaja por día, no por reloj.

## Lo que NO cambia

El **aviso de stock** del período sigue sumando los reutilizables de todos sus
eventos, hayan pasado o no. Es a propósito: la vajilla que salió el sábado puede
no haber vuelto al depósito el domingo, y mientras no vuelva le compite al
evento siguiente. Ese es justamente el sentido de agrupar días en un período.
Si en la práctica las cosas vuelven antes, es otra decisión y se toma aparte.

Tampoco cambian: el resumen del depósito, Historial, la papelera, los permisos,
ni el cálculo de faltantes por evento.

## Cómo queda armado

- `separarPorFecha(eventos, hoy)` en `lib/period-fit.ts` — función pura, sin
  base ni React: recibe los eventos con su día y devuelve `{ porHacer, pasados }`
  conservando el orden cronológico. Es lo único con lógica, y es lo que se
  prueba.
- `app/(app)/page.tsx` — marca cada evento con `pasado` usando `diaDe(e.date)`
  contra `hoy()`.
- `components/PeriodHub.tsx` — usa `<details>` nativo para la sección plegada
  (sin estado propio, funciona con teclado) y comparte la misma tarjeta entre
  las dos listas.

## Casos que hay que atender

- **Todos los eventos ya pasaron** y el período sigue abierto: la lista de
  arriba no puede mostrar "este período no tiene eventos todavía", que es falso.
  Muestra que no queda nada por hacer, con los pasados plegados abajo.
- **Ningún evento pasó**: la sección plegada no aparece. La pantalla se ve
  exactamente como hoy.
- **Período ya terminado**: no cambia nada; sigue saliendo del selector y
  viviendo en Historial, con su franja de "este período ya pasó".

## Cómo se comprueba

- Tests de `separarPorFecha`: evento de ayer, de hoy, de mañana, lista vacía,
  todos pasados, ninguno pasado, y que el orden se conserve.
- A mano en el navegador, sobre el período abierto de producción.
