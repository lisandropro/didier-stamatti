/** El texto de un error, venga como venga. Para los `console.error` de las
 *  tareas de fondo y de los avisos, que nunca pueden lanzar por armar el log. */
export const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));
