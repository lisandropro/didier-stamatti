import Link from "next/link";
import type { Hallazgo } from "@/lib/checks";

const IconWarn = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

/**
 * Los controles de datos, en Avisos.
 *
 * Viven acá y no en la pantalla de períodos por dos motivos: Avisos es donde ya
 * se mira lo que necesita atención, y la de períodos es la pantalla de trabajo
 * de todo el equipo — llenarla de pendientes que no le tocan a quien está
 * armando un pedido la vuelve ruido.
 *
 * Solo señalan: cada línea lleva al lugar donde la persona decide qué hacer.
 */
export function ParaRevisar({ hallazgos }: { hallazgos: Hallazgo[] }) {
  if (hallazgos.length === 0) return null;
  return (
    <div className="revision">
      <div className="revision-head">
        {IconWarn}
        <b>Para revisar</b>
        <span className="count-pill">{hallazgos.length}</span>
      </div>
      <ul className="revision-list">
        {hallazgos.map((h, i) => (
          <li key={h.code + i} className={`revision-item grav-${h.gravedad}`}>
            {h.url ? <Link href={h.url}>{h.message}</Link> : <span>{h.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
