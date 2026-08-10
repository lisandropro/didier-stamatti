// Tareas que corren solas dentro del servidor. Next.js llama a register() una
// sola vez, al iniciar — desde acá se programa el resto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  // --- Avisos de pedidos ---------------------------------------------------
  // Corre siempre, aunque el respaldo no esté configurado: sin este barrido los
  // avisos de cambios en los pedidos nunca saldrían al celular.
  const { flushPendingOrderPushes } = await import("@/lib/notify");
  const flush = async () => {
    const { enviados, cerrados } = await flushPendingOrderPushes();
    if (cerrados > 0) console.log(`[avisos] tandas cerradas: ${cerrados} · push enviados: ${enviados}`);
  };
  void flush();
  setInterval(() => void flush(), MINUTE);

  // --- Respaldo y revisión diaria ------------------------------------------
  if (!process.env.BACKUP_S3_BUCKET) return; // sin configurar (ej. en desarrollo local): no hace nada

  const { runBackup } = await import("@/lib/backup");
  const { runHealthCheck } = await import("@/lib/healthcheck");

  const run = async () => {
    const res = await runBackup();
    if (res.ok) console.log(`[backup] ok: ${res.key} (podados: ${res.pruned})`);
    else console.error(`[backup] error: ${res.error}`);
  };

  // La revisión corre DESPUÉS del respaldo, así no reporta como viejo el
  // respaldo que está por hacerse en este mismo arranque.
  const check = async () => {
    const { problems, notified } = await runHealthCheck();
    if (problems.length === 0) console.log("[revision] todo en orden");
    else console.log(`[revision] ${problems.map((p) => p.code).join(", ")}${notified ? " (avisado)" : " (ya avisado antes)"}`);
  };

  // Uno al arrancar (así no hay que esperar 24hs para el primero) y después uno por día.
  void run().then(check);
  setInterval(() => void run().then(check), DAY);
}
