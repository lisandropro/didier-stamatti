// Tareas que corren solas dentro del servidor. Next.js llama a register() una
// sola vez, al iniciar — desde acá se programa el resto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const texto = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  // --- Avisos de pedidos ---------------------------------------------------
  // Corre siempre, aunque el respaldo no esté configurado: sin este barrido los
  // avisos de cambios en los pedidos nunca saldrían al celular.
  const { flushPendingOrderPushes } = await import("@/lib/notify");
  const flush = async () => {
    const { enviados, cerrados, reintentos } = await flushPendingOrderPushes();
    if (cerrados > 0 || reintentos > 0) {
      console.log(`[avisos] tandas cerradas: ${cerrados} · aceptados: ${enviados} · reintentos: ${reintentos}`);
    }
  };
  void flush();
  setInterval(() => void flush(), MINUTE);

  // --- Avisos de pedido vacío ----------------------------------------------
  // Va fuera de la condición del respaldo: que un evento se venga sin pedido no
  // tiene nada que ver con tener S3 configurado.
  //
  // Cada 10 minutos, como el resumen de la mañana, y no "al arrancar y cada 24
  // horas": así quedaba atado a la hora del último despliegue, y un despliegue
  // de madrugada hacía sonar los teléfonos de madrugada. La franja horaria (de 8
  // a 20, hora argentina) y el no repetir se resuelven adentro.
  const { notificarPedidosVacios } = await import("@/lib/pedido-vacio");
  const avisarVacios = async () => {
    const { avisos, eventos } = await notificarPedidosVacios();
    if (avisos > 0) console.log(`[pedido-vacio] ${eventos} evento(s) sin pedido · ${avisos} aviso(s) enviados`);
  };
  void avisarVacios();
  setInterval(() => void avisarVacios(), 10 * MINUTE);

  // --- Resumen de la mañana ------------------------------------------------
  // Cada 10 minutos alcanza: se manda una sola vez por persona y por día, y la
  // hora (de 7 a 11, hora argentina) se controla adentro. Al arrancar también,
  // así un servidor que se reinicia a las 8 todavía llega a mandarlo. Fuera de
  // la condición del respaldo, por lo mismo que el aviso de pedido vacío.
  const { enviarResumenDeLaManana } = await import("@/lib/resumen-manana-db");
  const mandarResumen = async () => {
    const { enviados } = await enviarResumenDeLaManana();
    // Cuenta personas con el aviso guardado en la app, no pushes aceptados: un
    // teléfono sin avisos activados también cuenta. Por eso "avisos", no "enviados".
    if (enviados > 0) console.log(`[resumen] avisos: ${enviados}`);
  };
  void mandarResumen();
  setInterval(() => void mandarResumen(), 10 * MINUTE);

  // --- Faltante nuevo --------------------------------------------------------
  // Cada minuto, como los avisos de pedidos: un faltante tiene que llegar al
  // depósito mientras todavía se puede conseguir. Fuera de la condición del
  // respaldo, por lo mismo que el aviso de pedido vacío.
  const { barrerFaltantes } = await import("@/lib/faltantes-db");
  const barrerFaltantesYAnotar = async () => {
    const { avisos, registrados } = await barrerFaltantes();
    if (avisos > 0 || registrados > 0) {
      console.log(`[faltantes] avisos: ${avisos} · registrados sin avisar: ${registrados}`);
    }
  };
  void barrerFaltantesYAnotar();
  setInterval(() => void barrerFaltantesYAnotar(), MINUTE);

  // --- Vaciado de la papelera ----------------------------------------------
  // Va antes del respaldo y fuera de su condición: limpiar la papelera no
  // depende de tener el respaldo configurado. La regla es por fecha, así que
  // correrlo al arrancar y una vez por día alcanza — ver lib/trash.ts.
  const { vaciarPapelera } = await import("@/lib/trash");
  const vaciar = async () => {
    try {
      const { periodos, eventos, avisos, corte } = await vaciarPapelera();
      if (periodos + eventos + avisos > 0) {
        console.log(`[papelera] vaciada hasta el lunes ${corte}: ${periodos} períodos, ${eventos} eventos, ${avisos} avisos`);
      }
    } catch (e) {
      // Que no se caiga el arranque por esto: la papelera se limpia al día siguiente.
      console.error(`[papelera] error: ${texto(e)}`);
    }
    // El registro de envíos se guarda 60 días. Va acá porque es una limpieza
    // diaria por fecha, igual que la papelera, pero con su propio try: que falle
    // una no puede saltearse la otra ni quedar anotada como si fuera la otra.
    try {
      const { podarEntregas } = await import("@/lib/push");
      const podadas = await podarEntregas();
      if (podadas > 0) console.log(`[avisos] registro podado: ${podadas} envíos de más de 60 días`);
    } catch (e) {
      console.error(`[avisos] error al podar el registro: ${texto(e)}`);
    }
  };
  void vaciar();
  setInterval(() => void vaciar(), DAY);

  // --- Respaldo y revisión diaria ------------------------------------------
  if (!process.env.BACKUP_S3_BUCKET) return; // sin configurar (ej. en desarrollo local): no hace nada

  const { runBackup } = await import("@/lib/backup");
  const { runHealthCheck } = await import("@/lib/healthcheck");

  /** Un respaldo. Devuelve si salió bien; nunca lanza. */
  const run = async (): Promise<boolean> => {
    try {
      const res = await runBackup();
      if (res.ok) console.log(`[backup] ok: ${res.key} (podados: ${res.pruned})`);
      else console.error(`[backup] error: ${res.error}`);
      return res.ok;
    } catch (e) {
      console.error(`[backup] error: ${texto(e)}`);
      return false;
    }
  };

  // La revisión corre DESPUÉS del respaldo, así no reporta como viejo el
  // respaldo que está por hacerse en este mismo arranque.
  const check = async () => {
    const { problems, notified } = await runHealthCheck();
    if (problems.length === 0) console.log("[revision] todo en orden");
    else console.log(`[revision] ${problems.map((p) => p.code).join(", ")}${notified ? " (avisado)" : " (ya avisado antes, o no interrumpe)"}`);
  };

  // Respaldo, y si falla, un segundo intento a los 10 minutos. Antes un respaldo
  // que fallaba por algo pasajero (la base ocupada en ese instante, un corte de
  // red) no se volvía a intentar hasta el día siguiente o el próximo arranque.
  // Después, pase lo que pase con el respaldo, la revisión: es la que avisa si
  // quedó sin hacerse.
  const diario = async () => {
    try {
      if (!(await run())) {
        await new Promise((r) => setTimeout(r, 10 * MINUTE));
        console.log("[backup] segundo intento");
        await run();
      }
      await check();
    } catch (e) {
      console.error(`[revision] error: ${texto(e)}`);
    }
  };

  // Uno al arrancar (así no hay que esperar 24hs para el primero) y después uno por día.
  void diario();
  setInterval(() => void diario(), DAY);
}
