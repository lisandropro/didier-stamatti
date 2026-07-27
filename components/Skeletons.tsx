/* Esqueletos de carga. Next precarga estos archivos, así que aparecen apenas
   se toca una pestaña — el usuario ve el título correcto al instante mientras
   los datos viajan al servidor. */

/** `title` se omite cuando el encabezado real es dinámico (p. ej. el lugar del
 *  evento): en ese caso también se muestra como esqueleto. */
export function PageSkeleton({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            {title ?? <span className="sk sk-line" style={{ display: "block", width: 180, height: 22 }} />}
          </h1>
          <div className="sub">
            <span className="sk sk-line" style={{ display: "block", width: 200, marginBottom: 0 }} />
          </div>
        </div>
      </div>
      <div className="content">{children}</div>
    </>
  );
}

export function SkeletonChips({ count = 3 }: { count?: number }) {
  return (
    <div className="sk-chips">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="sk sk-chip" />
      ))}
    </div>
  );
}

/** Filas de tabla/lista dentro de un panel. */
export function SkeletonRows({ count = 8, widths }: { count?: number; widths?: number[] }) {
  const w = widths ?? [46, 22, 14];
  return (
    <div className="sk-panel">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-row">
          {w.map((pct, j) => (
            <span key={j} className="sk sk-line" style={{ width: `${pct}%`, marginBottom: 0 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Tarjetas en grilla (eventos, ajustes). */
export function SkeletonCards({ count = 3, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div className="event-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-card">
          <span className="sk sk-line" style={{ width: "60%", height: 18 }} />
          {Array.from({ length: lines }, (_, j) => (
            <span key={j} className="sk sk-line" style={{ width: j === lines - 1 ? "40%" : "85%" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
