// El vocabulario de las sugerencias, sin dependencias.
//
// Vive aparte de las acciones para que lo usen las tres capas: el formulario,
// la pantalla de la administradora y las pruebas. Los valores guardados son de
// una sola palabra; el texto que se muestra vive solo acá.

export const SUGGESTION_KINDS = ["AGREGAR", "CAMBIAR", "ELIMINAR", "PROBLEMA", "OTRO"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const KIND_LABEL: Record<string, string> = {
  AGREGAR: "Añadir",
  CAMBIAR: "Cambiar",
  ELIMINAR: "Eliminar",
  PROBLEMA: "Informar un problema",
  OTRO: "Otro",
};

/** Texto corto para las listas, donde "Informar un problema" no entra. */
export const KIND_SHORT: Record<string, string> = {
  AGREGAR: "Añadir",
  CAMBIAR: "Cambiar",
  ELIMINAR: "Eliminar",
  PROBLEMA: "Problema",
  OTRO: "Otro",
};

export const SUGGESTION_STATUSES = [
  "NUEVA",
  "EN_REVISION",
  "ACEPTADA",
  "IMPLEMENTADA",
  "DESCARTADA",
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  NUEVA: "Nueva",
  EN_REVISION: "En revisión",
  ACEPTADA: "Aceptada",
  IMPLEMENTADA: "Implementada",
  DESCARTADA: "Descartada",
};

/** Clase del chip de color. Las mismas que ya usa el resto de la app. */
export const STATUS_CLASS: Record<string, string> = {
  NUEVA: "warn",
  EN_REVISION: "neutral",
  ACEPTADA: "ok",
  IMPLEMENTADA: "ok",
  DESCARTADA: "crit",
};

export function isKind(value: string): value is SuggestionKind {
  return (SUGGESTION_KINDS as readonly string[]).includes(value);
}

export function isStatus(value: string): value is SuggestionStatus {
  return (SUGGESTION_STATUSES as readonly string[]).includes(value);
}

// Topes de longitud. Se validan en el servidor: el `maxLength` del formulario
// es comodidad, no una defensa — quien llame a la acción directamente se saltea
// el formulario entero.
export const LIMITS = {
  title: 120,
  body: 4000,
  context: 300,
  screen: 200,
  reply: 4000,
} as const;

/**
 * De qué pantalla salió la sugerencia, en castellano.
 *
 * Se calcula a partir de la ruta porque es el único dato de ubicación que el
 * navegador puede dar sin inventar nada. Si mañana aparece una pantalla nueva
 * y no está acá, se muestra la ruta cruda: es feo pero no miente.
 */
export function screenLabel(path: string): string {
  if (!path) return "Desconocida";
  if (path === "/") return "Períodos";
  if (/^\/evento\/[^/]+\/pdf/.test(path)) return "Hoja para imprimir";
  if (/^\/evento\/[^/]+$/.test(path)) return "Pedido de un evento";
  if (/^\/finde\//.test(path)) return "Resumen del depósito";
  if (path.startsWith("/inventario")) return "Inventario";
  if (path.startsWith("/historial")) return "Historial";
  if (path.startsWith("/notificaciones")) return "Avisos";
  if (path.startsWith("/sugerencias")) return "Sugerencias";
  if (path.startsWith("/cuenta")) return "Mi cuenta";
  if (path.startsWith("/usuarios")) return "Usuarios";
  if (path.startsWith("/aviso/")) return "Detalle de un aviso";
  return path;
}

/** El id del evento que se estaba mirando, si la pantalla era la de un pedido. */
export function eventIdFromScreen(path: string): string | null {
  const m = /^\/evento\/([^/]+)/.exec(path ?? "");
  return m ? m[1] : null;
}

/**
 * Navegador y sistema, en dos palabras, a partir del User-Agent.
 *
 * Se queda con lo que sirve para reproducir un problema y descarta el resto:
 * el User-Agent completo es largo, ilegible y no aporta nada más. Se lee en el
 * servidor, así el teléfono no manda nada por su cuenta.
 */
export function deviceSummary(ua: string): string {
  if (!ua) return "Desconocido";
  const so = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone/iPad"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X/i.test(ua)
          ? "Mac"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Otro sistema";
  // El orden importa: Edge y Samsung Internet también dicen "Chrome", y Chrome
  // también dice "Safari". Se prueba de lo más específico a lo más general.
  const nav = /Edg\//i.test(ua)
    ? "Edge"
    : /SamsungBrowser/i.test(ua)
      ? "Samsung Internet"
      : /FxiOS|Firefox/i.test(ua)
        ? "Firefox"
        : /CriOS|Chrome/i.test(ua)
          ? "Chrome"
          : /Safari/i.test(ua)
            ? "Safari"
            : "Otro navegador";
  const modelo = /Android/i.test(ua) ? /;\s*(SM-[A-Z0-9]+)/i.exec(ua)?.[1] : undefined;
  return modelo ? `${nav} · ${so} (${modelo})` : `${nav} · ${so}`;
}
