// En qué rubro está cada proveedor, y si lo que le compramos es costo de un
// evento o gasto de la empresa.
//
// **Por qué existe.** El costo por evento se calcula repartiendo entre los
// eventos de un período lo que se compró para ese período. Si se repartiera
// TODO, en el costo de una fiesta entrarían los impuestos, los honorarios del
// contador y los retiros de los socios — y el margen saldría gravemente mal,
// para abajo, sin que nada avise.
//
// La lista no se inventa: **sale de la auditoría de la caja 2025-2026**, donde
// 1.990 grafías de proveedor se redujeron a 458 contrapartes y 27 categorías.
// Usar las mismas permite comparar lo que muestre la app contra lo que ya se
// analizó, en vez de tener dos vocabularios que dicen casi lo mismo.

/** Los rubros, tal como quedaron en `MAESTROS-categorias.csv`. */
export const CATEGORIAS = [
  "Almacen y lacteos",
  "Bebidas",
  "Bienes de uso",
  "Cargas sociales",
  "Carnes",
  "Cobro de evento",
  "Comision",
  "Descartables y limpieza",
  "Gas y combustible",
  "Gastos bancarios",
  "Hielo",
  "Impuestos",
  "Logistica y fletes",
  "Obra y mantenimiento",
  "Operaciones con cheques",
  "Panaderia y pasteleria",
  "Personal por evento",
  "Pescados",
  "Prestamo a personal",
  "Retiro de socio",
  "Seguros",
  "Servicios",
  "Servicios profesionales",
  "Sueldos",
  "Vajilla y manteleria",
  "Verduleria",
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export function esCategoria(v: string): v is Categoria {
  return (CATEGORIAS as readonly string[]).includes(v);
}

/**
 * Qué se reparte entre los eventos y qué no.
 *
 * **Las cuatro discutibles las decidió el usuario**, y las cuatro entran:
 * sueldos y cargas sociales, gas y combustible, vajillería y mantelería, y
 * logística y fletes. El criterio que eligió es amplio: si el gasto existe
 * porque se hacen eventos, carga contra los eventos.
 *
 * Las que quedan afuera no son "gastos menos importantes": son cosas que **no
 * son costo de producir una fiesta**. Un retiro de socio es reparto de
 * ganancia, no un costo; un préstamo al personal ni siquiera es un gasto; una
 * compra de bienes de uso es una inversión que dura años y cargarla entera
 * contra los eventos de un fin de semana haría ver pérdida donde no la hay.
 */
const ES_COSTO_DE_EVENTO: Record<Categoria, boolean> = {
  // --- Lo que se consume haciendo la fiesta ---
  "Almacen y lacteos": true,
  Bebidas: true,
  Carnes: true,
  "Descartables y limpieza": true,
  Hielo: true,
  "Panaderia y pasteleria": true,
  Pescados: true,
  Verduleria: true,
  // --- La gente y el movimiento, que el usuario decidió incluir ---
  "Personal por evento": true,
  Sueldos: true,
  "Cargas sociales": true,
  "Gas y combustible": true,
  "Logistica y fletes": true,
  "Vajilla y manteleria": true,

  // --- Estructura de la empresa: existe igual haya o no eventos ---
  Impuestos: false,
  Seguros: false,
  Servicios: false,
  "Servicios profesionales": false,
  "Gastos bancarios": false,
  "Obra y mantenimiento": false,
  // Una inversión que dura años. Cargarla entera contra los eventos de un fin
  // de semana mostraría pérdida donde no la hay.
  "Bienes de uso": false,
  // --- No son gastos: son movimientos de plata o reparto de ganancia ---
  "Retiro de socio": false,
  "Prestamo a personal": false,
  "Operaciones con cheques": false,
  // Es un ingreso, no un costo. Está en la lista porque la auditoría clasifica
  // todos los movimientos de la caja, no sólo los gastos.
  "Cobro de evento": false,
  // **Discutible y por eso afuera**: la comisión de venta es del evento que se
  // vendió, no del período. Repartirla por comensales se la cargaría a fiestas
  // que otra persona vendió. Entra el día que se sepa qué evento vendió cada
  // una.
  Comision: false,
};

/**
 * Si lo comprado a un proveedor de este rubro entra en el costo de los eventos.
 *
 * Un proveedor **sin categoría cargada devuelve `false`**, y eso es a
 * propósito: no se sabe qué es, y meterlo en el costo sería inventar. Lo que sí
 * hace el sistema es **decir cuánto quedó afuera por no estar clasificado**, así
 * el número nunca se presenta como completo cuando no lo está.
 */
export function esCostoDeEvento(categoria: string | null): boolean {
  if (categoria == null || !esCategoria(categoria)) return false;
  return ES_COSTO_DE_EVENTO[categoria];
}

/** Las que entran en el costo, para mostrarlas en pantalla sin repetir la
 *  tabla en el componente. */
export const CATEGORIAS_DE_COSTO: readonly Categoria[] = CATEGORIAS.filter(
  (c) => ES_COSTO_DE_EVENTO[c],
);
