// Quién puede hacer qué, en un solo lugar y sin dependencias.
//
// Vive aparte para que lo usen las tres capas: las server actions (que son la
// barrera real), las pantallas (que solo deciden qué botón mostrar) y las
// pruebas. Si un permiso se decidiera en cada archivo por su cuenta, alcanzaría
// con olvidarse de uno para abrir un agujero.
//
// REGLA: esconder un botón NO es un permiso. Toda acción que escribe algo tiene
// que llamar a la comprobación que corresponde, del lado del servidor.

export const ROLES = ["ADMIN", "ARMADOR", "LOGISTICA"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administradora",
  ARMADOR: "Armador/a",
  LOGISTICA: "Encargado de logística",
};

/** Descripción corta para la pantalla de Usuarios. */
export const ROLE_HELP: Record<string, string> = {
  ADMIN: "Control total",
  ARMADOR: "Arma pedidos",
  LOGISTICA: "Mira todo y cambia el responsable de la fiesta",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Capacidades. Cada una responde una sola pregunta.
// ---------------------------------------------------------------------------

/** Cargar y modificar los pedidos: cantidades, notas, ítems sueltos, copiar de
 *  otro evento. El encargado de logística NO: mira el pedido, no lo toca. */
export function canEditOrders(role: string): boolean {
  return role === "ADMIN" || role === "ARMADOR";
}

/** Crear, borrar y recuperar findes y eventos, marcarlos listos, y las
 *  versiones guardadas (guardar, descartar y restaurar). */
export function canManagePeriods(role: string): boolean {
  return role === "ADMIN" || role === "ARMADOR";
}

/** Ajustar el stock del depósito. Solo la administradora. */
export function canEditStock(role: string): boolean {
  return role === "ADMIN";
}

/** Alta, edición, baja y reactivación de productos del catálogo. */
export function canManageCatalog(role: string): boolean {
  return role === "ADMIN";
}

/** Crear usuarios, cambiarles el rol, la contraseña o borrarlos. */
export function canManageUsers(role: string): boolean {
  return role === "ADMIN";
}

/** Cambiar el responsable de la fiesta. Es lo único que puede escribir el
 *  encargado de logística: es el dato que él administra. */
export function canSetResponsable(role: string): boolean {
  return role === "ADMIN" || role === "ARMADOR" || role === "LOGISTICA";
}

/** Mirar findes, eventos, pedidos, faltantes, inventario e historiales.
 *  Cualquiera con sesión: la app no tiene datos reservados por persona. */
export function canView(role: string): boolean {
  return isRole(role);
}

/** Mandar sugerencias sobre la app y ver las propias. Cualquiera que entre:
 *  quien la usa es quien encuentra lo que falta, y el que arma los pedidos y el
 *  que maneja el depósito ven problemas distintos. No es un permiso sobre los
 *  datos —una sugerencia es un mensaje, no un cambio—, así que abrirlo a todos
 *  no le da a nadie acceso a nada que antes no tuviera. */
export function canSendSuggestions(role: string): boolean {
  return isRole(role);
}

/** Ver TODAS las sugerencias, cambiarles el estado y responderlas. */
export function canManageSuggestions(role: string): boolean {
  return role === "ADMIN";
}

/** Ver los controles de datos ("Para revisar").
 *
 *  Solo la administradora. No es un permiso sobre datos —son cosas que ya se
 *  pueden ver— sino sobre a quién le corresponde ocuparse: mostrarle a todo el
 *  equipo una lista de pendientes que no le toca resolver la convierte en ruido,
 *  y una lista que se ignora deja de controlar. */
export function canSeeChecks(role: string): boolean {
  return role === "ADMIN";
}

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------

/** El encargado del depósito es el que sale a conseguir lo que falta: su aviso
 *  va primero y con la prioridad más alta que admite Web Push. */
export function isPriorityRecipient(role: string): boolean {
  return role === "LOGISTICA";
}

/** Ordena los destinatarios dejando primero a los prioritarios. Es estable:
 *  dentro de cada grupo se conserva el orden recibido, así el resultado no
 *  cambia de una corrida a otra. */
export function sortByNotificationPriority<T extends { role: string }>(users: T[]): T[] {
  const prioritarios = users.filter((u) => isPriorityRecipient(u.role));
  const resto = users.filter((u) => !isPriorityRecipient(u.role));
  return [...prioritarios, ...resto];
}
