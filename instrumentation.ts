// Arranca el respaldo automático diario. Next.js llama a register() una sola
// vez, al iniciar el servidor — desde acá programamos el resto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.BACKUP_S3_BUCKET) return; // sin configurar (ej. en desarrollo local): no hace nada

  const { runBackup } = await import("@/lib/backup");
  const { runHealthCheck } = await import("@/lib/healthcheck");
  const DAY = 24 * 60 * 60 * 1000;

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
