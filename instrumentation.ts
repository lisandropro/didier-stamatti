// Arranca el respaldo automático diario. Next.js llama a register() una sola
// vez, al iniciar el servidor — desde acá programamos el resto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.BACKUP_S3_BUCKET) return; // sin configurar (ej. en desarrollo local): no hace nada

  const { runBackup } = await import("@/lib/backup");
  const DAY = 24 * 60 * 60 * 1000;

  const run = async () => {
    const res = await runBackup();
    if (res.ok) console.log(`[backup] ok: ${res.key} (podados: ${res.pruned})`);
    else console.error(`[backup] error: ${res.error}`);
  };

  // Uno al arrancar (así no hay que esperar 24hs para el primero) y después uno por día.
  void run();
  setInterval(run, DAY);
}
